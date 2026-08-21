import { verify as verifySignature } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { promisify } from "node:util";

import { ADAPTERS, adapterForProject } from "./adapters.mjs";
import {
  INCOMING_DIR,
  LOG_DIR,
  SOCKET_PATH,
  STAGING_DIR,
  appendHistory,
  ensureDataDirs,
  httpHealth,
  jsonResponse,
  operationId,
  parseBoolean,
  readEnvValue,
  readHistory,
  readJsonBody,
  sha256File
} from "./common.mjs";

const execFileAsync = promisify(execFile);
const PYTHON_BIN = process.env.PROJECT_CONTROL_PYTHON_BIN || "/usr/bin/python3";
const PACKAGE_TOOL = new URL("./package_tool.py", import.meta.url).pathname;
const TRUSTED_KEYS_DIR = process.env.PROJECT_CONTROL_TRUSTED_KEYS_DIR || "/etc/project-control/trusted-keys";
const REQUIRE_SIGNATURE = parseBoolean(process.env.PROJECT_CONTROL_REQUIRE_SIGNATURE, false);
const MAX_COMMAND_MS = Number(process.env.PROJECT_CONTROL_COMMAND_TIMEOUT_MS || 30 * 60 * 1000);
let operationRunning = false;

function safeVersion(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(value);
}

function serviceManifestFor(raw) {
  const manifest = raw?.manifest;
  if (!manifest || typeof manifest !== "object") throw new Error("Отсутствует manifest Project Control.");
  if (manifest.schema !== "f2re-managed-service/v1" || manifest.controllerApi !== 1) {
    throw new Error("Неподдерживаемая версия контракта Project Control.");
  }
  if (!Object.hasOwn(ADAPTERS, manifest.projectId)) throw new Error("Project Control package относится к неизвестному проекту.");
  const adapter = adapterForProject(manifest.projectId);
  if (manifest.adapter !== adapter.adapter) throw new Error("Adapter в package не соответствует allowlist контроллера.");
  if (!safeVersion(manifest.version)) throw new Error("Некорректная версия в Project Control package.");
  if (!manifest.payload || typeof manifest.payload.sha256 !== "string") throw new Error("Некорректный payload manifest.");
  return manifest;
}

async function pythonJson(args) {
  const { stdout } = await execFileAsync(PYTHON_BIN, [PACKAGE_TOOL, ...args], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 120_000
  });
  return JSON.parse(stdout);
}

async function inspectPackage(packagePath) {
  const raw = await pythonJson(["inspect", packagePath]);
  const manifest = serviceManifestFor(raw);
  const signature = raw.signatureBase64 ? Buffer.from(raw.signatureBase64, "base64") : null;
  if (!signature) {
    if (REQUIRE_SIGNATURE) throw new Error("Package не подписан доверенным release-ключом.");
    return { raw, manifest, signatureState: "unsigned-allowed" };
  }
  const signing = manifest.signing;
  if (!signing || signing.algorithm !== "ed25519" || !/^[a-f0-9]{16,64}$/.test(signing.keyId || "")) {
    throw new Error("Некорректное описание подписи release package.");
  }
  const publicKeyPath = path.join(TRUSTED_KEYS_DIR, `${signing.keyId}.pem`);
  let publicKey;
  try {
    publicKey = await fs.readFile(publicKeyPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`Ключ подписи ${signing.keyId} не является доверенным.`);
    throw error;
  }
  const rawManifest = Buffer.from(raw.rawManifestBase64, "base64");
  if (!verifySignature(null, rawManifest, publicKey, signature)) {
    throw new Error("Подпись Project Control package недействительна.");
  }
  return { raw, manifest, signatureState: `verified:${signing.keyId}` };
}

async function validateIncoming(uploadPath) {
  const incomingReal = await fs.realpath(INCOMING_DIR);
  const fileReal = await fs.realpath(uploadPath);
  if (path.dirname(fileReal) !== incomingReal) throw new Error("Upload находится вне разрешённого incoming-каталога.");
  const stat = await fs.stat(fileReal);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error("Upload должен быть обычным отдельным файлом.");
  return fileReal;
}

async function serviceState(service) {
  const run = async (verb) => {
    try {
      await execFileAsync("/bin/systemctl", [verb, "--quiet", service], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  };
  return { name: service, active: await run("is-active"), enabled: await run("is-enabled") };
}

async function currentVersion(adapter) {
  let release = null;
  let installed = false;
  let version = null;
  try {
    release = await fs.realpath(adapter.currentPath);
    installed = true;
    version = (await fs.readFile(path.join(release, adapter.versionFile), "utf8")).trim() || null;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      if (installed) return { installed, release, version, versionError: error.message };
    }
  }
  return { installed, release, version };
}

async function projectStatus(adapter, history) {
  const current = await currentVersion(adapter);
  const required = await Promise.all(adapter.requiredServices.map(serviceState));
  const optional = await Promise.all(adapter.optionalServices.map(serviceState));
  const configuredPort = Number(await readEnvValue(adapter.configFile, adapter.portKey));
  const port = Number.isInteger(configuredPort) && configuredPort > 0 && configuredPort <= 65535
    ? configuredPort
    : adapter.defaultPort;
  let health = { ok: false, skipped: true };
  if (current.installed && required.every((item) => item.active)) {
    health = await httpHealth(port, adapter.healthPath);
  }
  const lastOperation = history.find((entry) => entry.projectId === adapter.id && entry.status === "success") || null;
  const lastFailure = history.find((entry) => entry.projectId === adapter.id && entry.status === "failed") || null;
  return {
    id: adapter.id,
    displayName: adapter.displayName,
    ...current,
    requiredServices: required,
    optionalServices: optional,
    health,
    healthy: current.installed && required.every((item) => item.active) && health.ok,
    lastUpdatedAt: lastOperation?.finishedAt || null,
    lastOperation,
    lastFailure
  };
}

async function allStatus() {
  const history = await readHistory();
  const projects = [];
  for (const adapter of Object.values(ADAPTERS)) projects.push(await projectStatus(adapter, history));
  return {
    projects,
    operationRunning,
    requireSignature: REQUIRE_SIGNATURE,
    history: history.slice(0, 30)
  };
}

async function appendLog(logPath, prefix, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  await fs.appendFile(logPath, `${prefix}${text}`, { encoding: "utf8", mode: 0o640 });
}

async function runLogged(command, args, { cwd, logPath, timeoutMs = MAX_COMMAND_MS }) {
  await appendLog(logPath, "", `\n$ ${[command, ...args].join(" ")}\n`);
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let tail = "";
    const remember = (prefix, chunk) => {
      void appendLog(logPath, prefix, chunk);
      tail = `${tail}${prefix}${chunk.toString("utf8")}`.slice(-16 * 1024);
    };
    child.stdout.on("data", (chunk) => remember("", chunk));
    child.stderr.on("data", (chunk) => remember("[stderr] ", chunk));
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ code, tail });
      else reject(new Error(`Команда завершилась с кодом ${code ?? "?"}${signal ? ` (${signal})` : ""}. ${tail.slice(-4000)}`));
    });
  });
}

async function nativeBundleRoot(extractRoot, adapter) {
  const requiredScript = adapter.native.update.script;
  const direct = path.join(extractRoot, requiredScript);
  if ((await fs.stat(direct).catch(() => null))?.isFile()) return extractRoot;
  const entries = await fs.readdir(extractRoot, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(extractRoot, entry.name);
    if ((await fs.stat(path.join(candidate, requiredScript)).catch(() => null))?.isFile()) candidates.push(candidate);
  }
  if (candidates.length !== 1) throw new Error(`Не найден однозначный корень native bundle для ${adapter.id}.`);
  return candidates[0];
}

async function applyPackage({ projectId, uploadPath, originalName, uploadSha256 }) {
  if (operationRunning) throw Object.assign(new Error("Уже выполняется другая операция обновления."), { statusCode: 409 });
  operationRunning = true;
  const opId = operationId();
  const startedAt = new Date().toISOString();
  const stage = path.join(STAGING_DIR, opId);
  const wrapperStage = path.join(stage, "wrapper");
  const nativeStage = path.join(stage, "native");
  const logPath = path.join(LOG_DIR, `${opId}.log`);
  let manifest = null;
  let before = null;
  try {
    const safeUpload = await validateIncoming(uploadPath);
    const calculatedUploadSha = await sha256File(safeUpload);
    if (uploadSha256 && calculatedUploadSha !== uploadSha256) throw new Error("SHA-256 upload изменился между API и executor.");
    await fs.mkdir(wrapperStage, { recursive: true, mode: 0o750 });
    const inspected = await inspectPackage(safeUpload);
    manifest = inspected.manifest;
    if (manifest.projectId !== projectId) throw new Error(`Выбран ${projectId}, но package предназначен для ${manifest.projectId}.`);
    const adapter = adapterForProject(projectId);
    before = await currentVersion(adapter);
    await appendLog(logPath, "", `Project Control operation ${opId}\nproject=${projectId}\nversion=${manifest.version}\npackage=${originalName || path.basename(safeUpload)}\nsha256=${calculatedUploadSha}\nsignature=${inspected.signatureState}\n`);
    const { stdout: payloadStdout } = await execFileAsync(PYTHON_BIN, [PACKAGE_TOOL, "extract-payload", safeUpload, wrapperStage], {
      encoding: "utf8", timeout: 10 * 60 * 1000, maxBuffer: 1024 * 1024
    });
    const payloadPath = payloadStdout.trim();
    await runLogged(PYTHON_BIN, [PACKAGE_TOOL, "extract-native", payloadPath, nativeStage], { cwd: stage, logPath, timeoutMs: 15 * 60 * 1000 });
    const bundleRoot = await nativeBundleRoot(nativeStage, adapter);
    if (adapter.native.verify) {
      const verifyScript = path.join(bundleRoot, adapter.native.verify.script);
      await runLogged("/bin/bash", [verifyScript, ...adapter.native.verify.args], { cwd: bundleRoot, logPath });
    }
    const selected = before.installed ? adapter.native.update : adapter.native.install;
    const installScript = path.join(bundleRoot, selected.script);
    await runLogged("/bin/bash", [installScript, ...selected.args], { cwd: bundleRoot, logPath });
    const history = await readHistory();
    const afterStatus = await projectStatus(adapter, history);
    if (!afterStatus.installed) throw new Error("После installer приложение не обнаружено.");
    if (afterStatus.version !== manifest.version) {
      throw new Error(`Installer завершился, но активна версия ${afterStatus.version || "не определена"}, ожидалась ${manifest.version}.`);
    }
    if (!afterStatus.healthy) throw new Error("После installer штатный service/health-check контроллера не подтверждён.");
    const finishedAt = new Date().toISOString();
    const record = {
      operationId: opId,
      projectId,
      displayName: adapter.displayName,
      status: "success",
      action: before.installed ? "update" : "install",
      fromVersion: before.version,
      toVersion: afterStatus.version,
      startedAt,
      finishedAt,
      packageName: originalName || path.basename(safeUpload),
      packageSha256: calculatedUploadSha,
      payloadSha256: manifest.payload.sha256,
      sourceCommit: manifest.sourceCommit || null,
      signature: inspected.signatureState,
      logPath
    };
    await appendHistory(record);
    return { ok: true, operation: record, project: await projectStatus(adapter, [record, ...history]) };
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const adapter = Object.hasOwn(ADAPTERS, projectId) ? adapterForProject(projectId) : null;
    const record = {
      operationId: opId,
      projectId,
      displayName: adapter?.displayName || projectId,
      status: "failed",
      action: before?.installed ? "update" : "install",
      fromVersion: before?.version || null,
      toVersion: manifest?.version || null,
      startedAt,
      finishedAt,
      packageName: originalName || path.basename(uploadPath),
      packageSha256: uploadSha256 || null,
      error: error.message,
      logPath
    };
    await appendLog(logPath, "\nERROR: ", `${error.stack || error.message}\n`).catch(() => {});
    await appendHistory(record).catch(() => {});
    throw error;
  } finally {
    operationRunning = false;
    await fs.rm(stage, { recursive: true, force: true }).catch(() => {});
  }
}

async function restartProject(projectId) {
  if (operationRunning) throw Object.assign(new Error("Во время обновления перезапуск недоступен."), { statusCode: 409 });
  const adapter = adapterForProject(projectId);
  const current = await currentVersion(adapter);
  if (!current.installed) throw Object.assign(new Error("Проект не установлен."), { statusCode: 404 });
  const opId = operationId();
  const logPath = path.join(LOG_DIR, `${opId}.log`);
  const startedAt = new Date().toISOString();
  operationRunning = true;
  try {
    for (const service of adapter.requiredServices) {
      await runLogged("/bin/systemctl", ["restart", service], { cwd: "/", logPath, timeoutMs: 120_000 });
    }
    for (const service of adapter.optionalServices) {
      const state = await serviceState(service);
      if (state.active) await runLogged("/bin/systemctl", ["restart", service], { cwd: "/", logPath, timeoutMs: 120_000 });
    }
    const history = await readHistory();
    const status = await projectStatus(adapter, history);
    if (!status.healthy) throw new Error("После перезапуска health-check не подтверждён.");
    const record = { operationId: opId, projectId, displayName: adapter.displayName, status: "success", action: "restart", fromVersion: current.version, toVersion: current.version, startedAt, finishedAt: new Date().toISOString(), logPath };
    await appendHistory(record);
    return { ok: true, operation: record, project: status };
  } catch (error) {
    const record = { operationId: opId, projectId, displayName: adapter.displayName, status: "failed", action: "restart", fromVersion: current.version, toVersion: current.version, startedAt, finishedAt: new Date().toISOString(), error: error.message, logPath };
    await appendHistory(record).catch(() => {});
    throw error;
  } finally {
    operationRunning = false;
  }
}

async function route(request, response) {
  try {
    if (request.method === "POST" && request.url === "/status") return jsonResponse(response, 200, await allStatus());
    if (request.method === "POST" && request.url === "/apply") {
      const body = await readJsonBody(request);
      return jsonResponse(response, 200, await applyPackage(body));
    }
    if (request.method === "POST" && request.url === "/restart") {
      const body = await readJsonBody(request);
      return jsonResponse(response, 200, await restartProject(body.projectId));
    }
    return jsonResponse(response, 404, { error: "not_found" });
  } catch (error) {
    return jsonResponse(response, error.statusCode || 500, { error: error.message });
  }
}

await ensureDataDirs();
await fs.mkdir(path.dirname(SOCKET_PATH), { recursive: true, mode: 0o755 });
await fs.rm(SOCKET_PATH, { force: true });
const server = http.createServer(route);
server.requestTimeout = 0;
server.listen(SOCKET_PATH, async () => {
  await fs.chmod(SOCKET_PATH, 0o660);
  try {
    await execFileAsync("/bin/chgrp", ["project-control", SOCKET_PATH]);
  } catch (error) {
    console.error("Не удалось назначить группу Unix socket:", error.message);
    process.exitCode = 1;
    server.close();
  }
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

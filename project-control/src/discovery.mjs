import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { ADAPTERS } from "./adapters.mjs";
import { readEnvValue } from "./common.mjs";

const execFileAsync = promisify(execFile);
const OPT_ROOT = process.env.PROJECT_CONTROL_DISCOVERY_OPT_ROOT || "/opt";
const NGINX_ROOT = process.env.PROJECT_CONTROL_DISCOVERY_NGINX_ROOT || "/etc/nginx";
const MAX_OPT_ENTRIES = 256;
const MAX_NGINX_FILES = 256;
const MAX_NGINX_FILE_BYTES = 512 * 1024;
const MAX_NGINX_TOTAL_BYTES = 4 * 1024 * 1024;

const ALIASES = Object.freeze({
  docomator: ["docomator", "оформлятор"],
  "planer-solving": ["planner-solving", "planer-solving", "boris", "борис"],
  "kafedra-planner": ["kafedra-planner", "kafedra", "кафедра"]
});

function commandError(error) {
  if (!error) return null;
  return String(error.stderr || error.message || error).trim().slice(0, 1200);
}

async function execOptional(command, args, timeout = 7000) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: "utf8",
      timeout,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, LANG: "C", LC_ALL: "C" }
    });
    return { ok: true, stdout: result.stdout || "", stderr: result.stderr || "" };
  } catch (error) {
    return { ok: false, stdout: error.stdout || "", stderr: commandError(error) };
  }
}

function cleanVersion(value) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(text) ? text : null;
}

async function readVersionCandidates(root) {
  const candidates = [
    "VERSION",
    "app/VERSION",
    "application/VERSION"
  ];
  for (const relative of candidates) {
    const file = path.join(root, relative);
    try {
      const value = cleanVersion(await fs.readFile(file, "utf8"));
      if (value) return { version: value, versionFile: file };
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EACCES") {
        return { version: null, versionFile: file, versionError: error.message };
      }
    }
  }
  return { version: null, versionFile: null };
}

export function projectHintForPath(value) {
  const lower = String(value || "").toLowerCase();
  for (const [projectId, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((alias) => lower.includes(alias))) return projectId;
  }
  return null;
}

async function inspectOptEntry(name) {
  const root = path.join(OPT_ROOT, name);
  let stat;
  try {
    stat = await fs.lstat(root);
  } catch {
    return null;
  }
  if (!stat.isDirectory() && !stat.isSymbolicLink()) return null;

  let rootTarget = root;
  try { rootTarget = await fs.realpath(root); } catch {}
  const currentPath = path.join(root, "current");
  let currentTarget = null;
  let currentExists = false;
  try {
    currentTarget = await fs.realpath(currentPath);
    currentExists = true;
  } catch {}

  let versionInfo = await readVersionCandidates(currentExists ? currentTarget : rootTarget);
  if (!versionInfo.version && currentExists && currentTarget !== rootTarget) {
    versionInfo = await readVersionCandidates(rootTarget);
  }

  return {
    name,
    path: root,
    realPath: rootTarget,
    currentPath,
    currentTarget,
    currentExists,
    projectHint: projectHintForPath(`${name} ${rootTarget} ${currentTarget || ""}`),
    ...versionInfo
  };
}

export async function scanOpt() {
  const diagnostics = [];
  let entries;
  try {
    entries = await fs.readdir(OPT_ROOT, { withFileTypes: true });
  } catch (error) {
    return { entries: [], diagnostics: [`Не удалось прочитать ${OPT_ROOT}: ${error.message}`] };
  }
  const names = entries
    .filter((entry) => !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort()
    .slice(0, MAX_OPT_ENTRIES);
  if (entries.length > MAX_OPT_ENTRIES) diagnostics.push(`${OPT_ROOT}: показаны первые ${MAX_OPT_ENTRIES} записей.`);
  const inspected = [];
  for (const name of names) {
    const item = await inspectOptEntry(name);
    if (item) inspected.push(item);
  }
  return { entries: inspected, diagnostics };
}

function parseEndpoint(value) {
  const raw = String(value || "");
  const bracket = raw.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracket) return { address: bracket[1], port: Number(bracket[2]) };
  const match = raw.match(/^(.*):(\d+)$/);
  if (!match) return { address: raw, port: null };
  return { address: match[1] || "*", port: Number(match[2]) };
}

export function parseSsOutput(text) {
  const ports = [];
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    if (fields.length < 4) continue;
    const localIndex = fields[0] === "LISTEN" ? 3 : 2;
    const local = fields[localIndex];
    const endpoint = parseEndpoint(local);
    if (!Number.isInteger(endpoint.port)) continue;
    const processText = fields.slice(localIndex + 2).join(" ");
    const processMatch = processText.match(/\(\("([^"]+)"[^)]*pid=(\d+)/);
    ports.push({
      protocol: "tcp",
      address: endpoint.address,
      port: endpoint.port,
      process: processMatch?.[1] || null,
      pid: processMatch ? Number(processMatch[2]) : null,
      raw: line.slice(0, 600)
    });
  }
  return ports;
}

export async function scanListeningPorts() {
  let result = await execOptional("ss", ["-H", "-ltnp"]);
  if (!result.ok) result = await execOptional("ss", ["-H", "-ltn"]);
  if (!result.ok) {
    return { ports: [], diagnostics: [`Не удалось выполнить ss: ${result.stderr || "команда недоступна"}`] };
  }
  return { ports: parseSsOutput(result.stdout), diagnostics: [] };
}

function parseSystemctlProperties(text) {
  const result = {};
  for (const line of String(text || "").split(/\r?\n/)) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

async function inspectUnit(name) {
  const query = await execOptional("systemctl", [
    "show", name, "--no-pager",
    "--property=Id,LoadState,ActiveState,SubState,UnitFileState,MainPID,FragmentPath,ExecStart,WorkingDirectory"
  ]);
  const values = parseSystemctlProperties(query.stdout);
  return {
    name,
    loaded: values.LoadState === "loaded",
    active: values.ActiveState === "active",
    subState: values.SubState || null,
    enabled: ["enabled", "enabled-runtime", "static", "indirect"].includes(values.UnitFileState),
    unitFileState: values.UnitFileState || null,
    mainPid: Number(values.MainPID || 0) || null,
    fragmentPath: values.FragmentPath || null,
    execStart: values.ExecStart || null,
    workingDirectory: values.WorkingDirectory || null,
    error: query.ok ? null : query.stderr || null
  };
}

export async function scanSystemd() {
  const names = new Set(["project-control.service", "project-control-executor.service"]);
  for (const adapter of Object.values(ADAPTERS)) {
    for (const service of [...adapter.requiredServices, ...adapter.optionalServices]) names.add(service);
  }
  const units = [];
  for (const name of [...names].sort()) units.push(await inspectUnit(name));

  const listed = await execOptional("systemctl", ["list-units", "--type=service", "--all", "--no-legend", "--no-pager"]);
  const extra = [];
  if (listed.ok) {
    for (const line of listed.stdout.split(/\r?\n/)) {
      const unit = line.trim().split(/\s+/)[0];
      if (!unit || names.has(unit)) continue;
      if (/(docom|planner|planer|kafedra|f2re|project-control)/i.test(unit)) extra.push(unit);
      if (extra.length >= 32) break;
    }
  }
  for (const name of extra) units.push(await inspectUnit(name));
  return { units, diagnostics: listed.ok ? [] : [`systemctl list-units: ${listed.stderr || "ошибка"}`] };
}

export function parseSize(value) {
  const match = String(value || "").trim().match(/^(\d+)([kKmMgG])?$/);
  if (!match) return null;
  const multiplier = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[String(match[2] || "").toLowerCase()] || 1;
  return Number(match[1]) * multiplier;
}

function proxyTarget(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^https?:\/\/([^/:;]+|\[[^\]]+\])(?::(\d+))?([^;]*)$/i);
  if (!match) return { upstreamHost: null, upstreamPort: null };
  return {
    upstreamHost: match[1].replace(/^\[|\]$/g, ""),
    upstreamPort: match[2] ? Number(match[2]) : (raw.startsWith("https://") ? 443 : 80)
  };
}

export function parseNginxText(text, file = "nginx.conf") {
  const routes = [];
  const limits = [];
  let serverNames = [];
  let listens = [];
  let location = "/";
  let latestLimit = null;
  let lineNumber = 0;
  for (const raw of String(text || "").split(/\r?\n/)) {
    lineNumber += 1;
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line) continue;
    const server = line.match(/^server_name\s+([^;]+);/);
    if (server) serverNames = server[1].trim().split(/\s+/).filter(Boolean);
    const listen = line.match(/^listen\s+([^;]+);/);
    if (listen) listens = [...new Set([...listens, listen[1].trim()])].slice(-8);
    const loc = line.match(/^location\s+(?:[=~^*]+\s+)?([^\s{]+)\s*\{/);
    if (loc) location = loc[1];
    const size = line.match(/^client_max_body_size\s+([^;]+);/);
    if (size) {
      latestLimit = { value: size[1].trim(), bytes: parseSize(size[1]), line: lineNumber };
      limits.push({ file, ...latestLimit });
    }
    const proxy = line.match(/^proxy_pass\s+([^;]+);/);
    if (proxy) {
      routes.push({
        file,
        line: lineNumber,
        serverNames: [...serverNames],
        listens: [...listens],
        location,
        proxyPass: proxy[1].trim(),
        clientMaxBodySize: latestLimit?.value || null,
        clientMaxBodyBytes: latestLimit?.bytes ?? null,
        ...proxyTarget(proxy[1])
      });
    }
  }
  return { routes, limits };
}

async function collectNginxFiles() {
  const files = [];
  async function walk(directory, depth) {
    if (files.length >= MAX_NGINX_FILES || depth > 3) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= MAX_NGINX_FILES) break;
      if (entry.name.startsWith(".")) continue;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(target, depth + 1);
      else if (entry.isFile() || entry.isSymbolicLink()) files.push(target);
    }
  }
  try {
    const stat = await fs.stat(NGINX_ROOT);
    if (!stat.isDirectory()) return [];
  } catch { return []; }
  await walk(NGINX_ROOT, 0);
  return files;
}

export async function scanNginx() {
  const diagnostics = [];
  const routes = [];
  const limits = [];
  const files = await collectNginxFiles();
  let totalBytes = 0;
  let parsedFiles = 0;
  for (const file of files) {
    if (totalBytes >= MAX_NGINX_TOTAL_BYTES) break;
    let stat;
    try { stat = await fs.stat(file); } catch { continue; }
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_NGINX_FILE_BYTES) continue;
    let text;
    try { text = await fs.readFile(file, "utf8"); } catch (error) {
      if (error?.code !== "EACCES") diagnostics.push(`${file}: ${error.message}`);
      continue;
    }
    totalBytes += Buffer.byteLength(text);
    parsedFiles += 1;
    const parsed = parseNginxText(text, file);
    routes.push(...parsed.routes);
    limits.push(...parsed.limits);
  }
  if (files.length >= MAX_NGINX_FILES) diagnostics.push(`nginx: достигнут лимит ${MAX_NGINX_FILES} файлов.`);
  return { present: files.length > 0, parsedFiles, routes, limits, diagnostics };
}

function standardRoot(adapter) {
  return path.dirname(adapter.currentPath);
}

function optMatches(adapter, optEntries) {
  const root = standardRoot(adapter);
  const direct = optEntries.find((entry) => entry.path === root || entry.realPath === root);
  if (direct) return [direct, ...optEntries.filter((entry) => entry !== direct && entry.projectHint === adapter.id)];
  return optEntries.filter((entry) => entry.projectHint === adapter.id);
}

function portConflictMap(projects) {
  const map = new Map();
  for (const project of projects) {
    if (!Number.isInteger(project.configuredPort)) continue;
    const list = map.get(project.configuredPort) || [];
    list.push(project.id);
    map.set(project.configuredPort, list);
  }
  return map;
}

export async function discoverHost() {
  const startedAt = Date.now();
  const [opt, sockets, systemd, nginx] = await Promise.all([
    scanOpt(), scanListeningPorts(), scanSystemd(), scanNginx()
  ]);

  const projects = [];
  for (const adapter of Object.values(ADAPTERS)) {
    const matches = optMatches(adapter, opt.entries);
    const primary = matches[0] || null;
    const configuredRaw = await readEnvValue(adapter.configFile, adapter.portKey).catch(() => null);
    const configuredPort = /^\d+$/.test(String(configuredRaw || "")) ? Number(configuredRaw) : adapter.defaultPort;
    const services = systemd.units.filter((unit) => [...adapter.requiredServices, ...adapter.optionalServices].includes(unit.name));
    const listeners = sockets.ports.filter((item) => item.port === configuredPort);
    const proxyRoutes = nginx.routes.filter((route) => route.upstreamPort === configuredPort);
    const standard = primary && (primary.path === standardRoot(adapter) || primary.realPath === standardRoot(adapter));
    const detected = Boolean(primary || services.some((service) => service.loaded || service.active) || listeners.length || proxyRoutes.length);
    const warnings = [];
    if (primary && !standard) warnings.push(`Обнаружен каталог ${primary.path}, но штатный путь адаптера — ${standardRoot(adapter)}.`);
    if (services.some((service) => service.active) && listeners.length === 0) warnings.push(`Служба активна, но порт ${configuredPort} не найден среди LISTEN.`);
    if (proxyRoutes.length && listeners.length === 0) warnings.push(`nginx проксирует на ${configuredPort}, но этот порт сейчас не слушается.`);
    if (proxyRoutes.some((route) => route.clientMaxBodyBytes && route.clientMaxBodyBytes < 2 * 1024 * 1024)) {
      warnings.push("nginx ограничивает размер запроса; UI будет использовать chunked upload по 512 КиБ.");
    }
    projects.push({
      id: adapter.id,
      displayName: adapter.displayName,
      detected,
      standardInstallation: Boolean(standard),
      detectedPath: primary?.path || null,
      detectedRealPath: primary?.realPath || null,
      detectedCurrentTarget: primary?.currentTarget || null,
      detectedVersion: primary?.version || null,
      detectedVersionFile: primary?.versionFile || null,
      configuredPort,
      configFile: adapter.configFile,
      portKey: adapter.portKey,
      listeners,
      services,
      nginxRoutes: proxyRoutes,
      evidence: {
        opt: matches,
        systemd: services.filter((service) => service.loaded || service.active).map((service) => service.name),
        ports: listeners.map((listener) => listener.port),
        nginx: proxyRoutes.map((route) => route.proxyPass)
      },
      warnings
    });
  }

  const conflicts = portConflictMap(projects);
  for (const project of projects) {
    const users = conflicts.get(project.configuredPort) || [];
    if (users.length > 1) project.warnings.push(`Порт ${project.configuredPort} заявлен несколькими проектами: ${users.join(", ")}.`);
  }

  const matchedPaths = new Set(projects.flatMap((project) => (project.evidence.opt || []).map((entry) => entry.path)));
  const unknownOpt = opt.entries.filter((entry) => !matchedPaths.has(entry.path) && (entry.version || entry.currentExists || projectHintForPath(entry.path)));
  const diagnostics = [...opt.diagnostics, ...sockets.diagnostics, ...systemd.diagnostics, ...nginx.diagnostics];

  return {
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    roots: { opt: OPT_ROOT, nginx: NGINX_ROOT },
    projects,
    listeningPorts: sockets.ports,
    nginx,
    systemd: { units: systemd.units },
    opt: { entries: opt.entries, unknown: unknownOpt },
    diagnostics
  };
}

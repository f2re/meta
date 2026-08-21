import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

import { ADAPTERS } from "./adapters.mjs";

export const DATA_ROOT = process.env.PROJECT_CONTROL_DATA_DIR || "/var/lib/project-control";
export const INCOMING_DIR = path.join(DATA_ROOT, "incoming");
export const STAGING_DIR = path.join(DATA_ROOT, "staging");
export const LOG_DIR = path.join(DATA_ROOT, "logs");
export const HISTORY_FILE = path.join(DATA_ROOT, "history.json");
export const SOCKET_PATH = process.env.PROJECT_CONTROL_EXECUTOR_SOCKET || "/run/project-control/executor.sock";

export function operationId() {
  return `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomUUID()}`;
}

export async function ensureDataDirs() {
  await Promise.all([
    fs.mkdir(INCOMING_DIR, { recursive: true, mode: 0o750 }),
    fs.mkdir(STAGING_DIR, { recursive: true, mode: 0o750 }),
    fs.mkdir(LOG_DIR, { recursive: true, mode: 0o750 })
  ]);
}

export function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export async function readEnvValue(filePath, key) {
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || match[1] !== key) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return null;
}

export async function httpHealth(port, requestPath, timeoutMs = 4000) {
  return await new Promise((resolve) => {
    const request = http.get({ host: "127.0.0.1", port, path: requestPath, timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        if (body.length < 64 * 1024) body += chunk;
      });
      response.on("end", () => {
        const ok = response.statusCode >= 200 && response.statusCode < 300;
        resolve({ ok, statusCode: response.statusCode, body: body.slice(0, 4096) });
      });
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", (error) => resolve({ ok: false, error: error.message }));
  });
}

async function detectedInstallationRecords(history) {
  const projectsWithSuccessfulHistory = new Set(
    history.filter((entry) => entry?.status === "success" && typeof entry.projectId === "string")
      .map((entry) => entry.projectId)
  );
  const detected = [];
  for (const adapter of Object.values(ADAPTERS)) {
    if (projectsWithSuccessfulHistory.has(adapter.id)) continue;
    try {
      const currentStat = await fs.lstat(adapter.currentPath);
      const release = await fs.realpath(adapter.currentPath);
      const version = (await fs.readFile(path.join(release, adapter.versionFile), "utf8")).trim();
      if (!version) continue;
      const observedAt = currentStat.mtime.toISOString();
      detected.push({
        operationId: `detected-${adapter.id}-${Math.trunc(currentStat.mtimeMs)}`,
        projectId: adapter.id,
        displayName: adapter.displayName,
        status: "success",
        action: "install",
        fromVersion: null,
        toVersion: version,
        startedAt: observedAt,
        finishedAt: observedAt,
        detected: true
      });
    } catch {
      // Detection is best-effort. Normal project status reports real read/health errors.
    }
  }
  return [...history, ...detected].sort((left, right) =>
    String(right?.finishedAt || "").localeCompare(String(left?.finishedAt || ""))
  );
}

export async function readHistory() {
  let history = [];
  try {
    const parsed = JSON.parse(await fs.readFile(HISTORY_FILE, "utf8"));
    history = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return await detectedInstallationRecords(history);
}

export async function appendHistory(entry) {
  const history = await readHistory();
  history.unshift(entry);
  const limited = history.slice(0, 500);
  const temporary = `${HISTORY_FILE}.tmp.${process.pid}`;
  await fs.writeFile(temporary, `${JSON.stringify(limited, null, 2)}\n`, { mode: 0o640 });
  await fs.rename(temporary, HISTORY_FILE);
}

export function jsonResponse(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": payload.length,
    "cache-control": "no-store"
  });
  response.end(payload);
}

export async function readJsonBody(request, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Слишком большой JSON-запрос."), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Некорректный JSON."), { statusCode: 400 });
  }
}

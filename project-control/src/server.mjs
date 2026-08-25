import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream, createWriteStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ADAPTERS } from "./adapters.mjs";
import { INCOMING_DIR, SOCKET_PATH, ensureDataDirs, jsonResponse, readJsonBody } from "./common.mjs";
import { discoverHost } from "./discovery.mjs";
import { normalizeRequestPath, shouldRedirectToSlash } from "./web_utils.mjs";

const VERSION = process.env.PROJECT_CONTROL_VERSION || "0.1.0";
const HOST = process.env.PROJECT_CONTROL_HOST || "0.0.0.0";
const PORT = Number(process.env.PROJECT_CONTROL_PORT || 9090);
const ACCESS_TOKEN = String(process.env.PROJECT_CONTROL_ACCESS_TOKEN || "");
const MAX_UPLOAD_BYTES = Number(process.env.PROJECT_CONTROL_MAX_UPLOAD_BYTES || 16 * 1024 * 1024 * 1024);
const CHUNK_BYTES = Math.min(512 * 1024, Number(process.env.PROJECT_CONTROL_UPLOAD_CHUNK_BYTES || 512 * 1024));
const DISCOVERY_CACHE_MS = Number(process.env.PROJECT_CONTROL_DISCOVERY_CACHE_MS || 5000);
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");
const uploadLocks = new Set();
let discoveryCache = { at: 0, value: null, promise: null };

if (!/^[0-9]{4}$/.test(ACCESS_TOKEN)) throw new Error("PROJECT_CONTROL_ACCESS_TOKEN должен быть четырёхзначным PIN-кодом.");
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("Некорректный PROJECT_CONTROL_PORT.");
if (!Number.isInteger(CHUNK_BYTES) || CHUNK_BYTES < 64 * 1024 || CHUNK_BYTES > 768 * 1024) throw new Error("PROJECT_CONTROL_UPLOAD_CHUNK_BYTES должен быть от 64 до 768 КиБ.");

function authorized(request) {
  const header = String(request.headers.authorization || "");
  if (!header.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice(7), "utf8");
  const expected = Buffer.from(ACCESS_TOKEN, "utf8");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function requireAuth(request, response) {
  if (authorized(request)) return true;
  jsonResponse(response, 401, { error: "Требуется ключ доступа Project Control." });
  return false;
}

async function executorRequest(endpoint, body = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  return await new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: SOCKET_PATH,
      path: endpoint,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": payload.length },
      timeout: 0
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => { size += chunk.length; if (size <= 4 * 1024 * 1024) chunks.push(chunk); });
      response.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
        catch { return reject(new Error("Executor вернул некорректный ответ.")); }
        if ((response.statusCode || 500) >= 400) return reject(Object.assign(new Error(parsed.error || "Ошибка executor."), { statusCode: response.statusCode || 500 }));
        resolve(parsed);
      });
    });
    request.on("error", reject);
    request.end(payload);
  });
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

async function serveStatic(request, response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`) && target !== path.join(PUBLIC_DIR, "index.html")) return false;
  let data;
  try { data = await fs.readFile(target); }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
  response.writeHead(200, {
    "content-type": contentType(target), "content-length": data.length,
    "cache-control": "no-store", pragma: "no-cache",
    "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "same-origin",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
  });
  if (request.method === "HEAD") response.end(); else response.end(data);
  return true;
}

function safeOriginalName(value) {
  const name = path.basename(String(value || "package.f2re.zip")).replace(/[^A-Za-z0-9А-Яа-яЁё._+() -]+/g, "_").slice(0, 180);
  return name || "package.f2re.zip";
}
function supportedPackageName(value) {
  const name = String(value || "").toLowerCase();
  return name.endsWith(".zip") || name.endsWith(".tar.gz") || name.endsWith(".tgz") || name.endsWith(".tar");
}
function assertSupportedPackageName(value) {
  if (!supportedPackageName(value)) {
    throw Object.assign(new Error("Нужен .f2re.zip либо native bundle .tar.gz / .tgz / .tar."), { statusCode: 400 });
  }
}
function assertProject(projectId) {
  if (!Object.hasOwn(ADAPTERS, projectId)) throw Object.assign(new Error("Неизвестный проект."), { statusCode: 404 });
}
async function sha256File(filePath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

async function receiveUpload(request) {
  const statedLength = Number(request.headers["content-length"] || 0);
  if (statedLength && statedLength > MAX_UPLOAD_BYTES) throw Object.assign(new Error("Архив превышает лимит загрузки."), { statusCode: 413 });
  const id = randomUUID();
  const temporary = path.join(INCOMING_DIR, `${id}.part`);
  const finalPath = path.join(INCOMING_DIR, `${id}.upload`);
  const output = createWriteStream(temporary, { flags: "wx", mode: 0o640 });
  const hash = createHash("sha256");
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES) throw Object.assign(new Error("Архив превышает лимит загрузки."), { statusCode: 413 });
      hash.update(chunk);
      if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
    }
    await new Promise((resolve, reject) => { output.end(resolve); output.once("error", reject); });
    if (size === 0) throw Object.assign(new Error("Пустой файл обновления."), { statusCode: 400 });
    await fs.rename(temporary, finalPath);
    return { path: finalPath, size, sha256: hash.digest("hex") };
  } catch (error) {
    output.destroy();
    await fs.rm(temporary, { force: true }).catch(() => {});
    await fs.rm(finalPath, { force: true }).catch(() => {});
    throw error;
  }
}

function safeUuid(value, label = "идентификатор") {
  const id = String(value || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(id)) throw Object.assign(new Error(`Некорректный ${label}.`), { statusCode: 400 });
  return id;
}
function uploadPaths(id) {
  const safe = safeUuid(id, "идентификатор загрузки");
  return {
    meta: path.join(INCOMING_DIR, `${safe}.chunked.json`),
    part: path.join(INCOMING_DIR, `${safe}.chunked.part`),
    final: path.join(INCOMING_DIR, `${safe}.upload`),
    job: path.join(INCOMING_DIR, `${safe}.job.json`)
  };
}
async function readUploadMeta(id) {
  const paths = uploadPaths(id);
  try { return { paths, meta: JSON.parse(await fs.readFile(paths.meta, "utf8")) }; }
  catch (error) {
    if (error?.code === "ENOENT") throw Object.assign(new Error("Загрузка не найдена или уже завершена."), { statusCode: 404 });
    throw error;
  }
}
async function atomicJson(file, value) {
  const temporary = `${file}.tmp.${process.pid}.${randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value)}\n`, { encoding: "utf8", mode: 0o640 });
  await fs.rename(temporary, file);
}

async function startChunkedUpload(projectId, originalName, expectedSize) {
  assertProject(projectId);
  const fileName = safeOriginalName(originalName);
  assertSupportedPackageName(fileName);
  const size = Number(expectedSize);
  if (!Number.isInteger(size) || size < 1 || size > MAX_UPLOAD_BYTES) throw Object.assign(new Error("Некорректный размер файла обновления."), { statusCode: 400 });
  const id = randomUUID();
  const paths = uploadPaths(id);
  await fs.writeFile(paths.part, Buffer.alloc(0), { flag: "wx", mode: 0o640 });
  await atomicJson(paths.meta, { id, projectId, originalName: fileName, expectedSize: size, received: 0, nextIndex: 0, createdAt: new Date().toISOString() });
  return { uploadId: id, chunkBytes: CHUNK_BYTES, expectedSize: size };
}

async function receiveChunk(request, id) {
  const safeId = safeUuid(id, "идентификатор загрузки");
  if (uploadLocks.has(safeId)) throw Object.assign(new Error("Предыдущий блок этой загрузки ещё записывается."), { statusCode: 409 });
  uploadLocks.add(safeId);
  try {
    const { paths, meta } = await readUploadMeta(safeId);
    const index = Number(request.headers["x-chunk-index"]);
    if (!Number.isInteger(index) || index !== meta.nextIndex) throw Object.assign(new Error(`Ожидался блок ${meta.nextIndex}.`), { statusCode: 409 });
    const declared = Number(request.headers["content-length"] || 0);
    if (declared && declared > CHUNK_BYTES) throw Object.assign(new Error(`Блок превышает ${CHUNK_BYTES} байт.`), { statusCode: 413 });
    const before = meta.received;
    const output = createWriteStream(paths.part, { flags: "a", mode: 0o640 });
    let size = 0;
    try {
      for await (const chunk of request) {
        size += chunk.length;
        if (size > CHUNK_BYTES || before + size > meta.expectedSize) throw Object.assign(new Error("Блок загрузки превышает допустимый размер."), { statusCode: 413 });
        if (!output.write(chunk)) await new Promise((resolve) => output.once("drain", resolve));
      }
      await new Promise((resolve, reject) => { output.end(resolve); output.once("error", reject); });
      if (size < 1) throw Object.assign(new Error("Получен пустой блок."), { statusCode: 400 });
    } catch (error) {
      output.destroy();
      await fs.truncate(paths.part, before).catch(() => {});
      throw error;
    }
    meta.received = before + size;
    meta.nextIndex += 1;
    meta.updatedAt = new Date().toISOString();
    await atomicJson(paths.meta, meta);
    return { uploadId: safeId, received: meta.received, expectedSize: meta.expectedSize, nextIndex: meta.nextIndex, complete: meta.received === meta.expectedSize };
  } finally { uploadLocks.delete(safeId); }
}

async function abortChunkedUpload(id) {
  const { paths } = await readUploadMeta(id);
  await Promise.all([fs.rm(paths.meta, { force: true }), fs.rm(paths.part, { force: true }), fs.rm(paths.final, { force: true })]);
  return { ok: true };
}

async function runApplyJob(paths, meta, digest) {
  let job = { jobId: meta.id, projectId: meta.projectId, originalName: meta.originalName, status: "running", startedAt: new Date().toISOString(), received: meta.expectedSize };
  await atomicJson(paths.job, job);
  try {
    const result = await executorRequest("/apply", { projectId: meta.projectId, uploadPath: paths.final, originalName: meta.originalName, uploadSha256: digest, uploadSize: meta.expectedSize });
    job = { ...job, status: "success", finishedAt: new Date().toISOString(), result };
    discoveryCache.at = 0;
  } catch (error) {
    job = { ...job, status: "failed", finishedAt: new Date().toISOString(), error: error.message || String(error) };
  } finally {
    await atomicJson(paths.job, job).catch(() => {});
    await fs.rm(paths.final, { force: true }).catch(() => {});
    await fs.rm(paths.meta, { force: true }).catch(() => {});
  }
}

async function completeChunkedUpload(id) {
  const safeId = safeUuid(id, "идентификатор загрузки");
  if (uploadLocks.has(safeId)) throw Object.assign(new Error("Последний блок ещё записывается."), { statusCode: 409 });
  uploadLocks.add(safeId);
  try {
    const { paths, meta } = await readUploadMeta(safeId);
    const stat = await fs.stat(paths.part);
    if (meta.received !== meta.expectedSize || stat.size !== meta.expectedSize) throw Object.assign(new Error(`Загрузка неполная: ${meta.received}/${meta.expectedSize} байт.`), { statusCode: 409 });
    await fs.rename(paths.part, paths.final);
    const digest = await sha256File(paths.final);
    const initial = { jobId: safeId, projectId: meta.projectId, status: "queued", queuedAt: new Date().toISOString() };
    await atomicJson(paths.job, initial);
    void runApplyJob(paths, meta, digest);
    return initial;
  } finally { uploadLocks.delete(safeId); }
}
async function readJob(id) {
  const paths = uploadPaths(id);
  try { return JSON.parse(await fs.readFile(paths.job, "utf8")); }
  catch (error) {
    if (error?.code === "ENOENT") throw Object.assign(new Error("Операция обновления не найдена."), { statusCode: 404 });
    throw error;
  }
}

async function cleanupStaleUploads() {
  let entries;
  try { entries = await fs.readdir(INCOMING_DIR); } catch { return; }
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of entries) {
    if (!/^[0-9a-f-]+\.(?:chunked\.(?:json|part)|job\.json|upload|part)$/i.test(name)) continue;
    const target = path.join(INCOMING_DIR, name);
    try { const stat = await fs.stat(target); if (stat.mtimeMs < cutoff) await fs.rm(target, { force: true }); } catch {}
  }
}

async function getDiscovery(force = false) {
  const now = Date.now();
  if (!force && discoveryCache.value && now - discoveryCache.at < DISCOVERY_CACHE_MS) return discoveryCache.value;
  if (!force && discoveryCache.promise) return await discoveryCache.promise;
  const promise = discoverHost().then((value) => {
    discoveryCache = { at: Date.now(), value, promise: null };
    return value;
  }).catch((error) => { discoveryCache.promise = null; throw error; });
  discoveryCache.promise = promise;
  return await promise;
}

function discoveryServiceState(found, name) {
  const unit = found?.services?.find((service) => service.name === name);
  return { name, active: Boolean(unit?.active), enabled: Boolean(unit?.enabled) };
}
function fallbackStatus(discovery, executorError) {
  const byId = new Map(discovery.projects.map((project) => [project.id, project]));
  return {
    projects: Object.values(ADAPTERS).map((adapter) => {
      const found = byId.get(adapter.id);
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        installed: false,
        release: null,
        version: null,
        requiredServices: adapter.requiredServices.map((name) => discoveryServiceState(found, name)),
        optionalServices: adapter.optionalServices.map((name) => discoveryServiceState(found, name)),
        health: found?.health || { ok: false, error: executorError },
        healthy: false,
        lastUpdatedAt: null,
        lastOperation: null,
        lastFailure: null
      };
    }),
    operationRunning: false,
    requireSignature: null,
    history: []
  };
}
function mergeStatusWithDiscovery(status, discovery) {
  const byId = new Map(discovery.projects.map((project) => [project.id, project]));
  const projects = (status.projects || []).map((project) => {
    const found = byId.get(project.id) || null;
    return { ...project, observedVersion: project.version || found?.detectedVersion || null, detected: found?.detected || project.installed, discovery: found };
  });
  return {
    ...status,
    projects,
    discovery: {
      scannedAt: discovery.scannedAt, durationMs: discovery.durationMs, diagnostics: discovery.diagnostics,
      listeningPorts: discovery.listeningPorts, nginx: discovery.nginx, opt: discovery.opt, systemd: discovery.systemd,
      upload: { mode: "chunked-job", chunkBytes: CHUNK_BYTES, maxBytes: MAX_UPLOAD_BYTES }
    }
  };
}

async function projectsStatus(forceDiscovery = false) {
  const discovery = await getDiscovery(forceDiscovery);
  let status;
  let executorError = null;
  try { status = await executorRequest("/status"); }
  catch (error) {
    executorError = error.message || String(error);
    status = fallbackStatus(discovery, executorError);
  }
  return { ...mergeStatusWithDiscovery(status, discovery), executorError };
}

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  const originalPath = url.pathname;
  const routePath = normalizeRequestPath(originalPath);
  try {
    if ((request.method === "GET" || request.method === "HEAD") && shouldRedirectToSlash(originalPath, routePath)) {
      response.writeHead(308, { location: `${originalPath}/${url.search}` }); return response.end();
    }
    if (request.method === "GET" && routePath === "/api/ping") return jsonResponse(response, 200, { ok: true, version: VERSION, discovery: true, chunkedUpload: true, asyncJobs: true });
    if (request.method === "GET" && routePath === "/api/projects") {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 200, await projectsStatus(url.searchParams.get("rescan") === "1"));
    }
    if (request.method === "GET" && routePath === "/api/discovery") {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 200, await getDiscovery(url.searchParams.get("rescan") === "1"));
    }
    const jobMatch = routePath.match(/^\/api\/jobs\/([0-9a-f-]+)$/i);
    if (request.method === "GET" && jobMatch) {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 200, await readJob(jobMatch[1]));
    }
    const restartMatch = routePath.match(/^\/api\/projects\/([a-z0-9-]+)\/restart$/);
    if (request.method === "POST" && restartMatch) {
      if (!requireAuth(request, response)) return;
      assertProject(restartMatch[1]); discoveryCache.at = 0;
      return jsonResponse(response, 200, await executorRequest("/restart", { projectId: restartMatch[1] }));
    }
    const updateMatch = routePath.match(/^\/api\/projects\/([a-z0-9-]+)\/update$/);
    if (request.method === "POST" && updateMatch) {
      if (!requireAuth(request, response)) return;
      const projectId = updateMatch[1]; assertProject(projectId);
      const originalName = safeOriginalName(request.headers["x-file-name"]);
      try { assertSupportedPackageName(originalName); }
      catch (error) { return jsonResponse(response, error.statusCode || 400, { error: error.message }); }
      const upload = await receiveUpload(request);
      try {
        const result = await executorRequest("/apply", { projectId, uploadPath: upload.path, originalName, uploadSha256: upload.sha256, uploadSize: upload.size });
        discoveryCache.at = 0; return jsonResponse(response, 200, result);
      } finally { await fs.rm(upload.path, { force: true }).catch(() => {}); }
    }
    if (request.method === "POST" && routePath === "/api/uploads/start") {
      if (!requireAuth(request, response)) return;
      const body = await readJsonBody(request, 64 * 1024);
      return jsonResponse(response, 201, await startChunkedUpload(body.projectId, body.fileName, body.size));
    }
    const chunkMatch = routePath.match(/^\/api\/uploads\/([0-9a-f-]+)\/chunk$/i);
    if (request.method === "PUT" && chunkMatch) {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 200, await receiveChunk(request, chunkMatch[1]));
    }
    const completeMatch = routePath.match(/^\/api\/uploads\/([0-9a-f-]+)\/complete$/i);
    if (request.method === "POST" && completeMatch) {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 202, await completeChunkedUpload(completeMatch[1]));
    }
    const abortMatch = routePath.match(/^\/api\/uploads\/([0-9a-f-]+)$/i);
    if (request.method === "DELETE" && abortMatch) {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 200, await abortChunkedUpload(abortMatch[1]));
    }
    if (request.method === "POST" && routePath === "/api/session/check") {
      if (!requireAuth(request, response)) return;
      await readJsonBody(request, 1024).catch(() => ({}));
      return jsonResponse(response, 200, { ok: true, version: VERSION });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (await serveStatic(request, response, routePath)) return;
    }
    return jsonResponse(response, 404, { error: "not_found", path: routePath });
  } catch (error) {
    console.error("request failed", { path: originalPath, routePath, message: error.message });
    return jsonResponse(response, error.statusCode || 500, { error: error.message || "Внутренняя ошибка Project Control." });
  }
}

await ensureDataDirs();
await cleanupStaleUploads();
const server = http.createServer(route);
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => console.log(`Project Control ${VERSION}: http://${HOST}:${PORT}`));
const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ADAPTERS } from "./adapters.mjs";
import { INCOMING_DIR, SOCKET_PATH, ensureDataDirs, jsonResponse, readJsonBody } from "./common.mjs";

const VERSION = process.env.PROJECT_CONTROL_VERSION || "0.1.0";
const HOST = process.env.PROJECT_CONTROL_HOST || "0.0.0.0";
const PORT = Number(process.env.PROJECT_CONTROL_PORT || 9090);
const ACCESS_TOKEN = String(process.env.PROJECT_CONTROL_ACCESS_TOKEN || "");
const MAX_UPLOAD_BYTES = Number(process.env.PROJECT_CONTROL_MAX_UPLOAD_BYTES || 16 * 1024 * 1024 * 1024);
const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

if (!ACCESS_TOKEN || ACCESS_TOKEN.length < 24) {
  throw new Error("PROJECT_CONTROL_ACCESS_TOKEN должен быть задан и иметь длину не менее 24 символов.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error("Некорректный PROJECT_CONTROL_PORT.");

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
      headers: {
        "content-type": "application/json",
        "content-length": payload.length
      },
      timeout: 0
    }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size <= 4 * 1024 * 1024) chunks.push(chunk);
      });
      response.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
        } catch {
          return reject(new Error("Executor вернул некорректный ответ."));
        }
        if ((response.statusCode || 500) >= 400) {
          return reject(Object.assign(new Error(parsed.error || "Ошибка executor."), { statusCode: response.statusCode || 500 }));
        }
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

async function serveStatic(response, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  if (!/^[A-Za-z0-9._/-]+$/.test(relative) || relative.includes("..")) return false;
  const target = path.resolve(PUBLIC_DIR, relative);
  if (!target.startsWith(`${PUBLIC_DIR}${path.sep}`) && target !== path.join(PUBLIC_DIR, "index.html")) return false;
  let data;
  try {
    data = await fs.readFile(target);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  response.writeHead(200, {
    "content-type": contentType(target),
    "content-length": data.length,
    "cache-control": target.endsWith("index.html") ? "no-store" : "public, max-age=3600",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
  });
  response.end(data);
  return true;
}

function safeOriginalName(value) {
  const name = path.basename(String(value || "package.f2re.zip")).replace(/[^A-Za-z0-9А-Яа-яЁё._+() -]+/g, "_").slice(0, 180);
  return name || "package.f2re.zip";
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
    await new Promise((resolve, reject) => {
      output.end(resolve);
      output.once("error", reject);
    });
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

async function route(request, response) {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/api/ping") {
      return jsonResponse(response, 200, { ok: true, version: VERSION });
    }
    if (request.method === "GET" && url.pathname === "/api/projects") {
      if (!requireAuth(request, response)) return;
      return jsonResponse(response, 200, await executorRequest("/status"));
    }
    const restartMatch = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/restart$/);
    if (request.method === "POST" && restartMatch) {
      if (!requireAuth(request, response)) return;
      const projectId = restartMatch[1];
      if (!Object.hasOwn(ADAPTERS, projectId)) return jsonResponse(response, 404, { error: "Неизвестный проект." });
      return jsonResponse(response, 200, await executorRequest("/restart", { projectId }));
    }
    const updateMatch = url.pathname.match(/^\/api\/projects\/([a-z0-9-]+)\/update$/);
    if (request.method === "POST" && updateMatch) {
      if (!requireAuth(request, response)) return;
      const projectId = updateMatch[1];
      if (!Object.hasOwn(ADAPTERS, projectId)) return jsonResponse(response, 404, { error: "Неизвестный проект." });
      const originalName = safeOriginalName(request.headers["x-file-name"]);
      if (!originalName.toLowerCase().endsWith(".zip")) {
        return jsonResponse(response, 400, { error: "Для Project Control требуется .f2re.zip / ZIP package." });
      }
      const upload = await receiveUpload(request);
      try {
        const result = await executorRequest("/apply", {
          projectId,
          uploadPath: upload.path,
          originalName,
          uploadSha256: upload.sha256,
          uploadSize: upload.size
        });
        return jsonResponse(response, 200, result);
      } finally {
        await fs.rm(upload.path, { force: true }).catch(() => {});
      }
    }
    if (request.method === "POST" && url.pathname === "/api/session/check") {
      if (!requireAuth(request, response)) return;
      await readJsonBody(request, 1024).catch(() => ({}));
      return jsonResponse(response, 200, { ok: true });
    }
    if (request.method === "GET" || request.method === "HEAD") {
      if (await serveStatic(response, url.pathname)) return;
    }
    return jsonResponse(response, 404, { error: "not_found" });
  } catch (error) {
    console.error("request failed", { path: url.pathname, message: error.message });
    return jsonResponse(response, error.statusCode || 500, { error: error.message || "Внутренняя ошибка Project Control." });
  }
}

await ensureDataDirs();
const server = http.createServer(route);
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 5_000;
server.listen(PORT, HOST, () => {
  console.log(`Project Control ${VERSION}: http://${HOST}:${PORT}`);
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

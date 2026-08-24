import path from "node:path";

export function normalizeRequestPath(pathname) {
  const value = String(pathname || "/");
  if (value === "/") return "/";
  const apiIndex = value.indexOf("/api/");
  if (apiIndex >= 0) return value.slice(apiIndex);
  if (value.endsWith("/app.js")) return "/app.js";
  if (value.endsWith("/styles.css")) return "/styles.css";
  if (value.endsWith("/favicon.ico")) return "/favicon.ico";
  if (value.endsWith("/")) return "/";
  return value;
}

export function shouldRedirectToSlash(originalPath, normalizedPath) {
  return originalPath !== "/"
    && normalizedPath === originalPath
    && !originalPath.endsWith("/")
    && !path.posix.extname(originalPath)
    && !originalPath.includes("/api/");
}

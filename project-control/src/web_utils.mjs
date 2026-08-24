import path from "node:path";

const PREFIX_RELATIVE_ASSETS = ["app.js", "dialog-polyfill.js", "styles.css", "favicon.ico"];

export function normalizeRequestPath(pathname) {
  const value = String(pathname || "/");
  if (value === "/") return "/";
  const apiIndex = value.indexOf("/api/");
  if (apiIndex >= 0) return value.slice(apiIndex);
  for (const asset of PREFIX_RELATIVE_ASSETS) {
    if (value.endsWith(`/${asset}`)) return `/${asset}`;
  }
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

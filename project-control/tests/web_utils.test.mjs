import test from "node:test";
import assert from "node:assert/strict";

import { normalizeRequestPath, shouldRedirectToSlash } from "../src/web_utils.mjs";

test("proxy prefix is stripped for API and static assets", () => {
  assert.equal(normalizeRequestPath("/project-control/api/projects"), "/api/projects");
  assert.equal(normalizeRequestPath("/nested/meta/api/uploads/x/chunk"), "/api/uploads/x/chunk");
  assert.equal(normalizeRequestPath("/project-control/app.js"), "/app.js");
  assert.equal(normalizeRequestPath("/project-control/dialog-polyfill.js"), "/dialog-polyfill.js");
  assert.equal(normalizeRequestPath("/nested/meta/styles.css"), "/styles.css");
  assert.equal(normalizeRequestPath("/project-control/favicon.ico"), "/favicon.ico");
  assert.equal(normalizeRequestPath("/project-control/"), "/");
});

test("bare proxy prefix redirects to trailing slash", () => {
  assert.equal(shouldRedirectToSlash("/project-control", "/project-control"), true);
  assert.equal(shouldRedirectToSlash("/project-control/", "/"), false);
  assert.equal(shouldRedirectToSlash("/project-control/app.js", "/app.js"), false);
  assert.equal(shouldRedirectToSlash("/project-control/dialog-polyfill.js", "/dialog-polyfill.js"), false);
  assert.equal(shouldRedirectToSlash("/api/ping", "/api/ping"), false);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/f2re-stack.sh", import.meta.url), "utf8");
const deploySource = await readFile(new URL("../scripts/deploy-stack.sh", import.meta.url), "utf8");

test("downloaded Node runtime is passed via a dedicated variable, not command-substitution stdout", () => {
  assert.match(source, /NODE_RUNTIME_RESOLVED=""/);
  assert.match(source, /NODE_RUNTIME_RESOLVED="\$extracted"/);
  assert.doesNotMatch(source, /runtime="\$\(ensure_node_runtime\)"/);
  assert.doesNotMatch(source, /runtime=\$\(ensure_node_runtime\)/);
});

test("stack validates the resolved runtime before build", () => {
  assert.match(source, /require_node_runtime\(\)/);
  assert.match(source, /-x "\$NODE_RUNTIME_RESOLVED\/bin\/node"/);
  assert.match(source, /Node runtime:/);
});

test("prepare builds all components locally by default without Docker", () => {
  assert.match(source, /SOURCE_MODE="\$\{F2RE_STACK_SOURCE_MODE:-build\}"/);
  assert.match(source, /F2RE_NODE_VERSION:-24\.19\.0/);
  assert.match(source, /kafedra-planner: локальная runtime-offline сборка/);
  assert.match(source, /scripts\/offline\/build-bundle\.sh/);
  assert.match(source, /--native-format kafedra-runtime-offline-v1/);
  assert.doesNotMatch(source, /command -v docker|docker run|node:24-bookworm/);
});

test("deploy-stack honors a URL path prefix for ping and project status", () => {
  assert.match(deploySource, /prefix=\(url\.path or ''\)\.rstrip\('\/'\)/);
  assert.match(deploySource, /prefix \+ '\/api\/ping'/);
  assert.match(deploySource, /prefix \+ '\/api\/projects'/);
  assert.doesNotMatch(deploySource, /c\.request\('GET','\/api\/(?:ping|projects)'/);
});

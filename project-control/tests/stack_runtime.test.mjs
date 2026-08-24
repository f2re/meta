import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../scripts/f2re-stack.sh", import.meta.url), "utf8");
const deploySource = await readFile(new URL("../scripts/deploy-stack.sh", import.meta.url), "utf8");
const buildMetaSource = await readFile(new URL("../scripts/build-meta-bundle.sh", import.meta.url), "utf8");
const buildOfflineSource = await readFile(new URL("../scripts/build-offline-bundle.sh", import.meta.url), "utf8");
const compatibilitySource = await readFile(new URL("../scripts/verify-compatibility.mjs", import.meta.url), "utf8");

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

test("managed projects resolve current main by default and preserve a pinned escape hatch", () => {
  assert.match(source, /PROJECT_REF_MODE="\$\{F2RE_PROJECT_REF_MODE:-latest\}"/);
  assert.match(source, /--refs\) .*PROJECT_REF_MODE/);
  assert.match(source, /resolve_project_refs\(\)/);
  assert.match(source, /git ls-remote "\$repository" "refs\/heads\/\$branch"/);
  assert.match(source, /project\['verifiedCommit'\]=refs\[project\['projectId'\]\]/);
  assert.match(source, /managed-projects\.resolved\.json/);
  assert.match(source, /Проекты: определяем актуальные HEAD defaultBranch/);
});

test("resolved project snapshot is embedded into local meta and controller bundles", () => {
  assert.match(source, /F2RE_MANAGED_PROJECTS_FILE="\$MANAGED"/);
  assert.match(buildMetaSource, /MANAGED_PROJECTS_FILE="\$\{F2RE_MANAGED_PROJECTS_FILE:-\$ROOT\/config\/managed-projects\.json\}"/);
  assert.match(buildMetaSource, /F2RE_MANAGED_PROJECTS_FILE="\$MANAGED_PROJECTS_FILE".*verify-compatibility\.mjs/s);
  assert.match(buildOfflineSource, /cp "\$MANAGED_PROJECTS_FILE" "\$BUNDLE\/config\/managed-projects\.json"/);
  assert.match(compatibilitySource, /process\.env\.F2RE_MANAGED_PROJECTS_FILE/);
});

test("tool and package downloads use a persistent cache by default", () => {
  assert.match(source, /F2RE_STACK_CACHE_DIR/);
  assert.match(source, /DEFAULT_CACHE_BASE/);
  assert.match(source, /--cache-dir\)/);
  assert.match(source, /--no-cache\)/);
  assert.match(source, /CACHE_DIR\/node\/v\$\{NODE_VERSION\}\/linux-\$\{node_arch\}/);
  assert.match(source, /Node\.js \$NODE_VERSION: используем проверенный кеш/);
  assert.match(source, /node_archive_valid/);
  assert.match(source, /npm_config_cache="\$NPM_CACHE"/);
  assert.match(source, /PIP_CACHE_DIR="\$PIP_CACHE"/);
  assert.match(source, /KAFEDRA_RUNTIME_CACHE_DIR="\$KAFEDRA_CACHE"/);
  assert.doesNotMatch(source, /KAFEDRA_RUNTIME_CACHE_DIR="\$WORK_DIR\/kafedra-runtime-cache"/);
});

test("planner local build selects Python 3.11+ independently from generic python3", () => {
  assert.match(source, /BUILD_PYTHON_RESOLVED=""/);
  assert.match(source, /ensure_build_python\(\)/);
  assert.match(source, /F2RE_PYTHON_BIN/);
  assert.match(source, /\/usr\/bin\/python3 python3\.13 python3\.12 python3\.11 python3/);
  assert.match(source, /sys\.version_info >= \(3, 11\)/);
  assert.match(source, /Python build runtime:/);
});

test("deploy-stack honors a URL path prefix for ping and project status", () => {
  assert.match(deploySource, /prefix=\(url\.path or ''\)\.rstrip\('\/'\)/);
  assert.match(deploySource, /prefix \+ '\/api\/ping'/);
  assert.match(deploySource, /prefix \+ '\/api\/projects'/);
  assert.doesNotMatch(deploySource, /c\.request\('GET','\/api\/(?:ping|projects)'/);
});

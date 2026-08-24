#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ADAPTERS } from "../src/adapters.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, "..", "config", "managed-projects.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

function fail(message) {
  throw new Error(`Compatibility manifest: ${message}`);
}
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label} не совпадает: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

if (manifest.schema !== "f2re-managed-projects/v1") fail("неподдерживаемая schema");
if (manifest.controllerApi !== 1) fail("controllerApi должен быть 1");
if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.verifiedAt || "")) fail("verifiedAt должен быть YYYY-MM-DD");
if (!Array.isArray(manifest.projects)) fail("projects должен быть массивом");

const ids = Object.keys(ADAPTERS).sort();
const listed = manifest.projects.map((p) => p.projectId).sort();
same(listed, ids, "список projectId");
const formatPattern = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;

for (const project of manifest.projects) {
  const adapter = ADAPTERS[project.projectId];
  if (!adapter) fail(`неизвестный projectId ${project.projectId}`);
  if (!/^https:\/\/github\.com\/f2re\/[A-Za-z0-9._-]+$/.test(project.repository || "")) fail(`${project.projectId}: repository`);
  if (project.defaultBranch !== "main") fail(`${project.projectId}: defaultBranch должен быть main`);
  if (!/^[0-9a-f]{40}$/.test(project.verifiedCommit || "")) fail(`${project.projectId}: verifiedCommit должен быть полным SHA`);
  if (!formatPattern.test(project.nativeBundleFormat || "")) fail(`${project.projectId}: nativeBundleFormat`);
  const nativeFormats = project.nativeBundleFormats ?? [project.nativeBundleFormat];
  if (!Array.isArray(nativeFormats) || nativeFormats.length < 1 || nativeFormats.some((value) => !formatPattern.test(value || ""))) {
    fail(`${project.projectId}: nativeBundleFormats`);
  }
  if (!nativeFormats.includes(project.nativeBundleFormat)) fail(`${project.projectId}: nativeBundleFormats должен включать основной nativeBundleFormat`);
  if (new Set(nativeFormats).size !== nativeFormats.length) fail(`${project.projectId}: nativeBundleFormats содержит повторы`);
  if (!project.release || project.release.ci !== "github-actions" || !project.release.artifactPattern?.endsWith("-project-control.f2re.zip")) {
    fail(`${project.projectId}: release contract`);
  }
  if (!/^[A-Za-z0-9._{}+-]+$/.test(project.release.actionsArtifact || "") || !project.release.actionsArtifact.includes("{commit}")) {
    fail(`${project.projectId}: release.actionsArtifact должен содержать {commit}`);
  }

  for (const key of ["displayName", "adapter", "currentPath", "versionFile", "configFile", "portKey", "defaultPort", "healthPath"]) {
    same(project[key], adapter[key], `${project.projectId}.${key}`);
  }
  same(project.requiredServices, adapter.requiredServices, `${project.projectId}.requiredServices`);
  same(project.optionalServices, adapter.optionalServices, `${project.projectId}.optionalServices`);
  same(project.native, adapter.native, `${project.projectId}.native`);
}

console.log(`compatibility-ok: ${manifest.projects.length} projects (${listed.join(", ")})`);

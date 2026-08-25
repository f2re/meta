import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const server = await readFile(new URL("../src/server.mjs", import.meta.url), "utf8");
const executor = await readFile(new URL("../src/executor.mjs", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

test("UI and API accept wrapper ZIP and native TAR packages", () => {
  for (const source of [server, app]) {
    assert.match(source, /endsWith\("\.zip"\)/u);
    assert.match(source, /endsWith\("\.tar\.gz"\)/u);
    assert.match(source, /endsWith\("\.tgz"\)/u);
    assert.match(source, /endsWith\("\.tar"\)/u);
  }
  assert.match(html, /accept="[^"]*\.zip[^"]*\.tar\.gz[^"]*\.tgz[^"]*\.tar/u);
});

test("native TAR path keeps the signed-package security boundary", () => {
  assert.match(executor, /if \(REQUIRE_SIGNATURE\)[\s\S]*подписанный \.f2re\.zip/u);
  assert.match(executor, /nativeBundleVersion\(bundleRoot, adapter\)/u);
  assert.match(executor, /extract-native/u);
  assert.match(executor, /afterStatus\.version !== expectedVersion/u);
});

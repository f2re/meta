import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const polyfillSource = await readFile(new URL("../public/dialog-polyfill.js", import.meta.url), "utf8");
const indexSource = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

function createClassList() {
  const values = new Set();
  return {
    add(value) { values.add(value); },
    remove(value) { values.delete(value); },
    contains(value) { return values.has(value); }
  };
}

function createHarness({ nativeDialog = false } = {}) {
  const attributes = new Map();
  const dialogListeners = new Map();
  const documentListeners = new Map();
  const dialog = {
    classList: createClassList(),
    returnValue: "",
    hasAttribute(name) { return attributes.has(name); },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    addEventListener(name, listener) { dialogListeners.set(name, listener); }
  };
  const nativeShowModal = () => attributes.set("native-open", "1");
  const nativeClose = () => attributes.delete("native-open");
  if (nativeDialog) {
    dialog.showModal = nativeShowModal;
    dialog.close = nativeClose;
  }

  const body = { classList: createClassList() };
  const document = {
    body,
    getElementById(id) { return id === "keyDialog" ? dialog : null; },
    addEventListener(name, listener) { documentListeners.set(name, listener); }
  };

  vm.runInNewContext(polyfillSource, { document });
  return { dialog, body, attributes, dialogListeners, documentListeners, nativeShowModal, nativeClose };
}

test("dialog compatibility layer is loaded before the application module", () => {
  const polyfillIndex = indexSource.indexOf('src="dialog-polyfill.js"');
  const appIndex = indexSource.indexOf('src="app.js"');
  assert.ok(polyfillIndex >= 0, "dialog-polyfill.js is missing from index.html");
  assert.ok(appIndex > polyfillIndex, "dialog compatibility layer must run before app.js");
});

test("fallback supplies showModal/close for browsers without HTMLDialogElement API", () => {
  const harness = createHarness();
  assert.equal(typeof harness.dialog.showModal, "function");
  assert.equal(typeof harness.dialog.close, "function");
  assert.equal(harness.dialog.classList.contains("dialog-fallback"), true);

  harness.dialog.showModal();
  assert.equal(harness.attributes.has("open"), true);
  assert.equal(harness.attributes.get("aria-modal"), "true");
  assert.equal(harness.body.classList.contains("dialog-fallback-active"), true);

  harness.dialog.close("cancel");
  assert.equal(harness.attributes.has("open"), false);
  assert.equal(harness.body.classList.contains("dialog-fallback-active"), false);
  assert.equal(harness.dialog.returnValue, "cancel");
});

test("fallback closes on Escape without throwing", () => {
  const harness = createHarness();
  harness.dialog.showModal();
  let prevented = false;
  harness.documentListeners.get("keydown")({ key: "Escape", preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(harness.attributes.has("open"), false);
});

test("native dialog implementation is left untouched", () => {
  const harness = createHarness({ nativeDialog: true });
  assert.equal(harness.dialog.showModal, harness.nativeShowModal);
  assert.equal(harness.dialog.close, harness.nativeClose);
  assert.equal(harness.dialog.classList.contains("dialog-fallback"), false);
});

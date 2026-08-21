import test from "node:test";
import assert from "node:assert/strict";
import { ADAPTERS } from "../src/adapters.mjs";

test("root adapters are static and cover the three managed projects", () => {
  assert.deepEqual(Object.keys(ADAPTERS).sort(), ["docomator", "kafedra-planner", "planer-solving"]);
  for (const adapter of Object.values(ADAPTERS)) {
    assert.match(adapter.adapter, /^[a-z0-9-]+-v1$/);
    assert.ok(adapter.currentPath.startsWith("/opt/"));
    assert.ok(adapter.requiredServices.length >= 1);
    assert.ok(adapter.native.update.script.endsWith(".sh"));
    assert.equal(Object.hasOwn(adapter.native.update, "command"), false);
  }
});

test("known health endpoints are explicit", () => {
  assert.equal(ADAPTERS.docomator.healthPath, "/readyz");
  assert.equal(ADAPTERS["planer-solving"].healthPath, "/api/health");
  assert.equal(ADAPTERS["kafedra-planner"].healthPath, "/api/system/health");
});

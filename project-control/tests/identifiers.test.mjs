import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { UUID_V4_PATTERN, safeUuid } from "../src/identifiers.mjs";

test("randomUUID produces an accepted upload id", () => {
  const id = randomUUID();
  assert.match(id, UUID_V4_PATTERN);
  assert.equal(safeUuid(id, "идентификатор загрузки"), id);
});

test("upload id requires all RFC 4122 UUID v4 groups", () => {
  assert.throws(
    () => safeUuid("12345678-1234-4123-8123456789abcdef", "идентификатор загрузки"),
    /Некорректный идентификатор загрузки/u
  );
  assert.throws(
    () => safeUuid("12345678-1234-5123-8123-456789abcdef", "идентификатор загрузки"),
    /Некорректный идентификатор загрузки/u
  );
});

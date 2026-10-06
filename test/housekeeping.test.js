import { test } from "node:test";
import assert from "node:assert/strict";
import { idleTooLong, pathwayComplete } from "../public/js/housekeeping.js";

const DAY = 24 * 60 * 60 * 1000;

test("cleans up only after more than 5 days without use", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  assert.equal(idleTooLong(now - 4 * DAY, now), false);
  assert.equal(idleTooLong(now - 5 * DAY, now), false);
  assert.equal(idleTooLong(now - 5 * DAY - 1, now), true);
  assert.equal(idleTooLong(null, now), false); // first visit ever
  assert.equal(idleTooLong(undefined, now), false);
});

test("a pathway is complete only when every concept is mastered", () => {
  assert.equal(pathwayComplete({ concepts: [] }), false);
  assert.equal(pathwayComplete({ concepts: [{ level: 3 }, { level: 2 }] }), false);
  assert.equal(pathwayComplete({ concepts: [{ level: 3 }, { level: 3 }] }), true);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createGuard, parseAccessCodes } from "../src/guard.js";

function setup(options = {}) {
  let time = Date.parse("2026-10-06T12:00:00Z");
  const clock = { advance: (ms) => (time += ms) };
  const guard = createGuard({ codes: parseAccessCodes("alex:aaaa-bbbb,sam:cccc-dddd"), now: () => time, ...options });
  return { guard, clock };
}

test("parses named and unnamed codes", () => {
  const codes = parseAccessCodes(" alex:aaaa-bbbb , cccc-dddd,, ");
  assert.equal(codes.get("aaaa-bbbb"), "alex");
  assert.equal(codes.get("cccc-dddd"), "friend2");
  assert.equal(codes.size, 2);
});

test("only valid codes get in", () => {
  const { guard } = setup();
  assert.deepEqual(guard.checkCode("aaaa-bbbb", "1.1.1.1"), { ok: true, name: "alex" });
  assert.equal(guard.checkCode("nope", "1.1.1.1").status, 401);
  assert.equal(guard.checkCode(undefined, "1.1.1.1").status, 401);
  assert.equal(guard.checkCode("", "1.1.1.1").status, 401);
});

test("too many wrong codes locks out that address, even for a right code, then expires", () => {
  const { guard, clock } = setup();
  for (let i = 0; i < 10; i++) guard.checkCode("guess" + i, "6.6.6.6");
  assert.equal(guard.checkCode("aaaa-bbbb", "6.6.6.6").status, 429);
  assert.equal(guard.checkCode("aaaa-bbbb", "1.1.1.1").ok, true); // other addresses unaffected
  clock.advance(16 * 60 * 1000);
  assert.equal(guard.checkCode("aaaa-bbbb", "6.6.6.6").ok, true);
});

test("each friend has their own daily message limit that resets the next day", () => {
  const { guard, clock } = setup({ dailyMessagesPerCode: 2 });
  guard.recordMessage("aaaa-bbbb");
  guard.recordMessage("aaaa-bbbb");
  assert.equal(guard.canSend("aaaa-bbbb").ok, false);
  assert.equal(guard.canSend("cccc-dddd").ok, true);
  assert.equal(guard.remaining("aaaa-bbbb"), 0);
  clock.advance(24 * 60 * 60 * 1000);
  assert.equal(guard.canSend("aaaa-bbbb").ok, true);
});

// @ts-check
// A secret given is compared with the one kept by its bytes, in one place (core/hash.js `same`; s-hands, the second read
// of 11-12, F1). Three compares took two strings' lengths in characters and then compared their bytes: a character of
// more than one byte makes two strings as long in characters differ in bytes, and `timingSafeEqual` threw where the
// answer is no. A terminal's ticket was one (terminal-stream-answers.test.js); an artifact's pass and a device's code
// or token are the others.
import { test } from "node:test";
import assert from "node:assert/strict";
import { same } from "../src/core/hash.js";
import { createPasses } from "../src/http/artifacts.js";
import { createDevices } from "../src/services/devices.js";

test("two strings compared by their bytes: as long in characters and not in bytes is a no, nothing thrown", () => {
  assert.equal(same("é1", "ab"), false);
  assert.equal(same("ab", "é1"), false);
  // As long in bytes, and other bytes.
  assert.equal(same("é", "ab"), false);
  assert.equal(same("é", "é"), true);
  assert.equal(same("abc", "abc"), true);
  assert.equal(same("abc", "abd"), false);
  assert.equal(same("", ""), true);
});

// (fails before: yes — RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH]: Input buffers must have the same byte length)
test("an artifact's pass whose signature has a character of two bytes is no pass: read answers null, nothing thrown", () => {
  const passes = createPasses({ now: () => 1000 });
  const good = passes.give({ name: "notes", still: false, writes: true, who: "local", from: "127.0.0.1" });
  const [body, mac] = good.split(".");
  assert.equal(mac.length, 32);
  assert.equal(passes.read(`${body}.${"é".repeat(mac.length)}`, "127.0.0.1"), null);
  assert.equal(passes.read(`${body}.${mac.slice(0, -1)}é`, "127.0.0.1"), null);
  // The pass it gave reads as before.
  assert.deepEqual(passes.read(good, "127.0.0.1"), { name: "notes", still: false, writes: true, who: "local" });
});

// A device's code is read as its letters and digits, and its token by its sha-256 in hex, before either is compared:
// no character of two bytes reached this compare before either, so these held then too. They pin that it stays a no.
test("a device's pairing code or token with a character of two bytes is a plain no", () => {
  const devices = createDevices({ now: () => 1000 });
  const { code } = devices.startPairing();
  assert.equal(devices.claim(`${code.slice(0, -1)}É`).ok, false);
  assert.equal(devices.verify("fdt_dé"), null);
  const paired = devices.claim(code);
  assert.equal(paired.ok, true, "the code it gave pairs as before");
  assert.equal(devices.verify(/** @type {any} */ (paired).token)?.scope, "full", "and its token is known");
});

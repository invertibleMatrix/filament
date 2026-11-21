// @ts-check
// The suite's own waits (test/helpers/wait.js): every deadline `until` keeps is its own times FILAMENT_TEST_WAIT_SCALE,
// so a run on a machine busy with more than it gives each wait longer, and a run whose waits hold is no slower.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { until } from "./helpers/wait.js";

const SCALE = "FILAMENT_TEST_WAIT_SCALE";

/**
 * Run `fn` with the scale set to `value` (unset where undefined), the environment as it was after.
 * @template T @param {string | undefined} value @param {() => Promise<T>} fn @returns {Promise<T>}
 */
async function withScale(value, fn) {
  const had = process.env[SCALE];
  if (value === undefined) delete process.env[SCALE];
  else process.env[SCALE] = value;
  try {
    return await fn();
  } finally {
    if (had === undefined) delete process.env[SCALE];
    else process.env[SCALE] = had;
  }
}

/** How `until` fails on a condition that never holds: its words, and how long it waited. @param {{ timeoutMs?: number }} [o] */
async function neverHolds(o) {
  const t0 = Date.now();
  const error = await until(() => false, "nothing", o).then(
    () => null,
    (/** @type {Error} */ e) => e,
  );
  return { words: String(error?.message), waited: Date.now() - t0 };
}

describe("until's deadline and FILAMENT_TEST_WAIT_SCALE", () => {
  // (fails before: yes — the variable was not read: the wait failed after 20 ms and said so)
  test("a deadline given is multiplied by the scale, and the failure says the deadline it kept", async () => {
    const { words, waited } = await withScale("3", () => neverHolds({ timeoutMs: 20 }));
    assert.equal(words, "timed out after 60 ms waiting for nothing");
    assert.ok(waited >= 60, `waited ${waited} ms`);
  });

  // (fails before: yes — the 10 s default was kept whatever the variable said)
  test("the default deadline is multiplied too", async () => {
    const { words } = await withScale("0.002", () => neverHolds());
    assert.equal(words, "timed out after 20 ms waiting for nothing");
  });

  // (fails before: no — this pins that a run without the variable, or with one that names no number above 0, keeps each
  // deadline as the test gives it)
  test("unset, empty or not a number above 0, each deadline is the one given", async () => {
    for (const value of [undefined, "", "abc", "0", "-2", "Infinity"])
      assert.equal((await withScale(value, () => neverHolds({ timeoutMs: 20 }))).words, "timed out after 20 ms waiting for nothing", String(value));
  });

  // (fails before: no — this pins that the scale moves only the deadline: a wait whose condition holds returns then)
  test("a wait whose condition holds returns its value at once, whatever the scale", async () => {
    let checks = 0;
    const value = await withScale("1000", () => until(() => (++checks === 3 ? "held" : null), "the third check"));
    assert.deepEqual([value, checks], ["held", 3]);
  });
});

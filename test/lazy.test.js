// @ts-check
// core/lazy.js (HarnessV4_Tasks C29): a property read on first use — what a long session's rows name is opened when
// something reads it, never because the row was listed.
// (fails before: yes — there was no lazy: the archive opened every message of every turn it listed)
import { test } from "node:test";
import assert from "node:assert/strict";
import { lazy } from "../src/core/lazy.js";

test("lazy: loaded on the first read, once; listed, spread and serialized like a plain property; an assignment takes its place without loading", () => {
  let loads = 0;
  const o = lazy({ n: 1 }, "body", () => {
    loads++;
    return ["a"];
  });
  assert.deepEqual(Object.keys(o), ["n", "body"]);
  assert.equal(loads, 0, "listing its keys reads nothing");
  const first = o.body;
  assert.deepEqual(first, ["a"]);
  assert.equal(o.body, first, "the same value from then on");
  assert.equal(loads, 1);
  assert.deepEqual({ ...o }, { n: 1, body: ["a"] });
  assert.equal(loads, 1);

  const copied = { ...lazy({ n: 2 }, "body", () => `b${++loads}`) };
  assert.deepEqual([copied, loads], [{ n: 2, body: "b2" }, 2], "a spread reads it");
  assert.equal(JSON.stringify(lazy({}, "text", () => "t")), '{"text":"t"}');

  const set = lazy(/** @type {{ body?: string }} */ ({}), "body", () => `never${++loads}`);
  set.body = "mine";
  assert.deepEqual([set.body, loads, Object.getOwnPropertyDescriptor(set, "body")?.writable], ["mine", 2, true]);

  // Two on one object: each is read by itself.
  const two = lazy(lazy({}, "a", () => `a${++loads}`), "b", () => `b${++loads}`);
  assert.deepEqual([two.b, loads], ["b3", 3]);
  assert.deepEqual([two.a, loads], ["a4", 4]);
});

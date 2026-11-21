// @ts-check
// Each chat's browser as Filament tells the page (lib/browser-use.js), for the line over the box (the owner's of 11-02):
// the feed's word, one read for a chat heard nothing of, the feed's word over a read it overtook, every chat forgotten as
// the feed comes back and a read from before landing nowhere, a read that fails counting as at rest without asking again,
// and the moment a chat was last seen resting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createBrowserUse, useOf } from "../src/ui/harness/lib/browser-use.js";

/** A read on its way, answered when the test says. */
function reads() {
  /** @type {{ chain: string, ok: (x: any) => void, fail: (e: any) => void }[]} */
  const asked = [];
  return {
    asked,
    /** @param {string} chain */
    read: (chain) => new Promise((ok, fail) => asked.push({ chain, ok, fail })),
  };
}
const settle = () => new Promise((r) => setImmediate(r));
const NAV = { words: "navigate shop.test" };

// (fails before: yes — there was no lib/browser-use.js: app.js kept a map by hand, untested)
test("a chat heard nothing of is read once, the feed's word kept over a read it overtook, and each move told", async () => {
  const r = reads();
  /** @type {(string | null)[]} */
  const moved = [];
  const use = createBrowserUse({ read: r.read, onMoved: (c) => moved.push(c) });
  use.want("c1");
  use.want("c1");
  assert.equal(r.asked.length, 1, "read once");
  // The feed speaks before the read lands: its word is the newer.
  use.heard({ type: "browser", chainId: "c1", busy: { ...NAV, at: 5 }, droveAt: 5, taken: false, available: true, last: NAV });
  r.asked[0].ok({ busy: null, droveAt: null, taken: false, available: true, last: null });
  await settle();
  assert.deepEqual(use.of("c1"), { busy: { ...NAV, at: 5 }, droveAt: 5, taken: false, available: true, last: NAV });
  assert.deepEqual(moved, ["c1", "c1"]);
  use.want("c1");
  assert.equal(r.asked.length, 1, "heard of: never read again");
  use.heard({ type: "something-else", chainId: "c1" });
  use.heard({ type: "browser" });
  assert.deepEqual(moved, ["c1", "c1"], "nothing else moves it");
});

test("a read that fails counts the chat at rest, and is not asked again until the feed comes back", async () => {
  const r = reads();
  const use = createBrowserUse({ read: r.read, onMoved: () => {} });
  use.want("c1");
  r.asked[0].fail(Object.assign(new Error("busy"), { status: 503 }));
  await settle();
  assert.deepEqual(use.of("c1"), useOf({ available: true }));
  use.want("c1");
  assert.equal(r.asked.length, 1, "no read after read");
});

// (fails before: yes — the review of 11-02: a read asked before the feed came back landed in the map just cleared)
test("as the feed comes back every chat is forgotten and read anew, and a read asked before lands nowhere", async () => {
  const r = reads();
  /** @type {(string | null)[]} */
  const moved = [];
  const use = createBrowserUse({ read: r.read, onMoved: (c) => moved.push(c) });
  use.heard({ type: "browser", chainId: "c2", busy: null, droveAt: 3, taken: false, available: true, last: NAV });
  use.want("c1");
  use.heard({ type: "hello" });
  assert.equal(use.of("c2"), null, "forgotten");
  assert.deepEqual(moved, ["c2", null], "every chat moved");
  r.asked[0].ok({ busy: { ...NAV, at: 1 }, droveAt: 1, taken: false, available: true, last: NAV });
  await settle();
  assert.equal(use.of("c1"), null, "the read from before lands nowhere");
  use.want("c1");
  assert.equal(r.asked.length, 2, "read anew");
});

test("the moment a chat was last seen resting", () => {
  let t = 1_000;
  const use = createBrowserUse({ read: () => new Promise(() => {}), onMoved: () => {}, now: () => t });
  assert.equal(use.restedAt("c1"), 0, "never seen resting");
  use.rests("c1");
  t = 9_000;
  assert.equal(use.restedAt("c1"), 1_000);
  use.rests("c1");
  assert.equal(use.restedAt("c1"), 9_000);
});

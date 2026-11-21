// @ts-check
// The console's draft against the configuration as it stands (HarnessV4_Settings_Plan HS-D3, ui/lib/config-follow.js):
// a save heard on the events stream reads in quietly under a clean draft, shows the bar under an edited one (naming
// what changed), and a write of the page's own is never taken for someone else's — nor is someone else's swallowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { followConfig } from "../src/ui/lib/config-follow.js";
import { sourceOf } from "./helpers/app-lift.js";

/** The console's shell, whose functions are read from its text (it boots the whole page as it loads). */
const CONSOLE = readFileSync("src/ui/app.js", "utf8");

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };

/** A page: its draft clean or edited, the server's version, and what the follower did. */
function page({ dirty = false, server = 1 } = {}) {
  const io = {
    dirty,
    server,
    /** @type {number[]} */
    reloads: [],
    /** @type {number[]} */
    asked: [],
    /** @type {any[]} */
    bars: [],
    /** @type {(() => Promise<number | null>) | null} */
    reloadAs: null,
  };
  const follow = followConfig({
    dirty: () => io.dirty,
    reload: async () => {
      if (io.reloadAs) return io.reloadAs();
      io.reloads.push(io.server);
      return io.server;
    },
    changes: async (since) => {
      io.asked.push(since);
      return { count: io.server - since, changes: [`upstreams.zai.enabled: true → false (since ${since})`] };
    },
    bar: (said) => { io.bars.push(said); },
  });
  follow.loaded(server);
  return { io, follow };
}

// (fails before: yes — the console did not follow config-changed at all: its draft stayed old until a reload)
test("a clean draft reads a newer configuration quietly, and names it as its version", async () => {
  const { io, follow } = page();
  io.server = 3;
  follow.heard(3);
  await settle();
  assert.deepEqual(io.reloads, [3]);
  assert.equal(follow.base(), 3);
  assert.deepEqual(io.bars, [], "no bar for a draft with nothing to lose");
  follow.heard(3);
  await settle();
  assert.deepEqual(io.reloads, [3], "a version it holds is not read again");
});

// (fails before: yes — an edited draft's Save overwrote whatever had been saved since, without a word)
test("an edited draft shows the bar with what changed, keeps its version, and Keep mine takes the newer one", async () => {
  const { io, follow } = page({ dirty: true });
  io.server = 2;
  follow.heard(2);
  await settle();
  assert.deepEqual(io.reloads, [], "the edits are never replaced on their own");
  assert.deepEqual(io.asked, [1], "what changed since the draft's version is asked");
  assert.deepEqual(io.bars, [{ count: 1, changes: ["upstreams.zai.enabled: true → false (since 1)"] }]);
  assert.equal(follow.base(), 1, "its Save still names the version it was read at, so the server refuses it");
  follow.heard(2);
  await settle();
  assert.equal(io.bars.length, 1, "the same change shows the bar once");
  follow.keepMine();
  assert.equal(follow.base(), 2, "Keep mine: the next Save overwrites the change, as the bar said");
  assert.equal(io.bars.at(-1), null, "and the bar goes");
});

// (fails before: yes — the bug hunt of 10-30, SEC-8: Keep mine moved the one version a Save named, so the server took the
// draft's keys against the configuration as it stood, and a key rotated in the other window was dropped)
test("Keep mine moves the version a Save overwrites, never the one the draft was read at; the console's Save names both", async () => {
  const { io, follow } = page({ dirty: true });
  io.server = 2;
  follow.heard(2);
  await settle();
  follow.keepMine();
  assert.deepEqual([follow.base(), follow.read()], [2, 1]);
  await follow.own(async () => { io.server = 3; follow.heard(3); follow.adopt(3); }); // a narrow write of the page's own
  assert.deepEqual([follow.base(), follow.read()], [3, 1], "still read at 1");
  /** @type {string[]} */
  const paths = [];
  const state = { unreadable: ["old"] };
  const api = async (/** @type {string} */ path) => (paths.push(path), { version: 4, unreadable: ["upstreams.b.apiKey"] });
  const putConfig = new Function("configFollow", "api", "state", `${sourceOf("putConfig", CONSOLE)}\nreturn putConfig;`)(follow, api, state);
  await putConfig({});
  assert.deepEqual(paths, ["/config?base=3&read=1"]);
  assert.deepEqual([follow.base(), follow.read(), state.unreadable], [4, 4, ["upstreams.b.apiKey"]], "its answer is the configuration as of 4, and what this secret.key cannot read");
});

test("a whole save of the page's own is its version; a version heard while it is on its way waits for its answer", async () => {
  const { io, follow } = page({ dirty: true });
  await follow.own(async () => {
    io.server = 2;
    follow.heard(2); // the stream can say the save before the save's own answer arrives
    await settle();
    assert.deepEqual(io.bars, [], "not taken for someone else's while the page's write is on its way");
    follow.loaded(2);
  });
  await settle();
  assert.deepEqual([io.bars, io.reloads, follow.base()], [[], [], 2]);
});

test("a narrow write merged by hand counts only when it follows straight on: a change between still shows the bar", async () => {
  const merged = page({ dirty: true });
  await merged.follow.own(async () => { merged.io.server = 2; merged.follow.heard(2); merged.follow.adopt(2); });
  await settle();
  assert.deepEqual([merged.io.bars, merged.follow.base()], [[], 2]);

  const between = page({ dirty: true });
  between.io.server = 2;
  between.follow.heard(2); // someone else's save…
  await settle();
  assert.equal(between.io.bars.length, 1);
  await between.follow.own(async () => { between.io.server = 3; between.follow.heard(3); between.follow.adopt(3); }); // …then the page's own
  await settle();
  assert.equal(between.follow.base(), 1, "the draft never held version 2: its Save is still refused");
  assert.equal(between.io.bars.length, 2, "the bar names the newer state");
});

test("a Save the server refused shows the bar with what its answer says changed", () => {
  const { io, follow } = page({ dirty: true });
  follow.refused({ version: 4, count: 2, changes: ["a: 1 → 2", "b: x → y"] });
  assert.deepEqual(io.bars, [{ count: 2, changes: ["a: 1 → 2", "b: x → y"] }]);
  follow.keepMine();
  assert.equal(follow.base(), 4);
});

test("Discard (or a sheet closed) with a newer version waiting reads it in, and the bar goes", async () => {
  const { io, follow } = page({ dirty: true });
  io.server = 2;
  follow.heard(2);
  await settle();
  assert.equal(io.bars.length, 1);
  follow.settled();
  assert.equal(io.bars.length, 1, "still edited: nothing happens");
  io.dirty = false;
  follow.settled();
  await settle();
  assert.equal(io.bars.at(-1), null);
  assert.deepEqual([io.reloads, follow.base()], [[2], 2]);
});

test("an edit that began while the configuration was read keeps the draft and shows the bar instead", async () => {
  const { io, follow } = page();
  io.server = 2;
  io.reloadAs = async () => { io.dirty = true; return null; };
  follow.heard(2);
  await settle();
  assert.equal(follow.base(), 1);
  assert.equal(io.bars.length, 1);
});

test("a read that fails (Filament restarting) stops there: no bar, no loop, the next version heard asks again", async () => {
  const { io, follow } = page();
  let tries = 0;
  io.reloadAs = async () => { tries++; throw new Error("ECONNREFUSED"); };
  follow.heard(2);
  await settle();
  assert.deepEqual([tries, io.bars.length, follow.base()], [1, 0, 1]);
  io.reloadAs = null;
  io.server = 3;
  follow.heard(3);
  await settle();
  assert.equal(follow.base(), 3);
});

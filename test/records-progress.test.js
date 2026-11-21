// The request log's word of a streaming call (`progress`): throttled to one event a second, and what a throttled call
// held back is said when that second ends. Before HarnessV4_Tasks U3-5's look the throttle only dropped: a stream that
// stalled right after a held-back call left its last figures unsaid for as long as it stalled — a compaction's row read
// "≈248 tokens written" over a summary that had 330, and counted its silence from a second too early.
import { test } from "node:test";
import assert from "node:assert/strict";
import { UsageStore } from "../src/services/records.js";

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

// (fails before: yes — the second call's figures were never said, and no event told how long the output had been quiet)
test("a call's progress held back by the throttle is said when its second ends, with how long its output has been quiet; never after its end", async () => {
  const u = new UsageStore({ dataDir: ".", options: { logFile: "", keepLastRequests: 5 } });
  /** @type {any[]} */
  const said = [];
  u.on("event", (/** @type {any} */ e) => said.push({ type: e.type, id: e.record?.id, chars: e.record?.liveOutChars, quietMs: e.quietMs }));
  const stalls = u.start({ model: "m" });
  const ends = u.start({ model: "m" });
  for (const r of [stalls, ends]) {
    u.firstByte(r);
    u.progress(r, { outChars: 100 });
    u.progress(r, { outChars: 220 });
    u.progress(r, { outChars: 330 });
  }
  const of = (/** @type {any} */ r) => said.filter((e) => e.id === r.id && e.type === "progress");
  assert.deepEqual(of(stalls).map((e) => [e.chars, e.quietMs]), [[100, 0]], "one event at once: the second's others wait");
  u.finish(ends, { status: "ok", httpStatus: 200, tokens: { input: 1, output: 2 } }, {});
  await sleep(1150);
  const mine = of(stalls);
  assert.deepEqual(mine.map((e) => e.chars), [100, 330], "the newest figures, once");
  assert.ok(mine[1].quietMs >= 900 && mine[1].quietMs < 2500, `how long ago the output last grew: ${mine[1].quietMs}`);
  assert.deepEqual(of(ends).map((e) => e.chars), [100], "a finished call says no progress after its end");
  assert.ok(!Object.keys(u.publicRecord(stalls)).some((k) => k[0] === "_"), "working fields never leave the process");
  // A stream that flows is still one event a second: the word after a held-back one waits for its own second's end…
  u.progress(stalls, { outChars: 400 });
  assert.equal(of(stalls).length, 2);
  u.finish(stalls, { status: "ok", httpStatus: 200, tokens: { input: 1, output: 2 } }, {});
  await sleep(1100);
  assert.equal(of(stalls).length, 2, "…and is dropped with the call's end");
});

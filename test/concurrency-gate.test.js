// W7: a ceiling of 1 serializes two acquires; a second model still runs in parallel. The gate asks its ceiling as a
// function (HarnessV3-AtHome AH-F5); the ceiling a 429 teaches is slot-waits.test.js's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ConcurrencyGate } from "../src/resilience.js";
import { HealthBoard } from "../src/resilience.js";

const one = () => ({ cap: 1, liftsAt: null });

test("ConcurrencyGate: limit 1 serializes; another model is a separate lane", async () => {
  const g = new ConcurrencyGate();
  const a = await g.acquire("u", "cheap-1", one);
  assert.equal(a.queued, false);
  let secondGot = false;
  const p = Promise.resolve(g.acquire("u", "cheap-1", one)).then((s) => { secondGot = true; return s; });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(secondGot, false, "the second wait is queued behind the first");
  const other = await g.acquire("u", "other-1", one);
  assert.equal(other.queued, false, "a different model is its own lane");
  other.release();
  a.release();
  const b = await p;
  assert.equal(secondGot, true);
  assert.ok(b.waitedMs >= 20);
  b.release();
});

// (fails before: yes — a wait for a slot failed after 120 s: "waited 120000 ms for a slot for cheap-1 at u" —
// HarnessV3-FailurePoints §4 A)
test("ConcurrencyGate: a wait for a slot has no deadline; its signal ends it", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const g = new ConcurrencyGate();
  const a = await g.acquire("u", "cheap-1", one);
  let settled = false;
  const p = Promise.resolve(g.acquire("u", "cheap-1", one)).finally(() => (settled = true));
  t.mock.timers.tick(10 * 60_000);
  await new Promise((r) => setImmediate(r));
  assert.equal(settled, false, "ten minutes queued, still waiting");
  a.release();
  const b = await p;
  assert.equal(b.queued, true);
  const stop = new AbortController();
  const q = Promise.resolve(g.acquire("u", "cheap-1", one, { signal: stop.signal }));
  stop.abort();
  await assert.rejects(q, /aborted while waiting for a concurrency slot/);
  b.release();
});

test("HealthBoard: the rate-limit headers are a ceiling; success clears Retry-After", () => {
  const b = new HealthBoard();
  b.recordMeta("v", { "anthropic-ratelimit-requests-limit": "5", "anthropic-ratelimit-requests-remaining": "4" });
  assert.deepEqual(b.observedCeiling("v", "any-model"), { cap: 5, from: "headers" }, "header alone is the observed ceiling");
  b.recordMeta("u", { "retry-after": "12" });
  assert.equal(b.state.get("u").retryAfter, 12);
  b.recordSuccess("u");
  assert.equal(b.state.get("u").retryAfter, null);
  b.reset("u");
  assert.equal(b.state.get("u").retryAfter, null);
});

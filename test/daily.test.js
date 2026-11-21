import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailyUsage, localDay, computeTps, isMemoryRecord } from "../src/daily.js";
import { UsageStore } from "../src/services/records.js";

test("daily usage: buckets by local day and (upstream, model), derives averages, persists and reloads", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-daily-"));
  const d = new DailyUsage({ dataDir: dir });
  const ts = new Date().toISOString();
  d.add({ ts, status: "ok", model: "claude-opus-5-xhigh", upstream: "direct", upstreamModel: "claude-opus-5", tokens: { input: 100, cacheRead: 900, cacheWrite: 0, output: 200, thinking: 50 }, cost: 0.01, ttftMs: 800, totalMs: 5800 }); // 200 tokens over 5 s = 40 tok/s
  d.add({ ts, status: "error", model: "claude-opus-5", upstream: "direct", upstreamModel: "claude-opus-5", tokens: { input: 10, output: 0 }, cost: 0, ttftMs: null, totalMs: 300 });
  d.add({ ts, status: "ok", model: "cc/sonnet", upstream: "claude-code", upstreamModel: "sonnet", tokens: { input: 5000, cacheRead: 20000, cacheWrite: 1000, output: 800 }, cost: null, ttftMs: 1500, totalMs: 14833 }); // 800 tokens over 13.3 s after the first byte = 60 tok/s
  d.add({ ts: new Date(Date.now() - 86400000 * 3).toISOString(), status: "ok", model: "m", upstream: "u", upstreamModel: "m", tokens: { input: 1, output: 1 }, cost: 0.001, tps: 10, ttftMs: 100, totalMs: 200 });
  d.add({ ts, status: "pending", model: "x", upstream: "u" }); // in flight: not counted
  const today = localDay();
  const days = d.list(); assert.equal(days.length, 2); assert.equal(days[0].day, today, "newest first");
  const t = days[0]; assert.equal(t.requests, 3); assert.equal(t.errors, 1); assert.equal(t.input, 5110); assert.equal(t.cacheRead, 20900); assert.equal(t.output, 1000); assert.equal(t.thinking, 50);
  assert.equal(t.avgTps, 50); assert.equal(t.avgTtftMs, 1150); assert.equal(t.costN, 2); assert.equal(t.cost, 0.01);
  assert.ok(Math.abs(t.cacheHitRate - 20900 / (5110 + 20900 + 1000)) < 1e-9);
  assert.equal(t.rows.length, 2); assert.equal(t.rows[0].model, "claude-opus-5"); assert.equal(t.rows[0].upstream, "direct");
  assert.deepEqual(t.rows[0].asked.map((a) => a.name).sort(), ["claude-opus-5", "claude-opus-5-xhigh"], "the names the client used are kept");
  assert.equal(t.hours.reduce((a, b) => a + b, 0), 3);
  const agg = d.aggregate(); assert.equal(agg.days, 2); assert.equal(agg.requests, 4); assert.equal(agg.rows.length, 3);
  const only = d.aggregate({ from: today, to: today }); assert.equal(only.requests, 3); assert.equal(only.days, 1);
  const csv = d.csv({ from: today, to: today }).trim().split("\n"); assert.equal(csv.length, 3); assert.ok(csv[0].startsWith("day,upstream,model,requests"));
  assert.ok(csv.some((l) => l.startsWith(`${today},direct,claude-opus-5,2,1,1,0,110,900,0,200,50,`)), csv.join("\n"));
  await d.flush(); assert.ok(existsSync(join(dir, "daily-usage.json")), "flush settles the write, so the file is on disk");
  const again = new DailyUsage({ dataDir: dir }); assert.equal(again.list()[0].requests, 3, "reloaded from disk");
  rmSync(dir, { recursive: true, force: true });
});

test("a record added DURING an in-flight write survives a single flush", async () => {
  // The hole this pins: `flush()` captures the in-flight write's promise, and then a record arrives while that write
  // is still awaiting its I/O. Nothing asks for another save, the retry timer is unref'd, and a shutdown that has
  // already awaited flush() exits — so the record would be lost for good: each request is counted once, as it
  // finishes. This is exactly the window a request finishing during the drain lands in.
  const dir = mkdtempSync(join(tmpdir(), "filament-daily3-"));
  const ts = new Date().toISOString();
  const d = new DailyUsage({ dataDir: dir, persist: true, log: () => {} });
  d.add({ ts, status: "ok", model: "early", upstream: "u", upstreamModel: "early", tokens: { input: 1, output: 1 } });
  const inFlight = d.flush(); // starts the write; it is now suspended inside its awaits
  d.add({ ts, status: "ok", model: "LATE", upstream: "u", upstreamModel: "LATE", tokens: { input: 2, output: 2 } });
  await inFlight;             // ONE await, exactly what stop() does
  const onDisk = JSON.parse(readFileSync(join(dir, "daily-usage.json"), "utf8"));
  const models = Object.values(onDisk.days).flatMap((x) => Object.values(x.rows || {})).map((r) => r.model);
  assert.ok(models.includes("early"), `the first record is there: ${JSON.stringify(models)}`);
  assert.ok(models.includes("LATE"), `and so is the one that arrived mid-write, after a SINGLE flush: ${JSON.stringify(models)}`);
  // A reload sees both, which is the durability that actually matters.
  const again = new DailyUsage({ dataDir: dir, persist: true });
  assert.equal(again.list()[0].requests, 2, "both records survive a restart");
  rmSync(dir, { recursive: true, force: true });
});

test("a failed write re-dirties and retries rather than wedging", async () => {
  // `#writing` must never be left set: a wedged non-null value makes every later save return the same settled promise
  // and silently stop persisting, with `dirty` stuck true and nothing surfaced.
  const dir = mkdtempSync(join(tmpdir(), "filament-daily4-"));
  const ts = new Date().toISOString();
  const warns = [];
  const d = new DailyUsage({ dataDir: dir, persist: true, log: (lvl, m) => warns.push(m) });
  d.add({ ts, status: "ok", model: "a", upstream: "u", upstreamModel: "a", tokens: { input: 1, output: 1 } });
  // Point the store at an impossible path so the write fails, then put it back.
  const realDir = d.dataDir;
  d.dataDir = join(dir, "nope", "deeper", "\0invalid");
  await d.flush();
  assert.ok(warns.length > 0, `the failure was reported, not swallowed: ${JSON.stringify(warns)}`);
  assert.equal(d.dirty, true, "and the store is still dirty, so it will retry");
  d.dataDir = realDir;
  await d.flush();
  assert.ok(existsSync(join(dir, "daily-usage.json")), "the retry after a failure actually writes");
  assert.equal(d.dirty, false, "and clears the flag");
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — a missing file was rebuilt from the request log at the first start, and the memory store
// replayed the same log for its own)
test("daily usage counts each request as it finishes: a request log on disk is never replayed into it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-daily2-"));
  const ts = new Date().toISOString();
  const logged = { id: "1", ts, status: "ok", model: "a", upstream: "u", upstreamModel: "a", tokens: { input: 5, output: 5 }, cost: 0.1, ttftMs: 50, totalMs: 1000 };
  writeFileSync(join(dir, "requests.jsonl"), [JSON.stringify(logged), JSON.stringify({ ...logged, id: "2", memoryFor: { purpose: "learn" } }), ""].join("\n"));
  const store = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false } });
  try {
    assert.deepEqual(store.dailyStore.list(), [], "the general store starts empty");
    assert.deepEqual(store.memDailyStore.list(), [], "and so does memory's");
  } finally {
    await store.flush();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — HarnessV4_Tasks C26: nothing said how fast a model has been answering, so a way to make room
// could not say about how long it takes)
test("speedOf: a model's median first byte and tokens a second over its newest finished calls, by either of its names; none in the log, none said", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-speed-"));
  const ts = new Date().toISOString();
  const call = (/** @type {any} */ o) => JSON.stringify({ ts, status: "ok", model: "zai/glm", upstream: "zai", upstreamModel: "glm-5.3", tokens: { input: 5, output: 500 }, cost: 0.1, ...o });
  writeFileSync(join(dir, "requests.jsonl"), [
    call({ id: "1", ttftMs: 900, totalMs: 9000, tps: 40 }),
    call({ id: "2", ttftMs: 700, totalMs: 9000, tps: 60 }),
    call({ id: "3", ttftMs: 800, totalMs: 9000, tps: 50 }),
    call({ id: "4", status: "error", ttftMs: 5, totalMs: 10, tps: 900 }),
    call({ id: "5", ttftMs: 100, totalMs: 9000, tps: null }),
    call({ id: "6", model: "other", upstreamModel: "other", ttftMs: 100, totalMs: 9000, tps: 200 }),
    "",
  ].join("\n"));
  const store = new UsageStore({ dataDir: dir, options: { logFile: "requests.jsonl", broadcast: false } });
  try {
    assert.deepEqual(store.speedOf("zai/glm"), { ttftMs: 800, tps: 50, calls: 3 }, "the median of each; a failed call and one with no rate are not counted");
    assert.deepEqual(store.speedOf("glm-5.3"), { ttftMs: 800, tps: 50, calls: 3 }, "by the name its upstream knows it by");
    assert.deepEqual(store.speedOf("zai/glm", 1), { ttftMs: 800, tps: 50, calls: 1 }, "the newest alone");
    assert.equal(store.speedOf("nobody"), null);
    assert.equal(store.speedOf(""), null);
  } finally {
    await store.flush();
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — a file of another version was read as it was, its days and its counting-rule marker with it)
test("daily usage reads the file this build writes: version 2; a broken file, or another version's, is set aside and a new one starts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-daily5-"));
  const ts = new Date().toISOString();
  const today = localDay();
  const d = new DailyUsage({ dataDir: dir });
  d.add({ ts, status: "ok", model: "a", upstream: "u", upstreamModel: "a", tokens: { input: 1, output: 1 } });
  await d.flush();
  const written = JSON.parse(readFileSync(join(dir, "daily-usage.json"), "utf8"));
  assert.equal(written.version, 2);
  assert.deepEqual(Object.keys(written).sort(), ["days", "savedAt", "version"], "the version, when, and the days");
  // Another version's file: set aside under its version's name, said in the log, nothing of it read (r-itself, 11-12:
  // it went to the one .broken name until then, which the build that saved it never took back — test/store-files.test.js).
  writeFileSync(join(dir, "daily-usage.json"), JSON.stringify({ version: 1, split: "model-calls-v1", days: { [today]: written.days[today] } }));
  /** @type {string[]} */
  const warns = [];
  const old = new DailyUsage({ dataDir: dir, log: (_level, m) => warns.push(m) });
  assert.deepEqual(old.list(), []);
  const aside = readdirSync(dir).filter((f) => /^daily-usage\.json\.v1\.\d{8}T\d{6}Z$/.test(f));
  assert.equal(aside.length, 1, "kept beside, under its version's name");
  assert.ok(!existsSync(join(dir, "daily-usage.json.broken")) && !existsSync(join(dir, "daily-usage.json")));
  assert.match(warns.join("\n"), /^daily-usage\.json is version 1, which this Filament does not read \(it reads version 2\): another build of Filament saved it\. It is kept beside it as daily-usage\.json\.v1\.\d{8}T\d{6}Z, with nothing saved over it, and this build starts with a new usage file\./);
  rmSync(join(dir, aside[0]));
  // A broken one, likewise.
  writeFileSync(join(dir, "daily-usage.json"), "{ broken");
  const d2 = new DailyUsage({ dataDir: dir }); assert.equal(d2.list().length, 0); assert.ok(existsSync(join(dir, "daily-usage.json.broken")));
  const mem = new DailyUsage({ persist: false }); mem.add({ ts, status: "ok", model: "a", upstream: "u", tokens: { input: 1, output: 1 } }); assert.equal(mem.list()[0].requests, 1); assert.equal(mem.path, null);
  rmSync(dir, { recursive: true, force: true });
});

test("tokens per second: streamed replies are rated after the first byte, one-burst replies over the whole turn, tiny replies not at all", () => {
  assert.equal(computeTps({ tokens: { output: 400 }, ttftMs: 1000, totalMs: 11000 }), 40);
  assert.equal(computeTps({ tokens: { output: 2000 }, ttftMs: 59990, totalMs: 60000 }), 33.3, "burst at the end of a long agent turn: whole-turn rate, not 200,000 tok/s");
  assert.equal(computeTps({ tokens: { output: 5 }, ttftMs: 100, totalMs: 1000 }), null);
  assert.equal(computeTps({ tokens: { output: 500 }, ttftMs: 50, totalMs: 120 }), null, "too short to measure");
  assert.equal(computeTps({ tokens: { output: 300 }, ttftMs: null, totalMs: 3000 }), 100);
  assert.equal(computeTps({ tokens: { output: 3000 }, ttftMs: 29000, totalMs: 30000, acp: { sessionId: "s" } }), 100, "agent turn: whole-turn rate");
});

test("memory/general split: a filter keeps each store to its own records, with memory's split by purpose", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-daily-split-")); const ts = new Date().toISOString(); const today = localDay();
  const client = { id: "c1", ts, status: "ok", model: "claude-opus-5", upstream: "anthropic", upstreamModel: "claude-opus-5", tokens: { input: 100, output: 50 }, cost: 0.01, ttftMs: 200, totalMs: 900, ua: "OpenCode/1.0" };
  const learn = { id: "m1", ts, status: "ok", model: "claude-haiku-4-5", upstream: "anthropic", upstreamModel: "claude-haiku-4-5", tokens: { input: 3000, output: 1000 }, cost: 0.004, ttftMs: 300, totalMs: 9000, ua: "filament-memory/0.1", memoryFor: { purpose: "learn", chain: "ch1" } };
  const engine = { id: "m2", ts, status: "ok", model: "claude-haiku-4-5", upstream: "anthropic", upstreamModel: "claude-haiku-4-5", tokens: { input: 500, output: 100 }, cost: 0.001, totalMs: 2000, ua: "python-httpx/0.27", memoryFor: { purpose: "engine" } };
  // The route stage tags memory's own calls (its purpose header or its user agent); the tag alone says so.
  // (fails before: yes — an untagged record with memory's user agent was counted as memory's)
  const untagged = { ...client, id: "m0", ua: "filament-memory/0.1" };
  assert.equal(isMemoryRecord(client), false); assert.equal(isMemoryRecord(learn), true); assert.equal(isMemoryRecord(engine), true); assert.equal(isMemoryRecord(untagged), false);
  // The two stores, fed everything, each keep only their own.
  const general = new DailyUsage({ dataDir: dir, persist: false, filter: (r) => !isMemoryRecord(r) });
  const mem = new DailyUsage({ dataDir: dir, file: "memory-usage.json", persist: false, filter: isMemoryRecord, rowExtra: (r) => ({ purpose: r.memoryFor.purpose }) });
  for (const r of [client, learn, engine]) { general.add(r); mem.add(r); }
  assert.equal(general.aggregate().requests, 1); assert.equal(general.aggregate().cost, 0.01);
  const m = mem.aggregate(); assert.equal(m.requests, 2); assert.equal(m.cost, 0.005); assert.equal(m.input, 3500);
  assert.deepEqual(m.rows.map((r) => [r.purpose, r.requests]).sort(), [["engine", 1], ["learn", 1]], "rows split by purpose");
  const csv = mem.csv().trim().split("\n"); assert.ok(csv[0].startsWith("day,purpose,upstream,model,"), csv[0]); assert.ok(csv.some((l) => l.startsWith(`${today},engine,anthropic,claude-haiku-4-5,1,`)), csv.join("\n"));
  rmSync(dir, { recursive: true, force: true });
});

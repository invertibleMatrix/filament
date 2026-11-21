// W9: the memory engine's lifecycle as durable operations.
//
// `stderrTail` is in-RAM (last 50 lines) and `status()` is a snapshot, so a sidecar that died overnight and gave up
// after three failures left nothing durable behind — the Live tab could show in-flight engine CALLS (via engineLive())
// but there was no history of the engine itself. This file pins the producer end to end.
//
// It is a NEW file rather than an append to memory-engine.test.js on purpose: last iteration five tests appended to an
// existing file were silently reverted mid-run, and three mutation runs then scored "pass" against a file that no
// longer contained the tests they were supposed to break. A new file has no stale editor buffer to flush over it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryEngine } from "../src/memory-engine.js";
import { MemoryService } from "../src/memory-service.js";
import { WIRED_OP_KINDS, DEFAULT_OP_KINDS } from "../src/ops.js";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";

const FAKE = fileURLToPath(new URL("./fixtures/fake-sidecar.mjs", import.meta.url));

// A distinctive path so its appearance anywhere in an operation is unambiguous. The engine's `hello` carries
// `dbPath` under it, so a `#counts` that spread the status object instead of naming its fields would leak it.
let DATA_DIR;
const engine = (env = {}, opts = {}) => new MemoryEngine({
  command: process.execPath, args: [FAKE],
  env: { MNEMOSYNE_DATA_DIR: DATA_DIR, ...env },
  writeConfig: false, backoffMs: [1, 1, 1], ...opts,
});
const collect = (e) => { const seen = []; e.onOp = (title, opts) => seen.push({ title, ...(opts || {}) }); return seen; };
const settle = (ms = 250) => new Promise((r) => setTimeout(r, ms));

// Text that must never reach a durable operation: a remembered memory's content (that IS user content), the
// sidecar's own stderr lines, and the filesystem path the engine lives under.
const FORBIDDEN = () => [
  "The user edits in VS Code and runs PowerShell",
  "database is locked",
  "out of memory",
  "ZZQDISTINCTIVEPATHZZQ",
];
const assertContentFree = (seen, note = "") => {
  const flat = JSON.stringify(seen);
  for (const bad of FORBIDDEN()) assert.ok(!flat.includes(bad), `engine operations must not carry "${bad}"${note} — ops.jsonl is durable. Got: ${flat.slice(0, 400)}`);
};

before(() => { DATA_DIR = join(tmpdir(), "ZZQDISTINCTIVEPATHZZQ-engine-ops"); });
after(() => { rmSync(DATA_DIR, { recursive: true, force: true }); });

test("a healthy lifecycle reports spawn, ready and stop, with counts and no content", async () => {
  const e = engine(); const seen = collect(e);
  const hello = await e.ensure();
  assert.equal(hello.version, "fake-3.15.1", "the engine really started");

  // Real work, so `calls` in the operation is a number that means something rather than a constant zero.
  await e.remember({ content: "The user edits in VS Code and runs PowerShell", source: "environment", importance: 0.8 });
  await e.recall("which editor does the user use", { topK: 3 });
  const callsMade = e.status().calls;
  assert.ok(callsMade >= 2, `the engine counted its own calls (${callsMade})`);

  await e.stop();
  await settle(150);

  const subs = seen.map((o) => o.sub);
  assert.ok(subs.includes("spawn"), `a spawn is recorded: ${subs.join(" → ")}`);
  assert.ok(subs.includes("ready"), `a ready is recorded: ${subs.join(" → ")}`);
  assert.ok(subs.includes("stop"), `a deliberate stop is recorded: ${subs.join(" → ")}`);
  assert.ok(subs.indexOf("spawn") < subs.indexOf("ready"), "and spawn comes before ready");
  assert.ok(subs.every((o) => o !== "degraded" && o !== "failed"), `a clean run records no failure: ${subs.join(" → ")}`);

  const spawn = seen.find((o) => o.sub === "spawn");
  assert.equal(typeof spawn.detail.pid, "number", "the spawn carries the pid, which is what ties it to a process table");
  assert.equal(spawn.detail.state, "starting");
  assert.match(spawn.title, /sidecar spawned \(pid \d+\)/);

  const ready = seen.find((o) => o.sub === "ready");
  assert.equal(ready.detail.state, "ready");
  assert.equal(ready.detail.version, "fake-3.15.1", "the version it reported");
  assert.equal(ready.detail.embeddings, true);
  assert.equal(typeof ready.detail.working, "number", "and how many working memories it opened with");
  assert.equal(typeof ready.detail.handshakeMs, "number", "plus how long the handshake took — the number that explains a slow start");
  assert.equal(ready.detail.failures, 0);

  const stop = seen.find((o) => o.sub === "stop");
  assert.equal(typeof stop.detail.pid, "number", "and it still names the pid it stopped, even though the child is gone by then");
  assert.ok(stop.detail.calls >= 2, `the stop carries the lifetime call total (${stop.detail.calls}), the only durable record of how much work the sidecar did`);

  // The whole point of the contract: counts and state, never content.
  assertContentFree(seen);
  assert.ok(JSON.stringify(seen).length > 200, "and there is genuinely something to check");
});

test("failures escalate: the first is a warning, the third degrades the engine at level error", async () => {
  // FAKE_SIDECAR_FAIL_HELLO makes the child answer hello with an error and exit 3. backoffMs is [1,1,1] so the
  // retries are immediate rather than waiting out a 30 s backoff.
  const e = engine({ FAKE_SIDECAR_FAIL_HELLO: "1" }); const seen = collect(e);

  for (let i = 0; i < 3; i++) {
    await e.ensure().then(() => { throw new Error("ensure() should have failed"); }, () => {});
    await settle(120);
  }

  const failed = seen.filter((o) => o.sub === "failed");
  const degraded = seen.filter((o) => o.sub === "degraded");
  assert.equal(failed.length, 2, `the first two failures are warnings, got: ${seen.map((o) => o.sub).join(" → ")}`);
  assert.equal(degraded.length, 1, "and the third is the transition to degraded");
  assert.ok(failed.every((o) => o.level === "warn"), "a single failure is a warning: Filament will retry");
  assert.equal(degraded[0].level, "error", "giving up is an error, so the Traffic badge counts it");
  assert.equal(degraded[0].detail.failures, 3);
  assert.equal(degraded[0].detail.state, "degraded");
  assert.match(degraded[0].title, /degraded after 3 failures/, "the title says it gave up, not just that something failed");
  assert.match(failed[0].title, /failure #1/, "and each failure is numbered, so three retries are not one mystery");
  assert.ok(typeof failed[0].detail.backoffMs === "number", "each carries how long it will wait before retrying");
  assert.ok(failed[0].detail.lastError, "and the reason, truncated");
  assert.ok(failed[0].detail.lastError.length <= 160, "truncated to what is storable");

  // Every failure also records the process going away. An exit during the handshake takes a branch #failed never
  // sees, so without its own line a sidecar that dies mid-startup would vanish without a trace.
  const exits = seen.filter((o) => o.sub === "exit");
  assert.ok(exits.length >= 1, `the process exit is recorded too: ${seen.map((o) => o.sub).join(" → ")}`);
  assert.equal(exits[0].detail.wasReady, false, "it never got ready");
  assert.equal(exits[0].level, "info", "so an exit that was never a working engine is not a warning");

  assertContentFree(seen);
});

test("an unexpected exit while ready is a warning that names the calls it dropped", async () => {
  const e = engine({ FAKE_SIDECAR_CRASH_ON: "recall" }); const seen = collect(e);
  await e.ensure();
  const before = seen.length;

  // The sidecar exits 7 when the recall arrives, so the in-flight call is rejected and the engine records why.
  await e.recall("anything").then(() => {}, () => {});
  await settle(300);

  const after = seen.slice(before);
  const exit = after.find((o) => o.sub === "exit");
  assert.ok(exit, `the exit is recorded: ${after.map((o) => o.sub).join(" → ")}`);
  assert.equal(exit.level, "warn", "an engine that WAS working and then died is a warning");
  assert.equal(exit.detail.wasReady, true);
  assert.equal(exit.detail.code, 7, "the exit code survives, which is the whole point of the row");
  assert.ok(exit.detail.pendingRejected >= 1, `and how many in-flight calls it took down with it (${exit.detail.pendingRejected})`);
  assert.match(exit.title, /exited \(code 7\)/);

  const failed = after.find((o) => o.sub === "failed");
  assert.ok(failed, "the failure that follows is recorded as well");
  assert.match(failed.title, /exited unexpectedly/, "and says it was unexpected rather than a shutdown");
  assert.ok(failed.detail.lastError.includes("exited unexpectedly"), "with the reason in the detail");

  assertContentFree(seen);
});

test("stderr produces severity and counts, never the text of the line", async () => {
  const lines = "error\tdatabase is locked at ZZQDISTINCTIVEPATHZZQ/mnemosyne.db|critical\tout of memory";
  const e = engine({ FAKE_SIDECAR_STDERR: lines }); const seen = collect(e);
  await e.ensure();
  await settle(200);
  await e.stop();
  await settle(150);

  const stderr = seen.filter((o) => o.sub === "stderr");
  assert.equal(stderr.length, 2, `one operation per error/critical line, got: ${seen.map((o) => o.sub).join(" → ")}`);
  const [err, crit] = stderr;
  assert.equal(err.detail.severity, "error");
  assert.equal(err.level, "warn");
  assert.equal(crit.detail.severity, "critical");
  assert.equal(crit.level, "error", "a critical line is an error, so it reaches the badge");
  assert.ok(err.detail.stderrLines >= 1, "and how many lines the engine had written by then");
  assert.equal(typeof err.detail.state === "string" && typeof err.detail.failures === "number", true, "with the engine's state at that moment, which the plain log line does not carry");

  // The line text is deliberately NOT here. It is already durable as a `log` operation, because the handler calls
  // this.log("warn", ...) and the server records every warn; what the engine operation adds is the context. Keeping
  // the text out of this kind is what stops one stderr line becoming two copies of itself in ops.jsonl.
  assertContentFree(seen);
  const flat = JSON.stringify(stderr);
  assert.ok(!flat.includes("mnemosyne.db"), "not even the filename in the line");
});

test("a throwing recorder cannot break the engine, and no recorder at all is fine", async () => {
  const e = engine(); let calls = 0;
  e.onOp = () => { calls++; throw new Error("disk on fire"); };
  const hello = await e.ensure();
  assert.equal(hello.version, "fake-3.15.1", "the engine started normally even though every op threw");
  await e.remember({ content: "something to remember" });
  await e.stop();
  assert.ok(calls >= 2, `and the recorder was still called for each phase (${calls})`);

  const quiet = engine();
  const h2 = await quiet.ensure();
  assert.equal(h2.version, "fake-3.15.1", "an engine with observability off behaves identically");
  await quiet.stop();
});

// ------------------------------------------------------------------ the injection itself

test("the engine hook is forwarded by the service, so it survives a memory close and reopen", async () => {
  // The reason the recorder is assigned to `memory.onEngineOp` and forwarded, rather than straight to
  // `memory.store.onOp` from server.js: the engine is constructed inside start() when a memory folder is opened and
  // nulled by stop(). A direct assignment at boot attaches to null, and then to a dead object after the first reopen
  // — working in every test that never reopens memory and going silently quiet in production.
  const dir = mkdtempSync(join(tmpdir(), "filament-enginefwd-"));
  const prev = process.env.FILAMENT_MEMORY_SIDECAR;
  process.env.FILAMENT_MEMORY_SIDECAR = JSON.stringify({ command: process.execPath, args: [FAKE], env: {} });
  let memCfg = { enabled: true, folder: join(dir, "m1") };
  const svc = new MemoryService({ getConfig: () => ({ memory: memCfg }), dataDir: dir, log: () => {} });
  const seen = [];
  svc.onEngineOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  try {
    svc.start();
    assert.ok(svc.store, "memory opened, so there is an engine");
    assert.equal(typeof svc.store.onOp, "function", "and it was given a recorder at construction, by the service");
    // start() ends by calling ensure(), so the REAL sidecar spawned during that call and its own operations came
    // through the forwarder. That is stronger evidence than a synthetic call: it is the production path.
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(seen.some((o) => o.sub === "spawn"), `the real sidecar spawn reached the hook: ${seen.map((o) => o.sub).join(" > ")}`);
    const afterStart = seen.length;
    svc.store.onOp("memory engine ready: Mnemosyne fake", { sub: "ready" });
    assert.equal(seen.length, afterStart + 1, "and a direct call routes there too");

    const first = svc.store;
    memCfg = { enabled: true, folder: join(dir, "m2") }; // a different folder changes the signature, forcing a reopen
    svc.start();
    assert.ok(svc.store && svc.store !== first, "the engine was rebuilt by the reopen");
    await new Promise((r) => setTimeout(r, 600));
    const afterReopen = seen.length;
    assert.ok(afterReopen > afterStart + 1, "the rebuilt engine spawned and reported through the same hook");
    svc.store.onOp("memory engine stopped", { sub: "stop" });
    assert.equal(seen.length, afterReopen + 1, "which is what a boot-time assignment would lose entirely");
  } finally {
    try { await svc.shutdown(); } catch {}
    if (prev === undefined) delete process.env.FILAMENT_MEMORY_SIDECAR; else process.env.FILAMENT_MEMORY_SIDECAR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an engine that is not installed says so durably, instead of leaving a history that just stops", async () => {
  // Without this the System tab shows an engine history with no entries and no explanation, while the Live tab's
  // engine panel renders nothing — indistinguishable from a bug. `installed:false` is the honest third state.
  const dir = mkdtempSync(join(tmpdir(), "filament-noengine-"));
  const prev = process.env.FILAMENT_MEMORY_SIDECAR;
  delete process.env.FILAMENT_MEMORY_SIDECAR;
  const svc = new MemoryService({ getConfig: () => ({ memory: { enabled: true, folder: join(dir, "m") } }), dataDir: dir, log: () => {} });
  const seen = [];
  svc.onEngineOp = (title, opts) => seen.push({ title, ...(opts || {}) });
  try {
    svc.start();
    assert.equal(svc.store, null, "no sidecar and no managed python, so there is no engine");
    assert.equal(seen.length, 1, "and that fact is recorded once");
    assert.equal(seen[0].sub, "unavailable");
    assert.equal(seen[0].level, "warn");
    assert.equal(seen[0].detail.installed, false);
    assert.match(seen[0].title, /not installed/, "in words a person can act on");
    assert.ok(!JSON.stringify(seen).includes(dir), "without leaking the folder path");
  } finally {
    try { await svc.shutdown(); } catch {}
    if (prev !== undefined) process.env.FILAMENT_MEMORY_SIDECAR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ through the server

let app, port, dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "filament-engineops-srv-"));
  const cfg = defaultConfig();
  cfg.server.port = 0; cfg.server.inboundKeys = ["k"]; cfg.observability.logFile = "";
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } });
  port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(dataDir, { recursive: true, force: true }); });

test("the server injects the engine recorder, and calling it lands as an `engine` operation", async () => {
  assert.equal(typeof app.memory.onEngineOp, "function", "the memory service was given a recorder for engine events");
  assert.ok(WIRED_OP_KINDS.includes("engine"), "`engine` is declared wired, so its chip is not dimmed");
  assert.ok(DEFAULT_OP_KINDS.includes("engine"), "and shown by default, so the history is there on arrival");

  app.memory.onEngineOp("memory engine degraded after 3 failures: exited unexpectedly (137)", {
    sub: "degraded", level: "error",
    detail: { state: "degraded", pid: 4242, calls: 137, pending: 0, failures: 3, lastError: "exited unexpectedly (137)" },
  });
  await new Promise((r) => setTimeout(r, 80));
  const j = await (await fetch(`http://127.0.0.1:${port}/api/ops?limit=50&kinds=engine`, { headers: { "content-type": "application/json", "x-api-key": "k" } })).json();
  const op = (j.ops || []).find((o) => /degraded after 3/.test(o.title));
  assert.ok(op, `the recorded operation is retrievable: ${JSON.stringify((j.ops || []).map((o) => o.title)).slice(0, 300)}`);
  assert.equal(op.kind, "engine");
  assert.equal(op.sub, "degraded");
  assert.equal(op.level, "error");
  assert.equal(op.detail.pid, 4242);
  assert.equal(op.detail.calls, 137, "the counters survive, which is what makes the row worth having");
  assert.ok((j.wired || []).includes("engine"), "and the API tells the UI it is wired, which is what un-dims the chip");

  await app.ops.flush();
  const onDisk = existsSync(join(dataDir, "ops.jsonl")) ? readFileSync(join(dataDir, "ops.jsonl"), "utf8") : "";
  assert.ok(/"kind":"engine"/.test(onDisk), "an engine event persists, so a sidecar that died yesterday is still diagnosable");
});

test("shutdown awaits the engine's async stop, so its last operation is not lost to the flush", async () => {
  // MemoryEngine.stop() is async: it asks the sidecar to shut down and waits up to 2 s for the acknowledgement, and
  // it records the engine's final operation. The server flushes the op log immediately after memory.shutdown(), so an
  // unawaited stop meant the "memory engine stopped" event was recorded AFTER the flush and never reached ops.jsonl.
  // Found by shutting a real scratch down gracefully and finding no stop operation on disk — the last line of the
  // engine's durable history was the one that never arrived.
  const dir = mkdtempSync(join(tmpdir(), "filament-engineshutdown-"));
  const svc = new MemoryService({ getConfig: () => ({ memory: { enabled: false } }), dataDir: dir, log: () => {} });
  let stopped = false;
  svc.store = { stop: async () => { await new Promise((r) => setTimeout(r, 80)); stopped = true; } };
  try {
    const p = svc.shutdown();
    assert.equal(stopped, false, "the engine stop is async, so it cannot have finished synchronously");
    await p;
    assert.equal(stopped, true, "and shutdown() waits for it, so anything the stop records is still in time for the flush");
  } finally { rmSync(dir, { recursive: true, force: true }); }

  // The other half of the fix, and the half a unit test on the service cannot see: the server must await it BEFORE
  // flushing. Awaiting afterwards would lose exactly the same operation.
  const src = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const at = src.indexOf("await memory.shutdown()");
  const flush = src.indexOf("ops.flush?.()");
  assert.ok(at > 0, "the server awaits memory.shutdown()");
  assert.ok(flush > 0, "and flushes the op log");
  assert.ok(at < flush, "in that order — awaiting after the flush would lose the same operation");
});

test("a hello failure records the reason but never the stderr tail in the durable ops", async () => {
  // The reviewer found this: ensure() folded the last three stderr lines into the message it passed to #failed, which
  // became lastError, which #counts spreads into EVERY engine op — so one hello failure echoed a traceback into
  // ops.jsonl on every subsequent operation. No earlier test combined stderr output with a failed hello. This is the
  // exact diagnostic moment these operations exist for, so it is the one that must stay clean.
  const logs = [];
  const e = engine(
    { FAKE_SIDECAR_STDERR: "error	Traceback: the store at ZZQDISTINCTIVEPATHZZQ is corrupt", FAKE_SIDECAR_FAIL_HELLO: "1" },
    { log: (level, msg) => logs.push(String(msg)) },
  );
  const seen = collect(e);
  await e.ensure().then(() => { throw new Error("should have failed"); }, () => {});
  await settle(200);

  const failed = seen.find((o) => o.sub === "failed");
  assert.ok(failed, "the hello failure is recorded");
  assert.equal(failed.detail.lastError, "hello failed: memory engine exited (3)", "the reason the run died, and ONLY the reason");
  assert.ok(!failed.detail.lastError.includes("ZZQDISTINCTIVEPATHZZQ"), "no stderr tail in the stored error");
  assert.ok(!failed.detail.lastError.includes("Traceback"), "and no traceback");
  const flat = JSON.stringify(seen);
  assert.ok(!flat.includes("ZZQDISTINCTIVEPATHZZQ"), "the path is in NO operation, including the stderr op");
  assert.ok(!flat.includes("is corrupt"), "and the stderr text is in NO operation");
  // The tail is not lost — it goes to the server log, which is the designated text channel (and the log kind).
  assert.ok(logs.some((m) => m.includes("ZZQDISTINCTIVEPATHZZQ")), "the tail still reaches the server log");
});
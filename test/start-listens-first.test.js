// @ts-check
// Filament listens first (the 32 s start of 11-02): memory opens once the server listens, and what the last stop left —
// the run files it left open — is settled as it does. Until then the page and /api/state answer, and a request that
// reads memory waits for the open, then answers from the archive. A stop during the open waits for it and closes memory;
// a stop before it opens nothing. Memory's open reads no message (the archive's whole-table count went), and the run
// files are read at their ends, off the event loop (every run log used to be read whole).
import "./helpers/clean-env.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig } from "../src/config.js";
import { createFrontDoor } from "../src/http/front-door.js";
import { attachEventsStream } from "../src/http/events.js";
import { Archive } from "../src/services/memory/archive.js";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { CUT_AGAIN, RESUME_LINE, noteRunningAtStop, takeRunningAtStop } from "../src/app/sessions/resume-cut.js";
import { TEST_ENVIRONMENT, anthropicReply, fakeUpstream } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

const H = { "x-api-key": "k" };

/** A port nothing listens on now. @returns {Promise<number>} */
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = /** @type {net.AddressInfo} */ (s.address());
      s.close(() => resolve(port));
    });
  });

/** Whether a promise settles within `ms`. @param {Promise<unknown>} p @param {number} ms */
const settledWithin = (p, ms) => Promise.race([p.then(() => true, () => true), new Promise((r) => setTimeout(() => r(false), ms))]);

/** The first answer at a path once something listens on `url`. @param {string} url @param {string} path @returns {Promise<Response>} */
const firstAnswer = async (url, path) =>
  /** @type {Response} */ (
    await until(async () => {
      try {
        return await fetch(url + path, { headers: H });
      } catch {
        return null;
      }
    }, `${path} to answer`)
  );

/**
 * A data folder whose memory holds one chat, pinned, and a Filament made over it, not started. `seed` writes more into
 * the archive and the data folder first — a run log is read as Filament is made. `onShutdown` hears a stop asked for
 * over the API end.
 * @param {{ seed?: (a: any, chain: string, dataDir: string) => void, onShutdown?: () => void, configure?: (cfg: any) => void }} [o]
 */
async function made({ seed = () => {}, onShutdown = () => {}, configure = () => {} } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "filament-listen-first-"));
  const folder = join(dataDir, "mem");
  mkdirSync(folder, { recursive: true });
  const a = new Archive({ file: join(folder, "archive.db") });
  const chain = a.chainForKey("h:kept", { cwd: dataDir, client: "harness", model: "m-1" }).id;
  a.mergeMeta(chain, { pinned: true });
  seed(a, chain, dataDir);
  a.close();
  const port = await freePort();
  const cfg = defaultConfig();
  cfg.server.port = port;
  cfg.server.loopbackTrust = "legacy";
  cfg.server.inboundKeys = ["k"];
  cfg.observability.logFile = "";
  cfg.memory = { enabled: true, folder, autopilot: { enabled: false }, capture: { turns: true, learn: false }, privacy: { encryptArchive: false } };
  configure(cfg);
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  const app = createApp(/** @type {any} */ ({ dataDir, overrides: { port, signInOf: async () => ({ signedIn: null, identity: null }), environment: TEST_ENVIRONMENT }, onShutdown }));
  return { app, dataDir, chain, port, url: `http://127.0.0.1:${port}` };
}

/** The next start: a Filament made over a data folder an earlier one left, not started. @param {string} dataDir */
async function remade(dataDir) {
  const port = await freePort();
  return /** @type {any} */ (createApp(/** @type {any} */ ({ dataDir, overrides: { port, signInOf: async () => ({ signedIn: null, identity: null }), environment: TEST_ENVIRONMENT }, onShutdown: () => {} })));
}

/**
 * The run log's read of the files the last stop left open — part of memory's open — held until `release`, as a slow
 * disk or a long log holds it: every kind's, or `only` that kind's. @param {any} app @param {string} [only]
 */
function holdScan(app, only) {
  const g = gate();
  const scan = app.runs.openOnDisk;
  let asked = 0;
  app.runs.openOnDisk = async (/** @type {string} */ kind) => {
    if (only && kind !== only) return scan.call(app.runs, kind);
    asked++;
    await g.promise;
    return scan.call(app.runs, kind);
  };
  return {
    release: () => g.open(),
    get asked() {
      return asked;
    },
  };
}

// (fails before: yes — memory opened, and every run log was read whole, before the server listened: the owner's start
// of 11-02 answered nothing for 32 s, its page blank)
test("Filament answers its page and /api/state while memory's open is held; a session's read, a model call and the events feed wait for the open, then answer from the archive", async () => {
  const { app, dataDir, chain, port, url } = await made();
  const held = holdScan(app);
  let done = false;
  const started = app.start().then((/** @type {any} */ s) => ((done = true), s));
  const feed = new AbortController();
  try {
    const state = await firstAnswer(url, "/api/state");
    assert.equal(state.status, 200);
    await state.text();
    assert.equal(done, false, "the start has not ended: memory's open is still held");
    assert.ok(held.asked > 0, "held where memory opens: at the run files the last stop left");
    const page = await fetch(`${url}/ui/harness.html`);
    assert.deepEqual([page.status, String(page.headers.get("content-type")).split(";")[0]], [200, "text/html"], "the page");
    await page.text();
    const goal = fetch(`${url}/api/sessions/${chain}/goal`, { headers: H });
    const call = fetch(`${url}/v1/messages`, {
      method: "POST",
      headers: { ...H, "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "m-1", max_tokens: 5, messages: [{ role: "user", content: "hi" }] }),
    });
    const events = fetch(`${url}/api/events`, { headers: H, signal: feed.signal });
    assert.deepEqual(await Promise.all([goal, call, events].map((p) => settledWithin(p, 400))), [false, false, false], "a session's read, a model call and the events feed wait for memory's open");
    assert.equal(done, false);
    held.release();
    const read = await goal;
    assert.deepEqual([read.status, (await read.json()).pinned], [200, true], "and answer once it is open: the session from the archive");
    assert.ok((await call).status > 0, "the model call");
    assert.equal((await events).status, 200, "the events feed");
    assert.equal((await started).port, port);
    assert.ok(app.memory.isOpen());
  } finally {
    feed.abort();
    held.release();
    await started.catch(() => {});
    await app.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

test("a stop during memory's open waits for its end, then closes memory: the archive is let go of", async () => {
  const { app, dataDir, chain, url } = await made();
  const held = holdScan(app);
  const started = app.start();
  /** @type {Promise<void> | null} */
  let stopping = null;
  try {
    await (await firstAnswer(url, "/api/state")).text();
    await until(() => held.asked > 0, "memory's open to reach the run files");
    const waiting = fetch(`${url}/api/sessions/${chain}/goal`, { headers: H }).then((r) => r.status, () => 0);
    stopping = app.stop({ drainMs: 0 });
    assert.equal(await settledWithin(stopping, 400), false, "the stop waits for the open under way");
    assert.ok(app.memory.isOpen(), "and closes nothing under it");
    held.release();
    await stopping;
    assert.equal(app.memory.archive, null, "memory closed once the open ended");
    await started;
    await waiting;
  } finally {
    held.release();
    await (stopping ?? app.stop({ drainMs: 0 }));
    await started.catch(() => {});
  }
  // A handle left open on the archive would keep its folder from going (Windows).
  await removeDirs(dataDir);
});

test("a stop asked for once Filament listens, before memory opens, opens nothing; the start still ends", async () => {
  const { app, dataDir } = await made();
  let opens = 0;
  const open = app.memory.start;
  app.memory.start = function () {
    opens++;
    return open.call(this);
  };
  // The stop is asked for as the server listens — after its own listen callback, before memory opens a turn of the
  // loop later.
  /** @type {Promise<void> | null} */
  let stopping = null;
  const listen = http.Server.prototype.listen;
  http.Server.prototype.listen = function (/** @type {any[]} */ ...a) {
    http.Server.prototype.listen = listen;
    const out = listen.apply(this, /** @type {any} */ (a));
    this.once("listening", () => {
      stopping ??= app.stop({ drainMs: 0 });
    });
    return out;
  };
  try {
    await app.start();
  } finally {
    http.Server.prototype.listen = listen;
  }
  assert.ok(stopping, "asked for as the server listened");
  await stopping;
  assert.equal(opens, 0, "memory never opened");
  assert.equal(app.memory.archive, null);
  await removeDirs(dataDir);
});

// (fails before: yes — memory's open said its sessions through `counts()`, whose sum of every message's bytes read the
// whole messages table: 6.6 s of the owner's 2.7 GB archive, before the server listened)
test("memory's open counts the archive's chains alone: it sums no message's bytes", async () => {
  const counts = Archive.prototype.counts;
  let summed = 0;
  Archive.prototype.counts = function () {
    summed++;
    return counts.call(this);
  };
  /** @type {any} */
  let app = null;
  let dataDir = "";
  try {
    ({ app, dataDir } = await made());
    await app.start();
    assert.ok(app.memory.isOpen());
    assert.equal(summed, 0);
  } finally {
    Archive.prototype.counts = counts;
    await app?.stop({ drainMs: 0 });
    if (dataDir) await removeDirs(dataDir);
  }
});

const knobs = () => ({ observability: { runEvents: { persist: true, retentionDays: 7, maxPerRun: 1000, keepRuns: 50 } } });

// (fails before: yes — the scan read every run file of its kind whole to find its end: 586 MB parsed on the owner's 971
// run files, 2.2–3.9 s, three times over, before the server listened)
// (fails before: yes — a run with an event after its end was read whole at every start, to find the end before it)
test("the run files the last stop left are read at their ends: a whole read only where the last line is neither a run-end nor an event after one", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-run-ends-"));
  const real = fs.openSync;
  try {
    const bus = createEventBus();
    const first = createRunLog({ events: bus, dataDir: dir, config: knobs });
    const run = (/** @type {string} */ id, /** @type {string} */ kind, /** @type {number} */ rounds) => {
      first.startRun({ id, kind, meta: { chain: "c1" } });
      for (let i = 1; i <= rounds; i++) bus.publish(`run:${id}`, { type: "round-start", round: i });
    };
    run("ended", "subagent", 50);
    first.endRun("ended", { status: "done" });
    run("open", "subagent", 2);
    // An end longer than the first 4 KB read back.
    run("long-end", "subagent", 3);
    first.endRun("long-end", { status: "done", summary: { report: "x".repeat(6000) } });
    // An event after the end: a background sub-agent reporting into its parent's run.
    run("after-end", "agent-turn", 1);
    first.endRun("after-end", { status: "done" });
    bus.publish("run:after-end", { type: "steer-unread", ids: [] });
    run("torn", "subagent", 1);
    first.endRun("torn", { status: "done" });
    first.close();
    appendFileSync(join(dir, "runs", "torn.jsonl"), '{"n":99,"type":"round');

    /** @type {string[]} */
    const whole = [];
    // A whole read is the run log's index of the file (services/runs.js `indexOf`), which opens it to read it through
    // since 11-15; the ends are read through a handle of node:fs/promises.
    fs.openSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any[]} */ ...rest) => {
      if (String(p).endsWith(".jsonl") && rest[0] === "r") whole.push(basename(String(p), ".jsonl"));
      return /** @type {any} */ (real)(p, ...rest);
    });
    syncBuiltinESMExports();
    const second = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs });
    const open = await second.openOnDisk("subagent");
    assert.deepEqual(open.map((o) => [o.id, o.rounds, o.meta?.chain]), [["open", 2, "c1"]], "only the run with no end");
    assert.deepEqual(await second.openOnDisk("agent-turn"), [], "an event after its end leaves it ended");
    assert.deepEqual(whole.sort(), ["open", "torn"], "an ended run whose last line says so, or says it came after the end, is not read whole");
    assert.equal(lastEvent(join(dir, "runs", "after-end.jsonl")).afterEnd, true, "as its last line says");
    second.close();
  } finally {
    fs.openSync = real;
    syncBuiltinESMExports();
    await removeDirs(dir);
  }
});

/**
 * A turn's run log as a process that died left it: started, its events, ended only where `end` says, then the events
 * `after` its end. → its file.
 */
function leaveRun(/** @type {string} */ dataDir, /** @type {{ id: string, kind: string, chain: string, events?: any[], end?: boolean, after?: any[], meta?: any, brief?: any }} */ { id, kind, chain, events = [], end = false, after = [], meta = {}, brief = null }) {
  const bus = createEventBus();
  const log = createRunLog({ events: bus, dataDir, config: knobs });
  log.startRun({ id, kind, meta: { chain, ...meta }, ...(brief ? { brief } : {}) });
  for (const e of events) bus.publish(`run:${id}`, e);
  if (end) log.endRun(id, { status: "done" });
  for (const e of after) bus.publish(`run:${id}`, e);
  log.close();
  return join(dataDir, "runs", `${id}.jsonl`);
}
/** A file's time put back `days` days. @param {string} file @param {number} days */
const age = (file, days) => {
  const then = new Date(Date.now() - days * 86400_000);
  utimesSync(file, then, then);
};
/** A run file's last event. @param {string} file */
const lastEvent = (file) => JSON.parse(readFileSync(file, "utf8").trimEnd().split("\n").at(-1) || "null");
/** What a cut turn's run logged: a round, its words, a call. */
const WORK = [
  { type: "round-start", round: 1 },
  { type: "round-text", round: 1, text: "Editing." },
  { type: "tool-start", round: 1, id: "e1", name: "edit", args: "a.js" },
];
const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });

// (fails before: yes — the run log's start sweep raced memory's open: a run a crash left open past its retention was
// removed before the open read it, and its turn lost the only record of its work)
test("a run a crash left open, past its retention, is settled by memory's open before any sweep removes it", async () => {
  let file = "";
  const { app, dataDir, chain } = await made({
    seed: (a, c, dir) => {
      a.beginTurn(c, { requestId: "r-cut", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user("turn 1: edit a.js") });
      file = leaveRun(dir, { id: "r-cut", kind: "agent-turn", chain: c, events: WORK });
      age(file, 8);
    },
  });
  const held = holdScan(app);
  const started = app.start();
  try {
    await until(() => held.asked > 0, "memory's open to reach the run files");
    // As long as a sweep that did not wait for the open takes to remove it.
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(existsSync(file), "no sweep removed it while memory opened");
    held.release();
    await started;
    const t = app.memory.archive?.turnBodies(chain).at(-1);
    assert.deepEqual([t?.work.length, t?.meta.cut?.run], [2, "r-cut"], "its turn got the work its run logged");
    assert.equal(lastEvent(file).type, "run-end", "and its run ended, its file kept");
  } finally {
    held.release();
    await started.catch(() => {});
    await app.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

// (fails before: yes — the sweep removed every run file past its retention, a run left open with no end among them;
// and once it kept those, it kept one no start could settle for ever)
// (fails before: yes — one left open two retentions ago went though no start had gone over it, its open cut short by a
// stop; and a run with an event after its end was kept a retention more, though no start settles it)
test("the run log's sweep waits for what it is told to, and keeps a run of a kind the start settles left open until a start has gone over it; one with an event after its end is ended", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-run-sweep-"));
  try {
    const files = {
      ended: leaveRun(dir, { id: "ended", kind: "subagent", chain: "c1", events: WORK, end: true }),
      open: leaveRun(dir, { id: "open", kind: "agent-turn", chain: "c1", events: WORK }),
      other: leaveRun(dir, { id: "other", kind: "replay-compare", chain: "c1", events: WORK }),
      // An event after the end: a background sub-agent reporting into its parent's run.
      after: leaveRun(dir, { id: "after", kind: "subagent", chain: "c1", events: WORK, end: true, after: [{ type: "steer-unread", ids: [] }] }),
      old: leaveRun(dir, { id: "old", kind: "agent-turn", chain: "c1", events: WORK }),
    };
    for (const f of Object.values(files)) age(f, 8);
    // Left open two retentions ago and more.
    age(files.old, 15);
    const settles = ["subagent", "agent-turn", "coding-agent"];
    const now = () => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, existsSync(f)]));
    /** @type {(wentOver: boolean) => void} */
    let opened = () => {};
    const first = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs, sweepAfter: new Promise((r) => (opened = r)), settles });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(Object.values(files).map(existsSync), [true, true, true, true, true], "nothing removed before it is let sweep");
    // Memory's open, cut short by a stop: it went over none of them.
    opened(false);
    // The folder's last file, once the sweep is past it.
    await until(() => !existsSync(files.ended) && !existsSync(files.other), "the start's sweep, once let");
    first.close();
    assert.deepEqual(
      now(),
      { ended: false, open: true, other: false, after: false, old: true },
      "a run the start settles whose last line is no run-end stays, read at its ends alone, however old, while no start has gone over it; an ended one goes, one with an event after its end too, and a kind no start settles",
    );
    // A start that went over them all.
    const second = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs, sweepAfter: Promise.resolve(true), settles });
    await second.sweep();
    second.close();
    assert.deepEqual(now(), { ended: false, open: false, other: false, after: false, old: false }, "once one has, settled or not, it goes like any other");
  } finally {
    await removeDirs(dir);
  }
});

// (fails before: yes — a close after the run log had closed wrote nothing, and said the run ended all the same)
test("a run's end that does not reach its file says nothing ended: the run stays open on disk", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-run-close-"));
  try {
    const file = leaveRun(dir, { id: "left", kind: "agent-turn", chain: "c1", events: WORK });
    /** @type {string[]} */
    const said = [];
    const log = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs, ops: { record: (/** @type {string} */ _kind, /** @type {string} */ title) => said.push(title) } });
    log.close();
    assert.equal(log.closeOnDisk("left", { status: "aborted" }), false);
    assert.deepEqual(said, [], "no run is said to have ended");
    assert.notEqual(lastEvent(file).type, "run-end", "for a later start to settle");
    // A run log that keeps runs in memory alone writes no end to a file either.
    /** @type {string[]} */
    const saidToo = [];
    const memoryOnly = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { persist: false } } }), ops: { record: (/** @type {string} */ _kind, /** @type {string} */ title) => saidToo.push(title) } });
    assert.equal(memoryOnly.closeOnDisk("left", { status: "aborted" }), false, "runs kept in memory alone");
    assert.deepEqual(saidToo, [], "no run is said to have ended");
    assert.notEqual(lastEvent(file).type, "run-end");
    memoryOnly.close();
  } finally {
    await removeDirs(dir);
  }
});

// (fails before: yes — an end that did not reach its file stayed in memory: the run's events served the end its file
// lacked, and so did its page's read of what came after its file)
test("a run's end that does not reach its file leaves nothing in memory: the run reads as its file has it, and the sweep removes it once a start went over it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-run-left-"));
  const refusing = leaveRun(dir, { id: "refusing", kind: "subagent", chain: "c1", events: WORK });
  const kept = leaveRun(dir, { id: "kept", kind: "subagent", chain: "c1", events: WORK });
  /** What a run log holds of a run: the types of its events, those after its file's, and its count. @param {any} log @param {string} id */
  const heldOf = (log, id) => ({ types: log.events(id)?.events.map((/** @type {any} */ e) => e.type), after: log.events(id, { since: 4 })?.events.length, count: log.getRun(id)?.events });
  const asOnDisk = { types: ["run-start", "round-start", "round-text", "tool-start"], after: 0, count: 4 };
  try {
    const settles = ["subagent", "agent-turn", "coding-agent"];
    // A file that refuses the write.
    fs.chmodSync(refusing, 0o444);
    const log = createRunLog({ events: createEventBus(), dataDir: dir, config: knobs, sweepAfter: Promise.resolve(true), settles });
    assert.equal(log.closeOnDisk("refusing", { status: "aborted" }), false, "the file refused its end");
    assert.deepEqual(heldOf(log, "refusing"), asOnDisk, "the run reads as its file has it: no end");
    log.close();
    // Runs kept in memory alone, the file past its retention: the start went over it, so the sweep removes it.
    age(kept, 8);
    const memoryOnly = createRunLog({ events: createEventBus(), dataDir: dir, config: () => ({ observability: { runEvents: { ...knobs().observability.runEvents, persist: false } } }), sweepAfter: Promise.resolve(true), settles });
    assert.equal(memoryOnly.closeOnDisk("kept", { status: "aborted" }), false);
    assert.deepEqual(heldOf(memoryOnly, "kept"), asOnDisk, "kept in memory alone, it reads as its file has it too");
    await memoryOnly.sweep();
    assert.equal(existsSync(kept), false, "and goes past its retention");
    memoryOnly.close();
  } finally {
    fs.chmodSync(refusing, 0o666);
    await removeDirs(dir);
  }
});

// (fails before: yes — the stop wrote the turns running at it over the last stop's note, none while memory opened: the
// note was gone before memory's open read it, and the chats it named never went on)
test("a stop during memory's open leaves the next start the last stop's note and the turns the open kept", async () => {
  let cut = "";
  const { app, dataDir, chain } = await made({
    seed: (a, c, dir) => {
      const failed = a.beginTurn(c, { requestId: "r-stopped", model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: user("turn 1") }).turnId;
      a.mergeTurnMeta(failed, { failed: { at: 1, cause: "Filament is restarting" } });
      noteRunningAtStop(dir, [c]);
      cut = a.chainForKey("h:cut", { cwd: dir, client: "harness", model: "m-1" }).id;
      a.beginTurn(cut, { requestId: "r-cut", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: user("turn 1: edit a.js") });
      leaveRun(dir, { id: "r-cut", kind: "agent-turn", chain: cut, events: WORK });
    },
  });
  // Held after the open kept the cut turn, before it read the note.
  const held = holdScan(app, "coding-agent");
  const started = app.start();
  try {
    await until(() => held.asked > 0, "memory's open to keep the cut turn");
    const stopping = app.stop({ drainMs: 0 });
    held.release();
    await stopping;
    await started;
    assert.deepEqual(takeRunningAtStop(dataDir)?.chains.sort(), [chain, cut].sort(), "both chats go on at the next start");
  } finally {
    held.release();
    await started.catch(() => {});
    await removeDirs(dataDir);
  }
});

// (fails before: yes — the stop waited at the front door behind memory's open, and the desktop app's 5 s ran out first)
test("the desktop app's Quit during memory's open: /api/shutdown answers at once, and Filament stops once the open ends", async () => {
  let shut = false;
  const { app, dataDir, url } = await made({ onShutdown: () => (shut = true) });
  const held = holdScan(app);
  const started = app.start();
  try {
    await (await firstAnswer(url, "/api/state")).text();
    await until(() => held.asked > 0, "memory's open to reach the run files");
    const asked = fetch(`${url}/api/shutdown`, { method: "POST", headers: { "x-filament-ui": "1", "content-type": "application/json" }, body: JSON.stringify({ ifIdle: true }) });
    assert.equal(await settledWithin(asked, 2000), true, "answered while memory opens, well inside the app's 5 s");
    const r = await asked;
    assert.deepEqual([r.status, (await r.json()).ok], [200, true]);
    held.release();
    await until(() => shut, "Filament to stop");
    assert.equal(app.memory.archive, null, "memory closed");
  } finally {
    held.release();
    await started.catch(() => {});
    if (!shut) await app.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

/**
 * The front door alone, its memory's open held by `g` and its wait `openingWaitMs` short, every route answered 200 behind
 * it, or by `admin` where given: `within(path)` is the answer, or null where none came in 3 s.
 * @param {ReturnType<typeof gate>} g @param {{ admin?: (req: any, res: any) => any }} [o]
 */
async function heldDoor(g, { admin = (_req, res) => res.writeHead(200, { "content-type": "application/json" }).end('{"ok":true}') } = {}) {
  const cfg = defaultConfig();
  cfg.server.loopbackTrust = "legacy";
  const door = createFrontDoor(
    /** @type {any} */ ({
      config: { get: () => cfg },
      log: () => {},
      deps: {},
      pipeline: { handle: async (/** @type {any} */ _req, /** @type {any} */ res) => res.writeHead(200).end("{}") },
      responsesDoor: {},
      mcp: {},
      memoryMcp: {},
      admin: async (/** @type {any} */ req, /** @type {any} */ res) => admin(req, res),
      artifacts: async () => {},
      opening: () => (g.opened ? null : g.promise),
      openingWaitMs: 150,
      isDraining: () => false,
      VERSION: "test",
      startedAt: 0,
    }),
  );
  const server = http.createServer(door);
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(undefined)));
  const url = `http://127.0.0.1:${/** @type {net.AddressInfo} */ (server.address()).port}`;
  return {
    url,
    /** @param {string} path @param {RequestInit} [init] */
    within: async (path, init) => /** @type {Response | null} */ (await Promise.race([fetch(url + path, init), new Promise((r) => setTimeout(() => r(null), 3000))])),
    close: async () => {
      server.closeAllConnections();
      await new Promise((r) => server.close(() => r(undefined)));
    },
  };
}

// (fails before: yes — a request waited at the front door as long as memory's open did, however long that was)
test("a request that waits for memory's open longer than the front door allows is answered 503 in words, in a model client's own wire", async () => {
  const g = gate();
  const { within, close } = await heldDoor(g);
  /** A model endpoint's 503: its status and its body's shape — Anthropic's (`type: "error"`) or OpenAI's — and whether it says why. @param {string} path @param {RequestInit} init */
  const refused = async (path, init) => {
    const r = await within(path, init);
    assert.ok(r, `${path}: answered, not held`);
    const body = await r.json();
    return [r.status, body.type === "error" ? "anthropic" : "openai", /still opening memory/.test(body.error?.message)];
  };
  try {
    const session = await within("/api/sessions/c1/goal");
    assert.ok(session, "answered, not held");
    assert.deepEqual([session.status, session.headers.get("retry-after")], [503, "5"]);
    assert.match((await session.json()).error, /still opening memory/);
    const post = { method: "POST", headers: { "content-type": "application/json" }, body: "{}" };
    assert.deepEqual(await refused("/v1/messages", post), [503, "anthropic", true], "in Anthropic's wire");
    assert.deepEqual(await refused("/v1/chat/completions", post), [503, "openai", true], "in OpenAI's");
    assert.deepEqual(await refused("/v1/responses", post), [503, "openai", true], "the Responses API's");
    assert.deepEqual(await refused("/v1/models", { headers: { "anthropic-version": "2023-06-01" } }), [503, "anthropic", true], "the models list as an Anthropic client asks it");
    assert.deepEqual(await refused("/v1/models", {}), [503, "openai", true], "and as an OpenAI client does");
    const state = await within("/api/state");
    assert.equal(state?.status, 200, "/api/state answers meanwhile");
    // (fails before: yes — the hunt on s0a: the app's windows' session waited out the door and was refused, and they
    // loaded on none for the whole start)
    assert.equal((await within("/api/owner/session", post))?.status, 200, "the app's windows' session is minted meanwhile");
    g.open();
    assert.equal((await within("/api/sessions/c1/goal"))?.status, 200, "and every request once memory is open");
  } finally {
    g.open();
    await close();
  }
});

// (fails before: yes — the events stream was answered 503 with every other request that waited past the door's limit,
// and a page's EventSource answered anything but its stream is closed for good)
test("the events stream waits out memory's open, however long, past the other requests' 503", async () => {
  const g = gate();
  const { url, within, close } = await heldDoor(g);
  const feed = new AbortController();
  const events = fetch(`${url}/api/events`, { signal: feed.signal });
  try {
    assert.equal((await within("/api/sessions/c1/goal"))?.status, 503, "another request is answered 503 past the limit");
    assert.equal(await settledWithin(events, 600), false, "the events stream still waits");
    g.open();
    assert.equal((await events).status, 200, "and is answered with its stream once memory is open");
  } finally {
    feed.abort();
    g.open();
    await close();
  }
});

// (fails before: yes — a page that left while its events stream waited for memory's open had its stream attached once
// the open ended, after its close: its tab counted as open, and its ping ran, for as long as Filament did)
test("a page that leaves while its events stream waits for memory's open has nothing attached: its tab does not count as open", async (t) => {
  // The stream's ping is the one interval: held by the test, so one left running holds nothing up.
  t.mock.timers.enable({ apis: ["setInterval"] });
  const g = gate();
  const sseClients = new Set();
  /** @type {string[]} */
  const tabs = [];
  let attached = 0;
  const { url, close } = await heldDoor(g, {
    admin: (req, res) => {
      attached++;
      attachEventsStream(req, res, { events: createEventBus(), sseClients, VERSION: "test", sessionWriters: /** @type {any} */ ({ connect: (/** @type {string} */ tab) => (tabs.push(tab), () => tabs.splice(tabs.indexOf(tab), 1)) }) });
    },
  });
  const feed = new AbortController();
  try {
    const events = fetch(`${url}/api/events?tab=t-left`, { signal: feed.signal }).catch(() => null);
    // The door has it, waiting for the open; then the page goes.
    await new Promise((r) => setTimeout(r, 200));
    feed.abort();
    await events;
    await new Promise((r) => setTimeout(r, 200));
    g.open();
    await until(() => attached > 0, "the door to hand it on once memory is open");
    assert.deepEqual([sseClients.size, tabs], [0, []], "nothing attached for a page gone: no client to write to, no tab open");
  } finally {
    feed.abort();
    g.open();
    await close();
  }
});

// (fails before: yes — the page's events stream answered anything but its stream was closed for good, and nothing
// opened it again: the page heard nothing more until a reload)
// (fails before: yes — a refusal that does not change was asked again every 2 s for as long as the page was open; and a
// page put away while it waited opened its stream when shown again, on what it drew before, with no reload)
test("the page's events stream answered with no stream is opened again, each time twice as long after, up to a minute; a dropped one the browser opens itself; a page put away meanwhile opens none and loads afresh when shown", async (t) => {
  const g = /** @type {any} */ (globalThis);
  const had = { EventSource: g.EventSource, addEventListener: g.addEventListener, location: g.location };
  /** @type {any[]} */
  const streams = [];
  g.EventSource = class {
    static CLOSED = 2;
    /** @param {string} url */
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      /** @type {any} */
      this.onopen = null;
      /** @type {any} */
      this.onmessage = null;
      /** @type {any} */
      this.onerror = null;
      streams.push(this);
    }
    close() {
      this.readyState = 2;
    }
  };
  // The page's own events, as put-away.js listens for them.
  /** @type {Record<string, () => void>} */
  const page = {};
  g.addEventListener = (/** @type {string} */ type, /** @type {() => void} */ fn) => (page[type] = fn);
  let reloads = 0;
  g.location = { reload: () => reloads++ };
  t.mock.timers.enable({ apis: ["setTimeout"] });
  /** The stream open now, answered with no stream: the browser closes it for good. */
  const refuse = () => {
    const s = streams.at(-1);
    s.readyState = 2;
    s.onerror?.();
  };
  /** How long, to the second, before the page opens the stream again (none within 2 minutes: 0). */
  const waited = () => {
    const n = streams.length;
    for (let s = 1; s <= 120; s++) {
      t.mock.timers.tick(1000);
      if (streams.length > n) return s * 1000;
    }
    return 0;
  };
  try {
    const { onBus } = await import("../src/ui/harness/lib/bus.js");
    /** @type {any[]} */
    const heard = [];
    const off = onBus((/** @type {any} */ msg) => heard.push(msg));
    assert.equal(streams.length, 1);
    assert.match(streams[0].url, /^\/api\/events\?tab=/);
    // A dropped connection: the browser reconnects it itself (its state is CONNECTING again).
    streams[0].onerror?.();
    t.mock.timers.tick(120_000);
    assert.equal(streams.length, 1, "no second stream for a drop the browser reconnects");
    /** @type {number[]} */
    const waits = [];
    for (let i = 0; i < 7; i++) {
      refuse();
      waits.push(waited());
    }
    assert.deepEqual(waits, [2000, 4000, 8000, 16000, 32000, 60000, 60000], "twice as long each time, up to a minute");
    streams.at(-1).onopen?.();
    streams.at(-1).onmessage?.({ data: JSON.stringify({ type: "hello" }) });
    assert.deepEqual(heard, [{ type: "hello" }], "heard on the stream opened again");
    refuse();
    assert.equal(waited(), 2000, "a stream that opened starts the waits over");
    // Put away while it waits: the page is frozen in the browser's cache, then shown again.
    refuse();
    const n = streams.length;
    page.pagehide?.();
    t.mock.timers.tick(120_000);
    assert.equal(streams.length, n, "a page put away opens no stream");
    page.pageshow?.();
    assert.equal(reloads, 1, "and loads afresh when shown");
    off();
  } finally {
    t.mock.timers.reset();
    g.EventSource = had.EventSource;
    g.addEventListener = had.addEventListener;
    g.location = had.location;
  }
});

test("memory's open that fails lets the waiting requests through, answered in memory's own words and said in the log; the start still ends", async () => {
  const { app, dataDir, chain, url } = await made();
  app.memory.start = () => {
    throw new Error("the disk went away");
  };
  /** @type {string[]} */
  const said = [];
  app.ops.on("op", (/** @type {any} */ op) => said.push(String(op.title)));
  const held = holdScan(app);
  const started = app.start();
  try {
    await until(() => held.asked > 0, "memory's open to reach the run files");
    const goal = fetch(`${url}/api/sessions/${chain}/goal`, { headers: H });
    assert.equal(await settledWithin(goal, 300), false, "it waits for the open");
    held.release();
    const read = await goal;
    assert.equal(read.status, 503, "the session routes' answer for a memory that did not open");
    assert.match((await read.json()).error, /^no archive: /, "memory's own words, not an empty answer");
    await started;
    assert.ok(said.some((t) => /memory: could not start: the disk went away/.test(t)), JSON.stringify(said));
  } finally {
    held.release();
    await started.catch(() => {});
    await app.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

// (fails before: yes — an open still going past the stop's 3 s had its runs said ended after the run log had closed,
// though nothing was written)
test("a stop during an open that does not end within 3 s closes memory; what the open had not settled stays for the next start, said ended nowhere", async () => {
  let file = "";
  const { app, dataDir } = await made({ seed: (_a, _c, dir) => (file = leaveRun(dir, { id: "r-open", kind: "agent-turn", chain: "no-such-chat", events: WORK })) });
  /** @type {string[]} */
  const said = [];
  app.ops.on("op", (/** @type {any} */ op) => said.push(String(op.title)));
  // Held inside the keeping of the cut turns.
  const held = holdScan(app, "agent-turn");
  const started = app.start();
  try {
    await until(() => held.asked > 0, "memory's open to reach the turns' runs");
    const t0 = Date.now();
    await app.stop({ drainMs: 0 });
    assert.ok(Date.now() - t0 >= 2900, `the stop gave the open its 3 s (${Date.now() - t0} ms)`);
    assert.equal(app.memory.archive, null, "and closed memory");
    held.release();
    await started;
    assert.deepEqual(said.filter((t) => /r-open ended/.test(t)), [], "no run said ended");
    assert.notEqual(lastEvent(file).type, "run-end", "its run stays open on disk for the next start");
  } finally {
    held.release();
    await started.catch(() => {});
    await removeDirs(dataDir);
  }
});

/** A chat whose turn a crash cut off, its run's log left open: seeded by `made`. → the chat's id. @param {any} a @param {string} dir @param {{ key: string, run: string, message: any, events: any[] }} o */
const cutChat = (a, dir, { key, run, message, events }) => {
  const chat = a.chainForKey(key, { cwd: dir, client: "harness", model: "m-1" }).id;
  a.beginTurn(chat, { requestId: run, model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: message });
  leaveRun(dir, { id: run, kind: "agent-turn", chain: chat, events });
  return chat;
};

// (fails before: yes — the stop wrote its note before memory's engine had stopped, and the open kept a turn meanwhile:
// its run was ended, the note did not hold it, and no start went on with it)
test("a stop whose memory closes slowly keeps no turn past its note: the turn the open left, the next start keeps and goes on with", async () => {
  let chat = "";
  const { app, dataDir } = await made({ seed: (a, _c, dir) => (chat = cutChat(a, dir, { key: "h:cut", run: "r-cut", message: user("turn 1: edit a.js"), events: WORK })) });
  // Memory's engine takes its time to stop: the archive is open meanwhile.
  const closing = gate();
  const shutdown = app.memory.shutdown;
  app.memory.shutdown = async function () {
    closing.open();
    await new Promise((r) => setTimeout(r, 300));
    return shutdown.call(this);
  };
  const held = holdScan(app, "agent-turn");
  const started = app.start();
  /** @type {any} */
  let next = null;
  try {
    await until(() => held.asked > 0, "memory's open to reach the turns' runs");
    const stopping = app.stop({ drainMs: 0 });
    await closing.promise;
    // The turns' runs answer while memory's engine stops.
    held.release();
    await stopping;
    await started;
    next = await remade(dataDir);
    await next.start();
    assert.deepEqual((await next.resumedAtStart).map((/** @type {any} */ o) => o.chainId), [chat], "the next start goes on with it");
  } finally {
    held.release();
    await started.catch(() => {});
    if (next) await next.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

// (fails before: yes — the open a stop cut short ended all the same, and the run log's sweep, let go by its end, removed
// the run a crash had left open two retentions ago that the open had not reached: its turn lost the one record of its work)
test("a run a crash left open long ago outlives a stop that cuts memory's open short before it: the next start keeps its turn", async () => {
  let chat = "";
  let file = "";
  const { app, dataDir } = await made({
    seed: (a, _c, dir) => {
      chat = cutChat(a, dir, { key: "h:old-cut", run: "r-old", message: user("turn 1: edit a.js"), events: WORK });
      file = join(dir, "runs", "r-old.jsonl");
      age(file, 20);
    },
  });
  // Memory's engine takes its time to stop: the run log is open meanwhile, and its sweep with it.
  const closing = gate();
  const shutdown = app.memory.shutdown;
  app.memory.shutdown = async function () {
    closing.open();
    await new Promise((r) => setTimeout(r, 300));
    return shutdown.call(this);
  };
  const held = holdScan(app, "agent-turn");
  const started = app.start();
  /** @type {any} */
  let next = null;
  try {
    await until(() => held.asked > 0, "memory's open to reach the turns' runs");
    const stopping = app.stop({ drainMs: 0 });
    await closing.promise;
    held.release();
    await stopping;
    await started;
    assert.ok(existsSync(file), "its file outlives the stop");
    next = await remade(dataDir);
    await next.start();
    assert.equal(next.memory.archive?.getTurns(chat).at(-1)?.meta.cut?.run, "r-old", "the next start keeps its turn's work");
  } finally {
    held.release();
    await started.catch(() => {});
    if (next) await next.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

// (fails before: yes — the note's turn counted the calls its run's end did, none for a run a start had ended, so a resume
// that had run calls and was cut again was held as cut before it ran anything)
test("a resume cut again after its calls, kept by an open a stop cut short, goes on at the next start: its cut counts its calls", async () => {
  let chat = "";
  const CALLS = [{ type: "round-start", round: 1 }, ...[1, 2, 3].flatMap((i) => [{ type: "tool-start", round: 1, id: `c${i}`, name: "read", args: `f${i}.js` }, { type: "tool-end", round: 1, id: `c${i}`, ok: true }])];
  const { app, dataDir } = await made({ seed: (a, _c, dir) => (chat = cutChat(a, dir, { key: "h:resumed", run: "r-resume", message: user(RESUME_LINE), events: CALLS })) });
  // Held after the open kept the turn, before it went on.
  const held = holdScan(app, "coding-agent");
  const started = app.start();
  /** @type {any} */
  let next = null;
  try {
    await until(() => held.asked > 0, "memory's open to keep the turn");
    assert.equal(app.memory.archive?.getTurns(chat).at(-1)?.meta.cut?.tools, 3, "kept, its three calls counted");
    const stopping = app.stop({ drainMs: 0 });
    held.release();
    await stopping;
    await started;
    next = await remade(dataDir);
    await next.start();
    assert.deepEqual((await next.resumedAtStart).map((/** @type {any} */ o) => o.chainId), [chat], "it goes on");
    assert.notDeepEqual(next.memory.archive?.getTurns(chat).at(-1)?.meta.cut?.resume, { held: CUT_AGAIN });
  } finally {
    held.release();
    await started.catch(() => {});
    if (next) await next.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

// (fails before: yes — a resume the stop's drain refused had left the start's turns already, and the stop's note did not
// hold it: no start went on with it)
// (fails before: yes, with the drain's check taken out of server.js — the desktop app's Quit and Restart send
// /api/shutdown, whose drain comes 50 ms before the stop and its note: a stop asked for at once noted the turn whatever
// the drain had answered)
test("a resume the drain of /api/shutdown refuses stays in the stop's note, and the next start goes on with it", async () => {
  const up = await fakeUpstream(async () => anthropicReply("Going on.", { model: "m-1" }));
  let chat = "";
  const stopped = gate();
  const { app, dataDir, url } = await made({
    onShutdown: () => stopped.open(),
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    },
    seed: (a, _c, dir) => {
      chat = cutChat(a, dir, { key: "h:cut", run: "r-cut", message: user("turn 1: edit a.js"), events: WORK });
      a.mergeMeta(chat, { native: true });
    },
  });
  // The resume's request leaves only once the shutdown has been asked for: the drain answers it.
  const asked = gate();
  const sent = gate();
  const request = http.request;
  http.request = /** @type {any} */ (
    function (/** @type {any[]} */ ...args) {
      const req = request.apply(http, /** @type {any} */ (args));
      if (String(args[0]).includes(`/api/sessions/${chat}/turns`)) {
        const end = req.end.bind(req);
        req.end = /** @type {any} */ ((/** @type {any[]} */ ...a) => (void asked.promise.then(() => end(...a)), req));
        sent.open();
      }
      return req;
    }
  );
  syncBuiltinESMExports();
  // The stop /api/shutdown asks for goes once the resume has its answer.
  const stop = app.stop;
  app.stop = (/** @type {any} */ o) => app.resumedAtStart.then(() => stop.call(app, o));
  /** @type {any} */
  let next = null;
  let shut = false;
  try {
    await app.start();
    await sent.promise;
    const r = await fetch(`${url}/api/shutdown`, { method: "POST", headers: { "x-filament-ui": "1", "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 200);
    shut = true;
    asked.open();
    await stopped.promise;
    const outcomes = await app.resumedAtStart;
    assert.deepEqual(outcomes.map((/** @type {any} */ o) => [o.chainId, o.went, o.why]), [[chat, false, "Filament is restarting; send again in a few seconds"]], "refused by the drain, in its words");
    // Read, and left for the next start.
    const noted = existsSync(join(dataDir, "running-at-stop.json")) ? JSON.parse(readFileSync(join(dataDir, "running-at-stop.json"), "utf8")).chains : null;
    assert.deepEqual(noted, [chat], "noted for the next start");
    http.request = request;
    syncBuiltinESMExports();
    next = await remade(dataDir);
    await next.start();
    assert.deepEqual((await next.resumedAtStart).map((/** @type {any} */ o) => [o.chainId, o.went]), [[chat, true]], "the next start goes on with it");
    await until(() => up.received.length > 0, "the turn's model call");
  } finally {
    http.request = request;
    syncBuiltinESMExports();
    asked.open();
    if (shut) await stopped.promise;
    else await app.stop({ drainMs: 0 });
    if (next) await next.stop({ drainMs: 0 });
    await up.close();
    await removeDirs(dataDir);
  }
});

// (fails before: yes — a resume whose send failed with no stop under way stayed among the start's turns, and the next
// stop, however much later, noted its chat for the start after it, though its mark said why it did not go on)
test("a resume whose send fails with no stop under way leaves the start's turns: a later stop does not note it", async () => {
  let chat = "";
  const { app, dataDir } = await made({
    seed: (a, _c, dir) => {
      chat = cutChat(a, dir, { key: "h:cut", run: "r-cut", message: user("turn 1: edit a.js"), events: WORK });
      a.mergeMeta(chat, { native: true });
    },
  });
  // The resume's request fails on its way, as a connection refused would fail it.
  const request = http.request;
  http.request = /** @type {any} */ (
    function (/** @type {any[]} */ ...args) {
      const req = request.apply(http, /** @type {any} */ (args));
      if (String(args[0]).includes(`/api/sessions/${chat}/turns`)) req.end = /** @type {any} */ (() => (req.destroy(new Error("the connection was refused")), req));
      return req;
    }
  );
  syncBuiltinESMExports();
  let stopped = false;
  try {
    await app.start();
    const outcomes = await app.resumedAtStart;
    assert.deepEqual(outcomes.map((/** @type {any} */ o) => [o.chainId, o.went, o.why]), [[chat, false, "the connection was refused"]]);
    assert.deepEqual(app.memory.archive?.getTurns(chat).at(-1)?.meta.cut?.resume, { refused: "the connection was refused" }, "its mark says why");
    await app.stop({ drainMs: 0 });
    stopped = true;
    assert.equal(takeRunningAtStop(dataDir), null, "the stop notes no chat");
  } finally {
    http.request = request;
    syncBuiltinESMExports();
    if (!stopped) await app.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

// (fails before: yes — a sub-agent run whose end could not be written was found open at every start, and its chat told of
// it again each time it had read the notice)
test("a sub-agent run whose end cannot be written is told to its chat once, however often Filament starts", async () => {
  const brief = { agentId: "sa_1", exchange: 0, description: "Audit", task: "audit it", by: "agent", deliver: true };
  const { app, dataDir, chain } = await made({
    configure: (cfg) => (cfg.observability.runEvents = { ...(cfg.observability.runEvents || {}), persist: false }),
    seed: (_a, c, dir) => leaveRun(dir, { id: "r-sub", kind: "subagent", chain: c, meta: { subagent: "sa_1" }, brief, events: WORK }),
  });
  /** @type {any} */
  let next = null;
  const noticesIn = (/** @type {any} */ app) => app.sessions.loadSubagentQueue(chain).filter((/** @type {any} */ d) => d.from === "sa_1").length;
  try {
    await app.start();
    assert.equal(noticesIn(app), 1, "told");
    // The chat's agent reads it.
    app.sessions.saveSubagentQueue(chain, []);
    await app.stop({ drainMs: 0 });
    next = await remade(dataDir);
    await next.start();
    assert.equal(noticesIn(next), 0, "not told again");
  } finally {
    if (next) await next.stop({ drainMs: 0 });
    else await app.stop({ drainMs: 0 });
    await removeDirs(dataDir);
  }
});

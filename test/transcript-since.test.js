// @ts-check
// A chat's transcript read as the turns written since the page's last read (the slowness of 11-02): a long chat's whole
// read was megabytes, read at every turn's end, every turn's message and answer opened on the server while every other
// request waited. The archive keeps which turn rows were written (`turnsVersion`); a read that names the version it holds
// is sent those turns alone, with every turn's id in order, and the page puts the transcript together whole — the same
// answer a whole read gives at that version, through a new turn, a turn's end, a mark on an old turn, a rewind, a
// question answered, a turn that goes, a run the sweep removed, a Reload that lands while a turn's end is read.
import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventBus } from "../src/services/events.js";
import { createRunLog } from "../src/services/runs.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { sessionRoutes } from "../src/http/admin/sessions.js";
import { createRouter } from "../src/http/router.js";
import { Archive } from "../src/services/memory/archive.js";
import { transcriptWhole, writtenSince } from "../src/ui/harness/lib/transcript-since.js";
import { lift } from "./helpers/app-lift.js";
import { transcriptTurns, withReadWork, mergedTurns, newestOnRecord } from "../src/ui/harness/conversation/history.js";
import { withReadRuns } from "../src/ui/harness/lib/turn-reads.js";

const dir = mkdtempSync(join(tmpdir(), "filament-transcript-since-"));
const folder = mkdtempSync(join(dir, "project-"));
let clock = 1_760_000_000_000;
const now = () => (clock += 1000);
/** @type {any} */
const cfg = { server: { host: "127.0.0.1" }, rules: {}, agentLoop: { permissions: "edit" }, memory: { enabled: true }, routes: [], upstreams: [], sessions: { defaults: {} } };
const config = { get: () => cfg };
const memory = new MemoryService(/** @type {any} */ ({ sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now }));
memory.start();
/** @type {any} */
const archive = memory.archive;
const ops = { record: () => {} };
const sessions = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops, log: () => {}, forkSession: async () => ({}), now });
after(async () => {
  await memory.shutdown();
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
});

/** A finished turn of the chat, with a tool round. @param {string} id @param {number} i @param {Record<string, any>} [meta] */
function turnOf(id, i, meta = {}) {
  const t = archive.beginTurn(id, { requestId: `r${i}`, model: "agent/m", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: `turn ${i}` }] } });
  archive.addWork(t.turnId, [
    { role: "assistant", content: [{ type: "tool_use", id: `t${i}`, name: "read", input: { path: `f${i}` } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `file ${i}` }] },
  ]);
  archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: `done ${i}` }] }, requestId: `r${i}` });
  archive.mergeTurnMeta(t.turnId, { settingsHash: i < 4 ? "h1" : "h2", ...meta });
  return t.turnId;
}

/** A chat with `n` finished turns. @param {number} n */
function chatWith(n) {
  const { id } = sessions.create({ cwd: folder, model: "agent/m", preset: "plain" });
  for (let i = 1; i <= n; i++) turnOf(id, i);
  return id;
}

/** The page's read as a page reads it: `?work=held`, every turn. @param {string} id @param {string | null} [written] */
const read = (id, written = null) => sessions.transcript(id, { work: "held", written });

/** What the page holds of a whole read. @param {string} id @param {any} tr */
const heldOf = (id, tr) => /** @type {any} */ (transcriptWhole(tr, null, id)).served;

/**
 * A chat of three turns whose runs are on disk and out of memory — the run log keeps ten in memory, and ten ran after
 * them — and the sessions that ask that log whether a turn has a run.
 */
function chatWithRuns() {
  const runDir = mkdtempSync(join(dir, "runs-"));
  const runs = createRunLog({ events: createEventBus(), dataDir: runDir, config: () => ({ observability: { runEvents: { persist: true, retentionDays: 1, keepRuns: 10 } } }) });
  const withRuns = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops, log: () => {}, forkSession: async () => ({}), now, runs });
  const { id } = withRuns.create({ cwd: folder, model: "agent/m", preset: "plain" });
  /** A finished turn of the chat with its run. @param {number} i */
  const ranTurn = (i) => {
    runs.startRun({ id: `r${i}`, kind: "agent-turn" });
    turnOf(id, i);
    runs.endRun(`r${i}`);
  };
  for (let i = 1; i <= 3; i++) ranTurn(i);
  for (let i = 1; i <= 10; i++) {
    runs.startRun({ id: `later-${i}`, kind: "agent-turn" });
    runs.endRun(`later-${i}`);
  }
  /** These runs' files past the retention, removed by the log's sweep — the start's, or the one asked here. @param {string[]} ids */
  const sweepAway = async (ids) => {
    const files = ids.map((r) => join(runDir, "runs", `${r}.jsonl`));
    const ancient = (Date.now() - 3 * 86400_000) / 1000;
    for (const f of files) utimesSync(f, ancient, ancient);
    for (let i = 0; i < 100 && files.some((f) => existsSync(f)); i++) {
      await runs.sweep();
      await new Promise((r) => setTimeout(r, 5));
    }
    assert.ok(!files.some((f) => existsSync(f)), "the sweep removed their files");
  };
  return { id, runs, withRuns, ranTurn, sweepAway };
}

/**
 * The rows the archive reads while `fn` runs (`getTurns`), and what `fn` returned.
 * @template T @param {() => T} fn @returns {{ value: T, rows: number[] }}
 */
function rowsRead(fn) {
  const real = archive.getTurns;
  /** @type {number[]} */
  const rows = [];
  archive.getTurns = (/** @type {any[]} */ ...args) => {
    const out = real.apply(archive, args);
    rows.push(...out.map((/** @type {any} */ t) => t.n));
    return out;
  };
  try {
    return { value: fn(), rows };
  } finally {
    archive.getTurns = real;
  }
}

describe("the archive's turn writes", () => {
  // (fails before: yes — there was no record of which turns were written: a page read every turn at every turn's end)
  test("every turn row begun or changed, by any writer, is read past the version before it; a write rolled back is none", () => {
    const id = chatWith(3);
    const ns = (/** @type {string} */ v) => archive.getTurns(id, { written: archive.turnsWrittenAt(v) }).map((/** @type {any} */ t) => t.n);
    const v0 = archive.turnsVersion();
    assert.match(v0, /^[0-9a-f]+\.\d+$/);
    assert.deepEqual(ns(v0), [], "nothing written since");
    const t2 = archive.getTurns(id, { from: 2, to: 2 })[0].id;
    archive.mergeTurnMeta(t2, { unanswered: { by: "Claude Code" } });
    const v1 = archive.turnsVersion();
    assert.notEqual(v1, v0);
    assert.deepEqual(ns(v0), [2], "a mark on an old turn");
    turnOf(id, 4);
    assert.deepEqual(ns(v0), [2, 4], "a new turn, begun and ended");
    assert.deepEqual(ns(v1), [4]);
    // A writer of its own, past the archive's methods: SQLite's triggers see it all the same.
    archive.db.prepare("UPDATE turns SET summary = ? WHERE id = ?").run("s", archive.getTurns(id, { from: 1, to: 1 })[0].id);
    assert.deepEqual(ns(v1), [1, 4]);
    const v2 = archive.turnsVersion();
    assert.throws(() => archive.transaction(() => {
      archive.mergeTurnMeta(t2, { stopped: { by: "harness" } });
      throw new Error("taken back");
    }), /taken back/);
    assert.equal(archive.turnsVersion(), v2, "the rolled-back write moved nothing");
    assert.deepEqual(ns(v2), []);
    assert.deepEqual(archive.getTurns(id).map((/** @type {any} */ t) => t.n), [1, 2, 3, 4], "no `written`: every turn");
  });

  test("a version of another opening, or none, is no version: its reader reads whole", () => {
    const v = archive.turnsVersion();
    const other = new Archive({ file: ":memory:" });
    try {
      assert.equal(other.turnsWrittenAt(v), null, "another opening's");
      assert.equal(archive.turnsWrittenAt(other.turnsVersion()), null);
      for (const bad of [null, undefined, "", "12", "x.1", `${v}.1`, 7]) assert.equal(archive.turnsWrittenAt(bad), null, String(bad));
      assert.equal(archive.turnsWrittenAt(v), Number(v.split(".")[1]));
    } finally {
      other.close();
    }
  });
});

describe("the transcript read past a version", () => {
  // (fails before: yes — every read was sent every turn, each turn's message and answer opened)
  test("a page's read names the version it holds and is sent the turns written since alone, put together whole as a whole read has it", () => {
    const id = chatWith(12);
    const first = read(id);
    assert.equal(typeof first.version, "string", "every answer names its version");
    assert.equal(first.written, undefined, "a whole read is whole");
    let held = heldOf(id, first);
    /** One more read past the version held: only what moved is read, and put together it is the whole read. @param {number[]} moved */
    const again = (moved) => {
      const sent = rowsRead(() => read(id, held.version));
      const tr = sent.value;
      assert.equal(tr.written, held.version);
      assert.deepEqual(tr.turns.map((/** @type {any} */ t) => t.n), moved, "the turns written since, and only those");
      assert.deepEqual(sent.rows, moved, "no other turn's row read");
      const whole = read(id);
      assert.deepEqual(tr.ids, whole.turns.map((/** @type {any} */ t) => t.turnId), "every turn's id, in order");
      const put = transcriptWhole(tr, held, id);
      assert.ok(put);
      assert.deepEqual(put.tr, whole, "the same answer a whole read gives");
      held = put.served;
    };
    again([]);
    // A turn begins: open, then its end.
    const t13 = archive.beginTurn(id, { requestId: "r13", model: "agent/m", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: "turn 13" }] } });
    again([13]);
    archive.addWork(t13.turnId, [{ role: "assistant", content: [{ type: "text", text: "working" }] }]);
    archive.finishTurn(t13.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done 13" }] }, requestId: "r13" });
    again([13]);
    // A mark on an old turn after it ended (a question left unanswered, its facts).
    const t3 = archive.getTurns(id, { from: 3, to: 3 })[0].id;
    archive.mergeTurnMeta(t3, { unanswered: { by: "Claude Code" }, facts: { tokens: { input: 9 } } });
    again([3]);
    // A rewind marks every turn of its line.
    memory.markRewound(id, { from: 10, by: "harness" });
    again([10, 11, 12, 13]);
    // A turn that answers the question of the one before: its work opens with the reply that asked, whose words the
    // page draws on the asking turn, held.
    const t14 = archive.beginTurn(id, { requestId: "r14", model: "agent/m", client: "harness", userMessage: { role: "user", content: [{ type: "text", text: "yes" }] } });
    archive.addWork(t14.turnId, [{ role: "assistant", content: [{ type: "text", text: "May I?" }, { type: "tool_use", id: "q", name: "ask", input: {} }] }]);
    archive.mergeTurnMeta(t14.turnId, { resumes: "permission" });
    archive.finishTurn(t14.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "done 14" }] }, requestId: "r14" });
    again([14]);
  });

  test("a turn that goes leaves the ids, and the page's whole loses it", () => {
    const id = chatWith(4);
    const held = heldOf(id, read(id));
    archive.db.prepare("DELETE FROM turns WHERE chain_id = ? AND n = 2").run(id);
    const tr = read(id, held.version);
    assert.deepEqual(tr.turns, []);
    const put = transcriptWhole(tr, held, id);
    assert.deepEqual(put?.tr.turns.map((/** @type {any} */ t) => t.n), [1, 3, 4]);
    assert.deepEqual(put?.tr, read(id));
  });

  test("a version not this opening's, or one with since or limit, is answered as asked, whole", () => {
    const id = chatWith(3);
    const whole = read(id);
    const other = read(id, "0badc0de.5");
    assert.equal(other.written, undefined);
    assert.deepEqual(other, whole);
    const last = sessions.transcript(id, { work: "held", limit: 1, written: whole.version });
    assert.equal(last.written, undefined);
    assert.deepEqual(last.turns.map((/** @type {any} */ t) => t.n), [3]);
  });

  // (fails before: yes — the route never passed the version on)
  test("GET /sessions/:id/transcript?written= is the read past that version", async () => {
    const id = chatWith(3);
    const route = createRouter(sessionRoutes(/** @type {any} */ ({ memory, usage: { forChain: () => ({ records: [], capped: false }), publicRecord: (/** @type {any} */ r) => r }, ops, sessions, config })));
    /** @param {string} path */
    const get = async (path) => {
      const url = new URL(`http://x${path}`);
      const m = /** @type {any} */ (route("GET", url.pathname));
      let body = "";
      const res = { headersSent: false, writableEnded: false, destroyed: false, setHeader() {}, getHeader() {}, writeHead() { return res; }, write(/** @type {string} */ c) { body += c; }, end(c = "") { body += c; res.writableEnded = true; }, on() {} };
      await m.handler({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url, path: url.pathname, method: "GET", params: m.params, json: async () => ({}) });
      return JSON.parse(body);
    };
    const first = await get(`/sessions/${id}/transcript?work=held`);
    turnOf(id, 4);
    const next = await get(`/sessions/${id}/transcript?work=held&written=${encodeURIComponent(first.version)}`);
    assert.equal(next.written, first.version);
    assert.deepEqual(next.turns.map((/** @type {any} */ t) => t.n), [4]);
    assert.equal(next.ids.length, 4);
    assert.deepEqual(next.runs, [], "no run log here: no turn has a run");
  });

  // (fails before: yes — a rewind that stood had every turn's row read again for its check, the turns past the version
  // held or not, and a turn that started after it never ended it: the check read a start no row carries)
  test("a rewind that stands is read from the turns' outline: past the version held, no other turn's row is read", async () => {
    // The service's clock as the archive's, as they are in the app: a rewind's time and a turn's start are both now.
    const real = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops, log: () => {}, forkSession: async () => ({}), now: Date.now });
    const { id } = real.create({ cwd: folder, model: "agent/m", preset: "plain" });
    for (let i = 1; i <= 4; i++) turnOf(id, i);
    let held = heldOf(id, real.transcript(id, { work: "held" }));
    const tick = () => new Promise((r) => setTimeout(r, 5));
    await tick();
    await real.rewindTo(id, { turn: 3, what: "conversation" });
    await tick();
    // A command Filament answers ends no rewind.
    memory.recordCommandTurn({ chainRef: id, composed: true }, { requestId: "c5", userText: "/help", answerText: "The commands." });
    /** A read past the version held: the rows it read, and the transcript put together. */
    const again = () => {
      const sent = rowsRead(() => real.transcript(id, { work: "held", written: held.version }));
      const put = transcriptWhole(sent.value, held, id);
      assert.deepEqual(put?.tr, real.transcript(id, { work: "held" }), "the same answer a whole read gives");
      held = /** @type {any} */ (put).served;
      return { tr: sent.value, rows: sent.rows };
    };
    const first = again();
    assert.deepEqual(first.tr.turns.map((/** @type {any} */ t) => t.n), [3, 4, 5], "the rewound line and the command");
    assert.deepEqual(first.rows, [3, 4, 5], "no other turn's row read");
    assert.equal(first.tr.rewind?.turn, 3, "the rewind stands");
    await tick();
    turnOf(id, 6);
    const next = again();
    assert.deepEqual(next.rows, [6]);
    assert.equal(next.tr.rewind, undefined, "a turn after it ends it");
  });

  // (fails before: yes — the rewind's time was taken once its files were put back: a turn that began while they were
  // worked out started before it, so the rewind stood after that turn and its Undo was offered)
  test("a turn that starts while a rewind works on its files is after it: no Undo, and the turn is on the rewound line", async () => {
    const real = createSessions({ memory, config, pipeline: { handle: async () => {} }, ops, log: () => {}, forkSession: async () => ({}), now: Date.now });
    const { id } = real.create({ cwd: folder, model: "agent/m", preset: "plain" });
    for (let i = 1; i <= 3; i++) turnOf(id, i);
    await new Promise((r) => setTimeout(r, 5));
    // A coding agent's own turn begins as the rewind works out which files go back: its row, as memory begins one.
    const rounds = memory.roundsOf;
    /** @type {any} */
    let begun = null;
    memory.roundsOf = (/** @type {Parameters<typeof rounds>} */ ...args) => {
      begun ??= archive.beginTurn(id, { requestId: "own4", model: "agent/m", client: "harness", own: { agent: "Claude Code", tasks: [] }, userMessage: { role: "user", content: [{ type: "text", text: "A background task ended (completed): done." }] } });
      return rounds.apply(memory, args);
    };
    try {
      await real.rewindTo(id, { turn: 2, what: "conversation" });
    } finally {
      memory.roundsOf = rounds;
    }
    assert.ok(begun, "the turn began while the rewind ran");
    const tr = real.transcript(id, { work: "held" });
    assert.equal(tr.rewind, undefined, "the rewind no longer stands: no Undo is offered");
    await assert.rejects(real.undoRewind(id), /no rewind to undo here: Undo lasts until the next message/);
    assert.deepEqual(tr.turns.filter((/** @type {any} */ t) => t.rewound).map((/** @type {any} */ t) => t.n), [2, 3, 4], "the turn that began during it is on its line");
  });

  // (fails before: yes — the turns the read did not send kept the run the read before had found, after the sweep took it)
  test("a turn whose run file the sweep removed has no run past the version held, as a whole read says it", async () => {
    const c = chatWithRuns();
    try {
      const first = c.withRuns.transcript(c.id, { work: "held" });
      assert.deepEqual(first.turns.map((/** @type {any} */ t) => t.run), [true, true, true]);
      const held = heldOf(c.id, first);
      await c.sweepAway(["r1", "r2"]);
      c.ranTurn(4);
      const tr = c.withRuns.transcript(c.id, { work: "held", written: held.version });
      assert.deepEqual(tr.turns.map((/** @type {any} */ t) => t.n), [4], "the turn written since alone");
      const whole = c.withRuns.transcript(c.id, { work: "held" });
      const put = transcriptWhole(tr, held, c.id);
      assert.deepEqual(transcriptTurns(put?.tr).map((/** @type {any} */ t) => [t.n, t.runId]), [[1, null], [2, null], [3, "r3"], [4, "r4"]], "a run is looked up only where it is");
      assert.deepEqual(put?.tr, whole, "the same answer a whole read gives");
      assert.deepEqual(tr.runs, whole.turns.slice(2).map((/** @type {any} */ t) => t.turnId), "the turns that have a run, by id");
      assert.equal(put?.tr.turns[2], held.byId.get(whole.turns[2].turnId), "a held turn whose run stands is the one held");
    } finally {
      c.runs.close();
    }
  });
});

describe("the page's whole of a read past its version", () => {
  const row = (/** @type {number} */ n, /** @type {string} */ said = `done ${n}`) => ({ n, turnId: 100 + n, user: { content: [{ type: "text", text: `turn ${n}` }] }, final: { role: "assistant", content: [{ type: "text", text: said }] }, workCount: 0 });
  const held = /** @type {any} */ (transcriptWhole({ turns: [row(1), row(2), row(3)], version: "m.3", title: "t" }, null, "s1")).served;

  test("a whole answer is as it came, and held by its version", () => {
    const tr = { turns: [row(1)], version: "m.1", title: "t" };
    const put = transcriptWhole(tr, held, "s1");
    assert.equal(put?.tr, tr);
    assert.deepEqual([put?.served?.version, [...(put?.served?.byId.keys() || [])]], ["m.1", [101]]);
    assert.equal(transcriptWhole({ turns: [] }, null, "s1")?.served, null, "an answer with no version: nothing held to read past");
    assert.deepEqual(transcriptWhole(null, held, "s1"), { tr: null, served: null }, "no answer is no answer: never read again for");
  });

  test("the turns sent take their places among the held ones, by the ids; one not named has gone", () => {
    const tr = { turns: [row(2, "changed"), row(4)], written: "m.3", ids: [101, 102, 104], runs: [], version: "m.5", title: "t" };
    const put = transcriptWhole(tr, held, "s1");
    assert.deepEqual(put?.tr.turns.map((/** @type {any} */ t) => [t.n, t.final.content[0].text]), [[1, "done 1"], [2, "changed"], [4, "done 4"]]);
    assert.equal(put?.tr.written, undefined);
    assert.equal(put?.tr.ids, undefined);
    assert.equal(put?.tr.runs, undefined);
    assert.equal(put?.tr.title, "t");
    assert.equal(put?.served?.version, "m.5");
    assert.equal(put?.tr.turns[0], held.byId.get(101), "the held turn, as it was sent");
  });

  // (fails before: yes — a held turn kept the run it was sent with, whatever the answer said)
  test("a held turn's run is as the answer's runs say it; a turn sent is as it was sent", () => {
    const ran = /** @type {any} */ (transcriptWhole({ turns: [{ ...row(1), run: true }, { ...row(2), run: true }, { ...row(3), run: false }], version: "m.3" }, null, "s1")).served;
    const tr = { turns: [{ ...row(4), run: true }], written: "m.3", ids: [101, 102, 103, 104], runs: [102, 103, 104], version: "m.4" };
    const put = transcriptWhole(tr, ran, "s1");
    assert.deepEqual(put?.tr.turns.map((/** @type {any} */ t) => [t.n, t.run]), [[1, false], [2, true], [3, true], [4, true]]);
    assert.equal(put?.tr.turns[1], ran.byId.get(102), "one whose run stands is the one held");
    assert.equal(ran.byId.get(101).run, true, "and what was held is not written on");
    assert.equal(put?.served?.byId.get(101).run, false, "what is held from then on says it");
  });

  test("one that cannot be put together with what is held is none", () => {
    assert.equal(transcriptWhole({ turns: [], written: "m.2", ids: [101], runs: [], version: "m.4" }, held, "s1"), null, "another version than the one held");
    assert.equal(transcriptWhole({ turns: [], written: "m.3", ids: [101, 109], runs: [], version: "m.4" }, held, "s1"), null, "a turn neither carries");
    assert.equal(transcriptWhole({ turns: [], written: "m.3", ids: [101], runs: [], version: "m.4" }, held, "s2"), null, "another session's");
    assert.equal(transcriptWhole({ turns: [], written: "m.3", ids: [101], runs: [], version: "m.4" }, null, "s1"), null, "nothing held");
    assert.equal(transcriptWhole({ turns: [], written: "m.3", ids: [101], version: "m.4" }, held, "s1"), null, "no word on the turns' runs");
  });

  test("the read names the version held of this session only", () => {
    assert.equal(writtenSince(held, "s1"), "&written=m.3");
    assert.equal(writtenSince(held, "s2"), "");
    assert.equal(writtenSince(null, "s1"), "");
  });
});

describe("the page's turn-end read", () => {
  /**
   * hydrate, lifted, its reads answered in turn by `answers` — each one as it is, or a promise the test settles — or
   * each by `answers` asked with the path.
   * @param {any[] | ((path: string) => any)} answers @param {string} [chainId]
   */
  function page(answers, chainId = "s1") {
    /** @type {string[]} */
    const asked = [];
    const state = { currentId: "c1", chats: new Map(), compactingHeard: new Map(), commands: new Map(), holders: new Map() };
    const chat = { id: "c1", chainId, cwd: "C:/work", turns: /** @type {any[]} */ ([]), live: null };
    state.chats.set("c1", chat);
    const { hydrate } = lift(["hydrate", "drawChat?", "drawnChat?", "meterRecords"], {
      state, newestOnRecord, chatOf: (/** @type {string} */ cid) => state.chats.get(cid) || null,
      api: async (/** @type {string} */ path) => (asked.push(path), typeof answers === "function" ? answers(path) : answers.shift()),
      transcript: { render() {}, startTurn() {}, pause() {}, refreshSpace() {} },
      transcriptTurns, withReadWork, mergedTurns, withReadRuns, transcriptWhole, writtenSince, waitingOwes: () => null, opening: new WeakSet(),
    });
    return { hydrate, chat, asked };
  }
  /** @param {number} n @param {Record<string, any>} [also] */
  const row = (n, also = {}) => ({ n, turnId: 100 + n, requestIds: [`r${n}`], user: { content: [{ type: "text", text: `turn ${n}` }] }, final: { role: "assistant", content: [{ type: "text", text: `done ${n}` }] }, workCount: 0, ...also });
  const base = { title: "A chat", cwd: "C:/work", live: null };

  // (fails before: yes — every read of the chat asked for every turn again)
  test("a turn's end asks for the turns written since the read it holds, and draws them among the turns it holds", async () => {
    const p = page([
      { ...base, turns: [row(1), row(2)], version: "m.2" },
      { ...base, turns: [row(3)], written: "m.2", ids: [101, 102, 103], runs: [], version: "m.3" },
    ]);
    await p.hydrate(p.chat);
    await p.hydrate(p.chat);
    assert.deepEqual(p.asked, ["/sessions/s1/transcript?work=held", "/sessions/s1/transcript?work=held&written=m.2"]);
    assert.deepEqual(p.chat.turns.map((/** @type {any} */ t) => [t.n, t.userText]), [[1, "turn 1"], [2, "turn 2"], [3, "turn 3"]]);
  });

  test("Reload reads every turn again; a read that cannot be put together is read again whole", async () => {
    const p = page([
      { ...base, turns: [row(1), row(2)], version: "m.2" },
      { ...base, turns: [row(1), row(2)], version: "m.2" },
      { ...base, turns: [], written: "m.2", ids: [101, 102, 107], runs: [], version: "m.7" },
      { ...base, turns: [row(1), row(2), row(7)], version: "m.7" },
    ]);
    await p.hydrate(p.chat);
    await p.hydrate(p.chat, { whole: true });
    await p.hydrate(p.chat);
    assert.deepEqual(p.asked, ["/sessions/s1/transcript?work=held", "/sessions/s1/transcript?work=held", "/sessions/s1/transcript?work=held&written=m.2", "/sessions/s1/transcript?work=held"]);
    assert.deepEqual(p.chat.turns.map((/** @type {any} */ t) => t.n), [1, 2, 7]);
    assert.equal(p.chat.served?.version, "m.7");
  });

  // (fails before: yes — the held turns kept the run id the read before had given them, and Watch the run found none)
  test("a run the sweep removed leaves its held turn with no run id after the next turn-end read", async () => {
    const c = chatWithRuns();
    try {
      // Answered by the sessions' own transcript, as the route sends it.
      const p = page((path) => JSON.parse(JSON.stringify(c.withRuns.transcript(c.id, { work: "held", written: new URL(`http://x${path}`).searchParams.get("written") }))), c.id);
      await p.hydrate(p.chat);
      assert.deepEqual(p.chat.turns.map((/** @type {any} */ t) => t.runId), ["r1", "r2", "r3"]);
      await c.sweepAway(["r1", "r2"]);
      c.ranTurn(4);
      await p.hydrate(p.chat);
      assert.match(p.asked[1], /&written=/, "the turn's end read past the version held");
      assert.deepEqual(p.chat.turns.map((/** @type {any} */ t) => [t.n, t.runId]), [[1, null], [2, null], [3, "r3"], [4, "r4"]]);
    } finally {
      c.runs.close();
    }
  });

  /** A promise the test settles, and its settling. */
  const later = () => {
    /** @type {(v: any) => void} */
    let land = () => {};
    const answer = new Promise((r) => (land = r));
    return { answer, land };
  };

  // (fails before: yes — the turn's end put the turns it was sent among those it was asked with, over the Reload's)
  test("a turn-end read on its way as a Reload lands puts its turns among the Reload's, never over them", async () => {
    const reload = later(), end = later();
    const p = page([
      { ...base, turns: [row(1, { clientLabel: "Old name" }), row(2)], version: "m.2" },
      reload.answer,
      end.answer,
      { ...base, turns: [row(3)], written: "m.3", ids: [101, 102, 103], runs: [], version: "m.4" },
    ]);
    await p.hydrate(p.chat);
    const reloading = p.hydrate(p.chat, { whole: true });
    const ending = p.hydrate(p.chat);
    reload.land({ ...base, turns: [row(1, { clientLabel: "New name" }), row(2), row(3, { final: null })], version: "m.3" });
    await reloading;
    assert.equal(p.chat.turns[0].clientLabel, "New name", "the Reload drew its turns");
    end.land({ ...base, turns: [row(3)], written: "m.2", ids: [101, 102, 103], runs: [], version: "m.4" });
    await ending;
    assert.deepEqual(p.chat.turns.map((/** @type {any} */ t) => [t.n, t.clientLabel]), [[1, "New name"], [2, null], [3, null]], "the Reload's turns stand");
    assert.equal(p.asked[3], "/sessions/s1/transcript?work=held&written=m.3", "and the turns written since the Reload's are read");
    assert.equal(p.chat.served?.version, "m.4");
    assert.equal(p.chat.served?.byId.get(101).clientLabel, "New name");
  });

  // (fails before: yes — as above, at the version the Reload read too)
  test("one past the version a Reload read as well is put together with the Reload's turns at once", async () => {
    const reload = later(), end = later();
    const p = page([{ ...base, turns: [row(1, { clientLabel: "Old name" }), row(2)], version: "m.2" }, reload.answer, end.answer]);
    await p.hydrate(p.chat);
    const reloading = p.hydrate(p.chat, { whole: true });
    const ending = p.hydrate(p.chat);
    reload.land({ ...base, turns: [row(1, { clientLabel: "New name" }), row(2)], version: "m.2" });
    await reloading;
    end.land({ ...base, turns: [row(3)], written: "m.2", ids: [101, 102, 103], runs: [], version: "m.3" });
    await ending;
    assert.deepEqual(p.chat.turns.map((/** @type {any} */ t) => [t.n, t.clientLabel]), [[1, "New name"], [2, null], [3, null]]);
    assert.equal(p.asked.length, 3, "nothing read again");
  });
});

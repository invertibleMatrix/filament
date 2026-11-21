// @ts-check
// An ended turn's read leaves its sub-agents' own calls apart (services/runs.js `calls: "apart"`; the owner's of 11-17:
// one turn's 29,521 calls were 54 of its log's 64 MB, read and aligned for cards nobody opened): each card counts them as
// its run did, a card reads its launching call's as it opens, and Find reads every card's before it searches
// (labels.js `fillCalls`, render.js `readApart`, timeline.js `fillApart`). The oracle is today's read: whole, aligned —
// a call with pictures, or with no end, comes whole all the same, and the run's end marks what it marked.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunLog } from "../src/services/runs.js";
import { createEventBus } from "../src/services/events.js";
import { runRoutes } from "../src/http/admin/runs.js";
import { createRouter } from "../src/http/router.js";
import { alignEvents, callRev, fillCalls, subsApart } from "../src/ui/harness/lib/labels.js";
import { roundRows, revealCalls, foldCalls } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";
import { askedState } from "../src/ui/harness/conversation/agent-card.js";
import { readCalls, callsByLaunch } from "../src/ui/harness/lib/run-calls.js";
import { removeDirs } from "./helpers/wait.js";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {string[]} */
const made = [];
after(() => removeDirs(...made.reverse()));

/** A run log in a folder of its own. @param {any} [knobs] */
const logOf = (knobs = {}) => {
  const data = mkdtempSync(join(tmpdir(), "filament-calls-apart-"));
  made.push(data);
  const bus = createEventBus();
  const config = () => ({ observability: { runEvents: { persist: true, retentionDays: 3650, maxPerRun: 20000, keepRuns: 50, ...knobs } } });
  return { data, bus, config, runs: createRunLog({ events: bus, dataDir: data, config }) };
};
/** A run of `events`, ended as `end` says (none: still running). @param {any} log @param {string} id @param {any[]} events @param {string | null} [end] */
const record = (log, id, events, end = "done") => {
  log.runs.startRun({ id, kind: "agent-turn", meta: {} });
  for (const e of events) log.bus.publish(`run:${id}`, e);
  if (end) log.runs.endRun(id, { status: end });
};
/**
 * Every page of a read, `limit` at a time, as the page reads them; each page but the last full.
 * @param {any} runs @param {string} id @param {any} opts @param {number} limit
 */
const readAll = (runs, id, opts, limit) => {
  /** @type {any[]} */
  const out = [];
  for (let since = 0; ;) {
    const page = runs.events(id, { since, limit, ...opts });
    out.push(...page.events);
    const last = Number(page.events.at(-1)?.n) || 0;
    if (page.events.length < limit || last <= since) return out;
    since = last;
  }
};
const roundOf = (/** @type {any} */ e) => (Number.isInteger(e.round) ? e.round : 0);
/** The ended run read apart, each sub then filled with its own calls' read, as a card's opening fills it. @param {any} runs @param {string} id @param {number} limit */
const apartThenFilled = (runs, id, limit) => {
  const aligned = alignEvents(readAll(runs, id, { calls: "apart" }, limit));
  for (const sub of subsApart(aligned)) {
    const { round, parent } = sub.apart;
    const own = readAll(runs, id, { calls: "only", of: { round, parent: String(parent) } }, limit).filter((e) => roundOf(e) === round && e.parent === parent);
    const counted = sub.apart.calls;
    assert.equal(fillCalls(sub, own), true);
    assert.equal(counted, sub.order.length, "its card counted what it holds once filled");
  }
  return aligned;
};
/** What an alignment holds of each round's calls and their sub-agents', `apart` aside. @param {any} aligned */
const callsOf = (aligned) =>
  [...aligned.byRound].map(([r, c]) => [
    r,
    [...c.tools].map(([id, t]) => {
      if (!t.sub) return [id, t];
      const { apart, ...sub } = t.sub;
      return [id, { ...t, sub }];
    }),
  ]);

/** A sub-agent's call's start and end. @param {string} parent @param {string} id @param {any} [end] @param {number} [round] */
const call = (parent, id, end = {}, round = 1) => [
  { type: "subagent-tool-start", round, parent, id, name: "read", args: `read ${id}`, card: { kind: "read", title: "Read", subject: `${id}.js` } },
  { type: "subagent-tool-end", round, parent, id, name: "read", ok: true, ms: 4, chars: 9, preview: `the words of ${id}`, ...end },
];
const started = (/** @type {string} */ parent, /** @type {string} */ id, round = 1) => call(parent, id, {}, round)[0];
/** Every way a sub-agent's calls come: two cards interleaved, a failure, a language server's errors, a call with pictures,
 *  one with no end, an end with no start, errors of an id never started, a background sub-agent left running whose
 *  call the run's end leaves unfollowed, a team's workers under one call, a held launch's other round, a card whose
 *  start the log lacks. */
const EVENTS = [
  { type: "round-start", round: 1, blocksBefore: 0 },
  { type: "tool-start", round: 1, id: "a1", name: "agent", args: { brief: "map the parser" } },
  { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", exchange: 0, description: "map the parser", agent: "scout" },
  { type: "tool-start", round: 1, id: "a2", name: "agent", args: { brief: "watch the build" } },
  { type: "subagent-start", round: 1, parent: "a2", agentId: "sa_2", exchange: 0, description: "watch the build", agent: "scout", background: true },
  ...call("a1", "c1"),
  ...call("a2", "d1"),
  ...call("a1", "c2", { ok: false, preview: "no such file" }),
  { type: "subagent-tool-errors", round: 1, parent: "a1", id: "c1", lsp: { file: "c1.js", errors: 2 } },
  ...call("a1", "c3", { images: [{ ref: "pic-c3", mediaType: "image/png" }] }),
  started("a1", "c4"),
  { type: "subagent-tool-errors", round: 1, parent: "a1", id: "zz", lsp: { file: "zz.js", errors: 1 } },
  call("a1", "e9")[1],
  { type: "tool-end", round: 1, id: "a2", name: "agent", ok: true, ms: 10, chars: 5, preview: "launched" },
  started("a2", "d2"),
  { type: "subagent-end", round: 1, parent: "a1", agentId: "sa_1", ok: true, status: "done", ms: 900, rounds: 3, report: "mapped" },
  { type: "tool-end", round: 1, id: "a1", name: "agent", ok: true, ms: 900, chars: 6, preview: "mapped" },
  { type: "round-start", round: 2, blocksBefore: 0 },
  { type: "tool-start", round: 2, id: "t1", name: "agent", args: { brief: "a team" } },
  { type: "subagent-start", round: 2, parent: "t1", agentId: "w_1", exchange: 0, description: "worker one", agent: "scout", team: "k", role: "worker" },
  { type: "subagent-start", round: 2, parent: "t1", agentId: "w_2", exchange: 0, description: "worker two", agent: "scout", team: "k", role: "worker" },
  ...call("t1", "f1", {}, 2),
  ...call("t1", "f2", {}, 2),
  ...call("a1", "h1", {}, 5),
  { type: "round-start", round: 3, blocksBefore: 0 },
  { type: "tool-start", round: 3, id: "x1", name: "agent", args: { brief: "no start of its own" } },
  ...call("x1", "y1", {}, 3),
  { type: "tool-end", round: 2, id: "t1", name: "agent", ok: true, ms: 9, chars: 2, preview: "ok" },
  { type: "tool-end", round: 3, id: "x1", name: "agent", ok: true, ms: 9, chars: 2, preview: "ok" },
];

// (fails before: yes — `calls` was not read: every call came, every time)
test("the apart read, each card then filled with its own calls' read, is today's whole read aligned — every page full but the last", () => {
  const log = logOf();
  record(log, "run-a", EVENTS);
  for (const limit of [3, 7, 5000]) {
    const whole = alignEvents(readAll(log.runs, "run-a", {}, limit));
    assert.deepEqual(callsOf(apartThenFilled(log.runs, "run-a", limit)), callsOf(whole), `pages of ${limit}`);
  }
  const apart = readAll(log.runs, "run-a", { calls: "apart" }, 5000);
  const sent = apart.filter((e) => String(e.type).startsWith("subagent-tool")).map((e) => `${e.type.slice(14)} ${e.parent}/${e.id}`);
  assert.deepEqual(sent, ["start a1/c3", "end a1/c3", "start a1/c4", "start a2/d2", "start a1/h1", "end a1/h1", "start x1/y1", "end x1/y1"], "a picture's, no end's, another round's and a startless card's come whole");
  assert.deepEqual(
    apart.filter((e) => e.type === "subagent-start").map((e) => [e.agentId, e.callsApart]),
    [["sa_1", 5], ["sa_2", 2], ["w_1", 2], ["w_2", undefined]],
    "each card's count on its first start: the distinct ids its starts and ends name",
  );
  const whole = alignEvents(readAll(log.runs, "run-a", {}, 5000));
  const a2 = whole.byRound.get(1).tools.get("a2").sub;
  assert.deepEqual([a2.tools.get("d2").state, whole.byRound.get(1).tools.get("a1").sub.tools.get("c4").state], ["unfollowed", "cut"], "the oracle marks what the run's end marked");
  log.runs.close();
});

test("a paused end, then a done end, with a call unended at each, and calls after the end: the same as today's", () => {
  const log = logOf();
  record(log, "run-p", [...EVENTS.slice(0, 6), started("a1", "p1"), { type: "run-end", status: "paused" }, ...call("a1", "p2"), started("a1", "p3")]);
  log.bus.publish("run:run-p", call("a1", "late")[0]);
  log.bus.publish("run:run-p", call("a1", "late")[1]);
  const whole = alignEvents(readAll(log.runs, "run-p", {}, 5000));
  assert.deepEqual(callsOf(apartThenFilled(log.runs, "run-p", 4)), callsOf(whole));
  log.runs.close();
});

test("read whole: a run still running, a run with a line too large among its calls; a run kept in memory alone, or read from its file after a restart, apart", () => {
  const log = logOf();
  record(log, "run-live", EVENTS, null);
  assert.ok(readAll(log.runs, "run-live", { calls: "apart" }, 5000).every((e) => e.callsApart === undefined), "running: whole");
  const big = [...EVENTS.slice(0, 6), ...call("a1", "huge", { preview: "x".repeat(300 * 1024) }), ...call("a1", "c1")];
  record(log, "run-big", big);
  const read = readAll(log.runs, "run-big", { calls: "apart" }, 5000);
  assert.deepEqual([read.length, read.some((e) => e.callsApart !== undefined)], [readAll(log.runs, "run-big", {}, 5000).length, false], "an envelope among its calls: whole");
  log.runs.close();
  // After a restart the run is its file alone.
  const again = createRunLog({ events: createEventBus(), dataDir: log.data, config: log.config });
  const fresh = logOf();
  record(fresh, "run-a", EVENTS);
  fresh.runs.close();
  const reopened = createRunLog({ events: createEventBus(), dataDir: fresh.data, config: fresh.config });
  assert.ok(readAll(reopened, "run-a", { calls: "apart" }, 5000).some((e) => e.callsApart === 5), "its file alone: apart");
  assert.deepEqual(callsOf(apartThenFilled(reopened, "run-a", 6)), callsOf(alignEvents(readAll(reopened, "run-a", {}, 5000))));
  reopened.close();
  again.close();
  // A file whose run never ended — its process gone —, read after a restart: whole.
  const cut = logOf();
  record(cut, "run-open", EVENTS, null);
  cut.runs.close();
  const after = createRunLog({ events: createEventBus(), dataDir: cut.data, config: cut.config });
  assert.ok(readAll(after, "run-open", { calls: "apart" }, 5000).every((e) => e.callsApart === undefined), "a file not over: whole");
  after.close();
  // A run its ring holds, in memory alone: whole, running or ended — and one whose ring let go of its first events.
  const mem = logOf({ persist: false, maxPerRun: 100 });
  record(mem, "run-going", EVENTS, null);
  record(mem, "run-m", EVENTS);
  const filler = (/** @type {number} */ n, /** @type {number} */ from) => Array.from({ length: n }, (_, i) => ({ type: "notice", round: 1, text: `filler ${from + i}` }));
  // Its launch and calls among what the ring still holds, its first events let go of.
  record(mem, "run-holed", [...filler(100, 0), ...EVENTS.slice(0, 3), ...call("a1", "c1"), ...call("a1", "c2"), ...filler(10, 100), { type: "tool-end", round: 1, id: "a1", name: "agent", ok: true, ms: 9, chars: 2, preview: "ok" }]);
  assert.ok(mem.runs.events("run-holed", { since: 0 })?.events.some((e) => e.type === "subagent-start"), "the ring holds its launch");
  for (const id of ["run-going", "run-m", "run-holed"]) {
    const apart = mem.runs.events(id, { since: 0, calls: "apart" });
    assert.deepEqual(apart, mem.runs.events(id, { since: 0 }), `${id}: whole`);
  }
  assert.ok(mem.runs.events("run-holed", { since: 0 })?.gap, "its ring let go of its first events");
  // A card's read of its launching call's calls from a ring, a few at a time: each page full but the last.
  const a1 = readAll(mem.runs, "run-m", { calls: "only" }, 5000).filter((e) => roundOf(e) === 1 && e.parent === "a1");
  assert.deepEqual(readAll(mem.runs, "run-m", { calls: "only", of: { round: 1, parent: "a1" } }, 3), a1);
  mem.runs.close();
  // A run with no sub-agent, and one whose every call comes whole (pictures, no end): nothing to leave apart, whole.
  const none = logOf();
  record(none, "run-none", [EVENTS[0], { type: "tool-start", round: 1, id: "r1", name: "read" }, { type: "tool-end", round: 1, id: "r1", name: "read", ok: true }]);
  record(none, "run-kept", [...EVENTS.slice(0, 3), ...call("a1", "c3", { images: [{ ref: "pic", mediaType: "image/png" }] }), started("a1", "c4")]);
  for (const id of ["run-none", "run-kept"]) assert.deepEqual(none.runs.events(id, { since: 0, calls: "apart" }), none.runs.events(id, { since: 0 }), `${id}: whole`);
  none.runs.close();
  // A run whose file missed an event (one that would not write) keeps its ring after its end: whole.
  const missed = logOf();
  record(missed, "run-missed", [...EVENTS.slice(0, 10), { type: "notice", round: 1, text: "unwritable", big: 1n }, ...EVENTS.slice(10)]);
  assert.deepEqual(missed.runs.events("run-missed", { since: 0, calls: "apart" }), missed.runs.events("run-missed", { since: 0 }), "its file missed an event: whole");
  missed.runs.close();
  // A file that starts past its run's first event, read after a restart: whole.
  const trim = logOf();
  record(trim, "run-trim", EVENTS);
  trim.runs.close();
  const file = join(trim.data, "runs", "run-trim.jsonl");
  writeFileSync(file, readFileSync(file, "utf8").split("\n").slice(2).join("\n"));
  const trimmed = createRunLog({ events: createEventBus(), dataDir: trim.data, config: trim.config });
  assert.ok(trimmed.events("run-trim", { since: 0 })?.gap, "its file starts past its first event");
  assert.deepEqual(trimmed.events("run-trim", { since: 0, calls: "apart" }), trimmed.events("run-trim", { since: 0 }), "whole");
  trimmed.close();
});

test("a run on file heard after its end: its facts read again as the file grows — a call started after the end comes whole, and apart once it ends", () => {
  const log = logOf();
  record(log, "run-g", EVENTS);
  const countOf = () => readAll(log.runs, "run-g", { calls: "apart" }, 5000).find((e) => e.agentId === "sa_1")?.callsApart;
  const sent = (/** @type {string} */ id) => readAll(log.runs, "run-g", { calls: "apart" }, 5000).filter((e) => e.id === id).map((e) => e.type);
  assert.equal(countOf(), 5);
  const [start, end] = call("a1", "late");
  log.bus.publish("run:run-g", start);
  assert.deepEqual([countOf(), sent("late")], [6, ["subagent-tool-start"]], "started: whole, counted");
  log.bus.publish("run:run-g", end);
  assert.deepEqual([countOf(), sent("late")], [6, []], "ended: apart");
  assert.deepEqual(callsOf(apartThenFilled(log.runs, "run-g", 5000)), callsOf(alignEvents(readAll(log.runs, "run-g", {}, 5000))));
  log.runs.close();
});

test("the route: calls=apart and calls=only with a launching call, as events() answers them; the stream whole", async () => {
  const log = logOf();
  record(log, "run-r", EVENTS);
  const call_ = createRouter(runRoutes(/** @type {any} */ ({ runs: log.runs, sseClients: new Set() })));
  /** @param {string} query */
  const ask = async (query) => {
    const path = "/runs/run-r/events";
    const m = call_("GET", path);
    assert.ok(m);
    let body = "";
    const res = { headersSent: false, writableEnded: false, setHeader() {}, getHeader() {}, writeHead() {}, write: (/** @type {string} */ c) => void (body += c), end: (/** @type {string} */ c = "") => void (body += c), on() {} };
    await m.handler(/** @type {any} */ ({ req: { headers: {}, method: "GET", socket: { remoteAddress: "127.0.0.1" }, on() {} }, res, url: new URL(`http://127.0.0.1${path}?${query}`), path, method: "GET", params: m.params }), /** @type {any} */ ({}));
    return JSON.parse(body).events;
  };
  assert.deepEqual(await ask("since=0&calls=apart"), log.runs.events("run-r", { since: 0, calls: "apart" })?.events);
  const own = await ask("since=0&calls=only&round=1&parent=a1");
  assert.deepEqual(own.map((/** @type {any} */ e) => e.id), ["c1", "c1", "c2", "c2", "c1", "c3", "c3", "c4", "zz", "e9"], "a1's calls of round 1, its errors with them");
  assert.deepEqual((await ask("since=0&calls=only")).length, EVENTS.filter((e) => String(e.type).startsWith("subagent-tool")).length, "every call");
  assert.deepEqual((await ask("since=0")).length, log.runs.events("run-r", { since: 0 })?.events.length, "no calls: whole");
  log.runs.close();
});

test("a fill under another alignment: its new records are its sub's alignment's, a record it held stays itself, and once filled it fills no more", () => {
  const log = logOf();
  record(log, "run-f", EVENTS);
  const aligned = alignEvents(readAll(log.runs, "run-f", { calls: "apart" }, 5000));
  const sub = aligned.byRound.get(1).tools.get("a1").sub;
  const held = sub.tools.get("c3");
  alignEvents([{ type: "round-start", round: 1 }, { type: "tool-start", round: 1, id: "q", name: "read" }]);
  const own = readAll(log.runs, "run-f", { calls: "only", of: { round: 1, parent: "a1" } }, 5000);
  assert.equal(fillCalls(sub, own), true);
  const serial = String(callRev(sub)).split(":")[0];
  assert.deepEqual([...sub.tools.values()].map((t) => String(callRev(t)).split(":")[0]), [...sub.tools.keys()].map(() => serial), "born under the sub's own alignment");
  assert.equal(sub.tools.get("c3"), held, "the picture's record, kept");
  assert.deepEqual(sub.order, ["c1", "c2", "c3", "c4", "e9"]);
  assert.equal(fillCalls(sub, []), false, "filled: no more");
  assert.equal(sub.order.length, 5);
  log.runs.close();
});

test("a card's read asks its launching call's calls, and takes them alone from a host that answers every event; a page that says the run let go of events fails it", async () => {
  const log = logOf();
  record(log, "run-c", EVENTS);
  /** @type {string[]} */
  const asked = [];
  /** A host of today's, or an older one that reads no `calls`. @param {boolean} older */
  const apiOf = (older) => async (/** @type {string} */ path) => {
    const u = new URL(path, "http://x");
    asked.push(u.search);
    const q = u.searchParams;
    const of = q.has("parent") ? { round: Number(q.get("round")), parent: String(q.get("parent")) } : null;
    return log.runs.events("run-c", { since: Number(q.get("since")), limit: Number(q.get("limit")), ...(older ? {} : { calls: "only", of }) });
  };
  const want = readAll(log.runs, "run-c", { calls: "only", of: { round: 1, parent: "a1" } }, 5000).filter((e) => roundOf(e) === 1 && e.parent === "a1");
  assert.deepEqual(await readCalls(apiOf(false), "run-c", { round: 1, parent: "a1" }), want);
  assert.deepEqual(asked, ["?since=0&limit=5000&calls=only&round=1&parent=a1"]);
  assert.deepEqual(await readCalls(apiOf(true), "run-c", { round: 1, parent: "a1" }), want, "an older host's whole answer, its calls alone");
  const all = await readCalls(apiOf(true), "run-c");
  assert.deepEqual(all, readAll(log.runs, "run-c", { calls: "only" }, 5000), "every call, Find's read");
  const by = callsByLaunch(all);
  assert.deepEqual([...by.keys()], [1, 2, 5, 3]);
  assert.deepEqual(by.get(1)?.get("a1"), want);
  await assert.rejects(readCalls(async () => ({ events: [], gap: { requested: 0, firstAvailable: 9 } }), "run-c", { round: 1, parent: "a1" }), /no longer holds/);
  log.runs.close();
});

test("an agent the main agent asked, left running, its calls apart: its line says it made them", () => {
  const running = (/** @type {any} */ apart) => askedState(/** @type {any} */ ({ order: [], tools: new Map(), apart }), { running: true, listed: false, row: null }).live;
  assert.equal(running({ calls: 3, filled: false }), "Thinking…");
  assert.equal(running({ calls: 0, filled: false }), "Starting…");
  assert.equal(running(undefined), "Starting…");
});

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const g = /** @type {any} */ (globalThis);
/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {typeof import("../src/ui/harness/conversation/timeline.js").createTimeline} */
let createTimeline;
before(async () => {
  dom = stubDocument();
  Object.assign(g.window, {
    setInterval: (/** @type {any} */ fn, /** @type {number} */ ms) => { const t = setInterval(fn, ms); t.unref?.(); return t; },
    clearInterval,
    setTimeout: (/** @type {any} */ fn, /** @type {number} */ ms) => { const t = setTimeout(fn, ms); t.unref?.(); return t; },
    clearTimeout,
  });
  ({ createTimeline } = await import("../src/ui/harness/conversation/timeline.js"));
});
after(() => dom.restore());
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};
const pageLog = logOf();
record(pageLog, "run-page", EVENTS);
/** The run read as the page reads an ended turn's, or whole as it read it before. @param {boolean} apart */
const alignedOf = (apart) => alignEvents(readAll(pageLog.runs, "run-page", apart ? { calls: "apart" } : {}, 5000));
/** A launching call's own calls, as a card's read asks them. @param {number} round @param {any} parent */
const ownCalls = (round, parent) => readAll(pageLog.runs, "run-page", { calls: "only", of: { round, parent: String(parent) } }, 5000).filter((e) => roundOf(e) === round && e.parent === parent);
const foldOf = (/** @type {any} */ el) => (el.classList.contains("sub-drew") ? el.children[0] : el);
const callRows = (/** @type {any} */ el) => [...(el.querySelector('.tool-children[data-key="calls"]')?.querySelectorAll(".tool-row") || [])].map((r) => String(r.textContent));
const listWords = (/** @type {any} */ el) => String(el.querySelector('.tool-children[data-key="calls"]')?.textContent ?? "");
const lineOf = (/** @type {any} */ card) => String(foldOf(card).querySelector("summary").textContent);
/** A press on a card's row that opens or closes it, as the person's, which the card keeps. @param {any} card @param {boolean} open */
const press = (card, open) => {
  const fold = foldOf(card);
  fold.querySelector("summary").dispatch("click");
  fold.open = open;
  fold.dispatch("toggle");
};
/** Round 1's cards, drawn as the timeline draws them and placed on the page. @param {any} aligned @param {Map<string, any>} [drawn] */
const drawRound = (aligned, drawn = new Map()) => {
  const rows = roundRows(aligned.byRound.get(1), { drawn, runId: "run-page" });
  document.body.append(...rows);
  return rows;
};
/** The card of a sub-agent among `rows`. @param {any[]} rows @param {string} agentId */
const cardOf = (rows, agentId) => rows.find((r) => r.getAttribute?.("data-agent") === `${agentId}:0`);
/** The rows a card shows opened — closed again after, as the person left it. @param {any} card */
const openedRows = async (card) => {
  press(card, true);
  await settle();
  const rows = callRows(card);
  press(card, false);
  return rows;
};

// (fails before: yes — the card counted the calls its read held, and opened onto the rows it held)
test("a card whose calls came apart: its line as today's; opened, a moment's words, then today's rows, from one read however often it opens", async () => {
  const rows = drawRound(alignedOf(true));
  const whole = drawRound(alignedOf(false));
  assert.deepEqual(rows.map(lineOf), whole.map(lineOf), "the closed cards' lines");
  const want = await openedRows(cardOf(whole, "sa_1"));
  /** @type {any[]} */
  const asked = [];
  /** @type {(v: any) => void} */
  let answer = () => {};
  chipActions.readCalls = (runId, of) => {
    asked.push([runId, of.round, of.parent]);
    return new Promise((r) => (answer = r));
  };
  const card = cardOf(rows, "sa_1");
  try {
    press(card, true);
    assert.equal(listWords(card), "Reading its calls…");
    press(card, false);
    press(card, true);
    await settle();
    answer(ownCalls(1, "a1"));
    await settle();
    assert.deepEqual(asked, [["run-page", 1, "a1"]], "one read");
    assert.deepEqual(callRows(card), want, "today's rows");
    press(card, false);
    press(card, true);
    assert.deepEqual([asked.length, callRows(card)], [1, want], "opened again: no read");
    // Closed before its read lands: it holds no rows, and opened draws them with no read.
    const other = cardOf(drawRound(alignedOf(true)), "sa_1");
    press(other, true);
    await settle();
    press(other, false);
    answer(ownCalls(1, "a1"));
    await settle();
    assert.deepEqual([asked.length, callRows(other)], [2, []], "closed: no rows");
    press(other, true);
    assert.deepEqual([asked.length, callRows(other)], [2, want]);
    press(other, false);
  } finally {
    press(card, false);
    chipActions.readCalls = null;
  }
});

test("a read that fails says so, and the card's next opening reads again; a card drawn anew while it reads takes the rows", async () => {
  const aligned = alignedOf(true);
  const card = cardOf(drawRound(aligned), "sa_1");
  const want = await openedRows(cardOf(drawRound(alignedOf(false)), "sa_1"));
  let fails = true;
  let reads = 0;
  /** @type {(v: any) => void} */
  let answer = () => {};
  chipActions.readCalls = () => {
    reads++;
    return fails ? Promise.reject(new Error("offline")) : new Promise((r) => (answer = r));
  };
  /** @type {any} */
  let again = null;
  try {
    press(card, true);
    await settle();
    assert.match(listWords(card), /could not be read/);
    press(card, false);
    fails = false;
    press(card, true);
    assert.equal(listWords(card), "Reading its calls…");
    // The turn drawn anew while its read is out: the old card off the page, the new one drawn open as it was left.
    card.remove();
    again = cardOf(drawRound(aligned), "sa_1");
    assert.notEqual(again, card);
    assert.equal(foldOf(again).open, true);
    assert.equal(listWords(again), "Reading its calls…");
    await settle();
    answer(ownCalls(1, "a1"));
    await settle();
    assert.equal(reads, 2, "the read on its way, shared");
    assert.deepEqual(callRows(again), want);
  } finally {
    press(again || card, false);
    chipActions.readCalls = null;
  }
});

// (fails before: yes — Fable 5.2's review of 9b: the failure's words stood over rows Find had filled meanwhile)
test("a card whose read fails after Find filled it meanwhile shows its rows", async () => {
  const aligned = alignedOf(true);
  const card = cardOf(drawRound(aligned), "sa_1");
  const want = await openedRows(cardOf(drawRound(alignedOf(false)), "sa_1"));
  /** @type {(e: any) => void} */
  let fail = () => {};
  chipActions.readCalls = () => new Promise((_, no) => (fail = no));
  try {
    press(card, true);
    await settle();
    const sub = aligned.byRound.get(1).tools.get("a1").sub;
    assert.equal(fillCalls(sub, ownCalls(1, "a1")), true);
    fail(new Error("offline"));
    await settle();
    assert.deepEqual(callRows(card), want);
  } finally {
    press(card, false);
    chipActions.readCalls = null;
  }
});

// (fails before: yes — Fable 5.2's review of 9b: a card whose end the list gave holds a copy of its sub)
test("a background agent left running, its end the list's: its card holds a copy, which the fill reaches; opened again, or drawn anew, no second read", async () => {
  chipActions.subagentRow = (id) => (id === "sa_2" ? /** @type {any} */ ({ id: "sa_2", exchanges: [{ status: "done", report: "built it", startedAt: 1, endedAt: 9, rounds: 2, tokensIn: 3, tokensOut: 4 }] }) : null);
  let reads = 0;
  chipActions.readCalls = (runId, of) => {
    reads++;
    return Promise.resolve(ownCalls(of.round, of.parent));
  };
  try {
    const aligned = alignedOf(true);
    const want = cardOf(drawRound(alignedOf(false)), "sa_2");
    const wantRows = await openedRows(want);
    const card = cardOf(drawRound(aligned), "sa_2");
    assert.equal(lineOf(card), lineOf(want));
    assert.match(lineOf(card), /7 tokens/, "its end, the list's");
    assert.deepEqual(await openedRows(card), wantRows);
    assert.deepEqual(await openedRows(card), wantRows);
    assert.deepEqual(await openedRows(cardOf(drawRound(aligned), "sa_2")), wantRows);
    assert.equal(reads, 1, "the alignment's own sub filled");
    assert.deepEqual(subsApart(aligned).map((s) => s.apart.parent), ["a1", "t1"], "the others still apart");
  } finally {
    chipActions.subagentRow = null;
    chipActions.readCalls = null;
  }
});

test("Find: a closed card's calls that came apart are found once they are filled, and not before", () => {
  const aligned = alignedOf(true);
  const root = /** @type {any} */ (document.createElement("div"));
  document.body.append(root);
  root.append(...roundRows(aligned.byRound.get(1), { drawn: new Map(), runId: "run-page" }));
  assert.equal(revealCalls(root, "words of c1"), 0, "apart: not among what the card holds");
  for (const sub of subsApart(aligned)) fillCalls(sub, ownCalls(sub.apart.round, sub.apart.parent));
  assert.equal(revealCalls(root, "words of c1"), 1);
  assert.ok(callRows(cardOf([...root.children], "sa_1")).some((r) => r.includes("c1.js")));
  foldCalls(root);
});

/** The globals a drawn timeline reads that node lacks. */
const pageGlobals = () => {
  g.requestAnimationFrame ||= () => 0;
  g.cancelAnimationFrame ||= () => {};
  g.IntersectionObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.ResizeObserver ||= class { observe() {} unobserve() {} disconnect() {} };
  g.getComputedStyle ||= () => ({});
  g.localStorage ||= { getItem: () => null, setItem() {}, removeItem() {} };
  g.sessionStorage ||= g.localStorage;
  Object.assign(g.window, { getSelection: () => ({ toString: () => "", removeAllRanges() {}, rangeCount: 0 }) });
  const d = /** @type {any} */ (document);
  d.addEventListener ||= () => {};
  d.removeEventListener ||= () => {};
};

// (fails before: yes — Fable 5.2's review of 9b: a run read that landed while Find was open left its cards' calls apart)
test("Find on the timeline: its read waits for a run read on its way and fills every card from one read of the run's calls; a run read while it is open comes whole", async () => {
  pageGlobals();
  const realFetch = g.fetch;
  /** @type {string[]} */
  const asked = [];
  g.fetch = async (/** @type {string} */ url) => {
    const u = new URL(String(url), "http://x");
    asked.push(u.search);
    const q = u.searchParams;
    const calls = q.get("calls") === "only" ? "only" : q.get("calls") === "apart" ? "apart" : "all";
    const of = calls === "only" && q.has("parent") ? { round: Number(q.get("round")) || 0, parent: String(q.get("parent")) } : null;
    const page = pageLog.runs.events("run-page", { since: Number(q.get("since")) || 0, limit: Number(q.get("limit")) || 5000, calls, of, graphs: q.get("graphs") === "last" ? "last" : "all" });
    return new Response(JSON.stringify(page), { status: 200, headers: { "content-type": "application/json" } });
  };
  /** A settled turn of the run. @param {number} n */
  const turnOf = (n) => /** @type {any} */ ({ n, status: "done", past: false, runId: "run-page", blocks: [{ type: "text", text: "Done." }], steers: [], segments: [], boundaries: [], boundariesAfter: [], startedAt: Date.UTC(2026, 10, 17) });
  const root = /** @type {any} */ (document.createElement("div"));
  document.body.append(root);
  const tl = createTimeline(root, /** @type {any} */ ({}));
  try {
    const turn = { ...turnOf(1), aligned: alignedOf(true) };
    /** @type {(v?: any) => void} */
    let landed = () => {};
    turn.runRead = new Promise((r) => (landed = r));
    // An alignment carried from the chat's last reading (lib/turn-reads.js): drawn before its run is asked.
    const carried = { ...turnOf(2), aligned: alignedOf(true) };
    tl.render(/** @type {any} */ ({ chainId: "c9", turns: [turn, carried], live: null }));
    await settle();
    assert.equal(carried.runRead, undefined, "drawn, its run not asked");
    asked.length = 0;
    chipActions.readCalls = () => Promise.reject(new Error("not asked"));
    const brought = tl.readWork();
    await settle();
    assert.deepEqual(subsApart(carried.aligned), [], "the carried turn's cards, filled at once");
    assert.equal(subsApart(turn.aligned).length, 3, "the other's wait for the run read on its way");
    landed();
    assert.equal(await brought, 6, "each turn's three cards whose calls came apart, filled and counted");
    assert.deepEqual(subsApart(turn.aligned), [], "none apart");
    assert.deepEqual(asked.map((a) => new URLSearchParams(a).get("calls")), ["only", "only"], "one read of its run's calls each");
    asked.length = 0;
    tl.revealWork("words of c1");
    assert.equal(asked.length, 0, "a card found reads nothing");
    assert.match(String(root.textContent), /the words of c1/);
    // A run read while Find is open comes whole: its cards hold every call.
    const later = turnOf(3);
    await tl.loadRun(later);
    assert.deepEqual(asked.map((a) => new URLSearchParams(a).get("calls")), [null]);
    assert.deepEqual(subsApart(later.aligned), []);
    assert.equal(later.aligned.byRound.get(1).tools.get("a1").sub.order.length, 5);
    tl.foldWork();
  } finally {
    g.fetch = realFetch;
    chipActions.readCalls = null;
  }
});

test("the page reads an ended turn's calls apart, but whole while Find is open", () => {
  const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
  assert.match(timeline, /const calls = findOpen \? "" : "&calls=apart";\n\s*for \(let since = 0; ;\) \{\n\s*const page = await api\(`\/runs\/\$\{encodeURIComponent\(runId\)\}\/events\?since=\$\{since\}&limit=\$\{RUN_PAGE\}&graphs=last\$\{calls\}`\);/);
});

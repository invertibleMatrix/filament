// @ts-check
// What the chats were owed reaches them after a restart, once each, without a stampede (sessions/owed-wakes.js; the
// nudge map of 11-10, a second opinion's too: "Nothing wakes a chat after a restart"). Through a real Filament stopped
// and started again on its data: a report whose wake had not gone wakes its chat; a come-back whose time came while
// Filament was not running comes once, saying it came late; an idle check-in set over a running command is armed again
// and tells the agent the restart ended it; a driving goal's owed round goes; a chat the person stopped is not woken,
// and its report waits. The chats go on a stagger apart, and a later start wakes none of them again. A chat the start
// does not go on with — Go on after a restart off, left over a day, a team's chat — is not woken later by a timer armed
// again for it either; what comes for it since — another chat's letter — wakes it as any chat, and what was held rides
// that turn; bringing it back from the archive lets go of the hold. Also here: a crash in place of a stop, and the cap
// on how long a cut turn that is slow to go on holds the others' wakes.
// (fails before: yes — nothing woke a chat after a restart: the report waited for the person's next message, and the
// come-back and the idle check-in were gone)
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { ANY_WAKE_LINE, LETTER_WAKE_LINE, REPORT_WAKE_LINE, TIME_WAKE_LINE, WAKE_LINE } from "../src/app/sessions/wake.js";
import { FLOW_WAITS, RESUME_LINE, TEAM_WAITS } from "../src/app/sessions/resume-cut.js";
import { tellLater } from "../src/adapters/tools/hands.js";
import { newGoal } from "../src/services/memory/goal.js";
import { DRIVE_MS } from "../src/core/goal-drive.js";

const MINUTE_MS = 400;
const STAGGER_MS = 1000;
/** A command that runs until Filament stops it (a name, not a path: a Windows path's backslashes are escapes in the line). */
const RUNS = `node -e "setInterval(()=>{},50)"`;
const sleepMs = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
const lastSaid = (/** @type {any} */ body) => JSON.stringify((body?.messages || []).at(-1)?.content ?? "");
const systemOf = (/** @type {any} */ body) => (Array.isArray(body?.system) ? body.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(body?.system || ""));
const REPORT = "[Filament: sub-agent sa_owed1 (\"Audit\") reported:]\n\nSUB REPORT: the folder is clean.";

test("after a restart: a waiting report wakes its chat, a come-back that came meanwhile comes late, an idle check-in tells of the restart, a stopped chat waits — a stagger apart, and once", async () => {
  /** When each kind of wake reached the model, by its line. @type {Map<string, number[]>} */
  const wakesAt = new Map();
  const up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
    const last = lastSaid(call.body);
    // A round's line, wherever it rides in the message: the first turn after a restart carries more beside it.
    const round = /goal round (\d+) of \d+/.exec(last);
    if (round) {
      wakesAt.set("goal", [...(wakesAt.get("goal") || []), Date.now()]);
      return anthropicReply(`Round ${round[1]}: the parser ships.\n\n[goal: done]`, { model: "m-1" });
    }
    for (const [key, line] of [["report", REPORT_WAKE_LINE], ["time", TIME_WAKE_LINE], ["exit", WAKE_LINE], ["any", ANY_WAKE_LINE]])
      if (last.includes(line.slice(0, 60))) {
        wakesAt.set(key, [...(wakesAt.get(key) || []), Date.now()]);
        return anthropicReply(`HEARD-${key}`, { model: "m-1" });
      }
    if (last.includes("come back later.")) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "cb-1", name: "come_back", input: { seconds: 60, note: "check the deploy" } }] });
    if (last.includes("start the build.")) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "bb-1", name: "bash_background", input: { command: RUNS } }] });
    return anthropicReply("OK.", { model: "m-1" });
  });
  const root = mkdtempSync(join(tmpdir(), "filament-owed-"));
  const configure = (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
    // 20 "minutes" of 400 ms: the check-in is due 8 s after its turn ends, past the restart.
    cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 20 };
  };
  const overrides = { idleWakeMinuteMs: MINUTE_MS, owedStaggerMs: STAGGER_MS };
  let shim = await startApp({ memory: true, keep: true, configure, overrides });
  const dataDir = shim.dataDir;
  const transcript = async (/** @type {string} */ id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json());
  const turnsDone = (/** @type {string} */ id, /** @type {number} */ n) =>
    until(async () => {
      const t = await transcript(id);
      return (t.turns || []).length >= n && t.turns.slice(0, n).every((/** @type {any} */ x) => x.final) ? t : null;
    }, `the chat's turn ${n}`, { timeoutMs: 30_000 });
  const chat = async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
  const send = async (/** @type {string} */ id, /** @type {string} */ content) => {
    const r = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  const owedOf = (/** @type {string} */ id) => shim.app.memory.archive?.metaOf(id, ["owedWakes"])?.owedWakes;
  const queued = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${id}/subagents`)).json()).queued;
  try {
    // A report came for chat a while no turn ran, and its wake had not gone when Filament stopped: its queue keeps it,
    // owed a wake, as the registry keeps a report whose wake waits.
    const a = await chat();
    await send(a, "hello");
    shim.app.sessions.saveSubagentQueue(a, [/** @type {any} */ ({ text: REPORT, from: "sa_owed1", description: "Audit", kind: "report", wakes: true })]);
    // Chat b's agent set its come-back: kept with the chat as it was set; its time passes while Filament is not running.
    const b = await chat();
    await send(b, "come back later.");
    const kept = owedOf(b)?.comeBack;
    assert.ok(kept?.id && kept.at > Date.now(), `kept as it was set: ${JSON.stringify(owedOf(b))}`);
    shim.app.memory.archive?.mergeMeta(b, { owedWakes: { ...owedOf(b), comeBack: { ...kept, at: Date.now() - 5 * 60_000, setAt: Date.now() - 6 * 60_000 } } });
    // Chat c's agent ended its turn with its build running: its idle check-in is kept, due past the restart.
    const c = await chat();
    await send(c, "start the build.");
    await until(() => owedOf(c)?.idle?.at || null, "the check-in kept");
    // Chat d had a report waiting too, and the person stopped it.
    const d = await chat();
    await send(d, "hello");
    const stop = await shim.api(`/api/sessions/${d}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    shim.app.sessions.saveSubagentQueue(d, [/** @type {any} */ ({ text: REPORT, from: "sa_owed1", description: "Audit", kind: "report", wakes: true })]);
    // Chat e's goal drives, and its next round was owed as Filament stopped: kept with the chat, as a turn's end owes it.
    const e = await chat();
    await send(e, "hello");
    /** @type {any} */ (shim.app).memory.setGoal(e, { ...newGoal("the parser ships", { now: Date.now() }), status: "active", acceptedAt: Date.now(), drive: { on: true, round: 1, cap: 20, halted: null } });
    shim.app.memory.archive?.mergeMeta(e, { goalOwed: true });
    // Chat f's goal drove too, its round owed — but its 2 hours ran out while Filament was down (11-10).
    const f = await chat();
    await send(f, "hello");
    /** @type {any} */ (shim.app).memory.setGoal(f, { ...newGoal("the docs ship", { now: Date.now() }), status: "active", acceptedAt: Date.now(), drive: { on: true, round: 3, cap: 20, since: Date.now() - DRIVE_MS - 60_000, halted: null } });
    shim.app.memory.archive?.mergeMeta(f, { goalOwed: true });
    // Chat g had a waking report too — but the person last wrote in it two days ago (FabeleHelper's of 11-10).
    const g = await chat();
    await send(g, "hello");
    shim.app.memory.archive?.mergeMeta(g, { personAt: Date.now() - 2 * 24 * 60 * 60_000 });
    shim.app.sessions.saveSubagentQueue(g, [/** @type {any} */ ({ text: REPORT, from: "sa_owed2", description: "Audit", kind: "report", wakes: true })]);
    await shim.stop();

    shim = await startApp({ memory: true, keep: true, dataDir, configure, overrides });
    const swept = await shim.app.owedWokenAtStart;
    assert.deepEqual(
      swept.filter((x) => [a, b, d].includes(x.chainId)).map((x) => [x.chainId, x.woke, x.why ?? null]),
      [
        [a, true, null],
        [b, true, null],
        [d, false, "the person stopped its newest turn"],
      ],
      JSON.stringify(swept),
    );

    // The report, ahead of Filament's line for it; the agent read it, and nothing waits.
    const ta = await turnsDone(a, 2);
    assert.equal(ta.turns[1].woke, true, "a turn of Filament's");
    const ua = JSON.stringify(ta.turns[1].user);
    assert.ok(ua.includes("SUB REPORT") && ua.indexOf("SUB REPORT") < ua.indexOf(REPORT_WAKE_LINE.slice(0, 60)), ua);
    assert.match(JSON.stringify(ta.turns[1].final), /HEARD-report/);
    assert.equal(await queued(a), 0);

    // The come-back, once, in words that say it came late.
    const tb = await turnsDone(b, 2);
    assert.equal(tb.turns[1].woke, true);
    const ub = JSON.stringify(tb.turns[1].user);
    assert.match(ub, /the time you set has come — 6 min ago you asked to come back to this chat\. It was due 5 min ago, while Filament was not running, so it comes late\. Your note: check the deploy/);
    assert.ok(ub.includes(TIME_WAKE_LINE), ub);

    // A stagger apart: the second chat's wake was sent a second after the first's. Measured where Filament took them —
    // when each wake's turn reached its route, which its record keeps (`view.timing.receivedAt`) — not where the model
    // heard them: what each turn does before its model call is load's to stretch (441 ms apart at the model under a
    // parallel run, 11-10). (The review of 11-11: heard on the `turns` topic, the first could be sent before the test
    // listened, as the sweep starts inside the start the test waits for.)
    const wokenAt = async (/** @type {any} */ t) => Number((await shim.record(String(t.turns[1].requestIds[0]))).view?.timing?.receivedAt);
    const [sa, sb] = [await wokenAt(ta), await wokenAt(tb)];
    assert.ok(sa && sb && sb - sa >= STAGGER_MS - 200, `woken ${sb - sa} ms apart`);

    // The idle check-in, armed again: at its time it tells the agent the restart ended its build, beside the restart's
    // own word of it.
    const tc = await turnsDone(c, 2);
    assert.equal(tc.turns[1].woke, true);
    const uc = JSON.stringify(tc.turns[1].user);
    assert.match(uc, /min since your turn ended, and Filament restarted meanwhile: the background command you left running ran under the Filament that stopped, which ended it — `node -e \\"setInterval/);
    assert.match(uc, /was running when Filament last stopped: Filament no longer follows it/);
    assert.ok(uc.includes(WAKE_LINE), "told as its command's end");

    // The stopped chat is not woken: its report waits for the person's next message.
    await sleepMs(1500);
    assert.equal((await transcript(d)).turns.length, 1, "no turn of Filament's");
    assert.equal(await queued(d), 1);

    // The goal's owed round, sent as its waker sends one: round 2, which halts it done; owed no more.
    const te = await turnsDone(e, 2);
    assert.match(JSON.stringify(te.turns[1].user), /goal round 2 of 20/);
    assert.equal(/** @type {any} */ (shim.app).memory.goalFor(e)?.drive?.halted?.kind, "done");
    assert.equal(shim.app.sessions.goalOwed(e), false);
    assert.equal(shim.app.memory.archive?.metaOf(e, ["goalOwed"])?.goalOwed, undefined, "the round's turn took it, and the chat keeps it no more");

    // f's drive halted for its time, as a turn's end would have: no round sent, owed no more, its line left for the agent.
    const gf = /** @type {any} */ (shim.app).memory.goalFor(f)?.drive;
    assert.deepEqual([gf?.halted?.kind, gf?.halted?.told ?? null, shim.app.sessions.goalOwed(f)], ["time", null, false]);
    assert.equal((await transcript(f)).turns.length, 1, "no round of Filament's");
    assert.equal(shim.app.memory.archive?.metaOf(f, ["goalOwed"])?.goalOwed, undefined, "kept owed no more");

    // g is left for the person's next message: its report waits, said why in the sweep.
    assert.match(String(swept.find((x) => x.chainId === g)?.why), /^the person last wrote in it, and any come-back it set came due, over 24 h ago \(4[78] h\)$/);
    assert.equal((await transcript(g)).turns.length, 1, "not woken");
    assert.equal(await queued(g), 1);

    // Once each: nothing more came, and nothing is owed any more.
    assert.deepEqual(["report", "time", "exit", "any", "goal"].map((k) => (wakesAt.get(k) || []).length), [1, 1, 1, 0, 1]);
    for (const id of [a, b, c]) assert.equal((await transcript(id)).turns.length, 2, `${id}: one wake`);
    for (const id of [a, b, c]) assert.equal(owedOf(id), undefined, `${id}: nothing kept owed`);
    await shim.stop();

    // A later start wakes none of them again.
    shim = await startApp({ memory: true, keep: true, dataDir, configure, overrides });
    const again = await shim.app.owedWokenAtStart;
    assert.deepEqual(again.filter((x) => x.woke).map((x) => x.chainId), [], JSON.stringify(again));
    await sleepMs(1500);
    for (const id of [a, b, c, e]) assert.equal((await transcript(id)).turns.length, 2, `${id}: not again`);
    // g still owed, and still left: a restart never makes it fresh again.
    assert.deepEqual(again.filter((x) => x.chainId === g).map((x) => x.woke), [false]);
    assert.equal((await transcript(g)).turns.length, 1);

    // With Go on after a restart off, nothing starts by itself: g, written in just now, is still left (FabeleHelper's).
    shim.app.memory.archive?.mergeMeta(g, { personAt: Date.now() });
    await shim.stop();
    shim = await startApp({ memory: true, keep: true, dataDir, configure: (/** @type {any} */ cfg) => (configure(cfg), (cfg.sessions = { ...cfg.sessions, resumeAfterRestart: false })), overrides });
    const off = await shim.app.owedWokenAtStart;
    assert.deepEqual(off.filter((x) => x.chainId === g).map((x) => [x.woke, x.why]), [[false, "Go on after a restart is off"]], JSON.stringify(off));
  } finally {
    await shim.stop();
    await up.close();
    await removeDirs(dataDir, root);
  }
});

/** How far past the moment it is kept a timer is set to come in the tests below: past the restart and its sweep. */
const AHEAD_MS = 6000;
/** A command that ends soon after its turn did: its end wakes its chat. */
const QUICK = `node -e "setTimeout(()=>{},1500)"`;

/**
 * A Filament stopped and started again on its data, for the chats the start does not go on with: `ask` sets a chat up
 * on the first, `again` starts the next with the config `cfg` changes.
 */
const restartRig = async (/** @type {((cfg: any) => void) | undefined} */ base = undefined) => {
  /** What the summary of a session past its line waits for, written before its turn goes on: nothing, until a test holds it (`holdSummary`). */
  let summaryWaits = Promise.resolve();
  const up = await fakeUpstream(async (call) => {
    if (call.kind !== "anthropic") return undefined;
    if (systemOf(call.body).includes("compaction summaries")) {
      await summaryWaits;
      return anthropicReply("<summary>\nSUMMARY-OF-EARLIER-TURNS\n</summary>", { model: "m-1" });
    }
    if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
    const last = lastSaid(call.body);
    if (last.includes(RESUME_LINE.slice(0, 60))) return anthropicReply("WENT ON", { model: "m-1" });
    // A letter: its agent opens the envelope, answers one that asks for a reply, and says what a reply to its own read.
    const envelope = (/** @type {any} */ input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `lt-${up.received.length}`, name: "envelope", input }] });
    const asked = /answer: \\"(lt_[0-9a-f]+)\\"/.exec(last);
    if (asked) return envelope({ answer: asked[1], text: "YES, 7 IS PRIME." });
    if (last.includes("Sent: your reply")) return anthropicReply("ANSWERED", { model: "m-1" });
    if (last.includes("the reply to your letter")) return anthropicReply("GOT THE REPLY", { model: "m-1" });
    if (last.includes(LETTER_WAKE_LINE.slice(0, 50))) return envelope({});
    if (last.includes(REPORT_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-report", { model: "m-1" });
    if (last.includes(TIME_WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-time", { model: "m-1" });
    if (last.includes(WAKE_LINE.slice(0, 60))) return anthropicReply("HEARD-exit", { model: "m-1" });
    // The person tags another chat, and the agent writes it a letter that asks for a reply.
    const asks = /ASK THE OTHER CHAT \[[^\]]*\]\(chat:([^)]+)\)/.exec(last);
    if (asks) return envelope({ to: asks[1], subject: "Is 7 prime?", text: "Please confirm: is 7 prime?", reply: true });
    if (last.includes("come back later.")) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "cb-9", name: "come_back", input: { seconds: 60, note: "check the deploy" } }] });
    if (last.includes("start the build.")) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "bb-9", name: "bash_background", input: { command: RUNS } }] });
    if (last.includes("run the quick one.")) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "bq-1", name: "bash_background", input: { command: QUICK } }] });
    return anthropicReply("OK.", { model: "m-1" });
  });
  const root = mkdtempSync(join(tmpdir(), "filament-owed-held-"));
  /** @param {(cfg: any) => void} [more] */
  const configure = (more) => (/** @type {any} */ cfg) => {
    cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
    cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
    cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    cfg.memory.autopilot = { enabled: false };
    cfg.sessions = { ...cfg.sessions, idleWakeMinutes: 20 };
    base?.(cfg);
    more?.(cfg);
  };
  const overrides = { idleWakeMinuteMs: MINUTE_MS, owedStaggerMs: STAGGER_MS };
  let shim = await startApp({ memory: true, keep: true, configure: configure(), overrides });
  const dataDir = shim.dataDir;
  const r = {
    get shim() {
      return shim;
    },
    root,
    up,
    configure,
    overrides,
    /** A Filament started on `dir` in this one's place, which the caller stopped. @param {string} dir @param {Record<string, unknown>} [more] */
    startOn: async (dir, more = {}) => {
      shim = await startApp({ memory: true, keep: true, dataDir: dir, configure: configure(), overrides: { ...overrides, ...more } });
    },
    queued: async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${id}/subagents`)).json()).queued,
    /** A session's summary held until the function this gives back is called, or `maxMs` passed. @param {number} maxMs */
    holdSummary: (maxMs) => {
      let letGo = () => {};
      summaryWaits = new Promise((done) => {
        const t = setTimeout(done, maxMs);
        letGo = () => (clearTimeout(t), done(undefined));
      });
      return () => letGo();
    },
    /** The chat archived, or brought back. @param {string} id @param {boolean} on */
    archive: async (id, on) => {
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: on } } } });
      assert.equal(res.status, 200, await res.clone().text());
    },
    transcript: async (/** @type {string} */ id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${id}/transcript`)).json()),
    turnsDone: (/** @type {string} */ id, /** @type {number} */ n) =>
      until(async () => {
        const t = await r.transcript(id);
        return (t.turns || []).length >= n && t.turns.slice(0, n).every((/** @type {any} */ x) => x.final) ? t : null;
      }, `the chat's turn ${n}`, { timeoutMs: 30_000 }),
    chat: async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id),
    send: async (/** @type {string} */ id, /** @type {string} */ content) => {
      const res = await shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
    },
    owedOf: (/** @type {string} */ id) => shim.app.memory.archive?.metaOf(id, ["owedWakes"])?.owedWakes,
    /** An idle check-in kept over a command the stop ended, due AHEAD_MS from now. @param {string} id */
    idleAhead: (id) =>
      shim.app.memory.archive?.mergeMeta(id, {
        owedWakes: { ...(r.owedOf(id) || {}), idle: { id: 4242, at: Date.now() + AHEAD_MS, waitMin: 20, streak: 0, commands: [{ id: "bg_dev", command: "npm run dev", startedAt: Date.now() - 60_000 }] } },
      }),
    /** The chat's come-back, kept as its agent set it, due AHEAD_MS from now. @param {string} id */
    comeBackAhead: (id) => {
      const kept = r.owedOf(id)?.comeBack;
      assert.ok(kept?.id, `kept as it was set: ${JSON.stringify(r.owedOf(id))}`);
      shim.app.memory.archive?.mergeMeta(id, { owedWakes: { ...r.owedOf(id), comeBack: { ...kept, at: Date.now() + AHEAD_MS } } });
    },
    /** An idle check-in kept over a command the stop ended, whose time came `ago` before now. @param {string} id @param {number} ago */
    idleOverdue: (id, ago) =>
      shim.app.memory.archive?.mergeMeta(id, {
        owedWakes: { ...(r.owedOf(id) || {}), idle: { id: 4343, at: Date.now() - ago, waitMin: 20, streak: 0, commands: [{ id: "bg_dev", command: "npm run dev", startedAt: Date.now() - 60_000 }] } },
      }),
    /** Filament stopped, and started again under the config `more` changes. @param {(cfg: any) => void} [more] @param {Record<string, unknown>} [over] */
    again: async (more, over = {}) => {
      await shim.stop();
      shim = await startApp({ memory: true, keep: true, dataDir, configure: configure(more), overrides: { ...overrides, ...over } });
    },
    /** @param {string[]} more  folders to remove beside its own */
    close: async (...more) => {
      await shim.stop();
      await up.close();
      await removeDirs(dataDir, root, ...more);
    },
  };
  return r;
};

// (fails before: yes — the review of 11-11: the start's skips held only the chats its sweep woke, and a check-in or a
// come-back armed again for later woke its chat once its time came, though Go on after a restart was off)
test("Go on after a restart off: an idle check-in and a come-back armed again for later wake nothing as they come — they wait for the person's next message, which carries them and makes the chat theirs again", async () => {
  const r = await restartRig();
  try {
    // Chat h's agent left a command running, and Filament's check-in on it is due after the restart.
    const h = await r.chat();
    await r.send(h, "hello");
    // Chat i's agent set its come-back, due after the restart too.
    const i = await r.chat();
    await r.send(i, "come back later.");
    r.idleAhead(h);
    r.comeBackAhead(i);
    await r.again((cfg) => (cfg.sessions = { ...cfg.sessions, resumeAfterRestart: false }));
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(swept.filter((x) => [h, i].includes(x.chainId)), [], "owed nothing now: their timers wait for their time");
    // Armed again past the sweep: what follows is their time coming.
    assert.ok(r.owedOf(h)?.idle?.at > Date.now() && r.owedOf(i)?.comeBack?.at > Date.now(), `still waiting for their time: ${JSON.stringify([r.owedOf(h), r.owedOf(i)])}`);
    await until(() => (r.owedOf(h)?.untold || []).some((/** @type {any} */ x) => x.id === "idle-4242") || null, "h's check-in told", { timeoutMs: 20_000 });
    await until(() => (r.owedOf(i)?.untold || []).some((/** @type {any} */ x) => x.kind === "wake") || null, "i's come-back told", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.deepEqual([(await r.transcript(h)).turns.length, (await r.transcript(i)).turns.length], [1, 1], "no turn of Filament's, in h nor in i");

    // The person's next message carries the check-in, and the chat is theirs again: a command's end wakes it.
    await r.send(h, "run the quick one.");
    const th = await r.turnsDone(h, 3);
    assert.match(JSON.stringify(th.turns[1].user), /Filament restarted meanwhile: the background command you left running ran under the Filament that stopped, which ended it — `npm run dev` \(bg_dev\)/);
    assert.equal(th.turns[2].woke, true, "its command's end woke it");
    assert.match(JSON.stringify(th.turns[2].final), /HEARD-exit/);
    // …and i's next message carries its come-back (the review of 11-11: said of both, shown of one).
    await r.send(i, "hello again");
    const ti = await r.turnsDone(i, 2);
    assert.equal(ti.turns[1].woke, undefined, "the person's own turn");
    assert.match(JSON.stringify(ti.turns[1].user), /the time you set has come — .* you asked to come back to this chat\. Your note: check the deploy/);
    assert.deepEqual([r.owedOf(h)?.untold, r.owedOf(i)], [undefined, undefined], "told, and kept owed no more");
  } finally {
    await r.close();
  }
});

// (fails before: yes — the review of 11-11: a check-in armed again in a chat the person left days ago woke it at its
// time, though the start's sweep left such a chat for the person; and an archived chat owed a wake was woken at the start)
test("a chat the person left over a day ago: its idle check-in armed again wakes nothing as it comes; an archived chat owed a wake is not woken at the start", async () => {
  const r = await restartRig();
  try {
    const j = await r.chat();
    await r.send(j, "hello");
    // A report waits for chat k, which the person archived.
    const k = await r.chat();
    await r.send(k, "hello");
    r.shim.app.sessions.saveSubagentQueue(k, [/** @type {any} */ ({ text: REPORT, from: "sa_owed3", description: "Audit", kind: "report", wakes: true })]);
    const archived = await r.shim.api(`/api/sessions/${encodeURIComponent(k)}/settings`, { method: "PATCH", body: { patch: { display: { archived: true } } } });
    assert.equal(archived.status, 200, await archived.clone().text());
    r.shim.app.memory.archive?.mergeMeta(j, { personAt: Date.now() - 3 * 24 * 60 * 60_000 });
    r.idleAhead(j);
    await r.again();
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(swept.filter((x) => x.chainId === k).map((x) => [x.woke, x.why]), [[false, "the person archived it"]], JSON.stringify(swept));
    assert.deepEqual(swept.filter((x) => x.chainId === j), [], "owed nothing now");
    assert.ok(r.owedOf(j)?.idle?.at > Date.now(), `still waiting for its time: ${JSON.stringify(r.owedOf(j))}`);
    await until(() => (r.owedOf(j)?.untold || []).some((/** @type {any} */ x) => x.id === "idle-4242") || null, "j's check-in told", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.equal((await r.transcript(j)).turns.length, 1, "j: no turn of Filament's");
    assert.equal((await r.transcript(k)).turns.length, 1, "k: no turn of Filament's");
  } finally {
    await r.close();
  }
});

// (fails before: yes — the review of 11-11, of dc9ad0f94: the start's hold on a chat held every wake for as long as
// Filament ran, so a letter another chat's agent wrote it later — its sender told "Its agent was at rest: Filament wakes
// it" — never woke it, and its sender waited for a reply that never came)
test("a chat the start holds is woken by what comes since: another chat's letter wakes it as it would any chat, and what the start held rides that turn", async () => {
  const r = await restartRig();
  try {
    // Chat h's agent set its come-back, due after the restart, which starts with Go on after a restart off.
    const h = await r.chat();
    await r.send(h, "come back later.");
    const a = await r.chat();
    await r.send(a, "hello");
    r.comeBackAhead(h);
    await r.again((cfg) => (cfg.sessions = { ...cfg.sessions, resumeAfterRestart: false }));
    assert.deepEqual((await r.shim.app.owedWokenAtStart).filter((x) => x.chainId === h), [], "owed nothing now");
    // Its come-back comes and wakes nothing: the start gave it back, and holds it.
    await until(() => (r.owedOf(h)?.untold || []).some((/** @type {any} */ x) => x.kind === "wake") || null, "h's come-back told", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.equal((await r.transcript(h)).turns.length, 1, "no turn of Filament's");
    // Another chat's agent writes it a letter that asks for a reply: h is woken for it, as any chat at rest is…
    await r.send(a, `ASK THE OTHER CHAT [the held chat](chat:${h}) whether 7 is prime`);
    const th = await r.turnsDone(h, 2);
    assert.equal(th.turns[1].woke, true, "a turn of Filament's");
    const uh = JSON.stringify(th.turns[1].user);
    assert.ok(uh.includes(LETTER_WAKE_LINE.slice(0, 50)), uh);
    // …and what the start held rides that turn.
    assert.match(uh, /the time you set has come — .* you asked to come back to this chat\. Your note: check the deploy/);
    // Its agent opened the letter and answered it…
    assert.match(JSON.stringify(th.turns[1].final), /ANSWERED/);
    assert.equal(r.owedOf(h), undefined, "nothing kept owed");
    // …and the chat that asked is woken with the reply it was told to wait for.
    await until(async () => ((await r.transcript(a)).turns || []).some((/** @type {any} */ t) => t.woke && /GOT THE REPLY/.test(JSON.stringify(t.final ?? ""))) || null, "the asker woken with the reply", { timeoutMs: 30_000 });
  } finally {
    await r.close();
  }
});

// (fails before: yes — the same: nothing but a turn let go of the start's hold, so a chat the person archived and
// brought back stayed held for as long as Filament ran)
test("un-archiving a chat lets go of the start's hold on it: its come-back armed again wakes it at its time; one that came while it was archived waits for its next turn", async () => {
  const r = await restartRig();
  try {
    const u = await r.chat();
    await r.send(u, "come back later.");
    const k = await r.chat();
    await r.send(k, "come back later.");
    await r.archive(k, true);
    r.comeBackAhead(u);
    r.comeBackAhead(k);
    await r.again((cfg) => (cfg.sessions = { ...cfg.sessions, resumeAfterRestart: false }));
    assert.deepEqual((await r.shim.app.owedWokenAtStart).filter((x) => [u, k].includes(x.chainId)), [], "owed nothing now");
    // The person archives u and brings it back before its come-back's time: the chat is theirs again.
    await r.archive(u, true);
    await r.archive(u, false);
    const tu = await r.turnsDone(u, 2);
    assert.equal(tu.turns[1].woke, true, "its come-back woke it");
    assert.match(JSON.stringify(tu.turns[1].final), /HEARD-time/);
    // k's came while it was archived: told, and no turn of Filament's.
    await until(() => (r.owedOf(k)?.untold || []).some((/** @type {any} */ x) => x.kind === "wake") || null, "k's come-back told", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.equal((await r.transcript(k)).turns.length, 1, "archived: no turn of Filament's");
    // Brought back, nothing starts by itself for what waited: the person's next message carries it.
    await r.archive(k, false);
    await sleepMs(1500);
    assert.equal((await r.transcript(k)).turns.length, 1, "brought back: what waited wakes nothing");
    await r.send(k, "hello again");
    const tk = await r.turnsDone(k, 2);
    assert.match(JSON.stringify(tk.turns[1].user), /the time you set has come — .* Your note: check the deploy/);
  } finally {
    await r.close();
  }
});

// (fails before: yes — the review of 11-11: a team's chat keeps what any chat does, and the start's sweep woke it for a
// report or a come-back, though a team beside a chat goes on only on the person's Resume…, and a flow's box on their Go on)
test("a team's chat and a flow's box keep what any chat does, and the start goes on with neither: what it gave back waits for the person's word", async () => {
  const r = await restartRig();
  try {
    const main = await r.chat();
    await r.send(main, "hello");
    const team = String(r.shim.app.sessions.create({ cwd: r.root, model: "m-1", preset: "plain", kind: "team", beside: main }).id);
    // Its lead sets a come-back, kept with the team's chat as with any chat; a worker's report waits for it too.
    await r.send(team, "come back later.");
    assert.ok(r.owedOf(team)?.comeBack?.id, `a team's chat keeps its come-back: ${JSON.stringify(r.owedOf(team))}`);
    r.shim.app.sessions.saveSubagentQueue(team, [/** @type {any} */ ({ text: REPORT, from: "sa_owed4", description: "Audit", kind: "report", wakes: true })]);
    r.comeBackAhead(team);
    // A flow's team box, with a report waiting.
    const box = String(r.shim.app.sessions.create({ cwd: r.root, model: "m-1", preset: "plain", kind: "team", beside: main }).id);
    await r.send(box, "hello");
    r.shim.app.memory.archive?.mergeMeta(box, { beside: { flow: "fl_1", ask: "Build it", at: Date.now(), firedBy: "you" } });
    r.shim.app.sessions.saveSubagentQueue(box, [/** @type {any} */ ({ text: REPORT, from: "sa_owed5", description: "Audit", kind: "report", wakes: true })]);
    await r.again();
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(
      [team, box].map((id) => swept.filter((x) => x.chainId === id).map((x) => [x.woke, x.why])),
      [[[false, TEAM_WAITS]], [[false, FLOW_WAITS]]],
      JSON.stringify(swept),
    );
    // The team's come-back comes, and wakes nothing either.
    await until(() => (r.owedOf(team)?.untold || []).some((/** @type {any} */ x) => x.kind === "wake") || null, "the team's come-back told", { timeoutMs: 20_000 });
    await sleepMs(1500);
    assert.deepEqual([(await r.transcript(team)).turns.length, (await r.transcript(box)).turns.length], [1, 1], "no turn of Filament's");
    assert.deepEqual([await r.queued(team), await r.queued(box)], [1, 1], "their reports wait");
  } finally {
    await r.close();
  }
});

// (fails before: yes — the review of 11-11: an idle check-in whose time came while Filament was not running was armed
// for a timer's turn later, which came after the sweep where no cut turn went on first: every such chat was woken at
// once, none a stagger apart, and the sweep said nothing of them)
test("idle check-ins whose time came while Filament was not running are the sweep's: woken a stagger apart, not all at once after it", async () => {
  const r = await restartRig();
  try {
    const o1 = await r.chat();
    await r.send(o1, "hello");
    const o2 = await r.chat();
    await r.send(o2, "hello");
    r.idleOverdue(o1, 2000);
    r.idleOverdue(o2, 1000);
    await r.again();
    /** @type {Map<string, number>} */
    const sentAt = new Map();
    const unhear = r.shim.app.events.subscribe("turns", (/** @type {any} */ p, /** @type {any} */ entry) => void (p?.type === "turn" && p.holder && !sentAt.has(p.chainId) && sentAt.set(p.chainId, entry.ts)));
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(swept.filter((x) => [o1, o2].includes(x.chainId)).map((x) => [x.chainId, x.woke]), [[o1, true], [o2, true]], JSON.stringify(swept));
    const t1 = await r.turnsDone(o1, 2);
    await r.turnsDone(o2, 2);
    unhear();
    assert.match(JSON.stringify(t1.turns[1].user), /min since your turn ended, and Filament restarted meanwhile: the background command you left running ran under the Filament that stopped, which ended it — `npm run dev` \(bg_dev\)/);
    const [s1, s2] = [sentAt.get(o1), sentAt.get(o2)];
    assert.ok(s1 && s2 && s2 - s1 >= STAGGER_MS - 200, `woken ${Number(s2) - Number(s1)} ms apart`);
  } finally {
    await r.close();
  }
});

// (fails before: yes — the review of 11-11: a chat that kept no moment of the person's was measured from its newest
// turn at every start, and Filament's own turns move that: woken by a report, it was fresh again at the next start)
test("a chat that kept no moment of the person's is measured from its newest turn that Filament did not start: its own wakes make it no fresher", async () => {
  const r = await restartRig();
  try {
    const m = await r.chat();
    /** @type {any} */
    const archive = r.shim.app.memory.archive;
    const DAY = 24 * 60 * 60_000;
    /** A finished turn of the chat as the archive keeps one, begun at `startedAt`. @param {string} text @param {number} startedAt */
    const turnAt = (text, startedAt) => {
      const t = archive.beginTurn(m, { requestId: `seed-${startedAt}`, model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: { role: "user", content: [{ type: "text", text }] }, startedAt });
      archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: [{ type: "text", text: "OK." }] } });
    };
    // The person wrote three days ago, before chats kept when; a report woke its agent an hour ago, and another waits.
    turnAt("hello", Date.now() - 3 * DAY);
    turnAt(REPORT_WAKE_LINE, Date.now() - 60 * 60_000);
    assert.equal(archive.metaOf(m, ["personAt"])?.personAt, undefined, "no moment of the person's kept");
    r.shim.app.sessions.saveSubagentQueue(m, [/** @type {any} */ ({ text: REPORT, from: "sa_owed6", description: "Audit", kind: "report", wakes: true })]);
    await r.again();
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(swept.filter((x) => x.chainId === m).map((x) => x.woke), [false], JSON.stringify(swept));
    assert.match(String(swept.find((x) => x.chainId === m)?.why), /^its newest turn that Filament did not start by itself began, and any come-back it set came due, over 24 h ago \(7[12] h\)$/);
    await sleepMs(1500);
    assert.equal((await r.transcript(m)).turns.length, 2, "not woken");
    assert.equal(await r.queued(m), 1);
  } finally {
    await r.close();
  }
});

// (fails before: no — what a chat is owed is kept as it changes, not as Filament stops; the restart tests above all
// stopped Filament cleanly, and none showed it)
test("after a crash — Filament's data as it stood, with no stop —: a command's end that waited untold wakes its chat, and an idle check-in over a running command tells of the restart", async () => {
  const r = await restartRig();
  /** The data folder as the crash left it. */
  const crashed = mkdtempSync(join(tmpdir(), "filament-owed-crash-"));
  try {
    // Chat c's agent ended its turn with its build running: its check-in is kept as it is armed.
    const c = await r.chat();
    await r.send(c, "start the build.");
    await until(() => r.owedOf(c)?.idle?.at || null, "the check-in kept");
    // A command's end waits untold for chat q, its wake not yet sent: kept as it came.
    const q = await r.chat();
    await r.send(q, "hello");
    tellLater({ session: q, agent: null }, { id: "bg_crash", command: "npm test", code: 0, text: "[Filament: background shell bg_crash (npm test) exited with code 0.]" }, { now: false });
    assert.deepEqual((r.owedOf(q)?.untold || []).map((/** @type {any} */ x) => x.id), ["bg_crash"], "kept as it came");
    // The crash: the folder as it stands now, which no stop of Filament's ever touches.
    cpSync(r.shim.dataDir, crashed, { recursive: true });
    await r.shim.stop();
    await r.startOn(crashed);
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(swept.filter((x) => x.chainId === q).map((x) => [x.woke, x.why ?? null]), [[true, null]], JSON.stringify(swept));
    const tq = await r.turnsDone(q, 2);
    assert.equal(tq.turns[1].woke, true);
    assert.match(JSON.stringify(tq.turns[1].user), /background shell bg_crash \(npm test\) exited with code 0\./);
    assert.match(JSON.stringify(tq.turns[1].final), /HEARD-exit/);
    // The check-in, armed again: at its time it tells the agent the restart ended its build, beside the restart's own
    // word of the command that ran as Filament went down.
    const tc = await r.turnsDone(c, 2);
    assert.equal(tc.turns[1].woke, true);
    const uc = JSON.stringify(tc.turns[1].user);
    assert.match(uc, /min since your turn ended, and Filament restarted meanwhile: the background command you left running ran under the Filament that stopped, which ended it — `node -e \\"setInterval/);
    assert.match(uc, /was running when Filament last stopped: Filament no longer follows it/);
    for (const id of [c, q]) assert.equal(r.owedOf(id), undefined, `${id}: nothing kept owed`);
  } finally {
    await r.close(crashed);
  }
});

// (fails before: no — the hold's cap was in the code and in no test: with the cap taken out of server.js's
// `afterListening`, this waits for the cut turn and fails on its time)
test("a cut turn that takes long to go on holds the other chats' wakes for the hold's time at most: they are woken while it still waits", async () => {
  // A window of 100,000 tokens, so a session's line is a known number of them.
  const r = await restartRig((cfg) => (cfg.upstreams[0].pricing = { "m-1": { input: 1, output: 1, contextTokens: 100000 } }));
  try {
    // Chat x's second turn ran as Filament went down: what a crash leaves of it, its row still running and its run's
    // log open (as test/resume-cut.test.js makes one). Its session is past its line — 10% of the window, and its first
    // message is longer —, so the turn Filament sends it to go on writes a summary first.
    const made = await r.shim.api("/api/sessions", { method: "POST", body: { cwd: r.root, model: "m-1", preset: "plain", settings: { context: { compaction: { mode: "auto", thresholdPercent: 10, method: "summary", keepWhole: 0 } } } } });
    assert.equal(made.status, 200, await made.clone().text());
    const x = String((await made.json()).id);
    const one = await r.shim.api(`/api/sessions/${x}/turns`, { method: "POST", body: { content: `hello ${"words ".repeat(15000)}`, stream: false } });
    assert.equal(one.status, 200, await one.clone().text());
    const dataDir = r.shim.dataDir;
    const start = JSON.parse(readFileSync(join(dataDir, "runs", `${one.headers.get("x-filament-request-id")}.jsonl`), "utf8").split("\n")[0]);
    /** @type {any} */ (r.shim.app.memory.archive).beginTurn(x, { requestId: "cut-run", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: { role: "user", content: [{ type: "text", text: "build the sheet" }] } });
    // A report waits for chat y, its wake not yet sent.
    const y = await r.chat();
    await r.send(y, "hello");
    r.shim.app.sessions.saveSubagentQueue(y, [/** @type {any} */ ({ text: REPORT, from: "sa_owed7", description: "Audit", kind: "report", wakes: true })]);
    // The model writes x's summary only once the test lets it — 12 s at most, so a hold with no cap fails here on its
    // time instead of hanging.
    const letGo = r.holdSummary(12_000);
    await r.shim.stop();
    writeFileSync(join(dataDir, "runs", "cut-run.jsonl"), [{ ...start, runId: "cut-run" }, { type: "round-start", round: 1, n: 2, seq: 0, ts: start.ts + 1, runId: "cut-run" }].map((e) => JSON.stringify(e)).join("\n") + "\n");
    const began = Date.now();
    await r.startOn(dataDir, { owedHoldMs: 600 });
    let wentOn = false;
    void r.shim.app.resumedAtStart.then(() => (wentOn = true));
    const swept = await r.shim.app.owedWokenAtStart;
    assert.equal(wentOn, false, "the cut turn had not gone on yet");
    assert.ok(Date.now() - began < 8000, `swept ${Date.now() - began} ms after the start began`);
    assert.deepEqual(swept.filter((s) => s.chainId === y).map((s) => s.woke), [true], JSON.stringify(swept));
    const ty = await r.turnsDone(y, 2);
    assert.match(JSON.stringify(ty.turns[1].final), /HEARD-report/);
    assert.equal(wentOn, false, "y heard its report while x's turn still waited");
    letGo();
    assert.deepEqual((await r.shim.app.resumedAtStart).map((/** @type {any} */ o) => [o.chainId, o.went]), [[x, true]]);
    await until(async () => ((await r.transcript(x)).turns || []).some((/** @type {any} */ t) => /WENT ON/.test(JSON.stringify(t.final ?? ""))) || null, "x's turn gone on with", { timeoutMs: 20_000 });
  } finally {
    await r.close();
  }
});

// (fails before: yes — a chat with no turn of the person's kept no moment of theirs and held no turn of theirs to
// measure from, so nothing said how long it was left: the start woke a routine's run and an ask's run of days ago)
test("a chat with no turn of the person's — a routine's run, an ask's — is measured from when it began: one of days ago is left for the person, one of today is woken; a team's own chat waits for the person's word whenever it began", async () => {
  const r = await restartRig();
  try {
    /** @type {any} */
    const archive = r.shim.app.memory.archive;
    const DAY = 24 * 60 * 60_000;
    const words = (/** @type {string} */ text) => [{ type: "text", text }];
    /** A report that wakes its chat, waiting. @param {string} id @param {string} from */
    const reportWaits = (id, from) => r.shim.app.sessions.saveSubagentQueue(id, [/** @type {any} */ ({ text: REPORT, from, description: "Audit", kind: "report", wakes: true })]);
    /** The chat's first turn as the archive keeps one Filament began `by`, at `startedAt`, ended. @param {string} id @param {string} by @param {number} startedAt */
    const openedAt = (id, by, startedAt) => {
      const t = archive.beginTurn(id, { requestId: `seed-${id}`, model: "m-1", upstream: "m", client: "harness", window: "harness", userMessage: { role: "user", content: words("the run's words") }, startedAt });
      archive.mergeTurnMeta(t.turnId, { by });
      archive.finishTurn(t.turnId, { finalMessage: { role: "assistant", content: words("OK.") } });
    };
    /** A turn Filament begins `by`, through the route its runner posts to. @param {string} id @param {string} by */
    const opens = async (id, by) => {
      const res = await r.shim.api(`/api/sessions/${id}/turns`, { method: "POST", body: { by, content: words("the run's words"), stream: false } });
      assert.equal(res.status, 200, await res.clone().text());
    };
    // A routine's run and an ask's run of three days ago, in the chats Filament made for them; a report waits for each.
    const routineOld = await r.chat();
    archive.mergeMeta(routineOld, { routine: { project: "p1", id: "rt_1", title: "Nightly", at: Date.now() - 3 * DAY, by: "time" } });
    openedAt(routineOld, "routine", Date.now() - 3 * DAY);
    reportWaits(routineOld, "sa_r1");
    const askOld = await r.chat();
    archive.mergeMeta(askOld, { ask: { app: "a1", at: Date.now() - 3 * DAY } });
    openedAt(askOld, "ask", Date.now() - 3 * DAY);
    reportWaits(askOld, "sa_a1");
    // A routine's run and an ask's run of now.
    const routineNew = await r.chat();
    archive.mergeMeta(routineNew, { routine: { project: "p1", id: "rt_2", title: "Hourly", at: Date.now(), by: "time" } });
    await opens(routineNew, "routine");
    reportWaits(routineNew, "sa_r2");
    const askNew = await r.chat();
    archive.mergeMeta(askNew, { ask: { app: "a1", at: Date.now() } });
    await opens(askNew, "ask");
    reportWaits(askNew, "sa_a2");
    // A team's own chat beside, opened by its lead's first message now.
    const main = await r.chat();
    await r.send(main, "hello");
    const team = String(r.shim.app.sessions.create({ cwd: r.root, model: "m-1", preset: "plain", kind: "team", beside: main }).id);
    archive.mergeMeta(team, { beside: { ask: "Build it", at: Date.now(), firedBy: "you" } });
    await opens(team, "team");
    reportWaits(team, "sa_t1");
    for (const id of [routineOld, askOld, routineNew, askNew, team]) assert.equal(archive.metaOf(id, ["personAt"])?.personAt, undefined, "no moment of the person's kept");
    await r.again();
    const swept = await r.shim.app.owedWokenAtStart;
    const of = (/** @type {string} */ id) => swept.filter((x) => x.chainId === id).map((x) => [x.woke, x.why]);
    const LEFT = /^the chat began, with no turn of the person's in it, and any come-back it set came due, over 24 h ago \(7[12] h\)$/;
    assert.deepEqual([of(routineOld).map((x) => x[0]), of(askOld).map((x) => x[0])], [[false], [false]], JSON.stringify(swept));
    assert.match(String(of(routineOld)[0][1]), LEFT);
    assert.match(String(of(askOld)[0][1]), LEFT);
    assert.deepEqual([of(routineNew), of(askNew)], [[[true, undefined]], [[true, undefined]]], JSON.stringify(swept));
    assert.deepEqual(of(team), [[false, TEAM_WAITS]], JSON.stringify(swept));
    for (const id of [routineNew, askNew]) {
      const t = await r.turnsDone(id, 2);
      assert.equal(t.turns[1].woke, true, "a turn of Filament's");
      assert.match(JSON.stringify(t.turns[1].final), /HEARD-report/);
    }
    await sleepMs(1500);
    assert.deepEqual([(await r.transcript(routineOld)).turns.length, (await r.transcript(askOld)).turns.length, (await r.transcript(team)).turns.length], [1, 1, 1], "no turn of Filament's");
    assert.deepEqual([await r.queued(routineOld), await r.queued(askOld), await r.queued(team)], [1, 1, 1], "their reports wait");
  } finally {
    await r.close();
  }
});

// (fails before: no — what the start does with a routine's run a restart cut, pinned: the cut turn's own going on
// takes it, and the sweep sends it no wake)
test("a routine's run a restart cut is gone on with as any cut turn is, its report riding that turn: the sweep sends it no wake of its own", async () => {
  const r = await restartRig();
  try {
    /** @type {any} */
    const archive = r.shim.app.memory.archive;
    // A turn that ran, for its run's first event: the cut run's log begins as one of this Filament's does.
    const other = await r.chat();
    const one = await r.shim.api(`/api/sessions/${other}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(one.status, 200, await one.clone().text());
    const dataDir = r.shim.dataDir;
    const start = JSON.parse(readFileSync(join(dataDir, "runs", `${one.headers.get("x-filament-request-id")}.jsonl`), "utf8").split("\n")[0]);
    // The routine's run: the chat Filament made for it, its first turn begun by the routine and running as Filament
    // went down — its row still running, its run's log open (as test/resume-cut.test.js makes one). A report waits.
    const run = await r.chat();
    archive.mergeMeta(run, { routine: { project: "p1", id: "rt_9", title: "Nightly", at: Date.now(), by: "time" } });
    const t = archive.beginTurn(run, { requestId: "cut-routine", model: "m-1", upstream: "m", client: "harness", window: "harness", running: true, userMessage: { role: "user", content: [{ type: "text", text: "the routine's words" }] } });
    archive.mergeTurnMeta(t.turnId, { by: "routine" });
    r.shim.app.sessions.saveSubagentQueue(run, [/** @type {any} */ ({ text: REPORT, from: "sa_r9", description: "Audit", kind: "report", wakes: true })]);
    await r.shim.stop();
    writeFileSync(join(dataDir, "runs", "cut-routine.jsonl"), [{ ...start, runId: "cut-routine", meta: { ...start.meta, chain: run } }, { type: "round-start", round: 1, n: 2, seq: 0, ts: start.ts + 1, runId: "cut-routine" }].map((e) => JSON.stringify(e)).join("\n") + "\n");
    await r.startOn(dataDir);
    assert.deepEqual((await r.shim.app.resumedAtStart).map((/** @type {any} */ o) => [o.chainId, o.went]), [[run, true]]);
    const swept = await r.shim.app.owedWokenAtStart;
    assert.deepEqual(swept.filter((x) => x.chainId === run).map((x) => [x.woke, x.why]), [[false, "nothing that wakes it waits for it any more"]], JSON.stringify(swept));
    const tr = await until(async () => {
      const x = await r.transcript(run);
      return (x.turns || []).length >= 2 && x.turns[1].final ? x : null;
    }, "the turn Filament sent ended", { timeoutMs: 30_000 });
    assert.deepEqual([tr.turns[1].resumed, tr.turns[1].woke], [true, undefined], "the cut turn gone on with, not a wake");
    const said = JSON.stringify(tr.turns[1].user);
    assert.ok(said.includes("SUB REPORT: the folder is clean.") && said.includes(RESUME_LINE.slice(0, 60)), said);
    assert.match(JSON.stringify(tr.turns[1].final), /WENT ON/);
    await sleepMs(1500);
    assert.deepEqual([(await r.transcript(run)).turns.length, await r.queued(run)], [2, 0], "no wake's turn after it, and nothing left waiting");
  } finally {
    await r.close();
  }
});

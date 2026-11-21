// @ts-check
// A goal driven round by round (the owner's of 11-05: "Goal round driver. improve it and drop the whole spend tracking
// which can stop the goal"): in a chat Filament runs, each turn that ends with its reply starts the goal's next round —
// Filament's own turn, its line saying the round —, until the agent marks the slice done or blocked, the person presses
// Stop, holds it or writes to the agent, or the cap of rounds or of time passes (the owner's of 11-10, "Match the
// decision"); the agent hears why it halted. Nothing of it counts money.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { DRIVE_MS, DRIVE_ROUNDS, afterTurn, driveFrom, driveOf, driveShort, driveWords, goalMarkOf, goalRoundLine, goalRoundOf, haltLine } from "../src/core/goal-drive.js";
import { parseGoalCommand } from "../src/app/commands/parse.js";
import { newGoal } from "../src/services/memory/goal.js";
import { transcriptTurns } from "../src/ui/harness/conversation/history.js";
import { deliveredWords } from "../src/ui/harness/conversation/turn.js";
import { comeBackLater, comeBackOf, tellLater } from "../src/adapters/tools/hands.js";

const NOW = 1_000;
/** @param {Partial<import("../src/core/goal-drive.js").Drive>} [o] @returns {import("../src/core/goal-drive.js").Drive} */
const drive = (o = {}) => ({ on: true, round: 3, cap: 20, halted: null, ...o });
const ended = (/** @type {string | null} */ reply, o = {}) => ({ stopped: false, reply, waits: false, now: NOW, ...o });

describe("the drive's words and its arithmetic", () => {
  test("a reply's mark: the last one in its tail, any case; blocked carries its why; one far from the end is none", () => {
    assert.deepEqual(goalMarkOf("All green.\n\n[goal: done]"), { kind: "done" });
    assert.deepEqual(goalMarkOf("Started the build. [Goal: Waiting]\n"), { kind: "waiting" });
    assert.deepEqual(goalMarkOf("[goal: blocked: which database do we target?]"), { kind: "blocked", why: "which database do we target?" });
    assert.deepEqual(goalMarkOf("[goal: blocked]"), { kind: "blocked", why: "it did not say why" });
    assert.deepEqual(goalMarkOf("[goal: waiting] — no, finished after all. [goal: done]"), { kind: "done" }, "the last one");
    assert.equal(goalMarkOf(`[goal: done] ${"then more work. ".repeat(60)}`), null, "a mark the reply went on past is not its end");
    assert.equal(goalMarkOf("the goal: done soon"), null);
    assert.equal(goalMarkOf(""), null);
  });

  test("a round's line is Filament's, read back from its message; any other message is no round", () => {
    const line = goalRoundLine(4, 20);
    assert.match(line, /^\[Filament: goal round 4 of 20 — /);
    assert.match(line, /\[goal: done\].*\[goal: blocked: <why>\].*\[goal: waiting\]/);
    // (fails before: yes — fxw1's left: the round's line said "when you need the developer", where the goal's other lines
    // to the agent say the person)
    assert.match(line, /\[goal: blocked: <why>\] when you need the person, /);
    assert.doesNotMatch(line, /developer/);
    assert.deepEqual(goalRoundOf({ role: "user", content: [{ type: "text", text: line }] }), { round: 4, cap: 20 });
    assert.deepEqual(goalRoundOf({ role: "user", content: line }), { round: 4, cap: 20 });
    assert.equal(goalRoundOf({ role: "user", content: [{ type: "text", text: `please ${line}` }] }), null, "typed by the person is not one");
    assert.equal(goalRoundOf({ role: "user", content: "hello" }), null);
  });

  test("a drive begins at round 0 with the cap's rounds ahead, its time from now; /goal go goes on from where it stood with as many again, its time again", () => {
    assert.deepEqual(driveFrom(null, NOW), { on: true, round: 0, cap: DRIVE_ROUNDS, since: NOW, halted: null });
    assert.deepEqual(driveFrom(drive({ round: 7, since: 5, halted: { kind: "blocked", why: "x", at: 1 } }), NOW), { on: true, round: 7, cap: 7 + DRIVE_ROUNDS, since: NOW, halted: null });
    assert.equal(driveOf({ status: "active", drive: drive() })?.round, 3);
    assert.equal(driveOf({ status: "proposed", drive: drive() }), null, "only an active goal drives");
    assert.equal(driveOf({ status: "active" }), null, "accepted before goals were driven, or an outside client's");
  });

  test("a turn's end: the next round, or a halt by the mark, the Stop and the cap — or neither, while something wakes the agent", () => {
    const d = drive();
    // The next round owed: its own turn counts it as it takes it (the review of 0a228ef3d: a round owed twice, counted
    // twice, skipped a number).
    assert.deepEqual(afterTurn(d, ended("wrote the lexer")), { drive: d, post: true });
    assert.deepEqual(afterTurn(d, ended("ok\n[goal: done]")), { drive: { ...d, halted: { kind: "done", at: NOW } }, post: false });
    assert.deepEqual(afterTurn(d, ended("[goal: blocked: no keys]")), { drive: { ...d, halted: { kind: "blocked", why: "no keys", at: NOW } }, post: false });
    assert.deepEqual(afterTurn(d, ended("[goal: done]", { stopped: true })), { drive: { ...d, halted: { kind: "stopped", at: NOW } }, post: false }, "the Stop before the mark");
    assert.deepEqual(afterTurn(d, ended("started the suite [goal: waiting]")), { drive: d, post: false });
    assert.deepEqual(afterTurn(d, ended("launched a reviewer", { waits: true })), { drive: d, post: false }, "a sub-agent's report wakes it");
    assert.deepEqual(afterTurn(d, ended(null)), { drive: d, post: false }, "a question for the person: their answer's turn decides");
    assert.deepEqual(afterTurn(drive({ round: 20 }), ended("more")), { drive: drive({ round: 20, halted: { kind: "cap", at: NOW } }), post: false });
    const held = drive({ halted: { kind: "held", at: 1 } });
    assert.deepEqual(afterTurn(held, ended("more")), { drive: held, post: false }, "a halted drive stays so");
  });

  // (fails before: yes — the owner's of 11-10, "Match the decision": a drive had a cap of rounds alone)
  test("its time: a turn's end past its time from the drive's start halts it, as the cap of rounds does — not one before, nor a drive begun before the time cap", () => {
    const late = drive({ since: NOW - DRIVE_MS });
    assert.deepEqual(afterTurn(late, ended("more")), { drive: { ...late, halted: { kind: "time", at: NOW } }, post: false });
    const soon = drive({ since: NOW - DRIVE_MS + 1 });
    assert.deepEqual(afterTurn(soon, ended("more")), { drive: soon, post: true });
    assert.deepEqual(afterTurn(drive(), ended("more")), { drive: drive(), post: true }, "no `since`: begun before the time cap");
    assert.equal(afterTurn(drive({ round: 20, since: NOW - DRIVE_MS }), ended("more")).drive.halted?.kind, "cap", "the rounds first");
  });

  // (fails before: yes — the review of 11-11: both caps were read only where a round would start, so a drive whose turns
  // each ended waiting — a come-back's wakes, one after another — went on past its time without bound)
  test("its time is read at every end of a live drive, whatever that end decided — waiting, something that wakes the agent, a question, a failure; its rounds are counted only where a round would start", () => {
    const late = drive({ since: NOW - DRIVE_MS });
    const timed = { drive: { ...late, halted: { kind: "time", at: NOW } }, post: false };
    assert.deepEqual(afterTurn(late, ended("[goal: waiting]")), timed, "an end that waits");
    assert.deepEqual(afterTurn(late, ended("launched a reviewer", { waits: true })), timed, "something wakes the agent by itself");
    assert.deepEqual(afterTurn(late, ended(null)), timed, "a question for the person, or a turn that failed");
    assert.equal(afterTurn(late, ended("ok\n[goal: done]")).drive.halted?.kind, "done", "its own mark says more than the clock");
    assert.equal(afterTurn(late, ended("[goal: blocked: no keys]")).drive.halted?.kind, "blocked");
    assert.equal(afterTurn(late, ended("more", { stopped: true })).drive.halted?.kind, "stopped", "the person's Stop first");
    const soon = drive({ since: NOW - DRIVE_MS + 1 });
    for (const end of [ended("[goal: waiting]"), ended("launched", { waits: true }), ended(null)]) assert.deepEqual(afterTurn(soon, end), { drive: soon, post: false }, "not before its time");
    const capped = drive({ round: 20 });
    for (const end of [ended("[goal: waiting]"), ended("launched", { waits: true }), ended(null)]) assert.deepEqual(afterTurn(capped, end), { drive: capped, post: false }, "an end that starts no round reads no cap of rounds");
  });

  // (fails before: yes — the owner's of 11-10: the agent was never told why its drive halted, only the card was)
  test("the agent's line on why its drive halted: the rounds, the time, the person's words — none once told, nor for its own marks, a Stop, a hold", () => {
    const at = (/** @type {any} */ kind) => drive({ round: 7, halted: { kind, at: 1 } });
    // (fails before: yes — the review of 11-11: the line said "the developer", where Filament's other lines to the agent say "the person")
    assert.equal(haltLine(at("cap")), `[Filament: the goal's drive halted — its ${DRIVE_ROUNDS} rounds ran out (round 7). No goal round starts by itself until the person sends /goal go.]`);
    assert.equal(haltLine(at("time")), "[Filament: the goal's drive halted — its 2 hours ran out (round 7). No goal round starts by itself until the person sends /goal go.]");
    assert.equal(haltLine(at("typed")), "[Filament: the goal's drive halted — the person wrote to you while it drove (round 7). No goal round starts by itself until the person sends /goal go.]");
    // (fails before: yes — its time's halt left the come-back the agent set, so nothing said it was dropped)
    assert.equal(haltLine(drive({ round: 7, halted: { kind: "time", at: 1, comeBack: true } })), "[Filament: the goal's drive halted — its 2 hours ran out (round 7). No goal round starts by itself until the person sends /goal go. The come-back you had set was dropped with it.]");
    assert.equal(haltLine(drive({ halted: { kind: "cap", at: 1, told: true } })), null, "told once");
    for (const kind of ["done", "blocked", "stopped", "held", "leftout"]) assert.equal(haltLine(at(kind)), null, kind);
    assert.equal(haltLine(drive()), null, "driving");
    assert.equal(haltLine(null), null);
  });

  test("its words, for the card and the status panel, by why it halted — and never money", () => {
    assert.match(driveWords(drive()), /^driving: round 3 of 20 — .*\/goal hold holds it$/);
    assert.match(driveWords(drive({ halted: { kind: "done", at: 1 } })), /slice is done \(after round 3\): check it, then \/goal done closes it, or \/goal go drives on$/);
    assert.match(driveWords(drive({ halted: { kind: "blocked", why: "no keys", at: 1 } })), /^the agent is blocked: no keys — answer it in the chat, then \/goal go drives on$/);
    assert.match(driveWords(drive({ halted: { kind: "stopped", at: 1 } })), /^you stopped it at round 3/);
    assert.match(driveWords(drive({ halted: { kind: "cap", at: 1 } })), new RegExp(`^halted after 20 rounds, for you to look: /goal go drives ${DRIVE_ROUNDS} more$`));
    assert.match(driveWords(drive({ halted: { kind: "held", at: 1 } })), /^held at round 3/);
    assert.equal(driveWords(drive({ halted: { kind: "time", at: 1 } })), `halted after 2 hours of driving (round 3), for you to look: /goal go drives on, ${DRIVE_ROUNDS} rounds or 2 hours more`);
    assert.equal(driveWords(drive({ halted: { kind: "typed", at: 1 } })), "halted as you wrote to the agent at round 3: /goal go drives on");
    assert.deepEqual(
      [null, drive(), drive({ halted: { kind: "blocked", why: "no keys", at: 1 } }), drive({ halted: { kind: "cap", at: 1 } }), drive({ halted: { kind: "time", at: 1 } }), drive({ halted: { kind: "typed", at: 1 } })].map(driveShort),
      ["", "Driving · round 3 of 20", "Blocked: no keys", "Halted after 20 rounds", "Halted after 2 hours", "Halted as you wrote · round 3"],
    );
    const all = ["done", "blocked", "stopped", "cap", "time", "typed", "held", "leftout"].map((kind) => driveWords(drive({ halted: /** @type {any} */ ({ kind, why: "w", at: 1 }) }))).join(" ");
    assert.doesNotMatch(all + driveWords(drive()), /spen|\$|budget|cost/);
  });

  test("/goal go and /goal hold are the whole line; with more words they are a goal's", () => {
    for (const w of ["go", "resume", "continue", "drive"]) assert.equal(parseGoalCommand(`/goal ${w}`)?.action, "go", w);
    for (const w of ["hold", "pause"]) assert.equal(parseGoalCommand(`/goal ${w}`)?.action, "hold", w);
    assert.deepEqual(parseGoalCommand("/goal continue the migration"), { action: "set", text: "continue the migration", raw: "/goal continue the migration", command: "/goal" });
    assert.equal(parseGoalCommand("/goal hold the line on latency\nfor the release")?.action, "set");
  });
});

describe("a Filament chat's goal, driven", () => {
  /** @type {string} */
  let root;
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** What the agent replies to each round, by the chat's goal words and the round. @type {Map<string, (round: number) => string>} */
  const scripts = new Map();
  /** A round the upstream holds until the test lets it go, by the goal's words. @type {Map<string, { reached: boolean, go: () => void, gate: Promise<void> }>} */
  const gates = new Map();
  /** What the agent replies to a message that is no round's, by the chat's goal words: "Noted, going on." where none is set. @type {Map<string, string>} */
  const others = new Map();
  /** How many of the agent's next requests the provider refuses before any reply, by the chat's goal words. @type {Map<string, number>} */
  const fails = new Map();
  const said = (/** @type {string} */ t) => anthropicReply("", { model: "brain-model", stop: "end_turn", blocks: [{ type: "text", text: t }], usage: { input_tokens: 30, output_tokens: 7 } });

  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-goal-drive-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return said("A title");
      const system = JSON.stringify(call.body.system ?? "");
      const last = call.body.messages.at(-1);
      const round = goalRoundOf(last);
      const key = [...scripts.keys()].find((k) => system.includes(k));
      if (!key) return said("HI");
      const left = fails.get(key) || 0;
      if (left > 0) {
        fails.set(key, left - 1);
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "not now" } } };
      }
      const gate = gates.get(key);
      if (round && gate && round.round === 1) {
        gate.reached = true;
        await gate.gate;
      }
      return said(round ? scripts.get(key)?.(round.round) || "worked" : others.get(key) || "Noted, going on.");
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    for (const g of gates.values()) g.go();
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });

  /** A chat with a proposed goal whose slice is `slice`, the agent's replies to its rounds `script`. @param {string} slice @param {(round: number) => string} script */
  const chatWithGoal = async (slice, script) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { subagents: { worktree: false } } } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    const id = String((await r.json()).id);
    scripts.set(slice, script);
    const g = { ...newGoal(slice, { now: Date.now() }), slice, estimate: { sizeClass: /** @type {const} */ ("days"), achievableSlice: slice, assumptions: [], firstStep: "read it", at: Date.now(), model: "m", requestId: null } };
    /** @type {any} */ (shim.app).memory.setGoal(id, g);
    return id;
  };
  /** @param {string} id @param {string} content */
  const post = (id, content) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  /** @param {string} id @param {string} content */
  const send = async (id, content) => {
    const r = await post(id, content);
    assert.equal(r.status, 200, `${content}: ${await r.clone().text()}`);
    return ((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join("");
  };
  /** @param {string} id */
  const transcript = async (id) => /** @type {any} */ (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json());
  /** @param {string} id */
  const turns = async (id) => /** @type {any[]} */ ((await transcript(id)).turns || []);
  /** What a halt's line opens with (core/goal-drive.js `haltLine`). */
  const HALTED = "[Filament: the goal's drive halted";
  /**
   * The newest messages the agent's model was sent in the chat whose goal is `slice`, each as JSON, those that say `words`.
   * @param {string} slice @param {string} words
   */
  const heard = (slice, words) =>
    up.received
      .filter((/** @type {any} */ c) => c.kind === "anthropic" && c.body?.tools?.length && JSON.stringify(c.body.system ?? "").includes(slice))
      .map((/** @type {any} */ c) => JSON.stringify(c.body.messages.at(-1)))
      .filter((m) => m.includes(words));
  /** @param {string} id */
  const goal = (id) => /** @type {any} */ (shim.app).memory.goalFor(id);
  /** The chat's goal once its drive halted. @param {string} id @param {string} what */
  const halted = (id, what) => until(() => goal(id)?.drive?.halted || null, what, { timeoutMs: 20_000 });
  /** The rounds the chat's turns were, in order. @param {string} id */
  const rounds = async (id) => (await turns(id)).filter((t) => t.goalRound).map((t) => t.goalRound.round);
  /** No turn starts for a while. @param {string} id */
  const settled = async (id) => {
    const n = (await turns(id)).length;
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal((await turns(id)).length, n, "no turn of Filament's after it");
  };

  // (fails before: yes — an accepted goal rode the system prompt and nothing else: the chat waited for the person's
  // every next message, and a goal halted only for money spent)
  test("/goal accept starts round 1; each reply starts the next; [goal: done] halts it, and nothing goes on", async () => {
    const id = await chatWithGoal("the lexer ships", (n) => (n < 3 ? `round ${n}: wrote more of the lexer` : "The lexer ships; its tests pass.\n\n[goal: done]"));
    const acc = await send(id, "/goal accept");
    assert.match(acc, /^Goal active: “the lexer ships”\. .*Its first round starts as this answer ends \(or, where something the agent started still runs, once that wakes it\), and each/);
    const h = await halted(id, "the drive halted");
    assert.deepEqual(h.kind, "done");
    assert.deepEqual(await rounds(id), [1, 2, 3]);
    const t = await turns(id);
    assert.equal(t.length, 4, "the command's turn and three rounds");
    assert.match(JSON.stringify(t[1].user), /goal round 1 of 20/);
    assert.match(JSON.stringify(t[3].final), /\[goal: done\]/);
    assert.deepEqual([goal(id).status, goal(id).drive.round], ["active", 3], "the person closes it: the agent only says it is done");
    await settled(id);
    assert.match(await send(id, "/goal done"), /^Goal done: “the lexer ships” — 3 rounds driven, sized days\./);
  });

  // (fails before: yes — no goal was driven, so none halted for the person or went on at their word)
  test("[goal: blocked: why] halts it with its why; the person's answer drives nothing until /goal go, which drives on from that round", async () => {
    const id = await chatWithGoal("the importer ships", (n) => (n === 1 ? "I need one answer first. [goal: blocked: which file formats?]" : "Done, PNG and JPEG. [goal: done]"));
    await send(id, "/goal accept");
    const h = await halted(id, "the drive halted, blocked");
    assert.deepEqual([h.kind, h.why], ["blocked", "which file formats?"]);
    assert.match(await send(id, "/goal status"), /- drive: the agent is blocked: which file formats\? — answer it in the chat, then \/goal go drives on/);
    await send(id, "PNG and JPEG");
    await settled(id);
    assert.deepEqual(await rounds(id), [1], "a halted drive starts nothing by itself");
    assert.match(await send(id, "/goal go"), /^Goal driven on from round 1: its next round starts as this answer ends \(or, where something the agent started still runs, once that wakes it\), up to round 21\./);
    await until(async () => ((await rounds(id)).length === 2 ? true : null), "round 2", { timeoutMs: 20_000 });
    assert.match(JSON.stringify((await turns(id)).at(-1).user), /goal round 2 of 21/);
    assert.equal((await halted(id, "done")).kind, "done");
  });

  // (fails before: yes — there was no drive to hold, and no command between rounds to keep from driving; and the review
  // of 0a228ef3d: a refused /goal accept still started a round, and a drive whose round never came refused /goal go as
  // "driving already")
  // The person's message no longer drives on (the owner's of 11-10): it halts the drive — below.
  test("[goal: waiting] starts no round; a command between rounds drives nothing, a refused one neither; /goal go starts a round that never came; /goal hold holds it", async () => {
    const id = await chatWithGoal("the cache ships", (n) => (n === 1 ? "Started the benchmark. [goal: waiting]" : `Round ${n}: read its numbers; the next run is started. [goal: waiting]`));
    await send(id, "/goal accept");
    await until(async () => ((await rounds(id)).length === 1 && (await turns(id)).at(-1).final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    assert.equal(goal(id).drive.halted, null, "waiting is not halted");
    assert.match(await send(id, "/goal status"), /- drive: driving: round 1 of 20/);
    assert.match(await send(id, "/goal accept"), /^The goal is already active/);
    await settled(id);
    assert.deepEqual(await rounds(id), [1], "a command's turn drives nothing, a refused /goal accept neither");
    assert.match(await send(id, "/goal go"), /^Goal driven on from round 1: its next round starts as this answer ends \(or, where something the agent started still runs, once that wakes it\), up to round 21\./);
    await until(async () => ((await rounds(id)).length === 2 && (await turns(id)).at(-1).final ? true : null), "round 2, after /goal go", { timeoutMs: 20_000 });
    assert.match(JSON.stringify((await turns(id)).at(-1).user), /goal round 2 of 21/);
    await settled(id);
    assert.match(await send(id, "/goal hold"), /^Goal held at round 2: no round starts by itself until `\/goal go`\./);
    assert.equal(goal(id).drive.halted.kind, "held");
    await send(id, "the benchmark says 40% faster");
    await settled(id);
    assert.deepEqual(await rounds(id), [1, 2], "a held drive: the person's message is theirs alone");
    assert.deepEqual([goal(id).drive.halted.kind, heard("the cache ships", "40% faster").some((m) => m.includes(HALTED))], ["held", false], "the agent hears nothing of a hold");
    assert.match(await send(id, "/goal hold"), /^The goal starts no round by itself now \(held at round 2/);
  });

  // (fails before: yes — the owner's of 11-10, "Match the decision": the person's message drove on as a round's turn did,
  // and the agent was never told why a drive halted, only the card was)
  test("the person's message while it drives halts it: their turn runs as ever, the agent hears why ahead of their words — once —, and /goal go drives on", async () => {
    const slice = "the typed ships";
    const id = await chatWithGoal(slice, (n) => (n === 1 ? "Started the build. [goal: waiting]" : "Read the build. [goal: done]"));
    await send(id, "/goal accept");
    await until(async () => ((await rounds(id)).length === 1 && (await turns(id)).at(-1).final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    assert.equal(goal(id).drive.halted, null, "waiting, not halted");
    const r = await post(id, "the build is green");
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(r.headers.get("x-filament-goal-halt"), "1", "the page that sent it says so at once");
    assert.match(((await r.json()).content || []).map((/** @type {any} */ b) => b.text || "").join(""), /^Noted, going on\.$/, "their turn ran");
    assert.deepEqual([goal(id).drive.halted?.kind, goal(id).drive.halted?.told], ["typed", true]);
    const line = haltLine({ on: true, round: 1, cap: 20, halted: { kind: "typed", at: 0 } });
    const theirs = heard(slice, "the build is green");
    assert.equal(theirs.length, 1);
    assert.ok(theirs[0].includes(String(line)) && theirs[0].indexOf(String(line)) < theirs[0].indexOf("the build is green"), `the line ahead of their words: ${theirs[0]}`);
    await settled(id);
    assert.deepEqual(await rounds(id), [1], "no round starts by itself");
    const tr = await transcript(id);
    const row = tr.turns.find((/** @type {any} */ t) => JSON.stringify(t.user).includes("the build is green"));
    assert.deepEqual([row.goalHalt, row.deliveries], [true, 1]);
    assert.equal(deliveredWords(transcriptTurns(tr).find((/** @type {any} */ t) => t.n === row.n) || {}), "with word of why your goal halted", "no agent's message");
    assert.match(driveWords(goal(id).drive), /^halted as you wrote to the agent at round 1: \/goal go drives on$/);
    await send(id, "and the docs too");
    assert.ok(!heard(slice, "and the docs too")[0].includes(HALTED), "told once");
    assert.match(await send(id, "/goal go"), /^Goal driven on from round 1: .*up to round 21\. It halts sooner after 2 hours, or as you write to the agent\.$/);
    assert.equal((await halted(id, "done after /goal go")).kind, "done");
    assert.deepEqual(await rounds(id), [1, 2]);
  });

  // (fails before: yes — the owner's of 11-10: a note typed into the running round went in, and the next round started
  // after it as ever)
  test("a note into the round under way halts the drive: that round goes on with it, no other starts, and the agent hears why on its next turn", async () => {
    const slice = "the note ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "worked on it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    const { runs } = await (await shim.api("/api/runs?kind=agent-turn")).json();
    const run = runs.find((/** @type {any} */ x) => x.status === "running" && x.meta?.chain === id);
    assert.ok(run, "round 1's run");
    const note = await shim.api(`/api/runs/${encodeURIComponent(run.id)}/steer`, { method: "POST", body: { kind: "note", text: "keep the old flag too", from: "harness" } });
    assert.equal(note.status, 200, await note.clone().text());
    assert.deepEqual([goal(id).drive.halted?.kind, goal(id).drive.halted?.told], ["typed", undefined], "halted at once, told on the next turn");
    go();
    await until(async () => ((await turns(id)).at(-1)?.final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    assert.deepEqual(await rounds(id), [1]);
    await send(id, "what is left?");
    const theirs = heard(slice, "what is left?");
    assert.ok(theirs[0]?.includes(String(haltLine({ on: true, round: 1, cap: 20, halted: { kind: "typed", at: 0 } }))), `the next turn carries why: ${theirs[0]}`);
    assert.equal(goal(id).drive.halted?.told, true);
  });

  // (fails before: yes — the owner's of 11-10, "Match the decision": a drive ran as long as its rounds did)
  test("its time: the round that ends past it halts the drive, and the person's next message tells the agent why", async () => {
    const slice = "the time ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "more of it");
    await send(id, "/goal accept");
    assert.equal(typeof goal(id).drive.since, "number", "/goal accept starts its time");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    /** @type {any} */ (shim.app).memory.setGoal(id, { ...goal(id), drive: { ...goal(id).drive, since: Date.now() - DRIVE_MS - 1000 } });
    go();
    const h = await halted(id, "the time");
    assert.deepEqual([h.kind, h.told], ["time", undefined]);
    await settled(id);
    assert.deepEqual(await rounds(id), [1]);
    assert.match(await send(id, "/goal status"), /- drive: halted after 2 hours of driving \(round 1\), for you to look: \/goal go drives on/);
    await send(id, "where are we?");
    assert.ok(heard(slice, "where are we?")[0]?.includes("[Filament: the goal's drive halted — its 2 hours ran out (round 1). No goal round starts by itself until the person sends /goal go.]"));
    assert.equal(goal(id).drive.halted.kind, "time", "the person's message halts nothing more");
  });

  // (fails before: yes — the review of 0a228ef3d: Hold only filled the box, whose Send steered /goal hold into the
  // running round as a note; the round ended and the next began)
  test("Hold holds a round under way at once: that round ends, and no other starts", async () => {
    const slice = "the hold ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "worked on it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    const hold = await shim.api(`/api/sessions/${encodeURIComponent(id)}/goal/hold`, { method: "POST", body: {} });
    assert.equal(hold.status, 200, await hold.clone().text());
    assert.deepEqual([(await hold.json()).drive.halted.kind, goal(id).drive.round], ["held", 1]);
    go();
    await until(async () => ((await turns(id)).at(-1)?.final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    assert.deepEqual(await rounds(id), [1]);
    const again = await shim.api(`/api/sessions/${encodeURIComponent(id)}/goal/hold`, { method: "POST", body: {} });
    assert.equal(again.status, 409, "held already");
  });

  // (fails before: yes — the review of 0a228ef3d: a Stop with no turn running left the drive driving, and the person's
  // next message started rounds again by itself)
  test("a Stop while the agent waits halts the drive too: the person's next message starts no round", async () => {
    const id = await chatWithGoal("the wait ships", () => "Started the build. [goal: waiting]");
    await send(id, "/goal accept");
    await until(async () => ((await rounds(id)).length === 1 && (await turns(id)).at(-1).final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    assert.equal(goal(id).drive.halted?.kind, "stopped");
    await send(id, "the build is green");
    await settled(id);
    assert.deepEqual(await rounds(id), [1]);
  });

  // (fails before: yes — the person's Stop ended the turn, and nothing more was owed: there was no drive)
  test("the person's Stop of a round halts the drive: nothing goes on until /goal go", async () => {
    const slice = "the stop ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "worked on it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    go();
    assert.equal((await halted(id, "the drive halted, stopped")).kind, "stopped");
    await settled(id);
    assert.deepEqual(await rounds(id), [1]);
  });

  // (fails before: yes — the owner's of 11-05: a drive accepted before Memory settings left its chat out went on posting
  // "go on toward the goal" rounds, while the goal no longer rode the chat's requests)
  test("a chat Memory settings leave out mid-drive: the round under way ends, and the drive halts saying why — no other round starts", async () => {
    const slice = "the leftout ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "worked on it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    const set = await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "memory.capture.excludeFolders": [root] } } });
    assert.equal(set.status, 200, await set.clone().text());
    try {
      go();
      const h = await halted(id, "the drive halted, left out");
      assert.equal(h.kind, "leftout");
      assert.match(String(h.why), /\S/);
      await settled(id);
      assert.deepEqual(await rounds(id), [1]);
      assert.equal(driveShort(goal(id).drive), "Halted: memory leaves this chat out");
      assert.match(driveWords(goal(id).drive), /^memory leaves this chat out \(.+\): the goal rides none of its requests now — \/goal done or \/goal abandon closes it$/);
    } finally {
      await shim.api("/api/config/fields", { method: "PATCH", body: { set: { "memory.capture.excludeFolders": [] } } });
    }
  });

  // (fails before: yes — a goal halted for money; now only its cap of rounds halts it for the person to look. And the
  // owner's of 11-10: the agent was never told the rounds ran out)
  test("the cap: the round that reaches it halts the drive, its words offer as many again, and the person's next message tells the agent why", async () => {
    const slice = "the cap ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "more of it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    // The round under way is the cap's: its end reaches it.
    /** @type {any} */ (shim.app).memory.setGoal(id, { ...goal(id), drive: { ...goal(id).drive, round: DRIVE_ROUNDS, cap: DRIVE_ROUNDS } });
    go();
    const h = await halted(id, "the cap");
    assert.equal(h.kind, "cap");
    await settled(id);
    assert.deepEqual(await rounds(id), [1]);
    assert.match(await send(id, "/goal status"), new RegExp(`- drive: halted after ${DRIVE_ROUNDS} rounds, for you to look: /goal go drives ${DRIVE_ROUNDS} more`));
    assert.equal(goal(id).drive.halted.told, undefined, "a command's turn carries no line");
    await send(id, "where are we?");
    assert.ok(heard(slice, "where are we?")[0]?.includes(`[Filament: the goal's drive halted — its ${DRIVE_ROUNDS} rounds ran out (round ${DRIVE_ROUNDS}). No goal round starts by itself until the person sends /goal go.]`));
    assert.deepEqual([goal(id).drive.halted.kind, goal(id).drive.halted.told], ["cap", true]);
  });

  /** The chat's sessions, and what it keeps of an owed round. */
  const sessions = () => /** @type {any} */ (shim.app).sessions;
  /** @param {string} id */
  const owed = (id) => [sessions().goalOwed(id), /** @type {any} */ (shim.app).memory.archive.metaOf(id, ["goalOwed"])?.goalOwed ?? null];
  /** Until no turn of the chat runs: its end's bookkeeping is done. @param {string} id */
  const rests = (id) => until(() => (sessions().running().includes(id) ? null : true), "the chat's turn to end", { timeoutMs: 20_000 });
  /** Until the chat's newest turn is one Filament woke it for, answered. @param {string} id */
  const wokeAndEnded = async (id) => {
    await until(async () => {
      const t = (await turns(id)).at(-1);
      return t?.woke && t.final ? true : null;
    }, "the wake's turn to end", { timeoutMs: 20_000 });
    await rests(id);
  };

  // (fails before: yes — the review of 11-11: an end that decided against a round left one an earlier end owed: the chat
  // read as waiting on a round until Filament restarted, and the round's waker still held one to send)
  test("a round an earlier end owed is owed no more once a later turn's end decides against one: the chat keeps none, and none goes", async () => {
    const slice = "the owed ships";
    const id = await chatWithGoal(slice, () => "Started the build. [goal: waiting]");
    await send(id, "/goal accept");
    await until(async () => ((await rounds(id)).length === 1 && (await turns(id)).at(-1).final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    // A round owed by an end before this one, which no turn took yet — as a restart owes again the one its stop kept.
    assert.equal(sessions().oweGoal(id), true);
    assert.deepEqual(owed(id), [true, true]);
    // A report wakes the agent first, and its turn ends waiting on what it started: that end decides.
    others.set(slice, "Read the report; the build runs on. [goal: waiting]");
    /** @type {any} */ (shim.app).subagents.tell(id, { text: "[Filament: t1 is done]", from: "", description: "the task graph", spends: [], wrote: false, wakes: true });
    await wokeAndEnded(id);
    assert.deepEqual(owed(id), [false, null], "owed no more, in the chat's keeping neither");
    await settled(id);
    assert.deepEqual(await rounds(id), [1], "no round goes");
    assert.equal(goal(id).drive.halted, null, "waiting, not halted");
  });

  // (fails before: yes — the same review: a round whose post was refused for good, or threw, stayed owed)
  test("a round its waker gives up on — its post refused for good — is owed no more: the end of the chat's next turn decides again", async () => {
    const slice = "the refused ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "more of it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    // The copy the chat worked in went while round 1 ran: every turn after it is refused for good, the next round's too.
    /** @type {any} */ (shim.app).memory.archive.mergeMeta(id, { copy: "a-copy-that-went" });
    go();
    await until(() => (sessions().goalOwed(id) ? true : null), "round 2 owed", { timeoutMs: 20_000 });
    await until(() => (sessions().goalOwed(id) ? null : true), "the refused round to be owed no more", { timeoutMs: 5000 });
    assert.deepEqual(owed(id), [false, null]);
    assert.deepEqual(await rounds(id), [1], "the round did not go");
    assert.equal(goal(id).drive.halted, null, "the drive is not halted: the chat's next turn's end decides again");
  });

  // (fails before: yes — the review of 11-11: an end that waits read no cap, so a come-back's wakes, each ending
  // waiting, went on past the drive's time without bound)
  test("its time bounds a drive whose turns only wait: a come-back's wake that ends waiting past it halts the drive, and the agent hears why", async () => {
    const slice = "the comeback ships";
    const id = await chatWithGoal(slice, () => "Started the build. [goal: waiting]");
    await send(id, "/goal accept");
    await until(async () => ((await rounds(id)).length === 1 && (await turns(id)).at(-1).final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    /** @type {any} */ (shim.app).memory.setGoal(id, { ...goal(id), drive: { ...goal(id).drive, since: Date.now() - DRIVE_MS - 1000 } });
    others.set(slice, "Looked again: it still runs. [goal: waiting]");
    // The time the agent set comes (hands.js `comeBackCame`): its note wakes the chat.
    tellLater({ session: id, agent: null }, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: look at the build]" });
    await wokeAndEnded(id);
    assert.deepEqual([goal(id).drive.halted?.kind, goal(id).drive.round], ["time", 1], "the end that waits reads the time");
    await settled(id);
    await send(id, "where are we?");
    assert.ok(heard(slice, "where are we?")[0]?.includes("[Filament: the goal's drive halted — its 2 hours ran out (round 1). No goal round starts by itself until the person sends /goal go.]"));
  });

  // (fails before: yes — the come-back the agent set in the turn that ran past the drive's time came all the same, and
  // its turn could set the next: the chain went on under a halted drive)
  test("its time's halt drops the come-back the agent set, as the person's Stop drops one: nothing comes back to the chat, and the line on why it halted says so", async () => {
    const slice = "the chain ships";
    const id = await chatWithGoal(slice, () => "Started the build. [goal: waiting]");
    await send(id, "/goal accept");
    await until(async () => ((await rounds(id)).length === 1 && (await turns(id)).at(-1).final ? true : null), "round 1 ended", { timeoutMs: 20_000 });
    await settled(id);
    /** @type {any} */ (shim.app).memory.setGoal(id, { ...goal(id), drive: { ...goal(id).drive, since: Date.now() - DRIVE_MS - 1000 } });
    others.set(slice, "Looked again: it still runs. [goal: waiting]");
    // The time the agent set comes, and the turn it wakes sets the next (agent/come-back.js `comeBackCall`).
    comeBackLater(id, { seconds: 600, note: "look at the build again" });
    tellLater({ session: id, agent: null }, { id: `cb_${id}`, command: "", code: null, kind: "wake", text: "[Filament: the time you set has come — 10 min ago you asked to come back to this chat. Your note: look at the build]" });
    await wokeAndEnded(id);
    assert.deepEqual([goal(id).drive.halted?.kind, goal(id).drive.halted?.comeBack, comeBackOf(id)], ["time", true, null], "halted for its time, the come-back dropped with it");
    await settled(id);
    await send(id, "where are we?");
    assert.ok(heard(slice, "where are we?")[0]?.includes("[Filament: the goal's drive halted — its 2 hours ran out (round 1). No goal round starts by itself until the person sends /goal go. The come-back you had set was dropped with it.]"), heard(slice, "where are we?")[0]);
  });

  // (fails before: yes — the line was marked told before the model was asked: a turn that failed before its model did
  // any work left the history, and the line with it)
  test("the line on why it halted is told by a turn the history keeps: one that fails before its model does any work leaves it untold, for the next", async () => {
    const slice = "the untold ships";
    /** @type {() => void} */
    let go = () => {};
    const gate = new Promise((r) => (go = () => r(undefined)));
    gates.set(slice, { reached: false, go, gate });
    const id = await chatWithGoal(slice, () => "more of it");
    await send(id, "/goal accept");
    await until(() => (gates.get(slice)?.reached ? true : null), "round 1 at the model", { timeoutMs: 20_000 });
    /** @type {any} */ (shim.app).memory.setGoal(id, { ...goal(id), drive: { ...goal(id).drive, since: Date.now() - DRIVE_MS - 1000 } });
    go();
    assert.equal((await halted(id, "the time")).kind, "time");
    await settled(id);
    fails.set(slice, 1);
    const r = await post(id, "where are we?");
    assert.notEqual(r.status, 200, "the provider refuses the request");
    await rests(id);
    assert.ok(heard(slice, "where are we?")[0]?.includes(HALTED), "the failed request carried the line");
    assert.deepEqual([goal(id).drive.halted.kind, goal(id).drive.halted.told], ["time", undefined], "no model read it: untold again");
    await send(id, "and now?");
    assert.ok(heard(slice, "and now?")[0]?.includes("its 2 hours ran out (round 1)"), "the next turn carries it");
    assert.equal(goal(id).drive.halted.told, true);
    await send(id, "and after?");
    assert.ok(!heard(slice, "and after?")[0].includes(HALTED), "told once");
  });
});

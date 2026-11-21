// @ts-check
// The plan's Phase 1 (p1-self), under the owner's rule that compaction has three kinds — own, self, ours — and all stay.
// A sub-agent on a coding agent that takes no line and has no compaction of its own (Cursor's SDK, an ACP agent other
// than Claude's adapter) is weighed against its line as a follow-up comes: what its context held as the newest exchange
// that says it ended, and the follow-up's own message. Past it, the agent writes its own summary in its session (self),
// its thread saying it makes room meanwhile; its session is let go of, and a fresh one takes the summary and the
// follow-up up as one user message, after the standing notes its first message carried. Where it writes none, its own
// model summarizes Filament's copy of its conversation in a session of its own (ours); where neither does, the follow-up
// goes on in its session as it stands. Claude Code and Codex keep their own: each is handed the line and makes room by
// itself.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FAKE_ACP_AGENT, FIXTURES, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import { alignEvents, earlierCompactionWords, roundCompactingWords, roundCompactionWords } from "../src/ui/harness/lib/labels.js";

/** JSON lines of a file, oldest first. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const SELF_ASK = "[Filament: this conversation has reached its compaction line.";
const LEAD = /\[Filament compacted turns? 1(–\d+)? into the summary below\. Carry on from it where the conversation stands, without recapping it\.\]\n/;

/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
let root = "";
let projDir = "";
let repoDir = "";
/** The prompts each agent was sent, oldest first. @param {string} who */
const prompts = (who) => lines(join(root, `${who}-prompts.jsonl`));
/** The session methods each agent was sent. @param {string} who */
const calls = (who) => lines(join(root, `${who}-calls.jsonl`));
/** @param {string} cwd @param {...string} args */
const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

before(async () => {
  root = mkdtempSync(join(tmpdir(), "filament-subagent-room-"));
  projDir = join(root, "project");
  mkdirSync(projDir);
  writeFileSync(join(projDir, "README.md"), "hello agent\n");
  // A repository, where a sub-agent that edits works in a worktree of its own.
  repoDir = join(root, "repo");
  mkdirSync(repoDir);
  git(repoDir, "init", "-q");
  git(repoDir, "config", "core.autocrlf", "false");
  writeFileSync(join(repoDir, "README.md"), "hello repo\n");
  git(repoDir, "add", "-A");
  git(repoDir, "commit", "-qm", "init");
  /** An ACP agent upstream on the fake: `who` names its logs. @param {string} who @param {Record<string, string>} [env] @param {any} [more] */
  const agent = (who, env = {}, more = {}) => ({ id: who, name: who, type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, `${who}-calls.jsonl`), FAKE_ACP_LOG: join(root, `${who}-prompts.jsonl`), FAKE_ACP_SESSION_CAPS: "resume,close", ...env }, cwdDefault: projDir, permissions: "allow-all", hints: false }, ...more });
  // Cursor's SDK runs in Filament's own process: its fake logs there.
  process.env.FAKE_SDK_LOG = join(root, "sdk.jsonl");
  shim = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [
        // `fake-s`'s window is the price card's; every other model's is the one its agent names, or none.
        agent("ag", {}, { pricing: { "fake-s": { input: 1, output: 1, contextTokens: 200000 } } }),
        agent("agf", { FAKE_ACP_SUMMARY_FAIL: "1" }),
        agent("agx", { FAKE_ACP_SUMMARY_FAIL: "1", FAKE_ACP_TRANSCRIPT_FAIL: "1" }),
        agent("ags", { FAKE_ACP_SUMMARY_GATE: join(root, "summary-gate") }),
        agent("cl", { FAKE_ACP_CLAUDE: "1" }),
        { id: "cs", name: "cs", type: "cursor-sdk", apiKey: "ck-test", enabled: true, acp: { cwdDefault: projDir, hints: false }, pricing: { "composer-2.5": { input: 1, output: 1, contextTokens: 200000 } } },
        { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], env: { FAKE_CODEX_CALLS: join(root, "cx-calls.jsonl") }, cwdDefault: projDir, permissions: "allow-all", hints: false } },
      ];
      cfg.routes = ["ag", "agf", "agx", "ags", "cl", "cs", "cx"].map((who) => ({ match: `${who}/*`, upstream: who, upstreamModel: "{1}", enabled: true }));
      cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    },
    overrides: { cursorSdkLoader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) },
  });
});
after(async () => {
  await shim.stop();
  delete process.env.FAKE_SDK_LOG;
  await removeDirs(root);
});

/** A chat on `model`. @param {string} model @param {string} [cwd] */
const newSession = async (model, cwd = projDir) => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd, model, preset: "plain" } })).json()).id);
/** @param {string} id @param {string} prompt @param {Record<string, any>} [more] */
const launch = async (id, prompt, more = {}) => {
  const spawn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt, description: "Aside", deliver: false, ...more } });
  assert.equal(spawn.status, 200, await spawn.clone().text());
  return String((await spawn.json()).subagent.id);
};
/** @param {string} id @param {string} sid @param {string} prompt */
const followUp = async (id, sid, prompt) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${encodeURIComponent(sid)}/follow-up`, { method: "POST", body: { prompt } });
  assert.equal(r.status, 200, await r.clone().text());
};
/** The sub-agent as its session lists it. @param {string} id @param {string} sid */
const subOf = async (id, sid) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents.find((/** @type {any} */ x) => x.id === sid);
/**
 * The sub-agent once its exchange `n` has ended. An exchange begins with its worktree made, which the full suite's load
 * took past the default 10 s (FabeleHelper's of 11-10: "passes alone" carries nothing): the bound leaves room for it.
 * @param {string} id @param {string} sid @param {number} n
 */
const ended = (id, sid, n) =>
  until(async () => {
    const s = await subOf(id, sid);
    return s && s.status !== "running" && s.exchanges.length > n ? s : null;
  }, `exchange ${n} to end`, { timeoutMs: 30_000 });
/** A run's events. @param {string} runId */
const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events;
/** The give-way's marks on a run. @param {string} runId */
const marksOf = async (runId) => (await eventsOf(runId)).filter((/** @type {any} */ e) => e.type === "compacting" || e.type === "compaction");

// (fails before: yes — the follow-up went on in the session that held 180,000 tokens: no summary was asked of it, and no
// fresh session took it up; with that fixed, what the agent spent on its summary was in no op and no exchange's spend)
test("a sub-agent past its line on an agent with no compaction of its own writes its own summary, and a fresh session takes it and the follow-up up", async () => {
  const id = await newSession("ag/fake-a");
  const sid = await launch(id, "look around ~holds 180000");
  const one = await ended(id, sid, 0);
  assert.equal(one.exchanges[0].status, "done", JSON.stringify(one.exchanges[0]));
  const was = prompts("ag").length;
  const opened = calls("ag").filter((c) => c.method === "session/new").length;

  await followUp(id, sid, "and now the NEXT STEP");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const [asked, fresh, ...more] = prompts("ag").slice(was);
  assert.equal(more.length, 0, JSON.stringify(more));
  // First its own summary, asked in the session it worked in.
  assert.ok(asked?.prompt.startsWith(SELF_ASK), JSON.stringify(asked));
  const before = prompts("ag")[was - 1];
  assert.equal(asked.sessionId, before.sessionId, "asked in its own session");
  // Then a fresh session: its first prompt the summary, then the follow-up.
  assert.notEqual(fresh?.sessionId, before.sessionId, "a fresh session");
  assert.equal(calls("ag").filter((c) => c.method === "session/new").length, opened + 1);
  // The fake answers with what the session heard before the ask: none, as its session was closed after the exchange and
  // opened again for the summary.
  assert.match(fresh.text, /^\[Filament compacted turn 1 into the summary below\. Carry on from it where the conversation stands, without recapping it\.\]\nThe session heard:\n/);
  assert.match(fresh.text, /and now the NEXT STEP$/);
  assert.ok(!fresh.text.includes("<analysis>"), "the analysis dropped, as every summary's is");
  // Its thread says it summarized itself, and the summary's size.
  const runId = String(two.exchanges[1].runId);
  const marks = await marksOf(runId);
  assert.deepEqual(marks.map((/** @type {any} */ e) => [e.type, !!e.earlier, !!e.exchanges, !!e.fresh, e.fromTurn ?? null, e.toTurn ?? null]), [["compacting", true, true, true, null, null], ["compaction", true, true, true, 1, 1]]);
  const done = marks[1];
  assert.equal(done.tokensBefore, 180_000);
  assert.ok(done.summary > 0, JSON.stringify(done));
  assert.equal(earlierCompactionWords(done), `Room made in its conversation: its earlier exchange summarized by itself, a fresh session going on from the summary · 180k → a ${done.summary}-token summary`);
  // Aligned as its thread aligns its run (labels.js `alignEvents`), the row stands ahead of the agent's first round.
  const head = alignEvents(await eventsOf(runId)).byRound.get(0);
  assert.deepEqual(head?.compactions.map((/** @type {any} */ k) => roundCompactionWords(k)), [`⌁ Room made in its conversation: its earlier exchange summarized by itself, a fresh session going on from the summary · 180k → a ${done.summary}-token summary`]);
  const rec = await shim.record(runId);
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: ag's context held 180,000 tokens as its last exchange ended and the message ≈\d+, past its 170,000-token line as a side agent: its earlier exchange summarized by ag, itself, reading its own session \(≈\d+ tokens; writing it read 905 tokens and wrote 40\), and its session let go of — a fresh one takes the message up from that summary$/.test(c)), JSON.stringify(rec.changes));
  // What it spent writing it, as the agent counted it (the fake's: 5 in, 900 read from its cache, 40 out): an op, as the
  // session's own Self keeps one, and the exchange's spend beside its turn's.
  const ops = (await (await shim.api("/api/ops?kinds=compaction&limit=50")).json()).ops || [];
  const op = ops.find((/** @type {any} */ o) => o.detail?.agentId === sid);
  assert.deepEqual(op && [op.sub, op.detail.how, op.detail.inputTokens, op.detail.cacheReadTokens, op.detail.outputTokens], ["subagent", "agent", 5, 900, 40], JSON.stringify(ops));
  const t = rec.tokens || {};
  assert.deepEqual([two.exchanges[1].tokensIn - (Number(t.input) + Number(t.cacheRead) + Number(t.cacheWrite)), two.exchanges[1].tokensOut - Number(t.output)], [905, 40], JSON.stringify([two.exchanges[1], t]));

  // Its next message goes on in the fresh session, under its line now: nothing is asked, nothing gives way.
  const mark = prompts("ag").length;
  await followUp(id, sid, "ONE MORE");
  const three = await ended(id, sid, 2);
  assert.equal(three.exchanges[2].status, "done", JSON.stringify(three.exchanges[2]));
  const next = prompts("ag").slice(mark);
  assert.deepEqual(next.map((p) => [p.sessionId, p.text]), [[fresh.sessionId, "ONE MORE"]]);
  assert.deepEqual(await marksOf(String(three.exchanges[2].runId)), []);
});

test("its thread's words for it", () => {
  assert.equal(roundCompactingWords({ earlier: true, exchanges: true, fresh: true }), "⌁ Making room in its conversation: it summarizes its earlier exchanges itself, for a fresh session to go on from…");
  assert.equal(
    roundCompactionWords({ earlier: true, exchanges: true, fresh: true, fromTurn: 1, toTurn: 2, method: "summary", tokensBefore: 182_000, summary: 2400 }),
    "⌁ Room made in its conversation: its 2 earlier exchanges summarized by itself, a fresh session going on from the summary · 182k → a 2.4k-token summary",
  );
  assert.equal(
    roundCompactionWords({ earlier: true, exchanges: true, fresh: true, result: "none", error: "agf wrote no summary of them" }),
    "⌁ Its earlier exchanges could not give way (agf wrote no summary of them): it goes on in its session as it stands",
  );
});

// (fails before: yes — nothing was summarized, and the follow-up went on in the session past its line)
test("where it writes no summary of its own, its own model summarizes its conversation in a session of its own, and a fresh session goes on from that", async () => {
  const id = await newSession("agf/fake-a");
  const sid = await launch(id, "survey the repo ~holds 180000");
  await ended(id, sid, 0);
  const was = prompts("agf").length;
  await followUp(id, sid, "then the FOLLOW-UP");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const sent = prompts("agf").slice(was);
  const before = prompts("agf")[was - 1];
  // Asked first in its session, where it failed; then its model, in a session of its own, read the transcript.
  assert.ok(sent[0]?.prompt.startsWith(SELF_ASK) && sent[0].sessionId === before.sessionId, JSON.stringify(sent[0]));
  const ours = sent.find((p) => /Summarize the conversation below so that work can continue from your summary alone/.test(p.prompt));
  assert.ok(ours, JSON.stringify(sent.map((p) => p.prompt.slice(0, 80))));
  assert.notEqual(ours.cwd, projDir, "Filament's own call, in a folder of Filament's");
  assert.match(ours.prompt, /survey the repo ~holds 180000/);
  const fresh = sent.at(-1);
  assert.ok(fresh && fresh.sessionId !== before.sessionId && fresh.sessionId !== ours.sessionId, "a fresh session of its own");
  assert.match(fresh.text, /^\[Filament compacted turn 1 into the summary below\./);
  assert.match(fresh.text, /then the FOLLOW-UP$/);
  const runId = String(two.exchanges[1].runId);
  const marks = await marksOf(runId);
  assert.deepEqual(marks.map((/** @type {any} */ e) => [e.type, !!e.fresh, e.result ?? null]), [["compacting", true, null], ["compaction", true, null]]);
  const rec = await shim.record(runId);
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /its earlier exchange summarized by agf, itself, from their transcript, in a session of its own \(agf could not write it in its session: [^)]*Internal error[^)]*\) \(≈\d+ tokens\)/.test(c)), JSON.stringify(rec.changes));
});

// (fails before: yes — the follow-up went to the Cursor agent that held ≈184,000 tokens, which wrote no summary)
test("on Cursor's SDK: the agent writes its own summary, and a fresh agent takes it and the follow-up up", async () => {
  const sdk = () => lines(join(root, "sdk.jsonl"));
  const id = await newSession("cs/composer-2.5");
  const sid = await launch(id, "scan the code ~fills 180000");
  const one = await ended(id, sid, 0);
  assert.equal(one.exchanges[0].status, "done", JSON.stringify(one.exchanges[0]));
  const old = sdk().findLast((e) => e.event === "send")?.agentId;
  const was = sdk().length;
  await followUp(id, sid, "then the CURSOR STEP");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const after = sdk().slice(was);
  const sends = after.filter((e) => e.event === "send");
  assert.equal(sends.length, 2, JSON.stringify(after));
  assert.ok(sends[0].text.startsWith(SELF_ASK) && sends[0].agentId === old && sends[0].mode === "plan", JSON.stringify(sends[0]));
  const made = after.find((e) => e.event === "create");
  assert.ok(made && made.agentId !== old && sends[1].agentId === made.agentId, JSON.stringify(after));
  assert.match(sends[1].text, /^\[Filament compacted turn 1 into the summary below\.[^\n]*\]\nThe agent heard 1 message\(s\) before this one\n/);
  assert.match(sends[1].text, /then the CURSOR STEP$/);
  const marks = await marksOf(String(two.exchanges[1].runId));
  assert.deepEqual(marks.map((/** @type {any} */ e) => [e.type, !!e.fresh, e.result ?? null]), [["compacting", true, null], ["compaction", true, null]]);
  assert.ok(marks[1].tokensBefore >= 170_000 && marks[1].summary > 0, JSON.stringify(marks[1]));
  const rec = await shim.record(String(two.exchanges[1].runId));
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: cs's context held ≈[\d,]+ tokens as its last exchange ended and the message ≈\d+, past its 170,000-token line as a side agent: its earlier exchange summarized by cs, itself, reading its own session/.test(c)), JSON.stringify(rec.changes));
});

// An agent that says neither its usage nor its context's fill: what its context holds is Filament's estimate of all it was
// sent and did, its work included — a launch that reads 125K of a file holds that read — and where nobody knows its
// window, the assumed window's line is drawn.
// (fails before: yes — its brief alone was weighed, no line drawn, and the follow-up went on in the session that held the
// read, nothing asked)
test("an agent that says nothing of its usage, whose window nobody knows: its work is weighed, against the assumed window's line, and the fresh session is weighed from its seed", async () => {
  const id = await newSession("ag/fake-n");
  const sid = await launch(id, "survey ~reads 600000");
  const one = await ended(id, sid, 0);
  assert.equal(one.exchanges[0].status, "done", JSON.stringify(one.exchanges[0]));
  const was = prompts("ag").length;
  await followUp(id, sid, "the SECOND message");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const sent = prompts("ag").slice(was);
  assert.ok(sent[0]?.prompt.startsWith(SELF_ASK), JSON.stringify(sent.map((p) => p.prompt.slice(0, 60))));
  assert.match(sent.at(-1).text, /the SECOND message$/);
  const rec = await shim.record(String(two.exchanges[1].runId));
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: ag's context held ≈[\d,]+ tokens as its last exchange ended and the message ≈\d+, past its 108,800-token line as a side agent \(of the 128,000-token window assumed, as nobody knows its own\): its earlier exchange summarized/.test(c)), JSON.stringify(rec.changes));
  // The fresh session holds its seed and this exchange's words alone: its next message is under the line, and nothing
  // is summarized again.
  const mark = prompts("ag").length;
  await followUp(id, sid, "a THIRD message");
  const three = await ended(id, sid, 2);
  const next = prompts("ag").slice(mark);
  assert.deepEqual(next.map((p) => [p.sessionId, p.text]), [[sent.at(-1).sessionId, "a THIRD message"]]);
  assert.deepEqual(await marksOf(String(three.exchanges[2].runId)), []);
});

// (fails before: yes — its turn's usage, 400,000 input tokens summed over its model calls, stood for what its context held,
// and a small conversation was summarized)
test("an agent that says its turn's usage alone: the usage is no count of its context, and a small conversation goes on as it stands", async () => {
  const id = await newSession("ag/fake-s");
  const sid = await launch(id, "count ~summed 400000");
  await ended(id, sid, 0);
  const was = prompts("ag").length;
  await followUp(id, sid, "a follow-up to a SMALL conversation");
  const two = await ended(id, sid, 1);
  const sent = prompts("ag").slice(was);
  assert.deepEqual(sent.map((p) => p.text), ["a follow-up to a SMALL conversation"], "no summary asked");
  assert.equal(sent[0].sessionId, prompts("ag")[was - 1].sessionId);
  assert.deepEqual(await marksOf(String(two.exchanges[1].runId)), []);
});

// (fails before: yes — 150,000 held, under the 170,000-token line, and the follow-up's own 24K went in past it unweighed)
test("the follow-up's own size is weighed with what its context held", async () => {
  const id = await newSession("ag/fake-s");
  const sid = await launch(id, "read ~holds 150000");
  await ended(id, sid, 0);
  const was = prompts("ag").length;
  await followUp(id, sid, `the BIG follow-up: ${"lorem ipsum ".repeat(10_000)}`);
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const sent = prompts("ag").slice(was);
  assert.ok(sent[0]?.prompt.startsWith(SELF_ASK), JSON.stringify(sent.map((p) => p.prompt.slice(0, 60))));
  assert.match(sent.at(-1).text, LEAD);
  assert.notEqual(sent.at(-1).sessionId, prompts("ag")[was - 1].sessionId, "a fresh session");
});

// (fails before: yes — nothing stood on its run while the summary was written: the exchange had no run yet; and the
// stopped exchange said nothing of the context, so the next follow-up went into the session that held 180,000 unweighed)
test("its thread says it makes room while the summary is written; a Stop then sends nothing, and the next follow-up is weighed by the exchange before", async () => {
  const gate = join(root, "summary-gate");
  const id = await newSession("ags/fake-a");
  const sid = await launch(id, "look around ~holds 180000");
  await ended(id, sid, 0);
  const was = prompts("ags").length;
  await followUp(id, sid, "the STOPPED words");
  await until(() => prompts("ags").slice(was).some((p) => p.prompt.startsWith(SELF_ASK)) || null, "the summary to be asked");
  const running = await until(async () => {
    const s = await subOf(id, sid);
    return s?.status === "running" && s.exchanges[1]?.runId ? s : null;
  }, "the exchange's run, while the summary is written");
  const live = alignEvents(await eventsOf(String(running.exchanges[1].runId))).byRound.get(0);
  assert.equal(live?.compacting ? roundCompactingWords(live.compacting) : null, "⌁ Making room in its conversation: it summarizes its earlier exchanges itself, for a fresh session to go on from…");
  const stop = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${encodeURIComponent(sid)}/stop`, { method: "POST" });
  assert.equal(stop.status, 200, await stop.clone().text());
  writeFileSync(gate, "");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "stopped", JSON.stringify(two.exchanges[1]));
  assert.ok(!prompts("ags").some((p) => p.text.includes("the STOPPED words")), "its words never reached the agent");
  assert.deepEqual((await marksOf(String(two.exchanges[1].runId))).map((/** @type {any} */ e) => e.type), ["compacting"], "nothing gave way");

  const mark = prompts("ags").length;
  await followUp(id, sid, "the NEXT words");
  const three = await ended(id, sid, 2);
  assert.equal(three.exchanges[2].status, "done", JSON.stringify(three.exchanges[2]));
  const next = prompts("ags").slice(mark);
  assert.ok(next[0]?.prompt.startsWith(SELF_ASK), JSON.stringify(next.map((p) => p.prompt.slice(0, 60))));
  assert.match(next.at(-1).text, /^\[Filament compacted turns 1–2 into the summary below\.[\s\S]*the NEXT words$/);
  const rec = await shim.record(String(three.exchanges[2].runId));
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: ags's context held 180,000 tokens as its last exchange ended/.test(c)), JSON.stringify(rec.changes));
});

// (fails before: yes — the fresh session read the summary and the follow-up alone: where its worktree is, and that its
// work waits to be applied, went with the session let go of)
test("the fresh session is told again the standing notes its first message carried, ahead of the summary", async () => {
  const id = await newSession("ag/fake-w", repoDir);
  const sid = await launch(id, "edit around ~holds 180000", { may: "edit" });
  const one = await ended(id, sid, 0);
  assert.equal(one.exchanges[0].status, "done", JSON.stringify(one.exchanges[0]));
  const first = prompts("ag").findLast((p) => p.text.includes("edit around ~holds 180000"));
  assert.match(String(first?.text), /\[Filament: your worktree is /, "its launch was told where its worktree is");
  const was = prompts("ag").length;
  await followUp(id, sid, "now EDIT IT");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const fresh = prompts("ag").slice(was).at(-1);
  assert.notEqual(fresh.sessionId, first.sessionId, "a fresh session");
  assert.equal(fresh.cwd, first.cwd, "in the same worktree");
  const at = (/** @type {string} */ s) => fresh.text.indexOf(s);
  assert.equal(at("[Filament: you work in your own git worktree"), 0, JSON.stringify(fresh.text.slice(0, 300)));
  assert.ok(at("[Filament: your worktree is ") > 0 && at("[Filament: your worktree is ") < at("[Filament compacted turn 1 into the summary below."), JSON.stringify(fresh.text.slice(0, 900)));
  assert.match(fresh.text, /now EDIT IT$/);
});

test("where neither summary is written, the follow-up goes on in its session as it stands, and its thread says so", async () => {
  const id = await newSession("agx/fake-a");
  const sid = await launch(id, "survey ~holds 180000");
  await ended(id, sid, 0);
  const was = prompts("agx").length;
  const before = prompts("agx")[was - 1];
  await followUp(id, sid, "the FOLLOW-UP as it stands");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const sent = prompts("agx").slice(was);
  assert.ok(sent[0]?.prompt.startsWith(SELF_ASK), JSON.stringify(sent.map((p) => p.prompt.slice(0, 60))));
  assert.deepEqual([sent.at(-1).sessionId, sent.at(-1).text], [before.sessionId, "the FOLLOW-UP as it stands"]);
  const marks = await marksOf(String(two.exchanges[1].runId));
  assert.deepEqual(marks.map((/** @type {any} */ e) => [e.type, e.result ?? null]), [["compacting", null], ["compaction", "none"]]);
  assert.match(roundCompactionWords(marks[1]), /^⌁ Its earlier exchanges could not give way \(agx could not write it in its session: [^;]*; agx\/fake-a could not summarize them: [^)]*\): it goes on in its session as it stands$/);
  const rec = await shim.record(String(two.exchanges[1].runId));
  assert.ok((rec.changes || []).some((/** @type {string} */ c) => /^acp: agx's context held 180,000 tokens as its last exchange ended and the message ≈\d+, past its 170,000-token line as a side agent, and its earlier exchange could not give way \(.*\): the message goes on in its session as it stands$/.test(c)), JSON.stringify(rec.changes));
});

test("under its line, the follow-up goes on in its session as it stands", async () => {
  const id = await newSession("ag/fake-b");
  const sid = await launch(id, "glance ~holds 1000");
  await ended(id, sid, 0);
  const was = prompts("ag").length;
  await followUp(id, sid, "a SMALL follow-up");
  const two = await ended(id, sid, 1);
  const sent = prompts("ag").slice(was);
  assert.equal(sent.length, 1, JSON.stringify(sent));
  assert.equal(sent[0].sessionId, prompts("ag")[was - 1].sessionId);
  assert.deepEqual(await marksOf(String(two.exchanges[1].runId)), []);
});

test("Claude Code past its line keeps its own compaction: nothing is asked of it, and it goes on in its session", async () => {
  const id = await newSession("cl/fake-a");
  const sid = await launch(id, "look ~holds 180000");
  await ended(id, sid, 0);
  const was = prompts("cl").length;
  await followUp(id, sid, "the NEXT one");
  const two = await ended(id, sid, 1);
  const sent = prompts("cl").slice(was);
  assert.ok(!sent.some((p) => p.prompt.startsWith(SELF_ASK)), JSON.stringify(sent));
  assert.ok(sent.every((p) => p.sessionId === prompts("cl")[was - 1].sessionId), "its own session");
  assert.deepEqual(await marksOf(String(two.exchanges[1].runId)), []);
});

test("Codex past its line keeps its own compaction: nothing is asked of it, and its thread goes on", async () => {
  const cx = () => lines(join(root, "cx-calls.jsonl"));
  const id = await newSession("cx/gpt-5");
  const sid = await launch(id, "look ~holds 360000");
  const one = await ended(id, sid, 0);
  assert.equal(one.exchanges[0].status, "done", JSON.stringify(one.exchanges[0]));
  const rec = await shim.record(String(one.exchanges[0].runId));
  assert.ok(Number(rec.context?.last?.held) >= 340_000, `past its 340,000-token line: ${JSON.stringify(rec.context)}`);
  const was = cx().length;
  await followUp(id, sid, "the CODEX follow-up");
  const two = await ended(id, sid, 1);
  assert.equal(two.exchanges[1].status, "done", JSON.stringify(two.exchanges[1]));
  const after = cx().slice(was);
  const turns = after.filter((c) => c.method === "turn/start");
  assert.equal(turns.length, 1, JSON.stringify(turns.map((c) => c.params?.input)));
  assert.match(JSON.stringify(turns[0].params?.input), /the CODEX follow-up/);
  assert.ok(!after.some((c) => c.method === "thread/start" || c.method === "thread/fork"), "no fresh thread, and none forked for a summary");
  assert.deepEqual(await marksOf(String(two.exchanges[1].runId)), []);
});

// @ts-check
// team_v2_plan P3, P4 and P5: teams beside a chat. Their words and state (core/beside.js), the team that finds and checks
// (services/teams.js, services/agent-cards.js), and the whole path through a throwaway Filament: a team fired beside a
// chat runs in a chat of its own whose lead starts from the main chat's record, its card's state and result, Notify
// main agent as a turn of Filament's own, Verify…, Stop, Then verify and Then notify running through by themselves, and a
// team beside going with its main chat. And the main agent's own `team` tool (P5): its words, a coding agent's list,
// and a send through the loop whose switches start from the team's own setting, then the chat's. The tool's act is
// `send` since version 123 (d-send); `fire`, its name until then, is still taken, and some calls here stay on it on
// purpose, each marked.
// (fails before: yes — a team could only take a chat over)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BESIDE_LIMITS,
  RECORD_HEAD,
  RESULT_HEAD,
  askProblem,
  besideAction,
  besideState,
  crewOf,
  isRecordBlock,
  isTeamResult,
  noteFor,
  openingContent,
  recordBlock,
  resultMessage,
  shortOf,
  verifyAsk,
} from "../src/core/beside.js";
import { createTeamStore, SHIPPED_TEAMS } from "../src/services/teams.js";
import { BESIDE_ACTIONS, BESIDE_OFF, BESIDE_SWITCHED_OFF, BESIDE_TOOL, besideAtOf, besideCall, leadStep } from "../src/app/agent/beside-tool.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { PROMPT_VERSION } from "../src/app/agent/prompt.js";
import { FORK_REFUSALS, argSummary } from "../src/app/agent/tools.js";
import { serverInstructions } from "../src/http/mcp.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { createAgentCardStore, SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { AGENT_TEAMS, agentTeamsOf, globalLayer, resolveSettings } from "../src/services/session-settings.js";
import { estimateTokens, tailWithinTokens } from "../src/core/tokens.js";
import { fellWords } from "../src/ui/harness/lib/beside.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { asV122Tools } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/** A picture a team's lead draws. */
const TEAM_SVG = "<svg viewBox='0 0 100 40'><text x='4' y='20'>TEAM_CODE</text></svg>";

describe("a team beside: its words and its state", () => {
  test("the person's words are checked; the state is read from its chat; a short is cut with an ellipsis", () => {
    assert.match(String(askProblem("  ")), /say what the team is to do/);
    assert.match(String(askProblem("x".repeat(BESIDE_LIMITS.ask + 1))), /4000 characters at most; this is 4001/);
    assert.equal(askProblem("find bugs in the last 5 phases"), null);
    assert.equal(besideState({ busy: true, asking: false, workers: 0, last: null }), "working");
    assert.equal(besideState({ busy: false, asking: false, workers: 2, last: { final: true } }), "working", "its workers still run");
    assert.equal(besideState({ busy: true, asking: true, workers: 0, last: null }), "asking");
    assert.equal(besideState({ busy: false, asking: false, workers: 0, last: { final: true } }), "done");
    assert.equal(besideState({ busy: false, asking: false, workers: 0, last: { final: false } }), "stopped", "a turn a restart cut, or one that failed");
    assert.equal(shortOf("a  b\n\nc", 10), "a b c");
    assert.equal(shortOf("abcdefghijkl", 6), "abcde…");
  });

  // (fails before: yes — the 9 plausible of 10-19: a record too big for half the lead's window was cut at four
  // characters a token, so a chat of code or CJK kept up to four times the tokens it had room for)
  test("a record cut to fit keeps its newest end within the tokens it has room for, in code and CJK too", () => {
    const code = Array.from({ length: 4000 }, (_, i) => `if(a[${i}]){b.c(d,{e:[${i}]});}`).join("\n");
    const cjk = "解析器の設計を見直す。".repeat(3000);
    for (const [what, s] of /** @type {const} */ ([["code", code], ["CJK", cjk], ["prose", "the parser reads the field. ".repeat(4000)]])) {
      const old = s.slice(-1000 * 4);
      const kept = tailWithinTokens(s, 1000);
      assert.ok(estimateTokens(kept) <= 1000, `${what}: ${estimateTokens(kept)} tokens kept of a room of 1000`);
      assert.ok(estimateTokens(kept) > 900, `${what}: the room is used, ${estimateTokens(kept)}`);
      assert.ok(s.endsWith(kept), `${what}: the newest end`);
      if (what !== "prose") assert.ok(estimateTokens(old) > 1000, `${what}: four characters a token overran (${estimateTokens(old)})`);
    }
    assert.equal(tailWithinTokens("short", 1000), "short");
    assert.equal(tailWithinTokens("some words", 0), "");
  });

  test("the lead's first message: the record first, the person's words last; the record says what it holds", () => {
    const record = recordBlock({ team: "Bug Hunter", title: 'The "parser"', turns: 3, text: "user: build it", form: "fold", cut: true, running: { rounds: 2, tools: 5, text: "round 2" }, waiting: { question: "Which file?", said: "I looked." } });
    assert.ok(record.startsWith(`${RECORD_HEAD} title="The 'parser'" turns="3">`));
    assert.match(record, /You lead the Bug Hunter team beside the person's main chat/);
    assert.match(record, /condensed the way the chat's own compaction condenses them, so they fit, the oldest part left out, then the turn running now/);
    assert.match(record, /<running-turn rounds="2" calls="5">[\s\S]*round 2\n<\/running-turn>/);
    assert.match(record, /<waiting>[\s\S]*It asks:\nWhich file\?\n<\/waiting>\n<\/main-chat>$/);
    const content = openingContent({ record, ask: "  find bugs \r\n" });
    assert.deepEqual(content.map((b) => b.text.slice(0, 10)), [record.slice(0, 10), "find bugs"]);
    assert.equal(isRecordBlock(content[0]), true);
    assert.equal(isRecordBlock(content[1]), false);
    assert.deepEqual(openingContent({ record: null, ask: "find bugs" }), [{ type: "text", text: "find bugs" }], "a fresh start: the words alone");
  });

  // (fails before: yes — d-send: the message said who sent the team from the person's side, and its reader is the main
  // agent: it read "which you fired" of a team the person sent, and "which the main agent fired" of its own)
  test("a result as the main agent reads it, and BugHunters' ask for a check: one text each, said by whom and for what, from its reader's side", () => {
    const m = resultMessage({ name: "Bug Hunter", ask: "find bugs", firedBy: "agent", result: "Found: 2", auto: true });
    assert.ok(m.startsWith(`${RESULT_HEAD}: the Bug Hunter team, which you sent beside this chat, was asked: "find bugs". The person set it to reach you when done. It changed nothing: what to do with it is yours and the person's.]`), m);
    assert.match(m, /<team-result team="Bug Hunter">\nFound: 2\n<\/team-result>$/);
    assert.equal(isTeamResult({ content: [{ type: "text", text: m }] }), true);
    assert.equal(isTeamResult({ content: m }), true);
    assert.equal(isTeamResult({ content: [{ type: "text", text: m }, { type: "text", text: "and mine" }] }), false);
    const checked = resultMessage({ name: "Verifier", ask: "check", firedBy: "you", result: "Confirmed: 1", checked: { name: "Bug Hunter" }, auto: false });
    assert.match(checked, /the Verifier team checked what the Bug Hunter team found beside this chat, which the person sent, against the code as it is now\. What follows is that check\. The person sent its result to you\./);
    // Each reader's side, whole: a team the person sent, its result sent on by a press; a check of a team the agent sent.
    const theirs = resultMessage({ name: "BugHunters", ask: "hunt", firedBy: "you", result: "r", auto: false });
    assert.ok(theirs.startsWith(`${RESULT_HEAD}: the BugHunters team, which the person sent beside this chat, was asked: "hunt". The person sent its result to you. It changed nothing: what to do with it is yours and the person's.]`), theirs);
    const own = resultMessage({ name: "BugHunters", ask: "check", firedBy: "agent", result: "r", checked: { name: "Builders" }, auto: true });
    assert.ok(own.startsWith(`${RESULT_HEAD}: the BugHunters team checked what the Builders team found beside this chat, which you sent, against the code as it is now. What follows is that check. The person set it to reach you when done.`), own);
    for (const said of [m, checked, theirs, own]) assert.doesNotMatch(said.split("\n")[0], /\bfir(e|es|ed|ing)\b|the main agent/i, said);
    const long = resultMessage({ name: "T", ask: "a", firedBy: "you", result: "x".repeat(BESIDE_LIMITS.result + 5), auto: false });
    assert.match(long, /the rest of the result is left out; the team's chat holds it whole/);
    const v = verifyAsk({ name: "Bug Hunter", ask: "find bugs", result: "Found: a null deref at a.js:3" });
    assert.match(v, /^Check what the Bug Hunter team found \(it was asked: "find bugs"\) against the code as it is now\.\nFor each claim: Confirmed \(with why\), Plausible \(it cannot be shown either way\) or Dismissed \(with why\)\. Fix nothing\.\n\nFound: a null deref at a\.js:3$/);
  });

  // (fails before: yes — found on the Bug Hunter's own result of 10-19, some 10,000 characters: the Verifier's words
  // cut it to fit the person's 4000, so it checked the first five claims of fifteen)
  test("BugHunters checks a result whole: its words have a check's room, the person's their own", () => {
    const result = `Found:\n${Array.from({ length: 15 }, (_, i) => `${i + 1}. a claim at a.js:${i + 1} ${"x".repeat(600)}`).join("\n")}`;
    const v = verifyAsk({ name: "Bug Hunter", ask: "check the plans", result });
    assert.ok(v.endsWith(result), "the result whole, its fifteenth claim included");
    assert.equal(askProblem(v, BESIDE_LIMITS.check), null, "a Verifier's fire takes it");
    assert.match(String(askProblem(v)), /4000 characters at most/, "the person's own words keep their 4000");
    const huge = verifyAsk({ name: "Bug Hunter", ask: "a", result: "y".repeat(BESIDE_LIMITS.result + 50) });
    assert.match(huge, /…\[the rest is in the Bug Hunter team's chat\]$/, "past a result's own room, cut as its hand-off cuts it");
    assert.equal(askProblem(huge, BESIDE_LIMITS.check), null);
  });

  // (fails before: yes — found by the Bug Hunter, 10-19: with Then verify and Then notify on, a Verifier that did not
  // start left the main agent hearing nothing, said only in the log)
  test("Then verify that does not start leaves Then notify to the result itself", () => {
    const src = readFileSync("src/app/teams-beside.js", "utf8");
    assert.match(src, /void verify\(id, \{ auto: true \}\)\.catch\(\(\/\*\* @type \{any\} \*\/ e\) => \{\s+log\("warn", [^\n]+\);\s+if \(b\.notify\) return notify\(id, \{ auto: true \}\)\.catch\(/);
    assert.match(src, /const problem = askProblem\(input\.ask, input\.of == null \? BESIDE_LIMITS\.ask : BESIDE_LIMITS\.check\);/);
  });
});

describe("BugHunters, and a team's own settings", () => {
  // (fails before: yes — both named their models in the code, Opus and GLM 5.3 Flash, which the person could not change)
  // One team finds and checks now (the plan's p6): a Hunter and a Checker, two Reviewer seats under one Lead.
  test("BugHunters ships read-only and names no model — the person sets them; its two seats read only", () => {
    const cards = createAgentCardStore({ dataDir: null });
    const store = createTeamStore({ dataDir: null, cards });
    const hunt = store.find("bughunters");
    assert.deepEqual([hunt?.name, hunt?.lead.tag, hunt?.leadModel, hunt?.readOnly, hunt?.models, hunt?.members.map((m) => [m.tag, m.may])], ["BugHunters", "huntlead", null, true, [], [["hunter", "read"], ["checker", "read"]]]);
    assert.equal(store.find("BugHunters")?.key, "bughunters", "by its name too");
    assert.deepEqual([store.find("bug-hunter"), store.find("Verifier")], [null, null], "the two it took over are no team");
    assert.deepEqual([store.find("builders")?.readOnly, store.find("builders")?.leadModel, store.find("builders")?.fired], [false, null, { notify: false, verify: false }]);
    // Its crew is Reviewer, seated as the Hunter and the Checker ("Teams, improved and kept" of 11-03).
    assert.deepEqual(hunt?.members.map((m) => m.card), ["reviewer", "reviewer"]);
    assert.ok(Object.hasOwn(SHIPPED_TEAMS, "bughunters") && Object.hasOwn(SHIPPED_CARDS, "huntlead") && !Object.hasOwn(SHIPPED_CARDS, "verifylead"));
    assert.match(String(cards.find("huntlead")?.thinks), /you fix nothing[\s\S]*Found \(each one confirmed, with its evidence\), Plausible \(with what is missing to show it\), Dismissed \(each in a line, with why\) and what was not covered/);
  });

  test("a team's lead model, read-only and what a main agent's fire does: checked, kept only where named", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-teams-own-"));
    try {
      const cards = createAgentCardStore({ dataDir: null });
      const store = createTeamStore({ dataDir: dir, cards });
      const base = { name: "Night", lead: "product", members: [{ tag: "builder" }] };
      assert.throws(() => store.create({ ...base, leadModel: "a\nb" }), /leadModel is the model its lead runs on beside a chat/);
      assert.throws(() => store.create({ ...base, readOnly: "yes" }), /readOnly is true for a team whose chat changes no file, or false/);
      assert.throws(() => store.create({ ...base, fired: { notify: true, later: true } }), /fired says what a main agent's fire of the team does by itself: \{ notify, verify \}/);
      // (the plan's p6: its total launches in one run among them)
      assert.throws(() => store.create({ ...base, colour: "red" }), /unknown field `colour`: a team has a name, a lead, members, the models its workers run on, its lead's models, readOnly, what a main agent's fire does \(fired\) and its check/);
      const t = store.create({ ...base, leadModel: " Kimi K3 ", fired: { notify: true, verify: false } });
      assert.deepEqual([t.leadModel, t.readOnly, t.fired], ["Kimi K3", false, { notify: true, verify: false }]);
      const again = createTeamStore({ dataDir: dir, cards }).find("night");
      assert.deepEqual([again?.leadModel, again?.readOnly, again?.fired], ["Kimi K3", false, { notify: true, verify: false }]);
      const off = store.update("night", { leadModel: null, fired: null, readOnly: true });
      assert.deepEqual([off.leadModel, off.readOnly, off.fired], [null, true, { notify: false, verify: false }]);
      store.update("bughunters", { leadModel: "Claude Opus 5.5", models: ["GLM 5.3 Flash"] });
      const copy = store.create({ from: "bughunters" });
      assert.deepEqual([copy.name, copy.leadModel, copy.readOnly, copy.models], ["BugHunters copy", "Claude Opus 5.5", true, ["GLM 5.3 Flash"]], "a Duplicate keeps them, as you set them");
      // (fails before: yes — the owner's 10-19 list: a team's lead ran on one model) Its lead's models, first choice
      // first: one model is a list of one, and a file from before the list is read so.
      const list = store.update("night", { leadModels: [" Kimi K3 ", "GLM 5.3"] });
      assert.deepEqual([list.leadModels, list.leadModel], [["Kimi K3", "GLM 5.3"], "Kimi K3"]);
      assert.deepEqual(createTeamStore({ dataDir: dir, cards }).find("night")?.leadModels, ["Kimi K3", "GLM 5.3"]);
      assert.deepEqual(copy.leadModels, ["Claude Opus 5.5"], "one model, a list of one");
      assert.throws(() => store.update("night", { leadModel: "a", leadModels: ["b"] }), /Give its lead's models \(first choice first\) or one model, not both\./);
      assert.throws(() => store.update("night", { leadModels: ["a", "A"] }), /`A` is named twice: each of its lead's models once, first choice first\./);
      assert.throws(() => store.update("night", { leadModels: "a" }), /leadModels is the models its lead runs on beside a chat, first choice first/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// (fails before: yes — U13-D9 of 10-20: no setting said which teams the main agent may start by itself)
describe("the teams the main agent may start by itself (U13-D9)", () => {
  test("BugHunters where nobody said; a list the config says, an empty one too, replaces it", () => {
    assert.deepEqual(agentTeamsOf(null), ["bughunters"]);
    assert.deepEqual(agentTeamsOf(resolveSettings({}).effective), ["bughunters"]);
    const of = (/** @type {any} */ teams) => agentTeamsOf(resolveSettings({ global: globalLayer({ agentLoop: { subagents: { teams } } }) }).effective);
    assert.deepEqual(of(["builders"]), ["builders"]);
    assert.deepEqual(of([]), [], "an empty list is none");
    assert.deepEqual(of(undefined), ["bughunters"]);
    assert.deepEqual(resolveSettings({ session: { subagents: { teams: ["builders"] } } }).effective.subagents.teams, ["builders"]);
  });

  // The owner's rule of 10-31: an old saved setting falls back to the default, with no code that converts it.
  // (fails before: yes — found 11-02: a list naming only teams that are gone left the main agent none to start, and the
  // two places that read it disagreed — one dropped the names, one kept them)
  test("a list whose every name is no team any more is the default again; a team still there is kept, a gone one dropped", () => {
    const known = (/** @type {string} */ k) => (["bughunters", "builders"].includes(k) ? k : null);
    const of = (/** @type {any} */ teams) => agentTeamsOf(resolveSettings({ global: globalLayer({ agentLoop: { subagents: { teams } } }) }).effective, known);
    assert.deepEqual(of(["gone-team"]), ["bughunters"]);
    assert.deepEqual(of(["bug-hunter", "verifier"]), ["bughunters"], "the two BugHunters took over are gone teams too");
    assert.deepEqual(of(["gone-team", "builders"]), ["builders"]);
    assert.deepEqual(of([]), [], "an empty list is still none");
    assert.deepEqual(of(undefined), ["bughunters"]);
  });
});

describe("a team beside a chat, through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** What each lead's request held, newest last. @type {string[]} */
  const seen = [];
  /** Each such request's model and effort, as the provider was sent them. @type {{ model: string, effort: string | null, text: string }[]} */
  const bodies = [];
  const said = (/** @type {any} */ body) => JSON.stringify(body?.messages || []);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-beside-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = said(call.body);
      seen.push(text);
      bodies.push({ model: String(call.body.model || ""), effort: call.body.output_config?.effort ?? null, text });
      // A lead that draws, and the main agent that opens its picture by its name (HarnessV4_DesignPass_Plan, case 13).
      /** @param {string} id @param {string} name @param {any} input */
      const use = (id, name, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }] });
      if (text.includes("a team beside this chat finished") && text.includes("team_layout")) return text.includes("tu_open_team") ? anthropicReply("Seen the layout.", { model: "m-1" }) : use("tu_open_team", "envelope", { picture: "team_layout" });
      if (text.includes("draw the team layout")) return text.includes("tu_team_draw") ? anthropicReply("Drew the layout.", { model: "m-1" }) : use("tu_team_draw", "show_visual", { title: "team layout", code: TEAM_SVG });
      // BugHunters checking what the Builders team found (Then verify).
      if (text.includes("Check what the Builders team found")) return anthropicReply("Confirmed: the null check in parse.js:3.", { model: "m-1" });
      // A lead that ends with the fixed list (§10 O3).
      if (text.includes("<main-chat") && text.includes("a ranked hunt"))
        return anthropicReply("Two found.\n\nFindings:\n- Found | A null read | parse.js:3 | shown by a test\n- Found | A double send | send.js:8 | read it\n- Plausible | Off by one | lex.js:9 | no test\n- Not covered | the CLI | - | no slot", { model: "m-1" });
      if (text.includes("<main-chat")) return anthropicReply("Found: parse.js:3 reads a field of null. Plausible: none. Not covered: tests.", { model: "m-1" });
      if (text.includes("a team beside this chat finished")) return anthropicReply("Noted: I will fix parse.js:3.", { model: "m-1" });
      return anthropicReply("The parser is built.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        // Its list of models names m-2 and m-3 too: a team's models are read as a person names them, from that list. A
        // model that takes effort levels, for a lead picked to think hard.
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1", "m-2", "m-3", "claude-opus-5-5"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }, { match: "claude-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build the parser", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const besideList = async () => (await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || [];
  /** @param {string} id */
  const rowOf = async (id) => (await besideList()).find((/** @type {any} */ t) => t.id === id) || null;
  const transcript = async (/** @type {string} */ id) => (await shim.api(`/api/sessions/${id}/transcript`)).json();

  test("fired: its own chat, read-only, its lead starting from the record; done with its result; the main chat untouched", async () => {
    const bad = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "nobody", ask: "x" } });
    assert.equal(bad.status, 404);
    assert.match((await bad.json()).error, /no team answers to "nobody"/);
    const empty = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: " " } });
    assert.equal(empty.status, 400);
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "find bugs in the parser", model: "m-1" } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    const id = out.team.id;
    assert.deepEqual([out.team.main, out.team.team.name, out.team.firedBy, out.team.readOnly, out.team.verify, out.team.notify], [sid, "BugHunters", "you", true, false, false]);
    const row = await until(async () => {
      const x = await rowOf(id);
      return x?.state === "done" ? x : null;
    }, "the hunt's result");
    assert.match(row.result.text, /^Found: parse\.js:3 reads a field of null/);
    assert.equal(row.notified, null);
    const lead = seen.find((s) => s.includes("<main-chat"));
    assert.ok(lead, "the lead read the record");
    assert.match(String(lead), /build the parser[\s\S]*The parser is built\.[\s\S]*find bugs in the parser/, "the main chat's turn, then the person's words");
    // Its own chat: a team's, read-only, its first message's record folded on the page; not a chat of the left bar.
    const settings = await (await shim.api(`/api/sessions/${id}/settings`)).json();
    assert.deepEqual([settings.effective?.engine?.team, settings.effective?.loop?.permissions], ["bughunters", "read-only"]);
    const t = await transcript(id);
    assert.equal(t.turns[0].record, true);
    const list = await (await shim.api("/api/memory/sessions?limit=50")).json();
    assert.ok(!JSON.stringify(list).includes(id), "a team beside lives under its main chat");
    // The main chat: two marks, no turn added.
    const main = await transcript(sid);
    assert.equal(main.turns.length, 1);
    const marks = main.boundaries.filter((/** @type {any} */ b) => b.type === "team" && b.id === id).map((/** @type {any} */ b) => [b.event, b.afterTurn]);
    assert.deepEqual(marks, [["fired", 1], ["result", 1]]);
    // Verify… takes no BugHunters result, a check already (Builders' result is checked below); Stop on a team at rest
    // stops nothing.
    const v = await shim.api(`/api/sessions/${sid}/beside/${id}/verify`);
    assert.deepEqual([v.status, (await v.json()).error], [409, "BugHunters' result is a check already: nothing checks it again"]);
    const stop = await (await shim.api(`/api/sessions/${sid}/beside/${id}/stop`, { method: "POST", body: {} })).json();
    assert.deepEqual([stop.turn, stop.workers], [false, 0]);
  });

  test("Notify main agent: a turn of Filament's own in the main chat, drawn as Filament's; once per result", async () => {
    const id = (await besideList()).find((/** @type {any} */ t) => t.team.key === "bughunters")?.id;
    const r = await shim.api(`/api/sessions/${sid}/beside/${id}/notify`, { method: "POST", body: {} });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.equal(out.how, "sent");
    const main = await until(async () => {
      const t = await transcript(sid);
      return t.turns.length === 2 && t.turns[1].final ? t : null;
    }, "the main agent's turn with the result");
    assert.equal(main.turns[1].teamResult, true);
    assert.ok(seen.some((s) => s.includes("a team beside this chat finished") && s.includes("parse.js:3 reads a field of null")), "the main agent read the result whole");
    const row = await rowOf(id);
    assert.equal(row.notified.how, "sent");
    const again = await shim.api(`/api/sessions/${sid}/beside/${id}/notify`, { method: "POST", body: {} });
    assert.equal(again.status, 409);
    assert.match((await again.json()).error, /already went to the main agent/);
  });

  test("Then verify and Then notify: the Builders' work, BugHunters on its result, the check to the main agent, by themselves", async () => {
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "builders", ask: "build it again", model: "m-1", verify: true, notify: true } });
    const built = (await r.json()).team;
    assert.equal(r.status, 200);
    const check = await until(async () => {
      const list = await besideList();
      const v = list.find((/** @type {any} */ t) => t.of === built.id);
      return v?.state === "done" && v.notified ? v : null;
    }, "BugHunters' check sent on", { timeoutMs: 20_000 });
    assert.equal(check.team.key, "bughunters");
    assert.equal((await rowOf(built.id)).verifiedBy, check.id);
    assert.equal((await rowOf(built.id)).notified, null, "the Builders' own result waits: the check went instead");
    await until(async () => seen.some((s) => s.includes("the BugHunters team checked what the Builders team found") && s.includes("The person set it to reach you when done.")), "the main agent read the check");
    // Verify… reads the claims: the Builders' result, for BugHunters to check.
    const v = await (await shim.api(`/api/sessions/${sid}/beside/${built.id}/verify`)).json();
    assert.equal(v.team, "bughunters");
    assert.match(v.ask, /^Check what the Builders team found \(it was asked: "build it again"\)[\s\S]*Found: parse\.js:3/);
  });

  // (fails before: yes — found by the Bug Hunter, 10-19: In charge could set another team on a team's own chat, and Back
  // to your agent give it to an agent; only On the side was refused)
  test("a team's own chat keeps its team: no write sets another on it or gives it back, whatever writes; its other settings still change", async () => {
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt once more", model: "m-1" } });
    const t = (await r.json()).team;
    assert.equal(r.status, 200);
    const write = async (/** @type {any} */ body) => {
      const w = await shim.api(`/api/sessions/${t.id}/settings`, { method: "PATCH", body });
      return { status: w.status, body: await w.json() };
    };
    for (const body of [{ patch: { engine: { mode: "team", team: "builders" } } }, { patch: { "engine.team": "builders" } }, { unset: ["engine.mode"] }, { unset: ["engine"] }, { patch: { engine: { mode: "loop" } } }]) {
      const out = await write(body);
      assert.equal(out.status, 400, JSON.stringify(body));
      assert.match(out.body.error, /a team's own chat keeps its team: put a team in charge of its main chat instead/);
    }
    assert.equal((await write({ patch: { engine: { supervise: false } } })).status, 200, "how it runs is still its own to change");
    const s = await (await shim.api(`/api/sessions/${t.id}/settings`)).json();
    assert.deepEqual([s.effective?.engine?.mode, s.effective?.engine?.team], ["team", "bughunters"]);
  });

  // (fails before: yes — a model the team named that could not run was passed over in silence, its workers' models could
  // not be picked for one run, and a team that ships named Opus and GLM 5.3 Flash in the code)
  test("what it runs on: said before Send, the same as a fire does; a named model that cannot run said with why; its workers picked for one run", async () => {
    const runsOn = async (/** @type {string} */ q) => {
      const r = await shim.api(`/api/sessions/${sid}/beside/runs-on?${q}`);
      return { status: r.status, body: await r.json() };
    };
    // A team that ships names no model: its lead on the chat's, its crew on the chat's list.
    // (fails before: yes — the owner's word of 11-05: it said `seats`, how many of its crew ran at once at most, the
    // chat's number) No count goes with it: each model's limit, on its row, holds.
    assert.deepEqual((await runsOn("team=bughunters")).body, { lead: "m-1", workers: null, from: "seats", fell: [] });
    // The chat's own list, where the team names none: the session's or the project's (found by the Bug Hunter, 10-19,
    // where the card read the chat's layer alone).
    const own = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body });
    // (fails before: yes — U13-D14 of 10-20: the crews ran on a list of their own, subagents.workers, apart from the chat's)
    assert.equal((await own({ patch: { subagents: { pool: [{ model: "m-2", seats: 2 }, { model: "m-3", seats: 6 }] } } })).status, 200);
    assert.deepEqual((await runsOn("team=bughunters")).body, { lead: "m-1", workers: ["m-2", "m-3"], from: "chat", fell: [] }, "the list's old seats say nothing");
    assert.equal((await own({ patch: { subagents: { most: 5 } } })).status, 400, "the chat's number is no setting now");
    assert.equal((await own({ unset: ["subagents.pool"] })).status, 200);
    assert.equal((await runsOn("team=bughunters")).body.from, "seats");
    assert.equal((await own({ patch: { subagents: { workers: [{ model: "m-3" }] } } })).status, 400, "the crews' list is no setting now");
    assert.match(readFileSync("src/app/teams-beside.js", "utf8"), /const source = doc\?\.sources\?\.\["subagents\.pool"\];/);
    // Set by the person: a lead's model and workers' models, one of each that cannot run.
    const set = await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModel: "zz-none-lead", models: ["m-2", "zz-none"] } });
    assert.equal(set.status, 200, await set.clone().text());
    const on = (await runsOn("team=bughunters")).body;
    assert.deepEqual([on.lead, on.workers, on.from, on.fell.map((/** @type {any} */ f) => [f.name, f.as])], ["m-1", ["m-2"], "team", [["zz-none-lead", "lead"], ["zz-none", "workers"]]], JSON.stringify(on));
    assert.ok(on.fell.every((/** @type {any} */ f) => f.why.length > 0), "each says why");
    // (fails before: yes — U13-D8 of 10-20: the chat's own list won over the team's models, §9 Q6) The team's own models
    // come before the chat's own list.
    assert.equal((await own({ patch: { subagents: { pool: [{ model: "m-3" }] } } })).status, 200);
    const over = (await runsOn("team=bughunters")).body;
    assert.deepEqual([over.workers, over.from], [["m-2"], "team"], JSON.stringify(over));
    assert.equal((await own({ unset: ["subagents.pool"] })).status, 200);
    assert.deepEqual((await runsOn("team=bughunters&model=m-3")).body.lead, "m-3", "the card's pick for its lead");
    // (fails before: yes — the owner's 10-19 list) Its lead's models, first choice first: the first that can run, the
    // one before it said with why and with the one its lead runs on instead.
    assert.equal((await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: ["zz-none-lead", "m-3"] } })).status, 200);
    const next = (await runsOn("team=bughunters")).body;
    assert.deepEqual([next.lead, next.fell.filter((/** @type {any} */ f) => f.as === "lead").map((/** @type {any} */ f) => [f.name, f.next])], ["m-3", [["zz-none-lead", "m-3"]]], JSON.stringify(next));
    assert.equal((await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModel: "zz-none-lead" } })).status, 200);
    assert.equal((await runsOn("team=nobody")).status, 404);
    // Fired with its workers picked for this run: its chat takes them as its own Default models for team workers.
    const bad = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt", workers: "zz-none" } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /^zz-none cannot run now \(.+\): pick another model for its workers$/);
    // (fails before: yes — the 9 plausible of 10-19: a workers' pick that cannot run made the Brief's read a refusal, so
    // it said nothing, and a lead's pick was never checked) Each pick that cannot run is said before Send, with why;
    // Send refuses it.
    const picks = (await runsOn("team=bughunters&model=zz-none-pick&workers=zz-none")).body;
    assert.deepEqual(picks.fell.filter((/** @type {any} */ f) => f.picked).map((/** @type {any} */ f) => [f.name, f.as, f.why.length > 0]), [["zz-none-pick", "lead", true], ["zz-none", "workers", true]], JSON.stringify(picks));
    assert.deepEqual(fellWords(picks).filter((w) => /pick another/.test(w)).map((w) => w.replace(/ \(.+\)/, "")), [
      "zz-none-pick cannot run now: pick another model for its lead",
      "zz-none cannot run now: pick another model for its workers",
    ]);
    const badLead = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt", model: "zz-none-pick" } });
    assert.equal(badLead.status, 400);
    assert.match((await badLead.json()).error, /^zz-none-pick cannot run now \(.+\): pick another model for its lead$/);
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt with cheap workers", workers: "m-2" } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.deepEqual([out.team.on.lead, out.team.on.workers, out.team.on.from, out.team.on.fell.map((/** @type {any} */ f) => f.name)], ["m-1", ["m-2"], "picked", ["zz-none-lead"]], "its card says what it runs on, and what could not run");
    const settings = await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json();
    // (fails before: yes — U13-D8 of 10-20: the pick was written as the chat's own list, which the team's own models
    // now come before) The pick is the run's own, apart from the chat's list.
    assert.equal(settings.effective?.engine?.teamWorkers, "m-2");
    assert.notEqual(settings.sources?.["subagents.pool"], "session", "the chat's list is not the pick");
    // Given back to what ships.
    const back = await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModel: null, models: [] } });
    assert.equal((await back.json()).team.tuned, false);
    // (fails before: yes — U13-D11 of 10-20: a lead's own card's models were skipped where it led a team) Its lead runs on
    // its own card's models after its team's, before the chat's.
    assert.equal((await shim.api("/api/agents/huntlead", { method: "PUT", body: { models: ["zz-none-card", "m-3"] } })).status, 200);
    const carded = (await runsOn("team=bughunters")).body;
    assert.deepEqual([carded.lead, carded.fell.map((/** @type {any} */ f) => [f.name, f.as, f.next])], ["m-3", [["zz-none-card", "lead", "m-3"]]], JSON.stringify(carded));
    assert.equal((await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: ["m-2"] } })).status, 200);
    assert.equal((await runsOn("team=bughunters")).body.lead, "m-2", "its team's first");
    assert.equal((await runsOn("team=bughunters&model=m-1")).body.lead, "m-1", "the pick over both");
    assert.equal((await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: [] } })).status, 200);
    assert.equal((await shim.api("/api/agents/huntlead", { method: "PUT", body: { models: [] } })).status, 200);
    assert.equal((await runsOn("team=bughunters")).body.lead, "m-1");
  });

  // (fails before: yes — the owner's 10-21: a team's Brief picked no effort, and a fire took none)
  test("how hard its lead and its workers think, picked for one run: its lead at that level on its model, its workers' in its chat; none picked, the main agent's; a word that is no effort is refused", async () => {
    const fire = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt hard", ...body } });
    const settingsOf = async (/** @type {string} */ id) => (await shim.api(`/api/sessions/${id}/settings`)).json();
    const bad = await fire({ effort: "huge" });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error, "effort is one of model, low, medium, high, xhigh, max: how hard its lead thinks");
    const badCrew = await fire({ workersEffort: "huge" });
    assert.equal(badCrew.status, 400);
    assert.equal((await badCrew.json()).error, "workersEffort is one of model, low, medium, high, xhigh, max: how hard its workers think");
    // (fails before: yes — the owner's word of 11-05: none picked, its lead ran at its model's own and its crew at the
    // chat's setting for agents, else max) The main agent's effort is its lead's and its crew's where the Brief picks none.
    assert.equal((await shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body: { patch: { model: { effort: "low" } } } })).status, 200);
    const plain = (await (await fire({ ask: "hunt plain on opus", model: "claude-opus-5-5" })).json()).team;
    // (fails before: yes — the review of 11-05: the crew took the lead's effort as picked, over a level its model's name
    // spells) Its chat keeps its lead's as its main agent's, which its crew inherits; nothing is picked for them.
    const ps = await settingsOf(plain.id);
    assert.deepEqual([ps.effective?.model?.effort, ps.effective?.engine?.teamEffort ?? null], ["low", null]);
    const plainLead = /** @type {any} */ (await until(async () => bodies.find((b) => b.text.includes("hunt plain on opus")) || null, "its lead's request"));
    assert.deepEqual([plainLead.model, plainLead.effort], ["claude-opus-5-5", "low"]);
    // Picked: its lead on its model at that level — the provider is sent it — its crew's in its chat.
    const r = await fire({ ask: "hunt hard on opus", model: "claude-opus-5-5", effort: "high", workersEffort: "xhigh" });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.equal(out.team.on.lead, "claude-opus-5-5", "its card names the model, not the level's name");
    assert.equal((await settingsOf(out.team.id)).effective?.engine?.teamEffort, "xhigh");
    const lead = /** @type {any} */ (await until(async () => bodies.find((b) => b.text.includes("hunt hard on opus")) || null, "its lead's request"));
    assert.deepEqual([lead.model, lead.effort], ["claude-opus-5-5", "high"]);
    assert.equal((await shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body: { unset: ["model.effort"] } })).status, 200);
  });

  // (fails before: yes — the owner's word of 11-05: "Fallback rows: model · account · effort"; its lead's models were
  // names alone)
  test("its lead's model that says how hard it thinks on it: its lead's where the Brief picks none, over the main agent's; the Brief's pick over it", async () => {
    const fire = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ...body } });
    const leadSaid = async (/** @type {string} */ ask) => /** @type {any} */ (await until(async () => bodies.find((b) => b.text.includes(ask)) || null, "its lead's request"));
    const mine = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body });
    assert.equal((await mine({ patch: { model: { effort: "low" } } })).status, 200);
    try {
      assert.equal((await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: [{ model: "claude-opus-5-5", effort: "high" }] } })).status, 200);
      const on = await (await shim.api(`/api/sessions/${sid}/beside/runs-on?team=bughunters`)).json();
      assert.deepEqual([on.lead, on.leadEffort], ["claude-opus-5-5", "high"], "said before Send");
      const r = await fire({ ask: "hunt at its row's" });
      const out = await r.json();
      assert.equal(r.status, 200, JSON.stringify(out));
      assert.equal((await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json()).effective?.model?.effort, "high");
      const m = await leadSaid("hunt at its row's");
      assert.deepEqual([m.model, m.effort], ["claude-opus-5-5", "high"], "its row's, over the main agent's");
      assert.equal((await fire({ ask: "hunt at the pick", effort: "medium" })).status, 200);
      const p = await leadSaid("hunt at the pick");
      assert.deepEqual([p.model, p.effort], ["claude-opus-5-5", "medium"], "the Brief's pick over its row's");
    } finally {
      await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: null } });
      await mine({ unset: ["model.effort"] });
    }
  });

  // (fails before: yes — the review of 11-05: "" went to its chat as it was, where its chat's model is its lead's, so its
  // crew ran on its lead's model where Send said the main chat's)
  test("a row of this chat's that says \"\" goes to a team's chat as this chat's model, as Send says it", async () => {
    const mine = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body });
    assert.equal((await mine({ patch: { subagents: { pool: [{ model: "" }, { model: "m-2" }], byCard: { hunter: [{ model: "" }] }, byTeam: { bughunters: { workers: [{ model: "", effort: "low" }, { model: "m-1" }] } } } } })).status, 200);
    try {
      const on = await (await shim.api(`/api/sessions/${sid}/beside/runs-on?team=bughunters&model=claude-opus-5-5`)).json();
      assert.deepEqual([on.lead, on.workers, on.from], ["claude-opus-5-5", ["m-1"], "here"], "its rows once each");
      const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt on this chat's model", model: "claude-opus-5-5" } });
      const out = await r.json();
      assert.equal(r.status, 200, JSON.stringify(out));
      const s = (await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json()).effective?.subagents;
      assert.deepEqual([s?.pool, s?.byCard, s?.byTeam], [[{ model: "m-1" }, { model: "m-2" }], { hunter: [{ model: "m-1" }] }, { bughunters: { workers: [{ model: "m-1", effort: "low" }] } }], "each model once, its first row's");
    } finally {
      await mine({ unset: ["subagents.pool", "subagents.byCard", "subagents.byTeam"] });
    }
  });

  // (fails before: yes — the review of 11-05: two rows of one model, "" and its name, went with the first row's effort,
  // none, where the chat's list takes the first that says one; and the preview named that model twice)
  test("two of this chat's rows on one model: its effort the first of them says, for its lead and in its team's chat; said once before Send", async () => {
    const mine = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body });
    const rows = (/** @type {string} */ effort) => [{ model: "" }, { model: "m-1", effort }];
    assert.equal((await mine({ patch: { subagents: { pool: rows("high"), byCard: { hunter: rows("low") }, byTeam: { bughunters: { lead: rows("medium") } } } } })).status, 200);
    try {
      const on = await (await shim.api(`/api/sessions/${sid}/beside/runs-on?team=bughunters`)).json();
      assert.deepEqual([on.lead, on.leadEffort, on.workers, on.from], ["m-1", "medium", ["m-1"], "chat"], JSON.stringify(on));
      const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt on two rows of one model" } });
      const out = await r.json();
      assert.equal(r.status, 200, JSON.stringify(out));
      // (m-1 has no effort setting, so its lead's chat holds none: its lead's is said above.)
      const s = (await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json()).effective;
      assert.deepEqual([s?.subagents?.pool, s?.subagents?.byCard], [[{ model: "m-1", effort: "high" }], { hunter: [{ model: "m-1", effort: "low" }] }]);
    } finally {
      await mine({ unset: ["subagents.pool", "subagents.byCard", "subagents.byTeam"] });
    }
  });

  // (fails before: yes — the owner's plan of 11-05: a chat could set no team's models of its own)
  test("this chat's rows for a team: its lead's before the team's, its workers' too — said before Send, and its chat runs its crew on them", async () => {
    const mine = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body });
    const runsOn = async () => (await shim.api(`/api/sessions/${sid}/beside/runs-on?team=bughunters`)).json();
    const bad = await mine({ patch: { subagents: { byTeam: { bughunters: { crew: [] } } } } });
    assert.equal(bad.status, 400);
    assert.match((await bad.json()).error, /"subagents\.byTeam" \["bughunters"\] holds "crew": a team's rows are \{ lead\?, workers\? \}/);
    assert.equal((await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: ["m-1"], models: ["m-2"] } })).status, 200);
    try {
      assert.equal((await mine({ patch: { subagents: { byTeam: { bughunters: { lead: [{ model: "zz-none-here" }, { model: "claude-opus-5-5", effort: "high" }], workers: [{ model: "m-3", effort: "low" }] } }, byCard: { hunter: [{ model: "m-2" }] } } } })).status, 200);
      const on = await runsOn();
      assert.deepEqual([on.lead, on.leadEffort, on.workers, on.from, on.fell.map((/** @type {any} */ f) => [f.name, f.as, f.next])], ["claude-opus-5-5", "high", ["m-3"], "here", [["zz-none-here", "lead", "claude-opus-5-5"]]], JSON.stringify(on));
      const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt on this chat's rows" } });
      const out = await r.json();
      assert.equal(r.status, 200, JSON.stringify(out));
      const s = await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json();
      assert.deepEqual([s.effective?.model?.effort, s.effective?.subagents?.byTeam, s.effective?.subagents?.byCard], ["high", { bughunters: { workers: [{ model: "m-3", effort: "low" }] } }, { hunter: [{ model: "m-2" }] }], "its crew's rows go with it; its lead's are spent");
    } finally {
      await mine({ unset: ["subagents.byTeam", "subagents.byCard"] });
      await shim.api("/api/teams/bughunters", { method: "PUT", body: { leadModels: null, models: null } });
    }
    assert.deepEqual([(await runsOn()).lead, (await runsOn()).from], ["m-1", "seats"]);
  });

  // (fails before: yes — the review of 11-05: the main agent's effort rode its lead's name alone, so an effort your
  // defaults hold beat it; one its model's name spells is kept, model-choice.test.js)
  test("an effort its lead inherits holds over your defaults' as its chat's own", async () => {
    const fire = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ...body } });
    const leadSaid = async (/** @type {string} */ ask) => /** @type {any} */ (await until(async () => bodies.find((b) => b.text.includes(ask)) || null, "its lead's request"));
    const mine = (/** @type {any} */ body) => shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body });
    const defaults = (/** @type {any} */ body) => shim.api("/api/defaults/settings", { method: "PATCH", body });
    assert.equal((await mine({ patch: { model: { effort: "low" } } })).status, 200);
    try {
      assert.equal((await defaults({ patch: { model: { effort: "high" } } })).status, 200);
      const r = await fire({ ask: "hunt at the main agent's", model: "claude-opus-5-5" });
      const out = await r.json();
      assert.equal(r.status, 200, JSON.stringify(out));
      assert.equal((await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json()).effective?.model?.effort, "low");
      const m = await leadSaid("hunt at the main agent's");
      assert.deepEqual([m.model, m.effort], ["claude-opus-5-5", "low"], "the main agent's, over your defaults'");
    } finally {
      await defaults({ unset: ["model.effort"] });
      await mine({ unset: ["model.effort"] });
    }
  });

  // (fails before: yes — team_v2_plan §10 O1: nothing said before Send what a team's lead would read, and a fire's at
  // most was its team's alone)
  test("what its lead reads, said before Send: the chat's turns and size against its window, the record whole on asking; a fire's old at most says nothing", async () => {
    const reads = await (await shim.api(`/api/sessions/${sid}/beside/reads?team=bughunters`)).json();
    assert.equal(reads.lead, "m-1", JSON.stringify(reads));
    assert.ok(reads.turns >= 1 && reads.tokens > 0 && reads.window > reads.tokens, JSON.stringify(reads));
    assert.deepEqual([reads.running, reads.waiting, reads.cut, "text" in reads], [null, false, false, false], "the record itself only on asking");
    const whole = await (await shim.api(`/api/sessions/${sid}/beside/reads?team=bughunters&whole=1`)).json();
    assert.match(whole.text, /<main-chat[\s\S]*build the parser/);
    assert.equal((await shim.api(`/api/sessions/${sid}/beside/reads?team=nobody`)).status, 404);
    // (fails before: yes — the owner's word of 11-05: a fire's at most was its chat's own number) An older page's most
    // is read as nothing: its chat holds no number.
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt with six at once", most: 6 } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    const settings = await (await shim.api(`/api/sessions/${out.team.id}/settings`)).json();
    assert.equal(settings.effective?.engine?.teamMost, undefined, "no number in its chat");
    await until(async () => ((await rowOf(out.team.id))?.state === "done" ? true : null), "the six-at-once hunt's end");
    // Its board's lead (§10 O2): with no turn running, its newest reply; another chat's team is not this chat's.
    const lead = await (await shim.api(`/api/sessions/${sid}/beside/${out.team.id}/lead`)).json();
    assert.deepEqual([lead.id, lead.running, lead.rounds, lead.calls, lead.startedAt], [out.team.id, false, 0, [], null], JSON.stringify(lead));
    assert.ok(lead.words.length > 0 && typeof lead.usd === "number", JSON.stringify(lead));
    assert.equal((await shim.api(`/api/sessions/nope/beside/${out.team.id}/lead`)).status, 404);
    assert.equal((await shim.api(`/api/sessions/${sid}/beside/nope/lead`)).status, 404);
  });

  // (team_v2_plan §10 O3; fails before: yes — no findings, no result route, and its result went only by Notify)
  test("a result's findings as its lead listed them; the result whole, for Open beside; sent from the box, its card says so", async () => {
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "a ranked hunt" } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    const id = out.team.id;
    const row = await until(async () => {
      const x = await rowOf(id);
      return x?.state === "done" ? x : null;
    }, "the ranked hunt's end");
    assert.deepEqual(row.findings.counts, { found: 2, confirmed: 0, plausible: 1, uncovered: 1, dismissed: 0 });
    assert.deepEqual([row.findings.total, row.findings.top.map((/** @type {any} */ f) => [f.kind, f.title, f.where])], [4, [["found", "A null read", "parse.js:3"], ["found", "A double send", "send.js:8"], ["plausible", "Off by one", "lex.js:9"]]]);
    const res = await (await shim.api(`/api/sessions/${sid}/beside/${id}/result`)).json();
    assert.deepEqual([res.id, res.n, res.team.name, res.firedBy], [id, row.result.n, "BugHunters", "you"]);
    assert.match(res.text, /^Two found\.\n\nFindings:\n- Found \| A null read/);
    assert.equal(res.findings.items.length, 4);
    assert.ok(res.message.startsWith(`${RESULT_HEAD}: the BugHunters team, which the person sent beside this chat, was asked: "a ranked hunt". The person sent its result to you.`), res.message);
    assert.equal((await shim.api(`/api/sessions/nope/beside/${id}/result`)).status, 404);
    // Sent from the box: refused in words where it is not this result, or how is not said.
    const bad = await shim.api(`/api/sessions/${sid}/beside/${id}/sent`, { method: "POST", body: { n: res.n, how: "mailed" } });
    assert.equal(bad.status, 400);
    const stale = await shim.api(`/api/sessions/${sid}/beside/${id}/sent`, { method: "POST", body: { n: res.n + 1, how: "sent" } });
    assert.equal(stale.status, 409);
    assert.match((await stale.json()).error, /not the team's newest result/);
    const sent = await (await shim.api(`/api/sessions/${sid}/beside/${id}/sent`, { method: "POST", body: { n: res.n, how: "steered" } })).json();
    assert.equal(sent.team.notified.how, "steered");
    assert.equal((await rowOf(id)).notified.how, "steered", "its card says so");
  });

  // (fails before: yes — the owner's ask of 10-19, "what if i wanted a fresh bug hunter without any history": a lead
  // always read the whole main chat first)
  test("a fresh start: its lead reads the person's words alone, none of the main chat, and its card says so", async () => {
    const from = seen.length;
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "hunt the lexer, fresh", model: "m-1", reads: "words" } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    const row = await until(async () => {
      const x = await rowOf(out.team.id);
      return x?.state === "done" ? x : null;
    }, "the fresh hunt's end");
    assert.equal(row.fresh, true);
    const lead = seen.slice(from).find((s) => s.includes("hunt the lexer, fresh"));
    assert.ok(lead, "its lead was sent the words");
    assert.deepEqual([lead.includes("<main-chat"), lead.includes("build the parser")], [false, false], "nothing of the main chat");
    assert.equal((await rowOf((await besideList()).find((/** @type {any} */ t) => t.id !== out.team.id).id)).fresh, false, "one that read the chat is not");
    // (fails before: yes — the owner's words of 10-19: its own chat's Teams tab showed its workers another way than its
    // main chat's) Its own chat answers its own row, so its Teams tab shows it as its main chat's does.
    const own = await (await shim.api(`/api/sessions/${out.team.id}/beside`)).json();
    assert.deepEqual([own.main, own.self?.id, own.self?.state, own.self?.fresh, own.teams.length], [sid, out.team.id, "done", true, 0]);
    assert.equal((await (await shim.api(`/api/sessions/${sid}/beside`)).json()).self, null, "a main chat has none");
  });

  // (fails before: yes — Bug Hunter #13, 10-19: the chat kept no record of who it was handed to, so a hand-back to the
  // same team with no turn between drew no divider)
  test("each switch of who answers is marked on the chat, whichever writer made it; a write that switches nothing is not", async () => {
    const write = async (/** @type {any} */ body) => (await shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body })).status;
    const marks = async () => (await transcript(sid)).boundaries.filter((/** @type {any} */ b) => b.type === "engine").map((/** @type {any} */ b) => [b.from, b.to]);
    const had = (await marks()).length;
    assert.equal(await write({ patch: { engine: { mode: "team", team: "architect" } } }), 200);
    assert.equal(await write({ patch: { engine: { supervise: false } } }), 200, "the engine named, no switch");
    assert.equal(await write({ unset: ["engine.mode", "engine.team"] }), 200);
    assert.equal(await write({ patch: { "engine.mode": "team", "engine.team": "architect" } }), 200);
    assert.equal(await write({ unset: ["engine.mode", "engine.team", "engine.supervise"] }), 200);
    const now = (await marks()).slice(had);
    assert.deepEqual(now, [[null, "architect"], ["architect", null], [null, "architect"], ["architect", null]]);
    const t = await transcript(sid);
    assert.ok(t.boundaries.filter((/** @type {any} */ b) => b.type === "engine").every((/** @type {any} */ b) => Number.isInteger(b.afterTurn) && b.at > 0), "each with the turn it follows and when");
  });

  // (fails before: yes — HarnessV4_DesignPass_Plan, case 13: a team's result said nothing of what its lead drew, and no
  // agent of the main chat could open it)
  test("a team whose lead draws: its result names the picture sealed, and the main agent opens it by its name", async () => {
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "draw the team layout", model: "m-1" } });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    const id = out.team.id;
    await until(async () => ((await rowOf(id))?.state === "done" ? true : null), "the team's result");
    assert.deepEqual((await transcript(id)).turns.at(-1).visuals?.map((/** @type {any} */ v) => v.title), ["team_layout"], "kept on its lead's turn");
    const from = seen.length;
    const sent = await shim.api(`/api/sessions/${sid}/beside/${id}/notify`, { method: "POST", body: {} });
    assert.equal(sent.status, 200, await sent.clone().text());
    await until(async () => (JSON.stringify((await transcript(sid)).turns.at(-1)?.final ?? "").includes("Seen the layout") ? true : null), "the main agent's turn");
    const passed = String(seen.slice(from).find((s) => s.includes("a team beside this chat finished") && s.includes("team_layout")));
    assert.ok(passed.includes(`</team-result>\\n\\nThe team drew team_layout (${Buffer.byteLength(TEAM_SVG)} bytes), shown to the developer. It waits sealed for you: open it with Filament's envelope tool, {\\"picture\\": \\"team_layout\\"}, to read its code whole.`), passed.slice(-900));
    assert.ok(!passed.includes("TEAM_CODE"), "none of its code went with the result");
    const opened = String(seen.slice(from).find((s) => s.includes("[Filament: picture team_layout, opened")));
    assert.ok(opened.includes(`[Filament: picture team_layout, opened — drawn by the BugHunters team beside this chat for \\"draw the team layout\\", `), opened.slice(-900));
    assert.ok(opened.includes(`Its code, whole:]\\n${TEAM_SVG}`), opened.slice(-600));
  });

  test("a switch flipped on its card; a team beside goes with its main chat", async () => {
    const id = (await besideList())[0].id;
    const flipped = await (await shim.api(`/api/sessions/${sid}/beside/${id}`, { method: "PATCH", body: { notify: true } })).json();
    assert.equal(flipped.team.notify, true);
    const badFlip = await shim.api(`/api/sessions/${sid}/beside/${id}`, { method: "PATCH", body: { notify: "yes" } });
    assert.equal(badFlip.status, 400);
    const other = await shim.api(`/api/sessions/nope/beside/${id}/notify`, { method: "POST", body: {} });
    assert.equal(other.status, 404);
    const ids = (await besideList()).map((/** @type {any} */ t) => t.id);
    assert.ok(ids.length >= 3);
    const del = await (await shim.api(`/api/memory/sessions/${sid}/delete`, { method: "POST", body: {} })).json();
    assert.equal(del.beside, ids.length);
    for (const id of ids) assert.equal((await shim.api(`/api/sessions/${id}/transcript`)).status, 404, "gone with it");
  });
});

describe("the main agent's team tool (P5): its words", () => {
  /** A team beside as the runner answers it. @param {any} [o] @returns {any} */
  const row = (o = {}) => ({
    id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs in the parser", firedBy: "agent", at: 0, model: "m-1", title: "",
    state: "working", workers: { running: 2, waiting: 1, total: 3 }, verify: false, notify: false, of: null, verifiedBy: null, result: null, notified: null, cut: false, readOnly: true, ...o,
  });
  const TEAMS = [{ key: "bug-hunter", name: "Bug Hunter", line: "Finds bugs, never fixes them", mine: true }, { key: "verifier", name: "Verifier", line: "Checks claims", mine: true }];
  const METHODICAL = { key: "methodical", name: "Methodical", line: "A plan first", mine: false };
  /** @param {any} [o] */
  const at = (o = {}) => ({ chain: "c1", fire: async () => row(), list: () => [], teams: () => TEAMS, on: () => true, ...o });

  // (fails before: yes — a team fired from a turn Filament holds to reading — a plan's, a watcher's wake — ran in a
  // chat of its own in that chat's mode, and wrote what the turn that fired it could not)
  test("a team sent from a turn held to reading reads only, and the answer says so; from any other turn it runs as its team does", async () => {
    /** @type {any[]} */
    const asked = [];
    const fire = async (/** @type {any} */ i) => (asked.push(i), row());
    const held = await besideCall({ action: "send", team: "bug-hunter", ask: "find bugs" }, at({ fire }), undefined, { mode: () => "read-only" });
    assert.deepEqual(asked, [{ team: "bug-hunter", ask: "find bugs", readOnly: true }]);
    assert.deepEqual(held, { ok: true, text: "Bug Hunter started beside this chat, reading only, as this turn does. Its result waits for the person, who may send it to you. Go on with your work: do not wait for it." });
    for (const mode of [() => "auto", () => "ask", () => null, null]) await besideCall({ action: "send", team: "bug-hunter", ask: "find bugs" }, at({ fire }), undefined, { mode });
    assert.deepEqual(asked.slice(1), Array(4).fill({ team: "bug-hunter", ask: "find bugs" }));
  });

  // (fails before: yes — the main agent had no way to fire a team)
  test("send answers in one line where its result goes, as the switches stand; a refusal is said; the switch off refuses in words", async () => {
    /** @type {any[]} */
    const asked = [];
    const r = await besideCall({ action: "send", team: "bug-hunter", ask: "find bugs" }, at({ fire: async (/** @type {any} */ i) => (asked.push(i), row()) }));
    assert.deepEqual(asked, [{ team: "bug-hunter", ask: "find bugs" }], "only the team and the words: where the result goes is not the agent's");
    // (fails before: yes — the models it runs on were the fire card's alone; the owner's of 10-30) What it runs on goes
    // where the call names it, by the runner's names; a provider with no model to serve is refused, nothing fired.
    await besideCall({ action: "send", team: "bug-hunter", ask: "find bugs", model: " Opus 5.5 ", provider: "Claude Code", effort: "high", workers_model: "Haiku 5.5", workers_provider: "", workers_effort: "low" }, at({ fire: async (/** @type {any} */ i) => (asked.push(i), row()) }));
    assert.deepEqual(asked.at(-1), { team: "bug-hunter", ask: "find bugs", model: "Opus 5.5", provider: "Claude Code", effort: "high", workersModel: "Haiku 5.5", workersEffort: "low" });
    assert.deepEqual(await besideCall({ action: "send", team: "x", ask: "y", provider: "OpenRouter" }, at()), { ok: false, error: "Not sent: provider names who serves its lead's model: name the model too." });
    assert.deepEqual(await besideCall({ action: "send", team: "x", ask: "y", workers_provider: "OpenRouter" }, at()), { ok: false, error: "Not sent: workers_provider names who serves its workers' model: name workers_model too." });
    assert.equal(asked.length, 2, "nothing sent by a refusal");
    assert.deepEqual(r, { ok: true, text: "Bug Hunter started beside this chat. Its result waits for the person, who may send it to you. Go on with your work: do not wait for it." });
    // On `fire` on purpose (the act's name before version 123, in capitals): taken as send.
    const both = await besideCall({ action: "FIRE", team: "x", ask: "y" }, at({ fire: async () => row({ verify: true, notify: true }) }));
    assert.match(/** @type {any} */ (both).text, /When it ends, BugHunters checks its result, and the check comes to you as a message\./);
    const sent = await besideCall({ action: "send", team: "x", ask: "y" }, at({ fire: async () => row({ notify: true }) }));
    assert.match(/** @type {any} */ (sent).text, /Its result comes to you as a message when it ends\./);
    // On `fire` on purpose: its refusal says send, as a send's does.
    const refused = await besideCall({ action: "fire", team: "nobody", ask: "y" }, at({ fire: async () => { throw Object.assign(new Error('no team answers to "nobody"'), { status: 404 }); } }));
    assert.deepEqual(refused, { ok: false, error: 'Not sent: no team answers to "nobody".' });
    await assert.rejects(besideCall({ action: "send" }, at({ fire: async () => { throw new Error("disk on fire"); } })), /disk on fire/, "a fault is no refusal");
    assert.deepEqual(await besideCall({ action: "send" }, at({ on: () => false })), { ok: false, error: BESIDE_SWITCHED_OFF });
    assert.deepEqual(await besideCall({ action: "read" }, at()), { ok: false, error: "team takes an action: send, status or note; read is none of them." });
  });

  // (fails before: yes — d-send: the act was fire alone, so send was "none of them", and every word of the tool said fire)
  test("the act is send, and fire is still taken: either, in any case and padded, starts the team with the same answer; what is neither is refused in send's words", async () => {
    assert.equal(PROMPT_VERSION, 129);
    assert.deepEqual([...BESIDE_ACTIONS], ["send", "status", "note"]);
    assert.deepEqual(["send", " Send ", "SEND", "fire", " Fire\n", "FIRE", "status", " Note ", "fired", "", null, undefined, 7].map(besideAction), ["send", "send", "send", "send", "send", "send", "status", "note", "fired", "", "", "", "7"]);
    for (const action of ["send", " Send ", "SEND", "fire", " Fire ", "FIRE"]) {
      /** @type {any[]} */
      const asked = [];
      const r = await besideCall({ action, team: "bug-hunter", ask: "find bugs" }, at({ fire: async (/** @type {any} */ i) => (asked.push(i), row()) }));
      assert.deepEqual([asked, r], [[{ team: "bug-hunter", ask: "find bugs" }], { ok: true, text: "Bug Hunter started beside this chat. Its result waits for the person, who may send it to you. Go on with your work: do not wait for it." }], `action ${JSON.stringify(action)}`);
    }
    // Neither: refused, and the refusal names send alone.
    assert.deepEqual(await besideCall({ action: "fired", team: "x", ask: "y" }, at()), { ok: false, error: "team takes an action: send, status or note; fired is none of them." });
    assert.deepEqual(await besideCall({ action: "start", team: "x", ask: "y" }, at()), { ok: false, error: "team takes an action: send, status or note; start is none of them." });
    assert.deepEqual(await besideCall({ team: "x", ask: "y" }, at()), { ok: false, error: "team takes an action: send, status or note." });
  });

  // (fails before: yes — d-send: the tool's description, its fields, its refusals and the MCP server's line all said fire)
  test("every word an agent reads of the act says send: the tool whole, its refusals, a fork's, the MCP server's line — and the tool reads back as version 122 had it", () => {
    const FIRE = /\bfir(e|es|ed|ing)\b/i;
    const props = /** @type {any} */ (BESIDE_TOOL.input_schema.properties);
    assert.deepEqual(props.action, { type: "string", enum: ["send", "status", "note"], description: "send, status or note." });
    const d = String(BESIDE_TOOL.description);
    assert.ok(d.startsWith("Send a team to work beside this chat, in a chat of its own, for a large job you can say in a few lines and need not watch: a bug hunt over recent work, or a check of claims against the code (bughunters finds bugs and checks claims, and fixes none)."), d);
    assert.ok(d.includes(" send starts one (team, ask): say what to do, not what was done, since its lead reads this chat already. You send only the teams the person lets this chat's agent send (BugHunters, unless they chose others in the chat's settings); the rest are theirs: name one in your answer where it fits. status says which teams run beside this chat, on what, how far each is, which wait for the person, and which there are to send. note puts one line"), d);
    assert.deepEqual(Object.entries(props).filter(([, p]) => /^send\b/.test(/** @type {any} */ (p).description)).map(([k]) => k), ["action", "team", "ask", "range", "model", "provider", "effort", "workers_model", "workers_provider", "workers_effort"]);
    assert.doesNotMatch(JSON.stringify(BESIDE_TOOL), FIRE, "the tool whole");
    assert.equal(BESIDE_OFF, "Not run: teams beside a chat are sent by a harness chat's own agent, and this is none.");
    assert.equal(BESIDE_SWITCHED_OFF, "Not run: the person switched the team tool off for this chat. Do the work yourself, or say in your answer which team you would have sent and why.");
    assert.equal(/** @type {any} */ (FORK_REFUSALS).team, "Not run: the teams beside this chat are the main agent's to send. As its fork, carry on with the task.");
    const mcp = serverInstructions({ cwd: "/p", beside: true });
    assert.ok(mcp.includes(" Its `team` sends a team to work beside this chat, in a chat of its own, for a large job you can say in a few lines and need not watch, such as a bug hunt over recent work."), mcp);
    assert.doesNotMatch(mcp, FIRE, "the MCP server's instructions");
    // A coding agent's list gives the same tool.
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, beside: { fire: async () => row(), note: async () => row(), list: () => [], lead: () => null, teams: () => TEAMS, fires: () => true, on: () => true } });
    const listed = /** @type {any} */ (tools.list(/** @type {any} */ ({ cwd: "/p", upstream: "u", chain: "c1", turn: null, graph: false, beside: true })).find((t) => t.name === "team"));
    assert.deepEqual([listed.description, listed.inputSchema], [BESIDE_TOOL.description, BESIDE_TOOL.input_schema]);
    // Version 122's tool, whole, by its hash: every sentence version 123 moved has its pair (helpers/team.js `V123_WORDS`).
    assert.equal(createHash("sha256").update(JSON.stringify(asV122Tools(BESIDE_TOOL))).digest("hex"), "2f6b035cf3eb27543165b49cc252d20818310b0a559f0a10728620ab164cb068");
  });

  // (fails before: yes — the agent had no word into a team at work: a wrong split burned until it ended; the owner's of
  // 10-30, item 2 of the list)
  test("note: a line for a team's lead at work, by its team; a note of nothing, one too long, or one the runner refuses is said, nothing sent", async () => {
    /** @type {any[]} */
    const noted = [];
    const ok = await besideCall({ action: "note", team: "bug-hunter", note: "Skip the team runner: hunt the Space board." }, at({ note: async (/** @type {any} */ i) => (noted.push(i), row()) }));
    assert.deepEqual(noted, [{ team: "bug-hunter", note: "Skip the team runner: hunt the Space board." }]);
    assert.deepEqual(ok, { ok: true, text: "Your note went to the Bug Hunter's lead: it reads it at its next step. Go on with your work." });
    assert.deepEqual(await besideCall({ action: "note", team: "bug-hunter", note: "  " }, at()), { ok: false, error: "Not sent: a note says in a line what its lead is to know." });
    assert.deepEqual(await besideCall({ action: "note", team: "bug-hunter", note: "x".repeat(BESIDE_LIMITS.note + 1) }, at()), { ok: false, error: `Not sent: a note is ${BESIDE_LIMITS.note} characters at most; this is ${BESIDE_LIMITS.note + 1}.` });
    const done = await besideCall({ action: "note", team: "bug-hunter", note: "stop" }, at({ note: async () => { throw Object.assign(new Error("no Bug Hunter beside this chat is at work now: a note reaches a lead only while its turn runs"), { status: 409 }); } }));
    assert.deepEqual(done, { ok: false, error: "Not sent: no Bug Hunter beside this chat is at work now: a note reaches a lead only while its turn runs." });
    assert.equal(noted.length, 1);
  });

  // (fails before: yes — status said how many workers ran and waited, not how many were done or had failed, nor where
  // its lead was: "a black box"; the owner's of 10-30, item 3)
  test("status of a team at work: its workers done and failed beside those at work, and its lead's step now — its open call, else its newest words", () => {
    assert.equal(leadStep({ running: true, rounds: 3, words: "", calls: [{ name: "read", subject: "src/a.js", open: false }, { name: "agent", subject: "Hunt the parser", open: true }] }), "agent Hunt the parser");
    assert.equal(leadStep({ running: true, rounds: 3, words: "", calls: [{ name: "read", subject: "src/a.js", open: false }] }), "read src/a.js, done");
    assert.equal(leadStep({ running: true, rounds: 2, words: "Two pieces:\nthe parser, then the lexer.", calls: [] }), "“the parser, then the lexer.”");
    assert.equal(leadStep({ running: true, rounds: 4, words: "", calls: [] }), "round 4");
    assert.equal(leadStep({ running: false, rounds: 0, words: "Found: 3", calls: [] }), "", "a lead whose turn ended has no step");
  });

  // (fails before: yes — the bug hunts of 10-30 on b4ff047aa: a worker stopped by the person or at a budget, or cut by a
  // restart, was in no count or among the failed, so "2 done" read as a team going well)
  test("a team's workers, counted: at work, waiting for a slot, done, failed, and stopped before finishing — stopped, at a budget, cut off — apart", () => {
    const st = (/** @type {string} */ status, waiting = false) => ({ status, ...(waiting ? { waiting: { since: 1 } } : {}) });
    assert.deepEqual(crewOf([st("running"), st("running", true), st("done"), st("done"), st("failed"), st("stopped"), st("budget-stopped"), st("aborted")]), { running: 1, waiting: 1, total: 8, done: 2, failed: 1, stopped: 3 });
    assert.deepEqual(crewOf([]), { running: 0, waiting: 0, total: 0, done: 0, failed: 0, stopped: 0 });
  });

  // (fails before: yes — the bug hunts of 10-30 on b4ff047aa: a team whose lead asked the person took the note, then had
  // no turn to put it in, and was picked over an older one at work; and every note said the main agent fired the team)
  test("a note reaches the newest of the team whose lead's turn runs — never one whose lead asks the person — in words that say who sent it", () => {
    const working = { id: "t1", state: "working", firedBy: "agent" };
    const asking = { id: "t2", state: "asking", firedBy: "agent" };
    const theirs = { id: "t3", state: "working", firedBy: "you" };
    const done = { id: "t4", state: "done", firedBy: "agent" };
    // At work only as its workers finish: its lead's turn has ended (the review of 10-30).
    const crewOnly = { id: "t5", state: "working", firedBy: "agent" };
    const flowed = { id: "t6", state: "working", firedBy: "you", flow: { id: "f1", box: "b1" } };
    const runs = (/** @type {any} */ r) => r.id !== "t5";
    assert.deepEqual(noteFor([asking, crewOnly, working], "Bug Hunter", "Skip the runner.", runs), { ok: true, row: working, text: "A note from the main chat's agent, which sent this team: Skip the runner." });
    assert.deepEqual(noteFor([theirs], "Bug Hunter", "Skip the runner.", runs), { ok: true, row: theirs, text: "A note from the main chat's agent — the person sent this team: Skip the runner." });
    assert.deepEqual(noteFor([flowed], "Bug Hunter", "Skip the runner.", runs), { ok: true, row: flowed, text: "A note from the main chat's agent — a flow sent this team: Skip the runner." });
    assert.deepEqual(noteFor([asking, done], "Bug Hunter", "x", runs), { ok: false, error: "the Bug Hunter's lead asks the person something, and its turn has ended until they answer: a note reaches a lead only while its turn runs" });
    assert.deepEqual(noteFor([crewOnly, done], "Bug Hunter", "x", runs), { ok: false, error: "the Bug Hunter's lead has ended its turn, and its workers finish: a note reaches a lead only while its turn runs" });
    assert.deepEqual(noteFor([done], "Bug Hunter", "x", runs), { ok: false, error: "no Bug Hunter beside this chat is at work now: a note reaches a lead only while its turn runs" });
    assert.deepEqual(noteFor([], "Bug Hunter", "x", runs), { ok: false, error: "no Bug Hunter runs beside this chat" });
    // The runner's wiring: its rows' counts are crewOf's, and a note's lead is noteFor's, by whether its turn runs.
    const runner = readFileSync(new URL("../src/app/teams-beside.js", import.meta.url), "utf8");
    assert.match(runner, /const crew = crewOf\(\/\*\* @type \{any\[\]\} \*\/ \(registry\(\)\?\.list\(chain\.id\) \|\| \[\]\)\);/);
    assert.match(runner, /\n {6}workers: crew,\n/);
    assert.match(runner, /const to = noteFor\(mine, team\.name, words, \(r\) => !!sessions\.besideFacts\(r\.id\)\.busy\);\s+if \(!to\.ok\) throw refused\(409, to\.error\);\s+const r = reach\.steer\(to\.row\.id, to\.text\);/);
  });

  test("status: each team beside, who sent it, how far it is and where its result went — never the result — and the teams there are", async () => {
    const now = 3_600_000;
    const rows = [
      row({ at: now - 12 * 60_000, on: { lead: "m-2", workers: ["m-3", "m-3"], from: "picked", fell: [] }, workers: { running: 2, waiting: 1, total: 8, done: 2, failed: 1, stopped: 2 } }),
      row({ id: "t2", team: { key: "verifier", name: "Verifier" }, firedBy: "you", at: now - 2 * 3_600_000, state: "done", result: { n: 1, text: "Confirmed: 1", more: false, at: 1 }, notified: { n: 1, at: 1, how: "sent" } }),
      row({ id: "t3", at: now, state: "done", result: { n: 1, text: "SECRET RESULT", more: false, at: 1 } }),
      row({ id: "t4", at: now, state: "asking" }),
      row({ id: "t5", at: now, state: "stopped", cut: true }),
      // (fails before: yes — the 9 plausible of 10-19: a result Then notify could not send read "on its way to you")
      row({ id: "t6", at: now, state: "done", notify: true, result: { n: 1, text: "Found: 1", more: false, at: 1 }, missed: "Filament stopped before it could go" }),
      row({ id: "t7", at: now, state: "done", notify: true, result: { n: 1, text: "Found: 1", more: false, at: 1 } }),
    ];
    /** @type {string[]} */
    const leads = [];
    const lead = (/** @type {string} */ id) => (leads.push(id), { running: true, rounds: 5, words: "", calls: [{ name: "agent", subject: "Hunt the lexer", open: true }] });
    const r = /** @type {any} */ (await besideCall({ action: "status" }, at({ list: () => rows, teams: () => [...TEAMS, METHODICAL], lead }), now));
    assert.equal(r.ok, true);
    assert.deepEqual(leads, ["t1"], "the lead's step read for the team at work alone");
    assert.deepEqual(r.text.split("\n"), [
      "Teams beside this chat, the newest first:",
      // (fails before: yes — status said nothing of what a team runs on, so a pick could not be seen to take)
      // (fails before: yes — the bug hunts of 10-30: workers stopped before finishing were in no count)
      '- Bug Hunter, sent by you 12 min ago — runs on m-2, its workers on m-3 — at work (2 at work, 1 waits for a slot, 2 done, 1 failed, 2 stopped before finishing); its lead now: agent Hunt the lexer. Its result waits for the person, who may send it to you. Asked: "find bugs in the parser"',
      `- Verifier, sent by the person 2 h ago — runs on m-1, its workers on their cards' models, else its lead's model — done: its result went to you. Asked: "find bugs in the parser"`,
      `- Bug Hunter, sent by you just now — runs on m-1, its workers on their cards' models, else its lead's model — done: its result waits for the person. Asked: "find bugs in the parser"`,
      // (fails before: yes — the bug hunts of 10-30: a lead that asks while its workers work said nothing of them)
      `- Bug Hunter, sent by you just now — runs on m-1, its workers on their cards' models, else its lead's model — its lead asks the person something, and waits for the answer (2 at work, 1 waits for a slot). Asked: "find bugs in the parser"`,
      `- Bug Hunter, sent by you just now — runs on m-1, its workers on their cards' models, else its lead's model — Filament stopped while it worked; the person may resume it. Asked: "find bugs in the parser"`,
      `- Bug Hunter, sent by you just now — runs on m-1, its workers on their cards' models, else its lead's model — done: its result did not reach you (Filament stopped before it could go); the person may send it to you. Asked: "find bugs in the parser"`,
      `- Bug Hunter, sent by you just now — runs on m-1, its workers on their cards' models, else its lead's model — done: its result is on its way to you. Asked: "find bugs in the parser"`,
      "",
      "Teams you can send:",
      "- `bug-hunter` Bug Hunter — Finds bugs, never fixes them",
      "- `verifier` Verifier — Checks claims",
      // (fails before: yes — U13-D9 of 10-20: every team was the agent's to fire)
      "",
      "Teams only the person sends — name one in your answer where it fits:",
      "- `methodical` Methodical — A plan first",
    ]);
    assert.ok(!r.text.includes("SECRET RESULT"), "status reads no result");
    // (fails before: yes — 031b96a65's left: a run kept from before a list was a chat's own alone runs on its project's,
    // which the page says "this project's list" of, and status said this chat's)
    const lists = [row({ on: { lead: "m-2", workers: ["m-4"], from: "chat", fell: [] } }), row({ id: "t2", on: { lead: "m-2", workers: ["m-5"], from: "project", fell: [] } })];
    const listed = /** @type {any} */ (await besideCall({ action: "status" }, at({ list: () => lists, teams: () => TEAMS }), now)).text;
    assert.ok(listed.includes(" — runs on m-2, its workers on their cards' models, else this chat's list: m-4 — "), listed);
    assert.ok(listed.includes(" — runs on m-2, its workers on their cards' models, else this project's list: m-5 — "), listed);
    assert.equal((/** @type {any} */ (await besideCall({ action: "status" }, at()))).text.split("\n")[0], "No team runs beside this chat.");
    assert.equal((/** @type {any} */ (await besideCall({ action: "status" }, at({ teams: () => TEAMS })))).text.includes("only the person"), false, "none of theirs: no such list");
    const none = /** @type {any} */ (await besideCall({ action: "status" }, at({ teams: () => [METHODICAL] })));
    assert.deepEqual(none.text.split("\n").slice(2, 4), ["Teams you can send: none — the person decides which.", ""]);
  });

  test("a coding agent: the tool where its session was given it and the switch is on; the call sends as its chat's, a fire as a send; a call from elsewhere is refused", async () => {
    /** @type {any[]} */
    const fired = [];
    const deps = {
      fire: async (/** @type {string} */ chain, /** @type {any} */ input) => (fired.push([chain, input]), row({ main: chain })),
      note: async (/** @type {string} */ chain) => row({ main: chain }),
      list: () => [],
      lead: () => null,
      teams: () => TEAMS,
      fires: (/** @type {string} */ chain) => chain !== "team-chat",
      on: (/** @type {string} */ chain) => chain !== "switched-off",
    };
    const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null, beside: deps });
    const ctx = (/** @type {any} */ o) => ({ cwd: "/p", upstream: "u", chain: "c1", turn: null, graph: false, ...o });
    const names = (/** @type {any} */ o) => tools.list(ctx(o)).map((t) => t.name);
    assert.ok(names({ beside: true }).includes("team"));
    assert.ok(!names({}).includes("team"), "a session not given it: a lead's, a worker's, a helper's");
    assert.ok(!names({ beside: true, chain: "team-chat" }).includes("team"), "a team's own chat fires none");
    assert.ok(!names({ beside: true, chain: "switched-off" }).includes("team"));
    assert.equal(tools.has("team"), true);
    const r = await tools.call("team", { action: "send", team: "bug-hunter", ask: "hunt" }, ctx({ beside: true }));
    assert.match(r.text, /^Bug Hunter started beside this chat\./);
    assert.deepEqual(fired, [["c1", { team: "bug-hunter", ask: "hunt" }]]);
    // (fails before: yes — d-send: send was no action of the tool) On `fire` on purpose, through Filament's MCP door: a
    // session opened before version 123 holds the tool with that action, and its call starts the team as a send does —
    // padded and in any case too, as a send is.
    for (const [action, ask] of [["fire", "hunt as before"], [" Fire ", "hunt, padded"], [" SEND ", "hunt, loud"]]) {
      const old = await tools.call("team", { action, team: "bug-hunter", ask }, ctx({ beside: true }));
      assert.equal(old.text, r.text, action);
      assert.deepEqual([old.isError, fired.at(-1)], [undefined, ["c1", { team: "bug-hunter", ask }]], action);
    }
    assert.deepEqual(await tools.call("team", { action: "fired", team: "bug-hunter", ask: "hunt" }, ctx({ beside: true })), { text: "team takes an action: send, status or note; fired is none of them.", isError: true });
    assert.equal(fired.length, 4, "nothing sent by a refusal");
    assert.deepEqual(await tools.call("team", { action: "status" }, ctx({})), { text: BESIDE_OFF, isError: true });
    assert.deepEqual(await tools.call("team", { action: "send" }, ctx({ beside: true, chain: "switched-off" })), { text: BESIDE_SWITCHED_OFF, isError: true });
    assert.equal(besideAtOf(deps, null), null);
    // The teams as the chat a call stands in sees them (U13-D9).
    /** @type {string[]} */
    const seen = [];
    const at2 = besideAtOf({ ...deps, teams: (/** @type {string} */ chain) => (seen.push(chain), TEAMS) }, "c9");
    assert.deepEqual([at2?.teams().length, seen], [2, ["c9"]]);
    assert.deepEqual(BESIDE_TOOL.input_schema.required, ["action"]);
    // Its call in the transcript, as every vocabulary's card names it.
    assert.deepEqual(cardOf("team", { action: "send", team: "bug-hunter", ask: "find bugs" }), { kind: "team-beside", title: "Send a team", subject: "bug-hunter: find bugs" });
    // (fails before: yes — d-send: the card read "Fire a team") On `fire` on purpose: an archived turn keeps its call's
    // `action: "fire"`, and its card and its summary read it as the send it was.
    assert.deepEqual(cardOf("team", { action: "fire", team: "bug-hunter", ask: "find bugs" }), { kind: "team-beside", title: "Send a team", subject: "bug-hunter: find bugs" });
    assert.deepEqual([{ action: "fire" }, { action: " FIRE " }, { action: "send" }, { action: " Send " }].map((a) => argSummary("team", { ...a, team: "bughunters", ask: "Find bugs in the parser." })), Array(4).fill("send bughunters: Find bugs in the parser."));
    assert.deepEqual([argSummary("team", { action: "fire", ask: "x" }), argSummary("team", { action: "status" }), argSummary("team", { action: " Note ", team: "bughunters", note: "x" }), argSummary("team", {})], ["send ?: x", "status", "note", "?"]);
    assert.deepEqual(cardOf("team", { action: "status" }), { kind: "team-beside", title: "Teams beside this chat", subject: "" });
    // (fails before: yes — the bug hunts of 10-30: a note was drawn as a status, its words gone)
    assert.deepEqual(cardOf("team", { action: "note", team: "bug-hunter", note: "Skip the runner." }), { kind: "team-beside", title: "Note to a team's lead", subject: "bug-hunter: Skip the runner." });
    // (fails before: yes — the review of 10-30: the tool takes its action in any case, the card did not)
    assert.deepEqual([" FIRE ", " Send "].map((action) => cardOf("team", { action, team: "bug-hunter", ask: "find bugs" }).title), ["Send a team", "Send a team"]);
    assert.deepEqual(cardOf("team", { action: "Note", team: "bug-hunter", note: "x" }).title, "Note to a team's lead");
  });
});

describe("the main agent sends a team (P5), through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** The tools each main request offered, and each lead's, newest last. @type {string[][]} */
  const mainTools = [];
  /** @type {string[][]} */
  const leadTools = [];
  /** What each of the tool's calls answered, newest last. @type {string[]} */
  const answers = [];
  /** Every main request's messages, newest last. @type {string[]} */
  const mainSeen = [];
  /** The words of the newest message's text blocks. @param {any} body */
  const lastText = (body) => {
    const c = body?.messages?.at(-1)?.content;
    return typeof c === "string" ? c : (Array.isArray(c) ? c : []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  };
  /** The tool's call the main agent makes for each message. @type {Record<string, any>} */
  const CALLS = {
    "hunt in the background": { action: "send", team: "bughunters", ask: "find bugs in the parser" },
    // On `fire` on purpose, here and at "hunt slowly" (d-send): the act's name before version 123, which a chat that was
    // open then still calls. It starts the team as send does, and is refused in send's words.
    "and the night team": { action: "fire", team: "night", ask: "look at the tests" },
    // The same send, by words that do not name the team: a name in the message lets the agent send it (OA2).
    "and the other one": { action: "send", team: "night", ask: "look at the tests" },
    // On `fire` on purpose, padded and capitalized: a team the chat does not let its agent send is refused in send's words.
    "and that one, as before": { action: " Fire ", team: "night", ask: "look at the tests" },
    "how do the teams stand": { action: "status" },
    // The models a team runs on, as the person asked the agent for them (the owner's of 10-30).
    "hunt on the small models": { action: "send", team: "bughunters", ask: "find bugs in the lexer", model: "m-2", effort: "high", workers_model: "m-3", workers_effort: "low" },
    "hunt on a model there is none of": { action: "send", team: "bughunters", ask: "find bugs in the lexer", workers_model: "zz-none", workers_provider: "nowhere" },
    // A team at work, and a note for its lead (the owner's of 10-30).
    "hunt slowly": { action: "fire", team: "bughunters", ask: "hunt slowly through the lexer" },
    "note the hunt": { action: "note", team: "bughunters", note: "Skip the team runner: hunt the Space board." },
  };
  /** Each request of the slow hunt's lead, newest last; its first waits for `slowGo`. @type {string[]} */
  const slowSeen = [];
  /** @type {() => void} */
  let slowGo = () => {};
  const slowHeld = new Promise((r) => void (slowGo = () => r(undefined)));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-fires-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const names = call.body.tools.map((/** @type {any} */ t) => t.name);
      const all = JSON.stringify(call.body.messages || []);
      if (all.includes("<main-chat")) {
        leadTools.push(names);
        // The slow hunt's lead: its first round waits, then reads a file, so its turn has a next step to read a note at.
        if (all.includes("hunt slowly through the lexer")) {
          slowSeen.push(all);
          if (slowSeen.length > 1) return anthropicReply("Found: nothing in the lexer.", { model: "m-1" });
          await slowHeld;
          return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: "tu_slow1", name: "read", input: { path: "lexer.js" } }] });
        }
        return anthropicReply("Found: parse.js:3 reads a field of null.", { model: "m-1" });
      }
      mainTools.push(names);
      mainSeen.push(all);
      const last = call.body.messages.at(-1)?.content;
      const results = (Array.isArray(last) ? last : []).filter((/** @type {any} */ b) => b?.type === "tool_result");
      if (results.length) {
        for (const r of results) answers.push(typeof r.content === "string" ? r.content : (r.content || []).map((/** @type {any} */ b) => b.text || "").join(""));
        return anthropicReply("Sent; going on.", { model: "m-1" });
      }
      const words = lastText(call.body);
      // A team's result first: it quotes the team's ask, which may hold a phrase that fires one.
      if (words.includes("a team beside this chat finished")) return anthropicReply("Noted: I will fix parse.js:3.", { model: "m-1" });
      const asked = Object.keys(CALLS).find((k) => words.includes(k));
      if (asked) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `tu_${mainTools.length}`, name: "team", input: CALLS[asked] }] });
      return anthropicReply("The parser is built.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1", "m-2", "m-3"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    // A team of yours whose own setting says a main agent's fire of it notifies when done.
    const night = await shim.api("/api/teams", { method: "POST", body: { name: "Night", lead: "product", members: [{ tag: "builder" }], fired: { notify: true, verify: false } } });
    assert.equal(night.status, 200, await night.clone().text());
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  const besideList = async () => (await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || [];
  /**
   * A message of the person's. A result a team's switch sent on runs as a turn of Filament's own in the main chat: the
   * message waits for that turn to end, as the person's would. `asIs`: the card's Send it as it is, the answer where
   * what the chat sends ahead changed (the owner's of 11-06).
   * @param {string} content @param {boolean} [asIs]
   */
  const say = async (content, asIs = false) => {
    const r = await until(async () => {
      const x = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content, stream: false, ...(asIs ? { sendAsIs: true } : {}) } });
      return x.status === 409 && (await x.clone().json().catch(() => ({}))).holder ? null : x;
    }, "the main chat free", { timeoutMs: 20_000 });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** @param {any} patch */
  const setChat = async (patch) => assert.equal((await shim.api(`/api/sessions/${sid}/settings`, { method: "PATCH", body: { patch } })).status, 200);
  /** The newest team beside, once it is there. @param {string} key @param {number} n  how many of that team there are then */
  const newest = (key, n) => until(async () => {
    const list = (await besideList()).filter((/** @type {any} */ t) => t.team.key === key);
    return list.length >= n ? list[0] : null;
  }, `team ${key} #${n}`);

  test("the main chat has the tool from its first message, last; its lead has none; a send is a line, and the result waits for the person", async () => {
    await say("hunt in the background");
    // (and the flow tool after it, HarnessV4_OneAgent_Plan OA3, and the thread tool after that, th3; report after them while the graph is on, for a task
    // started as the agent's fork, the owner's words of 10-26; the web's and the browser after the loop's own, on in a
    // new chat, HarnessV4_AgentTools_Plan AT-D1)
    assert.deepEqual(mainTools[0].slice(-10), ["team", "flow", "thread", "report", "web_fetch", "web_search", "browser", "come_back", "skill", "filament_recall"], "last of the loop's own, so the tools before it keep their bytes — come_back after them (prompt version 55), the skill tool after them all (54), the recall tool memory adds last");
    assert.equal(answers.at(-1), "BugHunters started beside this chat. Its result waits for the person, who may send it to you. Go on with your work: do not wait for it.");
    const hunt = await newest("bughunters", 1);
    assert.deepEqual([hunt.firedBy, hunt.verify, hunt.notify, hunt.readOnly], ["agent", false, false, true], "the teams that ship say off, and so does a chat that says nothing");
    const done = await until(async () => {
      const x = (await besideList()).find((/** @type {any} */ t) => t.id === hunt.id);
      return x?.state === "done" ? x : null;
    }, "the hunt's result");
    assert.equal(done.notified, null, "nothing reaches the main agent until the person presses");
    assert.ok(leadTools.length && leadTools.every((n) => !n.includes("team")), "a team beside sends no teams");
    // (fails before: yes — d-send) The tool as the model is offered it: its act is send.
    const offered = up.received.flatMap((/** @type {any} */ c) => c.body?.tools || []).filter((/** @type {any} */ t) => t.name === "team").at(-1);
    assert.deepEqual([offered.description, offered.input_schema], [BESIDE_TOOL.description, BESIDE_TOOL.input_schema]);
    assert.doesNotMatch(JSON.stringify(offered), /\bfir(e|es|ed|ing)\b/i);
  });

  // (fails before: yes — U13-D9 of 10-20: the main agent fired any team, one that changes files too)
  test("a team its chat does not let it start, and the message does not name, is refused in words, nothing started; ticked, it starts", async () => {
    const REFUSED = "Error: Not sent: the Night team is not one this chat lets you send by yourself — the person decides which (you may send: BugHunters). Say in your answer which team you would send, and why.";
    await say("and the other one");
    assert.equal(answers.at(-1), REFUSED);
    // (fails before: yes — d-send: a fire's refusal said fire four times) The same call as `fire`: the same words.
    await say("and that one, as before");
    assert.equal(answers.at(-1), REFUSED);
    assert.equal((await besideList()).filter((/** @type {any} */ t) => t.team.key === "night").length, 0, "nothing started");
    await setChat({ subagents: { teams: [...AGENT_TEAMS, "Night"] } });
  });

  test("the switches set ahead: the team's own, then the chat's over it — and with Notify on, the result reaches the main agent by itself", async () => {
    await say("and the night team");
    assert.equal((await newest("night", 1)).notify, true, "the team's own: notify when done");
    assert.match(answers.at(-1) || "", /^Night started beside this chat\. Its result comes to you as a message when it ends\./);
    await setChat({ engine: { agentTeams: { notifyWhenDone: false } } });
    await say("and the night team");
    assert.equal((await newest("night", 2)).notify, false, "the chat's setting is over the team's");
    await setChat({ engine: { agentTeams: { notifyWhenDone: true } } });
    await say("hunt in the background");
    const hunt = await newest("bughunters", 2);
    assert.equal(hunt.notify, true);
    await until(async () => mainSeen.some((s) => s.includes("a team beside this chat finished") && s.includes("the BugHunters team, which you sent beside this chat, was asked:") && s.includes(" The person set it to reach you when done.")), "the result reached the main agent by itself, said from its side", { timeoutMs: 20_000 });
  });

  // (fails before: yes — the tool took a team and its words alone: its lead ran on the chat's model, its workers on the
  // team's own, whatever the person asked the agent for; the owner's of 10-30)
  test("a send names the models its lead and its workers run on, and how hard each thinks, as the fire card does; one that cannot run is refused in words, nothing started", async () => {
    const before = (await besideList()).filter((/** @type {any} */ t) => t.team.key === "bughunters").length;
    await say("hunt on the small models");
    assert.match(answers.at(-1) || "", /^BugHunters started beside this chat\. /);
    const hunt = await newest("bughunters", before + 1);
    assert.deepEqual([hunt.on.lead, hunt.on.workers, hunt.on.from], ["m-2", ["m-3"], "picked"]);
    const settings = (await (await shim.api(`/api/sessions/${hunt.id}/settings`)).json())?.effective?.engine || {};
    assert.deepEqual([settings.teamWorkers, settings.teamEffort], ["m-3", "low"], "its workers' model and effort, in its chat");
    await say("hunt on a model there is none of");
    assert.match(answers.at(-1) || "", /^Error: Not sent: zz-none cannot run now \(.+\): pick another model for its workers\.$/);
    assert.equal((await besideList()).filter((/** @type {any} */ t) => t.team.key === "bughunters").length, before + 1, "nothing started");
    await say("how do the teams stand");
    assert.match(answers.at(-1) || "", /^Teams beside this chat, the newest first:\n- BugHunters, sent by you [^\n]* — runs on m-2, its workers on m-3 — /, "status says what each runs on");
  });

  // (fails before: yes — the tool had no note: a wrong split burned until its team ended; the owner's of 10-30)
  test("a note reaches the lead of a team at work at its next step, and status says where it is; a team whose turn ended takes none, and no turn starts", async () => {
    const before = (await besideList()).filter((/** @type {any} */ t) => t.team.key === "bughunters").length;
    await say("hunt slowly");
    const slow = await newest("bughunters", before + 1);
    await until(async () => slowSeen.length === 1 && (await besideList()).find((/** @type {any} */ t) => t.id === slow.id)?.state === "working", "its lead at work");
    await say("note the hunt");
    assert.equal(answers.at(-1), "Your note went to the BugHunters' lead: it reads it at its next step. Go on with your work.");
    await say("how do the teams stand");
    assert.match(answers.at(-1) || "", /^Teams beside this chat, the newest first:\n- BugHunters, sent by you [^\n]* — at work[^\n]*; its lead now: [^\n]+\. Its result/, "the lead's step, read while it works");
    slowGo();
    await until(() => slowSeen.length >= 2, "its lead's next step");
    assert.ok(slowSeen[1].includes("Skip the team runner: hunt the Space board."), "the note, in its next request");
    assert.ok(!slowSeen[0].includes("Skip the team runner"));
    await until(async () => (await besideList()).find((/** @type {any} */ t) => t.id === slow.id)?.state === "done", "the slow hunt done");
    const leadRequests = slowSeen.length;
    await say("note the hunt");
    assert.match(answers.at(-1) || "", /^Error: Not sent: no BugHunters beside this chat is at work now/);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(slowSeen.length, leadRequests, "no turn of its lead started");
  });

  test("status reads how they stand; the switch off takes the tool out of the next request", async () => {
    await say("how do the teams stand");
    assert.match(answers.at(-1) || "", /^Teams beside this chat, the newest first:\n- BugHunters, sent by you /);
    assert.match(answers.at(-1) || "", /Teams you can send:\n[\s\S]*- `bughunters` BugHunters — [\s\S]*- `night` Night — [\s\S]*\n\nTeams only the person sends/);
    assert.match(answers.at(-1) || "", /Teams only the person sends — name one in your answer where it fits:\n[\s\S]*- `builders` Builders — /);
    await setChat({ loop: { tools: { team: false } } });
    const before = mainTools.length;
    await say("just build", true);
    assert.ok(mainTools.length > before && !mainTools.at(-1)?.includes("team"), "switched off: not offered");
  });
});

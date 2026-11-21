// @ts-check
// Flows through a throwaway Filament (HarnessV4_Flow_Plan F4; HarnessV4_OneAgent_Plan OA3): `/flow` asks the main agent
// for a flow, and it draws one with its flow tool on a fake model — refused once in words for an agent nobody has, then
// drawn — Start tells it the flow, the boxes run as the person's own sub-agents, a team fires beside the chat as a box,
// the gate's verdict, and one message to the main agent at the end. A draft outside a /flow is refused; the chip's
// routes are gone; a restart's Stopped by a restart is the runner's own test (flow-runner.test.js). And OA4's In place:
// one turn of the main agent drives a flow to its end, a gate's send-back its act; Stop on that turn stops the flow; a
// turn whose model refuses it before it did any work leaves the flow holding, the refusal its why. And OA5's: a team box
// that writes works in a git worktree of the flow's own, the gate after it reads its file there, the main chat's folder
// untouched and nothing merged; outside git it writes in the folder, and says so. And OA6's Run as a flow: offered once
// under a reply to steps in order — a second offer and a draft refused — none on a /flow, none on a stopped turn; a
// coding agent offers it over Filament's MCP server.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { OWN_CARDS } from "./helpers/flow-cards.js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { gate, removeDirs, until } from "./helpers/wait.js";

/** The flow the fake main agent draws: a plan, a gate that checks it, a hunt that reads both. */
const DRAWN = {
  title: "Plan, check, hunt",
  steps: [
    { why: "The plan comes first: the rest reads it.", boxes: [{ id: "plan", agent: "pm", words: "Plan the parser." }] },
    { why: "Nothing is hunted before the plan holds.", boxes: [{ id: "check", agent: "skeptic", words: "Check the plan.", gate: true, needs: ["plan"] }] },
    { why: "The hunt reads the plan and the check.", boxes: [{ id: "hunt", team: "bughunters", words: "Hunt for bugs in the parser.", needs: ["plan", "check"] }] },
  ],
};

/**
 * The message a request's turn began with: the newest user message that is more than tool results. A chat's later turns
 * carry its earlier ones, and a team's lead reads the main chat's record, so the fake answers by this alone.
 * @param {any[]} messages
 */
const turnOf = (messages) => {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    const c = Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }];
    if (c.every((/** @type {any} */ b) => b?.type === "tool_result")) continue;
    return JSON.stringify(c);
  }
  return "";
};

describe("a flow beside a chat, through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** What each request with tools held. @type {string[]} */
  const seen = [];
  /** The tools each request with tools listed. @type {string[][]} */
  const listed = [];
  /** @param {string} id @param {any} input */
  const flowCall = (id, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name: "flow", input }] });
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-flow-"));
    up = await fakeUpstream((call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = JSON.stringify(call.body?.messages || []);
      const turn = turnOf(call.body?.messages || []);
      seen.push(text);
      listed.push(call.body.tools.map((/** @type {any} */ t) => String(t.name)));
      // A box first: a team's lead reads the main chat's record, the /flow message with Filament's line in it.
      if (turn.includes("You are BugHunters, in step 3")) return anthropicReply("Findings:\n- Found | A null read | parse.js:3 | read it", { model: "m-1" });
      if (turn.includes("You are Reviewer, in step 3")) return anthropicReply("Verdict: go\n\nThe plan, the architecture and the mocks agree.", { model: "m-1" });
      if (turn.includes("You are Builders, in step 4") || turn.includes("You are BugHunters, in step 5")) return anthropicReply("The parser is built.", { model: "m-1" });
      // The main agent, asked with /flow: a draft that names an agent nobody has, then the right one, then its words.
      if (turn.includes("the developer typed /flow")) {
        if (!text.includes("tu_flow_1")) return flowCall("tu_flow_1", { action: "draft", title: DRAWN.title, steps: [{ boxes: [{ id: "qa", agent: "qa", words: "Test it." }] }, ...DRAWN.steps] });
        if (!text.includes("tu_flow_2")) return flowCall("tu_flow_2", { action: "draft", ...DRAWN });
        return anthropicReply("I drew the flow: the plan first, the Skeptic checks it before the hunt, and the hunt reads both.", { model: "m-1" });
      }
      // A draft outside a /flow.
      if (turn.includes("draw a flow on your own")) {
        if (!text.includes("tu_flow_3")) return flowCall("tu_flow_3", { action: "draft", ...DRAWN });
        return anthropicReply("I may not draw one now.", { model: "m-1" });
      }
      if (text.includes("You are PM, in step 1")) return anthropicReply("THE PLAN: a lexer, then a parser.", { model: "m-1" });
      if (text.includes("You are Skeptic, in step 2")) return anthropicReply("Verdict: go\n\nThe plan holds.", { model: "m-1" });
      if (text.includes("You are BugHunters, in step 3")) return anthropicReply("Findings:\n- Found | A null read | parse.js:3 | read it", { model: "m-1" });
      if (text.includes("a flow beside this chat finished")) return anthropicReply("Noted: I will fix parse.js:3.", { model: "m-1" });
      // The shipped saved flow's gate, the Reviewer (OA-D4: no team's own Lead is a box): it lets the work go on.
      if (text.includes("You are Reviewer, in step 3")) return anthropicReply("Verdict: go\n\nThe plan, the architecture and the mocks agree.", { model: "m-1" });
      return anthropicReply("The parser is built.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    // The person's own cards the flows here are drawn with, beside the ones that ship (helpers/flow-cards.js).
    for (const c of OWN_CARDS) assert.equal((await shim.api("/api/agents", { method: "POST", body: c })).status, 200, c.tag);
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build the parser", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });
  const transcript = async (/** @type {string} */ id) => (await shim.api(`/api/sessions/${id}/transcript`)).json();
  const flows = async () => (await (await shim.api(`/api/sessions/${sid}/flows`)).json()).flows;

  test("the chip's routes are gone: no flow is drawn from a message's names", async () => {
    for (const path of ["names", "draw"]) {
      const r = await shim.api(`/api/sessions/${sid}/flows/${path}`, { method: "POST", body: { text: "hey pm plan it", words: "hey pm plan it" } });
      assert.equal(r.status, 404, path);
    }
    assert.ok(listed.every((names) => names.includes("flow")), "the chat's agent has its flow tool every turn");
  });

  test("a draft outside a /flow is refused in words, and nothing is drawn", async () => {
    const r = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "draw a flow on your own", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok(seen.some((x) => x.includes("Not drawn: a flow is drawn only when the person asks for one with /flow")));
    assert.equal((await flows()).length, 0);
  });

  test("/flow: the main agent draws it with its flow tool — refused once for an agent nobody has — and nothing runs before Start", async () => {
    const words = "plan the parser with pm, have the skeptic check the plan, then BugHunters hunts";
    const r = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: words, flow: true, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(r.headers.get("x-filament-flow"), "1");
    const asked = seen.find((x) => x.includes("the developer typed /flow"));
    assert.ok(asked);
    assert.match(asked, /- pm: PM, /);
    assert.match(asked, /- bughunters: BugHunters, reads only/);
    assert.ok(seen.some((x) => x.includes('Not drawn: no agent of the person\'s is called \\"qa\\": theirs are ')), "the stranger refused with who there is");
    assert.ok(seen.some((x) => x.includes("Drawn: the draft stands over the person's message box")));
    const list = await flows();
    assert.equal(list.length, 1);
    const d = list[0];
    assert.deepEqual([d.state, d.drawn, d.goal, d.title, d.problem], ["draft", "agent", words, "Plan, check, hunt", null]);
    assert.deepEqual(d.steps.map((/** @type {any} */ s) => s.why), DRAWN.steps.map((s) => s.why));
    assert.deepEqual(d.steps[2].boxes[0].needsOf.map((/** @type {any} */ n) => n.name), ["PM", "Skeptic"]);
    const t = await transcript(sid);
    assert.equal(t.turns.at(-1).flow, true, "its row says /flow after a reload");
    assert.equal(t.turns.at(-1).use, undefined, "a /flow's names are the flow's, not ones to use now");
    assert.equal((await (await shim.api(`/api/sessions/${sid}/subagents`)).json()).subagents?.filter?.((/** @type {any} */ x) => x.origin === "flow")?.length ?? 0, 0);
  });

  test("Start: the whole flow — the gate, a team beside — each box handed what it needs; the start told, one message at the end", async () => {
    const fid = (await flows())[0].id;
    const s = await shim.api(`/api/sessions/${sid}/flows/${fid}/start`, { method: "POST", body: {} });
    assert.equal(s.status, 200, await s.clone().text());
    const done = await until(
      async () => {
        const f = await (await shim.api(`/api/sessions/${sid}/flows/${fid}`)).json();
        return f.state === "done" ? f : null;
      },
      "the flow's end",
      { timeoutMs: 30_000 },
    );
    const boxes = done.steps.flatMap((/** @type {any} */ x) => x.boxes);
    assert.deepEqual(boxes.map((/** @type {any} */ b) => [b.name, b.state]), [["PM", "done"], ["Skeptic", "done"], ["BugHunters", "done"]]);
    assert.deepEqual(boxes[1].verdict, { go: true, why: "" });
    assert.match(boxes[2].result.text, /parse\.js:3/);
    // Each box was handed what it needs: the Skeptic the plan, BugHunters the plan and the verdict.
    assert.ok(seen.some((x) => x.includes("You are Skeptic") && x.includes("placed there because: Nothing is hunted before the plan holds") && x.includes("THE PLAN: a lexer")));
    assert.ok(seen.some((x) => x.includes("You are BugHunters") && x.includes("THE PLAN: a lexer") && x.includes("verdict=\\\"go\\\"")));
    // The flow tool is the chat's own agent's: no box, no team's lead, has it.
    const boxCalls = seen.map((x, i) => (/You are (PM|Skeptic|BugHunters), in step/.test(x) ? listed[i] : null)).filter((x) => !!x);
    assert.ok(boxCalls.length >= 3);
    assert.ok(boxCalls.every((names) => !names.includes("flow")), JSON.stringify(boxCalls));
    // The asks were the person's own sub-agents, kept by the flow: none waits aside for a Send.
    const subs = await (await shim.api(`/api/sessions/${sid}/subagents`)).json();
    const flowSubs = (subs.subagents || subs).filter((/** @type {any} */ x) => x.origin === "flow");
    assert.equal(flowSubs.length, 2);
    assert.ok(flowSubs.every((/** @type {any} */ x) => x.exchanges.at(-1).delivery === "flow"));
    // The team box: a team chat beside the main one, the flow's, no mark in the main chat.
    const beside = await (await shim.api(`/api/sessions/${sid}/beside`)).json();
    const team = beside.teams.find((/** @type {any} */ t) => t.flow?.id === fid);
    assert.ok(team, "BugHunters' chat is the flow's");
    assert.equal(boxes[2].run.team, team.id);
    assert.equal(team.title, "BugHunters: Hunt for bugs in the parser.", "its chat is named for its part");
    // A team's own chat draws no flow: /flow there is refused, and nothing goes to its lead.
    const asked = seen.length;
    const teamFlow = await shim.api(`/api/sessions/${team.id}/turns`, { method: "POST", body: { content: "plan more", flow: true, stream: false } });
    assert.equal(teamFlow.status, 400);
    assert.match(String((await teamFlow.json()).error), /a team's own chat draws no flow/);
    assert.equal(seen.length, asked);
    // The end: one turn of Filament's own in the main chat.
    const main = await until(async () => {
      const t = await transcript(sid);
      return t.turns.at(-1)?.final && seen.some((x) => x.includes("a flow beside this chat finished")) ? t : null;
    }, "the main agent's turn with the flow's end");
    assert.equal(main.boundaries.filter((/** @type {any} */ b) => b.type === "team").length, 0, "no team mark in the main chat");
    assert.ok(seen.some((x) => x.includes("a flow beside this chat finished") && x.includes("parse.js:3")), "the main agent read the end whole");
    const after = await (await shim.api(`/api/sessions/${sid}/flows/${fid}`)).json();
    assert.equal(after.end.sent.how, "sent");
    // (OA-D8) Its start reached the main agent, the flow as it stood, with the next message it read.
    const next = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "thanks", stream: false } });
    assert.equal(next.status, 200);
    assert.ok(seen.some((x) => x.includes("[Filament: the person started a flow beside this chat") && x.includes("- hunt: BugHunters (team, reads only) · needs plan (PM), check (Skeptic)")), "the start's notice");
    // The row of the message it rode with says so, as the flow you started (no agent's message).
    const rows = (await (await shim.api(`/api/sessions/${sid}/transcript`)).json()).turns.filter((/** @type {any} */ t) => t.flowStarts);
    assert.deepEqual(rows.map((/** @type {any} */ t) => t.flowStarts), [1]);
  });

  test("refusals in words: a box's act it does not know, a flow nobody drew, a saved flow nobody saved", async () => {
    const fid = (await flows())[0].id;
    const bad = await shim.api(`/api/sessions/${sid}/flows/${fid}/boxes/plan/jump`, { method: "POST", body: {} });
    assert.equal(bad.status, 404);
    const none = await shim.api(`/api/sessions/${sid}/flows/fl-nope/start`, { method: "POST", body: {} });
    assert.equal(none.status, 404);
    assert.match((await none.json()).error, /no flow of this chat answers/);
    const saved = await shim.api(`/api/sessions/${sid}/flows`, { method: "POST", body: { saved: "nope", goal: "x" } });
    assert.equal(saved.status, 404);
    const shipped = await (await shim.api("/api/flows/saved")).json();
    assert.equal(shipped.flows[0].key, "plan-check-build-hunt");
    const ran = await shim.api(`/api/sessions/${sid}/flows/${fid}/start`, { method: "POST", body: {} });
    assert.equal(ran.status, 409);
  });

  // (fails before: yes — HarnessV4_Flow_Plan F6: no flow could be kept or started from a saved one)
  test("the saved flow that ships, started on the person's words: five steps, its gate's go, two teams, done; a drawn flow kept and listed", async () => {
    const goal = "add a dark mode to the settings page";
    const c = await shim.api(`/api/sessions/${sid}/flows`, { method: "POST", body: { saved: "plan-check-build-hunt", goal } });
    const made = await c.json();
    assert.equal(c.status, 200, JSON.stringify(made));
    assert.deepEqual([made.flow.state, made.flow.drawn, made.flow.goal, made.flow.title, made.flow.problem], ["draft", "saved", goal, "Plan, check, build, hunt", null]);
    assert.deepEqual(made.flow.steps.map((/** @type {any} */ st) => st.boxes.map((/** @type {any} */ x) => x.name)), [["Product"], ["Builder", "Product"], ["Reviewer"], ["Builders"], ["BugHunters"]]);
    const fid = made.flow.id;
    const s = await shim.api(`/api/sessions/${sid}/flows/${fid}/start`, { method: "POST", body: {} });
    assert.equal(s.status, 200, await s.clone().text());
    const done = await until(
      async () => {
        const f = await (await shim.api(`/api/sessions/${sid}/flows/${fid}`)).json();
        return f.state === "done" || f.state === "holds" ? f : null;
      },
      "the saved flow's end",
      { timeoutMs: 60_000 },
    );
    assert.equal(done.state, "done", JSON.stringify([done.hold, done.steps.flatMap((/** @type {any} */ x) => x.boxes).map((/** @type {any} */ b) => [b.name, b.state, b.error])]));
    const boxes = done.steps.flatMap((/** @type {any} */ x) => x.boxes);
    assert.ok(boxes.every((/** @type {any} */ b) => b.state === "done"), JSON.stringify(boxes.map((/** @type {any} */ b) => [b.name, b.state, b.error])));
    assert.deepEqual(boxes[3].verdict, { go: true, why: "" });
    assert.ok(seen.some((x) => x.includes("You are Reviewer, in step 3") && x.includes("add a dark mode to the settings page")), "every box is handed the person's words");
    // Kept: its steps under a name, listed beside the one that ships, and a draft again from it.
    const k = await shim.api(`/api/sessions/${sid}/flows/${fid}/keep`, { method: "POST", body: { name: "Dark mode flow" } });
    const kept = await k.json();
    assert.equal(k.status, 200, JSON.stringify(kept));
    const savedList = await (await shim.api("/api/flows/saved")).json();
    assert.deepEqual(savedList.flows.map((/** @type {any} */ f) => [f.name, f.shipped]), [["Plan, check, build, hunt", true], ["Dark mode flow", false]]);
    const again = await (await shim.api(`/api/sessions/${sid}/flows`, { method: "POST", body: { saved: kept.saved.key, goal: "a light mode too" } })).json();
    assert.deepEqual([again.flow.state, again.flow.goal, again.flow.steps.length, again.flow.steps[4].boxes[0].needs], ["draft", "a light mode too", 5, ["build"]]);
  });

  // (fails before: yes — the owner's ask of 10-23: a flow taken off the list left its boxes' threads and its team's chat)
  test("Delete flow… from the Agents tab: its boxes' threads and its team's chat go with it; the box's chat alone is refused; a draft goes with nothing", async () => {
    const ran = (await flows()).find((/** @type {any} */ f) => f.drawn === "agent" && f.state === "done");
    assert.ok(ran, "the flow /flow drew, run to its end");
    const subIds = ran.steps.flatMap((/** @type {any} */ x) => x.boxes).flatMap((/** @type {any} */ b) => [b.run?.sub, ...(b.ran || [])]).filter((/** @type {any} */ x) => typeof x === "string");
    assert.equal(subIds.length, 2, "the PM's and the Skeptic's");
    const teamsNow = async () => /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams);
    const team = (await teamsNow()).find((t) => t.flow?.id === ran.id);
    assert.ok(team, "BugHunters' chat");
    const alone = await shim.api(`/api/sessions/${sid}/beside/${team.id}`, { method: "DELETE" });
    assert.deepEqual([alone.status, (await alone.json()).error], [409, "it is a box of a flow: it goes with its flow"]);
    const r = await shim.api(`/api/sessions/${sid}/flows/${ran.id}?runs=1`, { method: "DELETE" });
    const out = await r.json();
    assert.equal(r.status, 200, JSON.stringify(out));
    assert.deepEqual(out, { ok: true, threads: 2, teams: 1 });
    const subs = /** @type {any[]} */ ((await (await shim.api(`/api/sessions/${sid}/subagents`)).json()).subagents);
    assert.equal(subs.some((x) => subIds.includes(x.id)), false, "its threads left the list");
    assert.ok(subs.some((x) => x.origin === "flow"), "the saved flow's threads stay");
    assert.equal((await teamsNow()).some((t) => t.id === team.id), false, "its team's chat went");
    assert.equal((await shim.api(`/api/sessions/${sid}/flows/${ran.id}`)).status, 404);
    const draft = (await flows()).find((/** @type {any} */ f) => f.state === "draft");
    assert.ok(draft, "the draft the kept flow made");
    const d = await shim.api(`/api/sessions/${sid}/flows/${draft.id}?runs=1`, { method: "DELETE" });
    assert.deepEqual([d.status, await d.json()], [200, { ok: true, threads: 0, teams: 0 }]);
  });
});

describe("a flow's writer in its own worktree, through a throwaway Filament (OA5)", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let repo;
  /** @type {string} */ let plain;
  /** What each request with tools held. @type {string[]} */
  const seen = [];
  /** The tools each team lead's request listed. @type {string[][]} */
  const leadTools = [];
  const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  /** @param {string} cwd @param {string[]} args */
  const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
  /** @param {string} id @param {string} name @param {any} input */
  const call = (id, name, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }] });
  const STEPS = [
    { why: "The build first.", boxes: [{ id: "build", team: "builders", words: "Build the lexer." }] },
    { why: "Checked where it was built.", boxes: [{ id: "check", agent: "skeptic", words: "Check the build.", gate: true, needs: ["build"] }] },
  ];
  before(async () => {
    root = realpathSync.native(mkdtempSync(join(tmpdir(), "filament-flow-wt-")));
    repo = join(root, "proj");
    mkdirSync(repo);
    git(repo, ["init", "-q", "-b", "main"]);
    writeFileSync(join(repo, "README.md"), "the lexer\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
    plain = join(root, "plain");
    mkdirSync(plain);
    up = await fakeUpstream((c) => {
      if (c.kind !== "anthropic") return undefined;
      if (!c.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = JSON.stringify(c.body?.messages || []);
      seen.push(text);
      // The Builders' lead writes the build; the Skeptic reads it where the flow works, and says go on finding it.
      if (text.includes("You are Builders, in step 1")) {
        leadTools.push(c.body.tools.map((/** @type {any} */ t) => String(t.name)));
        if (!text.includes("tu_write")) return call("tu_write", "write", { path: "built.txt", content: "BUILT\n" });
        return anthropicReply("Built: built.txt holds the lexer.", { model: "m-1" });
      }
      if (text.includes("You are Skeptic, in step 2")) {
        if (!text.includes("tu_read")) return call("tu_read", "read", { path: "built.txt" });
        return anthropicReply(text.includes("BUILT") ? "Verdict: go\n\nbuilt.txt is there." : "Verdict: not yet — no built.txt here\n\nIt is not in this folder.", { model: "m-1" });
      }
      return anthropicReply("Noted.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    for (const c of OWN_CARDS) assert.equal((await shim.api("/api/agents", { method: "POST", body: c })).status, 200, c.tag);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });
  /** A chat in a folder, one turn in, and the flow drawn there by hand: its id. @param {string} cwd */
  const flowIn = async (cwd) => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd, model: "m-1", preset: "plain" } });
    const sid = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build the lexer", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
    const r = await shim.api(`/api/sessions/${sid}/flows`, { method: "POST", body: { title: "The lexer", goal: "a lexer, built and checked", steps: STEPS } });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    const s = await shim.api(`/api/sessions/${sid}/flows/${b.flow.id}/start`, { method: "POST", body: {} });
    assert.equal(s.status, 200, await s.clone().text());
    const done = await until(async () => {
      const f = await (await shim.api(`/api/sessions/${sid}/flows/${b.flow.id}`)).json();
      return f.state === "done" || f.state === "holds" ? f : null;
    }, "the flow's end", { timeoutMs: 60_000 });
    return { sid, done };
  };
  const same = (/** @type {unknown} */ a, /** @type {string} */ b) => assert.equal(String(a).replace(/\\/g, "/").toLowerCase(), b.replace(/\\/g, "/").toLowerCase());

  test("in a git project: the build in the flow's own worktree on its branch, the gate reading it there, your folder untouched, nothing merged; the end says where (cases 1, 2, 3)", async () => {
    const head = git(repo, ["rev-parse", "HEAD"]);
    const { done } = await flowIn(repo);
    const boxes = done.steps.flatMap((/** @type {any} */ x) => x.boxes);
    assert.equal(done.state, "done", JSON.stringify([done.hold, boxes.map((/** @type {any} */ b) => [b.name, b.state, b.error]), leadTools]));
    assert.equal(done.place.kind, "worktree");
    assert.equal(done.place.branch, "flow-the-lexer");
    same(done.place.folder, join(root, "proj-flow-the-lexer"));
    assert.deepEqual(boxes[0].place, done.place, "its card names the worktree and its branch");
    // (case 2) The build is in the worktree; the main chat's folder has none of it.
    assert.equal(readFileSync(join(root, "proj-flow-the-lexer", "built.txt"), "utf8"), "BUILT\n");
    assert.equal(existsSync(join(repo, "built.txt")), false);
    assert.equal(boxes[1].verdict?.go, true, "the gate read built.txt where the flow works");
    // (case 3) Nothing merged: the main folder's branch and files as they were; the flow's branch holds it.
    assert.deepEqual([git(repo, ["rev-parse", "HEAD"]), git(repo, ["symbolic-ref", "--short", "HEAD"]), git(repo, ["status", "--porcelain"])], [head, "main", ""]);
    assert.ok(git(repo, ["branch", "--list", "flow-the-lexer"]).includes("flow-the-lexer"));
    // Its end goes to the main agent as a turn of Filament's own, once the flow is done.
    const end = await until(async () => seen.find((x) => x.includes("a flow beside this chat finished") && x.includes("The lexer")) || null, "its end at the main agent", { timeoutMs: 30_000 });
    assert.match(String(end), /Works in: the worktree [^"]*proj-flow-the-lexer, on branch flow-the-lexer/);
    assert.match(String(end), /Nothing of it is merged/);
  });

  test("outside git: it writes in the folder, and its card says so (case 4)", async () => {
    const { done } = await flowIn(plain);
    const boxes = done.steps.flatMap((/** @type {any} */ x) => x.boxes);
    assert.equal(done.state, "done", JSON.stringify([done.hold, boxes.map((/** @type {any} */ b) => [b.name, b.state, b.error])]));
    assert.deepEqual([done.place.kind, done.place.why], ["folder", "it is not in a git repository"]);
    assert.deepEqual(boxes[0].place, done.place);
    assert.equal(readFileSync(join(plain, "built.txt"), "utf8"), "BUILT\n");
  });
});

describe("a flow In place, through a throwaway Filament (OA4)", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** What each request with tools held. @type {string[]} */
  const seen = [];
  /** @type {() => void} */ let release = () => {};
  const slow = new Promise((res) => (release = () => res(undefined)));
  /** The PM's plan of the failing lexer, held until the test lets it go. */
  const failingPlan = gate();
  /** @param {string} id @param {any} input */
  const flowCall = (id, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name: "flow", input }] });
  const STEPS = [
    { why: "The plan first.", boxes: [{ id: "plan", agent: "pm", words: "Plan the lexer." }] },
    { why: "Checked before anything is built on it.", boxes: [{ id: "check", agent: "skeptic", words: "Check the lexer plan.", gate: true, needs: ["plan"] }] },
  ];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-flow-in-place-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = JSON.stringify(call.body?.messages || []);
      const turn = turnOf(call.body?.messages || []);
      seen.push(text);
      // The boxes: the PM plans (again with numbers, sent back); the Skeptic says not yet, then go.
      if (text.includes("You are PM, in step 1")) {
        if (text.includes("Plan the slow lexer")) await slow;
        if (text.includes("Plan the failing lexer")) await failingPlan.promise;
        return anthropicReply(text.includes("Its line: add numbers") ? "THE PLAN, WITH NUMBERS" : "THE PLAN", { model: "m-1" });
      }
      if (text.includes("You are Skeptic, in step 2")) return anthropicReply(text.includes("WITH NUMBERS") ? "Verdict: go\n\nNumbers now." : "Verdict: not yet — no numbers\n\nIt needs numbers.", { model: "m-1" });
      // The main agent, driving: the gate's not yet sends the plan back with its why; the end, its last word. Driving
      // the failing lexer, its model refuses the flow's first word.
      if (text.includes("Plan the failing lexer") && turn.includes("[Filament: the flow you drive")) return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "the model refuses this drive" } } };
      if (turn.includes("The flow is done")) return anthropicReply("The flow is done: the plan has its numbers and the Skeptic said go.", { model: "m-1" });
      if (turn.includes("the gate, says not yet") && !text.includes("tu_back")) return flowCall("tu_back", { action: "box", box: "check", do: "back", to: "plan", why: "add numbers" });
      return anthropicReply("Noted.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    for (const c of OWN_CARDS) assert.equal((await shim.api("/api/agents", { method: "POST", body: c })).status, 200, c.tag);
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "build the lexer", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
  });
  after(async () => {
    release();
    failingPlan.open();
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });
  const transcript = async () => (await shim.api(`/api/sessions/${sid}/transcript`)).json();
  /** @param {string} fid */
  const flowNow = async (fid) => (await shim.api(`/api/sessions/${sid}/flows/${fid}`)).json();
  /** A flow drawn by hand, its id. @param {any[]} steps */
  const drawn = async (steps) => {
    const r = await shim.api(`/api/sessions/${sid}/flows`, { method: "POST", body: { title: "The lexer", goal: "a lexer for the parser", steps } });
    const b = await r.json();
    assert.equal(r.status, 200, JSON.stringify(b));
    return String(b.flow.id);
  };

  test("Start · In place: one turn of the main agent drives it — told each box's end, it sends the plan back from the gate with why, and hears the end in the same turn", async () => {
    const fid = await drawn(STEPS);
    const turns = (await transcript()).turns.length;
    const s = await shim.api(`/api/sessions/${sid}/flows/${fid}/start`, { method: "POST", body: { inPlace: true } });
    const started = await s.json();
    assert.equal(s.status, 200, JSON.stringify(started));
    assert.deepEqual([started.flow.state, started.flow.inPlace, started.flow.drives], ["running", true, true]);
    const done = await until(async () => {
      const f = await flowNow(fid);
      return f.state === "done" || f.state === "stopped" ? f : null;
    }, "the flow's end", { timeoutMs: 30_000 });
    assert.equal(done.state, "done", JSON.stringify(done.steps.flatMap((/** @type {any} */ x) => x.boxes).map((/** @type {any} */ b) => [b.name, b.state, b.error])));
    assert.deepEqual(done.acts.map((/** @type {any} */ a) => [a.by, a.what, a.why || ""]), [["agent", "sent PM back from Skeptic", "add numbers"]]);
    assert.equal(done.end, null, "no end message of its own: the turn that drove it heard the end");
    const t = await until(async () => {
      const x = await transcript();
      return x.turns.at(-1)?.final && /The flow is done: the plan has its numbers/.test(JSON.stringify(x.turns.at(-1))) ? x : null;
    }, "the driving turn's last reply");
    assert.equal(t.turns.length, turns + 1, "one turn drove the whole flow");
    const row = t.turns.at(-1);
    assert.equal(row.flowDrive, true, "its row says the person started a flow in place");
    // Each burst of the flow's moves was one word in the turn's own work, the end the last.
    const words = row.work.filter((/** @type {any} */ m) => m.role === "user" && /^\[Filament: the flow you drive/.test(String(m.content?.[0]?.text || ""))).map((/** @type {any} */ m) => String(m.content[0].text));
    assert.ok(words.length >= 4, `it read the flow's word as it moved: ${JSON.stringify(words)}`);
    assert.match(words.at(-1) || "", /The flow is done: 1\. PM — done 2\. Skeptic — go\. End your turn/);
    assert.ok(seen.some((x) => x.includes("[Filament: the person started a flow in place") && x.includes("- check: Skeptic (gate) · needs plan (PM)")), "the turn opened on the flow as it stands");
    assert.ok(seen.some((x) => x.includes("Done: you sent PM back from Skeptic.")), "the tool's answer said what it did");
    assert.ok(seen.some((x) => x.includes("You are PM, in step 1") && x.includes("the main agent that drives the flow sent your part back") && x.includes("Its line: add numbers")), "the PM heard the agent's line");
    assert.ok(seen.some((x) => x.includes("[Filament: the flow you drive") && x.includes("<flow-result step=\\\"1\\\" box=\\\"PM\\\" id=\\\"plan\\\">\\nTHE PLAN")), "each box's result reached it whole");
  });

  test("Stop on the turn that drives it stops the flow, its box at work with it", async () => {
    const fid = await drawn([{ why: "The plan.", boxes: [{ id: "plan", agent: "pm", words: "Plan the slow lexer." }] }, STEPS[1]]);
    const s = await shim.api(`/api/sessions/${sid}/flows/${fid}/start`, { method: "POST", body: { inPlace: true } });
    assert.equal(s.status, 200, await s.clone().text());
    await until(async () => ((await flowNow(fid)).steps[0].boxes[0].state === "working" && seen.some((x) => x.includes("Plan the slow lexer") && x.includes("You are PM")) ? true : null), "the PM at work");
    const busy = await shim.api(`/api/sessions/${sid}/flows/${await drawn(STEPS)}/start`, { method: "POST", body: { inPlace: true } });
    assert.equal(busy.status, 409);
    assert.match(String((await busy.json()).error), /a turn runs in your chat/);
    const stop = await shim.api(`/api/sessions/${sid}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    const stopped = await until(async () => {
      const f = await flowNow(fid);
      return f.state === "stopped" ? f : null;
    }, "the flow stopped with the turn", { timeoutMs: 30_000 });
    assert.deepEqual([stopped.acts.at(-1).by, stopped.acts.at(-1).what], ["person", "stopped the turn that drove it, and the flow with it"]);
    assert.equal(stopped.steps[0].boxes[0].state, "stopped");
  });

  // (fails before: yes — a turn that failed before doing any work kept no failure where the flow reads its end: it held
  // as "your agent's turn ended before the flow did", and a team box's lead in that case read as stopped)
  test("its model refuses the turn mid-flow: the flow holds and says why in the provider's words; its box at work goes on, nothing new starts", async () => {
    const fid = await drawn([{ why: "The plan.", boxes: [{ id: "plan", agent: "pm", words: "Plan the failing lexer." }] }, STEPS[1]]);
    const s = await shim.api(`/api/sessions/${sid}/flows/${fid}/start`, { method: "POST", body: { inPlace: true } });
    assert.equal(s.status, 200, await s.clone().text());
    // The PM's plan is held until the refused turn has let the flow go: a plan done first would start the Skeptic while
    // the flow still ran, as a busy machine's slower turn let it.
    const lost = await until(async () => {
      const f = await flowNow(fid);
      return f.hold?.kind === "driver" ? f : null;
    }, "the flow holds for the person", { timeoutMs: 30_000 });
    assert.equal(lost.steps[0].boxes[0].state, "working", "its box at work goes on");
    failingPlan.open();
    const held = await until(async () => {
      const f = await flowNow(fid);
      return f.steps[0].boxes[0].state === "done" ? f : null;
    }, "its box's end", { timeoutMs: 30_000 });
    assert.deepEqual([held.state, held.drives, held.hold?.kind], ["holds", false, "driver"]);
    assert.match(String(held.lost), /^your agent's turn failed: .*the model refuses this drive/);
    assert.equal(held.steps[1].boxes[0].state, "waits");
    assert.equal(held.line, "Flow · step 2 of 2 · your agent's turn ended");
  });
});

describe("Run as a flow, through a throwaway Filament (OA6)", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** What each request with tools held. @type {string[]} */
  const seen = [];
  /** @type {() => void} */ let release = () => {};
  const slow = new Promise((res) => (release = () => res(undefined)));
  /** @param {string} id @param {any} input */
  const flowCall = (id, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name: "flow", input }] });
  const STEPS = [{ why: "The plan first.", boxes: [{ id: "plan", agent: "pm", words: "Plan it." }] }];
  const WORDS = "plan the parser, then build it, then review it";
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-flow-offer-"));
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const text = JSON.stringify(call.body?.messages || []);
      const turn = turnOf(call.body?.messages || []);
      seen.push(text);
      // The press: a /flow with the same words — no offer there.
      if (turn.includes("the developer typed /flow")) {
        if (!text.includes("tu_offer_4")) return flowCall("tu_offer_4", { action: "offer" });
        return anthropicReply("I will draw it.", { model: "m-1" });
      }
      // Three steps in order, no /flow: the offer twice, then a draft.
      if (turn.includes(WORDS)) {
        if (!text.includes("tu_offer_1")) return flowCall("tu_offer_1", { action: "offer" });
        if (!text.includes("tu_offer_2")) return flowCall("tu_offer_2", { action: "offer" });
        if (!text.includes("tu_offer_3")) return flowCall("tu_offer_3", { action: "draft", steps: STEPS });
        return anthropicReply("Three steps in order: Run as a flow under this reply draws them.", { model: "m-1" });
      }
      // A message of pictures alone: the offer is refused — the button sends the person's words.
      if (text.includes(PNG) && !text.includes("tu_offer_6")) return flowCall("tu_offer_6", { action: "offer" });
      // Stopped after its offer: the turn ends without its reply.
      if (turn.includes("lint it, then test it, then ship it")) {
        if (!text.includes("tu_offer_5")) return flowCall("tu_offer_5", { action: "offer" });
        await slow;
        return anthropicReply("Too late.", { model: "m-1" });
      }
      return anthropicReply("Noted.", { model: "m-1" });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg, { dataDir }) => {
        // A stand-in Claude Code, for the offer over Filament's MCP server.
        const cli = { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }, cli];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }, { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
    for (const c of OWN_CARDS) assert.equal((await shim.api("/api/agents", { method: "POST", body: c })).status, 200, c.tag);
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    sid = String((await made.json()).id);
    const first = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(first.status, 200, await first.clone().text());
  });
  after(async () => {
    release();
    await shim?.stop();
    await up?.close();
    await removeDirs(root);
  });
  /** The chat's rows, as the transcript gives them. @returns {Promise<any[]>} */
  const rows = async () => (await (await shim.api(`/api/sessions/${sid}/transcript`)).json()).turns;

  // Cases 1, 2 and 3. (fails before: yes — the flow tool took no offer, and no row said one)
  test("steps in order, no /flow: one offer under its reply, the second refused, a draft refused; nothing drawn", async () => {
    const r = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: WORDS, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const last = seen.at(-1) || "";
    assert.ok(last.includes("Offered: a Run as a flow button stands under your reply"), last.slice(-1500));
    assert.ok(last.includes("Not offered: this reply offers it already: one a reply."), "case 3: one shows");
    assert.ok(last.includes("Not drawn: a flow is drawn only when the person asks for one with /flow, or presses Run as a flow"), "case 2");
    assert.deepEqual((await rows()).map((t) => t.flowOffer === true), [false, true], "the button stands under that reply alone");
    assert.equal((await (await shim.api(`/api/sessions/${sid}/flows`)).json()).flows.length, 0, "the offer drew nothing");
  });

  test("the press is the person's /flow with the same words: its turn offers none, and its agent may draft", async () => {
    const r = await shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: WORDS, flow: true, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(r.headers.get("x-filament-flow"), "1");
    assert.ok((seen.at(-1) || "").includes("Not offered: their message is /flow already: draft its flow (action draft)."));
    const turns = await rows();
    assert.deepEqual([turns.at(-1).flow, turns.at(-1).flowOffer], [true, undefined]);
  });

  test("a turn stopped after its offer ends without its reply: no button", async () => {
    const run = shim.api(`/api/sessions/${sid}/turns`, { method: "POST", body: { content: "lint it, then test it, then ship it", stream: false } });
    await until(async () => (seen.some((x) => x.includes("tu_offer_5") && x.includes("Offered: a Run as a flow")) ? true : null), "the offer made");
    const stop = await shim.api(`/api/sessions/${sid}/stop`, { method: "POST", body: {} });
    assert.equal(stop.status, 200, await stop.clone().text());
    await (await run).text();
    release();
    const turns = /** @type {any[]} */ (await until(async () => {
      const t = await rows();
      return t.length === 4 ? t : null;
    }, "the stopped turn's row"));
    assert.deepEqual(turns.map((t) => t.flowOffer === true), [false, true, false, false]);
  });

  // (fails before: yes — the flows hunt of 10-23: the offer was taken, and the page drew no button for a message without words)
  test("a message of pictures alone: the offer is refused in words, and no row says one", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const pid = String((await made.json()).id);
    const r = await shim.api(`/api/sessions/${pid}/turns`, { method: "POST", body: { content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: PNG } }], stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    assert.ok((seen.at(-1) || "").includes("Not offered: their message has no words, only pictures: the button sends their words, so there is none to offer."), (seen.at(-1) || "").slice(-800));
    const turns = (await (await shim.api(`/api/sessions/${pid}/transcript`)).json()).turns;
    assert.equal(turns.at(-1).flowOffer, undefined);
  });

  test("a coding agent offers it over Filament's MCP server: the button under its reply", async () => {
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "coder-1", preset: "plain" } });
    const cid = String((await made.json()).id);
    const r = await shim.api(`/api/sessions/${cid}/turns`, { method: "POST", body: { content: `~mcpcall flow ${JSON.stringify({ action: "offer" })}`, stream: false } });
    const said = JSON.stringify(await r.json());
    assert.equal(r.status, 200, said);
    assert.match(said, /mcp:Offered: a Run as a flow button stands under your reply/);
    const turns = (await (await shim.api(`/api/sessions/${cid}/transcript`)).json()).turns;
    assert.equal(turns.at(-1).flowOffer, true);
  });
});

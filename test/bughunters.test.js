// @ts-check
// "Teams, improved and kept" (11-03), BugHunters: the Bug Hunter and the Verifier are one team that finds and checks,
// and fixes nothing — a Hunter seat and a Checker seat, both on Reviewer, under one Lead whose words lead a hunt (its
// Hunters' findings each checked by Checkers, side by side) and a check of claims it is given. Verify… and Then verify
// fire it with a result as the claims to check, and its own result is checked by none. It is the one team a chat's
// agent starts by itself where nobody chose another. What a person kept that names the two gone teams or the
// Verifier's Lead is never converted: it falls back, and says in words that BugHunters does that work. The Plan's hunt
// from a graph node runs a Reviewer, and its words say so.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// The new exports are read through each module's namespace, so the file loads on the code before them and each test
// fails on its own there.
import * as beside from "../src/core/beside.js";
import * as foldedTeams from "../src/core/folded-teams.js";
import * as text from "../src/core/text.js";
import * as labels from "../src/ui/harness/lib/labels.js";
import { findingsFormat, findingsOf, noteFor, verifyAsk } from "../src/core/beside.js";
import { foldedLeadWords, foldedTeamWords } from "../src/core/folded-teams.js";
import { SHIPPED_TEAMS } from "../src/services/teams.js";
import { CARD_LIMITS, SHIPPED_CARDS } from "../src/services/agent-cards.js";
import { AGENT_TEAMS, agentTeamsOf } from "../src/services/session-settings.js";
import { CONFIG_SCHEMA } from "../src/core/schema.js";
import { engineProblem } from "../src/app/engine.js";
import { BESIDE_TOOL, besideCall } from "../src/app/agent/beside-tool.js";
import { createTeamsBeside } from "../src/app/teams-beside.js";
import { createSubagentRegistry } from "../src/app/agent/subagents.js";
import { startAnatomy } from "../src/app/sessions/draft-start.js";
import { checkFlow, flowOf } from "../src/core/flow.js";
import { createSavedFlows } from "../src/services/saved-flows.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { defaultConfig } from "../src/config.js";
import * as pageBeside from "../src/ui/harness/lib/beside.js";
import { SWITCH_WORDS, cardActions, resultAttachment, seenWords } from "../src/ui/harness/lib/beside.js";
import { teamItems } from "../src/ui/harness/lib/side.js";
import { createStartBoard } from "../src/ui/harness/conversation/start-board.js";
import { engineTag } from "../src/ui/harness/conversation/team-turns.js";
import { teamIcon, teamTone } from "../src/ui/harness/lib/team.js";
import { applyTasks, graphView } from "../src/core/task-graph.js";
import * as taskGraph from "../src/ui/harness/views/task-graph.js";
import { drawGraph, huntBusyWords, huntWhat } from "../src/ui/harness/views/task-graph.js";
import { renderPlan, chooseTask } from "../src/ui/harness/views/plan.js";
import { teamStore } from "./helpers/team.js";
import { poolChips } from "./helpers/team-view.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { all, every, btn, openAgents } from "./helpers/agents-page.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";
import "./helpers/teams-on-page.js";

/** The Hunter's and the Checker's lines, as the Bug Hunter and the Verifier gave them. */
const HUNTER_LINE = "Hunt only your slice. Each finding: the claim, its file and line, the code that shows it, why it is a bug, and how to see it go wrong where that can be shown. One you cannot back with file, line and code is Plausible, said so.";
/** The Hunter's line as it ships: its report ends with the fixed findings list, which Filament merges (the plan's p6). */
const HUNTER_SHIPS = `${HUNTER_LINE} End your report with a line that says only "Findings:" and one line per finding under it — "- Found | <the bug, in a few words> | <file>:<line> | <the code that shows it, and why>", Plausible in Found's place where you cannot back it — so Filament can merge them with the other Hunters' for your lead.`;
const CHECKER_LINE = "Check each claim you were given against the code as it is now: read the file and the line, run what shows it where you can. Confirmed with why, Plausible where it cannot be shown either way, Dismissed with why. Fix nothing.";
/** What a person kept may name: each gone key or tag, and the words it is met with. */
const BUG_HUNTER = "Bug Hunter is now BugHunters: send BugHunters with what to hunt";
const VERIFIER = "Verifier is now part of BugHunters: send BugHunters with the claims to check";
const VERIFY_LEAD = "Verifier is now part of BugHunters: make another card the lead, or send BugHunters in this team's place";

/** A folder of its own, removed after the run. */
const made = /** @type {string[]} */ ([]);
const folder = () => {
  const d = mkdtempSync(join(tmpdir(), "filament-bughunters-"));
  made.push(d);
  return d;
};
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});

// (fails before: yes — two teams found and checked, the Bug Hunter and the Verifier, each led by a Lead of its own)
describe("one BugHunters team", () => {
  test("ships beside Builders, read-only, led by its own Lead, its crew a Hunter and a Checker seated on Reviewer with their lines; it names no model", () => {
    assert.deepEqual(Object.keys(SHIPPED_TEAMS), ["builders", "bughunters"]);
    const leads = Object.entries(SHIPPED_CARDS).filter(([, c]) => "partOf" in c && c.partOf).map(([tag, c]) => [tag, c.name, /** @type {any} */ (c).partOf]);
    assert.deepEqual(leads, [["buildlead", "Builders", "builders"], ["huntlead", "BugHunters", "bughunters"]]);
    const store = teamStore();
    assert.equal(store.cards.find("verifylead"), null, "the Verifier's Lead ships no more");
    const t = /** @type {any} */ (store.find("bughunters"));
    assert.deepEqual([t.key, t.name, t.lead, t.readOnly, t.check, t.models, t.leadModels, t.shipped], ["bughunters", "BugHunters", { tag: "huntlead", name: "BugHunters" }, true, null, [], [], true]);
    assert.deepEqual(t.members.map((/** @type {any} */ m) => [m.tag, m.card, m.name, m.may, m.place, m.line, m.own ?? null]), [
      ["hunter", "reviewer", "Hunter", "read", "reviewer", HUNTER_SHIPS, null],
      ["checker", "reviewer", "Checker", "read", "reviewer", CHECKER_LINE, null],
    ]);
    assert.equal(store.find("BugHunters")?.key, "bughunters", "by its name too");
    for (const gone of ["bug-hunter", "verifier", "Bug Hunter", "Verifier"]) assert.equal(store.find(gone), null, `${gone} is no team`);
    // The person may put the Checker on a stronger model: its own model, set in place.
    const strong = store.update("bughunters", { members: [{ tag: "reviewer", name: "Hunter", line: HUNTER_SHIPS }, { tag: "reviewer", name: "Checker", line: CHECKER_LINE, model: "Claude Opus 5.5" }] });
    assert.deepEqual(strong.members.map((m) => m.own ?? null), [null, { model: "Claude Opus 5.5" }]);
  });
});

// (fails before: yes — a hunt's lead and a check's were two Leads, each with words for one kind of ask)
describe("its lead's words", () => {
  const thinks = String(SHIPPED_CARDS.huntlead.thinks);
  test("asked to find bugs: slices to Hunters, every finding to Checkers side by side, duplicates merged and ranked; Found, Plausible, Dismissed and what was not covered", () => {
    for (const w of [
      "you find bugs and check claims, and you fix nothing",
      "Asked to find bugs: split the job into slices",
      "give each Hunter one, with a brief",
      "When their reports are in, send every finding to your Checkers, a few each, side by side, to check against the code as it is now",
      "Then merge the duplicates and rank by harm",
      "Found (each one confirmed, with its evidence), Plausible (with what is missing to show it), Dismissed (each in a line, with why) and what was not covered",
    ]) assert.ok(thinks.includes(w), w);
    assert.ok(thinks.includes("a Checker on a stronger model than the Hunters — the person may give one its own model — has the last word on a finding"), "a Checker may run on a model of its own");
  });

  test("asked to check claims: split among Checkers, each claim one verdict; either way a subject line first, and the fixed list last", () => {
    for (const w of [
      "Asked to check claims you are given: split them among your Checkers, a few each",
      "Your result gives each claim one verdict: Confirmed (with why), Plausible (it cannot be shown either way, with what is missing) or Dismissed (with why)",
      'Either way, start your result with one line, "Subject: " and your verdict in under 20 words',
    ]) assert.ok(thinks.includes(w), w);
    assert.ok(thinks.endsWith(`\n\n${findingsFormat()}`), "the fixed list closes its words");
    assert.ok(thinks.length <= CARD_LIMITS.thinks, `a Library edit of it saves: ${thinks.length} characters`);
    assert.equal(teamStore().find("bughunters")?.persona, thinks, "its persona is its words alone: no style, no check");
  });

  test("one fixed list for a hunt and a check, which the page's parser reads either way", () => {
    const f = findingsFormat();
    assert.match(f, /^End your result with a line that says only "Findings:"[\s\S]*a hunt's ranked by harm, the worst first, as Found, Plausible, Dismissed and Not covered; a check's each claim once, as Confirmed, Plausible or Dismissed:/);
    for (const kind of ["Found", "Confirmed", "Plausible", "Dismissed", "Not covered"]) assert.match(f, new RegExp(`\\n- ${kind} \\| `), kind);
    const hunt = findingsOf("Subject: one found\n\nFindings:\n- Found | A null read | parse.js:3 | the Hunter found it; the Checker read the line\n- Plausible | Off by one | lex.js:9 | no test shows it\n- Dismissed | A double send | send.js:8 | the guard holds\n- Not covered | the CLI | - | no slice");
    assert.deepEqual(hunt?.counts, { found: 1, confirmed: 0, plausible: 1, uncovered: 1, dismissed: 1 });
    assert.deepEqual(hunt?.items[0], { kind: "found", title: "A null read", where: "parse.js:3", note: "the Hunter found it; the Checker read the line" });
    const check = findingsOf("Subject: 1 of 2 holds\n\nFindings:\n- Confirmed | The parser is built | parse.js:3 | read it\n- Dismissed | Tests pass | - | none ran");
    assert.deepEqual(check?.counts, { found: 0, confirmed: 1, plausible: 0, uncovered: 0, dismissed: 1 });
  });
});

// (fails before: yes — Verify… and Then verify fired the Verifier, and a Verifier's result alone was never checked)
describe("Verify… and Then verify fire BugHunters", () => {
  test("its key is the page's too; its words carry the result as the claims to check; a BugHunters result is offered no Verify, any other is", () => {
    assert.equal(beside.BUGHUNTERS, "bughunters");
    assert.equal(pageBeside.BUGHUNTERS, beside.BUGHUNTERS, "the page's key is the server's");
    assert.match(verifyAsk({ name: "Builders", ask: "build the parser", result: "Built: parse.js" }), /^Check what the Builders team found \(it was asked: "build the parser"\) against the code as it is now\.\nFor each claim: Confirmed/);
    /** A team's row, its result in, as the server says whether it comes checked. @param {string} key */
    const row = (key) => /** @type {any} */ ({ id: "t1", main: "c1", team: { key, name: key }, state: "done", checked: key === "bughunters", result: { n: 1, text: "x", more: false, at: 1 }, notified: null, verifiedBy: null });
    assert.equal(cardActions(row("bughunters")).verify, false, "BugHunters' own result: no Verify");
    assert.equal(cardActions(row("builders")).verify, true);
    assert.deepEqual([SWITCH_WORDS.verify.label, seenWords({ ...row("builders"), verifiedBy: "t2" })], ["Check it with BugHunters first", "BugHunters checks it first"]);
    const src = readFileSync("src/app/teams-beside.js", "utf8");
    assert.match(src, /if \(b\.verify && !resultChecked\(b\.team\)\) \{/, "Then verify checks none that comes checked");
    assert.match(src, /return fire\(main, \{ team: BUGHUNTERS, ask: words,/);
  });

  test("the team tool says where a result goes: BugHunters checks it", async () => {
    const at = /** @type {any} */ ({ chain: "c1", fire: async () => ({ team: { key: "builders", name: "Builders" }, verify: true, notify: false }), list: () => [], teams: () => [] });
    const r = await besideCall({ action: "send", team: "builders", ask: "build it" }, at);
    assert.match(/** @type {any} */ (r).text, /When it ends, BugHunters checks its result; the check waits for the person, who may send it to you\./);
  });
});

// (fails before: yes — the main agent started the Bug Hunter and the Verifier by itself where nobody chose)
describe("the teams a chat's agent may start", () => {
  test("BugHunters where nobody chose; a list naming only gone teams is that default again; one beside another team drops it", () => {
    assert.deepEqual([...AGENT_TEAMS], ["bughunters"]);
    assert.deepEqual(/** @type {any} */ (CONFIG_SCHEMA).agentLoop.subagents.teams.default, ["bughunters"]);
    assert.deepEqual(agentTeamsOf(null), ["bughunters"]);
    const teams = teamStore();
    const known = (/** @type {string} */ k) => teams.find(k)?.key ?? null;
    assert.deepEqual(agentTeamsOf({ subagents: { teams: ["bug-hunter", "verifier"] } }, known), ["bughunters"]);
    assert.deepEqual(agentTeamsOf({ subagents: { teams: ["verifier", "builders"] } }, known), ["builders"]);
    assert.deepEqual(agentTeamsOf({ subagents: { teams: [] } }, known), [], "none chosen stays none");
  });
});

// (fails before: yes — the tool's examples and its words named the Bug Hunter and the Verifier)
describe("the main agent's team tool", () => {
  // Since the tool plan its words carry no example calls: send names its fields, and the team is bughunters by its words.
  test("it names BugHunters for a hunt and for a check of claims, and as the team it starts by itself", () => {
    const d = String(BESIDE_TOOL.description);
    assert.ok(d.includes("a bug hunt over recent work, or a check of claims against the code (bughunters finds bugs and checks claims, and fixes none)"), d);
    assert.ok(d.includes("send starts one (team, ask): say what to do, not what was done"));
    assert.ok(d.includes("You send only the teams the person lets this chat's agent send (BugHunters, unless they chose others in the chat's settings)"));
    assert.ok(d.includes("note puts one line before the lead of a team at work"));
    assert.equal(/** @type {any} */ (BESIDE_TOOL.input_schema.properties).team.description, "send, note: the team, by its key or its name; status lists them (bughunters, builders, …).");
    assert.doesNotMatch(JSON.stringify(BESIDE_TOOL), /bug-hunter|verifier|Bug Hunter|Verifier/);
  });
});

// (fails before: yes — a key or a Lead that no longer ships was "no team" or "no agent", with no word of what does its work)
describe("what a person kept that names a gone team", () => {
  test("in one place: a gone key says which team does its work, and the Verifier's Lead what to do", () => {
    assert.deepEqual([foldedTeamWords("bug-hunter"), foldedTeamWords("@Verifier"), foldedLeadWords("verifylead"), foldedTeamWords("bughunters"), foldedLeadWords("huntlead")], [BUG_HUNTER, VERIFIER, VERIFY_LEAD, null, null]);
  });

  test("a session's engine.team: its turn's problem and the New Task board say it", () => {
    const cfg = { agentLoop: { enabled: true }, experimental: { teams: true } };
    const teams = teamStore();
    assert.equal(engineProblem({ mode: "team", team: "verifier" }, cfg, teams), `engine.team names \`verifier\`, which is no team — ${VERIFIER} (/team lists them)`);
    assert.equal(engineProblem({ mode: "team", team: "bug-hunter" }, cfg, teams), `engine.team names \`bug-hunter\`, which is no team — ${BUG_HUNTER} (/team lists them)`);
    assert.equal(engineProblem({ mode: "team", team: "bughunters" }, cfg, teams), null);
    const full = { ...defaultConfig(), experimental: { ...defaultConfig().experimental, teams: true }, agentLoop: { ...defaultConfig().agentLoop, enabled: true }, upstreams: [{ id: "u", name: "u", type: "anthropic", baseUrl: "http://127.0.0.1:9", enabled: true }], routes: [{ match: "m-*", upstream: "u", upstreamModel: "{model}", enabled: true }] };
    const draft = startAnatomy({ cfg: full, eff: { model: { name: "m-1" }, engine: { mode: "team", team: "verifier" } }, cwd: folder(), projectId: "p1", teams });
    assert.equal(draft.who.problem, `it names the team "verifier", and there is no such team — ${VERIFIER}`);
  });

  test("teams.json's shipped entries for the two are skipped and named in the log; a team of yours led by the Verifier's Lead is held, saying so", () => {
    const dir = folder();
    writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: { mine: { name: "Mine", lead: "verifylead", members: [{ tag: "reviewer", line: "" }] } }, shipped: { "bug-hunter": { models: ["m-cheap"] }, verifier: { leadModels: ["m-strong"] }, bughunters: { most: 3 } } }));
    /** @type {string[]} */
    const logs = [];
    const store = teamStore({ dataDir: dir, log: (/** @type {string} */ _l, /** @type {string} */ m) => logs.push(m) });
    // (fails before: yes — the owner's word of 11-05) A most set on it before says nothing now: read as nothing, and the
    // entry not skipped for it.
    assert.equal("most" in (store.find("bughunters") || {}), false, "an old most is dropped as it is read");
    assert.deepEqual([store.find("bughunters")?.models, store.find("bughunters")?.leadModels], [[], []], "nothing of the two is read as BugHunters");
    assert.ok(logs.join("\n").includes(`skipped: shipped bug-hunter (${BUG_HUNTER}), shipped verifier (${VERIFIER})`), logs.join("\n"));
    assert.deepEqual(store.held(), [{ key: "mine", name: "Mine", why: VERIFY_LEAD }]);
    assert.equal(store.heldTeam("mine")?.leadGone, VERIFY_LEAD, "its editor says it where its lead stood");
  });

  test("a saved flow's team box for either loads as kept, and needs a team in the same words; the flow that ships hunts with BugHunters", () => {
    const dir = folder();
    const steps = [{ why: "First", boxes: [{ id: "build", kind: "team", agent: "builders", words: "Build it", needs: [] }] }, { why: "Then", boxes: [{ id: "hunt", kind: "team", agent: "bug-hunter", words: "Hunt it", needs: ["build"] }, { id: "check", kind: "team", agent: "verifier", words: "Check it", needs: ["build"] }] }];
    writeFileSync(join(dir, "flows-saved.json"), JSON.stringify({ version: 1, flows: { old: { name: "Old", steps, at: 1 } } }));
    const kept = /** @type {any} */ (createSavedFlows({ dataDir: dir }).find("old"));
    assert.deepEqual(kept.steps[1].boxes.map((/** @type {any} */ b) => b.agent), ["bug-hunter", "verifier"], "kept as it was saved");
    const teams = teamStore().list().map((t) => ({ key: t.key, name: t.name, readOnly: t.readOnly }));
    const cards = teamStore().cards.list().filter((c) => !c.partOf).map((c) => ({ tag: c.tag, name: c.name }));
    const roster = { cards, teams };
    const flow = flowOf({ title: kept.name, goal: "Ship it", steps: kept.steps }, roster, { id: "f1", chainId: "c1", at: 1 });
    assert.equal(checkFlow(flow, roster), `the box for "bug-hunter" needs a team — ${BUG_HUNTER}`);
    const shipped = /** @type {any} */ (createSavedFlows({ dataDir: null }).list().find((f) => f.shipped));
    assert.ok(JSON.stringify(shipped.steps).includes('"id":"hunt","kind":"team","agent":"bughunters"'), JSON.stringify(shipped.steps));
  });

  // (fails before: no — a guard: a kept team chat and a kept worker read as they were kept already; nothing of either is
  // converted, and so it stays)
  test("a team chat and a worker kept from either load as kept, their threads readable; a fire of either says which team does its work", async () => {
    const chain = { id: "t1", kind: "team", model: "m-1", title: "Verifier on the parser", meta: { beside: { team: "verifier", name: "Verifier", ask: "Check the parser", at: 5, firedBy: "you" } } };
    const beside = createTeamsBeside(/** @type {any} */ ({
      archive: () => ({ getChain: (/** @type {string} */ id) => (id === "t1" ? chain : id === "main" ? { id: "main", kind: "chat", meta: {} } : null), mainOf: () => "main", besideOf: () => [chain.id], chainHead: () => chain }),
      sessions: { besideFacts: () => ({ busy: false, asking: null, last: { text: "Confirmed: parse.js:3", final: true, n: 1, endedAt: 9 } }), settingsOf: () => ({ effective: { engine: { mode: "team", team: "verifier" } } }) },
      teams: teamStore(),
      registry: () => ({ list: () => [] }),
      postTurn: async () => ({ status: 200, body: {} }),
      reach: { busy: () => false, post: async () => ({ status: 200, body: {} }), steer: () => ({ ok: true }) },
      remove: async () => {},
      events: { publish: () => {} },
    }));
    const row = /** @type {any} */ (beside.row("t1"));
    assert.deepEqual([row.team, row.result?.text, row.state], [{ key: "verifier", name: "Verifier" }, "Confirmed: parse.js:3", "done"]);
    await assert.rejects(() => beside.fire("main", { team: "verifier", ask: "x" }), { status: 404, message: `no team answers to "verifier": ${VERIFIER}` });
    await assert.rejects(() => beside.fire("main", { team: "bug-hunter", ask: "x" }), { status: 404, message: `no team answers to "bug-hunter": ${BUG_HUNTER}` });
    // A Hunter of the Bug Hunter's, kept from before: it loads after a restart, its team as it was and its thread as it ran.
    const root = folder();
    /** @type {any[]} */
    const kept = [];
    /** @param {any} [context] */
    const registryOf = (context = {}) => {
      /** @type {ReturnType<typeof createSubagentRegistry>} */
      const registry = createSubagentRegistry({
        config: () => ({ agentLoop: {} }),
        log: () => {},
        events: { publish: () => {} },
        runs: null,
        now: Date.now,
        context: {
          settings: () => ({ subagents: { pool: [{ model: "", seats: 4 }] }, loop: { permissions: "read-only" } }),
          session: () => ({ cwd: root, model: "m", projectId: "p1" }),
          view: async () => ({ text: "", turns: 1 }),
          brief: async () => null,
          modelProblem: () => null,
          mark: (/** @type {string} */ _c, /** @type {any} */ m) => ({ ...m, afterTurn: 1 }),
          saveThread: (/** @type {string} */ _c, /** @type {any} */ t) => void kept.push(structuredClone(t)),
          ...context,
        },
        call: async ({ body, headers = {} }) => {
          const id = headers["x-filament-subagent"];
          registry.attach(id, "run-1");
          registry.finish(id, { status: "done", error: null, report: "Found: parse.js:3.", convo: [...body.messages, { role: "assistant", content: [{ type: "text", text: "Found: parse.js:3." }] }], rounds: 1, toolCalls: 0, tokensIn: 10, tokensOut: 5, spentUsd: 0, roundIds: ["run-1"] });
          return { ok: true, status: 200, json: { content: [{ type: "text", text: "Found: parse.js:3." }], usage: { input_tokens: 10, output_tokens: 5 } }, id: "run-1", upstream: "m", retryAfter: null, shouldRetry: null };
        },
      });
      return registry;
    };
    const first = registryOf();
    const r = /** @type {any} */ (first.launch({ origin: "owner", chainId: "c1", prompt: "hunt the parser", description: "Hunt the parser", worker: "reviewer", may: "read", background: true }));
    assert.ok(r.ok, JSON.stringify(r));
    await r.done;
    const thread = { ...structuredClone(kept.at(-1)), team: { key: "bug-hunter", name: "Bug Hunter", role: "hunter", card: "reviewer", seat: "Hunter", place: "reviewer", words: HUNTER_LINE } };
    const again = registryOf({ loadThreads: () => [thread] });
    const back = /** @type {any} */ (again.list("c1").find((s) => s.id === r.id));
    assert.deepEqual([back?.team?.key, back?.team?.name, back?.status], ["bug-hunter", "Bug Hunter", "done"], "it loads as it was kept");
    assert.equal(again.detail(r.id)?.exchanges[0].report, "Found: parse.js:3.", "its thread reads as it was");
  });
});

// (fails before: yes — the Library's switch named the Verifier, the shipped teams' looks the two gone keys, and BugHunters
// was offered a check of its own result)
describe("the page", () => {
  test("BugHunters wears the bug and the pink; a gone key, people", () => {
    assert.deepEqual([teamIcon("bughunters"), teamTone("bughunters")], ["bug", "pink"]);
    assert.deepEqual([teamIcon("bug-hunter"), teamTone("verifier")], ["users", "purple"]);
  });

  test("the Library: Builders' editor says BugHunters checks it first; BugHunters' own offers no check of itself", async () => {
    const p = await openAgents({});
    /** The switches of the open editor's Your agent part. */
    const switches = () => all(all(p.editor(), (x) => x.tag === "section" && x.attrs?.["aria-label"] === "Your agent")[0], (x) => x.attrs?.role === "switch").map((x) => x.attrs["aria-label"]);
    /** @type {any} */ (btn(p.team("builders"), "Edit")).dispatch("click");
    assert.deepEqual(switches(), ["Your agent may use it", "Give your agent the result when it finishes", "Have BugHunters check it first"]);
    assert.ok(every(p.editor(), "ed-row-label").map(textOf).includes("BugHunters checks it first"));
    p.dismiss();
    /** @type {any} */ (btn(p.team("bughunters"), "Edit")).dispatch("click");
    assert.deepEqual(switches(), ["Your agent may use it", "Give your agent the result when it finishes"]);
    assert.ok(!every(p.editor(), "ed-row-label").map(textOf).includes("BugHunters checks it first"));
    assert.equal(all(p.editor(), (x) => x.attrs?.["aria-label"] === "Your agent may use it")[0]?.attrs["aria-checked"], "true", "your agent may use it where nobody chose");
  });
});

// ---------------------------------------------------------------------------------------------------
// The Plan's hunt from a graph node: a Reviewer runs, and its words say so
// ---------------------------------------------------------------------------------------------------

const T0 = 1_000_000;
const NOW = T0 + 320_700;
/** A graph whose t1 is done and t2 runs. */
function graphNow() {
  /** @type {any} */
  let g = null;
  for (const [input, at] of /** @type {[any, number][]} */ ([
    [{ action: "add", goal: "Ship the parser", tasks: [{ id: "t1", name: "Lexer", needs: [], writes: ["src/lex.js"] }, { id: "t2", name: "Parser", needs: ["t1"], writes: ["src/parse.js"] }] }, T0],
    [{ action: "start", id: "t1" }, T0 + 60_000],
    [{ action: "done", id: "t1", summary: "Lexer with 40 tests", evidence: "npm test: 40 passed" }, T0 + 180_000],
    [{ action: "start", id: "t2" }, T0 + 200_700],
  ])) {
    const r = /** @type {any} */ (applyTasks(g, input, /** @type {any} */ ({ at })));
    assert.ok(r.ok, r.error);
    g = r.graph;
  }
  return /** @type {any} */ (graphView(g));
}
/** @param {any} n @param {string} cls */
const byClass = (n, cls) => all(n, (x) => String(x.attrs?.class || "").split(/\s+/).includes(cls));

// (fails before: yes — the hunt runs a Reviewer, and its box, its card and its chip said a Hunter, a card that no longer ships)
describe("the Plan's hunt names what runs", () => {
  test("its launch is a Reviewer's; its box, its card, its button and its words say a Reviewer", () => {
    assert.match(readFileSync("src/ui/harness/app.js", "utf8"), /subagentRoutes\(String\(chat\.chainId\)\)\.spawn\(\{ prompt: brief\.prompt, description: brief\.description, as: "reviewer", deliver: true, hunts: String\(t\.id\)/, "a Reviewer is launched");
    const fired = [{ agent: "sa_1", name: "Reviewer", model: "glm-5.3", at: NOW - 120_000, ended: "finished" }, { agent: "sa_2", name: "Reviewer", model: "glm-5.3", at: NOW - 30_000, running: true }];
    const hunt = { picker: fakeH("button", { class: "model-chip" }), busy: () => false, started: (/** @type {string} */ id) => (id === "t1" ? fired : []), onHunt: () => {}, onMenu: () => {} };
    const el = drawGraph(graphNow(), { h: fakeH, now: NOW, chosen: "t1", hunt }).el;
    const box = all(el, (x) => x.attrs?.["data-id"] === "t1")[0];
    assert.match(box.attrs.title, /\n2 Reviewers sent to hunt bugs in t1, 1 still running(\n|$)/);
    assert.match(box.attrs["aria-label"], /; 2 Reviewers sent to hunt bugs in t1, 1 still running$/);
    // Its hunt box (the redesign of 11-05): a strip a Reviewer, in the words of what runs.
    assert.deepEqual(byClass(el, "tg-hunt-strip-t").map(textOf).map((s) => s.replace(/ · [^·]+ · just now$/, " · …")), ["Reviewer's hunt · report sent to the agent", "Reviewer hunting · …"]);
    const card = byClass(el, "tg-hunt")[0];
    assert.equal(textOf(byClass(card, "tg-hunt-busy")[0]), "A Reviewer is still hunting bugs in what t1 did — Hunt again starts another beside it.");
    assert.match(textOf(byClass(card, "tg-card-quiet")[0]), /^A Reviewer reads what t1 did and reports the bugs it can show, each with its file and line; it changes nothing\. Its findings go to /);
    assert.match(huntWhat("t1", "you"), /^A Reviewer reads what t1 did/);
    assert.equal(all(card, (x) => x.tag === "button" && x.attrs?.class === "tg-act is-primary")[0].attrs.title, "Start a Reviewer hunting bugs in what t1 did");
    assert.equal(taskGraph.huntGoTitle?.("t3"), "Start a Reviewer hunting bugs in what t3 did");
    assert.equal(huntBusyWords("t1", [fired[1], { ...fired[1], agent: "sa_3" }]), "2 Reviewers are still hunting bugs in what t1 did — Hunt again starts another beside them.");
    assert.equal(textOf(byClass(card, "tg-hunt-line")[0]).startsWith("Reviewer on"), true);
  });

  test("its model chip says the Reviewer's", async () => {
    /** @type {any[]} */
    const chips = [];
    const modelSelect = /** @type {any} */ ((/** @type {any} */ given) => {
      const chip = { el: fakeH("button", { class: "model-chip" }), given, setModels() {}, setFamilies() {}, setAccounts() {}, set() {} };
      chips.push(chip);
      return chip;
    });
    const chat = { id: "plan", chainId: "chain-plan", title: "Hunt", turns: [], live: null, view: { settings: {} } };
    chooseTask(chat, "t1");
    const v = renderPlan(fakeH("div"), { chat, hunt: { start: async () => null, models: () => [], hunters: () => [] }, openAgent: () => {} }, { h: fakeH, api: async () => ({ inForce: { graph: graphNow(), goal: null } }), now: () => NOW, modelSelect });
    await new Promise((r) => setImmediate(r));
    v.paint();
    const chip = chips[0];
    assert.ok(chip, "the card's chip");
    assert.deepEqual([chip.given.blank, chip.given.defaultDesc, chip.el.attrs["aria-label"]], ["The Reviewer's model", "This chat's rows for the Reviewer, else its own models, else this chat's list, else the main agent's model", "The hunting Reviewer runs on"]);
  });
});

// ---------------------------------------------------------------------------------------------------
// The review of 11-03: what a page, the agent and the server say of a check agree, and a name's possessive reads well
// ---------------------------------------------------------------------------------------------------

/** A team beside as the list answers it, done with its result in. @param {any} [o] @returns {any} */
const besideRow = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "builders", name: "Builders" }, ask: "build the parser", firedBy: "you", at: NOW - 60_000, model: "m-1", title: "",
  state: "done", workers: { running: 0, waiting: 0, total: 1 }, verify: false, notify: false, of: null, verifiedBy: null,
  result: { n: 1, text: "Built.", more: false, at: NOW }, findings: null, notified: null, cut: false, readOnly: false, ...o,
});
/** A runner of teams beside over kept chats `t1` (a team's) and `main`, the team's chat as `beside` says it. @param {any} beside */
const keptBeside = (beside) => {
  const chain = { id: "t1", kind: "team", model: "m-1", title: "Kept", meta: { beside: { ask: "x", at: 5, firedBy: "you", ...beside } } };
  return createTeamsBeside(/** @type {any} */ ({
    archive: () => ({ getChain: (/** @type {string} */ id) => (id === "t1" ? chain : id === "main" ? { id: "main", kind: "chat", meta: {} } : null), mainOf: (/** @type {string} */ id) => (id === "t1" ? "main" : null), besideOf: () => [chain.id], chainHead: () => chain, mergeMeta: () => {} }),
    sessions: { besideFacts: () => ({ busy: false, asking: null, last: { text: "Confirmed: parse.js:3", final: true, n: 1, endedAt: 9 } }), settingsOf: () => ({ effective: {} }) },
    teams: teamStore(),
    registry: () => ({ list: () => [] }),
    postTurn: async () => ({ status: 200, body: {} }),
    reach: { busy: () => false, post: async () => ({ status: 200, body: {} }), steer: () => ({ ok: true }) },
    remove: async () => {},
    events: { publish: () => {} },
  }));
};

describe("the review of 11-03", () => {
  // (fails before: yes — a team's own fired.verify on BugHunters made its pod say BugHunters checks its result, which no
  // fire does)
  test("1. BugHunters' pod in the Library promises no check of its own result, whatever its switch says; another team's does", async () => {
    const dir = folder();
    writeFileSync(join(dir, "teams.json"), JSON.stringify({ version: 2, teams: {}, shipped: { bughunters: { fired: { notify: false, verify: true } }, builders: { fired: { notify: false, verify: true } } } }));
    const p = await openAgents({ dataDir: dir });
    const chipsOf = (/** @type {string} */ key) => every(p.team(key), "lib-pod-chip").map(textOf);
    assert.ok(!chipsOf("bughunters").some((c) => c.includes("BugHunters checks")), chipsOf("bughunters").join(" | "));
    assert.ok(chipsOf("builders").includes("Sent by your agent: BugHunters checks its result, then it waits for you"), chipsOf("builders").join(" | "));
  });

  // (fails before: yes — a result Verify… sent to BugHunters said "waits for you" on its row, "BugHunters checks it" on
  // its card)
  test("2. a row of the Agents tab says a result BugHunters checks as its card's row does", () => {
    const [x] = teamItems({ leading: null, live: false, paused: false, rows: [], beside: [besideRow({ verifiedBy: "t2" })], self: null, boards: () => [], now: NOW });
    assert.equal(x.fact, "its result is in · BugHunters checks it");
    assert.equal(pageBeside.CHECKING_WORDS, "BugHunters checks it", "the card's row's words, one constant");
    const [waits] = teamItems({ leading: null, live: false, paused: false, rows: [], beside: [besideRow()], self: null, boards: () => [], now: NOW });
    assert.equal(waits.fact, "its result is in · waits for you");
  });

  // (fails before: yes — the board read the raw saved list: a saved ["bug-hunter"] said "bug-hunter team")
  test("3. the Start board names the teams the server holds: a gone key is not among them", () => {
    const io = {
      held: () => ({}), set: () => {}, unset: () => {}, permission: () => "edit", setPermission: () => {}, models: () => [{ id: "m-1" }], mainModel: () => "m-1",
      agents: () => ({ cards: [], asks: [] }), chat: () => ({}), presets: () => ({}), choosePreset: () => {}, reset: () => {}, saveAs: () => {}, manageAgents: () => {},
      teamNames: (/** @type {unknown} */ keys) => (Array.isArray(keys) ? keys.map((k) => (k === "bughunters" ? "BugHunters" : String(k))) : []),
    };
    const b = createStartBoard(/** @type {any} */ (io), { h: /** @type {any} */ (fakeH), modelSelect: /** @type {any} */ (() => ({ el: fakeH("span", {}), set() {}, setModels() {} })), poolChip: /** @type {any} */ (poolChips().make), menu: /** @type {any} */ (() => {}) });
    b.paint({
      cwd: "H:/proj", projectId: null, preset: null, presetWhy: null, flat: { "loop.tools": null, "subagents.ask": [], "subagents.teams": ["bug-hunter"] }, sources: {}, agentTeams: ["bughunters"],
      engine: { kind: "loop", model: "m-1" }, window: { tokens: 200000, source: "price card" }, line: { percent: 85, tokens: 170000 },
      parts: [{ id: "prompt", tokens: 3000 }], instructions: { files: [], missing: [], sessionChars: 0 },
      skills: { enabled: false, folders: [], list: [], triggered: [], problems: [] }, tools: { offered: ["read", "agent"], off: [], memory: 0, recall: false, mcp: [] },
      memory: { global: false, autopilot: false, on: false, ready: false, briefing: 0, recall: 0, tools: 0, knows: null },
    });
    const row = /** @type {any} */ (b.el).querySelector(".may-ask");
    assert.ok(row, "the row");
    assert.match(textOf(row), /BugHunters team/);
    assert.doesNotMatch(textOf(row), /bug-hunter/);
  });

  // (fails before: yes — a kept Verifier's result was offered Verify…, a check of a check, and the server took it)
  test("4. a kept result of the gone Verifier comes checked, by the one place that knows the gone keys: no Verify… on the page or the server", async () => {
    assert.deepEqual(["bughunters", "verifier", "Verifier", "bug-hunter", "builders"].map((k) => foldedTeams.resultChecked?.(k)), [true, true, true, false, false]);
    const kept = keptBeside({ team: "verifier", name: "Verifier" });
    const row = /** @type {any} */ (kept.row("t1"));
    assert.deepEqual([row.team.key, row.checked, cardActions(row).verify], ["verifier", true, false]);
    const hunt = /** @type {any} */ (keptBeside({ team: "bug-hunter", name: "Bug Hunter" }).row("t1"));
    assert.deepEqual([hunt.checked, cardActions(hunt).verify], [false, true], "a kept Bug Hunter's hunt is checked as any team's result is");
    const src = readFileSync("src/http/admin/beside.js", "utf8");
    assert.match(src, /if \(row\.checked\) return sendJson\(r\.res, 409, \{ error: checkedByNone\(row\.team\.name\) \}\);/, "the server's Verify… asks the row");
    assert.equal(beside.checkedByNone?.("Verifier"), "Verifier's result is a check already: nothing checks it again");
  });

  // (fails before: yes — a fire that named BugHunters' own result as the one to check started a check of it)
  test("5. a fire whose result to check comes checked is refused, as Verify… is", async () => {
    await assert.rejects(() => keptBeside({ team: "bughunters", name: "BugHunters" }).fire("main", { team: "bughunters", ask: "Check it", of: "t1" }), { status: 409, message: "BugHunters' result is a check already: nothing checks it again" });
    await assert.rejects(() => keptBeside({ team: "verifier", name: "Verifier" }).fire("main", { team: "bughunters", ask: "Check it", of: "t1" }), { status: 409, message: "Verifier's result is a check already: nothing checks it again" });
  });

  // (fails before: yes — only the key was known: "Bug Hunter" as a person writes it got no words)
  test("6. a gone team named as a person writes it finds its words, as its key does", async () => {
    for (const name of ["Bug Hunter", "bug hunter", "@Bug-Hunter"]) assert.equal(foldedTeamWords(name), BUG_HUNTER, name);
    assert.equal(foldedTeamWords("10x Engineer"), "Builders does 10x Engineer's work: pick Builders");
    await assert.rejects(() => keptBeside({ team: "builders", name: "Builders" }).fire("main", { team: "Bug Hunter", ask: "x" }), { status: 404, message: `no team answers to "Bug Hunter": ${BUG_HUNTER}` });
  });

  // (fails before: yes — a copy of the old Bug Hunter, its Hunter alone, was told to send its findings to Checkers it has
  // not got)
  test("7. its lead's words say what to do with no Checker in the team: check each yourself, reading the code", () => {
    const thinks = String(SHIPPED_CARDS.huntlead.thinks);
    assert.ok(thinks.includes("— with no Checker in your team, read the code and check each yourself."), "a hunt");
    assert.ok(thinks.includes("check a short one yourself, and every claim where your team has no Checker."), "a check");
    // Under the Bug Hunter's and the Verifier's, with a hunt's range and its merged findings said (the plan's p6).
    assert.ok(thinks.length < 2800, `${thinks.length} characters`);
    const store = teamStore();
    const copy = store.create({ name: "Old hunt", lead: "huntlead", members: [{ tag: "reviewer", name: "Hunter", line: HUNTER_LINE }] });
    assert.ok(copy.persona.includes("with no Checker in your team"), "a team of yours led by it is told so");
  });

  // (fails before: yes — "BugHunters's result", "the Builders's lead")
  test("8. a name's possessive: an apostrophe alone after an s, the page's the same as the server's, wherever a team's is said", async () => {
    const samples = ["BugHunters", "Builders", "Methodical", "Bug Hunter", "My crew", "Ops"];
    assert.deepEqual(samples.map((n) => text.possessive?.(n)), ["BugHunters'", "Builders'", "Methodical's", "Bug Hunter's", "My crew's", "Ops'"]);
    assert.deepEqual(samples.map((n) => labels.possessive?.(n)), samples.map((n) => text.possessive?.(n)), "the page's copy is the server's");
    assert.equal(resultAttachment({ id: "t1", n: 1, team: { key: "bughunters", name: "BugHunters" }, ask: "x", firedBy: "you", at: NOW, text: "x", message: "m", findings: null }, "c1").name, "BugHunters' result");
    assert.equal(textOf(engineTag({ kind: "team", team: "builders", name: "Builders" }, fakeH)), "Builders' lead");
    assert.deepEqual(noteFor([besideRow({ state: "working" })], "BugHunters", "x", () => false), { ok: false, error: "the BugHunters' lead has ended its turn, and its workers finish: a note reaches a lead only while its turn runs" });
    const note = await besideCall({ action: "note", team: "bughunters", note: "Skip it" }, /** @type {any} */ ({ chain: "c1", note: async () => ({ team: { key: "bughunters", name: "BugHunters" } }), list: () => [], teams: () => [] }));
    assert.equal(/** @type {any} */ (note).text, "Your note went to the BugHunters' lead: it reads it at its next step. Go on with your work.");
    // Every place the review named builds a team's possessive with the helper, none as `${name}'s`.
    const places = [
      "src/ui/harness/conversation/beside-marks.js", "src/ui/harness/lib/beside.js", "src/ui/harness/panes/pane-host.js", "src/ui/harness/views/brief.js", "src/ui/harness/views/side.js",
      "src/ui/harness/views/teams-home.js", "src/ui/harness/widgets/hand.js", "src/ui/harness/conversation/team-turns.js", "src/ui/harness/lib/team.js", "src/ui/harness/app.js",
      "src/ui/harness/space/space.js", "src/ui/harness/composer/composer.js", "src/app/agent/beside-tool.js", "src/core/beside.js", "src/app/agent/turn.js", "src/ui/harness/views/beside.js",
    ];
    const built = places.flatMap((f) => readFileSync(f, "utf8").split("\n").filter((l) => /\$\{[^}]*(name|team|checks|leadName)[^}]*\}'s (lead|result|Brief|builder|chat)\b/i.test(l)).map((l) => `${f}: ${l.trim().slice(0, 90)}`));
    assert.deepEqual(built, []);
  });
});

// ---------------------------------------------------------------------------------------------------
// Through a throwaway Filament: the main agent fires BugHunters, a hunt and a check, and old settings fall back
// ---------------------------------------------------------------------------------------------------

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** The words of the newest message's text blocks. @param {any} body */
const lastText = (body) => {
  const c = body?.messages?.at(-1)?.content;
  return typeof c === "string" ? c : (Array.isArray(c) ? c : []).filter((b) => b?.type === "text").map((b) => b.text).join("\n");
};
/** BugHunters' hunt, as its lead ends it. */
const HUNT_RESULT = "Subject: one bug in the parser, confirmed\n\nFound: parse.js:3 reads a field of null.\n\nFindings:\n- Found | A null read | parse.js:3 | the Hunter found it; the Checker read the line\n- Plausible | Off by one | lex.js:9 | no test shows it\n- Dismissed | A double send | send.js:8 | the guard holds\n- Not covered | the CLI | - | no slice";

describe("BugHunters through a throwaway Filament", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let sid;
  /** Each lead's system prompt and what its turn held, newest last. @type {{ system: string, all: string }[]} */
  const leads = [];
  /** Each worker's opening, newest last. @type {string[]} */
  const workers = [];
  /** What each of the team tool's calls answered, newest last. @type {string[]} */
  const answers = [];
  before(async () => {
    root = folder();
    const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
    git("init", "-q");
    git("config", "core.autocrlf", "false");
    writeFileSync(join(root, "parse.js"), "export const parse = (x) => x.field;\n");
    git("add", "-A");
    git("commit", "-qm", "init");
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      const b = call.body || {};
      if (!b.tools?.length) return anthropicReply("A title", { model: "m-1" });
      const system = sysOf(b);
      const now = JSON.stringify(b.messages || []);
      const say = (/** @type {string} */ text) => anthropicReply(text, { model: "m-1" });
      const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id, name, input }] });
      if (system.includes(String(PROMPT.workerRole))) {
        // A worker's team's words for its seat ride in its system prompt.
        workers.push(`${system}\n${now}`);
        if (now.includes("WORKER WRITES")) return now.includes("tu_ww") ? say("Subject: tried\nTried the write.") : use("tu_ww", "write", { path: "worked.txt", content: "written by a worker\n" });
        if (system.includes("Hunt only your slice")) return say("Subject: one bug\nFound: parse.js:3 reads a field of null.");
        return say("Subject: confirmed\nConfirmed: parse.js:3 reads a field of null — the line reads x.field with no guard.");
      }
      if (system.includes(String(PROMPT.leadRole))) {
        leads.push({ system, all: now });
        // A lead that writes a file itself, and one that has its Builder write one.
        if (now.includes("TURN: the lead writes")) return now.includes("tu_lw") ? say("LEAD DONE") : use("tu_lw", "write", { path: "led.txt", content: "written by the lead\n" });
        if (now.includes("TURN: its worker writes")) {
          if (/\[Filament: your builder sa_/i.test(now)) return say("WORKER BACK");
          if (/Launched builder sa_/.test(now)) return use("tu_bw", "wait", { seconds: 60 });
          return use("tu_b", "agent", { role: "builder", description: "Write the file", goal: "WORKER WRITES: worked.txt is there", steps: ["Write worked.txt"], acceptance: "worked.txt is there" });
        }
        if (system.includes("# Your team: Builders")) return say("Subject: the parser is built\nBuilt: parse.js:3 reads the field.");
        if (now.includes("Check what the Builders team found")) return say("Subject: 1 claim confirmed\n\nFindings:\n- Confirmed | The parser reads the field | parse.js:3 | read the line");
        if (/\[Filament: your checker sa_/i.test(now)) return say(HUNT_RESULT);
        if (/Launched checker sa_/.test(now)) return use("tu_wait2", "wait", { seconds: 60 });
        if (/\[Filament: your hunter sa_/i.test(now)) return use("tu_check", "agent", { role: "checker", description: "Check the null read", goal: "know whether parse.js:3 reads a field of null", steps: ["Read parse.js:3"], acceptance: "a verdict with why" });
        if (/Launched hunter sa_/.test(now)) return use("tu_wait1", "wait", { seconds: 60 });
        return use("tu_hunt", "agent", { role: "hunter", description: "Hunt the parser", goal: "find bugs in parse.js", steps: ["Read parse.js"], acceptance: "each finding with file and line" });
      }
      const last = b.messages.at(-1)?.content;
      const results = (Array.isArray(last) ? last : []).filter((/** @type {any} */ x) => x?.type === "tool_result");
      if (results.length) {
        for (const r of results) answers.push(typeof r.content === "string" ? r.content : (r.content || []).map((/** @type {any} */ x) => x.text || "").join(""));
        return say("Fired; going on.");
      }
      const words = lastText(b);
      if (words.includes("a team beside this chat finished")) return say("Noted.");
      if (words.includes("TURN: hunt the parser")) return use("tu_fire", "team", { action: "send", team: "bughunters", ask: "Find bugs in the parser: parse.js." });
      if (words.includes("TURN: hunt it checked")) return use("tu_fire2", "team", { action: "send", team: "bughunters", ask: "Find bugs in the lexer, checked." });
      // On `fire` on purpose: old saved words, the act's name before version 123, still taken (core/beside.js `besideAction`).
      if (words.includes("TURN: fire the verifier")) return use("tu_old", "team", { action: "fire", team: "verifier", ask: "Check the parser." });
      if (words.includes("TURN: the agent writes")) return use("tu_aw", "write", { path: "own.txt", content: "written by the chat's agent\n" });
      return say("SOLO ANSWER");
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, models: ["m-1"] }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
      },
    });
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    sid = String((await r.json()).id);
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
    await removeDirs(shim?.dataDir);
  });

  /** One harness turn of the main chat, answered whole. @param {string} content @param {string} [id] */
  const turn = async (content, id = sid) => {
    const r = await until(async () => {
      const x = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      return x.status === 409 && (await x.clone().json().catch(() => ({}))).holder ? null : x;
    }, "the chat free", { timeoutMs: 20_000 });
    assert.equal(r.status, 200, await r.clone().text());
    const c = (await r.json()).content;
    return typeof c === "string" ? c : (c || []).filter((/** @type {any} */ x) => x?.type === "text").map((/** @type {any} */ x) => x.text).join("");
  };
  const besideList = async () => (await (await shim.api(`/api/sessions/${sid}/beside`)).json()).teams || [];
  /** A team beside, once `ok` holds of it. @param {(t: any) => boolean} ok @param {string} what */
  const rowWhere = (ok, what) => until(async () => (await besideList()).find(ok) || null, what, { timeoutMs: 30_000 });
  /** @param {string} id @param {any} change */
  const settle = async (id, change) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: change });
    assert.equal(r.status, 200, await r.clone().text());
  };
  /** @param {string} id */
  const settingsOf = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`)).json();

  test("the chat's settings say BugHunters is the team its agent may start; an old list of the two gone keys falls back to it", async () => {
    assert.deepEqual((await settingsOf(sid)).engine?.agentTeams, ["bughunters"]);
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const other = String((await r.json()).id);
    await settle(other, { patch: { subagents: { teams: ["bug-hunter", "verifier"] } } });
    assert.deepEqual((await settingsOf(other)).engine?.agentTeams, ["bughunters"]);
    await settle(other, { patch: { subagents: { teams: ["verifier", "builders"] } } });
    assert.deepEqual((await settingsOf(other)).engine?.agentTeams, ["builders"]);
  });

  test("the main agent fires BugHunters by itself: its Hunter hunts, its Checker checks the finding, and its result is Found, Plausible, Dismissed and Not covered", async () => {
    assert.equal(await turn("TURN: hunt the parser"), "Fired; going on.");
    assert.equal(answers.at(-1), "BugHunters started beside this chat. Its result waits for the person, who may send it to you. Go on with your work: do not wait for it.");
    const done = await rowWhere((t) => t.team.key === "bughunters" && t.state === "done", "BugHunters' result");
    assert.deepEqual([done.team.name, done.firedBy, done.readOnly, done.of], ["BugHunters", "agent", true, null]);
    assert.deepEqual(done.findings?.counts, { found: 1, confirmed: 0, plausible: 1, uncovered: 1, dismissed: 1 });
    assert.ok(done.result.text.startsWith("Subject: one bug in the parser, confirmed"));
    // Its lead read its words; its Hunter hunted first, its Checker after, on the Hunter's finding.
    const lead = leads.find((l) => l.all.includes("Find bugs in the parser: parse.js."));
    assert.ok(lead?.system.includes(`# Your team: BugHunters\n${SHIPPED_CARDS.huntlead.thinks}`), "the lead's words");
    const hunter = workers.findIndex((w) => w.includes("Hunt only your slice"));
    const checker = workers.findIndex((w) => w.includes("Check each claim you were given"));
    assert.ok(hunter >= 0 && checker > hunter, `the Hunter (${hunter}), then the Checker (${checker})`);
    // Its own result is checked by none.
    const v = await shim.api(`/api/sessions/${sid}/beside/${done.id}/verify`);
    assert.deepEqual([v.status, (await v.json()).error], [409, "BugHunters' result is a check already: nothing checks it again"]);
    assert.equal(beside.checkedByNone?.("BugHunters"), "BugHunters' result is a check already: nothing checks it again");
  });

  test("Verify… on a Builders result is BugHunters' with the claims; Then verify fires BugHunters on it by itself", async () => {
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "builders", ask: "build the parser", model: "m-1", verify: true } });
    assert.equal(r.status, 200, await r.clone().text());
    const built = (await r.json()).team;
    const check = await rowWhere((t) => t.of === built.id && t.state === "done", "BugHunters' check");
    assert.deepEqual([check.team.key, check.team.name, check.findings?.counts.confirmed], ["bughunters", "BugHunters", 1]);
    assert.equal((await besideList()).find((/** @type {any} */ t) => t.id === built.id)?.verifiedBy, check.id);
    assert.ok(leads.some((l) => l.system.includes("# Your team: BugHunters") && l.all.includes('Check what the Builders team found (it was asked: \\"build the parser\\")')), "its lead was handed the claims");
    const v = await (await shim.api(`/api/sessions/${sid}/beside/${built.id}/verify`)).json();
    assert.equal(v.team, "bughunters");
    assert.match(v.ask, /^Check what the Builders team found \(it was asked: "build the parser"\)[\s\S]*Built: parse\.js:3 reads the field\.$/);
  });

  test("old saved words: a fire of the Verifier, a session led by it and /team say BugHunters does its work", async () => {
    await turn("TURN: fire the verifier");
    assert.equal(answers.at(-1), `Error: Not sent: no team answers to "verifier": ${VERIFIER}.`);
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } });
    const id = String((await r.json()).id);
    await settle(id, { patch: { engine: { mode: "team", team: "verifier" } } });
    assert.equal(await turn("TURN: hello", id), "SOLO ANSWER");
    assert.equal((await settingsOf(id)).engine?.problem, `engine.team names \`verifier\`, which is no team — ${VERIFIER} (/team lists them)`);
    const told = await turn("/team bug-hunter", id);
    assert.ok(told.includes(`There is no team called \`bug-hunter\` — ${BUG_HUNTER} (\`/team bughunters\`)`), told);
  });

  // The review of 11-03.
  // (fails before: yes — with verifyFirst on, its fire said BugHunters checks its result, which no check did)
  test("1. a fire of BugHunters checks none of its result, whatever the chat, the fire or its card's switch say", async () => {
    await settle(sid, { patch: { engine: { agentTeams: { verifyFirst: true } } } });
    try {
      assert.equal(await turn("TURN: hunt it checked"), "Fired; going on.");
      assert.equal(answers.at(-1), "BugHunters started beside this chat. Its result waits for the person, who may send it to you. Go on with your work: do not wait for it.");
      const fired = await rowWhere((t) => t.ask === "Find bugs in the lexer, checked.", "the hunt the agent fired");
      assert.deepEqual([fired.verify, fired.checked], [false, true]);
    } finally {
      await settle(sid, { unset: ["engine.agentTeams.verifyFirst"] });
    }
    const r = await shim.api(`/api/sessions/${sid}/beside`, { method: "POST", body: { team: "bughunters", ask: "Hunt, checked on its own switch", model: "m-1", verify: true } });
    const row = (await r.json()).team;
    assert.deepEqual([r.status, row.verify], [200, false], "a fire's own switch");
    const flip = await shim.api(`/api/sessions/${sid}/beside/${row.id}`, { method: "PATCH", body: { verify: true } });
    assert.deepEqual([flip.status, (await flip.json()).error], [409, "BugHunters' result is a check already: nothing checks it again"], "its card's switch");
  });

  // (fails before: yes — the draft's answer held no list as the team tool reads it: the board showed the saved one raw)
  test("3. a draft's answer names the teams its agent may start as its team tool will read them", async () => {
    const draft = async (/** @type {any} */ settings) => (await (await shim.api("/api/sessions/draft-start", { method: "POST", body: { cwd: root, model: "m-1", settings } })).json()).agentTeams;
    assert.deepEqual(await draft(null), ["bughunters"]);
    assert.deepEqual(await draft({ subagents: { teams: ["bug-hunter"] } }), ["bughunters"]);
    assert.deepEqual(await draft({ subagents: { teams: ["verifier", "builders"] } }), ["builders"]);
  });

  // (fails before: yes — `/team Bug Hunter` was "no team" with no word of BugHunters)
  test("6. /team names a gone team as a person writes it, and gets its words", async () => {
    const told = await turn("/team Bug Hunter");
    assert.ok(told.includes(`There is no team called \`Bug Hunter\` — ${BUG_HUNTER} (\`/team bughunters\`)`), told);
  });

  // (fails before: yes — BugHunters says it changes no file, and on the side its chat is held to reading; put in charge
  // of a chat that asks before nothing, its lead's write went into the folder, and the Builder of a team said read-only
  // wrote in its copy)
  // (fails before: yes — d-send's third follow-up: Builders' lead in a /plan's turn read every lead's own hands — "a
  // one-line fix, a rename" — and that its calls run behind the developer's permission mode, in a turn held to reading)
  test("a team that changes files, in charge, in a turn held to reading: its lead reads that in this turn its hands and its workers only read; the person's next turn, its own lines", async () => {
    const chat = String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
    await settle(chat, { patch: { engine: { mode: "team", team: "builders" } } });
    const hands = String(String(PROMPT.lead).split("\n").find((l) => l.startsWith("- Brief a worker by default.")));
    const planned = await shim.api(`/api/sessions/${encodeURIComponent(chat)}/turns`, { method: "POST", body: { content: "TURN: plan the parser", plan: true, stream: false } });
    assert.equal(planned.status, 200, await planned.clone().text());
    const held = leads.findLast((l) => l.all.includes("TURN: plan the parser"));
    assert.ok(held?.system.includes("# Your team: Builders"), "Builders' lead answered");
    assert.ok(held?.system.includes("- Brief a worker by default. This turn is held to reading, whatever the developer's permission mode says: in it your own hands and your workers only read, and work that changes a file waits for a turn that is not held. "), held?.system);
    assert.ok(held?.system.includes(String(PROMPT.leadPermissionReads)));
    for (const untrue of [hands, String(PROMPT.leadPermission), "Your team changes no file"]) assert.ok(!held?.system.includes(untrue), untrue);
    // (fails before: yes — the turn's record said of a held turn that its lead "has every hand of its own, under the
    // permission mode", as the coding agent's record no longer does)
    const heldBy = (await (await shim.api(`/api/sessions/${chat}/transcript`)).json()).turns.at(-1).facts.changes;
    assert.ok(heldBy.includes("agent: team Builders' lead (engine.team): its workers do the work — agent launches them, worker messages, stops or follows up on them — and its own hands only read in this turn, as its workers do: the turn is held to reading"), heldBy.join("\n"));
    await turn("TURN: build the parser", chat);
    const free = leads.findLast((l) => l.all.includes("TURN: build the parser"));
    assert.ok(free?.system.includes(hands) && free?.system.includes(String(PROMPT.leadPermission)), "its own lines again");
    assert.ok(!free?.system.includes("This turn is held to reading"));
  });

  test("a read-only team in charge changes no file: its lead's write and its worker's are refused as a read-only chat's are, and Back to your agent lifts it", async () => {
    const chat = async () => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "m-1", preset: "plain" } })).json()).id);
    const refused = /Not run: this session is read-only, so write is not available\./;
    const a = await chat();
    await settle(a, { patch: { engine: { mode: "team", team: "bughunters" } } });
    assert.equal(await turn("TURN: the lead writes", a), "LEAD DONE");
    const lead = leads.findLast((l) => l.all.includes("tu_lw"));
    assert.ok(lead?.system.includes("# Your team: BugHunters"), "BugHunters' lead answered");
    assert.equal(existsSync(join(root, "led.txt")), false, "nothing written");
    assert.match(String(lead?.all), refused);
    // (fails before: yes — version 121: its lead read every lead's own-hands line, which offers it "a one-line fix, a
    // rename" and the glue between its workers' changes, and its turn's record said it has every hand of its own under
    // the permission mode)
    assert.ok(lead?.system.includes("- Brief a worker by default. Your team changes no file here, and neither do you: your own hands only read, whatever the developer's permission mode says. Take a piece yourself only where that is the better call: it is smaller than its brief would be — a file to read, a search, a command that confirms a report — or workers have failed it twice.\n"), lead?.system);
    for (const gone of ["a one-line fix, a rename", "the glue between your workers' changes", "Never change a file a worker of yours is changing now"]) assert.ok(!lead?.system.includes(gone), gone);
    // (fails before: yes — 031b96a65's left: its permission line said a refused call means the developer declined it, where
    // the refusal above is Filament's hold on a team that changes no file)
    assert.ok(lead?.system.includes("Your tools and your workers' only read here, whatever the developer's permission mode says. A call that would change something, or one Filament cannot tell only reads, is refused at once and asks nobody: a refusal is that hold, not the developer's no — don't retry it; read another way, or say in your report what you would have run and why."), lead?.system);
    assert.ok(!lead?.system.includes("declined it"), "no refusal of its is the developer's no");
    const ledBy = (await (await shim.api(`/api/sessions/${a}/transcript`)).json()).turns.at(-1).facts.changes;
    assert.ok(ledBy.includes("agent: team BugHunters' lead (engine.team): its workers do the work — agent launches them, worker messages, stops or follows up on them — and its own hands only read, as its workers do: its team changes no file"), ledBy.join("\n"));
    // Back to your agent: the chat's mode is its own again.
    await settle(a, { unset: ["engine.mode", "engine.team"] });
    assert.equal(await turn("TURN: the agent writes", a), "Fired; going on.");
    assert.equal(readFileSync(join(root, "own.txt"), "utf8"), "written by the chat's agent\n");
    // A team that changes files is held by nothing: Builders' lead writes.
    const b = await chat();
    await settle(b, { patch: { engine: { mode: "team", team: "builders" } } });
    assert.equal(await turn("TURN: the lead writes", b), "LEAD DONE");
    assert.equal(readFileSync(join(root, "led.txt"), "utf8"), "written by the lead\n");
    assert.ok(leads.findLast((l) => l.all.includes("tu_lw"))?.system.includes("a one-line fix, a rename, a command that confirms a report; it is the glue between your workers' changes once you applied them"), "its lead reads every lead's own hands, as it was")
    assert.ok(leads.findLast((l) => l.all.includes("tu_lw"))?.system.includes("A call of yours that needs approval pauses until the developer answers, and a refused one means they declined it"), "and its permission line, as it was");;
    // Said read-only, Builders is held as BugHunters is, and so is the worker its lead launches.
    const set = await shim.api("/api/teams/builders", { method: "PUT", body: { readOnly: true } });
    assert.equal(set.status, 200, await set.clone().text());
    try {
      const c = await chat();
      await settle(c, { patch: { engine: { mode: "team", team: "builders" } } });
      assert.equal(await turn("TURN: its worker writes", c), "WORKER BACK");
      assert.match(String(workers.findLast((w) => w.includes("tu_ww"))), refused);
      const [sa] = (await (await shim.api(`/api/sessions/${c}/subagents`)).json()).subagents;
      assert.deepEqual([sa.team?.role, sa.work?.pending || 0], ["builder", 0], "its Builder left no change to apply");
    } finally {
      await shim.api("/api/teams/builders", { method: "PUT", body: { readOnly: null } });
    }
  });
});

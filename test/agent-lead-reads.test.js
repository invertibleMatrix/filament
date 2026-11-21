// @ts-check
// HarnessV3-TaskGraph-v2 §12 (V2-0b): a coding agent in the lead's seat reads along with its workers. Its conversation
// is its own, where Filament replaces nothing, so its looks hold the new part only and its words say nothing Filament
// cannot keep: its part, its worker and its wait in those words; a look reaches it in its wait's answer, into its
// running turn, or as its next prompt once its turn ended; one it never took goes back; and its message to a running
// worker and its reads never wait. First alone (app/agent-lead.js, app/agent-tools.js, the bridges'
// toolset), then on the live app: a team led by a fake agent (fixtures/fake-acp-agent.mjs, Claude's shape) whose
// workers run on the agent loop against a fake upstream that holds a worker's reply until its lead has acted.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { createLeadTurn, heardBlock, leadWords } from "../src/app/agent-lead.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { LEAD_HEAD } from "../src/app/agent/loop.js";
import { createLooks, newMark, noted, patchWords, wroteWords } from "../src/app/agent/looks.js";
import { PROMPT, TOOL_TEXT, leadLines } from "../src/app/agent/prompt.js";
import { TEAM_WAIT_OWN_TOOL, TEAM_WAIT_TOOL, WORKER_READS_OWN_TOOL, WORKER_READS_TOOL, WORKER_TOOL } from "../src/app/agent/tools.js";
import { McpToolServer } from "../src/http/mcp.js";
import { MEMBERS } from "./helpers/roster.js";
import { shippedTeam } from "./helpers/team.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

// ---- its words and its tools, alone ---------------------------------------------------------------------------------

// (fails before: yes — a coding agent's part knew no look: with the switch on it read version 18's watch line, and the
// loop lead's lines would have told it of a conversation Filament keeps for it)
test("a coding agent's part when it reads along: how a look reaches it and that every look stays, in words true of a conversation Filament cannot edit; off, its part is as it was", () => {
  const team = shippedTeam("builders");
  const off = leadWords(team);
  const on = leadWords(team, { supervise: true });
  assert.equal(leadWords(team, { supervise: false }), off);
  assert.equal(
    on,
    off
      .replace(String(PROMPT.lead), () => leadLines({ supervise: true, own: true }))
      .replace("worker messages, stops, follows up on or applies one", () => "worker messages, stops, reads, follows up on or applies one")
      // (fails before: yes — V2-0b's second drive: a lead on Claude Code took "agent" for its own sub-agent tool, twice,
      // and its helpers could not write; TG2-D37. Claude Code's own is gone from a lead's session since TG2-D40: the
      // words hold for an agent whose own Filament cannot take away. Since HarnessV4_Tasks decision 9 they no longer say
      // it can only read: a lead's own tools work as the permission mode allows)
      .replace("and wait waits for them. Your own tools", () => "and wait waits for them. Where you have a sub-agent tool of your own, it is not that agent tool: what it starts is no worker of your team, and Filament shows you nothing of it. Your own tools")
      .replace("A worker's report that lands while you work reaches you as a message from Filament, or waits sealed for its envelope tool where Filament's line says so. When only waiting is left, end your turn: Filament wakes you with the reports as your next message", () => "A worker's report or a look that lands while you work reaches you as a message from Filament, a report waiting sealed for its envelope tool where Filament's line says so. When only waiting is left, end your turn: Filament wakes you with the reports, and with a look when one is due, as your next message"),
  );
  assert.notEqual(on, off);
  assert.ok(on.includes(`${PROMPT.leadLooksOwn}\n`), on);
  assert.ok(!on.includes("- wait answers with your workers still running"), "the watch's line gave way");
  // What is true of the loop's lead alone is never said to it.
  for (const untrue of [String(PROMPT.leadLooks), "Only the newest look stays", "replaces the one before", "in place of the one before", "leaves your conversation"]) assert.ok(!on.includes(untrue), untrue);
  assert.ok(String(PROMPT.leadLooksOwn).includes("These looks stay in your conversation, so Filament keeps them short: none repeats what an earlier one showed."));
  assert.ok(String(PROMPT.leadLooksOwn).includes("as your next message once your turn ended"));
  // The lines of how it leads: the loop lead's, with its own looks where the watch was. Since version 29 (TG2-D58) the looks' own line on a worker's question stands for the one after
  // the watch, which tells a lead that does not read along of the questions at its door.
  assert.equal(
    leadLines({ supervise: true, own: true }),
    String(PROMPT.lead)
      .split("\n")
      .flatMap((l) => (l.startsWith("- wait answers with your workers still running") ? [PROMPT.leadLooksOwn] : l.startsWith("- A worker may ask you") ? [] : [l]))
      .join("\n"),
  );
  assert.ok(String(PROMPT.leadLooksOwn).includes("\n- A worker may ask you — a choice its brief does not settle, a problem it is stuck on, or its plan where you launched it with plan_review — and waits for your answer"));
  assert.equal(leadLines({ own: true }), PROMPT.lead);
  assert.notEqual(leadLines({ supervise: true, own: true }), leadLines({ supervise: true }));
  // (fails before: yes — version 121: `readOnly` was no word of these lines, so the lead of a team that changes no file
  // read every lead's own hands — "a one-line fix, a rename", the glue between its workers' changes) Its own hands only
  // read, in every seat; that line alone differs, and a team that writes reads them as they were.
  const hands = String(PROMPT.lead).split("\n").filter((l) => l.startsWith("- Brief a worker by default."));
  assert.equal(hands.length, 1);
  const READS = "- Brief a worker by default. Your team changes no file here, and neither do you: your own hands only read, whatever the developer's permission mode says. Take a piece yourself only where that is the better call: it is smaller than its brief would be — a file to read, a search, a command that confirms a report — or workers have failed it twice.";
  for (const seat of [{}, { own: true }, { supervise: true }, { supervise: true, own: true }]) {
    assert.equal(leadLines({ ...seat, readOnly: true }), leadLines(seat).replace(hands[0], READS), JSON.stringify(seat));
    assert.equal(leadLines({ ...seat, readOnly: false }), leadLines(seat), JSON.stringify(seat));
  }
});

// (fails before: yes — Filament's MCP server listed version 18's worker and wait to a lead whose session reads along)
test("Filament's tools for a lead that reads along: a worker with its two reads and a wait that answers with a look, neither promising to replace anything; the flag rides the bridge's toolset and its MCP server", async () => {
  const leads = { get: () => null };
  const tools = createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => ({ apply: () => ({ ok: true, text: "solo" }) }), turns: /** @type {any} */ (leads), subagents: () => null, membersOf: () => null });
  const at = { chain: "c1", turn: null, graph: false, report: false, cwd: "/w", upstream: "cli" };
  /** @param {any} ctx @returns {Record<string, any>} */
  const listed = (ctx) => Object.fromEntries(tools.list({ ...at, ...ctx }).map((t) => [t.name, t]));
  const schema = (/** @type {any} */ t) => t.inputSchema ?? t.input_schema;
  const on = listed({ team: true, reads: true });
  const off = listed({ team: true });
  // The envelope tool beside its wait (HarnessV4_Envelopes_Plan EN3).
  assert.deepEqual(Object.keys(on), ["agent", "worker", "wait", "envelope"]);
  assert.deepEqual(Object.keys(listed({ team: true, graph: true, reads: true })), ["tasks", "checklist", "agent", "worker", "wait", "envelope"]);
  // Its worker has a third read, show_report (TG2-D56, version 28): its agent compacts its conversation by itself.
  assert.deepEqual([on.worker.description, on.wait.description], [TOOL_TEXT.workerReadsOwn, TOOL_TEXT.teamWaitOwn]);
  assert.deepEqual([off.worker.description, off.wait.description], [TOOL_TEXT.worker, TOOL_TEXT.teamWait], "off, today's");
  assert.deepEqual(["show_trail", "from_round", "show_changes", "show_report"].map((k) => k in schema(on.worker).properties), [true, true, true, true]);
  assert.equal("show_trail" in schema(off.worker).properties, false);
  assert.deepEqual(listed({ team: false, reads: true }), {}, "no team, no team's tools");
  // Its conversation is its own: nothing there is replaced, so neither tool says so.
  assert.ok(!JSON.stringify([WORKER_READS_OWN_TOOL, TEAM_WAIT_OWN_TOOL]).includes("replace") && !TOOL_TEXT.teamWaitOwn.includes("in place of"));
  assert.ok(JSON.stringify(WORKER_READS_TOOL).includes("It replaces"), "the loop lead's does: Filament keeps its conversation");
  assert.deepEqual(Object.keys(WORKER_READS_OWN_TOOL.input_schema.properties), [...Object.keys(WORKER_READS_TOOL.input_schema.properties), "show_report"]);
  assert.deepEqual([TEAM_WAIT_OWN_TOOL.input_schema, WORKER_TOOL.name], [TEAM_WAIT_TOOL.input_schema, "worker"]);

  // The bridge's toolset: the flag goes with the team's, never without it.
  /** @param {Record<string, boolean>} want */
  const plan = (want) => planToolset({ acp: {}, upstream: { id: "cli" }, proc: { initResult: { agentCapabilities: { mcpCapabilities: { http: true } } } }, profile: /** @type {any} */ ({}), turn: { bridge: "prompts" }, fullBridge: false, cwd: "/w", mcpBase: "http://127.0.0.1:9", memoryWanted: false, existingToken: null, notes: [], ...want });
  assert.deepEqual([plan({ teamWanted: true, readsWanted: true }).pending?.team, plan({ teamWanted: true, readsWanted: true }).pending?.reads], [true, true]);
  assert.equal(plan({ teamWanted: true }).pending?.reads, false);
  assert.equal(plan({ readsWanted: true }).wantMcp, false, "reading along alone wants nothing of Filament's MCP server");
  // Filament's MCP server hands it to the tools with each list and call.
  /** @type {any[]} */
  const seen = [];
  for (const reads of [true, false]) {
    const mcp = new McpToolServer({
      bridge: { contextForMcpToken: () => ({ conv: null, turn: null, cwd: "/w", upstream: { id: "cli", acp: {} }, native: false, chain: "c1", graph: false, team: true, reads }), hands: {} },
      tools: { memoryOn: () => false, list: (/** @type {any} */ ctx) => (seen.push(["list", ctx.reads]), []), has: (/** @type {string} */ n) => n === "wait", call: async (/** @type {string} */ _n, /** @type {any} */ _a, /** @type {any} */ ctx) => (seen.push(["call", ctx.reads]), { text: "ok" }) },
    });
    const res = { writeHead() {}, end() {} };
    await mcp.handle({ method: "POST" }, res, "tok", JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
    await mcp.handle({ method: "POST" }, res, "tok", JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "wait", arguments: {} } }));
  }
  assert.deepEqual(seen, [["list", true], ["call", true], ["list", false], ["call", false]]);
});

// (fails before: yes — a trail and a change so far told every reader they stay "until you ask for it again", which no
// one keeps for a coding agent)
test("a trail and a change so far a coding agent asked for say nothing of being replaced; the loop lead's still do", () => {
  const w = { id: "sa_1", role: "builder" };
  const c = { files: [{ path: "a.js", added: 1, removed: 0 }], diff: "+x" };
  assert.equal(patchWords(w, c), "[Filament: the change so far of sa_1, against where it started: 1 file. It stays until you ask for it again.]\n\n- a.js (+1 −0)\n\n+x");
  assert.equal(patchWords(w, c, { replaced: false }), "[Filament: the change so far of sa_1, against where it started: 1 file.]\n\n- a.js (+1 −0)\n\n+x");
  assert.equal(patchWords(w, c, { reported: true, replaced: false }).split("\n")[0], "[Filament: the change so far of sa_1, against where it started: 1 file, as it stood when it reported.]");
  assert.equal(wroteWords(w, { paths: [], why: "" }, { replaced: false }).split("\n")[0], "[Filament: the change so far of sa_1: it works in your folder, so no git measures its change.]");
  assert.ok(wroteWords(w, { paths: [], why: "" }).split("\n")[0].endsWith("so no git measures its change. It stays until you ask for it again.]"));
  /** @param {boolean} lean */
  const trailOf = (lean) => {
    /** @type {any[]} */
    const log = [];
    const watched = { id: "sa_1", role: "builder", description: "parse it", task: null, run: "r1", head: ["round 1"], mark: newMark() };
    const looks = createLooks({ now: () => 1, later: () => {}, seconds: () => 0, lean, workers: () => [watched], eventsOf: (_run, since) => log.filter((e) => e.n > since), wake: () => {} });
    for (const e of [{ type: "round-start", round: 1 }, { type: "round-thinking", round: 1, thinking: "Integers." }, { type: "tool-start", round: 1, id: "c1", name: "read", args: "a.js", card: { kind: "read", subject: "a.js" } }]) {
      const evt = { n: log.length + 1, ts: 1, ...e };
      log.push(evt);
      noted(watched.mark, evt, null);
    }
    return [looks.lean, looks.trail(watched)];
  };
  const [lean, own] = trailOf(true);
  const [kept, loops] = trailOf(false);
  assert.deepEqual([lean, kept], [true, false]);
  assert.ok(String(own).startsWith("[Filament: the trail of sa_1, whole from round 1.]\n\n"), String(own));
  assert.ok(String(loops).startsWith("[Filament: the trail of sa_1, whole from round 1. It stays until you ask for it again.]\n\n"), String(loops));
  assert.ok(String(own).includes("Round 1\nCalled read `a.js` → still running") && !String(own).includes("Integers."), "a trail asked for is whole, and holds none of its thinking (HarnessV3-TaskGraph-v2 TG2-D60)");
});

// ---- its turn over stubs --------------------------------------------------------------------------------------------

const LOOK = Object.freeze({ kind: "look", text: '[Filament: a look at your workers. 1 is running.]\n\n## scout sa_1 — "Map it"\nround 1 · sign: said how it will go about its task\n\nRound 1\nSaid: PLAN: list them.', look: { workers: [{ id: "sa_1", run: "r-sa_1" }], tokens: 31 }, from: "", description: "", spentUsd: 0, toolCalls: 0, roundIds: [], wrote: false });
const REPORT = Object.freeze({ kind: "report", text: "[Filament: your scout sa_2 finished.]", from: "sa_2", description: "Map the docs", exchange: 0, wrote: false, spentUsd: 0.05, toolCalls: 2, roundIds: ["r-2"] });

/**
 * A coding agent's turn as a lead, over stubs: a door whose looks and reports the test holds — `reads` says whether it
 * makes looks, at `pace` — a registry with the workers given, and what it leaves.
 * @param {{ reads?: boolean, pace?: number, workers?: any[], onLook?: () => void }} [o]
 */
function stubLead({ reads = true, pace = 300, workers = [], onLook = () => {} } = {}) {
  /** @type {any[]} */
  const events = [];
  /** @type {string[]} */
  const notes = [];
  /** @type {any[]} */
  const due = [];
  /** @type {any[]} */
  const back = [];
  /** @type {any[][]} */
  const sent = [];
  /** @type {any[]} */
  const launched = [];
  /** @type {Promise<void> | null} */
  let owed = null;
  let asked = 0;
  /** @type {(what?: string) => void} */
  let ring = () => {};
  const stop = new AbortController();
  const byId = new Map(workers.map((w) => [w.id, { chainId: "c1", type: "explore", model: "m-1", view: "none", description: "Map it", ...w }]));
  const registry = /** @type {any} */ ({
    launch: async (/** @type {any} */ spec) => (launched.push(spec), { ok: true, id: `sa_${9 + launched.length}` }),
    get: (/** @type {string} */ id) => byId.get(id) || null,
    list: () => [],
    now: () => 1_000_000,
    message: (/** @type {string} */ id, /** @type {any} */ m) => (sent.push([id, m]), { ok: true }),
    changesSoFar: async () => ({ ok: true, text: "THE CHANGE SO FAR", note: "1 file" }),
    followUp: () => ({ ok: true, id: "sa_2", marked: false }),
    recall: () => {},
  });
  const lead = createLeadTurn({
    registry,
    door: /** @type {any} */ ({
      inbox: {
        ...(reads ? { reads: true, look: () => (asked++, onLook()), pace: () => pace } : {}),
        take: () => due.splice(0),
        back: (/** @type {any[]} */ taken) => back.push(...taken),
        owed: () => owed,
        arrival: () => new Promise((res) => (ring = res)),
      },
      close() {},
    }),
    chainId: "c1",
    runId: "r1",
    cwd: "/w",
    model: "m-1",
    team: { key: "architect", name: "Architect", members: MEMBERS },
    emit: (e) => events.push(e),
    note: (t) => notes.push(t),
    mailbox: () => null,
    signal: stop.signal,
  });
  return { lead, events, notes, due, back, sent, launched, stop, asked: () => asked, ring: (/** @type {string} */ what = "") => ring(what || undefined), running: () => (owed = new Promise(() => {})) };
}

// (fails before: yes — a coding agent's wait answered with a line for each worker, and a look taken at its door was
// said on its run as a sub-agent's report)
test("a lead's wait ends on a look and answers with it, in place of the watch; whatever ended the wait a look is asked for — but a stop; a look is no report on its run", async () => {
  // A look that is due ends the wait.
  const t = stubLead();
  t.running();
  const waited = t.lead.call("wait", { seconds: 30 }, { patienceMs: 60_000 });
  await until(() => !!t.lead.waiting(), "the wait to hold");
  t.due.push(LOOK);
  t.ring("look");
  assert.deepEqual(await waited, { text: `Waited 0 s: your workers moved.\n\n${LOOK.text}` });
  assert.equal(t.asked(), 1, "asked for as the wait ended");
  assert.deepEqual(t.events, [{ type: "look", workers: LOOK.look.workers, tokens: 31 }]);
  assert.deepEqual(t.notes, [], "nothing delivered: a look is no message of a sub-agent's");
  assert.equal(t.lead.spentUsd(), 0);

  // A report ends it: the report, then the look at those still running.
  const both = stubLead();
  both.running();
  const second = both.lead.call("wait", { seconds: 30 }, { patienceMs: 60_000 });
  await until(() => !!both.lead.waiting(), "the wait to hold");
  both.due.push(REPORT, LOOK);
  both.ring();
  assert.deepEqual(await second, { text: `Waited 0 s: one message from Filament:\n\n${REPORT.text}\n\n${LOOK.text}` });
  assert.deepEqual(both.events.map((e) => e.type), ["subagent-report", "look"]);
  assert.deepEqual(both.notes, ["agent: 1 sub-agent message delivered to the lead"]);

  // The seconds pass with a look due — a sign fresh as the time ran out: the door gives it, and the wait asks for none.
  // (fails before: yes — TG2-D48: a wait that only ran out of time asked for a look, whatever was new)
  const timed = stubLead({onLook: () => timed.due.push(LOOK) });
  timed.running();
  const late = timed.lead.call("wait", { seconds: 1 }, { patienceMs: 60_000 });
  await until(() => !!timed.lead.waiting(), "the wait to hold");
  timed.due.push(LOOK);
  assert.deepEqual(await late, { text: `Waited 1 s and no report arrived; the workers are still running. Call wait again, or carry on with other work.\n\n${LOOK.text}` });
  assert.equal(timed.asked(), 0);
  // With none due: no look, and the agent is told to end its turn — Filament wakes it — with a line for each worker.
  const quiet = stubLead({onLook: () => quiet.due.push(LOOK) });
  quiet.running();
  assert.equal((await quiet.lead.call("wait", { seconds: 1 }, { patienceMs: 60_000 })).text, "Waited 1 s: no report arrived, and no look is due. End your turn now: the workers keep running, and Filament wakes you with each report, and with a look at once on a sign, else every 5 min while something is new.\n\nNo worker is running now.");
  assert.deepEqual([quiet.asked(), quiet.events], [0, []]);
  const often = stubLead({pace: 0 });
  often.running();
  assert.ok((await often.lead.call("wait", { seconds: 1 }, { patienceMs: 60_000 })).text.startsWith("Waited 1 s: no report arrived, and no look is due. End your turn now: the workers keep running, and Filament wakes you with each report, and with a look whenever something is new.\n\n"));
  // Held short of the seconds asked, a look due: the wait says how long it answers within here.
  const patient = stubLead();
  patient.running();
  const held = patient.lead.call("wait", { seconds: 5 }, { patienceMs: 6_000 });
  await until(() => !!patient.lead.waiting(), "the wait to hold");
  patient.due.push(LOOK);
  assert.equal((await held).text, `Waited 1 s and no report arrived; the workers are still running. A wait answers within 1 s here: end your turn when only waiting is left — Filament wakes you with the reports, and with a look when one is due.\n\n${LOOK.text}`);

  // A stop asks for none.
  const stopped = stubLead();
  stopped.running();
  const cut = stopped.lead.call("wait", { seconds: 30 }, { patienceMs: 60_000 });
  await until(() => !!stopped.lead.waiting(), "the wait to hold");
  stopped.stop.abort();
  assert.equal((await cut).text, "Waited 0 s: the turn is being stopped.\n\nNo worker is running now.");
  assert.equal(stopped.asked(), 0);

  // (fails before: no — a guard) A lead that does not read along keeps version 18's wait.
  const plain = stubLead({reads: false });
  plain.running();
  assert.equal((await plain.lead.call("wait", { seconds: 1 }, { patienceMs: 60_000 })).text, "Waited 1 s and nothing arrived; the workers are still running. Call wait again, or carry on with other work.\n\nNo worker is running now.");
});

// (fails before: yes — a look taken for a lead whose turn ended first was kept for its next prompt like a report: by
// then it showed workers as they no longer stood, and the part it held was never shown again)
test("a look the lead was handed and never took goes back to the door, never to its next prompt; what it was shown is counted on its record", () => {
  const t = stubLead();
  t.due.push(REPORT, LOOK);
  assert.deepEqual(t.lead.take(), [REPORT.text, LOOK.text], "a look rides behind the reports");
  // The agent's turn ended before Filament could hand them over.
  t.lead.unheard();
  assert.deepEqual(t.back, [LOOK], "the look goes back: its marks with it");
  assert.deepEqual(t.lead.take(), [REPORT.text], "the report waits for the next prompt; the look does not");
  t.lead.close();
  assert.ok(!t.notes.some((n) => n.includes("was shown")), "a look handed back was never shown");

  const shown = stubLead();
  shown.due.push(LOOK);
  shown.lead.take();
  shown.due.push({ ...LOOK, text: "[Filament: a look at your workers. Since the last: 1 moved, 0 did not.]" });
  shown.lead.take();
  shown.lead.close();
  assert.deepEqual(shown.back, []);
  assert.equal(shown.notes.at(-1), "agent: the lead was shown 2 looks at its workers; each stays in its own conversation, so each held only what was new since the one before");
  const once = stubLead();
  once.due.push(LOOK);
  once.lead.take();
  once.lead.close();
  assert.equal(once.notes.at(-1), "agent: the lead was shown 1 look at its workers; each stays in its own conversation, so each held only what was new since the one before");
});

// (fails before: no — a guard: a lead's message, its read and its orders reach the work, and none waits for the
// developer)
test("a lead that reads along sends its message to a running worker, and reads one, at once; a follow-up runs at once too; a lead that does not read along sends its message so, and has no read of a worker", async () => {
  const workers = [{ id: "sa_1", team: { role: "scout" }, status: "running" }, { id: "sa_2", team: { role: "builder" }, status: "done" }];
  const t = stubLead({ workers });
  assert.deepEqual(await t.lead.call("worker", { agent_id: "sa_1", prompt: "Lower case." }, { patienceMs: 60_000 }), { text: "Sent to scout sa_1: it reads your message at its next step, while it works. Its report still arrives as a message when it finishes." });
  assert.deepEqual(t.sent, [["sa_1", { chainId: "c1", text: "Lower case.", from: "lead" }]]);
  assert.deepEqual(await t.lead.call("worker", { agent_id: "sa_1", show_changes: true }, { patienceMs: 60_000 }), { text: "THE CHANGE SO FAR" });
  const followed = await t.lead.call("worker", { agent_id: "sa_2", prompt: "Again, in lower case." }, { patienceMs: 2_500 });
  assert.ok(!followed.isError && !/approval|Not run/.test(followed.text), followed.text);
  assert.deepEqual(t.events.filter((e) => e.type === "ask").length, 0, "nothing waited for the developer");

  const plain = stubLead({ workers, reads: false });
  assert.match((await plain.lead.call("worker", { agent_id: "sa_1", prompt: "Lower case." }, { patienceMs: 2_500 })).text, /^Sent to scout sa_1: /);
  assert.deepEqual(plain.sent, [["sa_1", { chainId: "c1", text: "Lower case.", from: "lead" }]]);
  assert.equal((await plain.lead.call("worker", { agent_id: "sa_1", show_changes: true }, { patienceMs: 60_000 })).isError, true, "and has no read of a worker");
});

// ---- on the live app ------------------------------------------------------------------------------------------------

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
/** @type {string} */
let logs;

const WATCHED = { role: "scout", description: "Map it, watched", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
const PUMPED = { role: "scout", description: "Map it while I work", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
const UNWATCHED = { role: "scout", description: "Map it, unwatched", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
/** What a worker says before its first call: its plan. */
const PLAN = "PLAN: I will list every file, then read each.";
/** The lead's message to its running worker, and the block the worker's loop reads it in. */
const STEER = "List the files only: read none.";
const blockOf = (/** @type {string} */ told) => `${LEAD_HEAD} (1 message). Acknowledge what you heard in your next reply before acting on it:\n- ${told}`;

/** A door the script holds a reply behind until the other side has acted. */
const gate = () => {
  /** @type {() => void} */
  let open = () => {};
  const passed = /** @type {Promise<void>} */ (new Promise((res) => (open = res)));
  return { open, passed };
};
/** @type {Record<string, ReturnType<typeof gate>>} */
let gates = {};
let calls = 0;

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** Every text a request's messages hold, a tool result's included. @param {any} body */
const textsIn = (body) => {
  /** @type {string[]} */
  const out = [];
  for (const m of body?.messages || [])
    for (const b of Array.isArray(m.content) ? m.content : [{ type: "text", text: String(m.content ?? "") }]) {
      if (b?.type === "text") out.push(String(b.text));
      else if (b?.type === "tool_result") out.push(textOf(b.content));
    }
  return out;
};
/** @param {any} body @param {string} id */
const answeredIn = (body, id) => (body?.messages || []).some((/** @type {any} */ m) => Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id === id));
const isWorker = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.workerRole));
/** A JSONL file's lines, parsed. @param {string} file */
const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
/** The lead's prompts to the fake agent, in a session. @param {string} sessionId */
const promptsOf = (sessionId) => lines(join(logs, "prompts.jsonl")).filter((p) => p.sessionId === sessionId);
/** The fake agent's prompt that carries `marker`. @param {string} marker */
const promptWith = (marker) => lines(join(logs, "prompts.jsonl")).find((p) => String(p.text).includes(marker)) || null;

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-agent-lead-reads-"));
  logs = mkdtempSync(join(tmpdir(), "filament-agent-lead-reads-logs-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const all = JSON.stringify(b.messages || []);
    const model = String(b.model || "");
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
    const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
    const planned = (/** @type {string} */ id) => blocks([{ type: "text", text: PLAN }, { type: "tool_use", id, name: "glob", input: { pattern: "*" } }], "tool_use");
    if (!sysOf(b).includes(String(PROMPT.workerRole))) return say("MODEL ANSWER");
    // The workers, on the loop. Each says its plan and lists the files, which is what its lead's look shows.
    if (all.includes(WATCHED.description)) {
      // Its next reply is held until its lead has messaged it, so the message is what its third request reads.
      if (all.includes(STEER)) return say("SCOUT REPORT: a.txt is here; I read none, as the lead said.");
      if (!answeredIn(b, "toolu_s_glob")) return planned("toolu_s_glob");
      await gates.steered.passed;
      return use(`toolu_s_again_${++calls}`, "glob", { pattern: "*.txt" });
    }
    if (all.includes(PUMPED.description)) {
      // Its report is held until its lead has taken the look into its running turn.
      if (!answeredIn(b, "toolu_p_glob")) return planned("toolu_p_glob");
      await gates.pumped.passed;
      return say("SCOUT REPORT: mapped while the lead worked.");
    }
    if (all.includes(UNWATCHED.description)) return answeredIn(b, "toolu_u_glob") ? say("SCOUT REPORT: mapped, unwatched.") : planned("toolu_u_glob");
    return say("SCOUT REPORT: a.txt");
  });
  shim = await startApp({ memory: true, keep: true, configure });
});
after(async () => {
  for (const g of Object.values(gates)) g.open();
  await shim.stop();
  await up.close();
  // Windows lets go of a folder a moment after the processes in it end: removing it waits until it can.
  await removeDirs(folder, logs, shim.dataDir);
});

/** @param {any} cfg @param {{ dataDir: string }} ctx */
function configure(cfg, { dataDir }) {
  const agent = (/** @type {string} */ id, /** @type {Record<string, string>} */ env) => ({
    id,
    name: id,
    type: "acp",
    enabled: true,
    acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), ...env }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" },
  });
  cfg.upstreams = [
    { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } },
    agent("cli", { FAKE_ACP_MCP_CAPS: "http" }),
    agent("steerer", { FAKE_ACP_MCP_CAPS: "http", FAKE_ACP_STEERING: "1" }),
  ];
  cfg.routes = [
    { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
    { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
    { match: "steerer-*", upstream: "steerer", upstreamModel: "{model}", enabled: true },
  ];
  cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
  cfg.memory.autopilot = { enabled: false };
}

/** A harness session in the repository, led by the coding agent, its workers on the loop: reading along is a session's default. @param {any} engine @param {string} [model] */
const newSession = async (engine, model = "coder-1") => {
  const settings = { engine: { mode: "team", team: "builders", lookSeconds: 0, ...engine }, subagents: { pool: [{ model: "m-1", seats: 4 }] } };
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model, preset: "plain", settings } });
  assert.equal(r.status, 200, await r.clone().text());
  return String((await r.json()).id);
};
/** A harness turn, as the page sends one, and its run's id. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
  assert.equal(res.status, 200);
  return { res, runId: String(res.headers.get("x-filament-request-id")) };
};
/** A harness turn, answered whole. @param {string} id @param {string} content */
const whole = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  const json = await r.json();
  return { status: r.status, json, text: textOf(json.content), id: String(r.headers.get("x-filament-request-id")) };
};
/** A run's events so far. @param {string} runId @returns {Promise<any[]>} */
const runEvents = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
/** The session's sub-agents. @param {string} id @returns {Promise<any[]>} */
const subagentsOf = async (id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;
/** The notes on a request's record. @param {string} id */
const notesOf = async (id) => {
  const rec = await shim.record(id);
  return { rec, notes: [...(rec.priorChanges || []), ...(rec.changes || [])].map(String) };
};
/** The developer's note to a run. @param {string} runId @param {string} text */
const note = async (runId, text) => {
  const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind: "note", text } });
  assert.equal(r.status, 200, await r.clone().text());
};
/** A tool's call to Filament's MCP server, as the agent makes one. @param {string} url @param {string} method @param {any} [params] */
const mcp = async (url, method, params = {}) => (await (await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) })).json()).result;
/** The tools Filament's MCP server lists to a session's agent, by name. @param {string} url @returns {Promise<Record<string, any>>} */
const listedAt = async (url) => Object.fromEntries((await mcp(url, "tools/list")).tools.map((/** @type {any} */ t) => [t.name, t]));

// (fails before: yes — a coding agent that led a team heard nothing of a worker before its report: Filament woke it with
// reports alone, and its wait answered with a line for each worker)
test("a coding agent that reads along: woken with a look at its worker's plan as its next prompt, the new part only; its wait answers with a look; its message reaches the running worker at once, read at the worker's next step", async () => {
  gates = { steered: gate() };
  const id = await newSession({});
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(WATCHED)}`);

  // Its part and its tools: its own words for its looks, on its system channel; the worker and the wait that say so.
  const first = /** @type {any} */ (await until(() => promptWith(`~mcpcall agent ${JSON.stringify(WATCHED)}`), "the lead's first prompt"));
  const opened = lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === first.sessionId);
  const system = String(opened?.system || "");
  assert.ok(system.includes(String(PROMPT.leadLooksOwn)) && !system.includes(String(PROMPT.leadLooks)), system);
  const listed = await listedAt(first.mcpUrl);
  assert.deepEqual([listed.worker.description, listed.wait.description], [TOOL_TEXT.workerReadsOwn, TOOL_TEXT.teamWaitOwn]);
  assert.ok(["show_trail", "show_report"].every((k) => k in (listed.worker.inputSchema ?? listed.worker.input_schema).properties));

  // The look woke it as its next prompt: the worker's plan in its own words under its sign, and nothing a lean look
  // leaves out — no plan line again, no line of what came before.
  const woken = /** @type {any} */ (await until(() => promptsOf(first.sessionId).find((p) => String(p.text).includes("[Filament: a look at your workers. 1 is running.]")) || null, "the lead to be woken with a look"));
  const look = String(woken.text);
  assert.match(look, /^\[Filament: a look at your workers\. 1 is running\.\]\n\n## scout sa_[0-9a-f]{8} — "Map it, watched"\n/);
  assert.ok(look.includes("sign: said how it will go about its task") && look.includes(`Round 1\nSaid: ${PLAN}\nCalled glob \`*\``), look);
  assert.ok(!look.includes("Its plan (round") && !look.includes("So far (round"), look);
  assert.equal(promptsOf(first.sessionId).findIndex((p) => p.text === woken.text), 1, "its second prompt, in the same turn");
  const [sa] = await subagentsOf(id);
  assert.deepEqual([sa.team?.role, sa.status], ["scout", "running"]);

  // Its wait: nothing new for a second, so no look is due — the answer says to end its turn, and gives a line for each
  // worker (TG2-D48).
  // (fails before, for its wait: yes — a wait that only ran out of time showed a look with nothing new in it)
  await note(runId, '~mcpcall wait {"seconds":1}');
  const waited = await until(async () => {
    const events = await runEvents(runId);
    const start = events.find((e) => e.type === "tool-start" && e.name === "wait");
    return start && events.some((e) => e.type === "tool-end" && e.id === start.id) ? start : null;
  }, "the lead's wait to answer");
  assert.ok(waited);

  // Its message to the running worker: at once, and the worker reads it at its next step.
  await note(runId, `~mcpcall worker ${JSON.stringify({ agent_id: sa.id, prompt: STEER })}`);
  await until(async () => (await subagentsOf(id))[0]?.progress?.lead?.unread === 1, "the lead's message to be sent");
  assert.deepEqual((await subagentsOf(id))[0].progress.lead, { read: 0, unread: 1 });
  // The worker goes on once the lead's prompt that sent the message has ended and it waits for its workers: its report
  // then wakes the lead. (Under the full suite's load the worker could report while that prompt still ran, its report
  // sealed into it and the turn ending on the reminder — FabeleHelper's of 11-10.)
  await until(async () => {
    const events = await runEvents(runId);
    const call = events.find((e) => e.type === "tool-start" && e.name === "worker");
    const ended = call ? events.findIndex((e) => e.type === "tool-end" && e.id === call.id) : -1;
    return ended >= 0 && events.slice(ended).some((e) => e.type === "turn-state" && e.to === "waiting");
  }, "the lead's prompt that sent the message to end, and the lead to wait for its workers");
  gates.steered.open();
  const said = await res.text();
  assert.ok(said.includes("mcp:Waited 1 s: no report arrived, and no look is due. End your turn now: the workers keep running, and Filament wakes you with each report, and with a look whenever something is new.\\n\\nWorkers still running (1):\\n- scout"), said);
  assert.ok(!said.includes("Since the last: 0 moved, 1 did not."), "no look with nothing new in it");
  assert.ok(said.includes(`mcp:Sent to scout ${sa.id}: it reads your message at its next step, while it works.`), said);
  const worker = up.received.filter(isWorker).filter((c) => JSON.stringify(c.body.messages).includes(WATCHED.description));
  const heard = worker.findIndex((c) => textsIn(c.body).some((x) => x.includes(blockOf(STEER))));
  assert.ok(heard >= 2, `it read its lead's message at a step after its plan: request ${heard}`);
  assert.equal((await subagentsOf(id))[0].status, "done");

  // Nothing waited for the developer. The report woke the lead last.
  const events = await runEvents(runId);
  assert.equal(events.filter((e) => e.type === "ask").length, 0);
  const prompts = promptsOf(first.sessionId).map((p) => String(p.text));
  assert.ok(prompts.at(-1)?.includes(`[Filament: your scout ${sa.id} ("Map it, watched")`) && prompts.at(-1)?.includes("SCOUT REPORT: a.txt is here; I read none, as the lead said."), prompts.at(-1));
  assert.ok(!prompts.at(-1)?.includes("It ended without reading"), "the worker read the message");
  assert.ok(events.filter((e) => e.type === "look").length >= 2, "each look is on the lead's run: the wake's and the one after its message was read");
  assert.ok(events.filter((e) => e.type === "look").every((e) => Array.isArray(e.workers) && e.workers[0]?.id === sa.id && e.tokens > 0));
  const { notes } = await notesOf(runId);
  assert.ok(notes.includes("acp: cli reads along with its workers (engine.supervise): Filament shows it a look at them at once on a sign, else whenever something is new (engine.lookSeconds) — the new part only, since its conversation is its own"), notes.join("\n"));
  assert.ok(notes.includes("acp: cli woken in the same turn: a look at its workers"), notes.join("\n"));
  assert.ok(notes.some((n) => /^agent: the lead was shown \d+ looks at its workers; each stays in its own conversation, so each held only what was new since the one before$/.test(n)), notes.join("\n"));
  assert.ok(notes.includes(`agent: a message to scout ${sa.id} (m-1), read at its next step`), notes.join("\n"));
  // The look after it shows the message read, in the lead's own words for it.
  assert.ok(prompts.some((p) => p.includes("[Filament: a look at your workers. Since the last: 1 moved, 0 did not.]") && p.includes(`Read your message at the end of this round: "${STEER}"`)), prompts.join("\n----\n"));
});

// (fails before: yes — nothing but a report went into a lead's running turn)
test("a look that is due while the lead works goes into its running turn, where its agent takes Filament's words as it works", async () => {
  gates = { pumped: gate() };
  const id = await newSession({}, "steerer-1");
  const { res, runId } = await turn(id, `~mcpcall agent ${JSON.stringify(PUMPED)} ~steerable`);
  await until(() => lines(join(logs, "calls.jsonl")).some((c) => c.method === "queued prompt" && String(c.words).includes("[Filament: a look at your workers. 1 is running.]")), "the look to be queued at the lead");
  gates.pumped.open();
  const said = await res.text();
  assert.match(said, /heard:\[Filament: a look at your workers\. 1 is running\.\]/);
  const { notes } = await notesOf(runId);
  assert.ok(notes.includes("acp: a look at its workers went into steerer's running turn"), notes.join("\n"));
  const first = /** @type {any} */ (promptWith(`~mcpcall agent ${JSON.stringify(PUMPED)} ~steerable`));
  const prompts = promptsOf(first.sessionId).map((p) => String(p.text));
  assert.ok(!prompts.slice(1).some((p) => p.includes("[Filament: a look at your workers. 1 is running.]")), "the look had no prompt of its own");
  // The report woke it after — whole, where it landed once the lead's turn had ended; or, where it landed while the lead
  // still worked, sealed as its envelope's line (HarnessV4_Envelopes_Plan EN3), which the turn's end said once more.
  const whole = prompts.some((p) => p.includes("SCOUT REPORT: mapped while the lead worked."));
  const sealed = prompts.some((p) => p.includes("[Filament: envelope ") && p.includes(PUMPED.description));
  assert.ok(whole || sealed, prompts.join("\n----\n"));
});

// (fails before: no — a guard: the switch off is version 18's coding agent as a lead; and the switch follows the session)
test("with engine.supervise off a coding agent leads as before: version 18's part and tools, woken by the report alone; switched off in a session that read along, its next turn's tools are the plain ones", async () => {
  const id = await newSession({ supervise: false });
  const t = await whole(id, `~mcpcall agent ${JSON.stringify(UNWATCHED)}`);
  assert.equal(t.status, 200, JSON.stringify(t.json));
  const first = /** @type {any} */ (promptWith(`~mcpcall agent ${JSON.stringify(UNWATCHED)}`));
  const opened = lines(join(logs, "calls.jsonl")).find((c) => c.method === "session/new" && c.sessionId === first.sessionId);
  // The plain lines, with the line that names its workers' model after their first (TG2-D47, version 26).
  assert.ok(String(opened?.system).includes(String(PROMPT.lead).replace("\n", "\n- Your workers run on m-1.\n")) && !String(opened?.system).includes(String(PROMPT.leadLooksOwn)), String(opened?.system));
  const listed = await listedAt(first.mcpUrl);
  assert.deepEqual([listed.worker.description, listed.wait.description], [TOOL_TEXT.worker, TOOL_TEXT.teamWait]);
  const prompts = promptsOf(first.sessionId).map((p) => String(p.text));
  assert.equal(prompts.length, 2, "the developer's prompt, then the report's wake");
  assert.ok(prompts[1].includes("SCOUT REPORT: mapped, unwatched.") && !prompts.some((p) => p.includes("a look at your workers")), prompts.join("\n----\n"));
  const { notes } = await notesOf(t.id);
  assert.ok(notes.includes("acp: cli does not read along with its workers (engine.supervise is off, or Filament keeps no run log here): its wait answers with a line for each of them"), notes.join("\n"));
  assert.deepEqual((await runEvents(t.id)).filter((e) => e.type === "look"), []);

  // A session that read along, switched off: Filament's MCP server lists the plain tools from its next turn.
  const on = await newSession({});
  assert.equal((await whole(on, "hello, lead")).status, 200);
  const before = /** @type {any} */ (promptWith("hello, lead"));
  assert.equal((await listedAt(before.mcpUrl)).wait.description, TOOL_TEXT.teamWaitOwn);
  const patched = await shim.api(`/api/sessions/${encodeURIComponent(on)}/settings`, { method: "PATCH", body: { patch: { engine: { supervise: false } } } });
  assert.equal(patched.status, 200, await patched.clone().text());
  assert.equal((await whole(on, "hello again, lead")).status, 200);
  const after = /** @type {any} */ (promptWith("hello again, lead"));
  const now = await listedAt(after.mcpUrl);
  assert.deepEqual([now.worker.description, now.wait.description], [TOOL_TEXT.worker, TOOL_TEXT.teamWait]);
});

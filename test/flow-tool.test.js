// @ts-check
// The main agent's flow tool (HarnessV4_OneAgent_Plan OA3, OA-D7): its words for each action, its refusals in the
// runner's words, the person's switch, and where it is offered — over Filament's MCP server (Claude Code, Codex,
// Cursor) only to a harness chat's own agent with its switch on; the loop's offer is the throwaway's test
// (flow-api.test.js). It never starts a flow; on a flow the person started In place it acts (OA4).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { FLOW_ACTIONS, FLOW_OFF, FLOW_SWITCHED_OFF, FLOW_TOOL, flowAtOf, flowCall } from "../src/app/agent/flow-tool.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentTurns } from "../src/app/agent-inbox.js";
import { LOOP_TOOL_NAMES } from "../src/services/session-settings.js";
import { flowOf } from "../src/core/flow.js";
import { cardOf } from "../src/core/tool-vocab.js";

const ROSTER = { cards: [{ tag: "pm", name: "PM" }, { tag: "designer", name: "Designer" }], teams: [{ key: "10x-engineer", name: "10x Engineer" }] };
const STEPS = [{ why: "First.", boxes: [{ id: "plan", agent: "pm", words: "Plan it" }] }, { boxes: [{ id: "build", team: "10x-engineer", words: "Build it", needs: ["plan"] }] }];
/** A refusal as the runner throws it. @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/** The flow runner's side of the tool, recorded. @param {{ on?: boolean, fires?: boolean, refuse?: Error | null }} [o] */
function deps({ on = true, fires = true, refuse = null } = {}) {
  /** @type {any[]} */
  const calls = [];
  const d = {
    calls,
    draft: (/** @type {string} */ chain, /** @type {any} */ input) => {
      calls.push(["draft", chain, input]);
      if (refuse) throw refuse;
      return flowOf({ goal: "the words", ...input }, ROSTER, { id: "fl-1", chainId: chain, at: 0, drawn: "agent" });
    },
    edit: (/** @type {string} */ chain, /** @type {any} */ input) => {
      calls.push(["edit", chain, input]);
      if (refuse) throw refuse;
      return flowOf({ goal: "the words", title: input.title, steps: input.steps || STEPS }, ROSTER, { id: "fl-1", chainId: chain, at: 0, drawn: "agent" });
    },
    read: (/** @type {string} */ chain) => `the flows of ${chain}`,
    fires: () => fires,
    on: () => on,
  };
  return d;
}

describe("the flow tool's calls", () => {
  test("draft: drawn, nothing runs; the flow in words with its ids and needs; the agent told to say why each step is where it is", async () => {
    const d = deps();
    const at = /** @type {any} */ (flowAtOf(d, "c1"));
    const r = await flowCall({ action: "draft", title: "Game engine", steps: STEPS }, at);
    assert.equal(r.ok, true);
    const text = /** @type {any} */ (r).text;
    assert.match(text, /^Drawn: the draft stands over the person's message box, where they change it and press Start — nothing runs before\. In your reply, say why each step is where it is/);
    assert.match(text, /- build: 10x Engineer \(team, writes\) · needs plan \(PM\) · "Build it"/);
    assert.deepEqual(d.calls.map((c) => [c[0], c[1]]), [["draft", "c1"]]);
  });
  test("its refusals in the runner's words; anything else thrown stays thrown", async () => {
    const at = /** @type {any} */ (flowAtOf(deps({ refuse: refused(409, "a flow is drawn only when the person asks for one with /flow") }), "c1"));
    assert.deepEqual(await flowCall({ action: "draft", steps: STEPS }, at), { ok: false, error: "Not drawn: a flow is drawn only when the person asks for one with /flow." });
    assert.deepEqual(await flowCall({ action: "edit", steps: STEPS }, at), { ok: false, error: "Not changed: a flow is drawn only when the person asks for one with /flow." });
    const broken = /** @type {any} */ (flowAtOf(deps({ refuse: new Error("disk full") }), "c1"));
    await assert.rejects(flowCall({ action: "draft", steps: STEPS }, broken), /disk full/);
  });
  test("read; edit by a title alone; an action it does not know; a draft with no steps", async () => {
    const d = deps();
    const at = /** @type {any} */ (flowAtOf(d, "c1"));
    assert.deepEqual(await flowCall({ action: "read" }, at), { ok: true, text: "the flows of c1" });
    const e = await flowCall({ action: "edit", title: "Renamed" }, at);
    assert.match(/** @type {any} */ (e).text, /^Changed: the draft stands/);
    assert.deepEqual(d.calls.at(-1), ["edit", "c1", { action: "edit", title: "Renamed" }]);
    assert.deepEqual(await flowCall({ action: "start" }, at), { ok: false, error: "flow takes an action: read, draft, edit, offer, box, stop; start is none of them." });
    assert.deepEqual(await flowCall({}, at), { ok: false, error: "flow takes an action: read, draft, edit, offer, box, stop." });
    assert.match(String(/** @type {any} */ (await flowCall({ action: "draft" }, at)).error), /^draft takes steps: /);
    assert.deepEqual(FLOW_ACTIONS, ["read", "draft", "edit", "offer", "box", "stop"], "no action starts a flow: box and stop act on one the person started in place");
    assert.deepEqual(FLOW_TOOL.input_schema.properties.action.enum, ["read", "draft", "edit", "offer", "box", "stop"]);
  });
  // OA6, OA-D14 (cases 2, 3). (fails before: yes — the tool took no offer)
  test("offer: a Run as a flow button under the reply, nothing drawn; a second refused in the service's words; a chat with none is told", async () => {
    /** @type {string[]} */
    const offered = [];
    const d = deps();
    const at = /** @type {any} */ (flowAtOf({ ...d, offer: (/** @type {string} */ chain) => {
      if (offered.length) throw refused(409, "this reply offers it already: one a reply");
      offered.push(chain);
    } }, "c1"));
    assert.deepEqual(await flowCall({ action: "offer" }, at), { ok: true, text: "Offered: a Run as a flow button stands under your reply; their press sends /flow with their words, and you draft it then. Nothing is drawn now: answer them as you would." });
    assert.deepEqual(await flowCall({ action: "offer" }, at), { ok: false, error: "Not offered: this reply offers it already: one a reply." });
    assert.deepEqual([offered, d.calls], [["c1"], []], "one offer, and nothing drawn");
    assert.deepEqual(await flowCall({ action: "offer" }, /** @type {any} */ (flowAtOf(deps(), "c1"))), { ok: false, error: "Not offered: this chat offers no flow here." });
    const broken = /** @type {any} */ (flowAtOf({ ...deps(), offer: () => { throw new Error("disk full"); } }, "c1"));
    await assert.rejects(flowCall({ action: "offer" }, broken), /disk full/);
    assert.deepEqual(cardOf("flow", { action: "offer" }), { kind: "flow", title: "Offer Run as a flow", subject: "" });
    assert.match(FLOW_TOOL.description, /offer, without \/flow, where their message lays out three or more steps in order or a review point: it puts a Run as a flow button under your reply \(their press is their \/flow\), draws nothing, and is used once a reply\./);
  });
  test("box and stop act on a flow it drives (OA4): what it did and where the flow stands; a refusal in its words", async () => {
    /** @type {any[]} */
    const acts = [];
    const flow = /** @type {any} */ ({ id: "fl-1", title: "A parser", goal: "g", state: "running", drives: true, hold: null, steps: [{ why: "", boxes: [{ id: "plan", name: "PM", state: "working", kind: "agent", needs: [] }] }] });
    const at = {
      chain: "c1",
      draft: () => flow,
      edit: () => flow,
      read: () => "",
      act: (/** @type {any} */ input) => {
        acts.push(input);
        if (input.box === "nope") throw refused(400, "name a box of the flow by its id");
        return { flow, did: "skipped PM" };
      },
    };
    assert.deepEqual(await flowCall({ action: "box", box: "plan", do: "skip", why: "not needed" }, at), {
      ok: true,
      text: "Done: you skipped PM. Flow in place · step 1 of 1 — PM at work. The person reads it on the flow; what comes of it reaches you here as it lands.",
    });
    assert.deepEqual(acts[0], { action: "box", box: "plan", do: "skip", why: "not needed" });
    assert.deepEqual(await flowCall({ action: "box", box: "nope", do: "skip" }, at), { ok: false, error: "Not done: name a box of the flow by its id." });
    assert.deepEqual(await flowCall({ action: "stop" }, { ...at, act: undefined }), { ok: false, error: "Not done: no flow of this chat is driven here." });
    assert.deepEqual(FLOW_TOOL.input_schema.properties.do.enum, ["stop", "skip", "retry", "go", "back"]);
    // An edit of the steps to come of a flow it drives says so.
    const r = await flowCall({ action: "edit", steps: [] }, at);
    assert.ok(r.ok && r.text.startsWith("Changed: the steps to come of the flow you drive"));
    // Its rows in the turn name the box and what it did to it.
    assert.deepEqual(cardOf("flow", { action: "box", box: "trends", do: "skip", why: "no trends" }), { kind: "flow", title: "Act on the flow", subject: "Skip trends" });
    assert.deepEqual(cardOf("flow", { action: "box", box: "check", do: "back", to: "plan", why: "an order" }), { kind: "flow", title: "Act on the flow", subject: "Send plan back from check" });
    assert.deepEqual(cardOf("flow", { action: "box", box: "check", do: "go", why: "fine" }), { kind: "flow", title: "Act on the flow", subject: "Go on past check" });
    assert.deepEqual(cardOf("flow", { action: "stop", why: "wrong goal" }), { kind: "flow", title: "Stop the flow", subject: "wrong goal" });
    assert.deepEqual(cardOf("flow", { action: "read" }), { kind: "flow", title: "Flows beside this chat", subject: "" });
  });

  test("a call after the person switched it off is refused in words; a chat that draws none has no place to call", async () => {
    const off = /** @type {any} */ (flowAtOf(deps({ on: false }), "c1"));
    assert.deepEqual(await flowCall({ action: "read" }, off), { ok: false, error: FLOW_SWITCHED_OFF });
    assert.equal(flowAtOf(deps({ fires: false }), "c1"), null, "a team's own chat");
    assert.equal(flowAtOf(deps(), null), null);
    assert.equal(flowAtOf(null, "c1"), null);
    assert.ok(LOOP_TOOL_NAMES.includes("flow"), "a switch of the chat's tools, as every loop tool's");
  });
});

describe("the flow tool over Filament's MCP server", () => {
  /** @param {ReturnType<typeof deps>} flow */
  const tools = (flow) => createAgentTools({ memory: null, memoryToolsOn: () => false, graphs: () => null, turns: createAgentTurns(), subagents: () => null, membersOf: () => null, flow });
  /** @param {any} [o] @returns {any} */
  const ctx = (o = {}) => ({ chain: "c1", cwd: ".", ...o });
  test("listed to a harness chat's own agent with its switch on, held by name as the team tool is; never to anyone else", () => {
    const t = tools(deps());
    const listed = t.list(ctx({ flow: true }));
    const def = listed.find((x) => x.name === "flow");
    assert.ok(def, "the chat's own agent has it");
    assert.equal(def.upfront, undefined, "the /flow message's line names it; loaded whole it would weigh on every request");
    assert.match(def.description, /when the person asks for one with \/flow: .* Never start one: /);
    assert.equal(t.has("flow"), true);
    assert.equal(t.list(ctx()).some((x) => x.name === "flow"), false, "a call not given it: a lead, a worker, a helper");
    assert.equal(tools(deps({ on: false })).list(ctx({ flow: true })).some((x) => x.name === "flow"), false, "switched off");
    assert.equal(tools(deps({ fires: false })).list(ctx({ flow: true })).some((x) => x.name === "flow"), false, "a team's own chat");
  });
  test("its call: the runner's draft for the call's chat; a session not given it is told so", async () => {
    const d = deps();
    const t = tools(d);
    const r = await t.call("flow", { action: "draft", steps: STEPS }, ctx({ flow: true }));
    assert.match(String(r.text), /^Drawn: /);
    assert.equal(r.isError, undefined);
    assert.deepEqual(d.calls.map((c) => c[1]), ["c1"]);
    assert.deepEqual(await t.call("flow", { action: "read" }, ctx()), { text: FLOW_OFF, isError: true });
  });
});

// @ts-check
// HarnessV4_Visuals_Plan E16 step 1, the server: the agent's visuals. Two tools of Filament's own, defined once and
// offered to every kind of agent in a harness chat, switched off together (VS-D1, VS-D2, VC-9); the input checked in
// words the agent acts on (VC-15, VC-16); Filament's own guide (VS-D13); a visual kept whole on its turn as it is drawn,
// under its call's id, and served whole by that id after the turn (VS-D9, VC-18, VC-30); what memory, a summary and a
// sub-agent's view read of one — its title, never its code (VC-32, VC-38). The loop draws, and so does a coding agent
// over Filament's MCP server.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GUIDE, SHOW_VISUAL_TOOL, VISUALS_OFF, VISUAL_GUIDE_TOOL, VISUAL_KINDS, showVisual, tooBigWords, visualGuide, visualOf, visualsKeptOn } from "../src/app/agent/visuals.js";
import { VISUAL_HOSTS, VISUAL_NAMES, isSvg } from "../src/core/visual-look.js";
import { SUBAGENT_OFF, argSummary, isLoopTool, loopToolArgs } from "../src/app/agent/tools.js";
import { disabledTools } from "../src/app/agent/turn.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { createAgentTools } from "../src/app/agent-tools.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { KNOBS, LOOP_TOOL_NAMES } from "../src/services/session-settings.js";
import { cardOf } from "../src/core/tool-vocab.js";
import { VISUAL_TITLE_MAX as TITLE_MAX, callLog, inBrief } from "../src/core/messages.js";
import { messagesTranscript, turnTranscript } from "../src/app/sessions/compaction.js";
import { renderMessage } from "../src/core/trim.js";
import { serverInstructions } from "../src/http/mcp.js";
import { Archive } from "../src/services/memory/archive.js";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { removeDirs, until } from "./helpers/wait.js";

/** A drawing whose code says a word nothing else in a test does: a reader that shows the code shows the word. */
const SVG = '<svg viewBox="0 0 680 120" width="100%"><rect x="20" y="20" width="200" height="60" rx="8" fill="var(--blue-fill)"/><text x="120" y="50">IN_THE_CODE</text></svg>';
const HTML = '<style>.k{color:var(--text)}</style><div class="k">IN_THE_CODE</div><script>document.querySelector(".k").textContent += "!";</script>';
const NOW = 1_800_000_000_000;

const dirs = /** @type {string[]} */ ([]);
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
/** A fresh archive with one chain and one turn, its message cap `cap`. @param {number} [cap] */
const archiveWithTurn = (cap = 1048576) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-visuals-"));
  dirs.push(dir);
  const a = new Archive({ file: join(dir, "a.db"), now: () => NOW, caps: { messageBytes: cap } });
  const chain = a.chainForKey("k", { cwd: "/p" });
  const { turnId } = /** @type {any} */ (a).beginTurn(chain.id, { requestId: "r1", model: "m", upstream: "u", userMessage: { role: "user", content: "draw it" } });
  return { a, chain, turnId: Number(turnId) };
};

describe("the input, in words the agent acts on", () => {
  // (fails before: yes — there was no show_visual)
  test("a title as a name, code that is an SVG drawing or an HTML fragment, up to four lines while it is drawn (VC-15, VC-16)", () => {
    const v = visualOf({ title: "  Compaction Flow! ", code: SVG, loading: ["Laying out boxes", "", "Drawing arrows", "  ", "Labels", "Legend", "Fifth", 3] });
    assert.ok(v.ok);
    assert.deepEqual(v.visual, { title: "compaction_flow", code: SVG, loading: ["Laying out boxes", "Drawing arrows", "Labels", "Legend"] });
    assert.deepEqual(/** @type {any} */ (visualOf({ title: "x", code: HTML, loading: "One line" })).visual.loading, ["One line"]);
    assert.ok(visualOf({ title: "x", code: "<header>The page's own header tag</header>" }).ok, "<header> is a fragment, not a page's <head>");
    const no = (/** @type {any} */ input) => /** @type {any} */ (visualOf(input)).error;
    assert.equal(no({ code: SVG }), "Not shown: show_visual needs a title — a short name in snake_case, such as compaction_flow. It heads the visual and names its file.");
    assert.equal(no({ title: "!!!", code: SVG }), no({ code: SVG }), "a title of no letters is none");
    assert.equal(no({ title: "a".repeat(TITLE_MAX + 1), code: SVG }), `Not shown: the title is ${TITLE_MAX + 1} characters; a title is a short name (${TITLE_MAX} at most). Say the rest in your answer.`);
    assert.equal(no({ title: "x", code: "  \n" }), "Not shown: show_visual needs code — an SVG drawing (<svg …>…</svg>), or an HTML fragment with its <style> and <script>.");
    assert.equal(no({ title: "x" }), no({ title: "x", code: "" }));
    for (const page of ["<!DOCTYPE html><p>x</p>", "<html><p>x</p></html>", "<head><title>t</title></head><p>x</p>", "<div>x</div><body class='a'></body>", "<BODY>x</BODY>"])
      assert.equal(no({ title: "x", code: page }), "Not shown: the code is a whole page (it has <!DOCTYPE>, <html>, <head> or <body>). Send only what would go inside <body> — its <style> and <script> tags in it — and call show_visual again.", page);
    assert.equal(no({ title: "x", code: "graph LR; A-->B" }), "Not shown: the code starts with text, not a tag. Send an SVG drawing or an HTML fragment. A mermaid diagram goes in your answer as a ```mermaid block instead: the chat draws that by itself.");
    assert.ok(isSvg(SVG) && isSvg(`<?xml version="1.0"?>\n<!-- a note -->\n${SVG}`) && !isSvg(HTML));
  });

  // (fails before: yes — the same)
  test("a visual is kept, then answered as shown — never as seen (VS-D8); a refusal keeps nothing; with nowhere to show it, it is off", () => {
    /** @type {any[]} */
    const kept = [];
    const file = (/** @type {any} */ v, /** @type {any} */ at) => (kept.push({ v, at }), /** @type {const} */ ({ ok: true, bytes: 123, n: 4 }));
    const r = /** @type {any} */ (showVisual({ title: "flow", code: SVG }, { id: "c1", round: 2 }, file));
    assert.equal(r.text, "Shown to the developer in the chat as flow (123 bytes). They can see it and click in it; what they say comes as their next message.");
    assert.equal(r.n, 4, "the turn it is kept on, by its number: what a page reads it by (step 2)");
    assert.deepEqual(kept, [{ v: { title: "flow", code: SVG, loading: [] }, at: { id: "c1", round: 2 } }]);
    assert.match(/** @type {any} */ (showVisual({ title: "flow", code: SVG }, { id: "c2", round: 2 }, () => ({ ok: true, bytes: 40_000, n: 1 }))).text, /as flow \(39 KB\)\./);
    assert.match(/** @type {any} */ (showVisual({ code: SVG }, { id: "c3", round: 2 }, file)).error, /needs a title/);
    assert.equal(kept.length, 1, "a refused call keeps nothing");
    assert.deepEqual(showVisual({ title: "flow", code: SVG }, { id: "c4", round: 2 }, null), { ok: false, error: VISUALS_OFF });
    assert.equal(VISUALS_OFF, "Not run: visuals are off in this session.");
    assert.deepEqual(showVisual({ title: "flow", code: SVG }, { id: "c5", round: 2 }, () => ({ ok: false, error: "kept no more" })), { ok: false, error: "kept no more" });
    assert.equal(tooBigWords(2_000_000, 1048576), "Not shown: the visual is 1,953 KB, more than Filament keeps of one message (1,024 KB, memory.capture.messageCapBytes), so it could not be drawn again later. Draw it smaller, or as two visuals.");
  });
});

describe("Filament's guide (VS-D13)", () => {
  // (fails before: yes — there was no visual_guide)
  test("the common part, then one part for each kind asked, in the guide's order; kinds are refused in words", () => {
    assert.deepEqual([...VISUAL_KINDS], ["diagram", "chart", "mockup", "interactive"]);
    assert.deepEqual(visualGuide({ kinds: ["chart", "diagram"] }), { ok: true, text: [GUIDE.common, GUIDE.diagram, GUIDE.chart].join("\n\n") });
    assert.deepEqual(visualGuide({ kinds: "Mockup" }), { ok: true, text: [GUIDE.common, GUIDE.mockup].join("\n\n") });
    assert.deepEqual(visualGuide({ kinds: [] }), { ok: false, error: "visual_guide needs kinds: one or more of diagram, chart, mockup, interactive." });
    assert.deepEqual(visualGuide({}), visualGuide({ kinds: [] }));
    assert.deepEqual(visualGuide({ kinds: ["chart", "poster"] }), { ok: false, error: "visual_guide has a part for diagram, chart, mockup, interactive; poster is none of them." });
    assert.deepEqual(VISUAL_GUIDE_TOOL.input_schema.properties.kinds.items.enum, [...VISUAL_KINDS]);
  });

  // (fails before: yes — the same)
  test("its look is the module's — every color name and every host — and its words are Filament's alone", () => {
    for (const name of Object.keys(VISUAL_NAMES)) assert.ok(GUIDE.common.includes(`\`${name}\``), name);
    for (const host of VISUAL_HOSTS) assert.ok(GUIDE.common.includes(host.replace("https://", "")), host);
    for (const hue of ["blue", "red", "green", "gray"]) assert.ok(`--${hue}` in VISUAL_NAMES && `--${hue}-fill` in VISUAL_NAMES, hue);
    assert.ok(["--series-1", "--series-6", "--text", "--surface", "--line", "--accent", "--font", "--radius"].every((n) => n in VISUAL_NAMES));
    const all = [...Object.values(GUIDE), VISUAL_GUIDE_TOOL.description, SHOW_VISUAL_TOOL.description].join("\n");
    assert.doesNotMatch(all, /claude|anthropic|imagine|show_widget|read_me/i, "nothing of another product's");
    assert.match(GUIDE.common, /`filament\.ask\("Go with layout B"\)`, called on a click, writes those words into the developer's message box; they read them and press Send\. Nothing is sent for them/);
  });

  // (fails before: yes — step 5's drive: Codex centered a row of boxes in a 190-high viewBox, 55 px empty each side)
  test("a diagram is as tall as its drawing: the guide names the margin, not a usual height", () => {
    assert.match(GUIDE.diagram, /as tall as the drawing: about 24 px around it, no empty band above or below/);
    assert.doesNotMatch(GUIDE.diagram, /300 to 600/);
  });

  // (fails before: yes — the same) VC-10: an agent that draws without the guide has the basics in the tool itself.
  test("show_visual's own text carries what a plain drawing needs: a fragment, the viewBox, the names, the hosts", () => {
    assert.deepEqual(SHOW_VISUAL_TOOL.input_schema.required, ["title", "code"]);
    assert.deepEqual(Object.keys(SHOW_VISUAL_TOOL.input_schema.properties), ["title", "code", "loading"]);
    for (const words of ["never a whole page (no <!DOCTYPE>, <html>, <head> or <body>)", 'give an SVG viewBox and width="100%"', "take every color from the names the guide lists", "Read visual_guide first.", "cdnjs.cloudflare.com, cdn.jsdelivr.net, unpkg.com, esm.sh and Google Fonts", "you are told only that it was shown"])
      assert.ok(SHOW_VISUAL_TOOL.description.includes(words), words);
  });
});

describe("the archive keeps a visual whole on its turn, as it is drawn", () => {
  // (fails before: yes — a turn kept no visuals, and a loop's work reached the archive only at the turn's end)
  test("its code in the message store, its facts in the turn's meta; the same id replaces it; one over the message cap is refused, the meta untouched (VC-18)", () => {
    const { a, turnId } = archiveWithTurn(4096);
    assert.deepEqual(a.addTurnVisual(turnId, { id: "c1", title: "flow", code: SVG, loading: ["Drawing"], round: 1 }), { ok: true, bytes: Buffer.byteLength(SVG), n: 1 });
    const meta = a.turnMeta(turnId);
    assert.equal(meta.visuals.length, 1);
    assert.deepEqual({ ...meta.visuals[0], hash: typeof meta.visuals[0].hash }, { id: "c1", title: "flow", hash: "string", bytes: Buffer.byteLength(SVG), at: NOW, round: 1 });
    assert.ok(!JSON.stringify(meta).includes("IN_THE_CODE"), "the meta lists it; the code is in the message store");
    assert.deepEqual(a.turnVisual(turnId, "c1"), { id: "c1", title: "flow", bytes: Buffer.byteLength(SVG), at: NOW, round: 1, code: SVG, loading: ["Drawing"] });
    assert.equal(a.turnVisual(turnId, "nope"), null);
    // The same call again (an agent that drew it again under the same id): one visual, the newer.
    a.addTurnVisual(turnId, { id: "c1", title: "flow", code: HTML });
    a.addTurnVisual(turnId, { id: "c2", title: "by_a_helper", code: SVG, by: "sa_1" });
    assert.deepEqual(a.turnMeta(turnId).visuals.map((/** @type {any} */ v) => [v.id, v.bytes, v.by ?? null, v.round ?? null]), [["c1", Buffer.byteLength(HTML), null, null], ["c2", Buffer.byteLength(SVG), "sa_1", null]]);
    assert.equal(/** @type {any} */ (a.turnVisual(turnId, "c1")).code, HTML);
    const big = `<svg viewBox="0 0 680 100">${"x".repeat(5000)}</svg>`;
    const over = a.addTurnVisual(turnId, { id: "c3", title: "big", code: big });
    assert.equal(over.ok, false);
    assert.equal(/** @type {any} */ (over).cap, 4096);
    assert.ok(/** @type {any} */ (over).bytes > 4096);
    assert.equal(a.turnMeta(turnId).visuals.length, 2, "nothing kept of it");
    // The refusals as the agent reads them.
    assert.deepEqual(visualsKeptOn(a, turnId)({ title: "big", code: big, loading: [] }, { id: "c3", round: null }), { ok: false, error: tooBigWords(/** @type {any} */ (over).bytes, 4096) });
    assert.deepEqual(visualsKeptOn(a, 9999)({ title: "flow", code: SVG, loading: [] }, { id: "c4", round: null }), { ok: false, error: "Not shown: Filament could not keep the visual (Archive: no turn 9999)." });
    a.close();
  });
});

describe("the tools in every agent's set", () => {
  // (fails before: yes — no set had them)
  test("defined once, after the loop's own tools for the agent, a lead and a sub-agent; show_visual's switch takes the guide with it (VC-9); the session's switch is the schema's", () => {
    for (const args of [{}, { lead: true }, { disabled: SUBAGENT_OFF }, { graph: true }]) {
      const set = loopToolArgs(/** @type {any} */ (args));
      assert.equal(set.find((t) => t.name === "show_visual"), SHOW_VISUAL_TOOL, JSON.stringify(args));
      assert.equal(set.find((t) => t.name === "visual_guide"), VISUAL_GUIDE_TOOL);
      const at = set.findIndex((t) => t.name === "visual_guide");
      assert.equal(set[at + 1].name, "show_visual", "the guide, then the tool");
    }
    for (const args of [{ disabled: ["show_visual"] }, { lead: true, disabled: ["show_visual"] }, { disabled: [...SUBAGENT_OFF, "show_visual"] }])
      assert.ok(!loopToolArgs(/** @type {any} */ (args)).some((t) => t.name === "show_visual" || t.name === "visual_guide"), JSON.stringify(args));
    assert.ok(LOOP_TOOL_NAMES.includes("show_visual") && !LOOP_TOOL_NAMES.includes("visual_guide"), "one switch, show_visual's");
    assert.ok(/** @type {any} */ (KNOBS["loop.tools"]).options.includes("show_visual"));
    assert.deepEqual(disabledTools({ show_visual: false, plan: true }), ["show_visual"]);
    assert.ok(isLoopTool("show_visual") && isLoopTool("visual_guide"));
  });

  // (fails before: yes — both read as a tool of no kind)
  test("their cards and argument lines: Draw with the title, the guide with the kinds", () => {
    assert.equal(argSummary("show_visual", { title: "spend_by_day", code: SVG }), "spend_by_day");
    assert.equal(argSummary("visual_guide", { kinds: ["diagram", "chart"] }), "diagram, chart");
    assert.deepEqual(cardOf("show_visual", { title: "spend_by_day", code: SVG }), { kind: "visual", title: "Draw", subject: "spend_by_day" });
    assert.deepEqual(cardOf("visual_guide", { kinds: ["chart"] }), { kind: "visual-guide", title: "Read the visual guide", subject: "chart" });
  });
});

describe("what a reader of the session reads of a visual: its title and what it is, never its code (VC-32, VC-38)", () => {
  const call = (/** @type {string} */ name, /** @type {string} */ code) => ({ role: "assistant", content: [{ type: "text", text: "Here it is." }, { type: "tool_use", id: "c1", name, input: { title: "flow", code } }] });
  const shown = { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "Shown to the developer in the chat as flow (300 bytes)." }] };

  // (fails before: yes — memory, a summary's writer and a sub-agent's view read a call's input whole)
  test("memory's call log, the summary's transcript, a sub-agent's view of the session and a slice's text, in every wire shape", () => {
    for (const name of ["show_visual", "mcp__filament__show_visual"]) {
      const convo = [{ role: "user", content: "draw it" }, call(name, SVG), shown];
      assert.deepEqual(callLog(convo), [{ tool: name, input: `{"title":"flow","drew":"an SVG drawing of ${SVG.length} characters, shown to the developer"}`, ok: true }]);
      const summary = turnTranscript({ n: 1, user: convo[0], work: [convo[1], convo[2]], final: { role: "assistant", content: [{ type: "text", text: "Done." }] } });
      assert.ok(summary.includes(`Tool call ${name}: {"title":"flow"`) && !summary.includes("IN_THE_CODE"), summary);
      const view = messagesTranscript(convo);
      assert.ok(view.includes('"title":"flow"') && !view.includes("IN_THE_CODE"), view);
      assert.ok(!renderMessage(convo[1]).includes("IN_THE_CODE") && renderMessage(convo[1]).includes('"title":"flow"'));
    }
    // OpenAI's shapes carry the input as a JSON string.
    const args = JSON.stringify({ title: "flow", code: HTML });
    for (const m of [{ role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "show_visual", arguments: args } }] }, { type: "function_call", call_id: "c1", name: "show_visual", arguments: args }]) {
      const line = renderMessage(m);
      assert.ok(line.includes("an HTML fragment of") && !line.includes("IN_THE_CODE"), line);
    }
    assert.deepEqual(inBrief("show_visual", args), { title: "flow", drew: `an HTML fragment of ${HTML.length} characters, shown to the developer` });
    const read = { path: "a.txt" };
    assert.equal(inBrief("read", read), read, "any other call is itself");
    assert.equal(inBrief("show_visual", "not json"), "not json");
  });
});

describe("the loop draws", () => {
  const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
  const answer = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  /** @param {any[][]} replies @param {import("../src/app/agent/visuals.js").FileVisual | null} visuals */
  const run = (replies, visuals) => {
    let n = 0;
    /** @type {any[][]} */
    const seen = [];
    /** @type {any[]} */
    const events = [];
    const out = runAgentTurn(/** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
      model: "m",
      messages: [{ role: "user", content: "draw the flow" }],
      system: "s",
      tools: loopToolArgs({}),
      modeNow: () => "edit",
      root: tmpdir(),
      readerModel: "",
      maxTokens: 100,
      call: async (/** @type {any} */ { body }) => {
        seen.push(structuredClone(body.messages));
        return answer(replies[n++] || [{ type: "text", text: "Done." }]);
      },
      costOf: () => 0,
      runHand: async () => {
        throw new Error("no hand runs here");
      },
      delegateRead: null,
      unattended: false,
      mailbox: null,
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink,
      signal: null,
      resume: null,
      visuals,
    }));
    return { out, seen, events };
  };
  const resultsOf = (/** @type {any[]} */ msgs) => msgs.at(-1).content.filter((/** @type {any} */ c) => c?.type === "tool_result");

  // (fails before: yes — the loop answered show_visual as no tool of its own)
  test("the guide answers; the visual is kept under its call's id with its round, said on the run, and answered shown; a refusal is the call's error", async () => {
    /** @type {any[]} */
    const kept = [];
    /** @type {import("../src/app/agent/visuals.js").FileVisual} */
    const file = (v, at) => (kept.push({ v, at }), { ok: true, bytes: Buffer.byteLength(v.code), n: 7 });
    const { out, seen, events } = run([[toolUse("g1", "visual_guide", { kinds: ["diagram"] })], [toolUse("v1", "show_visual", { title: "Flow", code: "<!DOCTYPE html>" }), toolUse("v2", "show_visual", { title: "Flow", code: SVG })]], file);
    assert.equal((await out).status, "done");
    assert.equal(resultsOf(seen[1])[0].content, [GUIDE.common, GUIDE.diagram].join("\n\n"));
    const [bad, good] = resultsOf(seen[2]);
    assert.deepEqual([bad.is_error, bad.content], [true, `Error: ${/** @type {any} */ (visualOf({ title: "Flow", code: "<!DOCTYPE html>" })).error}`]);
    assert.equal(good.is_error, undefined);
    assert.equal(good.content, `Shown to the developer in the chat as flow (${Buffer.byteLength(SVG)} bytes). They can see it and click in it; what they say comes as their next message.`);
    const start = events.find((e) => e.type === "tool-start" && e.id === "v2");
    assert.deepEqual(kept, [{ v: { title: "flow", code: SVG, loading: [] }, at: { id: "v2", round: start.round } }]);
    assert.deepEqual(events.filter((e) => e.type === "visual"), [{ type: "visual", round: start.round, id: "v2", title: "flow", bytes: Buffer.byteLength(SVG), turn: 7 }]);
    assert.deepEqual(events.filter((e) => e.type === "tool-start").map((e) => e.args), ["diagram", "Flow", "Flow"]);
  });

  // (fails before: yes — the same)
  test("where nothing keeps it — a turn nobody's chat draws — the call is off, in words", async () => {
    const { out, seen } = run([[toolUse("v1", "show_visual", { title: "flow", code: SVG })]], null);
    await out;
    const [r] = resultsOf(seen[1]);
    assert.deepEqual([r.is_error, r.content], [true, `Error: ${VISUALS_OFF}`]);
  });
});

describe("a coding agent's visual tools (agent-tools.js)", () => {
  /** @param {any} memory */
  const toolsOver = (memory) => createAgentTools({ memory, memoryToolsOn: () => false, graphs: () => null, turns: { get: () => null }, subagents: () => null, membersOf: () => null });
  const ctx = { cwd: "/p", upstream: "cli", chain: "c1", turn: null, graph: false };

  // (fails before: yes — a coding agent had no visual tools)
  test("listed where its chat shows them; a call is kept under the id and round of the agent's own call, by its sub-agent, and said on the run", async () => {
    const { a, turnId } = archiveWithTurn();
    const tools = toolsOver({ archive: a });
    assert.ok(!tools.list(ctx).some((t) => t.name.includes("visual")));
    const listed = tools.list({ ...ctx, visuals: true });
    // The chat's own recall rides beside them, in any chat whose record is open (the owner's of 11-06).
    assert.deepEqual(listed.filter((t) => t.name !== "filament_recall").map((t) => [t.name, t.inputSchema]), [["visual_guide", VISUAL_GUIDE_TOOL.input_schema], ["show_visual", SHOW_VISUAL_TOOL.input_schema]]);
    assert.ok(listed.some((t) => t.name === "filament_recall"));
    assert.ok(tools.has("show_visual") && tools.has("visual_guide"));
    assert.equal((await tools.call("visual_guide", { kinds: ["chart"] }, ctx)).text, [GUIDE.common, GUIDE.chart].join("\n\n"), "the guide is words: it answers wherever it is called");
    assert.deepEqual(await tools.call("visual_guide", {}, ctx), { text: "visual_guide needs kinds: one or more of diagram, chart, mockup, interactive.", isError: true });
    assert.deepEqual(await tools.call("show_visual", { title: "flow", code: SVG }, ctx), { text: VISUALS_OFF, isError: true }, "switched off since the session was given it");
    assert.deepEqual(await tools.call("show_visual", { title: "flow", code: SVG }, { ...ctx, visuals: true }), { text: "Not shown: no turn of the developer's runs in this session now, so there is no chat to draw in.", isError: true });
    /** @type {any[]} */
    const said = [];
    /** @type {string[]} */
    const asked = [];
    const on = { ...ctx, visuals: true, turn: String(turnId), by: { id: "sa_1", exchange: 0 }, emit: (/** @type {any} */ e) => said.push(e), callOf: async (/** @type {string} */ name) => (asked.push(name), { id: "toolu_9", round: 3 }) };
    const r = await tools.call("show_visual", { title: "Flow", code: SVG, loading: ["Drawing"] }, on);
    assert.equal(r.text, `Shown to the developer in the chat as flow (${Buffer.byteLength(SVG)} bytes). They can see it and click in it; what they say comes as their next message.`);
    assert.deepEqual(asked, ["show_visual"]);
    assert.deepEqual(said, [{ type: "visual", id: "toolu_9", round: 3, title: "flow", bytes: Buffer.byteLength(SVG), turn: 1 }]);
    assert.deepEqual(a.turnVisual(turnId, "toolu_9"), { id: "toolu_9", title: "flow", bytes: Buffer.byteLength(SVG), at: NOW, by: "sa_1", exchange: 0, round: 3, code: SVG, loading: ["Drawing"] });
    // A bridge that cannot say which call it came in (Cursor's): an id of Filament's, no round.
    said.length = 0;
    await tools.call("show_visual", { title: "second", code: HTML }, { ...on, by: null, callOf: null });
    assert.match(said[0].id, /^v[0-9a-f]{12}$/);
    assert.equal(said[0].round, null);
    assert.equal(/** @type {any} */ (a.turnVisual(turnId, said[0].id)).code, HTML);
    assert.deepEqual(await tools.call("show_visual", { title: "page", code: "<html></html>" }, on), { text: /** @type {any} */ (visualOf({ title: "page", code: "<html></html>" })).error, isError: true });
    assert.equal(a.turnMeta(turnId).visuals.length, 2, "a refused call keeps nothing");
    a.close();
  });

  // (fails before: yes — a helper no turn launched had nowhere to keep a picture: "no turn … no chat to draw in")
  test("a helper no turn launched keeps its picture on its session, said so on its run; the main seat with no turn still has none (VS-D48)", async () => {
    const { a, chain, turnId } = archiveWithTurn();
    const tools = toolsOver({ archive: a });
    /** @type {any[]} */
    const said = [];
    const helper = { ...ctx, chain: chain.id, visuals: true, turn: null, by: { id: "sa_2", exchange: 1 }, emit: (/** @type {any} */ e) => said.push(e), callOf: async () => ({ id: "toolu_h", round: 2 }) };
    const r = await tools.call("show_visual", { title: "login wireframe", code: HTML }, helper);
    assert.ok(!r.isError, r.text);
    assert.deepEqual(said, [{ type: "visual", id: "toolu_h", round: 2, title: "login_wireframe", bytes: Buffer.byteLength(HTML), session: true }]);
    assert.deepEqual(a.chainVisual(chain.id, "toolu_h"), { id: "toolu_h", title: "login_wireframe", bytes: Buffer.byteLength(HTML), at: NOW, by: "sa_2", exchange: 1, round: 2, code: HTML, loading: [] });
    assert.equal(a.turnMeta(turnId).visuals, undefined, "no turn holds it");
    assert.equal(a.chainVisual(chain.id, "nope"), null);
    assert.deepEqual(await tools.call("show_visual", { title: "flow", code: SVG }, { ...helper, by: null }), { text: "Not shown: no turn of the developer's runs in this session now, so there is no chat to draw in.", isError: true }, "the session's own agent draws on its turn only");
    a.close();
  });

  // (fails before: yes — the coding agent's run said the picture with no turn and no session: the helper's card read
  // "the page does not know its turn yet", and its report to the agent that asked named no picture)
  test("a coding agent's run says where its picture is kept as the call said it: on its turn, or on the session for a helper no turn launched", () => {
    /** @type {any[]} */
    const events = [];
    const run = createAgentRun({ publish: (e) => events.push(e), sink: { breakBlock: () => 0 } });
    run.take({ type: "visual", id: "toolu_h", round: 2, title: "login_wireframe", bytes: 9, session: true });
    run.take({ type: "visual", id: "toolu_t", round: 3, title: "flow", bytes: 7, turn: 4 });
    run.take({ type: "visual", id: "v1", round: null, title: "map", bytes: 5 });
    const said = events.filter((e) => e.type === "visual").map(({ id, round, session, turn }) => ({ id, round, session, turn }));
    assert.deepEqual(said, [
      { id: "toolu_h", round: 2, session: true, turn: undefined },
      { id: "toolu_t", round: 3, session: undefined, turn: 4 },
      { id: "v1", round: 1, session: undefined, turn: undefined },
    ]);
  });

  // (fails before: yes — the server's words said nothing of a picture)
  test("Filament's MCP server names show_visual as the agent connects, where its chat shows visuals", () => {
    assert.match(serverInstructions({ cwd: "/p", visuals: true }), / Its `show_visual` draws a picture in the person's chat \(a diagram, a chart, a screen, a small thing to try\) after `visual_guide` gives Filament's rules for it\. The project folder is \/p\.$/);
    assert.ok(!serverInstructions({ cwd: "/p" }).includes("show_visual"));
  });
});

// ---------------------------------------------------------------------------------------------------
// Through the app: a harness chat's loop and a coding agent draw; a reload gets the whole code back
// ---------------------------------------------------------------------------------------------------

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {string} */
  let logs;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-visuals-app-"));
    logs = mkdtempSync(join(tmpdir(), "filament-visuals-logs-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      keep: true,
      configure: (cfg, { dataDir }) => {
        const cli = { id: "cli", name: "cli", type: "acp", enabled: true, acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(logs, "calls.jsonl"), FAKE_ACP_LOG: join(logs, "prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_MCP_CAPS: "http" }, cwdDefault: dataDir, permissions: "allow-all", clientBridge: "full" } };
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }, cli];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder-*", upstream: "cli", upstreamModel: "{model}", enabled: true },
        ];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.memory.engine = { ...(cfg.memory.engine || {}), autoInstall: false };
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root, logs);
  });
  const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
  const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
  const say = (/** @type {any} */ json) => (json.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join("");
  /** @param {string} model @param {any} [settings] */
  const create = async (model, settings = {}) => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model, preset: "plain", settings } });
    assert.equal(r.status, 200, await r.clone().text());
    return String((await r.json()).id);
  };
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200);
    return { runId: String(r.headers.get("x-filament-request-id")), text: say(await r.json()) };
  };
  const lastTurn = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json()).turns.at(-1);
  const visualAt = (/** @type {string} */ id, /** @type {number} */ n, /** @type {string} */ vid) => shim.api(`/api/sessions/${encodeURIComponent(id)}/turns/${n}/visuals/${encodeURIComponent(vid)}`);
  const runEvents = async (/** @type {string} */ runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  const toolNames = (/** @type {any} */ call) => (call.body.tools || []).map((/** @type {any} */ t) => t.name);

  // (fails before: yes — VC-30: nothing kept a visual, and no route served one)
  test("the loop in a harness chat is offered both, draws, and the turn lists the visual; its code comes back whole by its id after the turn", async () => {
    const id = await create("agent/brain-model");
    let round = 0;
    /** @type {string[]} */
    let offered = [];
    brain = (call) => {
      round++;
      if (round === 1) {
        offered = toolNames(call);
        return reply([toolUse("v1", "show_visual", { title: "Spend by day", code: SVG, loading: ["Adding the days"] })], "tool_use");
      }
      return reply([{ type: "text", text: "Drawn." }]);
    };
    const { runId, text } = await turn(id, "draw the spend");
    assert.equal(text, "Drawn.");
    assert.ok(offered.includes("visual_guide") && offered.includes("show_visual"), offered.join(", "));
    const t = await lastTurn(id);
    const said = (await runEvents(runId)).find((/** @type {any} */ e) => e.type === "visual");
    assert.deepEqual(t.visuals, [{ id: "v1", title: "spend_by_day", bytes: Buffer.byteLength(SVG), at: t.visuals[0].at, round: said.round }]);
    assert.ok(Number.isFinite(t.visuals[0].at));
    assert.deepEqual([said.id, said.title, said.bytes], ["v1", "spend_by_day", Buffer.byteLength(SVG)]);
    // (fails before: yes — the event said `n`, which the run log overwrites with its own number for each event, so a
    // page drew the visual from a turn that was not its own; and the session's call to the model dropped `onCall`,
    // so nothing was said while the model wrote the visual)
    assert.equal(said.turn, t.n, "the turn it is kept on");
    const writing = (await runEvents(runId)).filter((/** @type {any} */ e) => e.type === "visual-writing");
    assert.ok(writing.some((/** @type {any} */ e) => e.id === "v1" && e.title === "spend_by_day" && e.round === said.round), `said while its model wrote it (VS-D11): ${JSON.stringify(writing)}`);
    const r = await visualAt(id, t.n, "v1");
    assert.equal(r.status, 200);
    const v = await r.json();
    assert.deepEqual([v.n, v.id, v.title, v.code, v.loading], [t.n, "v1", "spend_by_day", SVG, ["Adding the days"]], "the whole code, after the turn");
    assert.equal((await visualAt(id, t.n, "nope")).status, 404);
    assert.equal((await visualAt(id, 99, "v1")).status, 404);
    // VC-36: it lives in its turn, so the session's delete takes it.
    assert.equal((await shim.api(`/api/memory/sessions/${encodeURIComponent(id)}/delete`, { method: "POST", body: {} })).status, 200);
    assert.equal((await visualAt(id, t.n, "v1")).status, 404, "gone with its session");
  });

  // (fails before: yes — the same: VS-D2, VC-9)
  test("a chat that switched visuals off is offered neither, nor an outside client's request, proxied as sent", async () => {
    /** @type {string[][]} */
    const offered = [];
    brain = (call) => (offered.push(toolNames(call)), reply([{ type: "text", text: "No picture." }]));
    const id = await create("agent/brain-model", { loop: { tools: { show_visual: false } } });
    assert.equal((await turn(id, "draw nothing")).text, "No picture.");
    const outside = await shim.post("/v1/messages", { model: "brain-model", max_tokens: 100, messages: [{ role: "user", content: "hello from a client" }] }, { "x-filament-cwd": root });
    assert.equal(outside.status, 200, await outside.clone().text());
    assert.equal(offered.length, 2, await outside.clone().text());
    const [chat, client] = offered;
    assert.ok(chat.includes("ask") && !chat.includes("show_visual") && !chat.includes("visual_guide"), chat.join(", "));
    assert.ok(!client.includes("ask") && !client.includes("show_visual") && !client.includes("visual_guide"), client.join(", "));
  });

  // (fails before: yes — a coding agent had no visual tools)
  test("a coding agent draws over Filament's MCP server: kept under its own call's id and round, the turn lists it, and its code comes back whole", async () => {
    const id = await create("coder-1");
    const guide = await turn(id, '~mcpcall visual_guide {"kinds":["chart"]}');
    assert.ok(guide.text.includes("mcp:# Drawing a visual in Filament"), guide.text.slice(0, 200));
    const { runId, text } = await turn(id, `~mcpcall show_visual ${JSON.stringify({ title: "flow", code: SVG })}`);
    assert.match(text, /mcp:Shown to the developer in the chat as flow \(\d+ bytes\)\./);
    const t = await lastTurn(id);
    assert.equal(t.visuals.length, 1);
    const said = (await runEvents(runId)).find((/** @type {any} */ e) => e.type === "visual");
    const card = (await runEvents(runId)).find((/** @type {any} */ e) => e.type === "tool-start" && e.id === said.id);
    assert.ok(card, "kept under the id of the agent's own call, whose card the run drew");
    // (fails before: no — a guard: step 2's look asked whether a coding agent's call, named by its MCP server, drew the
    // same row as the loop's; it does)
    assert.deepEqual([card.card?.kind, card.card?.subject], ["visual", "flow"], `its row says Drew and the title, as the loop's does: ${JSON.stringify(card.card)} (${card.name})`);
    assert.deepEqual(t.visuals[0], { id: said.id, title: "flow", bytes: Buffer.byteLength(SVG), at: t.visuals[0].at, round: card.round });
    assert.equal(said.round, card.round);
    assert.equal(said.turn, t.n, "the turn it is kept on, which the run log does not number over");
    const v = await (await visualAt(id, said.turn, said.id)).json();
    assert.equal(v.code, SVG);
  });

  const HELPER = "You are a sub-agent run by Filament";
  // Product's words, which take in the Designer's ("Teams, improved and kept" of 11-03).
  const DESIGNER = "You think as the product's owner and its designer";
  /** The text of the newest message's tool result, or null where it carries none. @param {any} call */
  const resultOf = (call) => {
    const last = (call.body.messages || []).at(-1);
    const r = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ b) => b?.type === "tool_result") : null;
    return r ? (typeof r.content === "string" ? r.content : (r.content || []).map((/** @type {any} */ b) => b.text || "").join("")) : null;
  };
  const listed = async (/** @type {string} */ id) => (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`)).json()).subagents;

  // (fails before: yes — memory's autopilot is off here, and a launched helper's turn was found only with it on: the
  // helper was offered no show_visual; nothing listed what it drew, and its report said nothing of it. HarnessV4_DesignPass
  // _Plan UX1: the report named the picture and nothing more, so the agent that asked could never read it)
  test("a helper the agent launched draws with memory's autopilot off: kept on the launching turn by it and its exchange, listed on its thread; its report names it sealed, and the agent opens it by its name (VC-60, VS-D50, UX1)", async () => {
    const id = await create("agent/brain-model");
    /** @type {string[]} */
    let helperTools = [];
    /** @type {string | null} */
    let toldMain = null;
    /** @type {string[]} */
    const opened = [];
    brain = (call) => {
      const result = resultOf(call);
      if (JSON.stringify(call.body.system ?? "").includes(HELPER)) {
        if (result == null) {
          helperTools = toolNames(call);
          return reply([toolUse("toolu_hv", "show_visual", { title: "helper flow", code: SVG })], "tool_use");
        }
        return reply([{ type: "text", text: "HELPER REPORT" }]);
      }
      if (result == null) return reply([toolUse("toolu_ag", "agent", { run_in_background: false, description: "draw the flow", prompt: "Draw the flow." })], "tool_use");
      if (toldMain == null) {
        toldMain = result;
        return reply([toolUse("toolu_pic", "envelope", { picture: "helper_flow" })], "tool_use");
      }
      opened.push(result);
      if (opened.length === 1) return reply([toolUse("toolu_none", "envelope", { picture: "no_such_one" })], "tool_use");
      return reply([{ type: "text", text: "MAIN DONE" }]);
    };
    assert.equal((await turn(id, "launch the drawer")).text, "MAIN DONE");
    assert.ok(helperTools.includes("show_visual"), helperTools.join(", "));
    const t = await lastTurn(id);
    const [sa] = await listed(id);
    assert.deepEqual(t.visuals, [{ id: "toolu_hv", title: "helper_flow", bytes: Buffer.byteLength(SVG), at: t.visuals[0].at, by: sa.id, exchange: 0, round: t.visuals[0].round }]);
    assert.equal((await (await visualAt(id, t.n, "toolu_hv")).json()).code, SVG);
    assert.deepEqual(sa.exchanges[0].drew, [{ id: "toolu_hv", title: "helper_flow", bytes: Buffer.byteLength(SVG), turn: t.n }]);
    assert.match(String(toldMain), new RegExp(`^HELPER REPORT\\n\\nIt drew helper_flow \\(${Buffer.byteLength(SVG)} bytes\\), shown to the developer\\. It waits sealed for you: open it with Filament's envelope tool, \\{"picture": "helper_flow"\\}, to read its code whole\\.`));
    assert.ok(!String(toldMain).includes(SVG), "the report carries none of its code");
    assert.ok(opened[0].startsWith(`[Filament: picture helper_flow, opened — drawn by Builder (${sa.id}) for "draw the flow", `), opened[0].slice(0, 200));
    assert.ok(opened[0].endsWith(`Its code, whole:]\n${SVG}`), "its code whole, last");
    assert.equal(opened[1], `No picture named "no_such_one". The pictures this chat's agents drew, newest first:\n- helper_flow (toolu_hv), drawn by Builder (${sa.id}) for "draw the flow"\nOpen one by its name or its id.`);
  });

  // (fails before: yes — a saved agent the developer asked has no launching turn: it was offered no show_visual, and
  // nothing could keep its picture)
  test("Product, asked as a designer in a chat with no turn yet, draws: the session keeps it, by it and its exchange; it comes back by its id; the transcript and its thread list it; its answer passed on names it sealed, and your agent opens it by its name (VC-61, VS-D48, UX1)", async () => {
    const id = await create("agent/brain-model");
    /** @type {string[]} */
    let offered = [];
    brain = (call) => {
      if (!JSON.stringify(call.body.system ?? "").includes(DESIGNER)) return reply([{ type: "text", text: "not the designer" }]);
      if (resultOf(call) == null) {
        offered = toolNames(call);
        return reply([toolUse("toolu_dv", "show_visual", { title: "login wireframe", code: HTML, loading: ["Two layouts"] })], "tool_use");
      }
      return reply([{ type: "text", text: "Layout A reads first." }]);
    };
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents`, { method: "POST", body: { prompt: "Draw a login screen.", as: "product" } });
    assert.equal(r.status, 200, await r.clone().text());
    await until(async () => (await listed(id))[0]?.status === "done", "Product's answer", { timeoutMs: 20_000 });
    assert.ok(offered.includes("show_visual"), offered.join(", "));
    const [sa] = await listed(id);
    assert.deepEqual(sa.exchanges[0].drew, [{ id: "toolu_dv", title: "login_wireframe", bytes: Buffer.byteLength(HTML), session: true }]);
    const v = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/visuals/toolu_dv`)).json();
    assert.deepEqual([v.id, v.title, v.code, v.loading, v.by, v.exchange], ["toolu_dv", "login_wireframe", HTML, ["Two layouts"], sa.id, 0]);
    assert.equal((await shim.api(`/api/sessions/${encodeURIComponent(id)}/visuals/nope`)).status, 404);
    const tr = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
    assert.equal(tr.turns.length, 0, "no turn holds it");
    assert.deepEqual(tr.visuals, [{ id: "toolu_dv", title: "login_wireframe", bytes: Buffer.byteLength(HTML), at: tr.visuals[0].at, by: sa.id, exchange: 0, round: tr.visuals[0].round }]);

    // (fails before: yes — HarnessV4_DesignPass_Plan UX1, the owner's 10-24: the answer passed on named the mocks, and the
    // agent could never see them) Passed on with your next message, the answer names the picture sealed; your agent
    // opens it by its name, from the session that keeps it.
    /** @type {string | null} */
    let passed = null;
    /** @type {string | null} */
    let opened = null;
    brain = (call) => {
      const result = resultOf(call);
      if (result == null) {
        passed = JSON.stringify(call.body.messages);
        return reply([toolUse("toolu_open", "envelope", { picture: "login_wireframe" })], "tool_use");
      }
      opened = result;
      return reply([{ type: "text", text: "MAIN DONE" }]);
    };
    const sent = await shim.api(`/api/sessions/${encodeURIComponent(id)}/subagents/${sa.id}/send`, { method: "POST", body: { when: "next" } });
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.equal((await turn(id, "what do you make of it?")).text, "MAIN DONE");
    assert.ok(String(passed).includes(`It drew login_wireframe (${Buffer.byteLength(HTML)} bytes), shown to the developer. It waits sealed for you: open it with Filament's envelope tool, {\\"picture\\": \\"login_wireframe\\"}, to read its code whole.`), String(passed).slice(0, 2000));
    assert.ok(!String(passed).includes("IN_THE_CODE"), "none of its code went with the answer");
    assert.ok(String(opened).startsWith(`[Filament: picture login_wireframe, opened — drawn by Product (${sa.id}) for "Draw a login screen.", `), String(opened).slice(0, 300));
    assert.ok(String(opened).endsWith(`Its code, whole:]\n${HTML}`));
  });
});

// @ts-check
// The turn's story (HarnessV3-FixRound F2): a stopped turn's header reads one way, live and after a reload (item 11),
// and the calls a stop came before are drawn and counted the same live and after a reload (item 12).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";
import { alignEvents, foldWords } from "../src/ui/harness/lib/labels.js";
import { tallyOf } from "../src/ui/harness/conversation/turn.js";
import { turnsRead, cardsOf } from "./helpers/held-transcript.js";
import { archivedStubs } from "../src/ui/harness/conversation/tools/render.js";
import { factsOf, statusOf } from "../src/ui/harness/conversation/tools/layout.js";

describe("a stopped turn's header (item 11)", () => {
  // (fails before: yes — a reloaded stopped turn read "Worked for 9s", with "Stopped from the harness" in the footer)
  test("reads \"Stopped after …\" live and after a reload, and says who stopped it on hover", () => {
    const t0 = 1_790_000_000_000;
    const live = foldWords({ status: "stopped", startedAt: t0, endedAt: t0 + 9_000 });
    assert.deepEqual(live, { text: "Stopped after 9s", title: "stopped by you" });
    const reloaded = foldWords({ status: "done", startedAt: t0, endedAt: t0 + 9_000, stopped: { by: "harness" } });
    assert.deepEqual(reloaded, { text: "Stopped after 9s", title: "stopped from the harness" });
    assert.equal(foldWords({ status: "done", startedAt: t0, endedAt: t0 + 9_000, stopped: { by: "vscode" } }).title, "stopped by vscode");
    // (fails before: yes — a sub-agent's turn its lead, the chat's agent (its agent tool's stop, ag-stop) or Filament
    // stopped read "stopped by lead", "stopped by agent", "stopped by filament": the mark's own word, not the page's)
    assert.deepEqual(
      ["lead", "agent", "filament"].map((by) => foldWords({ status: "done", startedAt: t0, endedAt: t0 + 9_000, stopped: { by } }).title),
      ["stopped by its lead", "stopped by your agent", "stopped by Filament"],
    );
    assert.equal(foldWords({ status: "done", startedAt: t0, endedAt: t0 + 9_000, stopped: { by: "agent", forced: true } }).title, "force-stopped by your agent");
    assert.equal(foldWords({ status: "stopped", stopped: true, startedAt: t0, endedAt: t0 + 9_000 }).title, "stopped from the harness", "a follower's stop names no window");
    assert.deepEqual(foldWords({ status: "done", startedAt: t0, endedAt: t0 + 9_000, stopped: { by: "harness", forced: true } }), { text: "Stopped after 9s", title: "force-stopped from the harness" });
  });
  test("a turn that finished reads \"Worked for …\"; one too short to time reads one word", () => {
    const t0 = 1_790_000_000_000;
    assert.deepEqual(foldWords({ status: "done", startedAt: t0, endedAt: t0 + 65_000 }), { text: "Worked for 1m 5s", title: "" });
    assert.deepEqual(foldWords({ status: "done", startedAt: t0, endedAt: t0 + 200 }), { text: "Worked", title: "" });
    assert.deepEqual(foldWords({ status: "stopped", startedAt: t0, endedAt: t0 + 200 }), { text: "Stopped", title: "stopped by you" });
    assert.deepEqual(foldWords({ status: "done" }), { text: "Worked", title: "" }, "no times: no span");
  });
});

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
const sink = { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() { this.blocks += 1; }, count() { return this.blocks; } };
/** @param {Partial<import("../src/app/agent/loop.js").LoopArgs>} over */
const args = (over) =>
  /** @type {import("../src/app/agent/loop.js").LoopArgs} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "edit",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => reply([{ type: "text", text: "Done." }]),
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: { read: () => [] },
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink,
    signal: null,
    resume: null,
    ...over,
  });

/**
 * The turn as the page draws it live (its run's events) and as it draws it after a reload (the archive: the
 * transcript's counts and the cards of the turn's work, each call with its result), side by side.
 * @param {any[]} events @param {any} out
 */
const bothWays = (events, out) => {
  const aligned = alignEvents(events);
  const liveStubs = [...aligned.byRound.values()].flatMap((c) => c.order.map((/** @type {string} */ id) => c.tools.get(id)));
  const [turn] = turnsRead({ turns: [{ n: 1, turnId: 1, user: { role: "user", content: "go" }, work: out.work, final: { role: "assistant", content: out.final } }] });
  const pick = (/** @type {any} */ t) => ({ id: t.id, state: t.state, notRun: !!t.notRun, facts: factsOf(t), status: statusOf(t) });
  return {
    live: { tally: tallyOf(aligned), stubs: liveStubs.map(pick) },
    reloaded: { tally: { legs: turn.toolLegs, calls: turn.toolCalls }, stubs: archivedStubs(cardsOf(turn)).map(pick) },
  };
};

describe("the calls a stop came before (item 12)", () => {
  const notRunStub = (/** @type {string} */ id) => ({ id, state: "stopped", notRun: true, facts: "", status: { word: "Stopped", title: "not run: the turn was stopped before it started", soft: true } });

  // (fails before: yes — live, the round's two calls were never drawn: 0 legs, 0 calls; after a reload, 1 leg, 2 calls)
  test("a stop heard before the round's calls ran: drawn and counted alike, live and after a reload", async () => {
    /** @type {any[]} */
    const events = [];
    let reads = 0;
    const out = await runAgentTurn(args({
      call: async () => reply([toolUse("r1", "read", { path: "a.txt" }), toolUse("r2", "read", { path: "b.txt" })]),
      mailbox: { read: () => (++reads === 1 ? [{ kind: "stop", text: "enough" }] : []) },
      onEvent: (e) => events.push(e),
    }));
    assert.equal(out.status, "stopped");
    const { live, reloaded } = bothWays(events, out);
    assert.deepEqual(live, reloaded);
    assert.deepEqual(live.tally, { legs: 1, calls: 2 });
    assert.deepEqual(live.stubs, [notRunStub("r1"), notRunStub("r2")]);
  });

  // (fails before: yes — live, the call after the cut was missing: 1 call drawn against the archive's 2)
  test("a stop that lands while the round runs: the call it came before reads Not run both ways, the one that ran keeps its facts", async () => {
    /** @type {any[]} */
    const events = [];
    const stop = new AbortController();
    const out = await runAgentTurn(args({
      // The call after the cut is a write: reads next to each other run together (loop.js `onlyReads`).
      call: async () => reply([toolUse("r1", "read", { path: "a.txt" }), toolUse("r2", "write", { path: "b.txt", content: "x" })]),
      runHand: async (name) => {
        stop.abort();
        return `${name} ran`;
      },
      mailbox: { read: () => [], stopSignal: stop.signal },
      onEvent: (e) => events.push(e),
    }));
    assert.equal(out.status, "stopped");
    const { live, reloaded } = bothWays(events, out);
    assert.deepEqual(live.tally, reloaded.tally);
    assert.deepEqual(live.tally, { legs: 1, calls: 2 });
    assert.deepEqual(live.stubs.map((s) => s.state), reloaded.stubs.map((s) => s.state));
    assert.deepEqual(live.stubs[1], notRunStub("r2"));
    assert.deepEqual(reloaded.stubs[1], notRunStub("r2"));
    assert.equal(live.stubs[0].state, "done", "the call that ran is no Not run");
  });

  // (fails before: yes — the parked reply's other call was never drawn live)
  test("a resumed turn stopped at the gate: the parked reply's rest reads Not run both ways", async () => {
    /** @type {any[]} */
    const events = [];
    const parked = { role: "assistant", content: [toolUse("c1", "bash", { command: "echo hi" }), toolUse("r2", "read", { path: "a.txt" })] };
    let reads = 0;
    const out = await runAgentTurn(args({
      messages: [{ role: "user", content: "go" }, parked, { role: "user", content: "yes" }],
      mailbox: { read: () => (++reads === 1 ? [{ kind: "stop", text: "enough" }] : []) },
      onEvent: (e) => events.push(e),
      resume: {
        answer: "yes",
        paused: /** @type {any} */ ({ kind: "permission", convo: [{ role: "user", content: "go" }, parked], results: [], pending: parked.content[0], remaining: [parked.content[1]], round: 1, plan: null, root: tmpdir(), readerModel: "", heard: [], baseLen: 1, workFrom: 1 }),
      },
    }));
    assert.equal(out.status, "stopped");
    const r2 = events.filter((e) => e.id === "r2").map((e) => e.type);
    assert.deepEqual(r2, ["tool-start", "tool-end"]);
    const { live, reloaded } = bothWays(events, out);
    assert.deepEqual(live.stubs.find((s) => s.id === "r2"), notRunStub("r2"));
    assert.deepEqual(reloaded.stubs.find((s) => s.id === "r2"), notRunStub("r2"));
  });

  // Found on the way: a vetoed call read Vetoed live but Failed after a reload.
  test("a vetoed call reads Vetoed after a reload too, never Failed", async () => {
    /** @type {any[]} */
    const events = [];
    let reads = 0;
    const out = await runAgentTurn(args({
      call: async () => (reads < 2 ? reply([toolUse("w1", "write", { path: "a.txt", content: "x" })]) : reply([{ type: "text", text: "Fine." }])),
      mailbox: { read: () => (++reads === 1 ? [{ kind: "veto", text: "not that file" }] : []) },
      onEvent: (e) => events.push(e),
    }));
    const { live, reloaded } = bothWays(events, out);
    assert.equal(live.stubs[0].state, "vetoed");
    assert.deepEqual(reloaded.stubs[0], live.stubs[0]);
    assert.deepEqual(live.tally, reloaded.tally);
  });
});

describe("the status capsule's row (item 15; layout contract: the page boots a DOM at import)", () => {
  // (fails before: yes — the panel was absolute over the transcript's top-right corner, over its newest top message)
  test("it sits in the frame's flow between the header bar and the transcript, never over it", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync("src/ui/harness.css", "utf8");
    const rule = /\n\.status-panel \{([^}]*)\}/.exec(css)?.[1] || "";
    assert.match(rule, /position: relative;/);
    assert.match(rule, /flex: none;/, "a row of the frame's column");
    assert.match(rule, /min-height: 42px;/, "the row keeps its height while the card is open");
    assert.doesNotMatch(rule, /top:/);
    assert.doesNotMatch(css, /\.status-panel:not\(\.hidden\)\) \.transcript-inner \{ padding-top/, "no padding trick under a floating capsule");
    assert.match(/\.status-panel\.expanded \.sp-body \{([^}]*)\}/.exec(css)?.[1] || "", /position: absolute; top: 8px;/, "the card is a popover from its row");
    const aqua = readFileSync("src/ui/harness/aqua.css", "utf8");
    // On the panel itself, not under a `:has()` before a combinator (E37: each change restyled the whole page).
    assert.match(aqua, /\.conv-frame > \.status-panel:has\(~ \.find-bar:not\(\.hidden\)\) \{ --sp-right: 368px; \}/, "find steps it aside, not down over the transcript");
    // The frame is a column: the header, then the panel's row, then the transcript the timeline appends.
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    const panelAt = app.indexOf("shell.convFrame.append(statusPanel.el);");
    assert.ok(panelAt > 0 && panelAt < app.indexOf("const transcript = createTimeline(shell.convFrame"), "the row is in place before the transcript");
  });
});

describe("the fold header and footer read the one wording (item 11; source contract: the page boots a DOM at import)", () => {
  test("the header takes foldWords' text and title; the footer adds no second stop flag", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/ui/harness/conversation/turn.js", "utf8");
    assert.match(src, /const w = foldWords\(turn\);\s*\n\s*whole = w\.text;\s*\n\s*label = h\("span", \{ class: "work-words" \}, whole\);\s*\n\s*labelTitle = w\.title;/);
    assert.match(src, /h\("span", \{ class: "work-label", \.\.\.\(labelTitle \? \{ title: labelTitle \} : \{\}\) \}/);
    assert.doesNotMatch(src, /h\("span", \{ class: "a-flag[^"]*" \}, "Stopped/, "no \"Stopped by you\" / \"Stopped from the harness\" flag");
    assert.match(src, /const stop = turn\.status === "stopped" \|\| turn\.stopped \? "" : stopReasonText/, "a stopped turn's stop reason is no flag either");
  });
});

describe("after a Force stop the loop is muted (item 13)", () => {
  // (fails before: yes — with no muting, the loop's own stop line and its turn-state streamed after the turn had ended)
  test("what the loop still does once its wait ends reaches no event and no byte", async () => {
    const stop = new AbortController();
    const force = new AbortController();
    /** @type {() => void} */
    let release = () => {};
    const gate = new Promise((r) => { release = () => r(undefined); });
    /** @type {any[]} */
    const events = [];
    /** @type {string[]} */
    const texts = [];
    const quiet = { ...sink, blocks: 0, text: (/** @type {string} */ t) => { texts.push(t); } };
    const running = runAgentTurn(args({
      tools: toolSetFor({ delegateRead: true }),
      // The last call is a write: the reads before it run together (loop.js `onlyReads`), it waits for them.
      call: async () => reply([toolUse("r0", "read", { path: "a.txt" }), toolUse("d1", "delegate_read", { paths: ["a.txt"], question: "q" }), toolUse("r2", "write", { path: "c.txt", content: "x" })]),
      delegateRead: async () => { await gate; return { text: "late", requestId: null }; },
      mailbox: { read: () => [], stopSignal: stop.signal, forceSignal: force.signal },
      onEvent: (e) => events.push(e),
      sink: quiet,
    }));
    for (let i = 0; i < 50 && !events.some((e) => e.type === "tool-start" && e.id === "d1"); i++) await new Promise((r) => setTimeout(r, 10));
    stop.abort();
    force.abort();
    const out = await running;
    assert.equal(out.status, "stopped");
    assert.equal(out.forced, true);
    assert.match(texts.join(""), /force-stopped this turn/);
    const answers = out.work.at(-1).content;
    assert.equal(answers[0].tool_use_id, "r0");
    assert.equal(answers[0].is_error, undefined, "the call that finished keeps its own result");
    assert.match(String(answers[0].content), /read ran/);
    assert.deepEqual(answers.slice(1).map((/** @type {any} */ b) => b.content), [
      "Stopped: the developer force-stopped the turn while this call ran; its result was not kept.",
      "Not run: the developer stopped the turn before it ran.",
    ]);
    const [n, t] = [events.length, texts.length];
    release();
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(events.length, n, `no event after the forced end: ${JSON.stringify(events.slice(n).map((e) => e.type))}`);
    assert.equal(texts.length, t, `no byte after the forced end: ${JSON.stringify(texts.slice(t))}`);
  });
});

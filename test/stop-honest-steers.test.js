// @ts-check
// The code and UI/UX reviews of 2026-09-30: after a Stop, every surface says what really happened.
// - A note or a Compact sent with a Stop read "heard" / "Taken up by the loop" though the stopping turn never acted on
//   them; a note heard before the tools ran and then cut off by a Stop stayed "read" though the model never saw it.
// - A settled turn's never-read stop kept saying "Stopping…" for the life of the page.
// - A sub-agent the stop ended drew a red "Failed" beside the parent call's soft "Stopped".
// - A mid-turn fold left no trace in the transcript.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { until, gate, removeDirs } from "./helpers/wait.js";
import { steerWords, alignEvents, roundCompactionWords } from "../src/ui/harness/lib/labels.js";

const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("a message or a Compact that a Stop overtook is never marked heard", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  /** @type {ReturnType<typeof gate>[]} */
  const gates = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-honest-steer-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    for (const g of gates) g.open();
    await shim.stop();
    await up.close();
    // Windows holds the folder a moment after the killed command's process tree goes: waited for, and said when it
    // does not come free (it used to give up after 5 s in silence and leave the folder in %TEMP%).
    await removeDirs(root);
  });
  const start = async (content) => {
    const res = await shim.house(
      "/v1/messages",
      { model: "agent/brain-model", max_tokens: 400, stream: true, messages: [{ role: "user", content }] },
      { "x-filament-cwd": root, "x-session-id": `honest-${Math.random().toString(36).slice(2, 8)}` },
    );
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    return { runId, body: res.text() };
  };
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${encodeURIComponent(runId)}/events?since=0&limit=5000`)).json()).events || [];
  /** What the composer sends (app.js): a steer of `kind`; answers the message's id. */
  const steer = async (runId, kind, text = "") => {
    const r = await shim.api(`/api/runs/${encodeURIComponent(runId)}/steer`, { method: "POST", body: { kind, text, from: "harness" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    return String(j.message.id);
  };
  const ids = (ev, type) => ev.filter((e) => e.type === type).flatMap((e) => e.ids || []);

  // (fails before: the stop's read drained all three and marked them read; nothing said the note and the Compact
  // were never acted on)
  test("sent together with a Stop, only the stop is taken: the note and the Compact end unread", async () => {
    const hold = gate();
    gates.push(hold);
    brain = async () => {
      await hold.promise;
      return reply([{ type: "text", text: "too late" }]);
    };
    up.reset();
    const { runId, body } = await start("take your time");
    await until(() => up.received.length >= 1, "the model call to be in flight");
    const note = await steer(runId, "note", "also check the logs");
    const compact = await steer(runId, "compact");
    const stop = await steer(runId, "stop");
    await body; // the stop cut the model call: the turn ended
    const ev = await eventsOf(runId);
    assert.deepEqual(ids(ev, "steer-read"), [stop], "the stop alone was taken");
    assert.ok(ids(ev, "steer-unread").includes(note), "the note says it was never read");
    assert.ok(ids(ev, "steer-unread").includes(compact), "the Compact says the turn ended before it compacted");
    const a = alignEvents(ev);
    assert.equal(steerWords(a.steers.get(note)).state, "The run ended before reading this");
    assert.equal(steerWords(a.steers.get(compact)).state, "The turn ended before it compacted");
    assert.equal(steerWords(a.steers.get(stop)).state, "Stopped");
  });

  // (fails before: the note read at the preflight stayed "read" — the model never saw it)
  test("a note heard before the tools ran, then a Stop mid-command: the note ends unread, never delivered", async () => {
    const hold = gate();
    gates.push(hold);
    brain = async () => {
      await hold.promise;
      return reply([{ type: "text", text: "Running it." }, toolUse("b1", "bash", { command: `node -e "setTimeout(()=>{},15000)"` })], "tool_use");
    };
    up.reset();
    const { runId, body } = await start("run the long command");
    await until(() => up.received.length >= 1, "the model call to be in flight");
    const note = await steer(runId, "note", "use the staging config");
    hold.open(); // the reply lands; the preflight reads the note, which waits for the round's results
    await until(async () => (await eventsOf(runId)).some((e) => e.type === "tool-start" && e.name === "bash"), "the command to start");
    await steer(runId, "stop");
    await body;
    const ev = await eventsOf(runId);
    assert.ok(ids(ev, "steer-read").includes(note), "the preflight took it");
    assert.ok(ids(ev, "steer-unread").includes(note), "and the stop ended the turn before it reached the model");
    assert.equal(up.received.length, 1, "no round after the stop");
    assert.equal(steerWords(alignEvents(ev).steers.get(note)).state, "The run ended before reading this");
  });
});

describe("the settled turn's words", () => {
  // (fails before: steerWords ignored the settled turn; a never-read stop said "Stopping…" for good)
  test("once the turn has settled, a message neither read nor marked unread reads unread", () => {
    assert.equal(steerWords({ kind: "stop" }, { settled: true }).state, "Nothing to stop — the turn had already finished");
    assert.equal(steerWords({ kind: "stop" }, { settled: true }).tone, "unread");
    assert.equal(steerWords({ kind: "compact" }, { settled: true }).state, "The turn ended before it compacted");
    assert.equal(steerWords({ kind: "note", text: "x" }, { settled: true }).state, "The run ended before reading this");
    assert.equal(steerWords({ kind: "stop", read: true }, { settled: true }).state, "Stopped", "a read stop stays read");
    assert.equal(steerWords({ kind: "stop" }).state, "Stopping…", "while live it is on its way");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /const stopped = turn\.status === "stopped";[\s\S]*?v\.steerEls = list\.map\(\(s\) => \{\s*const el = steerEl\(s, !live, stopped, /, "the steer box tells a settled turn's bubbles so");
  });

  // (fails before: the sub-agent's card took "failed", a red word)
  test("a sub-agent the stop ended is stopped, not failed", () => {
    const a = alignEvents([
      { type: "tool-start", round: 1, id: "a1", name: "agent", args: "review" },
      { type: "subagent-start", round: 1, parent: "a1", agentId: "sa_1", description: "review" },
      { type: "subagent-end", round: 1, parent: "a1", agentId: "sa_1", status: "stopped", ok: false },
      { type: "tool-start", round: 1, id: "a2", name: "agent", args: "other" },
      { type: "subagent-start", round: 1, parent: "a2", agentId: "sa_2", description: "other" },
      { type: "subagent-end", round: 1, parent: "a2", agentId: "sa_2", status: "failed", ok: false, error: "boom" },
    ]);
    const tools = a.byRound.get(1)?.tools;
    assert.equal(tools?.get("a1")?.sub?.state, "stopped");
    assert.equal(tools?.get("a2")?.sub?.state, "failed", "a real failure stays failed");
    const render = readFileSync("src/ui/harness/conversation/tools/render.js", "utf8");
    assert.match(render, /s\?\.state === "stopped" \? \{ \.\.\.\(untold \|\| \{ word: "Stopped", title: "stopped — what it finished is its report" \}\), soft: true \}/);
  });

  // (fails before: no case for the run's compaction event — the fold left no row)
  test("a fold inside the turn stands in the transcript, after the round that had just finished", () => {
    const a = alignEvents([
      { type: "round-start", round: 1 },
      { type: "round-start", round: 2 },
      { type: "compaction", round: 2, fromRound: 1, toRound: 2, tokensBefore: 131000, tokensAfter: 68000, manual: true },
    ]);
    assert.equal(a.byRound.get(2)?.compactions?.length, 1);
    // The loop's compaction writes one summary: said as a summary, never a fold (HarnessV4_Tasks U3, UX-4).
    assert.equal(roundCompactionWords({ fromRound: 1, toRound: 2, tokensBefore: 131000, tokensAfter: 68000, manual: true }), "⌁ Compacted on your request: rounds 1–2 summarized into one, the newest kept whole · 131k → 68k");
    assert.equal(roundCompactionWords({ fromRound: 3, toRound: 3 }), "⌁ Compacted at the line: round 3 summarized into one, the newest kept whole");
    assert.match(roundCompactionWords({ manual: true, result: "little" }), /too little finished work to summarize yet/);
    assert.match(roundCompactionWords({ manual: true, result: "empty" }), /summarizer came back empty/);
    assert.match(roundCompactionWords({ stoodDown: true }), /stands down for the rest of this turn/);
    assert.match(roundCompactionWords({ why: "overflow-refusal", cleared: 3, folded: true }), /3 older results cleared and older rounds summarized into one/);
    // What came back after the summary, said after its figures (HarnessV3-AtHome AH-D9 b).
    // (fails before: yes — the row said nothing of the files the fold brought back)
    assert.equal(roundCompactionWords({ fromRound: 1, toRound: 2, tokensBefore: 131000, tokensAfter: 68000, attached: { shown: 2, named: 1, plan: true } }), "⌁ Compacted at the line: rounds 1–2 summarized into one, the newest kept whole · 131k → 68k · 2 files and the plan brought back");
    const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
    assert.match(timeline, /kept\("compaction", cell\.compactions \|\| \[\], compactionNote\)/);
    assert.match(timeline, /function compactionNote\(k\) \{\s+const words = roundCompactionWords\(k\);\s+if \(!k\.own \|\| !k\.summary\) return h\("div", \{ class: "tool-note compaction-note" \}, words\);/);
  });
});

describe("the composer after a stop (source contract: the page boots a DOM at import)", () => {
  // (fails before: the queue stayed paused beside a footer that said the turn finished; it never said why it waited)
  // (and, HarnessV3-Views V3 — fails before: yes — the ending was the composer's, the page's one; the rules are the
  // chat's queue's now, queue.js's `turnEnded` and `turnSettled`, tested in queue-per-chat.test.js)
  test("a stop the loop never read resumes the queue; a paused queue says why", () => {
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /settled\(status\) \{\s*if \(live \|\| !queue\.settled\(status\)\) return;\s*paintQueue\(\);\s*drain\(\);/);
    assert.match(composer, /if \(!on && endedBy && queue\.ended\(endedBy\)\) drain\(\);/);
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    // The turn takes its number from the record before the queue goes on: the next message numbers itself after it.
    assert.match(app, /await transcript\.finish\(live, [^\n]*\);\s*\n\s*\/\/[^\n]*\n\s*if \(renumbered\([^\n]*\n\s*\/\/[^\n]*\n\s*if \(chatOf\(state\.currentId\) === chat\) composer\.settled\(turn\.status\);/, "the page tells the composer once the record reconciled the ending");
    const queue = readFileSync("src/ui/harness/composer/queue.js", "utf8");
    assert.match(queue, /Paused — the last turn was stopped\. Continue sends the next message\./);
    assert.match(queue, /Paused — the last turn failed\. Continue sends the next message\./);
  });

  // (fails before: Compact in the turn's first second said "compact when it ends", a second before it would work)
  test("Compact in the turn's first moment waits for the run id instead of refusing", () => {
    const app = readFileSync("src/ui/harness/app.js", "utf8");
    const at = app.indexOf("async function compactMidTurn");
    const block = app.slice(at, at + 2200);
    assert.match(block, /for \(let i = 0; i < 30 && live && chat\.live === live && !live\.runId; i\+\+\) await new Promise/);
    assert.match(block, /The turn hasn't opened its run yet — try Compact again in a few seconds/);
    assert.doesNotMatch(block, /compact when it ends/);
  });

  test("the live meter marks its figure as the loop's estimate", () => {
    const ctx = readFileSync("src/ui/harness/widgets/context.js", "utf8");
    // Said once, on the big number (HarnessV4_Tasks U3, V4-D212): windowFace's text, which the popover's number reads.
    assert.match(ctx, /const approx = l\.streaming \|\| fig\.estimated \? "≈" : "";/);
    assert.match(ctx, /drawIn\(num, kids\(\[share \? pctText\(\)\.replace\("%", ""\)/);
    assert.match(ctx, /The provider's exact count replaces it when the turn ends\./);
  });
});

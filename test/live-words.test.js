// @ts-check
// HarnessV3-Launch LD-D16 (F29): a page that joins a running turn — a reload, a second tab — drew its cards live but
// not its words: they showed only when the turn ended (rd1b's S9). The run log keeps a round's words only when the round
// ends, and storing every streamed piece would fill its ring, so the words travel beside the events and are not kept: a
// hub holds each running turn's blocks while it runs (`services/live-words.js`), fed where the turn streams them to its
// own page; the run's stream carries them when asked (`/runs/:id/events?stream=1&words=1`, and a follow's `words` on the
// page's run socket) — the blocks so far, then each piece, none of them dropped: a frame the socket cannot take yet
// waits in its queue; the joining page draws them as the sending page draws its reply.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveWords, wordsFrames } from "../src/services/live-words.js";
import { applyWords, createAnthropicAccumulator, tailOpen } from "../src/ui/harness/lib/stream.js";
import { followRun } from "../src/ui/harness/lib/api.js";
import { startApp, fakeUpstream, FAKE_ACP_AGENT } from "./helpers/app.js";
import { until, removeDirs, upstreamControls, readEvents } from "./helpers/wait.js";
import { sse, messageStart, messageEnd, thinkingDelta, textOpen, textDelta, textClose, textsOf } from "./helpers/sse.js";
import { pageEvents } from "./helpers/page-events.js";
import { pointPageAt } from "./helpers/run-socket.js";

// The followers hold their streams while the page is shown (ui/lib/put-away.js): the page's events, stood in.
pageEvents();

// (fails before: yes — no hub)
test("the hub: a piece joins the open block of its kind; a kind change or a block's end opens the next; the turn's end lets go", () => {
  const hub = createLiveWords();
  /** @type {any[]} */
  const heard = [];
  const off = hub.follow("r1", (p) => heard.push(p));
  hub.piece("r1", "text", "before the start");
  assert.deepEqual([hub.blocks("r1"), heard], [[], []], "a turn that has not started holds nothing");
  hub.start("r1");
  hub.piece("r1", "thinking", "Let me ");
  hub.piece("r1", "thinking", "look.");
  hub.piece("r1", "text", "Looking.");
  hub.piece("r1", "text", ""); // nothing
  hub.endBlock("r1");
  hub.piece("r1", "text", "Found it.");
  assert.deepEqual(hub.blocks("r1"), [{ type: "thinking", text: "Let me look." }, { type: "text", text: "Looking." }, { type: "text", text: "Found it." }]);
  assert.deepEqual(heard, [
    { block: 0, type: "thinking", text: "Let me " },
    { block: 0, type: "thinking", text: "look." },
    { block: 1, type: "text", text: "Looking." },
    { end: true }, // the model call's end is said to whoever follows (HarnessV4_Tasks U4)
    { block: 2, type: "text", text: "Found it." },
  ]);
  hub.blocks("r1")[0].text = "changed";
  assert.equal(hub.blocks("r1")[0].text, "Let me look.", "the blocks handed out are copies");
  off();
  // (fails before: no — L4's mutation pass: an emptied reader set stayed until the turn's end)
  assert.equal(hub.held(), 1, "the turn's words, and no reader: the last one to leave takes its set");
  hub.piece("r1", "text", " More.");
  assert.equal(heard.length, 5, "a reader that left hears nothing more");
  const late = hub.follow("r1", (p) => heard.push(p));
  hub.end("r1");
  assert.deepEqual([hub.blocks("r1"), hub.held()], [[], 0], "the turn ended: its words and its readers are gone");
  late();
  hub.piece("r1", "text", "the line a reply with no words gets, after the run's end");
  assert.deepEqual([hub.blocks("r1"), hub.held(), heard.length], [[], 0, 5], "an ended turn holds nothing more");
});

// (fails before: yes — no frames)
// The writer loses no frame (http/events.js `writeHeld` queues what a full socket cannot take yet), so after the whole
// set every piece and every end follows it, in order: the whole set is sent again only on a fresh connection.
test("one reader's frames: the blocks so far, then each piece and each end, in order — never the whole set again", () => {
  const hub = createLiveWords();
  hub.start("r");
  hub.piece("r", "text", "Hel");
  /** @type {any[]} */
  const out = [];
  const frames = wordsFrames({ blocks: () => hub.blocks("r"), write: (f) => out.push(f) });
  frames.start();
  const off = hub.follow("r", frames.piece);
  hub.piece("r", "text", "lo");
  hub.piece("r", "text", " wor");
  hub.endBlock("r");
  hub.piece("r", "thinking", "hmm");
  off();
  assert.deepEqual(out, [
    { type: "words", blocks: [{ type: "text", text: "Hel" }] },
    { type: "words", piece: { block: 0, type: "text", text: "lo" } },
    { type: "words", piece: { block: 0, type: "text", text: " wor" } },
    { type: "words", end: true },
    { type: "words", piece: { block: 1, type: "thinking", text: "hmm" } },
  ]);
  /** @type {any[]} */
  const late = [];
  wordsFrames({ blocks: () => hub.blocks("r"), write: (f) => late.push(f) }).start();
  assert.deepEqual(late, [{ type: "words", blocks: [{ type: "text", text: "Hello wor" }, { type: "thinking", text: "hmm" }] }], "a reader that joins later starts from the whole set");
});

// (fails before: yes — the page had no way to take them)
test("the joining page's reply: the whole set lands in place, so the drawing's blocks keep their identity; a piece adds to its block or opens the next", () => {
  const reply = applyWords(null, { type: "words", blocks: [{ type: "thinking", text: "Let me look." }, { type: "text", text: "Look" }] });
  assert.deepEqual(reply.blocks, [{ type: "thinking", text: "Let me look." }, { type: "text", text: "Look" }]);
  const [think, text] = reply.blocks;
  assert.equal(applyWords(reply, { type: "words", piece: { block: 1, type: "text", text: "ing." } }), reply, "the same reply");
  applyWords(reply, { type: "words", piece: { block: 2, type: "text", text: "Found it." } });
  applyWords(reply, { type: "words", piece: { block: 9, type: "text", text: "out of order" } });
  assert.deepEqual(reply.blocks.map((/** @type {any} */ b) => b.text), ["Let me look.", "Looking.", "Found it."], "a piece out of order is left");
  applyWords(reply, { type: "words", blocks: [{ type: "thinking", text: "Let me look." }, { type: "text", text: "Looking. More." }, { type: "text", text: "Found it. All." }, { type: "text", text: "New." }] });
  assert.equal(reply.blocks[0], think, "the blocks the drawing holds are the same objects");
  assert.equal(reply.blocks[1], text);
  assert.deepEqual(reply.blocks.map((/** @type {any} */ b) => b.text), ["Let me look.", "Looking. More.", "Found it. All.", "New."]);
});

// (fails before: yes — the page asked for no words and drew none)
test("the joining page asks for the words and draws them as the sending page draws its reply, every block on a whole set", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  const join = app.slice(app.indexOf("function followLiveTurn("), app.indexOf("/** The header's Reload session"));
  // While its run's replay passes, the words wait with its cards (lib/replay-hold.js), and are drawn whole at its end.
  assert.match(join, /const onWords = \(\/\*\* @type \{any\} \*\/ w\) => \{\s*live\.reply = applyWords\(live\.reply, w\);\s*replay\.brought\(\);\s*if \(!replay\.holding\) transcript\.drawBlocks\(live, \{ redraw: Array\.isArray\(w\.blocks\) \}\);\s*measureReply\(chat, live\);\s*\};/);
  assert.match(join, /followRun\(runId, \{ since, words: true, onRun, onEvent, onWords,/);
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(timeline, /drawBlocks\(live, \{ redraw = false, again = false \} = \{\}\) \{/);
  assert.match(timeline, /if \(redraw\) for \(const hnd of live\.blockHandles\) if \(hnd !== open\) hnd\.draw\(\);/);
});

// (fails before: yes — HarnessV4_Tasks U4, found in HarnessV3-Views V3: the caret rode the reply's last block until
// the next one opened, so it blinked after the model's last words for as long as its tools ran. Nothing told the page
// the block had ended: the reply's own `content_block_stop` was dropped, and a joining page's words said no end)
test("a block's end is said to the page — the reply stream's own, and a joining page's words — and the caret is the open tail's alone", () => {
  // The page that sent the turn: the Anthropic wire closes each block.
  const acc = createAnthropicAccumulator();
  acc.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  acc.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me look." } });
  assert.equal(tailOpen(acc.reply), true, "its words still come");
  acc.push({ type: "content_block_stop", index: 0 });
  assert.equal(tailOpen(acc.reply), false, "the model call is over: its tools run now");
  assert.deepEqual(acc.reply.blocks, [{ type: "text", text: "Let me look." }], "the blocks keep their shape: the reply says it");
  acc.push({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  assert.equal(tailOpen(acc.reply), true, "the next call's block is open");
  acc.push({ type: "content_block_stop", index: 1 });
  acc.push({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Found it." } });
  assert.equal(tailOpen(acc.reply), true, "words that join a block open it again");
  assert.equal(tailOpen({ blocks: [] }), false, "no block, no caret");
  assert.equal(tailOpen(null), false);

  // The hub says a block's end to whoever follows the turn, once.
  const hub = createLiveWords();
  hub.start("r1");
  /** @type {any[]} */
  const heard = [];
  hub.follow("r1", (p) => heard.push(p));
  hub.piece("r1", "text", "Look");
  assert.equal(hub.open("r1"), true);
  hub.endBlock("r1");
  hub.endBlock("r1");
  assert.deepEqual(heard, [{ block: 0, type: "text", text: "Look" }, { end: true }]);
  assert.deepEqual([hub.open("r1"), hub.open("no such turn")], [false, false]);

  // One reader's frames carry it: the whole set says whether its tail is open, and an end is a frame of its own.
  /** @type {any[]} */
  const written = [];
  const frames = wordsFrames({ blocks: () => hub.blocks("r1"), open: () => hub.open("r1"), write: (f) => written.push(f) });
  frames.start();
  assert.deepEqual(written, [{ type: "words", blocks: [{ type: "text", text: "Look" }], open: false }]);
  hub.piece("r1", "text", "Found");
  frames.piece({ block: 1, type: "text", text: "Found" });
  frames.piece({ end: true });
  assert.deepEqual(written.slice(1), [{ type: "words", piece: { block: 1, type: "text", text: "Found" } }, { type: "words", end: true }]);
  // A reader that joins after an end gets the whole set with its tail closed.
  hub.endBlock("r1");
  /** @type {any[]} */
  const joined = [];
  wordsFrames({ blocks: () => hub.blocks("r1"), open: () => hub.open("r1"), write: (f) => joined.push(f) }).start();
  assert.deepEqual(joined, [{ type: "words", blocks: [{ type: "text", text: "Look" }, { type: "text", text: "Found" }], open: false }]);

  // The joining page.
  const reply = applyWords(null, { type: "words", blocks: [{ type: "text", text: "Look" }], open: false });
  assert.equal(tailOpen(reply), false, "it joined while the tools ran: no caret after the last words");
  applyWords(reply, { type: "words", piece: { block: 1, type: "text", text: "Found" } });
  assert.equal(tailOpen(reply), true);
  applyWords(reply, { type: "words", end: true });
  assert.equal(tailOpen(reply), false);
  applyWords(reply, { type: "words", piece: { block: 9, type: "text", text: "out of order" } });
  assert.equal(tailOpen(reply), false, "a piece that is left opens nothing");
  applyWords(reply, { type: "words", piece: { block: 1, type: "text", text: " it" } });
  assert.deepEqual([reply.blocks[1].text, tailOpen(reply)], ["Found it", true], "a piece that joins a block opens it again");
  applyWords(reply, { type: "words", end: true });
  applyWords(reply, { type: "words", blocks: [{ type: "text", text: "Look" }, { type: "text", text: "Found it. All" }], open: true });
  assert.equal(tailOpen(reply), true, "the whole set says its tail is open");
  // A server that says nothing of it (an older one) leaves the tail open, as before.
  assert.equal(tailOpen(applyWords(null, { type: "words", blocks: [{ type: "text", text: "x" }] })), true);

  // The drawing: the caret is the open tail's, and a tail that closed hands it back.
  const timeline = readFileSync("src/ui/harness/conversation/timeline.js", "utf8");
  assert.match(timeline, /const writing = open && \(!live\.reply \|\| tailOpen\(live\.reply\)\) \? open\.el : null;\s+if \(live\.caretEl && live\.caretEl !== writing\) live\.caretEl\.classList\.remove\("streaming"\);\s+live\.caretEl = writing;\s+writing\?\.classList\.add\("streaming"\);\s+open\?\.draw\(\);/);
  const route = readFileSync("src/http/admin/runs.js", "utf8");
  assert.match(route, /blocks: \(\) => liveWords\.blocks\(id\),\s+open: \(\) => liveWords\.open\(id\),/);
  // A thought whose block ended (its model call went on to a call) is done thinking: it says how long it thought.
  assert.match(timeline, /if \(open && tail\?\.type === "thinking" && !tail\.done && live\.reply && !tailOpen\(live\.reply\)\) open\.finish\(\);/);
});

// (fails before: yes — U4 left coding agents out: their words' block ended only where their next model call began, so
// while the command they went on to ran, the page's caret blinked on the words and a thought before it said
// "Thinking"; seen live, 10-11)
describe("a coding agent's words end as it goes on to a call, on its turn's own stream (HarnessV4_Tasks U4)", () => {
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {string} */ let gate;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-caret-"));
    gate = join(root, "tool.gate");
    shim = await startApp({
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "claude", name: "claude", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1", FAKE_ACP_TOOL_GATE: gate }, cwdDefault: root, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await removeDirs(root);
  });

  /**
   * A harness turn read as its page reads it, frame by frame: the reply's events and the run's, in one list.
   * @param {string} content
   */
  const turn = async (content) => {
    rmSync(gate, { force: true });
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "claude/haiku", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const r = await shim.api(`/api/sessions/${encodeURIComponent(String((await s.json()).id))}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(r.status, 200);
    /** @type {any[]} */
    const frames = [];
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const ended = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += dec.decode(value, { stream: true });
        for (let i = buf.indexOf("\n\n"); i >= 0; i = buf.indexOf("\n\n")) {
          const data = /^data: (.*)$/m.exec(buf.slice(0, i))?.[1];
          buf = buf.slice(i + 2);
          if (data) frames.push(JSON.parse(data));
        }
      }
    })();
    /** The run's event of a type, once there. @param {string} type */
    const ran = (type) => frames.find((f) => f.type === "filament_run" && f.event?.type === type)?.event;
    /** The reply as the page that sent the turn reads it. */
    const read = () => {
      const acc = createAnthropicAccumulator();
      for (const f of frames) if (f.type !== "filament_run") acc.push(f);
      return acc.reply;
    };
    return { frames, ended, ran, read };
  };

  test("while its command runs, the words before it have ended: the caret has no block to ride", async () => {
    const t = await turn("~slowtool");
    await until(() => t.ran("tool-start"), "the command's start");
    await until(() => t.read().tailClosed, "the words' end while the command runs", { timeoutMs: 3000 });
    assert.equal(t.ran("tool-end"), undefined, "the command still runs");
    assert.deepEqual([t.read().blocks.map((b) => b.text), tailOpen(t.read())], [["Running the tests now — this takes a while."], false]);
    writeFileSync(gate, "");
    await t.ended;
    assert.deepEqual(t.read().blocks.map((b) => b.text), ["Running the tests now — this takes a while.", "All 42 tests passed."], "the next model call's words, a block of their own");
  });

  test("a thought before it has ended too", async () => {
    const t = await turn("~slowtool think");
    await until(() => t.ran("tool-start"), "the command's start");
    await until(() => t.read().tailClosed, "the thought's end while the command runs", { timeoutMs: 3000 });
    assert.equal(t.ran("tool-end"), undefined, "the command still runs");
    assert.deepEqual(t.read().blocks.map((b) => b.type), ["thinking"]);
    writeFileSync(gate, "");
    await t.ended;
  });
});

describe("a page that joins a running turn", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  /** @type {string} */ let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-live-words-"));
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.memory.capture = { turns: true, learn: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });

  // (fails before: yes — the run's stream carried no words: the joining page had none until the turn ended)
  test("it gets the words so far at once, then the rest as they come; a stream that did not ask gets none; the hub lets go at the end", async () => {
    const { feed, letGo } = upstreamControls();
    /** @type {{ stop: () => void } | null} */
    let follower = null;
    try {
      const s = feed([...textOpen(), textDelta("The first words. ")]);
      brain = () => s;
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(made.status, 200, await made.clone().text());
      const id = String((await made.json()).id);
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "write", stream: true } });
      assert.equal(res.status, 200);
      const runId = String(res.headers.get("x-filament-request-id") || "");
      const sending = readEvents(res);
      await until(() => sending.events.some((e) => /first words/.test(String(e.data?.delta?.text || ""))), "the words to reach the sending page");
      pointPageAt(shim.url);
      const plain = readEvents(await fetch(`${shim.url}/api/runs/${encodeURIComponent(runId)}/events?stream=1`, { headers: { "x-filament-ui": "1" } }));
      /** @type {any[]} */
      const frames = [];
      /** @type {any} */
      let reply = null;
      let ended = false;
      follower = followRun(runId, { words: true, onEvent: () => {}, onWords: (w) => { frames.push(w); reply = applyWords(reply, w); }, onRunEnd: () => { ended = true; } });
      await until(() => frames.length >= 1, "the blocks so far");
      assert.deepEqual(frames[0], { type: "words", blocks: [{ type: "text", text: "The first words. " }], open: true }, "at once, before the turn ends");
      s.push(textDelta("And the rest."));
      await until(() => reply?.blocks?.[0]?.text === "The first words. And the rest.", "the next piece");
      assert.deepEqual(frames[1], { type: "words", piece: { block: 0, type: "text", text: "And the rest." } });
      s.end(...textClose());
      await until(() => ended, "the run's end");
      await until(() => plain.ended, "the stream that did not ask to end");
      assert.ok(!plain.events.some((e) => e.data?.type === "words"), "a stream that did not ask for words carries none");
      assert.deepEqual([shim.app.liveWords.blocks(runId), shim.app.liveWords.held()], [[], 0], "the turn ended: the hub let go of its words");
    } finally {
      follower?.stop();
      letGo();
    }
  });

  // (fails before: yes — HarnessV3-Views V3's drive: the stream's hello named the run and nothing heard it, so a page
  // reloaded mid-turn never learned what Enter does there)
  test("the stream names its run as it opens — its kind and status — before any event, once a connection", async () => {
    const { feed, letGo } = upstreamControls();
    /** @type {{ stop: () => void } | null} */
    let follower = null;
    try {
      const s = feed([...textOpen(), textDelta("Working. ")]);
      brain = () => s;
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(made.status, 200, await made.clone().text());
      const id = String((await made.json()).id);
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "work", stream: true } });
      assert.equal(res.status, 200);
      const runId = String(res.headers.get("x-filament-request-id") || "");
      const sending = readEvents(res);
      await until(() => sending.events.some((e) => /Working/.test(String(e.data?.delta?.text || ""))), "the words to reach the sending page");
      pointPageAt(shim.url);
      /** @type {any[]} */
      const heard = [];
      follower = followRun(runId, { onRun: (run) => heard.push(["run", run.kind, run.status]), onEvent: (e) => heard.push(["event", e.type]) });
      await until(() => heard.some((x) => x[0] === "event"), "the run's events");
      assert.deepEqual(heard.slice(0, 2), [["run", "agent-turn", "running"], ["event", "run-start"]]);
      assert.equal(heard.filter((x) => x[0] === "run").length, 1, "once a connection");
      s.end(...textClose());
      await sending.done;
    } finally {
      follower?.stop();
      letGo();
    }
  });

  // (fails before: no — L4's mutation pass: no test streamed thinking or a second model call to a joining page, and none
  // left a reader mid-turn)
  test("its thinking, and each model call's words in a block of their own; a page that leaves mid-turn stops being a reader", async () => {
    const { feed, letGo } = upstreamControls();
    /** @type {{ stop: () => void } | null} */
    let follower = null;
    try {
      writeFileSync(join(root, "a.txt"), "a\n");
      const second = feed([...textOpen(), textDelta("Found it. ")]);
      brain = (call) =>
        (call.body?.messages || []).some((/** @type {any} */ m) => Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type === "tool_result"))
          ? second
          : {
              sse: [
                messageStart("msg_t"),
                sse("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }),
                thinkingDelta("Let me look."),
                sse("content_block_stop", { type: "content_block_stop", index: 0 }),
                sse("content_block_start", { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } }),
                sse("content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Reading. " } }),
                sse("content_block_stop", { type: "content_block_stop", index: 1 }),
                sse("content_block_start", { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "t1", name: "read", input: {} } }),
                sse("content_block_delta", { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: '{"path":"a.txt"}' } }),
                sse("content_block_stop", { type: "content_block_stop", index: 2 }),
                ...messageEnd("tool_use", 20),
              ],
            };
      const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
      assert.equal(made.status, 200, await made.clone().text());
      const id = String((await made.json()).id);
      const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "read a.txt", stream: true } });
      assert.equal(res.status, 200);
      const runId = String(res.headers.get("x-filament-request-id") || "");
      const sending = readEvents(res);
      await until(() => sending.events.some((e) => /Found it/.test(String(e.data?.delta?.text || ""))), "the second call's words to reach the sending page");
      pointPageAt(shim.url);
      /** @type {any[]} */
      const frames = [];
      follower = followRun(runId, { words: true, onEvent: () => {}, onWords: (w) => frames.push(w) });
      await until(() => frames.length >= 1, "the blocks so far");
      assert.deepEqual(frames[0], { type: "words", blocks: [{ type: "thinking", text: "Let me look." }, { type: "text", text: "Reading. " }, { type: "text", text: "Found it. " }], open: true });
      assert.equal(shim.app.liveWords.held(), 2, "the turn's words and its one reader");
      follower.stop();
      follower = null;
      await until(() => shim.app.liveWords.held() === 1, "the page that left to stop being a reader");
      second.end(...textClose());
      await sending.done;
      assert.equal(shim.app.liveWords.held(), 0);
    } finally {
      follower?.stop();
      letGo();
    }
  });

  // (fails before: yes — no hub; and a hub that took a piece for any turn, running or not, kept this line for good: the
  // reply says it after the run's end)
  test("a turn whose model said nothing: the reply's own line comes after the run's end, and the hub holds none of it", async () => {
    brain = () => ({ sse: [...textOpen(), ...textClose()] });
    const made = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const id = String((await made.json()).id);
    const res = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "say nothing", stream: true } });
    assert.equal(res.status, 200);
    const sending = readEvents(res);
    await sending.done;
    assert.equal(textsOf(sending.events).join(""), "(Filament: the agent finished without saying anything)");
    assert.equal(shim.app.liveWords.held(), 0, "the turn ended, and the hub holds nothing of it");
  });
});

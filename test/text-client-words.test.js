// @ts-check
// HarnessV3-Launch LD-D7's leftover (L4), for the clients that read a reply's words alone and draw no card: the OpenAI
// join. The Chat Completions wire has no blocks, and it ran an agent's blocks together: a second round's words, or
// Filament's note, ran into the last ones, streamed and as JSON. A block that starts after earlier words of its kind now
// opens with a blank line, as the Anthropic wire keeps its blocks apart; thinking likewise.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createAgentReply } from "../src/app/acp-wire.js";

/** A response stand-in that keeps what the wire writes, and says it closed when it ends. */
const fakeRes = () => {
  /** @type {(() => void)[]} */
  const closers = [];
  const res = {
    status: 0,
    body: "",
    writableEnded: false,
    destroyed: false,
    /** @param {number} s */
    writeHead(s) { res.status = s; },
    flushHeaders() {},
    /** @param {string} s */
    write(s) { res.body += s; return true; },
    /** @param {string} [s] */
    end(s) { if (s) res.body += s; res.writableEnded = true; for (const f of closers) f(); },
    /** @param {string} ev @param {() => void} f */
    on(ev, f) { if (ev === "close") closers.push(f); },
  };
  return res;
};
/** The Chat Completions writer over a stand-in. @param {ReturnType<typeof fakeRes>} res @param {boolean} stream */
const openaiWire = (res, stream) =>
  createAgentReply({ res: /** @type {any} */ (res), format: "openai", model: "m", requestId: "r1", upstreamId: "u", stream, heartbeatMs: 60_000, pacingMs: 0, onFirstByte: () => {}, idPrefix: "agent" });
/** What a Chat Completions client gathers from a stream: its words and its reasoning. @param {string} body */
const gathered = (body) => {
  let content = "", reasoning = "";
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
    const d = JSON.parse(line.slice(6)).choices?.[0]?.delta || {};
    content += d.content || "";
    reasoning += d.reasoning_content || "";
  }
  return { content, reasoning };
};

describe("the OpenAI join", () => {
  // (fails before: yes — the stream ran the blocks together: "Looking.Found it in a.txt.(Filament: the note.)")
  test("streamed: a block that follows earlier words of its kind opens with a blank line — rounds, the note and thinking alike", () => {
    const res = fakeRes();
    const w = openaiWire(res, true);
    w.streamThought("Let me look.");
    w.streamText("Looking.");
    w.breakBlock(); // the round's call ends
    w.streamThought("Found the file.");
    w.streamText("Found it");
    w.streamText(" in a.txt."); // the same block: nothing between its deltas
    w.breakBlock();
    w.breakBlock(); // a block with no words adds nothing
    w.streamText(""); // nor does an empty delta: the blank line waits for the words
    w.streamText("(Filament: the note.)");
    w.endStream("stop", {});
    assert.deepEqual(gathered(res.body), { content: "Looking.\n\nFound it in a.txt.\n\n(Filament: the note.)", reasoning: "Let me look.\n\nFound the file." });
  });

  // (fails before: yes — the JSON joined the blocks with nothing between them)
  test("as JSON: each kind's blocks that carry words, joined by a blank line — the words the stream gave", () => {
    const res = fakeRes();
    openaiWire(res, false).sendBlocks(
      [
        { type: "thinking", thinking: "Let me look." },
        { type: "text", text: "Looking." },
        { type: "thinking", thinking: "Found the file." },
        { type: "text", text: "Found it in a.txt." },
        { type: "text", text: "" },
        { type: "text", text: "(Filament: the note.)" },
      ],
      "stop",
      {},
    );
    const m = JSON.parse(res.body).choices[0].message;
    assert.deepEqual([m.content, m.reasoning_content], ["Looking.\n\nFound it in a.txt.\n\n(Filament: the note.)", "Let me look.\n\nFound the file."]);
    const one = fakeRes();
    openaiWire(one, false).sendBlocks([{ type: "text", text: "hi" }], "stop", {});
    const m1 = JSON.parse(one.body).choices[0].message;
    assert.deepEqual([m1.content, "reasoning_content" in m1], ["hi", false], "one block is as it was, and no reasoning without thinking");
  });

});

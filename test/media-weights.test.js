// @ts-check
// The estimate weighs a request's pictures as the send puts them on the wire (pdfs.js `mediaWeights`, core/tokens.js
// `media`): one the request's room leaves out weighs the words that stand in its place, not ~1,500 tokens — the same
// decision the send makes (`mediaWithin`), made for the request as a whole, so its line holds where the send's does.
// Where the destination is known: the loop's measure and the session's composition.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { estimateBodyParts } from "../src/core/tokens.js";
import { leftOutWords, MEDIA_BYTES, mediaIn } from "../src/core/media.js";
import * as pdfs from "../src/app/pipeline/dispatch/pdfs.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

const MB = 1024 * 1024;
/** A picture of `n` characters of base64. @param {number} n */
const pic = (n) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(n) } });
/** @param {any[]} content */
const user = (content) => ({ role: "user", content });
const reply = { role: "assistant", content: "seen" };
const CFG = {
  rules: {},
  upstreams: [{ id: "anth", type: "anthropic-compatible", enabled: true }],
  routes: [{ match: "claude-*", upstream: "anth", upstreamModel: "{model}", enabled: true }],
};

// (fails before: yes — every picture weighed ~1,500 tokens, the ones a request leaves out as well: a chat of many
// pictures passed its compaction line, or its window, for pictures its requests no longer carried)
test("the estimate weighs a picture the send leaves out as the words in its place — the very ones the send leaves out — and the line holds as the send's does", async () => {
  const { mediaWeights, mediaWithin } = pdfs;
  const three = () => pic(3 * MB);
  const messages = [user([three(), three(), three(), three(), three(), { type: "text", text: "look" }]), reply, user([three(), three(), three(), three(), three(), { type: "text", text: "and these" }]), reply, user([{ type: "text", text: "which is bluest?" }])];
  const weigh = mediaWeights(CFG, "claude-sonnet-5-5");
  assert.ok(weigh, "Claude's route is known");
  const hook = weigh(messages);
  const sent = await mediaWithin({ messages }, { bytes: MEDIA_BYTES, pdfs: true, why: "w" });
  const places = mediaIn({ messages });
  const leftOut = places.filter((p) => sent.body.messages[p.m].content[p.b].type === "text");
  assert.equal(leftOut.length, 3, "30 MB over a room of 24: the line at 8");
  for (const p of places) assert.equal(hook(p.block), leftOut.includes(p) ? leftOutWords(p) : null);
  const flat = estimateBodyParts({ messages });
  const weighed = estimateBodyParts({ messages }, "conversation", { media: hook });
  assert.equal(flat.fixed - weighed.fixed, 3 * 1500, "three pictures fewer at ~1,500");
  assert.ok(weighed.text > flat.text && weighed.text - flat.text < 3 * 60, `and their words instead: ${weighed.text - flat.text} tokens`);
  // Two more MB of newer pictures move no line: the same three weigh as words.
  const more = [...messages.slice(0, 4), user([pic(MB), pic(MB), { type: "text", text: "two more" }]), reply, user([{ type: "text", text: "and now?" }])];
  const again = weigh(more);
  assert.deepEqual(places.map((p) => again(p.block) != null), places.map((p) => leftOut.includes(p)));
  // A part of the request weighs what the whole request sends of it.
  assert.equal(estimateBodyParts({ messages: messages.slice(0, 1) }, "conversation", { media: hook }).fixed, 2 * 1500 + 4);
});

describe("through Filament: a chat of many pictures, on a model of an 80,000-token window", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {any[]} */
  const bodies = [];
  before(async () => {
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      bodies.push(call.body);
      return anthropicReply("seen", { model: "claude-sonnet-5-5", usage: { input_tokens: 50, output_tokens: 8, cache_creation_input_tokens: 40, cache_read_input_tokens: 0 } });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "z", name: "z", type: "anthropic-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, pricing: { "claude-sonnet-5-5": { input: 1, output: 1, contextTokens: 80_000, maxOutputTokens: 8_000 } } }];
        cfg.routes = [{ match: "claude-*", upstream: "z", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  // (fails before: yes — the second turn's forty pictures weighed ~60,000 tokens though the request carried twenty-four:
  // past the 68,000-token compaction line with the prompt and tools, the turn stopped to make room)
  test("its second turn of twenty pictures goes: the older ones past the room weigh their words, not ~1,500 each, and its reply keeps its room", async () => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "claude-sonnet-5-5" } });
    assert.equal(s.status, 200, await s.clone().text());
    const { id } = await s.json();
    /** A turn of twenty pictures of 1 MB of base64 and words. @param {string} words */
    const turn = async (words) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [...Array.from({ length: 20 }, () => pic(MB)), { type: "text", text: words }] } });
      return { status: r.status, said: await r.text() };
    };
    const first = await turn("look at these");
    assert.equal(first.status, 200, first.said.slice(0, 600));
    const second = await turn("and at these");
    assert.equal(second.status, 200, second.said.slice(0, 600));
    const sent = bodies.at(-1);
    const kinds = sent.messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.map((/** @type {any} */ b) => b.type) : []));
    assert.equal(kinds.filter((/** @type {string} */ k) => k === "image").length, 24, "40 MB over a room of 24: the sixteen oldest left out");
    assert.equal(sent.max_tokens, 8_000, "the reply's whole room");
  });
});

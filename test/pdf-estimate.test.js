// @ts-check
// A PDF weighed as what is sent of it (core/tokens.js `media`, pdfs.js `mediaWeights`): where a model reads no PDF it
// goes as its text, and the estimate that clamps a reply's room, draws the compaction line and stops a turn at the
// window weighs that text — read once by its bytes (`readPdfs`, `pdfWords`) — not the PDF's size. Claude on the
// Anthropic wire, which reads the PDF itself, and a model no route reaches weigh it by its size.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createBlockWeights, estimateBodyParts, estimateTokens } from "../src/core/tokens.js";
import { PDFTOTEXT } from "../src/adapters/tools/pdf.js";
import * as pdfs from "../src/app/pipeline/dispatch/pdfs.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { makePdf } from "./helpers/pdf.js";

/** A PDF block of one page that says `words`, padded to `pad` bytes of file. @param {string} words @param {number} [pad] */
const pdfOf = (words, pad = 0) => ({ type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data: makePdf([words], { pad }).toString("base64") } });

test("a document whose words its caller knows weighs those words, else its size; a keeper weighs it again once they are known", () => {
  const doc = { type: "document", title: "r.pdf", source: { type: "base64", media_type: "application/pdf", data: "A".repeat(800_000) } };
  const body = { messages: [{ role: "user", content: [doc, { type: "text", text: "read it" }] }] };
  assert.deepEqual(estimateBodyParts(body), { text: estimateTokens("read it"), fixed: 100_000 + 4 }, "by its size, at most 100,000");
  /** @type {string | null} */
  let words = null;
  const weights = createBlockWeights();
  assert.equal(estimateBodyParts(body, "conversation", { weights, media: () => words }).fixed, 100_004, "not known yet: its size");
  const inResult = { messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: [doc] }] }] };
  assert.equal(estimateBodyParts(inResult, "conversation", { weights, media: () => words }).fixed, 100_004, "in a tool result, the same");
  words = "--- Attached file: r.pdf (a PDF of 1 page: its text; its pictures and layout are not included) ---\n[Page 1]\nhello\n--- end of r.pdf ---";
  assert.deepEqual(estimateBodyParts(body, "conversation", { weights, media: () => words }), { text: estimateTokens(words) + estimateTokens("read it"), fixed: 4 });
  assert.equal(estimateBodyParts(inResult, "conversation", { weights, media: () => words }).fixed, 4, "the tool result that holds it weighed again too");
});

describe("a PDF's words, once read", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
  test("which models weigh a PDF by its words: every one that reads none, by its route's wire; Claude on the Anthropic wire by its size; a model no route reaches, every medium at its own rate", async () => {
    const { mediaWeights, readPdfs } = pdfs;
    const cfg = {
      rules: {},
      upstreams: [
        { id: "anth", type: "anthropic-compatible", enabled: true },
        { id: "oai", type: "openai-compatible", enabled: true },
      ],
      routes: [
        { match: "claude-*", upstream: "anth", upstreamModel: "{model}", enabled: true },
        { match: "glm-*", upstream: "anth", upstreamModel: "{model}", enabled: true },
        { match: "gpt-*", upstream: "oai", upstreamModel: "{model}", enabled: true },
        { match: "sonnet", upstream: "oai", upstreamModel: "anthropic/claude-sonnet-5-5", enabled: true },
      ],
    };
    const block = pdfOf(`a page the models weigh ${randomUUID()}`);
    const messages = [{ role: "user", content: [block, { type: "text", text: "read it" }] }];
    await readPdfs({ messages });
    /** What the model's weighing says the PDF goes as. @param {string} model */
    const asText = (model) => mediaWeights(cfg, model)?.(messages)(block) ?? null;
    assert.equal(asText("claude-sonnet-5-5"), null, "as it is: weighed by its size");
    for (const model of ["glm-5", "agent/glm-5", "gpt-6", "sonnet"]) assert.match(String(asText(model)), /^--- Attached file: report\.pdf/, model);
    assert.equal(mediaWeights(cfg, "llama-9"), null);
  });

  test("none before its pages are read; then the very text pdfsAsSent puts in its place; with no pdftotext, the words that say so", async () => {
    const { pdfWords, readPdfs, pdfsAsSent } = pdfs;
    const block = pdfOf(`a page no other test wrote ${randomUUID()}`);
    assert.equal(pdfWords(block), null);
    await readPdfs({ messages: [{ role: "user", content: [block] }] });
    const sent = await pdfsAsSent({ messages: [{ role: "user", content: [block] }] }, { native: false, why: "w" });
    assert.equal(pdfWords(block), sent.body.messages[0].content[0].text);
    assert.equal(pdfWords({ ...block, source: { ...block.source } }), pdfWords(block), "the same bytes in another block: the same words");
    assert.match(String(pdfWords(block, null)), /^\[The user attached the PDF "report\.pdf" \(1 KB\), whose text could not be read here: this machine has no pdftotext/);
    assert.equal(pdfWords({ type: "text", text: "x" }), null);
  });
});

// (fails before: yes — a PDF a model read as its text weighed its size, up to 100,000 tokens: on a model of a small
// window a chat's turn had its reply's room cut to what was left, or was stopped at the window, for a few words)
describe("through Filament: a PDF sent as its text to a model of a 110,000-token window", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
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
      return anthropicReply("it says hello", { model: "glm-5", usage: { input_tokens: 50, output_tokens: 8 } });
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "z", name: "z", type: "anthropic-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, pricing: { "glm-5": { input: 1, output: 1, contextTokens: 110_000, maxOutputTokens: 32_000 } } }];
        cfg.routes = [{ match: "glm-*", upstream: "z", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim?.stop();
    await up?.close();
  });

  test("a chat's turn: its reply's room is the model's whole 32,000, the PDF's few words weighed, not its 600 KB", async () => {
    bodies.length = 0;
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "glm-5" } });
    assert.equal(s.status, 200, await s.clone().text());
    const { id } = await s.json();
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: [pdfOf(`The report says hello ${randomUUID()}`, 600_000), { type: "text", text: "what does it say?" }] } });
    const said = await r.text();
    assert.equal(r.status, 200, said);
    const sent = bodies.at(-1);
    assert.ok(sent, `no request reached the model: ${said.slice(0, 600)}`);
    assert.match(JSON.stringify(sent.messages), /The report says hello/, "the PDF went as its text");
    assert.equal(sent.max_tokens, 32_000);
  });

  test("the loop's turn for a call of Filament's own: its round asks the room the call asked, not stopped at the window", async () => {
    bodies.length = 0;
    const r = await shim.house(
      "/v1/messages",
      { model: "agent/glm-5", max_tokens: 32_000, stream: false, messages: [{ role: "user", content: [pdfOf(`The report says hello ${randomUUID()}`, 600_000), { type: "text", text: "what does it say?" }] }] },
      { "x-filament-cwd": shim.dataDir, "x-session-id": `pdf-estimate-${randomUUID()}` },
    );
    const said = await r.text();
    assert.equal(r.status, 200, said);
    const sent = bodies.at(-1);
    assert.ok(sent, `no request reached the model: ${said.slice(0, 600)}`);
    assert.equal(sent.max_tokens, 32_000);
  });
});

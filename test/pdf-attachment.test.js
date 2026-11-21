// @ts-check
// A PDF the harness's box sends — a `document` block, its bytes in base64 — as each destination takes it (pdfs.js): a
// Claude model on the Anthropic wire gets the PDF itself; any other model, and every coding agent, its text, page by
// page, through pdftotext.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, FAKE_ACP_AGENT } from "./helpers/app.js";
import { makePdf } from "./helpers/pdf.js";
import { removeDirs } from "./helpers/wait.js";
import { PDFTOTEXT } from "../src/adapters/tools/pdf.js";
import { pdfsAsSent, pdfText, readsPdfs, within } from "../src/app/pipeline/dispatch/pdfs.js";

const data = makePdf(["The first page says hello", "", "The third page says goodbye"]).toString("base64");
const doc = { type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data } };
/** @param {Record<string, unknown>} [extra] */
const asked = (extra = {}) => [{ role: "user", content: [{ type: "text", text: "what does it say?" }, { ...doc, ...extra }] }];
const TEXT = [
  "--- Attached file: report.pdf (a PDF of 3 pages: its text; its pictures and layout are not included) ---",
  "[Page 1]",
  "The first page says hello",
  "[Page 2]",
  "",
  "[Page 3]",
  "The third page says goodbye",
  "--- end of report.pdf ---",
].join("\n");
/** A PDF of `n` pages, each a line of its own. @param {string} title @param {number} n */
const pdfOf = (title, n) => ({ type: "document", title, source: { type: "base64", media_type: "application/pdf", data: makePdf(Array.from({ length: n }, (_, i) => `${title} page ${i + 1}`)).toString("base64") } });

test("a model reads PDFs as they are when it is Claude on the Anthropic wire, and no other", () => {
  assert.equal(readsPdfs("anthropic", "claude-sonnet-5-5"), true);
  assert.equal(readsPdfs("anthropic", "anthropic.claude-opus-5-5-v1"), true, "Bedrock's names for Claude");
  assert.equal(readsPdfs("anthropic", "glm-5"), false, "another model behind an Anthropic-format door");
  assert.equal(readsPdfs("openai", "anthropic/claude-sonnet-5-5"), false, "Claude on the OpenAI wire takes no document block");
  assert.equal(readsPdfs("anthropic", null), false);
});

test("a PDF that cannot be read, or holds no text, is said so in words; a long one is cut at 200,000 characters, on a page's edge or inside a first page, with what is left out named", async () => {
  const none = await pdfsAsSent({ messages: asked() }, { native: false, why: "glm-5 at z is not a Claude model", pdftotext: null });
  assert.equal(none.body.messages[0].content[1].text, '\n\n[The user attached the PDF "report.pdf" (1 KB), whose text could not be read here: this machine has no pdftotext (Git for Windows ships it; elsewhere it comes with poppler). Ask for its text if you need it.]');
  assert.deepEqual(none.notes, ['pdf: "report.pdf" sent as its text, unread (this machine has no pdftotext (Git for Windows ships it; elsewhere it comes with poppler)): glm-5 at z is not a Claude model']);
  assert.match(pdfText("scan.pdf", 3 * 1024 * 1024, within(["", " \n"])), /^\[The user attached the PDF "scan\.pdf" \(3 MB, 2 pages\), which holds no text pdftotext can read — a scan, perhaps\./);
  const long = pdfText("big.pdf", 1, within(Array.from({ length: 5 }, (_, i) => String(i + 1).repeat(60_000))));
  assert.ok(long.includes("[Page 3]\n333") && !long.includes("[Page 4]"), "three pages of 60,000 characters fit; a fourth would pass 200,000");
  assert.ok(long.includes("[Pages 4–5 are not included here, past 200,000 characters of text.]\n--- end of big.pdf ---"));
  assert.ok(pdfText("four.pdf", 1, within(Array.from({ length: 4 }, () => "y".repeat(60_000)))).includes("\n[Page 4 is not included here, past 200,000 characters of text.]\n"));
  const one = pdfText("one.pdf", 1, within(["x".repeat(250_000), "the second page"]));
  assert.ok(one.includes(`[Page 1]\n${"x".repeat(200_000)}\n[Page 1 is cut here, past 200,000 characters of text.]\n[Page 2 is not included here`), "a first page past the cap is cut inside it");
});

// (fails before: yes — every PDF went to Claude as it was however many a conversation held, so a request past the 100
// pages Anthropic takes was refused, and every later turn of that chat with it; a first page past the cap went whole)
describe("Claude gets the newest PDFs as they are, as far as a request takes them", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
  test("an older PDF past the 100 pages goes as its text; one pdftotext cannot read as words that say so; with no pdftotext, each as it is", async () => {
    const older = pdfOf("older.pdf", 60);
    const newer = pdfOf("newer.pdf", 60);
    const body = { messages: [{ role: "user", content: [older, { type: "text", text: "read this" }] }, { role: "assistant", content: "read" }, { role: "user", content: [newer, { type: "text", text: "and this" }] }] };
    const sent = await pdfsAsSent(body, { native: true, why: "" });
    assert.equal(sent.body.messages[2].content[0], newer, "the newest as it was");
    assert.equal(sent.body.messages[0].content[0].type, "text");
    assert.match(sent.body.messages[0].content[0].text, /^--- Attached file: older\.pdf \(a PDF of 60 pages: its text; its pictures and layout are not included\) ---\n\[Page 1\]\nolder\.pdf page 1\n/);
    assert.ok(sent.body.messages[0].content[0].text.endsWith("--- end of older.pdf ---\n\n"), "a blank line before the words after it");
    assert.deepEqual(body.messages[0].content[0], older, "the body it was given is left as it was");
    assert.deepEqual(sent.notes, [
      'pdf: "older.pdf" sent as its text, 60 pages: past the 100 pages and 24 MB of PDFs a request carries, the newest first',
      'pdf: "newer.pdf" sent as the PDF, 60 pages',
    ]);
    const fits = { messages: [{ role: "user", content: [pdfOf("a.pdf", 40), pdfOf("b.pdf", 60), { type: "text", text: "both" }] }] };
    const both = await pdfsAsSent(fits, { native: true, why: "" });
    assert.equal(both.body, fits, "100 pages in all go as they are");
    const broken = { messages: [{ role: "user", content: [{ ...doc, title: "broken.pdf", source: { ...doc.source, data: "JVBERi0=" } }] }] };
    const said = await pdfsAsSent(broken, { native: true, why: "" });
    assert.match(said.body.messages[0].content[0].text, /^\[The user attached the PDF "broken\.pdf" \(1 KB\), whose text could not be read here: pdftotext could not read it \(.+\)\. Ask for its text if you need it\.\]$/);
    assert.match(said.notes[0], /^pdf: "broken\.pdf" sent as its text, unread \(pdftotext could not read it \(.+\)\): a PDF that cannot be read goes as words that say so$/);
    const blind = await pdfsAsSent(body, { native: true, why: "", pdftotext: null });
    assert.equal(blind.body, body);
    assert.deepEqual(blind.notes, ['pdf: "older.pdf" sent as the PDF, its pages not counted here', 'pdf: "newer.pdf" sent as the PDF, its pages not counted here']);
  });
});

describe("a PDF read through the real pdftotext", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
  test("a model that reads PDFs gets the body as it was; any other the PDF's text in its place, page by page, its cache mark carried", async () => {
    const body = { messages: asked() };
    const kept = await pdfsAsSent(body, { native: true, why: "" });
    assert.equal(kept.body, body);
    assert.deepEqual(kept.notes, ['pdf: "report.pdf" sent as the PDF, 3 pages']);
    const sent = await pdfsAsSent({ messages: asked({ cache_control: { type: "ephemeral" } }) }, { native: false, why: "glm-5 at z is not a Claude model" });
    assert.deepEqual(sent.body.messages[0].content, [{ type: "text", text: "what does it say?" }, { type: "text", text: `\n\n${TEXT}`, cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(sent.notes, ['pdf: "report.pdf" sent as its text, 3 pages: glm-5 at z is not a Claude model']);
    const broken = await pdfsAsSent({ messages: [{ role: "user", content: [{ ...doc, title: "broken.pdf", source: { ...doc.source, data: "JVBERi0=" } }] }] }, { native: false, why: "w" });
    assert.match(broken.body.messages[0].content[0].text, /^\[The user attached the PDF "broken\.pdf" \(1 KB\), whose text could not be read here: pdftotext could not read it \(.+\)\. Ask for its text if you need it\.\]$/);
  });

  describe("through Filament", () => {
    /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
    let up;
    /** @type {Awaited<ReturnType<typeof startApp>>} */
    let s;
    /** @type {string} */
    let root;
    /** @type {string} */
    let log;
    before(async () => {
      up = await fakeUpstream();
      root = mkdtempSync(join(tmpdir(), "filament-pdf-att-"));
      log = join(root, "prompts.jsonl");
      s = await startApp({
        configure: (cfg) => {
          const agent = /** @param {Record<string, string>} env */ (env) => ({ command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_LOG: log, ...env }, cwdDefault: root, permissions: "allow-all", hints: false });
          cfg.upstreams = [
            { id: "anth", name: "anth", type: "anthropic-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false },
            { id: "oai", name: "oai", type: "openai-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false, wireApi: "chat-completions" },
            { id: "coder", name: "coder", type: "acp", acp: agent({}) },
            { id: "embeds", name: "embeds", type: "acp", acp: agent({ FAKE_ACP_EMBED: "1" }) },
          ];
          cfg.routes = [
            { match: "claude-*", upstream: "anth", upstreamModel: "{model}", enabled: true },
            { match: "glm-*", upstream: "anth", upstreamModel: "{model}", enabled: true },
            { match: "gpt-*", upstream: "oai", upstreamModel: "{model}", enabled: true },
            { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
            { match: "embeds/*", upstream: "embeds", upstreamModel: "{1}", enabled: true },
          ];
        },
      });
    });
    after(async () => {
      await s?.stop();
      await up?.close();
      if (root) await removeDirs(root);
    });
    /** @param {string} model @param {Record<string, string>} [headers] */
    const send = async (model, headers = {}) => {
      const r = await s.post("/v1/messages", { model, max_tokens: 50, system: `Working directory: ${root}`, messages: asked() }, headers);
      assert.equal(r.status, 200, await r.clone().text());
      await r.text();
      return s.record(String(r.headers.get("x-filament-request-id")));
    };
    const prompts = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
    /** @param {string} kind */
    const lastCall = (kind) => up.received.filter((c) => c.kind === kind).at(-1);

    // (fails before: yes — every destination got the PDF's block as it came: a model on the Anthropic wire that is no
    // Claude its bytes, an OpenAI-format one a line saying it cannot receive it, a coding agent the same line or the
    // bytes as a resource it may not read)
    test("Claude on the Anthropic wire gets the PDF itself; another model there, an OpenAI-format one and a coding agent its text, said on the record", async () => {
      up.reset();
      // The block as it went, but for the cache mark the shaper puts on a message's last block.
      const lastBlock = () => {
        const { cache_control, ...b } = lastCall("anthropic")?.body.messages[0].content[1];
        return b;
      };
      const claude = await send("claude-sonnet-5-5");
      assert.deepEqual(lastBlock(), doc, "the PDF as the box sent it");
      assert.ok(claude.changes.includes('pdf: "report.pdf" sent as the PDF, 3 pages'), claude.changes.join("\n"));

      const glm = await send("glm-5");
      assert.deepEqual(lastBlock(), { type: "text", text: `\n\n${TEXT}` });
      assert.ok(glm.changes.includes('pdf: "report.pdf" sent as its text, 3 pages: glm-5 at anth is not a Claude model on the Anthropic wire'), glm.changes.join("\n"));

      const gpt = await send("gpt-6");
      assert.equal(lastCall("openai")?.body.messages.at(-1).content, `what does it say?\n\n${TEXT}`, "a user message of text alone is sent as its text, the PDF's set apart");
      assert.ok(gpt.changes.includes('pdf: "report.pdf" sent as its text, 3 pages: gpt-6 at oai is not a Claude model on the Anthropic wire'), gpt.changes.join("\n"));

      for (const [model, embeds] of [["coder/fake-a", false], ["embeds/fake-a", true]]) {
        const rec = await send(String(model), { "x-session-id": `pdf-${model}` });
        const p = prompts().at(-1);
        assert.ok(p.prompt.includes(TEXT), `${model}: ${p.prompt}`);
        assert.equal(p.resources, 0, `${model}: no resource beside its text${embeds ? ", though it takes them" : ""}`);
        assert.ok(rec.changes.includes(`pdf: "report.pdf" sent as its text, 3 pages: ${embeds ? "embeds" : "coder"} is a coding agent`), rec.changes.join("\n"));
      }
    });

    // (fails before: yes — both went to Claude as PDFs, 120 pages, which Anthropic refuses, and every later turn with them)
    test("a conversation whose PDFs pass the 100 pages a request takes sends Claude the newest as they are and the older as their text", async () => {
      const r = await s.post("/v1/messages", {
        model: "claude-sonnet-5-5",
        max_tokens: 50,
        messages: [{ role: "user", content: [pdfOf("older.pdf", 60), { type: "text", text: "read this" }] }, { role: "assistant", content: "read" }, { role: "user", content: [pdfOf("newer.pdf", 60), { type: "text", text: "and this" }] }],
      });
      assert.equal(r.status, 200, await r.clone().text());
      await r.text();
      const sent = lastCall("anthropic")?.body.messages;
      assert.equal(sent[0].content[0].type, "text");
      assert.match(sent[0].content[0].text, /^--- Attached file: older\.pdf \(a PDF of 60 pages/);
      assert.equal(sent[2].content[0].type, "document");
      assert.equal(sent[2].content[0].title, "newer.pdf");
    });
  });
});

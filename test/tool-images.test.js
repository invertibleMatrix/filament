// @ts-check
// HarnessV3-Tools TL-D17: images reach the model from a tool. The proxy weighs and carries an image in a tool result
// (the estimate, the Anthropic → OpenAI and Responses → Chat translations); `read` and an MCP tool show one; a model
// that refuses images has them withdrawn once and is told so; a session's history keeps the image as it keeps one the
// developer attached — until a fold (or compaction) leaves a placeholder.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { estimateBodyParts, estimateTokens } from "../src/core/tokens.js";
import { anthropicToOpenaiRequest } from "../src/core/wire/translate.js";
import { responsesToChat } from "../src/core/wire/responses.js";
import { runHand, HandError } from "../src/adapters/tools/hands.js";
import { connectMcp } from "../src/adapters/tools/mcp-client.js";
import { MediaResult, IMAGE_MAX_BYTES, imageTypeOf } from "../src/core/media.js";
import { readFacts } from "../src/ui/harness/conversation/tools/render.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// A PNG's signature and the start of its IHDR chunk, whose length bytes hold the NUL a real image always has.
const PNG_START = Buffer.concat([PNG_HEAD, Buffer.from([0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52])]);
const png = (filler = 2000) => Buffer.concat([PNG_START, Buffer.alloc(filler, 7)]);
/** @param {string} data @param {string} [type] */
const img = (data, type = "image/png") => ({ type: "image", source: { type: "base64", media_type: type, data } });
/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} msgs */
const lastResults = (msgs) => {
  const m = msgs.at(-1);
  return Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ c) => c?.type === "tool_result") : [];
};
/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("the proxy carries an image in a tool result", () => {
  test("the estimate weighs it as it weighs one the developer attached, not by its base64; a result of text alone counts as it always did", () => {
    const data = png(300_000).toString("base64");
    const attached = estimateBodyParts({ messages: [{ role: "user", content: [img(data)] }] });
    const asResult = estimateBodyParts({ messages: [{ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "Image: a.png" }, img(data)] }] }] });
    assert.equal(asResult.fixed, attached.fixed, "the image at the image rate, the message's framing beside it");
    assert.ok(asResult.text < 60, `the text part is the result's words and framing, not the base64: ${asResult.text}`);
    const plain = { type: "tool_result", tool_use_id: "t1", content: "some output\nline two" };
    assert.deepEqual(estimateBodyParts({ messages: [{ role: "user", content: [plain] }] }), { text: estimateTokens(plain), fixed: 4 });
    const plainList = { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "some output" }] };
    assert.deepEqual(estimateBodyParts({ messages: [{ role: "user", content: [plainList] }] }), { text: estimateTokens(plainList), fixed: 4 });
  });

  test("Anthropic → OpenAI: the tool message carries the result's text; its images follow the run of tool messages, each named by its call", () => {
    const { body, notes } = anthropicToOpenaiRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        { role: "user", content: "look at both" },
        { role: "assistant", content: [toolUse("t1", "Read", { file_path: "a.png" }), toolUse("t2", "Bash", { command: "ls" }), toolUse("t3", "Read", { file_path: "b.jpg" })] },
        {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "Image: a.png" }, img("QUFB")] },
            { type: "tool_result", tool_use_id: "t2", content: "a.png\nb.jpg" },
            { type: "tool_result", tool_use_id: "t3", content: [img("QkJC", "image/jpeg")] },
            { type: "text", text: "and?" },
          ],
        },
      ],
    });
    const after = /** @type {any[]} */ (body.messages).slice(2);
    assert.deepEqual(after.slice(0, 3), [
      { role: "tool", tool_call_id: "t1", content: "Image: a.png" },
      { role: "tool", tool_call_id: "t2", content: "a.png\nb.jpg" },
      { role: "tool", tool_call_id: "t3", content: "[1 image, in the message after the tool results]" },
    ]);
    assert.deepEqual(after[3], {
      role: "user",
      content: [
        { type: "text", text: "[The image from tool call t1 (Read):]" },
        { type: "image_url", image_url: { url: "data:image/png;base64,QUFB" } },
        { type: "text", text: "[The image from tool call t3 (Read):]" },
        { type: "image_url", image_url: { url: "data:image/jpeg;base64,QkJC" } },
        { type: "text", text: "and?" },
      ],
    });
    assert.equal(after.length, 4);
    assert.ok(notes.some((n) => /2 images? from tool results .*after the tool messages/.test(n)), notes.join(" | "));
  });

  test("Anthropic → OpenAI: a document a tool returned is named as the tool's, not as the user's attachment", () => {
    const { body } = anthropicToOpenaiRequest({
      model: "m",
      max_tokens: 10,
      messages: [
        { role: "assistant", content: [toolUse("t4", "fetch_spec", {})] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t4", content: [{ type: "document", title: "spec.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } }] }] },
      ],
    });
    // Words alone: the user message is one string, as any all-text user message is.
    const carried = /** @type {any[]} */ (body.messages).at(-1);
    assert.equal(carried.role, "user");
    assert.match(carried.content, /^\[The document from tool call t4 \(fetch_spec\):\]\[Tool call t4 \(fetch_spec\) returned "spec\.pdf" \(application\/pdf, 0 KB\), which this provider cannot receive as a file\. Get its text another way if you need it\.\]$/);
    assert.equal(/** @type {any[]} */ (body.messages).at(-2).content, "[1 document, in the message after the tool results]");
  });

  test("Responses → Chat: a list output's text is the tool message; its images and files follow the run of outputs; the list is kept for the next turn", () => {
    const output = [
      { type: "input_text", text: "Image: a.png" },
      { type: "input_image", image_url: "data:image/png;base64,QUFB", detail: "high" },
      { type: "input_image", file_id: "file-1" },
      { type: "input_file", file_data: "data:application/pdf;base64,JVBERi0=", filename: "spec.pdf" },
    ];
    const { chat, items, notes } = responsesToChat({
      model: "m",
      input: [
        { type: "message", role: "user", content: "look" },
        { type: "function_call", call_id: "c1", name: "view", arguments: "{}" },
        { type: "function_call", call_id: "c2", name: "ls", arguments: "{}" },
        { type: "function_call_output", call_id: "c1", output },
        { type: "function_call_output", call_id: "c2", output: "a.png" },
        { type: "message", role: "user", content: "and?" },
      ],
    });
    const m = /** @type {any[]} */ (chat.messages);
    assert.deepEqual(m.slice(2), [
      { role: "tool", tool_call_id: "c1", content: "Image: a.png" },
      { role: "tool", tool_call_id: "c2", content: "a.png" },
      {
        role: "user",
        content: [
          { type: "text", text: "[What tool call c1 (view) returned beside its text:]" },
          { type: "image_url", image_url: { url: "data:image/png;base64,QUFB", detail: "high" } },
          { type: "file", file: { file_data: "data:application/pdf;base64,JVBERi0=", filename: "spec.pdf" } },
        ],
      },
      { role: "user", content: "and?" },
    ]);
    assert.deepEqual(items.find((i) => i.call_id === "c1" && i.type === "function_call_output")?.output, output, "kept as it came, for previous_response_id");
    assert.ok(notes.some((n) => /file_id/.test(n)), notes.join(" | "));
    // An output whose list is text alone is the tool message, with nothing after it.
    const { chat: plain } = responsesToChat({ model: "m", input: [{ type: "function_call", call_id: "c3", name: "x", arguments: "{}" }, { type: "function_call_output", call_id: "c3", output: [{ type: "input_text", text: "one" }, { type: "input_text", text: "two" }] }] });
    assert.deepEqual(plain.messages.at(-1), { role: "tool", tool_call_id: "c3", content: "onetwo" });
  });
});

describe("read shows an image", () => {
  /** @type {string} */
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-images-"));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("PNG, JPEG, GIF and WebP, known by their first bytes, not their name: a line naming it, then the image", async () => {
    const files = {
      "shot.dat": [png(), "image/png", "PNG"],
      "photo.bin": [Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]), "image/jpeg", "JPEG"],
      "anim.x": [Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(100, 1)]), "image/gif", "GIF"],
      "pic": [Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4, 1), Buffer.from("WEBP"), Buffer.alloc(100, 1)]), "image/webp", "WebP"],
    };
    for (const [name, [bytes, type, label]] of Object.entries(files)) {
      writeFileSync(join(root, name), /** @type {Buffer} */ (bytes));
      const r = await runHand("read", { path: name, offset: 5 }, { root });
      assert.ok(r instanceof MediaResult, `${name} comes back as an image`);
      assert.equal(r.text, `[${name}: a ${label} image, ${/** @type {Buffer} */ (bytes).length < 1024 ? `${/** @type {Buffer} */ (bytes).length} bytes` : "2 KB"}.]`);
      assert.deepEqual(r.media, [img(/** @type {Buffer} */ (bytes).toString("base64"), /** @type {string} */ (type))]);
      assert.equal(String(r), r.text, "where only text goes, it is its text");
    }
    writeFileSync(join(root, "fake.png"), "not an image, just text\n");
    assert.equal(await runHand("read", { path: "fake.png" }, { root }), "     1\tnot an image, just text", "a name is not a type");
  });

  test("past 3.75 MB an image is refused in words; a PDF goes to pdftotext, not the image or text path; another binary is refused as before", async () => {
    writeFileSync(join(root, "huge.png"), png(IMAGE_MAX_BYTES));
    await assert.rejects(() => runHand("read", { path: "huge.png" }, { root }), (e) => e instanceof HandError && /huge\.png is a PNG image of 3\.8 MB, past the 3\.75 MB an image may have/.test(e.message));
    writeFileSync(join(root, "exactly.png"), png(IMAGE_MAX_BYTES - PNG_START.length));
    assert.ok((await runHand("read", { path: "exactly.png" }, { root })) instanceof MediaResult, "the limit itself is inside");
    writeFileSync(join(root, "spec.pdf"), "%PDF-1.7\nplain enough to pass as text\n");
    // A PDF's text comes through pdftotext (TL-D26, test/read-pdf.test.js), never as the file's own bytes.
    await assert.rejects(() => runHand("read", { path: "spec.pdf" }, { root, pdftotext: null }), /spec\.pdf is a PDF, and read takes a PDF's text with pdftotext/);
    writeFileSync(join(root, "bin.dat"), Buffer.from([0x50, 0x4b, 0x00, 0x01]));
    await assert.rejects(() => runHand("read", { path: "bin.dat" }, { root }), /looks like a binary file/);
  });

  test("an image read is a sighting: the agent saw the file, so write may replace it", async () => {
    writeFileSync(join(root, "logo.png"), png());
    /** @type {Map<string, any>} */
    const seen = new Map();
    await assert.rejects(() => runHand("write", { path: "logo.png", content: "x" }, { root, seen }), /have not read it/);
    await runHand("read", { path: "logo.png" }, { root, seen });
    await runHand("write", { path: "logo.png", content: "x" }, { root, seen });
  });

  test("the read card says what was shown: an image's type and size (not its line's characters), a text read's lines", async () => {
    writeFileSync(join(root, "card.png"), png());
    const shown = String(await runHand("read", { path: "card.png" }, { root }));
    assert.equal(readFacts({ preview: shown, chars: shown.length }), "PNG image, 2 KB", "not \"1 line · 30 chars\"");
    assert.equal(readFacts({ preview: shown, chars: shown.length, ms: 2500 }), "PNG image, 2 KB · 2.5s");
    assert.equal(readFacts({ preview: `${shown}\n[the image was not sent: the provider refused the request with it: "no"]`, chars: 99 }), "PNG image, 2 KB");
    writeFileSync(join(root, "card.txt"), "a\nb\n");
    const text = String(await runHand("read", { path: "card.txt" }, { root }));
    assert.equal(readFacts({ preview: text, chars: text.length }), `2 lines · ${text.length} chars`);
    assert.equal(readFacts({ preview: "     1\t[x: a PNG image, 2 KB.]" }), "1 line", "a text file that says so is still text");
    assert.equal(readFacts({}), "");
  });

  test("imageTypeOf reads the bytes only", () => {
    assert.equal(imageTypeOf(PNG_HEAD), "image/png");
    assert.equal(imageTypeOf(PNG_HEAD.subarray(0, 7)), null);
    assert.equal(imageTypeOf(Buffer.from("GIF87a")), "image/gif");
    assert.equal(imageTypeOf(Buffer.from("RIFF....WAVE")), null);
    assert.equal(imageTypeOf(Buffer.from([0xff, 0xd8])), null);
  });
});

test("an MCP tool's image is shown when its bytes are one of the four types, up to the same limit; others stay named", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-images-mcp-"));
  const FIXTURE = fileURLToPath(new URL("./fixtures/mcp-server.mjs", import.meta.url));
  const c = await connectMcp({ name: "fx", command: process.execPath, args: [FIXTURE] }, { cwd: dir, timeoutMs: 10_000 });
  try {
    const shown = await c.call("rich", { png: true });
    assert.ok(shown instanceof MediaResult);
    assert.equal(shown.text, "line one\n[image image/png, shown below]\n[resource file:///x — x]");
    assert.deepEqual(shown.media, [img(Buffer.concat([PNG_HEAD, Buffer.alloc(16, 7)]).toString("base64"))], "the fixture's PNG");
    assert.equal(await c.call("rich", {}), "line one\n[image image/png]\n[resource file:///x — x]", "bytes that are no image stay named");
    const big = await c.call("rich", { png: true, bytes: IMAGE_MAX_BYTES + 1 });
    assert.equal(big, "line one\n[image image/png, 3.8 MB: past the 3.75 MB an image may have]\n[resource file:///x — x]");
  } finally {
    c.close();
    await removeDirs(dir); // the server's cwd: removable once its process is gone
  }
});

describe("the loop shows a tool's image to the model", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** @type {(call: any) => any} */
  let brain = () => undefined;
  const shot = png();
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-images-root-"));
    writeFileSync(join(root, "shot.png"), shot);
    up = await fakeUpstream(async (call) => brain(call));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root] };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    // The server's cwd: Windows may hold it a moment after its process is gone (EPERM in a full run of 10-24).
    await removeDirs(root);
  });
  const H = () => ({ "x-filament-cwd": root, "x-session-id": `s-${Math.random().toString(36).slice(2, 8)}` });
  /** @param {any} body */
  const ask = (body) => shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, ...body }, H());
  /** @param {string} runId */
  const eventsOf = async (runId) => (await (await shim.api(`/api/runs/${runId}/events?since=0&limit=5000`)).json()).events;
  /** @param {any} r */
  const imagesIn = (r) => (Array.isArray(r?.content) ? r.content.filter((/** @type {any} */ b) => b?.type === "image") : []);

  test("the tool_result carries the line and then the image; the event and its preview carry the line", async () => {
    let round = 0;
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: "shot.png" })], "tool_use");
      const [res] = lastResults(call.body.messages);
      assert.deepEqual(res.content, [{ type: "text", text: "[shot.png: a PNG image, 2 KB.]" }, img(shot.toString("base64"))]);
      return reply([{ type: "text", text: "seen" }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "look at shot.png" }] });
    assert.equal(r.status, 200);
    assert.equal(round, 2);
    const end = (await eventsOf(String(r.headers.get("x-filament-request-id")))).find((/** @type {any} */ e) => e.type === "tool-end" && e.name === "read");
    assert.equal(end.ok, true);
    assert.equal(end.preview, "[shot.png: a PNG image, 2 KB.]");
    assert.equal(end.chars, "[shot.png: a PNG image, 2 KB.]".length);
  });

  test("a round refused with images is retried once without them, the refusal quoted; the turn's later images come back as words", async () => {
    let round = 0;
    const refusal = "This model does not support image input.";
    /** @type {any[]} */
    const seen = [];
    brain = (call) => {
      round++;
      seen.push(call.body.messages);
      if (round === 1) return reply([toolUse("r1", "read", { path: "shot.png" })], "tool_use");
      if (round === 2) {
        assert.equal(imagesIn(lastResults(call.body.messages)[0]).length, 1, "the first try carries the image");
        return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: refusal } } };
      }
      if (round === 3) {
        const [res] = lastResults(call.body.messages);
        assert.deepEqual(imagesIn(res), [], "the retry carries no image");
        assert.deepEqual(res.content, [{ type: "text", text: "[shot.png: a PNG image, 2 KB.]" }, { type: "text", text: `[the image was not sent: the provider refused the request with it: "${refusal}"]` }]);
        return reply([toolUse("r2", "read", { path: "shot.png" })], "tool_use");
      }
      const [res] = lastResults(call.body.messages);
      assert.equal(res.tool_use_id, "r2");
      assert.deepEqual(res.content, `[shot.png: a PNG image, 2 KB.]\n[the image was not sent: the provider refused the request with it: "${refusal}"]`, "later images in the turn are words");
      return reply([{ type: "text", text: "done" }]);
    };
    up.reset();
    const r = await ask({ messages: [{ role: "user", content: "look" }] });
    assert.equal(r.status, 200);
    assert.equal(round, 4);
    const rec = await (await shim.api(`/api/requests/${r.headers.get("x-filament-request-id")}`)).json();
    assert.match((rec.changes || []).join(" | "), /round 2 was refused with 1 image from tool results \(This model does not support image input\.\) — retrying once without it/);
  });

  test("no retry without images, nor for a refusal that is not about the request's content", async () => {
    let round = 0;
    brain = () => {
      round++;
      return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "bad request" } } };
    };
    up.reset();
    const r1 = await ask({ messages: [{ role: "user", content: "plain" }] });
    assert.equal(round, 1, "nothing to withdraw: the failure stands");
    assert.match(JSON.stringify(await r1.json()), /bad request/);
    round = 0;
    /** @type {any[]} */
    const limited = [];
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: "shot.png" })], "tool_use");
      limited.push(lastResults(call.body.messages)[0]);
      return { status: 429, json: { type: "error", error: { type: "rate_limit_error", message: "slow down" } }, headers: { "retry-after": "0" } };
    };
    const r2 = await ask({ messages: [{ role: "user", content: "look" }] });
    await r2.text();
    // A rate limit is no refusal of the image: nothing is withdrawn. The round is tried again as a busy provider's is
    // (HarnessV3-AtHome AH-F4) — ten tries, each with its image.
    assert.equal(round, 11);
    assert.ok(limited.every((res) => imagesIn(res).length === 1), "no withdrawal");
    round = 0;
    /** @type {any[]} */
    const retried = [];
    brain = (call) => {
      round++;
      if (round === 1) return reply([toolUse("r1", "read", { path: "shot.png" })], "tool_use");
      retried.push(lastResults(call.body.messages)[0]);
      return { status: 400, json: { type: "error", error: { type: "invalid_request_error", message: "prompt is too long: 99999 tokens > 5000 maximum" } } };
    };
    const r3 = await ask({ messages: [{ role: "user", content: "look" }] });
    assert.match(JSON.stringify(await r3.json()), /prompt is too long/);
    assert.equal(round, 3, "one retry: the overflow door's");
    assert.equal(imagesIn(retried[1]).length, 1, "a size refusal is the overflow door's: the recent result rides whole, its image not withdrawn");
    const rec = await (await shim.api(`/api/requests/${r3.headers.get("x-filament-request-id")}`)).json();
    assert.doesNotMatch((rec.changes || []).join(" | "), /image from tool results/);
  });
});

test("a session's history keeps a read image as it keeps an attached one; a folded turn leaves a placeholder", async () => {
  const shot = png(5000);
  const data = shot.toString("base64");
  let round = 0;
  /** @type {string[]} */
  const bodies = [];
  const up = await fakeUpstream(async (call) => {
    if (call.method === "GET") return { json: { data: [{ id: "m-1", type: "model", display_name: "m-1" }], has_more: false } };
    bodies.push(JSON.stringify(call.body));
    round++;
    if (round === 1) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [toolUse("r1", "read", { path: "shot.png" })], usage: { input_tokens: 50, output_tokens: 8 } });
    return anthropicReply("", { model: "m-1", stop: "end_turn", blocks: [{ type: "text", text: `turn reply ${round}` }], usage: { input_tokens: 50, output_tokens: 8 } });
  });
  const shim = await startApp({
    memory: true,
    configure: (cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
      cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
    },
  });
  try {
    writeFileSync(join(shim.dataDir, "shot.png"), shot);
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1" } })).json();
    const turn = async (/** @type {string} */ content) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content } });
      await r.text();
    };
    await turn("look at shot.png");
    assert.equal(round, 2);
    assert.ok(bodies[1].includes(data), "the turn that read it sent it");
    // The history goes as it is (a compaction is what folds it), so the model can look at the image again, as at one
    // the developer attached.
    await turn("thanks");
    assert.ok(bodies[2].includes(data), "the next turn's history carries it");
    const folded = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "fold" } })).json();
    assert.equal(folded.compaction?.method, "fold", JSON.stringify(folded));
    await turn("more");
    assert.equal(round, 4, "the fold called no model");
    assert.ok(!bodies[3].includes(data), "folded: the bytes are gone");
    assert.match(bodies[3], /read shot\.png → \[shot\.png: a PNG image, 5 KB\.\] \[image\]/, "its call stays, one line, the image a placeholder");
  } finally {
    await shim.stop();
    await up.close();
  }
});

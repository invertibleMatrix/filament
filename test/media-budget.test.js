// @ts-check
// The pictures, PDFs and files a request carries, within the room one request has (core/media.js, pdfs.js
// `mediaWithin`): the newest go whole, the newest message's all; an older PDF past the room goes as its text, an older
// picture or file as words that name it — in the request, never in the chat. At dispatch the room is the 24 MB of
// media Anthropic's 32 MB request leaves beside its words; a call of Filament's own loop keeps within what its front
// door takes in one request (`server.maxBodyBytes`, internal-call.js `withinFrontDoor`).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { leftOutWords, MEDIA_BYTES, mediaIn, mediaPast, withTexts } from "../src/core/media.js";
import { mediaWithin } from "../src/app/pipeline/dispatch/pdfs.js";
import * as internalCall from "../src/app/internal-call.js";
import { PDFTOTEXT } from "../src/adapters/tools/pdf.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { makePdf } from "./helpers/pdf.js";
import { removeDirs } from "./helpers/wait.js";

const MB = 1024 * 1024;
/** A picture of `n` characters of base64. @param {number} n @param {string} [type] */
const pic = (n, type = "image/png") => ({ type: "image", source: { type: "base64", media_type: type, data: "A".repeat(n) } });
/** @param {any[]} content */
const user = (content) => ({ role: "user", content });
const reply = { role: "assistant", content: "seen" };

describe("the media a request carries", () => {
  test("found in order, wherever a block keeps them: a message's own, a tool result's, an OpenAI client's data: address; a picture elsewhere carries none", () => {
    const doc = { type: "document", title: "a.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0=" } };
    const body = {
      messages: [
        user([pic(8), { type: "text", text: "look" }, { type: "image", source: { type: "url", url: "https://example.test/a.png" } }]),
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "read", input: {} }] },
        user([{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "a.png" }, pic(12, "image/jpeg")] }, doc]),
        user([{ type: "image_url", image_url: { url: "data:image/webp;base64,QUFB" } }, { type: "file", file: { file_data: "data:text/csv;base64,QQ==", filename: "t.csv" } }]),
      ],
    };
    assert.deepEqual(
      mediaIn(body).map((p) => [p.m, p.b, p.t, p.kind, p.type, p.name, p.bytes]),
      [
        [0, 0, -1, "picture", "image/png", null, 8],
        [2, 0, 1, "picture", "image/jpeg", null, 12],
        [2, 1, -1, "pdf", "application/pdf", "a.pdf", 8],
        [3, 0, -1, "picture", "image/webp", null, "data:image/webp;base64,QUFB".length],
        [3, 1, -1, "file", "text/csv", "t.csv", "data:text/csv;base64,QQ==".length],
      ],
    );
    assert.deepEqual(mediaIn({ messages: [user([{ type: "text", text: "x" }]), { role: "user", content: "words" }] }), []);
  });

  test("past the room the oldest go, never the newest message's; the line moves a third of the room at a time, so newer pictures under a step leave it where it was", () => {
    /** Pictures of these sizes, one message each, and a last message of words. @param {number[]} sizes */
    const chat = (sizes) => ({ messages: [...sizes.map((n) => user([pic(n)])), user([{ type: "text", text: "and?" }])] });
    /** The messages whose pictures go past `room`. @param {any} body @param {number} room */
    const pastOf = (body, room) => [...mediaPast(mediaIn(body), room, body.messages.length - 1)].map((p) => p.m);
    assert.deepEqual(pastOf(chat([30, 30, 30]), 90), [], "within the room, all go");
    // 30 units of 3 over a room of 24: the line is at 8 (one step of a third), so the three that begin before it go.
    const thirty = chat(Array(10).fill(3));
    assert.deepEqual(pastOf(thirty, 24), [0, 1, 2]);
    const kept = (/** @type {any} */ body, /** @type {number} */ room) => mediaIn(body).filter((p) => !pastOf(body, room).includes(p.m)).reduce((n, p) => n + p.bytes, 0);
    assert.equal(kept(thirty, 24), 21, "between two thirds of the room and all of it");
    assert.deepEqual(pastOf(chat([...Array(10).fill(3), 1, 1]), 24), [0, 1, 2], "two units more: the line holds, and the same pictures go");
    assert.deepEqual(pastOf(chat([...Array(10).fill(3), 1, 1, 1]), 24), [0, 1, 2, 3, 4, 5], "past a step's worth it moves one step");
    // The newest message's pictures go however much they are; every older one goes past the room.
    const big = { messages: [user([pic(5)]), reply, user([pic(40), pic(40), { type: "text", text: "both" }])] };
    assert.deepEqual([...mediaPast(mediaIn(big), 24, 2)].map((p) => [p.m, p.b]), [[0, 0]]);
  });

  test("a picture left out is named by its type and its file's size, a file by its name; each stands in its place, set apart, with its cache mark", () => {
    const [p] = mediaIn({ messages: [user([pic(1_600_000)])] });
    assert.equal(leftOutWords(p), "[An earlier picture (PNG, 1.1 MB) is left out of this request to keep it within the size limit; it is still in the chat.]");
    const [f] = mediaIn({ messages: [user([{ type: "file", file: { file_data: `data:application/zip;base64,${"A".repeat(4096)}`, filename: "logs.zip" } }])] });
    assert.equal(leftOutWords(f), "[An earlier file, logs.zip (3 KB), is left out of this request to keep it within the size limit; it is still in the chat.]");
    const body = { messages: [user([{ type: "text", text: "look" }, pic(8), { ...pic(8), cache_control: { type: "ephemeral" } }, { type: "text", text: "then" }]), { role: "assistant", content: [{ type: "tool_use", id: "t", name: "x", input: {} }] }, user([{ type: "tool_result", tool_use_id: "t", content: [pic(4)] }])] };
    const places = mediaIn(body);
    const out = withTexts(body, new Map(places.map((q, i) => [q, `W${i}`])));
    assert.deepEqual(out.messages[0].content, [{ type: "text", text: "look" }, { type: "text", text: "\n\nW0\n\n" }, { type: "text", text: "W1\n\n", cache_control: { type: "ephemeral" } }, { type: "text", text: "then" }]);
    assert.deepEqual(out.messages[2].content[0].content, [{ type: "text", text: "W2" }]);
    assert.equal(out.messages[1], body.messages[1], "a message with nothing put is the same message");
    assert.equal(body.messages[0].content[1].type, "image", "the body it was given is left as it was");
    assert.equal(withTexts(body, new Map()), body);
  });

  test("the room at dispatch is 24 MB: what Anthropic's 32 MB request leaves beside a long chat's words", () => {
    assert.equal(MEDIA_BYTES, 24 * MB);
  });
});

describe("mediaWithin", () => {
  test("an older picture past the room is words in its place, said once on the record; within it nothing changes", async () => {
    const body = { messages: [user([pic(3000), pic(3000), { type: "text", text: "look" }]), reply, user([pic(3000), { type: "text", text: "and this" }])] };
    const same = await mediaWithin(body, { bytes: 9000, pdfs: true, why: "the room" });
    assert.equal(same.body, body);
    assert.deepEqual(same.notes, []);
    const cut = await mediaWithin(body, { bytes: 7500, pdfs: true, why: "the room of the test" });
    assert.equal(cut.body.messages[0].content[0].type, "text");
    assert.match(cut.body.messages[0].content[0].text, /^\[An earlier picture \(PNG, 2 KB\) is left out of this request/);
    assert.equal(cut.body.messages[0].content[1].type, "image", "the line runs at 2,500 of 9,000: the second begins past it");
    assert.equal(cut.body.messages[2], body.messages[2], "the newest message's as it was");
    assert.deepEqual(cut.notes, ["media: a picture (2 KB) left out of the request, past the room of the test; each is named in its place, and is still in the chat"]);
  });

  test("a PDF that goes as its text takes no room and is left to pdfsAsSent", async () => {
    const doc = { type: "document", title: "a.pdf", source: { type: "base64", media_type: "application/pdf", data: "A".repeat(8000) } };
    const body = { messages: [user([doc, pic(3000)]), reply, user([pic(3000)])] };
    const out = await mediaWithin(body, { bytes: 6000, pdfs: false, why: "w" });
    assert.equal(out.body, body, "6,000 of pictures: within");
  });
});

describe("an older PDF past the room goes as its text", { skip: !PDFTOTEXT && "needs pdftotext" }, () => {
  test("its pages, as pdfsAsSent sends one past the PDFs' room, said on the record", async () => {
    const older = { type: "document", title: "older.pdf", source: { type: "base64", media_type: "application/pdf", data: makePdf(["the older one says hello"], { pad: 6000 }).toString("base64") } };
    const body = { messages: [user([older, { type: "text", text: "read this" }]), reply, user([pic(8000), { type: "text", text: "and this" }])] };
    const out = await mediaWithin(body, { bytes: 9000, pdfs: true, why: "the room" });
    const text = out.body.messages[0].content[0];
    assert.equal(text.type, "text");
    assert.match(text.text, /^--- Attached file: older\.pdf \(a PDF of 1 page: its text; its pictures and layout are not included\) ---\n\[Page 1\]\nthe older one says hello\n--- end of older\.pdf ---\n\n$/);
    assert.deepEqual(out.notes, ['pdf: "older.pdf" sent as its text, 1 page: past the room']);
  });
});

test("a call of Filament's own goes within what its front door takes: its older media left out until it is, the newest message's whole however much", async () => {
  const { withinFrontDoor } = internalCall;
  const body = { model: "m", messages: [user([pic(6000), pic(6000)]), reply, user([pic(6000), { type: "text", text: "and?" }])] };
  const same = await withinFrontDoor(body, 64 * MB);
  assert.equal(same.text, JSON.stringify(body));
  assert.deepEqual(same.notes, []);
  const cut = await withinFrontDoor(body, 14_000);
  assert.ok(Buffer.byteLength(cut.text) <= 14_000, `${Buffer.byteLength(cut.text)} bytes`);
  const sent = JSON.parse(cut.text);
  assert.equal(sent.messages[0].content[0].type, "text");
  assert.equal(sent.messages[2].content[0].type, "image");
  assert.match(cut.notes[0], /^media: a picture \(4 KB\) left out of the request, past the 14 KB Filament takes in one request \(server\.maxBodyBytes\), the newest first;/);
  const alone = await withinFrontDoor(body, 5000);
  const went = JSON.parse(alone.text);
  assert.deepEqual(went.messages.map((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.map((/** @type {any} */ b) => b.type) : m.content)), [["text", "text"], "seen", ["image", "text"]], "the newest message whole, over the limit: the front door's refusal stands");
});

/**
 * A Filament whose Claude is the fake upstream, with the loop on in a folder of its own that holds a picture to read.
 * @param {(cfg: any) => void} [more]
 */
async function claudeBehind(more = () => {}) {
  /** @type {{ brain: (call: any) => any }} */
  const script = { brain: () => undefined };
  const root = mkdtempSync(join(tmpdir(), "filament-media-budget-"));
  const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
  writeFileSync(join(root, "shot.png"), Buffer.concat([PNG_START, Buffer.alloc(900_000, 7)]));
  const up = await fakeUpstream(async (call) => script.brain(call));
  const s = await startApp({
    configure: (cfg) => {
      cfg.upstreams = [{ id: "anth", name: "anth", type: "anthropic-compatible", baseUrl: up.url, apiKey: "s", enabled: true, discoverModels: false }];
      cfg.routes = [{ match: "claude-*", upstream: "anth", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root] };
      more(cfg);
    },
  });
  return {
    script,
    up,
    s,
    root,
    async stop() {
      await s.stop();
      await up.close();
      await removeDirs(root);
    },
  };
}

// (fails before: yes — every picture of a chat went in every request, so past 24 MB of them a chat's requests broke
// Anthropic's 32 MB limit, every later turn with them)
describe("through Filament's dispatch", () => {
  /** @type {Awaited<ReturnType<typeof claudeBehind>>} */
  let at;
  before(async () => {
    at = await claudeBehind();
  });
  after(async () => {
    await at?.stop();
  });

  test("a client's chat past 24 MB of pictures: Claude gets the newest whole and the oldest named, and the record says so", async () => {
    at.up.reset();
    // Ten pictures of 3 MB of base64, in a body under the 64 MB the front door takes.
    const three = () => pic(3 * MB);
    const r = await at.s.post("/v1/messages", {
      model: "claude-sonnet-5-5",
      max_tokens: 50,
      messages: [user([three(), three(), three(), three(), three(), { type: "text", text: "look" }]), reply, user([three(), three(), three(), three(), three(), { type: "text", text: "and these" }]), reply, user([{ type: "text", text: "which is bluest?" }])],
    });
    assert.equal(r.status, 200, await r.clone().text());
    await r.text();
    const sent = at.up.received.filter((c) => c.kind === "anthropic").at(-1)?.body;
    const kinds = sent.messages.slice(0, 3).map((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content.map((/** @type {any} */ b) => b.type) : "words"));
    assert.deepEqual(kinds, [["text", "text", "text", "image", "image", "text"], "words", ["image", "image", "image", "image", "image", "text"]], "30 MB over a room of 24: the line at 8, so the three that begin before it go");
    assert.match(sent.messages[0].content[0].text, /^\[An earlier picture \(PNG, 2\.3 MB\) is left out of this request to keep it within the size limit; it is still in the chat\.\]\n\n$/);
    const media = mediaIn(sent).reduce((n, p) => n + p.bytes, 0);
    assert.ok(media <= MEDIA_BYTES, `${media} bytes of media sent`);
    const rec = await at.s.record(String(r.headers.get("x-filament-request-id")));
    assert.ok(rec.changes.includes("media: 3 pictures (6.8 MB) left out of the request, past the 24 MB of pictures, PDFs and files one request carries, the newest first; each is named in its place, and is still in the chat"), rec.changes.join("\n"));
  });
});

// (fails before: yes — the loop's call carried the whole chat to Filament's own front door, which refused it past
// server.maxBodyBytes, and the turn failed, as every later turn of the chat would)
describe("through Filament's loop", () => {
  /** @type {Awaited<ReturnType<typeof claudeBehind>>} */
  let at;
  before(async () => {
    // A front door of 4 MB, so a loop's call outgrows it with a few pictures.
    at = await claudeBehind((cfg) => void (cfg.server.maxBodyBytes = 4 * MB));
  });
  after(async () => {
    await at?.stop();
  });

  test("the loop's call past the front door's limit goes with its oldest pictures named, the turn's record says so, and the turn goes on", async () => {
    let round = 0;
    /** @type {any[]} */
    const bodies = [];
    at.script.brain = (call) => {
      if (call.kind !== "anthropic") return undefined;
      round++;
      bodies.push(call.body);
      if (round === 1) return anthropicReply("", { model: "claude-sonnet-5-5", stop: "tool_use", blocks: [{ type: "tool_use", id: "r1", name: "read", input: { path: "shot.png" } }] });
      return anthropicReply("seen", { model: "claude-sonnet-5-5" });
    };
    at.up.reset();
    const one = () => pic(MB);
    // Three pictures of 1 MB under the 4 MB the front door takes: the loop's first call goes as it is; its second
    // carries the 1.1 MB of the picture read beside them, past 4 MB.
    const r = await at.s.house(
      "/v1/messages",
      { model: "agent/claude-sonnet-5-5", max_tokens: 400, stream: false, messages: [user([one(), one(), { type: "text", text: "look" }]), reply, user([one(), { type: "text", text: "and read shot.png" }])] },
      { "x-filament-cwd": at.root, "x-session-id": "media-budget-loop" },
    );
    const said = await r.text();
    assert.equal(r.status, 200, said);
    assert.equal(round, 2, said);
    assert.deepEqual(bodies[0].messages[0].content.map((/** @type {any} */ b) => b.type), ["image", "image", "text"], "the first call within the limit, whole");
    const second = bodies[1].messages;
    assert.deepEqual(second[0].content.map((/** @type {any} */ b) => b.type), ["text", "text", "text"]);
    assert.match(second[0].content[0].text, /^\[An earlier picture \(PNG, 768 KB\) is left out of this request/);
    assert.equal(second[2].content[0].type, "image", "a newer picture whole");
    assert.equal(second.at(-1).content[0].content.at(-1).type, "image", "the newest message's picture, the one read, whole");
    const rec = await at.s.record(String(r.headers.get("x-filament-request-id")));
    assert.ok(rec.changes.includes("media: 2 pictures (1.5 MB) left out of the request, past the 4 MB Filament takes in one request (server.maxBodyBytes), the newest first; each is named in its place, and is still in the chat"), rec.changes.join("\n"));
  });
});

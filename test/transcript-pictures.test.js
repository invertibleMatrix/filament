// @ts-check
// HarnessV4_Tasks U9: pictures in the transcript. A picture an agent looked at (a read of an image, a tool's screenshot)
// is kept beside the run log as the model saw it, named on its call's tool-end, served from Filament's own address and
// drawn on the call's card. Through the app for Filament's own loop; a coding agent's run on its own (agent-run.js, the
// events shaped as claude-agent-acp 0.87.0 sends a Read of an image: its tool-calls/reporters/read.js).
// (fails before: yes — the loop sent the page words only, a coding agent's pictures were thrown away where its result
// became words, and no card drew one)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { picturesIn } from "../src/core/media.js";
import { createRunImages, IMAGES_PER_CALL, IMAGE_KEEP_MAX_BYTES } from "../src/services/run-images.js";
import { createAgentRun } from "../src/app/agent-run.js";
import { alignEvents, againOf } from "../src/ui/harness/lib/labels.js";
import { groupRuns, roundRows, turnPictures, pictureStrip } from "../src/ui/harness/conversation/tools/render.js";
import { userRow } from "../src/ui/harness/conversation/turn.js";
import { steerEl } from "../src/ui/harness/conversation/timeline.js";
import { startApp, fakeUpstream, anthropicReply, FAKE_ACP_AGENT } from "./helpers/app.js";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs } from "./helpers/wait.js";

// A PNG's signature and the start of its IHDR chunk; the filler's byte tells two pictures apart.
const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const png = (filler = 2000, fill = 7) => Buffer.concat([PNG_START, Buffer.alloc(filler, fill)]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
/** @param {Buffer} b */
const b64 = (b) => b.toString("base64");
/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} blocks @param {string} [stop] */
const reply = (blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });

describe("the pictures a tool result carries, whatever the engine's shape", () => {
  test("Anthropic's block, MCP's and ACP's, ACP's content wrapper and a file an agent looked at; words and the rest are left out", () => {
    const got = picturesIn([
      { type: "text", text: "Image: a.png" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "QUFB" } },
      { type: "image", data: "QkJC", mimeType: "image/jpeg" },
      { type: "content", content: { type: "image", data: "Q0ND", mimeType: "image/png" } },
      { type: "content", content: { type: "text", text: "words" } },
      { type: "image", path: "/tmp/shot.png" },
      { type: "image", source: { type: "url", url: "https://example.test/a.png" } },
      { type: "diff", oldText: "a", newText: "b" },
    ]);
    assert.deepEqual(got, [{ data: "QUFB" }, { data: "QkJC" }, { data: "Q0ND" }, { path: "/tmp/shot.png" }], "an address on another site is never fetched");
    assert.deepEqual(picturesIn("just words"), []);
    assert.deepEqual(picturesIn(null), []);
    assert.deepEqual(picturesIn({ type: "image", data: "QUFB", mimeType: "image/png" }), [{ data: "QUFB" }], "one block, not in a list");
  });
});

describe("the run log keeps them beside its files", () => {
  /** @type {string} */
  let dir;
  /** @type {{ persist: boolean, retentionDays: number, imagesMaxMB: number }} */
  let k;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-run-images-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));
  /** A store in a folder of its own. @param {string} name */
  const store = (name) => {
    k = { persist: true, retentionDays: 7, imagesMaxMB: 500 };
    return createRunImages({ dir: join(dir, name), knobs: () => k });
  };

  test("by content: the same picture twice is one file; each is named by its ref, its type and its size, the first bytes deciding the type", () => {
    const s = store("content");
    const a = s.keep([{ data: b64(png()) }]);
    assert.equal(a.images.length, 1);
    assert.match(a.images[0].ref, /^[0-9a-f]{32}\.png$/);
    assert.deepEqual([a.images[0].type, a.images[0].bytes, a.notKept], ["image/png", png().length, null]);
    const again = s.keep([{ data: b64(png()) }]);
    assert.equal(again.images[0].ref, a.images[0].ref);
    assert.equal(readdirSync(join(dir, "content")).length, 1, "kept once");
    assert.deepEqual(readFileSync(/** @type {string} */ (s.fileOf(a.images[0].ref))), png());
  });

  test("never an SVG or another type, never past 10 MB, never past 8 a call: each one not kept is counted, and why", () => {
    const s = store("refused");
    const many = Array.from({ length: IMAGES_PER_CALL + 1 }, (_, i) => ({ data: b64(png(100, i + 1)) }));
    const out = s.keep([{ data: b64(SVG) }, { data: b64(png(IMAGE_KEEP_MAX_BYTES)) }, ...many]);
    assert.equal(out.images.length, IMAGES_PER_CALL);
    assert.deepEqual(out.notKept, { count: 3, why: "1 not a PNG, JPEG, GIF or WebP; 1 over 10 MB; 1 past 8 a call" });
  });

  test("a file an agent looked at is copied as it is now; one that cannot be read is said", () => {
    const s = store("files");
    const shot = join(dir, "viewed.png");
    writeFileSync(shot, png(300, 9));
    const out = s.keep([{ path: shot }, { path: join(dir, "gone.png") }]);
    assert.deepEqual(readFileSync(/** @type {string} */ (s.fileOf(out.images[0].ref))), png(300, 9));
    assert.deepEqual(out.notKept, { count: 1, why: "1 whose file could not be read" });
  });

  test("none are kept where the run log keeps no files or the cap is 0, and the call says so", () => {
    const s = store("off");
    k.imagesMaxMB = 0;
    assert.deepEqual(s.keep([{ data: b64(png()) }]), { images: [], notKept: { count: 1, why: "pictures are not kept: observability.runEvents.imagesMaxMB is 0" } });
    k.imagesMaxMB = 500;
    k.persist = false;
    assert.deepEqual(s.keep([{ data: b64(png()) }]), { images: [], notKept: { count: 1, why: "pictures are not kept: observability.runEvents.persist is off" } });
    assert.deepEqual(s.keep([]), { images: [], notKept: null }, "no picture, nothing to say");
  });

  test("a ref is served only as its own name says it: no other path, no other case", () => {
    const s = store("refs");
    const { images } = s.keep([{ data: b64(png()) }]);
    assert.ok(s.fileOf(images[0].ref));
    for (const bad of ["../config.json", `${images[0].ref.toUpperCase()}`, `${"0".repeat(32)}.svg`, `${"0".repeat(31)}.png`, `${"0".repeat(32)}.png`, ""])
      assert.equal(s.fileOf(bad), null, bad);
  });

  test("swept with the run files: past the retention by its last use, and past the cap oldest first, never the newest", async () => {
    const s = store("sweep");
    const day = 86400;
    /** A kept picture's last use, set back. @param {ReturnType<typeof store>} where @param {string} ref @param {number} daysAgo */
    const at = (where, ref, daysAgo) => {
      const t = Date.now() / 1000 - daysAgo * day;
      utimesSync(/** @type {string} */ (where.fileOf(ref)), t, t);
    };
    const [old, used, fresh] = [png(100, 1), png(100, 2), png(100, 3)].map((b) => s.keep([{ data: b64(b) }]).images[0].ref);
    at(s, old, 8);
    at(s, used, 8);
    s.keep([{ data: b64(png(100, 2)) }]);
    assert.equal(await s.sweep(), 1, "one past seven days");
    assert.deepEqual([s.fileOf(old), !!s.fileOf(used), !!s.fileOf(fresh)], [null, true, true], "kept again: used now, so it stays");
    const capped = store("cap");
    k.imagesMaxMB = (2 * png().length + 100) / 1048576;
    const refs = [png(2000, 1), png(2000, 2)].map((b) => capped.keep([{ data: b64(b) }]).images[0].ref);
    at(capped, refs[0], 2);
    at(capped, refs[1], 1);
    const third = capped.keep([{ data: b64(png(2000, 3)) }]).images[0].ref;
    assert.deepEqual([capped.fileOf(refs[0]), !!capped.fileOf(refs[1]), !!capped.fileOf(third)], [null, true, true], "the oldest went as the third came");
    const total = readdirSync(join(dir, "cap")).reduce((n, f) => n + statSync(join(dir, "cap", f)).size, 0);
    assert.ok(total <= k.imagesMaxMB * 1048576, `${total} bytes kept`);
  });
});

describe("Filament's own loop: a read of an image", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  const shot = png();
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-pictures-root-"));
    writeFileSync(join(root, "shot.png"), shot);
    let round = 0;
    up = await fakeUpstream(async () => (++round % 2 === 1 ? reply([toolUse(`r${round}`, "read", { path: "shot.png" })], "tool_use") : reply([{ type: "text", text: "seen" }])));
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
    await removeDirs(root);
  });

  test("its tool-end names the picture, never its bytes, and Filament serves it from its own address as the model saw it", async () => {
    const r = await shim.house("/v1/messages", { model: "agent/brain-model", max_tokens: 400, stream: false, messages: [{ role: "user", content: "look at shot.png" }] }, { "x-filament-cwd": root, "x-session-id": "s-pictures" });
    assert.equal(r.status, 200);
    const events = (await (await shim.api(`/api/runs/${r.headers.get("x-filament-request-id")}/events?since=0&limit=5000`)).json()).events;
    const end = events.find((/** @type {any} */ e) => e.type === "tool-end" && e.name === "read");
    assert.equal(end.images?.length, 1, JSON.stringify(end));
    assert.deepEqual([end.images[0].type, end.images[0].bytes], ["image/png", shot.length]);
    assert.ok(!JSON.stringify(end).includes(b64(shot).slice(0, 40)), "no bytes on the event");
    assert.equal(end.preview, "[shot.png: a PNG image, 2 KB.]", "its words as before");
    const got = await shim.api(`/api/runs/images/${end.images[0].ref}`);
    assert.equal(got.status, 200);
    assert.equal(got.headers.get("content-type"), "image/png");
    assert.equal(got.headers.get("x-content-type-options"), "nosniff");
    assert.deepEqual(Buffer.from(await got.arrayBuffer()), shot);
    const gone = await shim.api(`/api/runs/images/${"0".repeat(32)}.png`);
    assert.deepEqual([gone.status, (await gone.json()).error], [404, "this picture is no longer kept"]);
    const sneaky = await shim.api("/api/runs/images/..%2F..%2Fconfig.json");
    assert.equal(sneaky.status, 404);
  });
});

describe("a coding agent's pictures", () => {
  /** A run over a recording sink, its store a recording one. @param {Record<string, any>} [o] */
  const make = (o = {}) => {
    /** @type {any[]} */
    const events = [];
    /** @type {any[]} */
    const kept = [];
    const run = createAgentRun({
      publish: (e) => events.push(e),
      sink: { breakBlock: () => 0 },
      keepImages: (pictures) => {
        kept.push(pictures);
        return { images: pictures.map((/** @type {any} */ _p, /** @type {number} */ i) => ({ ref: `${String(i).repeat(32)}.png`, type: "image/png", bytes: 2016 })), notKept: null };
      },
      ...o,
    });
    return { run, events, kept, ends: () => events.filter((e) => e.type === "tool-end") };
  };

  test("Claude Code's Read of an image (its adapter sends the picture as ACP image content) ends with the picture named", () => {
    const t = make();
    t.run.take({ type: "tool", id: "t1", toolName: "Read", title: "Read shot.png", kind: "read", status: "pending", rawInput: { file_path: "/work/shot.png" } });
    t.run.take({ type: "tool", id: "t1", status: "completed", content: [{ type: "content", content: { type: "image", data: b64(png()), mimeType: "image/png" } }] });
    assert.deepEqual(t.kept, [[{ data: b64(png()) }]]);
    assert.deepEqual(t.ends()[0].images, [{ ref: `${"0".repeat(32)}.png`, type: "image/png", bytes: 2016 }]);
  });

  test("an MCP tool's screenshot beside its words: the words its preview, the picture named; a later update's content replaces the pictures too", () => {
    const t = make();
    t.run.take({ type: "tool", id: "s1", toolName: "mcp__browser__screenshot", title: "screenshot", kind: "other", status: "in_progress", content: [{ type: "content", content: { type: "image", data: b64(png(10, 1)), mimeType: "image/png" } }] });
    t.run.take({ type: "tool", id: "s1", status: "completed", content: [{ type: "content", content: { type: "text", text: "Took a screenshot" } }, { type: "content", content: { type: "image", data: b64(png(10, 2)), mimeType: "image/png" } }] });
    assert.deepEqual(t.kept, [[{ data: b64(png(10, 2)) }]], "what the call ended with, kept once");
    assert.equal(t.ends()[0].preview, "Took a screenshot");
    assert.equal(t.ends()[0].images.length, 1);
  });

  test("a result of words keeps nothing; a run with no store names none; one not kept is said on its tool-end", () => {
    const words = make();
    words.run.take({ type: "tool", id: "w", toolName: "Bash", title: "ls", kind: "execute", status: "completed", content: [{ type: "content", content: { type: "text", text: "a.png" } }] });
    assert.deepEqual([words.kept, "images" in words.ends()[0]], [[], false]);
    const bare = make({ keepImages: undefined });
    bare.run.take({ type: "tool", id: "t1", toolName: "Read", title: "Read a.png", kind: "read", status: "completed", content: [{ type: "content", content: { type: "image", data: b64(png()), mimeType: "image/png" } }] });
    assert.equal("images" in bare.ends()[0], false);
    const refused = make({ keepImages: () => ({ images: [], notKept: { count: 1, why: "1 over 10 MB" } }) });
    refused.run.take({ type: "tool", id: "t1", toolName: "Read", title: "Read big.png", kind: "read", status: "completed", content: [{ type: "content", content: { type: "image", data: b64(png()), mimeType: "image/png" } }] });
    assert.deepEqual([refused.ends()[0].images, refused.ends()[0].imagesNotKept], [undefined, { count: 1, why: "1 over 10 MB" }]);
  });

  test("a file an agent looked at by a path in its folder (Codex's imageView) is read from its working folder", () => {
    const root = resolve("/work/proj");
    const t = make({ root });
    t.run.take({ type: "tool", id: "v1", toolName: "read", title: "Read shot.png", kind: "read", status: "pending", rawInput: { file_path: "shot.png" } });
    t.run.take({ type: "tool", id: "v1", status: "completed", content: [{ type: "image", path: "shot.png" }] });
    assert.deepEqual(t.kept, [[{ path: join(root, "shot.png") }]]);
  });
});

describe("a coding agent's pictures through Filament: the fake Claude agent sends them as its adapter does", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  const shot = png(500, 3);
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-pictures-agent-"));
    writeFileSync(join(root, "shot.png"), shot);
    writeFileSync(join(root, "junk.png"), Buffer.from("not a picture at all"));
    for (let i = 1; i <= IMAGES_PER_CALL + 1; i++) writeFileSync(join(root, `p${i}.png`), png(200, i));
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "claude", name: "claude", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CLAUDE: "1" }, cwdDefault: root, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "claude/*", upstream: "claude", upstreamModel: "{1}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** A turn in a fresh harness session, as the page sends one; the call's tool-end. @param {string} content */
  const callOf = async (content) => {
    const s = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "claude/haiku", preset: "plain" } });
    assert.equal(s.status, 200, await s.clone().text());
    const r = await shim.api(`/api/sessions/${encodeURIComponent(String((await s.json()).id))}/turns`, { method: "POST", body: { content, stream: true, runEvents: true } });
    assert.equal(r.status, 200);
    await r.text();
    const events = (await (await shim.api(`/api/runs/${encodeURIComponent(String(r.headers.get("x-filament-request-id")))}/events?since=0&limit=5000`)).json()).events;
    return events.find((/** @type {any} */ e) => e.type === "tool-end" && e.id === "p_1");
  };

  test("an image Read: its tool-end names the picture, and Filament serves the bytes the agent was handed", async () => {
    const end = await callOf("~picture shot.png");
    assert.deepEqual(end?.images?.map((/** @type {any} */ i) => [i.type, i.bytes]), [["image/png", shot.length]], JSON.stringify(end));
    assert.deepEqual(Buffer.from(await (await shim.api(`/api/runs/images/${end.images[0].ref}`)).arrayBuffer()), shot);
  });

  test("an MCP server's screenshots: 8 kept, the rest counted with their reasons, its words its preview", async () => {
    const names = Array.from({ length: IMAGES_PER_CALL + 1 }, (_, i) => `p${i + 1}.png`);
    const end = await callOf(`~pictures junk.png ${names.join(" ")}`);
    assert.equal(end?.images?.length, IMAGES_PER_CALL, JSON.stringify(end));
    assert.equal(new Set(end.images.map((/** @type {any} */ i) => i.ref)).size, IMAGES_PER_CALL, "each its own picture");
    assert.deepEqual(end.imagesNotKept, { count: 2, why: "1 not a PNG, JPEG, GIF or WebP; 1 past 8 a call" });
    assert.equal(end.preview, `Took ${names.length + 1} screenshots.`);
  });
});

describe("drawn on the call's card", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  const PIC = { ref: `${"a".repeat(32)}.png`, type: "image/png", label: "PNG", bytes: 2016 };
  /** A round of reads: the first shows a picture. @param {Record<string, any>} [more] */
  const round = (more = {}) =>
    alignEvents([
      { type: "run-start", kind: "agent-turn", at: 1 },
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "tool-start", round: 1, id: "r1", name: "read", card: { kind: "read", title: "Read", subject: "shot.png" } },
      { type: "tool-end", round: 1, id: "r1", name: "read", ok: true, ms: 3, chars: 30, preview: "[shot.png: a PNG image, 2 KB.]", images: [PIC], ...more },
      { type: "tool-start", round: 1, id: "r2", name: "read", card: { kind: "read", title: "Read", subject: "a.js" } },
      { type: "tool-end", round: 1, id: "r2", name: "read", ok: true, ms: 3, chars: 9, preview: "const a;" },
      { type: "tool-start", round: 1, id: "r3", name: "read", card: { kind: "read", title: "Read", subject: "b.js" } },
      { type: "tool-end", round: 1, id: "r3", name: "read", ok: true, ms: 3, chars: 9, preview: "const b;" },
    ]).byRound.get(1);

  test("the stub carries the pictures its tool-end named; a call with pictures never folds into a group", () => {
    const r = round();
    const stubs = r.order.map((/** @type {string} */ id) => r.tools.get(id));
    assert.deepEqual(stubs[0].images, [PIC]);
    assert.deepEqual(groupRuns(stubs), [{ start: 1, length: 2, family: "explore" }], "the two reads of words group; the picture stands alone");
  });

  test("its card opens on the picture, served by Filament, in place of the read's one line of words; a click opens it whole", () => {
    const card = /** @type {any} */ (roundRows(round())[0]);
    assert.equal(card.tagName, "DETAILS");
    assert.ok(card.attrs.has("open"), "open: the picture is the point");
    const img = card.querySelector("img.tool-shot");
    assert.ok(img, "a picture");
    assert.equal(img.attrs.get("src"), `/api/runs/images/${PIC.ref}`);
    assert.equal(img.attrs.get("alt"), "shot.png");
    assert.equal(card.querySelector("pre.term-out"), null, "not the line of words");
    assert.match(card.querySelector(".tool-secondary")?.textContent || "", /PNG image, 2 KB/);
    img.listeners.click?.[0]?.({ preventDefault() {}, stopPropagation() {} });
    const view = doc.document.body.querySelector(".picture-view");
    assert.ok(view, "the whole picture, over the page");
    assert.equal(view.querySelector("img")?.attrs.get("src"), `/api/runs/images/${PIC.ref}`);
  });

  test("the keyboard opens a picture as the mouse does, and Escape gives its place back to the thumbnail", () => {
    doc.document.body.replaceChildren();
    const card = /** @type {any} */ (roundRows(round())[0]);
    doc.document.body.append(card);
    const img = card.querySelector("img.tool-shot");
    assert.deepEqual([img.attrs.get("tabindex"), img.attrs.get("role"), img.attrs.get("aria-label")], ["0", "button", "Open shot.png whole"]);
    let focused = 0;
    img.focus = () => focused++;
    img.dispatch("keydown", { key: "Tab" });
    assert.equal(doc.document.body.querySelector(".picture-view"), null, "a key that is not Enter or Space opens nothing");
    img.dispatch("keydown", { key: "Enter" });
    const view = doc.document.body.querySelector(".picture-view");
    assert.ok(view, "Enter opens it");
    view.dispatch("keydown", { key: "Escape" });
    assert.deepEqual([doc.document.body.querySelector(".picture-view"), focused], [null, 1], "closed, the thumbnail has the keyboard again");
    img.dispatch("keydown", { key: " " });
    card.remove();
    doc.document.body.querySelector(".picture-view").dispatch("click");
    assert.equal(focused, 1, "a thumbnail gone from the page is not focused");
  });

  // (fails before: yes — the owner's report, 10-12: Read cards whose pictures were still on their way showed an empty pill,
  // the thumbnail's border round nothing, until the page's other reads let them through)
  test("a picture still on its way holds a screenshot's place; landed, it takes its own shape", () => {
    const img = /** @type {any} */ (roundRows(round())[0]).querySelector("img.tool-shot");
    assert.ok(img.classList.contains("loading"), "on its way");
    img.dispatch("load");
    assert.equal(img.classList.contains("loading"), false, "landed");
    const swept = /** @type {any} */ (roundRows(round())[0]).querySelector("img.tool-shot");
    swept.dispatch("error");
    assert.deepEqual([swept.classList.contains("loading"), swept.classList.contains("gone")], [false, true], "swept: no place held");
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.tool-shots:not\(\.many\) \.tool-shot\.loading \{ width: 330px; height: 220px; \}/, "one alone: a screenshot's shape at the card's height");
  });

  test("a picture not kept is said on its card", () => {
    const card = /** @type {any} */ (roundRows(round({ images: undefined, imagesNotKept: { count: 1, why: "1 over 10 MB" } }))[0]);
    assert.match(card.textContent, /1 picture was not kept: 1 over 10 MB/);
  });

  // The live drive's finding: Claude Code's read of an image hands the picture alone, and its card said "0 chars".
  test("a coding agent's read of an image says the picture's type and size, never 0 chars", () => {
    const agentRead = /** @type {any} */ (roundRows(round({ preview: undefined, chars: 0 }))[0]);
    const facts = agentRead.querySelector(".tool-secondary")?.textContent || "";
    assert.match(facts, /^PNG image, 2 KB/);
    assert.doesNotMatch(facts, /chars/);
    const two = /** @type {any} */ (roundRows(round({ preview: undefined, chars: 0, images: [PIC, { ...PIC, ref: `${"b".repeat(32)}.png` }] }))[0]);
    assert.match(two.querySelector(".tool-secondary")?.textContent || "", /^2 pictures/);
  });

  // The browser look's second finding: eight screenshots at their own shapes made a card taller than the screen.
  test("several pictures on one card are tiles of one size; one alone keeps its shape", () => {
    const one = /** @type {any} */ (roundRows(round())[0]);
    assert.ok(one.querySelector(".tool-shots") && !one.querySelector(".tool-shots.many"));
    const two = /** @type {any} */ (roundRows(round({ images: [PIC, { ...PIC, ref: `${"b".repeat(32)}.png` }] }))[0]);
    assert.equal(two.querySelectorAll(".tool-shots.many img.tool-shot").length, 2);
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.tool-shots\.many \.tool-shot \{ width: 160px; height: 100px; object-fit: contain;/, "each whole in its tile");
    assert.match(css, /\.work-shots \.tool-shot \{ width: 128px; height: 80px; object-fit: contain;/);
  });
});

// The browser look's finding: a settled turn folds its work, and the pictures went with it, unloaded behind a closed
// "Worked". (fails before: yes — nothing outside the fold showed them)
describe("under a turn's closed fold", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  /** @param {string} c */
  const ref = (c) => `${c.repeat(32)}.png`;

  test("a turn's pictures in the order its calls ran, a sub-agent's after the call that launched it, each named as its card names it", () => {
    const al = alignEvents([
      { type: "run-start", kind: "coding-agent", at: 1 },
      { type: "round-start", round: 1, blocksBefore: 0 },
      { type: "tool-start", round: 1, id: "r1", name: "Read", card: { kind: "read", title: "Read", subject: "shot.png" } },
      { type: "tool-end", round: 1, id: "r1", name: "Read", ok: true, ms: 3, images: [{ ref: ref("a"), type: "image/png", bytes: 9 }] },
      { type: "tool-start", round: 1, id: "a1", name: "agent", card: { kind: "subagent", title: "Agent", subject: "look around" } },
      { type: "subagent-start", round: 1, parent: "a1", description: "look around" },
      { type: "subagent-tool-start", round: 1, parent: "a1", id: "s1", name: "mcp__browser__take_screenshot", card: { kind: "other", title: "take_screenshot" } },
      { type: "subagent-tool-end", round: 1, parent: "a1", id: "s1", name: "mcp__browser__take_screenshot", ok: true, ms: 9, images: [{ ref: ref("b"), type: "image/png", bytes: 9 }] },
      { type: "round-start", round: 2, blocksBefore: 1 },
      { type: "tool-start", round: 2, id: "w1", name: "web_fetch", card: { kind: "web", title: "Fetch", subject: "https://example.test/chart" } },
      { type: "tool-end", round: 2, id: "w1", name: "web_fetch", ok: true, ms: 9, images: [{ ref: ref("c"), type: "image/png", bytes: 9 }] },
    ]);
    assert.deepEqual(turnPictures(al), [
      { ref: ref("a"), alt: "shot.png" },
      { ref: ref("b"), alt: "take_screenshot" },
      { ref: ref("c"), alt: "https://example.test/chart" },
    ]);
    assert.deepEqual(turnPictures(null), []);
  });

  // (fails before: yes — the owner's of 11-05: the strip showed the newest 5, one turn's 85 others behind a button that
  // opened its first fold, and the viewer opened one picture alone)
  test("the strip shows every picture, and the viewer steps through them all from the one opened; a picture swept leaves it", () => {
    const pics = "ijklmnop".split("").map((c) => ({ ref: ref(c), alt: `${c}.png` }));
    const strip = /** @type {any} */ (pictureStrip(pics));
    doc.document.body.append(strip);
    const imgs = strip.querySelectorAll("img.tool-shot");
    assert.deepEqual(imgs.map((/** @type {any} */ i) => i.attrs.get("alt")), pics.map((p) => p.alt), "every one, in order");
    assert.equal(strip.querySelector("button"), null, "no button to more of them: they are all here");
    assert.deepEqual([imgs[0].attrs.get("src"), imgs[0].attrs.get("tabindex"), imgs[0].attrs.get("role")], [`/api/runs/images/${ref("i")}`, "0", "button"]);
    imgs[6].dispatch("click");
    const view = doc.document.body.querySelector(".picture-view");
    const shown = () => [view.querySelector("img").attrs.get("src"), view.querySelector(".picture-view-count").textContent, view.querySelector(".picture-view-name").textContent];
    assert.deepEqual(shown(), [`/api/runs/images/${ref("o")}`, "7 / 8", "o.png"], "the one opened, where it stands");
    const [prev, next] = /** @type {any[]} */ (view.querySelectorAll("button.picture-view-step"));
    // Pressed to the end, the button goes disabled and lets the keyboard go: the viewer takes it back.
    let held = false;
    view.focus = () => void (held = true);
    /** @type {any} */ (doc.document).activeElement = next;
    next.dispatch("click");
    assert.deepEqual(shown(), [`/api/runs/images/${ref("p")}`, "8 / 8", "p.png"]);
    assert.equal(next.disabled, true, "the last: nothing after it");
    assert.equal(held, true, "the keys stay the viewer's");
    /** @type {any} */ (doc.document).activeElement = null;
    next.dispatch("click");
    assert.equal(shown()[1], "8 / 8");
    view.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
    view.dispatch("keydown", { key: "ArrowLeft", preventDefault() {} });
    assert.deepEqual(shown(), [`/api/runs/images/${ref("n")}`, "6 / 8", "n.png"], "the keys step too");
    assert.equal(prev.disabled, false);
    view.dispatch("keydown", { key: "Escape", preventDefault() {} });
    assert.equal(doc.document.body.querySelector(".picture-view"), null, "Esc closes it");
    const few = /** @type {any} */ (pictureStrip(pics.slice(0, 2)));
    for (const img of few.querySelectorAll("img.tool-shot")) img.dispatch("error");
    assert.deepEqual([few.querySelectorAll("img.tool-shot").length, few.classList.contains("hidden")], [0, true], "every picture swept: no strip");
    // Those two swept, the viewer steps past them as the strip does.
    const again = /** @type {any} */ (pictureStrip(pics));
    again.querySelectorAll("img.tool-shot")[2].dispatch("click");
    const past = doc.document.body.querySelector(".picture-view");
    assert.deepEqual([past.querySelector(".picture-view-count").textContent, /** @type {any} */ (past.querySelector("button.picture-view-step")).disabled], ["1 / 6", true], "k is the first one kept");
    past.dispatch("click");
    const one = /** @type {any} */ (pictureStrip(pics.slice(0, 1)));
    one.querySelector("img.tool-shot").dispatch("click");
    assert.equal(doc.document.body.querySelector(".picture-view .picture-view-step"), null, "one alone: no way through");
    doc.document.body.querySelector(".picture-view").dispatch("click");
  });

  test("the timeline puts the strip right under the folds, scrolled to the newest, and hides it once every fold is open", () => {
    const timeline = readFileSync(new URL("../src/ui/harness/conversation/timeline.js", import.meta.url), "utf8");
    assert.match(timeline, /paintShots\(turn, v\);\s+placeParts\(turn, v, parts, replies\);[^]{0,600}?showCopies\(v\);\s+\/\/ The memory note sits above the reply/, "every layout paints it, then places the folds after a compaction's line before it");
    assert.match(timeline, /const pics = v\.fold && turn\.aligned \? turnPictures\(turn\.aligned\) : \[\];/);
    assert.match(timeline, /v\.final\.parentNode\?\.insertBefore\(v\.shots, v\.final\)/, "between the folds and the reply");
    assert.match(timeline, /v\.final\.parentNode\?\.insertBefore\(v\.shots, v\.final\);\s+shotsToNewest\(v\.shots\);/);
    assert.match(timeline, /const watch = new ResizeObserver\(\(\) => \{\s+if \(strip\.isConnected && !strip\.scrollWidth\) return;\s+if \(strip\.isConnected\) strip\.scrollLeft = strip\.scrollWidth;\s+watch\.disconnect\(\);/, "the newest in view, once, the first time it shows: hidden under open folds or the Plan, as it shows");
    assert.match(timeline, /v\.group\?\.classList\.toggle\("folds-open", folds\.length > 0 && folds\.every\(\(f\) => f\.open\)\)/, "every fold open: its cards show them");
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.assistant-turn\.folds-open > \.work-shots, \.work-fold\.hidden \+ \.work-shots \{ display: none; \}/);
    assert.match(css, /\.work-shots \{ display: flex; flex-wrap: nowrap;[^}]*overflow-x: auto;/, "one row, scrolled sideways");
    assert.doesNotMatch(css, /\.work-fold\[open\] \+ \.work-shots/, "no longer by the fold right before it alone: a split turn's strip followed its last fold");
  });
});

// The owner's word, 10-12: "when i add an image in the chat it should show as well in the transcript". A picture typed
// with a message went to the model whole, and the archive keeps it whole, but its row showed only its file's name — and
// after a reload not even that. (fails before: yes — the row drew names only)
describe("the pictures you send (V4-D301)", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  const noop = { onCopy() {}, onEdit() {} };
  /** @param {string} data @param {string} [type] */
  const pic = (data, type = "image/png") => ({ type: "image", source: { type: "base64", media_type: type, data } });

  test("a message's picture shows above its words, the file it came from named on it; another file keeps its chip", () => {
    const row = /** @type {any} */ (userRow({
      userText: "look",
      attachments: [{ name: "shot.png", size: 9, kind: "image" }, { name: "notes.txt", size: 4, kind: "file" }],
      userContent: [pic("AAAA"), { type: "text", text: "\n\nFile: notes.txt\n```\nhi\n```" }, { type: "text", text: "look" }],
    }, noop));
    const imgs = row.querySelectorAll(".u-shots img.tool-shot");
    assert.equal(imgs.length, 1);
    assert.deepEqual([imgs[0].attrs.get("src"), imgs[0].attrs.get("alt")], ["data:image/png;base64,AAAA", "shot.png"]);
    assert.deepEqual(row.querySelectorAll(".u-atts .att").map((/** @type {any} */ a) => a.textContent), ["notes.txt"], "the picture is no chip as well");
    assert.equal(row.querySelector(".u-bubble")?.textContent, "look");
    imgs[0].dispatch("click");
    assert.equal(doc.document.body.querySelector(".picture-view")?.querySelector("img")?.attrs.get("src"), "data:image/png;base64,AAAA", "a click opens it whole");
    doc.document.body.querySelector(".picture-view").dispatch("click");
  });

  test("after a reload the archive's copy shows; pictures alone draw no empty words; several are tiles", () => {
    const row = /** @type {any} */ (userRow({ past: true, history: true, userText: "", userContent: [pic("BBBB", "image/jpeg"), pic("CCCC")] }, noop));
    const imgs = row.querySelectorAll(".u-shots .tool-shots.many img.tool-shot");
    assert.deepEqual(imgs.map((/** @type {any} */ i) => [i.attrs.get("src"), i.attrs.get("alt")]), [["data:image/jpeg;base64,BBBB", "A picture you sent"], ["data:image/png;base64,CCCC", "A picture you sent"]]);
    assert.equal(row.querySelector(".u-bubble"), null, "no bubble round no words");
    assert.doesNotMatch(row.textContent, /\(attachments\)/);
    const live = /** @type {any} */ (userRow({ userText: "(attachments)", attachments: [{ name: "a.png", size: 1, kind: "image" }], userContent: [pic("DDDD")] }, noop));
    assert.equal(live.querySelector(".u-bubble"), null, "the live turn's placeholder words neither");
  });

  test("only the four raster types, held whole, are drawn; anything else stays as it was", () => {
    const row = /** @type {any} */ (userRow({
      userText: "x",
      userContent: [pic("PHN2Zz48L3N2Zz4=", "image/svg+xml"), { type: "image", source: { type: "url", url: "https://example.test/a.png" } }, pic("", "image/png"), { type: "text", text: "x" }],
    }, noop));
    assert.equal(row.querySelector(".u-shots"), null);
    const files = /** @type {any} */ (userRow({ userText: "(attachments)", attachments: [{ name: "notes.txt", size: 4, kind: "file" }], userContent: [{ type: "text", text: "File: notes.txt" }] }, noop));
    assert.equal(files.querySelector(".u-bubble")?.textContent, "(attachments)", "a message of files alone says so, as before");
  });

  // (fails before: yes — the owner's word of 10-30, PDFs in the box: a PDF read back after a reload left no trace on its
  // row, a PDF alone an empty bubble, and Retry sent the message again without it)
  test("a PDF you sent is named on a chip from the message itself, live and after a reload, once; Retry sends it again", () => {
    const doc = { type: "document", title: "report.pdf", source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjc=" } };
    const chips = (/** @type {any} */ row) => row.querySelectorAll(".u-atts .att").map((/** @type {any} */ a) => a.textContent);
    const live = /** @type {any} */ (userRow({ userText: "read it", attachments: [{ name: "report.pdf", size: 8, kind: "pdf" }, { name: "notes.txt", size: 4, kind: "text" }], userContent: [doc, { type: "text", text: "File: notes.txt" }, { type: "text", text: "read it" }] }, noop));
    assert.deepEqual(chips(live), ["notes.txt", "report.pdf"]);
    const back = /** @type {any} */ (userRow({ past: true, history: true, userText: "", userContent: [doc] }, noop));
    assert.deepEqual(chips(back), ["report.pdf"]);
    assert.equal(back.querySelector(".u-bubble")?.textContent, "(attachments)", "a PDF alone says so, as files alone do");
    // A waiting send the page took back after a reload holds its attachments' names, not their content.
    assert.deepEqual(chips(/** @type {any} */ (userRow({ userText: "x", attachments: [{ name: "kept.pdf", size: 1, kind: "pdf" }], userContent: [{ type: "text", text: "x" }] }, noop))), ["kept.pdf"]);
    const again = againOf({ userText: "", userContent: [pic("AAAA"), doc, { type: "text", text: "" }], attachments: [] });
    assert.deepEqual(again.attachments.map((/** @type {any} */ a) => [a.kind, a.name, a.data]), [["image", "picture", "AAAA"], ["pdf", "report.pdf", "JVBERi0xLjc="]]);
  });

  // (fails before: yes — HarnessV4_Tasks V4-D303: a picture sent into a running turn showed its file's name only)
  test("a picture sent into a running turn shows on its bubble: from the run's log by its ref, the page's own bytes before that, a name where neither is", () => {
    const al = alignEvents(/** @type {any} */ ([
      { n: 1, type: "run-start" },
      { n: 2, type: "steer", id: "s1", kind: "note", text: "and this", at: 1, state: "queued", images: [{ name: "shot.png", mediaType: "image/png", bytes: 9, ref: `${"a".repeat(32)}.png` }, { name: "words.png", mediaType: "image/png", bytes: 5 }] },
    ]));
    const s = /** @type {any} */ (al.steers.get("s1"));
    assert.deepEqual([s.files, s.shots], [["shot.png", "words.png"], [{ ref: `${"a".repeat(32)}.png` }, null]], "every picture named, the kept one by its ref");
    const el = /** @type {any} */ (steerEl(s));
    const imgs = el.querySelectorAll(".u-shots img.tool-shot");
    assert.deepEqual(imgs.map((/** @type {any} */ i) => [i.attrs.get("src"), i.attrs.get("alt")]), [[`/api/runs/images/${"a".repeat(32)}.png`, "shot.png"]]);
    assert.deepEqual(el.querySelectorAll(".u-atts .att").map((/** @type {any} */ a) => a.textContent), ["words.png"], "the one not kept keeps its chip");
    assert.equal(el.querySelector(".steer-text")?.textContent, "and this");
    // The page's own echo, before the run's log names a ref: the bytes it sent; pictures alone need no "(pictures)".
    const echo = /** @type {any} */ (steerEl({ kind: "note", text: "", files: ["a.png"], shots: [{ src: "data:image/png;base64,AAAA" }] }));
    assert.deepEqual(echo.querySelectorAll(".u-shots img.tool-shot").map((/** @type {any} */ i) => i.attrs.get("src")), ["data:image/png;base64,AAAA"]);
    assert.equal(echo.querySelector(".steer-text"), null, "no empty words under a picture");
    // Refused by the model's provider: shown dimmed, the provider's words on its tip.
    const refused = /** @type {any} */ (steerEl({ ...s, refused: "images are not supported" }));
    assert.ok(refused.querySelector(".u-shots.refused img.tool-shot"), "dimmed, with the provider's words on its tip");
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /const files = images\.length \|\| team\.named\.length \? \{ files: \[\.\.\.team\.named, \.\.\.images\.map\(\(p\) => p\.name\)\], shots: \[\.\.\.team\.named\.map\(\(\) => null\), \.\.\.images\.map\(\(p\) => \(SENT_TYPES\.has\(p\.mediaType\) \? \{ src: `data:\$\{p\.mediaType\};base64,\$\{p\.data\}` \} : null\)\)\] \} : \{\};/, "the echo carries the page's bytes, the four raster types only");
  });

  test("the live turn keeps each attachment's kind; the viewer opens a picture held in the page in a new tab as a file", () => {
    const app = readFileSync(new URL("../src/ui/harness/app.js", import.meta.url), "utf8");
    assert.match(app, /attachments: attachments\.map\(\(a\) => \(\{ name: a\.name, size: a\.size, kind: a\.kind \}\)\),/);
    const view = readFileSync(new URL("../src/ui/harness/lib/picture-view.js", import.meta.url), "utf8");
    assert.match(view, /src\.startsWith\("data:"\)/, "a data: address opens as a file of its own: Chrome opens none in a new tab");
    const css = readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8");
    assert.match(css, /\.u-shots \{ display: flex; justify-content: flex-end;/);
  });
});

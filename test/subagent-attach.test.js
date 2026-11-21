// @ts-check
// What a main agent hands its sub-agent with a launch or a follow-up (`attach`, the owner's of 11-17: a picture the
// person sent reached no sub-agent, and a file reached one only as a path it read a page at a time). Each item a path or
// `picture N`, read once on the main agent's side as its own read is judged — the session's read rules, its folder's
// fence —, redacted, and refused whole in words before anything is sent; some places are kept whoever asks (Filament's
// data folder, a .git folder, a secret's file, a credentials folder, a private key). attach.js alone here.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { ATTACH_LIMITS, attachments, fileBlocks, openingPictures, readJudge } from "../src/app/agent/attach.js";
import { redactorOf } from "../src/core/redact.js";
import { heldWords } from "../src/app/agent/held-launch.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { AGENT_TOOL, agentToolFor, coderAgentToolFor, toolSetFor } from "../src/app/agent/tools.js";
import { PROMPT_VERSION, TOOL_TEXT } from "../src/app/agent/prompt.js";
import { watched } from "./helpers/team.js";
import { until } from "./helpers/wait.js";

/** @type {string[]} */
const made = [];
after(() => {
  for (const d of made) rmSync(d, { recursive: true, force: true });
});
/** A folder of its own, with these files in it. @param {Record<string, string | Buffer>} [files] */
const folder = (files = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "filament-attach-"));
  made.push(dir);
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(resolve(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  return dir;
};
/** A PNG's first bytes, and a few more. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
/**
 * Where the main agent reads, as the loop's door hands it.
 * @param {string} root
 * @param {{ rules?: any[], fenced?: boolean, reads?: string[], theirs?: boolean, redact?: ((t: string) => string) | null, pictures?: { mediaType: string, data: string }[], dataDir?: string | null }} [o]
 * @returns {import("../src/app/agent/attach.js").AttachFrom}
 */
const from = (root, o = {}) => ({
  judge: readJudge({ root, rules: o.rules || [], fenced: o.fenced ?? true, reads: o.reads || [], theirs: o.theirs || false }),
  redact: o.redact ?? null,
  pictures: () => o.pictures || [],
  folders: [root, ...(o.reads || [])],
  dataDir: o.dataDir ?? null,
});
/** What a call refuses, in its words. @param {unknown} items @param {import("../src/app/agent/attach.js").AttachFrom} f */
const refusal = async (items, f) => {
  try {
    await attachments(items, f);
  } catch (/** @type {any} */ e) {
    return String(e.message);
  }
  return "";
};
const OWN = "name its path in your prompt if it should read it with its own tools";

// (fails before: yes — the agent tool took no attach: a sub-agent read a file a page at a time by its path)
test("a text file and a picture by path: the text redacted, the picture by its bytes, the answer's line naming each", async () => {
  const root = folder({ "notes.md": "hello TOKEN123", "shot.png": PNG });
  const got = await attachments(["notes.md", "shot.png"], from(root, { redact: redactorOf(["TOKEN\\d+"]) }));
  assert.deepEqual(got, {
    images: [{ name: "shot.png", mediaType: "image/png", data: PNG.toString("base64") }],
    files: [{ name: "notes.md", text: "hello [redacted]" }],
    said: "Attached: notes.md (16 bytes text), shot.png (12 bytes picture).",
  });
  assert.deepEqual(fileBlocks(/** @type {any} */ (got).files), [{ type: "text", text: "File: notes.md\n```\nhello [redacted]\n```" }]);
});

test("nothing named is nothing attached; what is no list, or an empty item, is refused", async () => {
  const f = from(folder());
  for (const none of [undefined, null, []]) assert.equal(await attachments(none, f), null);
  assert.equal(await refusal("notes.md", f), "attach is a list: each item a path or picture N");
  assert.equal(await refusal(["  "], f), "attach: an empty item — each is a path or picture N");
});

test("the session's read rules: a deny refuses in the rule's words, and an ask or a review too — an attachment asks nobody", async () => {
  const root = folder({ "private/a.txt": "p", "drafts/b.txt": "d", "review/c.txt": "r", "open.txt": "o" });
  const rules = [
    { tool: "read", pattern: "private/*", verdict: "deny" },
    { tool: "read", pattern: "drafts/*", verdict: "ask" },
    { tool: "read", pattern: "review/*", verdict: "review" },
  ];
  const f = from(root, { rules });
  assert.equal(await refusal(["open.txt", "private/a.txt"], f), "attach: private/a.txt: this session's rules refuse reading it (rule read(private/*) deny)");
  assert.equal(await refusal(["drafts/b.txt"], f), "attach: drafts/b.txt: this session's rules ask before it is read (rule read(drafts/*) ask), and an attachment asks nobody");
  assert.equal(await refusal(["review/c.txt"], f), "attach: review/c.txt: this session's rules ask before it is read (rule read(review/*) review), and an attachment asks nobody");
  // Its whole path is judged too, in either separator: a rule written for it refuses it however the call names it.
  const whole = join(root, "open.txt");
  for (const pattern of [whole, whole.split("\\").join("/")])
    assert.match(await refusal(["open.txt"], from(root, { rules: [{ tool: "read", pattern, verdict: "deny" }] })), /^attach: open\.txt: this session's rules refuse reading it/, pattern);
  // (fails before: yes — Fable 5.2's review of 11-17: a rule written from the folder missed the file named whole, or
  // from the folder in another spelling) A rule written from the folder refuses it however the call names it.
  for (const [dir, words] of [["private", "refuse reading it"], ["drafts", "ask before it is read"]]) {
    const at = join(root, dir, dir === "private" ? "a.txt" : "b.txt");
    const named = [at, at.split("\\").join("/"), `./${dir}/${basename(at)}`, ...(process.platform === "win32" ? [`${dir}\\${basename(at)}`, `.\\${dir}\\${basename(at)}`] : [])];
    for (const name of named) assert.ok((await refusal([name], f)).startsWith(`attach: ${name}: this session's rules ${words}`), name);
  }
  // One written from the folder with Windows' separator, the file named whole; and a folder a coding agent's chat
  // spells with forward slashes, whose files are spelled from it all the same.
  if (process.platform === "win32") {
    const back = from(root, { rules: [{ tool: "read", pattern: "private\\*", verdict: "deny" }] });
    const at = join(root, "private", "a.txt").split("\\").join("/");
    assert.ok((await refusal([at], back)).startsWith(`attach: ${at}: this session's rules refuse reading it`));
    const named = join(root, "private", "a.txt");
    assert.ok((await refusal([named], from(root.split("\\").join("/"), { rules }))).startsWith(`attach: ${named}: this session's rules refuse reading it`));
  }
  assert.equal((await attachments(["open.txt"], f))?.files[0].text, "o");
});

test("its folder's fence: outside it is refused while the mode fences reads, read in Auto, and an added folder reads as its own", async () => {
  const root = folder({ "in.txt": "i" });
  const other = folder({ "out.txt": "o" });
  const out = join(other, "out.txt");
  assert.equal(await refusal([out], from(root)), `attach: ${out}: "${out}" resolves outside the allowed task folder`);
  assert.equal((await attachments([out], from(root, { fenced: false })))?.files[0].text, "o", "Auto reads where its read tool reads");
  assert.equal((await attachments([out], from(root, { reads: [other] })))?.files[0].text, "o");
});

test("kept whoever asks, in Auto too: Filament's data folder, a .git folder, a secret's file, a credentials folder outside the folder, a private key — a project's .claude/settings.json attaches", async () => {
  const data = folder({ "config.json": "{}" });
  const root = folder({ ".git/config": "[remote]", ".env": "A=1", ".claude/settings.json": '{"x":1}', "notes/key.txt": "-----BEGIN OPENSSH PRIVATE KEY-----\nabc", "deep/.GIT/HEAD": "ref" });
  const home = folder({ ".aws/credentials": "[default]", "plain.txt": "p" });
  const f = from(root, { fenced: false, dataDir: data });
  const cases = [
    [join(data, "config.json"), "in Filament's data folder"],
    [".git/config", "in a repository's own .git folder"],
    ["deep/.GIT/HEAD", "in a repository's own .git folder"],
    [".env", "a secret's file by its name"],
    [join(home, ".aws", "credentials"), "in a credentials folder (.aws)"],
  ];
  for (const [item, why] of cases) assert.equal(await refusal([item], f), `attach: ${item}: ${why}, which is kept from attachments: ${OWN}`);
  assert.equal(await refusal(["notes/key.txt"], f), `attach: notes/key.txt: a private key, which is kept from attachments: ${OWN}`);
  assert.equal((await attachments([".claude/settings.json"], f))?.files[0].text, '{"x":1}');
  assert.equal((await attachments([join(home, "plain.txt")], f))?.files[0].text, "p");
});

test("in another machine's agents' chat, the fence keeps a .git and a credentials folder inside the folder in its own words", async () => {
  const root = folder({ ".git/config": "[remote]", ".aws/config": "[x]" });
  const f = from(root, { theirs: true });
  assert.equal(await refusal([".git/config"], f), `attach: .git/config: another machine's agents never read a repository's own .git folder; ".git/config" is in one`);
  assert.equal(await refusal([".aws/config"], f), `attach: .aws/config: another machine's agents never read a credentials folder; ".aws/config" is in .aws`);
});

test("by its bytes: an SVG is text; a PDF, a binary file and a Git LFS pointer are refused in words", async () => {
  const root = folder({
    "logo.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
    "doc.pdf": "%PDF-1.7\n...",
    "app.bin": Buffer.from([1, 2, 0, 3]),
    "big.psd": "version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 12\n",
  });
  const f = from(root);
  assert.equal((await attachments(["logo.svg"], f))?.files[0].text, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.equal(await refusal(["doc.pdf"], f), `attach: doc.pdf: a PDF, which is not attached: ${OWN}`);
  assert.equal(await refusal(["app.bin"], f), `attach: app.bin: a binary file, which is not attached: ${OWN}`);
  assert.equal(await refusal(["big.psd"], f), `attach: big.psd: a Git LFS pointer, not its file: ${OWN}`);
});

test("a file past a picture's bytes is judged by its head: a picture says its size, a PDF says PDF, else the text's cap", async () => {
  const big = 4 * 1048576;
  const root = folder({ "huge.png": Buffer.concat([PNG, Buffer.alloc(big - PNG.length, 1)]), "huge.pdf": Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(big, 0x20)]), "huge.log": Buffer.alloc(big, 0x61) });
  const f = from(root);
  assert.equal(await refusal(["huge.png"], f), "attach: huge.png: a PNG image of 4.0 MB, past the 3.75 MB a picture may have: attach a smaller copy (scaled down, or as JPEG)");
  assert.equal(await refusal(["huge.pdf"], f), `attach: huge.pdf: a PDF, which is not attached: ${OWN}`);
  assert.equal(await refusal(["huge.log"], f), `attach: huge.log: 4.0 MB, past the 200,000 characters of text a call attaches: ${OWN}`);
});

test("the caps, refused and never cut: 8 items, the text counted after redaction, each picture and the pictures together", async () => {
  assert.deepEqual({ ...ATTACH_LIMITS }, { items: 8, pictureBytes: 3_932_160, picturesBase64: 20 * 1024 * 1024, textChars: 200_000 });
  const root = folder({ "a.txt": "a", "long.txt": "x".repeat(200_001), "masked.txt": "x".repeat(150_000) + "S".repeat(60_000) });
  assert.equal(await refusal(Array(9).fill("a.txt"), from(root)), "attach: 9 items, past the 8 one call hands on");
  assert.equal(await refusal(["long.txt"], from(root)), "attach: the text comes to 200,001 characters, past the 200,000 one call hands on: attach fewer files, or name their paths in your prompt for it to read with its own tools");
  // 210,000 characters as they stand, 150,010 once redacted: what goes is what counts.
  assert.equal((await attachments(["masked.txt"], from(root, { redact: redactorOf(["S+"]) })))?.files[0].text.length, 150_010);
  assert.match(await refusal(["masked.txt"], from(root)), /^attach: the text comes to 210,000 characters/);
  const one = { mediaType: "image/png", data: "A".repeat(5_300_000) };
  assert.equal(await refusal(["picture 1"], from(root, { pictures: [one] })), "attach: picture 1: a picture of 3.8 MB, past the 3.75 MB a picture may have");
  const fits = { mediaType: "image/png", data: "A".repeat(4_900_000) };
  const five = Array(5).fill(fits);
  assert.equal(await refusal(["picture 1", "picture 2", "picture 3", "picture 4", "picture 5"], from(root, { pictures: five })), "attach: the pictures come to 23.4 MB as sent, past the 20 MB one call hands on: attach fewer, or smaller copies");
  assert.equal((await attachments(["picture 1", "picture 2", "picture 3", "picture 4"], from(root, { pictures: five })))?.images.length, 4);
});

test("picture N: the person's pictures this turn, in order; past the count, refused naming how many there are", async () => {
  const root = folder();
  const pictures = [{ mediaType: "image/png", data: "AAAA" }, { mediaType: "image/jpeg", data: "BBBB" }];
  assert.deepEqual(await attachments(["picture 2", "Picture 1"], from(root, { pictures })), {
    images: [{ name: "picture 2", mediaType: "image/jpeg", data: "BBBB" }, { name: "picture 1", mediaType: "image/png", data: "AAAA" }],
    files: [],
    said: "Attached: picture 2 (3 bytes picture), picture 1 (3 bytes picture).",
  });
  assert.equal(await refusal(["picture 3"], from(root, { pictures })), "attach: picture 3: this turn has 2 pictures from the person: picture 1 to picture 2");
  assert.equal(await refusal(["picture 0"], from(root, { pictures: [pictures[0]] })), "attach: picture 0: this turn has 1 picture from the person: picture 1");
  assert.equal(await refusal(["picture 1"], from(root)), "attach: picture 1: the person sent no picture this turn");
});

// (fails before: yes — Fable 5.2's review of 11-17: a turn taken up from the archive numbered pictures it could not
// tell apart) A turn that numbers none: a path still attaches; picture N is refused in words, and a call with both too.
test("a turn that numbers none of the person's pictures: a path still attaches, picture N is refused in words, and a call naming both is refused whole", async () => {
  const root = folder({ "a.txt": "a" });
  const none = { ...from(root), pictures: () => null };
  assert.equal((await attachments(["a.txt"], none))?.files[0].text, "a");
  const why = "this turn numbers none of the person's pictures: it was taken up again from what Filament kept (Filament restarted, or let its question go, while it waited), so which picture is which is not known; a picture that is a file attaches by its path";
  assert.equal(await refusal(["picture 1"], none), `attach: picture 1: ${why}`);
  assert.equal(await refusal(["a.txt", "picture 1"], none), `attach: picture 1: ${why}`);
});

test("a folder, and a file that is not there, are refused", async () => {
  const root = folder({ "src/a.js": "a" });
  assert.equal(await refusal(["src"], from(root)), "attach: src: a folder: attach the files in it");
  assert.equal(await refusal(["nope.txt"], from(root)), `attach: nope.txt: no such file (${join(root, "nope.txt")})`);
});

test("the pictures of a request's newest user message: its own blocks, an Anthropic image or an OpenAI data: address, never a tool result's", () => {
  const body = {
    messages: [
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/gif", data: "OLD" } }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "P1" } },
          { type: "tool_result", tool_use_id: "t", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "TOOL" } }] },
          { type: "image_url", image_url: { url: "data:image/jpeg;base64,J2" } },
          { type: "image_url", image_url: { url: "https://example.com/x.png" } },
          { type: "image", source: { type: "url", url: "https://example.com/y.png" } },
        ],
      },
    ],
  };
  assert.deepEqual(openingPictures(body), [{ mediaType: "image/png", data: "P1" }, { mediaType: "image/jpeg", data: "J2" }]);
  assert.deepEqual(openingPictures({ messages: [{ role: "user", content: "words" }] }), []);
  assert.deepEqual(openingPictures(null), []);
});

// (fails before: yes — neither agent tool took attach)
test("both agent tools take attach after changes, one field in the same words, on every copy; version 127", () => {
  assert.equal(PROMPT_VERSION, 129);
  const field = /** @type {any} */ (AGENT_TOOL.input_schema.properties).attach;
  assert.deepEqual(field, { type: "array", items: { type: "string" }, description: TOOL_TEXT.agentAttach });
  assert.equal(
    TOOL_TEXT.agentAttach,
    "Files and pictures to hand it with a launch or a follow-up, so it need not read them itself: each a path, read now as your own read of it would be (your folder, your read rules), or picture N, the Nth picture the person sent this turn (their message's first, then those sent while you worked). Text follows your prompt under its name; a picture goes as a picture. At most 8 items, 200,000 characters of text and 3.75 MB a picture. A PDF, a binary file, a secret's file, a .git folder and Filament's data folder are refused, and the whole call with them, nothing sent.",
  );
  for (const tool of [AGENT_TOOL, agentToolFor([], [], true), coderAgentToolFor({ asks: [] }), coderAgentToolFor({ asks: [], held: true, machines: true })]) {
    const props = /** @type {any} */ (tool).input_schema.properties;
    assert.equal(props.attach, field, "one field, shared");
    const keys = Object.keys(props);
    assert.equal(keys[keys.indexOf("changes") + 1], "attach");
  }
  assert.ok(/** @type {any} */ (coderAgentToolFor({ asks: [], machines: true })).description.length < 2048, "a coding agent's description, which the field leaves as it was, stays whole");
});

// (fails before: yes — the loop told nobody of the pictures its steers carried)
test("the loop tells the turn the pictures the developer's messages carry as it hears them, in order — a watcher's, a lead's and the main agent's never", async () => {
  /** @type {{ mediaType: string, data: string }[][]} */
  const told = [];
  /** @type {any[]} */
  let pending = [];
  const pic = (/** @type {string} */ data) => ({ name: `${data}.png`, mediaType: "image/png", data });
  let n = 0;
  const reply = (/** @type {any[]} */ content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });
  const out = await runAgentTurn(/** @type {any} */ ({
    model: "m",
    messages: [{ role: "user", content: "go" }],
    system: "s",
    tools: toolSetFor({ delegateRead: false }),
    modeNow: () => "auto",
    root: tmpdir(),
    readerModel: "",
    maxTokens: 100,
    call: async () => {
      if (++n === 1) {
        pending = [
          { id: "m1", kind: "note", text: "this one", from: "harness", images: [pic("D1"), pic("D2")] },
          { id: "m2", kind: "note", text: "drift", from: "watcher", title: "Supervisor", images: [pic("W1")] },
          { id: "m3", kind: "note", text: "from the lead", from: "lead", images: [pic("L1")] },
          { id: "m4", kind: "note", text: "and that", from: "harness", images: [pic("D3")] },
          { id: "m5", kind: "note", text: "words alone", from: "harness" },
        ];
        return reply([{ type: "tool_use", id: "r1", name: "read", input: { path: "x.txt" } }]);
      }
      return reply([{ type: "text", text: "Done." }]);
    },
    costOf: () => 0,
    runHand: async (/** @type {string} */ name) => `${name} ran`,
    delegateRead: null,
    mailbox: {
      read: (/** @type {((m: any) => boolean) | undefined} */ pick) => {
        const took = pick ? pending.filter(pick) : pending;
        pending = pick ? pending.filter((m) => !pick(m)) : [];
        return took;
      },
    },
    steerPictures: (/** @type {any} */ p) => void told.push(p),
    permissions: null,
    tree: null,
    onEvent: () => {},
    previewChars: 0,
    sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
    signal: null,
    resume: null,
  }));
  assert.equal(out.status, "done", JSON.stringify(out).slice(0, 800));
  assert.deepEqual(told.map((l) => l.map((p) => p.data)), [["D1", "D2", "D3"]]);
});

// The registry: what a launch, a follow-up and a held launch send, and what each refuses, against a scripted host.

/**
 * The main agent's turn on a scripted registry, its door handing `attach` where the main agent reads (`o`); `none`, a
 * door that takes no attach. Its calls' events are kept.
 * @param {ReturnType<typeof watched>} w @param {Parameters<typeof from>[1] & { none?: boolean }} [o]
 */
const turnOn = (w, o = {}) => {
  /** @type {any[]} */
  const events = [];
  const door = w.registry.openTurn({ chainId: "c1", runId: "turn-1", cwd: w.dir, mode: "edit", model: "m-main", thinking: null, fork: null, emit: (e) => events.push(e), ...(o.none ? {} : { attach: () => from(w.dir, o) }) });
  let n = 0;
  /** @param {any} input */
  const call = (input) => door.subagents.run({ id: `tu-${++n}`, input: { description: "Fix the parser", run_in_background: true, ...input }, emit: (e) => events.push(e), signal: /** @type {any} */ (null) });
  return { door, call, events };
};
/** The blocks of a request's last message. @param {any} body */
const lastBlocks = (body) => body.messages.at(-1).content;

// (fails before: yes — a picture the person sent reached no sub-agent, and a file reached one only by its path)
test("a launch with attach: its message carries the brief, then each file as a block under its name, then the pictures; the answer says what went; the exchange and the start event keep their names alone", async () => {
  const w = watched();
  writeFileSync(join(w.dir, "notes.md"), "the parser trips on an empty file");
  const t = turnOn(w, { pictures: [{ mediaType: "image/png", data: "AAAA" }] });
  const out = await t.call({ prompt: "fix parse()", attach: ["notes.md", "picture 1"] });
  assert.equal(out.ok, true, out.text);
  assert.ok(out.text.endsWith("\n\nAttached: notes.md (33 bytes text), picture 1 (3 bytes picture)."), out.text);
  const r = await w.run(1);
  assert.deepEqual(lastBlocks(r.body).slice(-3), [
    { type: "text", text: "fix parse()" },
    { type: "text", text: "File: notes.md\n```\nthe parser trips on an empty file\n```" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  ]);
  const ex = /** @type {any} */ (w.registry.get(r.id)).exchanges[0];
  assert.deepEqual([ex.prompt, ex.files, ex.pictures], ["fix parse()", ["notes.md"], ["picture 1"]], "names alone, never the text");
  const start = t.events.find((e) => e.type === "subagent-start");
  assert.deepEqual(start.attached, { files: ["notes.md"], pictures: ["picture 1"] });
  assert.equal(start.prompt, "fix parse()");
  const listed = /** @type {any} */ (w.registry.list("c1")).find((/** @type {any} */ s) => s.id === r.id);
  assert.deepEqual([listed.exchanges[0].files, listed.exchanges[0].pictures], [["notes.md"], ["picture 1"]]);
  r.attach();
  r.finish({ status: "done", report: "Fixed." });
  await w.registry.settled(r.id);
});

test("with nothing attached, a launch sends what it sent before, byte for byte, and its start event names nothing", async () => {
  /** @type {string[]} */
  const bodies = [];
  for (const more of [{}, { attach: [] }, { attach: null }]) {
    const w = watched();
    const t = turnOn(w);
    await t.call({ prompt: "fix parse()", ...more });
    const r = await w.run(1);
    bodies.push(JSON.stringify(r.body).split(JSON.stringify(w.dir).slice(1, -1)).join("<dir>").replace(/sa_[0-9a-f]{8}/g, "sa_x"));
    assert.equal(t.events.find((e) => e.type === "subagent-start").attached, undefined);
    assert.equal(/** @type {any} */ (w.registry.get(r.id)).exchanges[0].files, undefined);
  }
  assert.equal(bodies[1], bodies[0]);
  assert.equal(bodies[2], bodies[0]);
});

test("a follow-up to an idle sub-agent carries what it attaches after its words", async () => {
  const w = watched();
  writeFileSync(join(w.dir, "log.txt"), "TypeError at line 3");
  const t = turnOn(w);
  await t.call({ prompt: "fix parse()" });
  const first = await w.run(1);
  first.attach();
  first.finish({ status: "done", report: "Fixed." });
  await w.registry.settled(first.id);
  const out = await t.call({ agent_id: first.id, prompt: "it still fails: see the log", attach: ["log.txt"] });
  assert.equal(out.ok, true, out.text);
  assert.ok(out.text.endsWith("\n\nAttached: log.txt (19 bytes text)."), out.text);
  const next = await w.run(2);
  assert.deepEqual(lastBlocks(next.body).slice(-1), [{ type: "text", text: "File: log.txt\n```\nTypeError at line 3\n```" }]);
  assert.match(JSON.stringify(lastBlocks(next.body).at(-2)), /it still fails: see the log/);
  assert.deepEqual(/** @type {any} */ (w.registry.get(first.id)).exchanges[1].files, ["log.txt"]);
});

test("refused whole, in words, before anything starts: an item that cannot go, a running sub-agent's follow-up, a stop, an apply, a list, and a turn that takes none", async () => {
  const w = watched();
  writeFileSync(join(w.dir, "ok.txt"), "ok");
  const t = turnOn(w);
  await assert.rejects(t.call({ prompt: "fix it", attach: ["ok.txt", "nope.txt"] }), { message: `attach: nope.txt: no such file (${join(w.dir, "nope.txt")})` });
  assert.deepEqual(w.registry.list("c1"), [], "nothing launched");
  await t.call({ prompt: "fix parse()" });
  const r = await w.run(1);
  r.attach();
  await until(() => w.registry.get(r.id)?.runId === r.runId, "its run to attach");
  await assert.rejects(t.call({ agent_id: r.id, prompt: "and this", attach: ["ok.txt"] }), { message: `sub-agent ${r.id} is still working, so your follow-up goes as a message read at its next step: leave attach out, or send it once it reported` });
  assert.deepEqual(w.steers, [], "no message sent");
  await assert.rejects(t.call({ agent_id: r.id, stop: true, attach: ["ok.txt"] }), { message: "attach goes with a launch or a follow-up: leave it out of a call with stop" });
  await assert.rejects(t.call({ agent_id: r.id, apply_changes: true, attach: ["ok.txt"] }), { message: "attach goes with a launch or a follow-up: leave it out of a call with apply_changes" });
  await assert.rejects(t.call({ list_models: true, attach: ["ok.txt"] }), { message: "attach goes with a launch or a follow-up: leave it out of a call with list_models" });
  const bare = turnOn(w, { none: true });
  await assert.rejects(bare.call({ prompt: "fix it", attach: ["ok.txt"] }), { message: "attach is not taken in this turn: name the files' paths in your prompt for it to read with its own tools" });
  r.finish({ status: "done", report: "Fixed." });
  await w.registry.settled(r.id);
});

test("an empty attach is nothing attached: a turn that takes none launches, a running one's follow-up goes as a message, a stop stops", async () => {
  const w = watched();
  const bare = turnOn(w, { none: true });
  const out = await bare.call({ prompt: "fix parse()", attach: [] });
  assert.equal(out.ok, true, out.text);
  assert.ok(!out.text.includes("Attached:"), out.text);
  const r = await w.run(1);
  r.attach();
  await until(() => w.registry.get(r.id)?.runId === r.runId, "its run to attach");
  const sent = await bare.call({ agent_id: r.id, prompt: "and this", attach: [] });
  assert.equal(sent.ok, true, sent.text);
  assert.deepEqual(w.steers.map((s) => s.text), ["and this"]);
  const stopped = await bare.call({ agent_id: r.id, stop: true, attach: [] });
  assert.equal(stopped.ok, true, stopped.text);
  r.finish({ status: "stopped", report: "Stopped.", stoppedBy: "agent" });
  await w.registry.settled(r.id);
});

test("the registry's data folder is kept from attachments whatever the turn hands, Auto included", async () => {
  const data = folder({ "config.json": '{"sealed":true}' });
  const w = watched({ dataDir: data });
  const t = turnOn(w, { fenced: false });
  const file = join(data, "config.json");
  await assert.rejects(t.call({ prompt: "read it", attach: [file] }), { message: `attach: ${file}: in Filament's data folder, which is kept from attachments: ${OWN}` });
});

test("a held launch carries what was read at the call: the card names it, the answer says it, and its Accept sends it as it stood", async () => {
  const w = watched({ extra: { holdsWriters: () => true, newestTurn: () => 4 } });
  writeFileSync(join(w.dir, "notes.md"), "as read at the call");
  const t = turnOn(w, { pictures: [{ mediaType: "image/png", data: "AAAA" }] });
  const out = await t.call({ prompt: "fix parse()", attach: ["notes.md", "picture 1"] });
  assert.equal(out.text, `${heldWords("")}\n\nAttached: notes.md (19 bytes text), picture 1 (3 bytes picture).`);
  const [h] = /** @type {any} */ (w.registry.held("c1"));
  assert.deepEqual(h.launches[0].attached, { files: ["notes.md"], pictures: ["picture 1"] });
  writeFileSync(join(w.dir, "notes.md"), "changed since");
  const answered = w.registry.answerHeld("c1", h.id, "accept");
  const r = await w.run(1);
  assert.deepEqual(lastBlocks(r.body).slice(-2), [
    { type: "text", text: "File: notes.md\n```\nas read at the call\n```" },
    { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
  ]);
  r.attach();
  r.finish({ status: "done", report: "Fixed." });
  assert.equal((await answered).ok, true);
});

// What the brief and the reports come to here, well under the budget: only what is attached passes it.
for (const big of [true, false])
  test(`what was attached counts in the ended conversations' budget: ${big ? "past it, the one idle the longest lets its conversation go, its next message starting fresh" : "under it, both keep theirs"}`, async () => {
    const w = watched({ keptChars: 6_000 });
    writeFileSync(join(w.dir, "big.txt"), "y".repeat(big ? 8_000 : 10));
    const t = turnOn(w);
    await t.call({ prompt: "read it", attach: ["big.txt"] });
    const a = await w.run(1);
    a.attach();
    a.finish({ status: "done", report: "Read." });
    await w.registry.settled(a.id);
    await t.call({ prompt: "and you" });
    const b = await w.run(2);
    b.attach();
    b.finish({ status: "done", report: "Done." });
    await w.registry.settled(b.id);
    await t.call({ agent_id: a.id, prompt: "again" });
    const again = await w.run(3);
    assert.equal(/** @type {any} */ (w.registry.get(a.id)).exchanges[1].fresh, big ? "let-go" : undefined);
    assert.equal(JSON.stringify(again.body).includes("y".repeat(big ? 8_000 : 10)), !big, "the file goes again only with the conversation it was in");
    // A fresh start reads the thread as it was said: the message names what went with it, to read again itself.
    assert.equal(JSON.stringify(again.body).includes("read it\\n\\n(Attached to it, kept no more: big.txt.)"), big);
  });

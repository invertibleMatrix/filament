// @ts-check
// Rewind in place (the owner's word of 10-27: "it rewinds in place"; the Designer's design; app/sessions/rewind.js): a
// harness chat goes back to before one of the person's messages — files and conversation, the conversation alone, or
// the files alone — each file the chat's agents changed from that turn on back to how it was before, the turns kept as
// a rewound line, and Undo puts both back until the next message. Against a throwaway repository under the temp folder.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { planFiles, putBack, putForward, rewindNote } from "../src/app/sessions/rewind.js";
import { snapshotTree } from "../src/adapters/git/snapshot.js";
import { FAKE_ACP_AGENT, startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { afterHead } from "./helpers/agent-head.js";
import { EARLIER_WORDS } from "../src/adapters/agents/compactions.js";
import { removeDirs } from "./helpers/wait.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** @param {string} cwd @param {string[]} args */
const run = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", env: GIT_ENV, windowsHide: true }).trim();
const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** What the model was sent, as one string. @param {any} call */
const said = (call) => JSON.stringify(call.body?.messages || []);

describe("rewind in place, against a real Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let root;
  /** The model's requests with tools, in order. @type {any[]} */
  const calls = [];
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-rewind-"));
    run(root, ["init", "-q", "-b", "main"]);
    // The repository's own line endings, whatever the machine's git says: a file comes back with the ones it had.
    run(root, ["config", "core.autocrlf", "false"]);
    writeFileSync(join(root, "a.txt"), "one\n");
    writeFileSync(join(root, "c.txt"), "keep\n");
    run(root, ["add", "."]);
    run(root, ["commit", "-q", "-m", "init"]);
    up = await fakeUpstream(async (call) => {
      if (call.kind !== "anthropic") return undefined;
      if (!call.body?.tools?.length) return anthropicReply("A rewind chat", { model: "brain-model" });
      calls.push(call);
      const all = said(call);
      const answered = (/** @type {string} */ id) => all.includes(`"tool_use_id":"${id}"`);
      const last = JSON.stringify(call.body.messages.at(-1));
      // A file is read before it is written over, as the loop asks.
      if (last.includes("turn one")) return reply([toolUse(`r1-${calls.length}`, "read", { path: "a.txt" })], "tool_use");
      if (/"tool_use_id":"r1-\d+"/.test(last)) return reply([toolUse(`w1-${calls.length}`, "write", { path: "a.txt", content: "one\ntwo\n" })], "tool_use");
      if (last.includes("turn two") && !answered("w2")) return reply([toolUse("w2", "write", { path: "new.txt", content: "fresh\n" }), toolUse("b2", "bash", { command: `node -e "require('fs').unlinkSync('c.txt')"` })], "tool_use");
      if (last.includes("turn three") && !answered("e3")) return reply([toolUse("e3", "edit", { path: "a.txt", edits: [{ oldText: "two", newText: "three" }] })], "tool_use");
      return reply([{ type: "text", text: "Done." }]);
    });
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.memory.autopilot = { enabled: false };
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(shim.dataDir, root);
  });
  /** @param {string} id @param {string} content */
  const turn = async (id, content) => {
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
    if (r.status !== 200) assert.fail(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
  };
  /** @param {string} id */
  const doc = async (id) => (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  const file = (/** @type {string} */ name) => (existsSync(join(root, name)) ? readFileSync(join(root, name), "utf8") : null);
  const disk = () => ({ a: file("a.txt"), c: file("c.txt"), fresh: file("new.txt") });
  /** @param {string} id @param {any} body */
  const rewind = (id, body) => shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind`, { method: "POST", body });
  /** @param {string} id */
  const undo = (id) => shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind/undo`, { method: "POST", body: {} });

  // (fails before: yes — there was no rewind: the routes answered 404, and nothing put a chat's files back in place)
  test("the preview names the turns and each file with how it goes back; both go back, and Undo puts both as they were", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Rewind (safe to delete)" } });
    assert.equal(r.status, 200, await r.clone().text());
    const id = (await r.json()).id;
    await turn(id, "turn one");
    await turn(id, "turn two");
    await turn(id, "turn three");
    assert.deepEqual(disk(), { a: "one\nthree\n", c: null, fresh: "fresh\n" });

    const p = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/rewind?turn=2`)).json();
    assert.deepEqual(p.conversation, { from: 2, to: 3, turns: 2 });
    assert.deepEqual(
      p.files.map((/** @type {any} */ f) => [f.path, f.kind]).sort(),
      [
        ["a.txt", "changed"],
        ["c.txt", "restored"],
        ["new.txt", "deleted"],
      ],
      JSON.stringify(p),
    );
    assert.deepEqual([p.left, p.outside, p.cannot, p.errors], [[], [], [], []]);
    assert.deepEqual(disk(), { a: "one\nthree\n", c: null, fresh: "fresh\n" }, "a preview moves nothing");

    const bad = await rewind(id, { turn: 2, what: "everything" });
    assert.equal(bad.status, 400);
    const done = await rewind(id, { turn: 2, what: "both" });
    assert.equal(done.status, 200, await done.clone().text());
    const out = await done.json();
    assert.deepEqual([out.turn, out.from, out.to, out.files, out.undoable], [2, 2, 3, 3, true]);
    assert.deepEqual(disk(), { a: "one\ntwo\n", c: "keep\n", fresh: null }, "each file as it was before turn 2");
    const d = await doc(id);
    assert.deepEqual(d.rewind, { turn: 2, what: "both", line: out.line, from: 2, to: 3, files: 3 });
    assert.deepEqual(d.turns.filter((/** @type {any} */ t) => t.rewound).map((/** @type {any} */ t) => t.n), [2, 3]);

    const back = await undo(id);
    assert.equal(back.status, 200, await back.clone().text());
    assert.deepEqual(disk(), { a: "one\nthree\n", c: null, fresh: "fresh\n" }, "Undo: the files as they stood before the rewind");
    const d2 = await doc(id);
    assert.equal(d2.rewind, undefined);
    assert.deepEqual(d2.turns.filter((/** @type {any} */ t) => t.rewound), [], "the turns back in the conversation");
    assert.equal((await undo(id)).status, 409, "nothing to undo twice");

    // Rewound again, then a message: the model reads the chat without turns 2–3, and Undo is over.
    assert.equal((await rewind(id, { turn: 2, what: "both" })).status, 200);
    const before = calls.length;
    await turn(id, "after the rewind");
    const sent = said(calls[before]);
    assert.ok(sent.includes("turn one") && !sent.includes("turn two") && !sent.includes("turn three"), sent);
    assert.ok(!sent.includes("[Filament: the person"), "a rewind of both says nothing more");
    assert.equal((await doc(id)).rewind, undefined);
    assert.equal((await undo(id)).status, 409, "Undo lasts until the next message");
  });

  // (fails before: yes)
  test("files alone: the conversation stays, and the agent is told with the next message; conversation alone keeps the files", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Rewind sides (safe to delete)" } });
    const id = (await r.json()).id;
    writeFileSync(join(root, "a.txt"), "one\n");
    await turn(id, "turn one");
    assert.equal(file("a.txt"), "one\ntwo\n");
    const filesOnly = await (await rewind(id, { turn: 1, what: "files" })).json();
    assert.deepEqual([filesOnly.files, filesOnly.line], [1, null]);
    assert.equal(file("a.txt"), "one\n");
    assert.deepEqual((await doc(id)).turns.filter((/** @type {any} */ t) => t.rewound), [], "the conversation stays");
    const before = calls.length;
    await turn(id, "go on");
    const sent = JSON.stringify(calls[before].body.messages.at(-1));
    assert.match(sent, /\[Filament: the person put the files back to how they were before their message of turn 1; .*a\.txt/);
    const d = await doc(id);
    assert.equal(d.turns.at(-1).rewindNote, true, "the row says the line rode with it");
    assert.equal((await rewind(id, { turn: 1, what: "files" })).status, 409, "nothing left to put back");

    // Conversation alone: the files the turns changed stay, and the agent hears which.
    writeFileSync(join(root, "a.txt"), "one\n");
    await turn(id, "turn one");
    const n = (await doc(id)).turns.at(-1).n;
    const conv = await (await rewind(id, { turn: n, what: "conversation" })).json();
    assert.deepEqual([conv.files, conv.from, conv.to], [0, n, n]);
    assert.equal(file("a.txt"), "one\ntwo\n", "the files are kept");
    const at = calls.length;
    await turn(id, "and now");
    assert.match(JSON.stringify(calls[at].body.messages.at(-1)), /rewound the conversation to before their message of turn \d+: turn \d+ (is|are) out of it\. The files those turns changed were kept as they are: a\.txt/);
  });

  // (fails before: yes — a second rewind before any message put its record in the first's place, and the first's note
  // went with it: the agent never heard of the turns the first took out)
  test("two rewinds before a message: the message says what each did, oldest first", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Two rewinds (safe to delete)" } });
    const id = (await r.json()).id;
    for (const words of ["note one", "note two", "note three"]) await turn(id, words);
    assert.equal((await rewind(id, { turn: 3, what: "conversation" })).status, 200);
    assert.equal((await rewind(id, { turn: 2, what: "conversation" })).status, 200);
    const at = calls.length;
    await turn(id, "go on");
    const sent = JSON.stringify(calls[at].body.messages.at(-1));
    const first = sent.indexOf("before their message of turn 3: turn 3 is out of it");
    const second = sent.indexOf("before their message of turn 2: turn 2 is out of it");
    assert.ok(first >= 0 && second > first, sent);
    assert.equal((await doc(id)).turns.at(-1).rewindNote, true, "the row says the word rode with it");
  });

  // (fails before: yes — the review of 11-07: a summary went on standing for turns a rewind took out, the reply that
  // ended them brought back after it, so the agent read on from work the person had taken back)
  test("a summary written before a rewind that took a turn it stands for stands no more; an Undo brings it back; one written after the rewind stands", async () => {
    const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", title: "Rewind a summary (safe to delete)" } });
    const id = (await r.json()).id;
    for (const words of [`note alpha ${"and the words around them ".repeat(400)}`, "note bravo", "note charlie"]) await turn(id, words);
    const compact = async () => {
      const made = await shim.api(`/api/sessions/${encodeURIComponent(id)}/compact`, { method: "POST", body: { method: "summary" } });
      assert.equal(made.status, 200, await made.clone().text());
    };
    /** The history the next message is sent with, as the model reads it. @param {string} words */
    const sentWith = async (words) => {
      const at = calls.length;
      await turn(id, words);
      return JSON.stringify(calls[at].body.messages);
    };
    await compact();
    assert.equal((await rewind(id, { turn: 2, what: "conversation" })).status, 200);
    assert.equal((await undo(id)).status, 200);
    const undone = await sentWith("still here");
    assert.ok(undone.includes("<last-reply") && !undone.includes("note alpha"), `the rewind undone: the summary stands, turns 1–3 in it: ${undone.slice(0, 400)}`);
    assert.equal((await rewind(id, { turn: 2, what: "conversation" })).status, 200);
    const back = await sentWith("go on");
    assert.ok(!back.includes("<last-reply") && back.includes("note alpha") && !/note bravo|note charlie|still here/.test(back), `turn 1 whole, no summary of the turns taken out: ${back.slice(0, 600)}`);
    await compact();
    const after = await sentWith("after it");
    assert.ok(after.includes("<last-reply"), "a summary written after the rewind stands");
  });

  test("the note's words, by what went back", () => {
    assert.equal(rewindNote({ what: "both", turn: 3 }), null);
    assert.equal(rewindNote({ what: "files", turn: 3, spots: [] }), null);
    assert.match(String(rewindNote({ what: "conversation", turn: 3, to: 5 })), /turns 3–5 are out of it\. The files were kept as they are\./);
  });
});

describe("a coding agent's chat", () => {
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  /** JSON lines of a file, oldest first. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  const calls = () => lines(join(root, "calls.jsonl"));
  const prompts = () => lines(join(root, "prompts.jsonl")).map((p) => afterHead(p.prompt));
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-rewind-agent-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "ag", name: "ag", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: { FAKE_ACP_CALLS: join(root, "calls.jsonl"), FAKE_ACP_LOG: join(root, "prompts.jsonl"), FAKE_ACP_SESSION_CAPS: "resume,close" }, cwdDefault: projDir, permissions: "allow-all", hints: false } }];
        cfg.routes = [{ match: "ag/*", upstream: "ag", upstreamModel: "{1}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await removeDirs(root);
  });
  /** @param {string} path @param {any} [init] */
  const json = async (path, init) => (await shim.api(path, init)).json();

  // (fails before: yes — nothing rewound a chat in place, and nothing let go of the agent's session that held the turns)
  test("after a rewind of turns the agent answered, the next message goes to a fresh session from Filament's copy, asking nothing; after an Undo, on in the same one", async () => {
    const id = String((await json("/api/sessions", { method: "POST", body: { cwd: projDir, model: "ag/fake-a", preset: "plain", title: "Rewind an agent (safe to delete)" } })).id);
    /** @param {string} content */
    const say = async (content) => {
      const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      return r.json();
    };
    const opened = () => calls().filter((c) => c.method === "session/new").map((c) => c.sessionId);
    for (const t of ["alpha", "bravo", "charlie"]) await say(t);
    assert.equal(opened().length, 1);

    // An Undo before the next message: the session goes on.
    const first = await json(`/api/sessions/${encodeURIComponent(id)}/rewind`, { method: "POST", body: { turn: 2, what: "conversation" } });
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal((await json(`/api/sessions/${encodeURIComponent(id)}/rewind/undo`, { method: "POST", body: {} })).ok, true);
    await say("delta");
    assert.equal(opened().length, 1, "no fresh session: the rewind was undone before the message");
    assert.equal(prompts().at(-1), "delta");

    const again = await json(`/api/sessions/${encodeURIComponent(id)}/rewind`, { method: "POST", body: { turn: 2, what: "both" } });
    assert.equal(again.ok, true, JSON.stringify(again));
    assert.equal(opened().length, 1, "nothing happens to the agent until the next message");
    await say("echo");
    const [was, fresh] = opened();
    assert.ok(fresh, "a fresh session");
    assert.ok(calls().some((c) => c.method === "session/close" && c.sessionId === was), "the old one let go");
    const seed = String(prompts().at(-1));
    assert.ok(seed.startsWith(`${EARLIER_WORDS}:`) && seed.includes("alpha") && !/bravo|charlie|delta/.test(seed) && seed.endsWith("echo"), seed);
  });
});

describe("the page's words for a rewind", () => {
  test("the line, by who rewound and what went back; each file's act; the button; the note on the next message", async () => {
    const { lineWords, filesLineWords, fileWords, rewindButton, rewoundRow, filesRewoundRow } = await import("../src/ui/harness/conversation/rewound.js");
    const { deliveredWords } = await import("../src/ui/harness/conversation/turn.js");
    assert.equal(lineWords({ from: 5, to: 7, by: "harness", what: "both" }, 5), "↺ You rewound turns 5–7 and their files");
    assert.equal(lineWords({ from: 5, to: 5, by: "harness", what: "conversation" }, 5), "↺ You rewound turn 5 · the files kept their changes");
    assert.equal(lineWords({ from: 5, to: 7, by: "h:z", clientLabel: "OpenCode" }, 5), "↺ Turns 5–7 were rewound in OpenCode");
    assert.equal(filesLineWords(4, 5), "↺ You put 4 files back as they were before turn 5");
    assert.equal(filesLineWords(1, 5), "↺ You put 1 file back as it was before turn 5");
    assert.deepEqual(
      ["changed", "deleted", "restored", "renamed"].map((kind) => fileWords({ kind }, 5)),
      ["changed back", "deleted — new since turn 5", "brought back — deleted since turn 5", "renamed back"],
    );
    assert.deepEqual(["both", "conversation", "files"].map(rewindButton), ["Rewind", "Rewind the conversation", "Put the files back"]);
    assert.equal(deliveredWords({ deliveries: 1, rewindNote: true }), "with word of your rewind");
    assert.equal(deliveredWords({ deliveries: 2, rewindNote: true, shellExits: 1 }), "with word of your rewind and 1 background shell exit");

    /** @type {any[]} */
    const made = [];
    const mk = (/** @type {string} */ tag, /** @type {any} */ attrs = {}, /** @type {any[]} */ ...kids) => {
      const node = { tag, attrs, kids: kids.filter(Boolean) };
      made.push(node);
      return node;
    };
    let undone = 0;
    let shown = 0;
    const row = rewoundRow({ n: 5, userText: "Add retries to the upload client", rewound: { from: 5, to: 7, line: "r1", by: "harness", what: "both" } }, { chainId: "c1" }, { h: mk, show: () => shown++, undo: () => undone++ });
    const buttons = made.filter((n) => n.tag === "button");
    assert.deepEqual(buttons.map((b) => b.kids[0]), ["Show them", "Undo", "Open as a fork"]);
    assert.equal(/** @type {any} */ (row).attrs.title, "From “Add retries to the upload client”");
    buttons[0].attrs.onclick();
    buttons[1].attrs.onclick();
    assert.deepEqual([shown, undone], [1, 1]);
    made.length = 0;
    filesRewoundRow({ turn: 5, files: 1 }, { h: mk, undo: () => undone++ });
    assert.deepEqual(made.filter((n) => n.tag === "button").map((b) => b.kids[0]), ["Undo"]);
  });
});

describe("a rewind's files where a link stands in the way", () => {
  // (fails before: yes — the bug hunt of 10-30, GIT-2: a file whose folder had become a link out of the repository —
  // a junction on Windows, which git reads through — was put back through it, the file outside written over; Undo
  // wrote through one the same way)
  test("a file whose folder became a link out of the repository is not put back, said so; a write through one is refused, nothing moved", async (t) => {
    const base = mkdtempSync(join(tmpdir(), "filament-rewind-link-"));
    const dir = join(base, "repo");
    const outside = join(base, "outside");
    mkdirSync(join(dir, "sub"), { recursive: true });
    mkdirSync(outside);
    const read = (/** @type {string} */ p) => readFileSync(p, "utf8");
    try {
      run(dir, ["init", "-q", "-b", "main"]);
      run(dir, ["config", "core.autocrlf", "false"]);
      writeFileSync(join(dir, "a.txt"), "one\n");
      writeFileSync(join(dir, "sub", "file.txt"), "v1\n");
      run(dir, ["add", "."]);
      run(dir, ["commit", "-q", "-m", "init"]);
      const place = run(dir, ["rev-parse", "--show-toplevel"]);
      // A turn that changed both, between its round's snapshots.
      const before = await snapshotTree(dir, { name: "t/1-before" });
      writeFileSync(join(dir, "a.txt"), "one\ntwo\n");
      writeFileSync(join(dir, "sub", "file.txt"), "v2\n");
      const after = await snapshotTree(dir, { name: "t/1-1" });
      /** @type {any[]} */
      const rounds = [{ place, round: 1, agent: "", before: before.at, after: after.at, base: "round", own: ["a.txt", "sub/file.txt"], command: false, turn: 1 }];
      // Since: its folder is a link to one outside the repository, whose file is someone else's.
      rmSync(join(dir, "sub"), { recursive: true });
      writeFileSync(join(outside, "file.txt"), "someone's, outside\n");
      try {
        symlinkSync(outside, join(dir, "sub"), "junction");
      } catch (/** @type {any} */ e) {
        return t.skip(`no link can be made here (${e.code})`);
      }
      const plan = await planFiles(rounds);
      assert.deepEqual(plan.files.map((f) => [f.path, f.kind]), [["a.txt", "changed"]]);
      assert.deepEqual(plan.cannot, [{ place, path: "sub/file.txt", why: "a folder on its way is a link out of the project, which Filament leaves to you" }]);
      const done = await putBack(plan, { name: "t/rewind" });
      assert.ok(done.ok, !done.ok ? done.error : "");
      assert.deepEqual([read(join(dir, "a.txt")), read(join(outside, "file.txt"))], ["one\n", "someone's, outside\n"]);
      // Undo's write, of a file a rewind moved before its folder became a link: refused before anything moves.
      const undo = await putForward([{ place, path: "a.txt" }, { place, path: "sub/file.txt" }], [{ place, pre: String(after.at) }]);
      assert.deepEqual(undo, { ok: false, error: "sub/file.txt: a folder on its way is a link out of the project, which Filament leaves to you" });
      assert.deepEqual([read(join(dir, "a.txt")), read(join(outside, "file.txt"))], ["one\n", "someone's, outside\n"], "nothing moved");
    } finally {
      // The link goes as a link, never followed.
      try {
        unlinkSync(join(dir, "sub"));
      } catch {}
      await removeDirs(base);
    }
  });
});

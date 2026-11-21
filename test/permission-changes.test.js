// @ts-check
// HarnessV3-ACP, AC3's drive D5: a permission to change a file shows the change — the file inside the session's
// folder, what the call makes of it, and its diff — where the card showed the path the call gave, often absolute, and
// the words a chat client answers by. The change itself; the loop's own write and edit, on the ask, a worker's wait
// and a page loaded while it waits; a coding agent's (its ACP diff, Codex's patch); and the card.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { CHANGE_SHOWN, shownChange, toolSetFor } from "../src/app/agent/tools.js";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { loopCalls } from "../src/adapters/agents/turn-bridge.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { changeInput } from "../src/core/codex-items.js";
import { permissionBlock } from "../src/ui/harness/conversation/interaction.js";
import { diffView } from "../src/ui/harness/lib/ui.js";
import { pauseOf } from "../src/ui/harness/lib/labels.js";
import { askWords } from "../src/ui/harness/lib/team.js";

const NL = "\n";
const THIRTY = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
/** A patch's lines, its last line end apart. @param {string[]} lines */
const patchOf = (lines) => `${lines.join(NL)}${NL}`;
/** The first node under `n` wearing a class. @param {any} n @param {string} cls @returns {any} */
const one = (n, cls) => {
  if (!n || typeof n !== "object") return null;
  if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) return n;
  for (const k of n.kids || []) {
    const hit = one(k, cls);
    if (hit) return hit;
  }
  return null;
};
/** Every node under `n` wearing a class. @param {any} n @param {string} cls @returns {any[]} */
const all = (n, cls) => {
  if (!n || typeof n !== "object") return [];
  const own = String(n.attrs?.class || "").split(/\s+/).includes(cls) ? [n] : [];
  return [...own, ...(n.kids || []).flatMap((/** @type {any} */ k) => all(k, cls))];
};

describe("a change as a card shows it", () => {
  /** @type {string} */
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-permission-changes-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.js"), patchOf(THIRTY));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("a write is shown against the file as it stands: a new file's every line added, a file it replaces by the lines it changes", () => {
    assert.deepEqual(shownChange("write", { path: "src/new.txt", content: `one${NL}two${NL}` }, root), {
      file: "src/new.txt",
      patch: patchOf(["--- /dev/null", "+++ src/new.txt", "@@ -0,0 +1,2 @@", "+one", "+two"]),
      added: 2,
      removed: 0,
      created: true,
      deleted: false,
      every: false,
      omitted: 0,
    });
    const over = shownChange("write", { path: join(root, "src", "a.js"), content: patchOf(THIRTY.map((l, i) => (i === 4 ? "FIVE" : l))) }, root);
    assert.equal(over?.file, "src/a.js", "the call's absolute path, as the file inside the folder");
    assert.deepEqual([over?.created, over?.added, over?.removed], [false, 1, 1]);
    assert.equal(over?.patch, patchOf(["--- src/a.js", "+++ src/a.js", "@@ -2,7 +2,7 @@", " line 2", " line 3", " line 4", "-line 5", "+FIVE", " line 6", " line 7", " line 8"]));
    assert.equal(shownChange("write", { path: "src/empty.txt", content: "" }, root)?.patch, "", "an empty new file: the file alone");
  });

  test("an edit shows each text it replaces among the file's own lines, by their numbers — one not found as written, on its own", () => {
    const placed = shownChange("edit", { path: "src/a.js", edits: [{ oldText: "line 3", newText: "LINE 3" }, { oldText: `line 25${NL}line 26${NL}`, newText: "" }] }, root);
    assert.equal(placed?.patch, patchOf([
      "--- src/a.js", "+++ src/a.js",
      "@@ -1,6 +1,6 @@", " line 1", " line 2", "-line 3", "+LINE 3", " line 4", " line 5", " line 6",
      "@@ -22,8 +22,6 @@", " line 22", " line 23", " line 24", "-line 25", "-line 26", " line 27", " line 28", " line 29",
    ]));
    assert.deepEqual([placed?.added, placed?.removed, placed?.every], [1, 3, false]);
    const loose = shownChange("edit", { path: "src/a.js", edits: [{ oldText: "nope", newText: "yes" }] }, root);
    assert.equal(loose?.patch, patchOf(["--- src/a.js", "+++ src/a.js", "@@ -1,1 +1,1 @@", "-nope", "+yes"]));
    const every = shownChange("edit", { path: "src/a.js", edits: [{ old_string: "line 3", new_string: "L3", replace_all: true }] }, root);
    assert.deepEqual([every?.every, every?.added, every?.removed], [true, 2, 2], "line 3, and line 30 that holds it");
    const atEnd = shownChange("edit", { path: "src/a.js", edits: [{ oldText: `line 30${NL}`, newText: `line 30${NL}line 31${NL}` }] }, root);
    assert.equal(atEnd?.patch, patchOf(["--- src/a.js", "+++ src/a.js", "@@ -28,3 +28,4 @@", " line 28", " line 29", " line 30", "+line 31"]), "no line after the file's last");
  });

  test("a patch an agent wrote shows as it is, its heads given; a deletion, every line removed; a call naming only its file, the file alone", () => {
    const codex = shownChange("edit", changeInput({ path: "src/a.js", kind: { type: "update", move_path: null }, diff: `@@ -1 +1,2 @@${NL} line 1${NL}+added${NL}` }), root);
    assert.deepEqual([codex?.file, codex?.patch, codex?.added, codex?.removed], ["src/a.js", patchOf(["--- src/a.js", "+++ src/a.js", "@@ -1 +1,2 @@", " line 1", "+added"]), 1, 0]);
    const gone = shownChange("edit", changeInput({ path: "src/a.js", kind: { type: "delete" }, diff: "" }), root);
    assert.deepEqual([gone?.deleted, gone?.added, gone?.removed, gone?.patch.split(NL)[2]], [true, 0, 30, "@@ -1,30 +0,0 @@"]);
    const made = shownChange("write", changeInput({ path: "src/b.txt", kind: { type: "add" }, diff: `x${NL}` }), root);
    assert.deepEqual([made?.created, made?.added], [true, 1]);
    assert.deepEqual(shownChange("edit", { path: "src/a.js" }, root), { file: "src/a.js", patch: "", added: 0, removed: 0, created: false, deleted: false, every: false, omitted: 0 });
    assert.equal(shownChange("bash", { command: "ls" }, root), null);
    assert.equal(shownChange("write", { content: "x" }, root), null, "no file named");
  });

  test("a file outside the folder is named whole; what a card shows is redacted, and cut to what a card holds", () => {
    const elsewhere = join(tmpdir(), "filament-permission-changes-elsewhere.txt");
    const out = shownChange("write", { path: elsewhere, content: `key sk-ant-api03-abcdefghijklmnopqrstuvwxyz${NL}` }, root);
    assert.equal(out?.file, elsewhere.split("\\").join("/"));
    assert.ok(out?.patch.includes("+key sk-ant") && !out.patch.includes("abcdefghijklmnop"), "the key redacted");
    const big = shownChange("write", { path: "src/big.txt", content: Array.from({ length: 2000 }, (_, i) => `row ${i}`).join(NL) }, root);
    const rows = String(big?.patch).split(NL).filter((l) => /^[ +-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    assert.deepEqual([big?.added, rows.length, big?.omitted], [2000, CHANGE_SHOWN.lines, 2000 - CHANGE_SHOWN.lines]);
    assert.ok(big?.patch.includes(`@@ -0,0 +1,${CHANGE_SHOWN.lines} @@`), "the hunk cut short, counted again");
    const wide = shownChange("write", { path: "src/wide.txt", content: "x".repeat(5000) }, root);
    assert.ok(String(wide?.patch).split(NL).every((l) => l.length <= CHANGE_SHOWN.row + 1), "a line past a card's width, cut");
  });
});

describe("a coding agent's change, as the switch judges it", () => {
  /** @type {string} */
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-permission-changes-agent-"));
    writeFileSync(join(root, "README.md"), `hello agent${NL}`);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("an ACP request's diff rides the loop's call: a text written whole, each text it replaces, a deletion", () => {
    const file = join(root, "README.md");
    const write = { name: "Write", kind: "edit", title: "Write README.md", rawInput: { file_path: file, content: "x" }, locations: [{ path: file }], content: [{ type: "diff", path: file, oldText: null, newText: "x" }] };
    assert.deepEqual(loopCalls(write, "claude"), [{ name: "write", input: { path: file, content: "x" } }]);
    const edit = { name: "Edit", kind: "edit", title: "Edit README.md", rawInput: { file_path: file, old_string: "hello", new_string: "hi", replace_all: true }, locations: [{ path: file }], content: [{ type: "diff", path: file, oldText: "hello", newText: "hi" }] };
    assert.deepEqual(loopCalls(edit, "claude"), [{ name: "edit", input: { path: file, edits: [{ oldText: "hello", newText: "hi", replaceAll: true }] } }]);
    const elsewhere = { ...edit, rawInput: {}, content: [{ type: "diff", path: join(root, "other.md"), oldText: "a", newText: "b" }] };
    assert.deepEqual(loopCalls(elsewhere, "claude"), [{ name: "edit", input: { path: file } }], "another file's diff is not this one's");
    assert.deepEqual(loopCalls({ kind: "delete", title: "Delete", locations: [{ path: file }] }, "gemini"), [{ name: "edit", input: { path: file, deleted: true } }]);
  });

  test("a change the switch asks about carries each file as its card shows it, and how many more past those", () => {
    const ask = createAgentPermits({ rules: [], modeNow: () => /** @type {any} */ ("ask"), learned: null });
    const file = join(root, "README.md");
    const j = ask.judge([{ name: "edit", input: { path: file, edits: [{ oldText: "hello agent", newText: "hello, agent of change", replaceAll: false }] } }], root);
    assert.equal(j.verdict, "ask");
    assert.deepEqual(j.changes?.map((c) => [c.file, c.patch, c.added, c.removed]), [["README.md", patchOf(["--- README.md", "+++ README.md", "@@ -1,1 +1,1 @@", "-hello agent", "+hello, agent of change"]), 1, 1]]);
    assert.equal(j.changesLeft, undefined);
    const many = Array.from({ length: CHANGE_SHOWN.files + 2 }, (_, i) => ({ name: "write", input: { path: join(root, `f${i}.txt`), content: "x" } }));
    const k = ask.judge(many, root);
    assert.deepEqual([k.changes?.length, k.changesLeft, k.changes?.[0].file], [CHANGE_SHOWN.files, 2, "f0.txt"]);
    assert.equal(ask.judge([{ name: "bash", input: { command: "rm -rf build" } }], root).changes, undefined, "a command changes no file it names");
  });
});

/**
 * A loop turn whose model calls `name` with `input` once in Ask mode, then ends: a session's turn, which pauses for the
 * permission, or — with `asker` — a team's worker's, whose call waits in place for the answer `asker` gives.
 * @param {string} name @param {any} input @param {{ root: string, asker?: any }} o
 */
const changeTurn = async (name, input, { root, asker = null }) => {
  /** @type {any[]} */
  const events = [];
  let n = 0;
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "change it" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "ask",
      root,
      readerModel: "",
      maxTokens: 100,
      unattended: asker ? "worker" : false,
      asker,
      call: async () => {
        const content = n++ === 0 ? [{ type: "tool_use", id: "w1", name, input }] : [{ type: "text", text: "Done." }];
        return { ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null };
      },
      costOf: () => 0,
      runHand: async () => "ok",
      delegateRead: null,
      mailbox: null,
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => events.push(e),
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
    }),
  );
  return { out, ask: events.find((e) => e.type === "ask") };
};

describe("the loop's own write and edit", () => {
  /** @type {string} */
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-permission-changes-loop-"));
    writeFileSync(join(root, "notes.md"), `# Notes${NL}first${NL}`);
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  test("a write that asks carries its change on the ask, the question's words kept for a client that draws no card", async () => {
    const { out, ask } = await changeTurn("write", { path: join(root, "plan.md"), content: `# Plan${NL}` }, { root });
    assert.equal(out.pause?.kind, "permission");
    assert.deepEqual(ask.changes?.map((/** @type {any} */ c) => [c.file, c.created, c.patch]), [["plan.md", true, patchOf(["--- /dev/null", "+++ plan.md", "@@ -0,0 +1,1 @@", "+# Plan"])]]);
    assert.match(ask.question, /^May I write .*plan\.md\? Answer \/allow/);
  });

  test("a worker's edit waits with its change, and its line in the dock names the file inside its folder", async () => {
    /** @type {any[]} */
    const asked = [];
    await changeTurn("edit", { path: join(root, "notes.md"), edits: [{ oldText: "first", newText: "second" }] }, { root, asker: async (/** @type {any} */ q) => { asked.push(q); return { text: "no" }; } });
    assert.deepEqual(asked.map((q) => q.changes?.map((/** @type {any} */ c) => [c.file, c.added, c.removed])), [[["notes.md", 1, 1]]]);
    assert.deepEqual(askWords(asked[0]), { verb: "wants to edit", what: "notes.md", whole: "notes.md" });
  });
});

describe("On a session: a page loaded while a write waits", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  /** @type {string} */
  let folder;
  before(async () => {
    folder = mkdtempSync(join(tmpdir(), "filament-permission-changes-app-"));
    writeFileSync(join(folder, "notes.md"), `# Notes${NL}first${NL}`);
    up = await fakeUpstream(async (call) => {
      const b = call.body || {};
      const model = String(b.model || "");
      const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
      if (JSON.stringify(b.messages?.at(-1)?.content || "").includes('"tool_use_id":"toolu_edit"')) return blocks([{ type: "text", text: "EDITED" }]);
      return blocks([{ type: "text", text: "Editing the notes." }, { type: "tool_use", id: "toolu_edit", name: "edit", input: { path: join(folder, "notes.md"), edits: [{ oldText: "first", newText: "second" }] } }], "tool_use");
    });
    shim = await startApp({
      memory: true,
      configure: (/** @type {any} */ cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "ask", roots: [folder], readerModel: "" };
        cfg.memory.autopilot = { enabled: false };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    for (const dir of [folder, shim.dataDir]) rmSync(dir, { recursive: true, force: true });
  });

  test("the transcript's pause carries the change, against the file as it stands", async () => {
    const c = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } });
    assert.equal(c.status, 200, await c.clone().text());
    const id = String((await c.json()).id);
    const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "edit the notes", stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    const p = (await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript?limit=5&work=0`)).json()).paused;
    assert.equal(p?.kind, "permission");
    assert.deepEqual(p.changes?.map((/** @type {any} */ c) => [c.file, c.patch]), [["notes.md", patchOf(["--- notes.md", "+++ notes.md", "@@ -1,2 +1,2 @@", " # Notes", "-first", "+second"])]]);
    assert.deepEqual(pauseOf(p).changes, p.changes, "the dock draws it from the transcript as from the live ask");
  });
});

describe("the card", () => {
  const change = { file: "src/lib/parse.js", patch: patchOf(["--- src/lib/parse.js", "+++ src/lib/parse.js", "@@ -1,2 +1,2 @@", " a", "-b", "+B"]), added: 1, removed: 1, created: false, deleted: false, every: false, omitted: 0 };
  const question = "May I edit C:\\work\\src\\lib\\parse.js? Answer /allow to edit it, or say what to do instead.";

  test("a change shows its file, what it makes of it and its counts over its diff — not the question's path and chat words", () => {
    const block = permissionBlock({ paused: { kind: "permission", tool: "edit", question, changes: [change, { ...change, file: "README.md", patch: "", added: 0, removed: 0, created: true }] } }, { onAnswer: () => {} }, { h: fakeH });
    const [first, second] = all(block, "ix-change");
    assert.deepEqual([textOf(one(first, "ix-change-name")), textOf(one(first, "ix-change-dir")), textOf(one(first, "zc-diff"))], ["parse.js", "src/lib", "+1|-1"]);
    assert.deepEqual(all(first, "diff-line").map((r) => [String(r.attrs.class), textOf(r)]), [
      ["diff-line hunk", "|@@ -1,2 +1,2 @@"],
      ["diff-line ctx", "|a"],
      ["diff-line del", "−|b"],
      ["diff-line add", "+|B"],
    ], "the patch's heads left to the file's line");
    assert.deepEqual([textOf(one(second, "ix-change-name")), one(second, "ix-change-dir"), textOf(one(second, "ix-change-tag")), one(second, "ix-change-diff")], ["README.md", null, "New file", null]);
    assert.ok(!textOf(block).includes("May I edit") && !textOf(block).includes("Answer /allow"), "the question is a chat client's");
    assert.equal(one(block, "ix-reason"), null);
  });

  test("a change cut short says how many lines it left out; a request past a card's files, how many more it changes", () => {
    const block = permissionBlock({ paused: { kind: "permission", tool: "write", question, changes: [{ ...change, omitted: 40 }], changesLeft: 3 } }, { onAnswer: () => {} }, { h: fakeH });
    assert.deepEqual(all(block, "ix-change-more").map(textOf), ["40 more lines not shown", "3 more files in this change"]);
  });

  test("the transcript's pause and the live ask reach the card alike, its files and how many more", () => {
    assert.deepEqual(pauseOf({ kind: "permission", question, tool: "edit", changes: [change], changesLeft: 2 }), { kind: "permission", question, tool: "edit", changes: [change], changesLeft: 2 });
    assert.deepEqual(pauseOf({ kind: "permission", question, tool: "edit", changes: [] }), { kind: "permission", question, tool: "edit" });
  });

  // (fails before: yes — the plain diff, which shows until the rich one loads or where it fails, drew each line's sign
  // twice, in the gutter and in the line, and the patch's heads as lines of the file)
  test("the plain diff draws a line's sign in the gutter alone, and the patch's heads apart from the file's lines", () => {
    const view = diffView(patchOf(["diff --git a/x.js b/x.js", "--- a/x.js", "+++ b/x.js", "@@ -1,2 +1,3 @@", " keep", "-gone", "+came", "+++also"]), { h: fakeH });
    assert.deepEqual(all(view, "diff-line").map((r) => [String(r.attrs.class).replace("diff-line ", ""), textOf(r)]), [
      ["head", "|diff --git a/x.js b/x.js"],
      ["head", "|--- a/x.js"],
      ["head", "|+++ b/x.js"],
      ["hunk", "|@@ -1,2 +1,3 @@"],
      ["ctx", "|keep"],
      ["del", "−|gone"],
      ["add", "+|came"],
      ["add", "+|++also"],
    ]);
  });
});

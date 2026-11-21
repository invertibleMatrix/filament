// @ts-check
// A file-writing call's start says the files it writes (`edits`, services/runs.js RUN_EVENT_FIELDS), which the keeper of
// a chat's own times keeps as that chat's writes (app/watchers/own-times.js): Filament's loop, driven directly with a
// scripted model call; no network. Through a real Filament and its hands, in watch-commit-own.test.js.
// (fails before: yes, the first three — no call's start said `edits`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runAgentTurn } from "../src/app/agent/loop.js";
import { toolSetFor } from "../src/app/agent/tools.js";

const ROOT = resolve(tmpdir());
/** @param {string} id @param {string} name @param {any} input */
const toolUse = (id, name, input) => ({ type: "tool_use", id, name, input });
/** @param {any[]} content */
const reply = (content) => ({ ok: true, status: 200, json: { content, usage: { input_tokens: 10, output_tokens: 5 } }, id: null });

/**
 * One turn on Filament's loop whose model makes `rounds`, one reply each, then ends: each call's start, by its id, as
 * the run says it.
 * @param {any[][]} rounds @param {Record<string, any>} [over]
 */
const turn = async (rounds, over = {}) => {
  let n = 0;
  /** @type {any[]} */
  const events = [];
  const out = await runAgentTurn(
    /** @type {any} */ ({
      model: "m",
      messages: [{ role: "user", content: "change the files" }],
      system: "s",
      tools: toolSetFor({ delegateRead: false }),
      modeNow: () => "auto",
      root: ROOT,
      readerModel: "",
      maxTokens: 100,
      call: async () => reply(rounds[n++] || [{ type: "text", text: "Done." }]),
      costOf: () => 0,
      runHand: async (/** @type {string} */ name) => `${name} ran`,
      delegateRead: null,
      mailbox: null,
      permissions: null,
      tree: null,
      onEvent: (/** @type {any} */ e) => void events.push(e),
      previewChars: 0,
      sink: { blocks: 0, text() {}, thinking() {}, signThinking() {}, endBlock() {}, count() { return 0; } },
      signal: null,
      resume: null,
      ...over,
    }),
  );
  /** @type {Record<string, any>} */
  const starts = Object.fromEntries(events.filter((e) => e.type === "tool-start").map((e) => [e.id, e]));
  return { out, starts, events };
};

test("a write and an edit say their file, absolute, as the hands land it; a read, a search and a command say none", async () => {
  const abs = join(ROOT, "docs", "Guide.md");
  const { out, starts } = await turn([
    [
      toolUse("w1", "write", { path: "src/New.js", content: "x" }),
      toolUse("e1", "edit", { path: "./src/../src/a.js", edits: [{ oldText: "a", newText: "b" }] }),
      toolUse("e2", "edit", { path: abs, edits: [{ oldText: "a", newText: "b" }, { oldText: "c", newText: "d" }] }),
      toolUse("n1", "edit", { path: "nb.ipynb", edits: [{ oldText: "a", newText: "b" }] }),
      toolUse("w2", "write", { file_path: "other.txt", content: "x" }),
    ],
    [toolUse("r1", "read", { path: "src/a.js" }), toolUse("g1", "grep", { pattern: "x", path: "src" }), toolUse("b1", "bash", { command: "npm test" }), toolUse("b2", "bash_background", { command: "npm run dev" })],
  ]);
  assert.equal(out.status, "done");
  assert.deepEqual(
    Object.fromEntries(Object.entries(starts).map(([id, e]) => [id, e.edits])),
    { w1: [join(ROOT, "src", "New.js")], e1: [join(ROOT, "src", "a.js")], e2: [abs], n1: [join(ROOT, "nb.ipynb")], w2: [join(ROOT, "other.txt")], r1: undefined, g1: undefined, b1: undefined, b2: undefined },
    "each file hand's file, its case kept; no other call's",
  );
  assert.ok(!("edits" in starts.r1) && !("edits" in starts.b1), "a call that writes no file carries no such field");
  assert.deepEqual([starts.b1.command, starts.w1.command, starts.w1.input], [true, undefined, undefined], "a command is said as one, a file's write as none; no call's input rides its start");
});

test("a file named from another drive lands where the hands write it", { skip: process.platform !== "win32" && "drive letters are Windows'" }, async () => {
  const other = ROOT.slice(0, 1).toUpperCase() === "Q" ? "R" : "Q";
  const real = process.cwd;
  process.cwd = () => `${other}:\\filament`; // Filament runs from that drive: the hands write Q:x.txt to Q:\
  try {
    const { starts } = await turn([[toolUse("w1", "write", { path: `${other}:x.txt`, content: "x" }), toolUse("w2", "write", { path: `${other}:\\dir\\y.txt`, content: "x" })]]);
    assert.deepEqual([starts.w1.edits, starts.w2.edits], [[`${other}:\\x.txt`], [`${other}:\\dir\\y.txt`]]);
  } finally {
    process.cwd = real;
  }
});

test("a path past 400 characters, and a call that names no file, say only that the call writes", async () => {
  const at400 = "x".repeat(400 - ROOT.length - 1);
  const { starts } = await turn([[toolUse("w1", "write", { path: at400, content: "x" }), toolUse("w2", "write", { path: `${at400}y`, content: "x" }), toolUse("w3", "write", { content: "x" })]]);
  assert.deepEqual([starts.w1.edits, starts.w2.edits, starts.w3.edits], [[join(ROOT, at400)], true, true]);
});

// (fails before: no — a guard: a call the gate keeps from running has no start of `runOne`'s, the one that says `edits`)
test("a write that never runs — refused read-only, vetoed — says none: its start is a refused card's", async () => {
  const refused = await turn([[toolUse("w1", "write", { path: "a.txt", content: "x" })]], { modeNow: () => "read-only" });
  assert.deepEqual([refused.starts.w1.edits, refused.events.find((e) => e.type === "tool-end" && e.id === "w1")?.refused], [undefined, true]);
  /** What the developer typed as the model decided, read as the loop's mailbox gives it: those `pick` takes, once. @type {any[]} */
  let mail = [{ kind: "veto", text: "not that file" }];
  const read = (pick = (/** @type {any} */ _m) => true) => {
    const got = mail.filter(pick);
    mail = mail.filter((m) => !got.includes(m));
    return got;
  };
  const vetoed = await turn([[toolUse("w1", "write", { path: "a.txt", content: "x" })]], { mailbox: { read } });
  assert.deepEqual([vetoed.starts.w1.edits, vetoed.events.find((e) => e.type === "tool-end" && e.id === "w1")?.vetoed], [undefined, true]);
});

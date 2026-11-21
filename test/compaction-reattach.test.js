// @ts-check
// HarnessV3-AtHome AH-D9 (b), step 3: what comes back after a summary. The summary stands for the turns, but the files
// they worked on are the work itself, and a model reaches for them again first thing. So the newest files the summarized
// work read, wrote or edited come back as they are on disk at compaction time (at most five, each whole or only named),
// with the live plan, in one block after the summary. It is written once, with the compaction, so every request after
// it sends the same bytes.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { touchedFiles, planIn, afterSummaryCandidates, reattachBlock, reattachBudget, blockFiles, blockPlan, unshown, backAfterSummary, withRecall, REATTACH_FILES, REATTACH_FILE_TOKENS, REATTACH_REPLY_TOKENS } from "../src/app/sessions/reattach.js";
import { estimateTokens } from "../src/core/tokens.js";
import { Archive } from "../src/services/memory/archive.js";
import { textOfMessage } from "../src/core/messages.js";
import { compose } from "../src/app/sessions/compose.js";
import { summaryLead, SUMMARY_ACK } from "../src/app/sessions/compaction.js";
import { resolveSettings } from "../src/services/session-settings.js";
import { applyTasks, openGraphText, showText } from "../src/core/task-graph.js";
import { compactionFacts, roundCompactionWords } from "../src/ui/harness/lib/labels.js";

const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const said = (/** @type {any[]} */ blocks) => ({ role: "assistant", content: blocks });
const got = (/** @type {string} */ id, /** @type {string} */ text) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: text }] });
/** A finished turn whose work is `calls` (one assistant message each, answered). */
const turnOf = (/** @type {number} */ n, /** @type {any[]} */ calls) => ({
  n,
  user: { role: "user", content: [{ type: "text", text: `turn ${n}` }] },
  work: calls.flatMap((c, i) => [said([c]), got(c.id || `x${n}-${i}`, "ok")]),
  final: { role: "assistant", content: [{ type: "text", text: `turn ${n} done` }] },
});

describe("AH-D9 step 3: the candidates", () => {
  // (fails before: yes — there was no reattach module)
  test("touchedFiles: the files a run of messages read, wrote or edited, newest first, each once, in any vocabulary", () => {
    const msgs = [
      said([use("1", "read", { path: "a.js" }), use("2", "bash", { command: "cat z.js" })]),
      got("1", "…"),
      said([use("3", "Read", { file_path: "b.js" }), use("4", "grep", { pattern: "x", path: "lib" })]),
      got("3", "…"),
      said([use("5", "edit", { path: "a.js", edits: [{ oldText: "a", newText: "b" }] }), use("6", "Write", { file_path: "c.md", content: "c" })]),
      got("5", "…"),
    ];
    assert.deepEqual(touchedFiles(msgs), ["c.md", "a.js", "b.js"], "a command or a search names no file; a.js counts at its newest touch");
    assert.deepEqual(touchedFiles([]), []);
    // (fails before: no — added for the mutants that took any call's path for a file, and told paths apart by case on
    // Windows) the folder a search looked in is no file (above); one file spelled two ways is one file where case
    // doesn't count
    const twice = touchedFiles([said([use("1", "read", { path: "src/a.js" }), use("2", "read", { path: "SRC/A.JS" })])]);
    assert.deepEqual(twice, process.platform === "win32" ? ["SRC/A.JS"] : ["SRC/A.JS", "src/a.js"]);
  });

  // (fails before: yes — there was no reattach module)
  test("planIn: the newest plan recorded, in our words; none, null", () => {
    const msgs = [
      said([use("1", "plan", { items: [{ text: "one", status: "done" }, { text: "two", status: "pending" }] })]),
      said([use("2", "TodoWrite", { todos: [{ content: "one", status: "completed" }, { content: "two", status: "in_progress" }] })]),
    ];
    assert.deepEqual(planIn(msgs), [{ text: "one", status: "done" }, { text: "two", status: "doing" }]);
    assert.equal(planIn([said([use("1", "read", { path: "a" })])]), null);
  });

  // (fails before: yes — the hunt of 11-08: Claude Code's TaskCreate, one task and no list, read as a plan of none, which
  // hid the live plan before it, even from a kept turn; and a checklist call refused stood as the plan)
  test("planIn: a call that keeps no list (Claude Code's TaskCreate) is no plan, nor one whose call failed", () => {
    const plan = said([use("1", "plan", { items: [{ text: "one", status: "doing" }] })]);
    assert.deepEqual(planIn([plan, said([use("2", "TaskCreate", { subject: "Read the file", description: "Read README.md" })])]), [{ text: "one", status: "doing" }]);
    const refused = { role: "user", content: [{ type: "tool_result", tool_use_id: "3", content: "an item's status is no status", is_error: true }] };
    assert.deepEqual(planIn([plan, said([use("3", "plan", { items: [{ text: "two", status: "maybe" }] })]), refused]), [{ text: "one", status: "doing" }]);
    const turns = [turnOf(1, [use("a", "plan", { items: [{ text: "x", status: "doing" }] })]), turnOf(2, [use("b", "TaskCreate", { subject: "y" })])];
    assert.deepEqual(afterSummaryCandidates(turns, 1).plan, [{ text: "x", status: "doing" }], "a kept turn's TaskCreate shows no newer plan");
  });

  // (fails before: yes — there was no reattach module)
  test("after a summary of turns 1–3: their files newest first, less what the kept turns show; the plan unless finished or shown", () => {
    const turns = [
      turnOf(1, [use("a", "read", { path: "old.js" }), use("b", "plan", { items: [{ text: "x", status: "doing" }] })]),
      turnOf(2, [use("c", "read", { path: "mid.js" }), use("d", "read", { path: "tail.js" })]),
      turnOf(3, [use("e", "edit", { path: "new.js", edits: [] })]),
      turnOf(4, [use("f", "read", { path: "tail.js" })]),
    ];
    const c = afterSummaryCandidates(turns, 3);
    assert.deepEqual(c.files, ["new.js", "mid.js", "old.js"], "tail.js is read again in turn 4, which stays as it is");
    assert.deepEqual(c.plan, [{ text: "x", status: "doing" }]);
    const done = [turnOf(1, [use("a", "plan", { items: [{ text: "x", status: "done" }] })]), turnOf(2, [])];
    assert.equal(afterSummaryCandidates(done, 2).plan, null, "a finished plan is no live plan");
    const shown = [...turns, turnOf(5, [use("g", "plan", { items: [{ text: "y", status: "pending" }] })])];
    assert.equal(afterSummaryCandidates(shown, 3).plan, null, "a kept turn shows the newer plan itself");
  });

  // (fails before: yes — HarnessV4_Tasks C29: every compaction read the work of every turn the session ever had)
  test("after a summary that takes an earlier one's place: the turns since it are read, then what its block brought back — no turn it stands for is opened", () => {
    const behind = (/** @type {number} */ n) => ({ n, get work() { throw new Error(`opened turn ${n}, which the earlier summary stands for`); } });
    const earlier = reattachBlock({ files: ["gone.js", "old.js"], plan: [{ text: "ship it", status: "doing" }, { text: "two\nlines", status: "pending" }], root: "", rules: [], redact: null, window: 200_000 });
    const named = `[Filament brought these back after the summary: the files the work used most recently, as they are on disk now, and the plan as it stood. A file only named was not brought back; read it again if you need it.]\n\n<file path="old.js" shown="no">no room to bring it back</file>\n\n<file path="tail.js" shown="no">no room left after the files above</file>\n\n${earlier.text.slice(earlier.text.indexOf("<plan>"))}`;
    const head = { to_turn: 2, attached: named };
    const turns = [behind(1), behind(2), turnOf(3, [use("a", "read", { path: "new.js" })]), turnOf(4, [use("b", "edit", { path: "mid.js", edits: [] })]), turnOf(5, [use("c", "read", { path: "tail.js" })])];
    const c = afterSummaryCandidates(/** @type {any[]} */ (turns), 4, head);
    assert.deepEqual(c.files, ["mid.js", "new.js", "old.js"], "turns 3–4 newest first, then the earlier block's; tail.js is read again in turn 5");
    assert.deepEqual(c.plan, [{ text: "ship it", status: "doing" }, { text: "two\nlines", status: "pending" }], "no turn since recorded a plan: the earlier block's, as it stood");
    // A turn since recorded a newer plan: that one, and where it is finished, none.
    const newer = [...turns.slice(0, 3), turnOf(4, [use("d", "plan", { items: [{ text: "z", status: "done" }] })]), turns[4]];
    assert.equal(afterSummaryCandidates(/** @type {any[]} */ (newer), 4, head).plan, null);
    // A head with no block (an agent's own summary): the turns since it alone.
    const alone = afterSummaryCandidates(/** @type {any[]} */ (turns), 4, { to_turn: 2, attached: null });
    assert.deepEqual({ files: alone.files, plan: alone.plan }, { files: ["mid.js", "new.js"], plan: null });
  });

  // (fails before: yes — the owner's of 11-07: a compaction is the checkpoint to tell the agent what it is likely to
  // forget; the summary paraphrased the reply the person's next message answers, named no skill loaded, and never said
  // the turns come back word for word; the owner's of 11-07: the skills named are those the agent loaded, its tool's
  // calls in the turns' work — a look in a folder and a load that failed none)
  test("after a summary of turns 3–4: the last reply word for word, its end where long; the skills loaded, newest first; the recall line", () => {
    const load = (/** @type {string} */ id, /** @type {any} */ input, name = "skill") => ({ role: "assistant", content: [{ type: "tool_use", id, name, input }] });
    const result = (/** @type {string} */ id, error = false) => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "x", ...(error ? { is_error: true } : {}) }] });
    const turns = [
      { ...turnOf(3, []), work: [load("a", { name: "tilemaps" }), result("a"), load("b", { name: "Deploy" }, "mcp__filament__skill"), result("b"), load("c", { name: "pdf", action: "list" }), result("c"), load("d", { name: "nope" }), result("d", true)] },
      { ...turnOf(4, []), work: [load("e", { name: "deploy", action: "load" }), result("e")] },
      { ...turnOf(5, []), work: [load("f", { name: "review" }), result("f")] },
    ];
    const c = afterSummaryCandidates(/** @type {any[]} */ (turns), 4, { to_turn: 2, attached: null });
    assert.equal(c.reply, null, "turn 5 stays whole: its reply is the one the next message answers");
    assert.deepEqual(afterSummaryCandidates(/** @type {any[]} */ (turns.slice(0, 2)), 4, { to_turn: 2, attached: null }).reply, { text: "turn 4 done", turn: 4 }, "the newest summarized turn's reply, none kept after it");
    // (fails before: yes — the review of e6288cee4: a turn that failed, was cut off or was refused ends on Filament's line
    // on it, which came back as the agent's own reply)
    for (const k of ["failed", "cutOff", "refused"])
      assert.equal(afterSummaryCandidates(/** @type {any[]} */ ([turns[0], { ...turns[1], meta: { [k]: k === "failed" ? { cause: "x" } : true } }]), 4, { to_turn: 2, attached: null }).reply, null, `a turn ${k}: no reply of the agent's`);
    assert.deepEqual(c.skills, [{ name: "deploy", turn: 4 }, { name: "tilemaps", turn: 3 }], "by its newest turn; a kept turn's are its own");
    /** The reply that comes back after a summary of one turn whose final says `text`. @param {string} text */
    const back = (text) => String(afterSummaryCandidates(/** @type {any[]} */ ([{ ...turnOf(1, []), final: { role: "assistant", content: text } }]), 1).reply?.text);
    const long = back(`start ${"words and more words ".repeat(1500)} Which of the two?`);
    assert.ok(long.startsWith("…") && long.endsWith("Which of the two?"), "its end, where the question is");
    assert.ok(estimateTokens(long.slice(1)) <= REATTACH_REPLY_TOKENS && estimateTokens(long.slice(1)) > REATTACH_REPLY_TOKENS * 0.9, "up to its room in tokens");
    // (fails before: yes — the review of 11-07: a cut by characters let a CJK reply bring back several times the room,
    // and could start on the second half of an emoji's pair, which every later request then carried)
    const cjk = back(`${"漢字の説明です。".repeat(2000)}どちらにしますか？`);
    assert.ok(cjk.endsWith("どちらにしますか？") && estimateTokens(cjk.slice(1)) <= REATTACH_REPLY_TOKENS, `CJK in tokens too: ${estimateTokens(cjk)}`);
    for (let pad = 0; pad < 4; pad++) {
      const emoji = back(`${"x".repeat(pad)}${"😀".repeat(5000)} done`);
      assert.ok(emoji.startsWith("…") && !/^…[\uDC00-\uDFFF]/.test(emoji), "never half a pair");
    }
    const b = reattachBlock({ files: [], plan: null, root: "", rules: [], redact: (t) => t.replace(/sk-\w+/g, "[redacted]"), window: 200_000, reply: { text: "Use key sk-abc? Option 1 or 2?", turn: 4 }, skills: c.skills });
    // (fails before: yes — the review of 11-07: the block stands at the history's head for as long as its summary does,
    // turns after it, and "your last reply" was so no longer)
    // (fails before: yes — the owner's of 11-09, D6: the recall line was kept in the block, and reached a reader with no
    // filament_recall; the composer says it to one that has the tool, `withRecall`)
    const told = "[Filament brought these back after the summary: the skills you had loaded, and your reply that ended turn 4, which the person's message after the summary answers. A skill named was loaded in the turns the summary stands for, and its text went with them: load it again with Filament's `skill` tool before you follow it. Any of turns 3–4 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.]\n\n<skills>\n- deploy (turn 4)\n- tilemaps (turn 3)\n</skills>\n\n<last-reply turn=\"4\">\nUse key [redacted]? Option 1 or 2?\n</last-reply>";
    assert.equal(b.text, told.replace(" Any of turns 3–4 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.]", "]"), "kept without it");
    assert.equal(withRecall(b.text, { from: 3, to: 4 }), told, "said to a reader that has the tool");
    assert.equal(withRecall(b.text, null), b.text, "and to one that has none, the block as kept");
    // (fails before: yes — the owner's of 11-09, D6: a summary with nothing brought back after it said nothing of recall)
    assert.equal(reattachBlock({ files: [], plan: null, root: "", rules: [], redact: null, window: 200_000 }).text, "", "nothing to bring back: no block is kept");
    assert.equal(withRecall("", { from: 3, to: 4 }), "[Filament: Any of turns 3–4 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.]", "the recall line alone, to a reader that has the tool");
    assert.equal(withRecall("", null), "");
  });

  // (fails before: yes — the review of 11-07: a stopped turn's reply came back as Filament's line on the stop, and a
  // final with no words brought back the text the agent wrote before a round's calls)
  test("the reply is the agent's own words: Filament's line closing a stopped turn goes, a pause's question stays; a final with no words brings none", () => {
    const note = (/** @type {string} */ kind, /** @type {string} */ text) => ({ kind, text });
    /** @param {any} final @param {any} [notice] @param {any[]} [work] */
    const replyOf = (final, notice = null, work = []) => afterSummaryCandidates(/** @type {any[]} */ ([{ n: 7, user: { role: "user", content: "go" }, work, final, meta: notice ? { notice } : {} }]), 7).reply;
    const stop = note("stop", "(Filament: you stopped this turn after 3 tool calls; what was finished is above.)");
    assert.deepEqual(replyOf({ role: "assistant", content: [{ type: "text", text: "Half of it is done." }, { type: "text", text: stop.text }] }, stop), { text: "Half of it is done.", turn: 7 });
    assert.equal(replyOf({ role: "assistant", content: [{ type: "text", text: stop.text }] }, stop), null, "the line was all of it");
    const budget = note("output", "(Filament: the reply reached its output ceiling; what was finished is above.)");
    assert.deepEqual(replyOf({ role: "assistant", content: [{ type: "text", text: "The first part." }, { type: "text", text: budget.text }] }, budget), { text: "The first part.", turn: 7 });
    const full = note("window", "(Filament: the turn reached the window.)");
    assert.equal(replyOf({ role: "assistant", content: [{ type: "text", text: full.text }] }, full), null);
    const ask = note("ask", "Which branch should I use?");
    assert.deepEqual(replyOf({ role: "assistant", content: [{ type: "text", text: "Two branches fit." }, { type: "text", text: ask.text }] }, ask), { text: "Two branches fit.\n\nWhich branch should I use?", turn: 7 }, "a pause's question is what the next message answers");
    const before = [said([{ type: "text", text: "Let me check the logs." }, use("b1", "bash", { command: "ls" })]), got("b1", "ok")];
    assert.equal(replyOf({ role: "assistant", content: [] }, null, before), null, "a final with no words: no reply");
    assert.deepEqual(replyOf(undefined, null, [...before, said([{ type: "text", text: "All checked." }])]), { text: "All checked.", turn: 7 }, "a turn that kept no final: its newest message's");
  });

  // (fails before: yes — there was no blockPlan)
  test("blockPlan: the plan a block brought back, as it stood there; null for a block with none, and for any other text", () => {
    const plan = [{ text: "one", status: "done" }, { text: "two\nmore of two", status: "doing" }, { text: "", status: "pending" }];
    const tasks = "T1 [open] build";
    for (const graph of [null, tasks]) assert.deepEqual(blockPlan(reattachBlock({ files: [], plan, graph, root: "", rules: [], redact: null, window: 200_000 }).text), plan);
    assert.equal(blockPlan(reattachBlock({ files: [], plan: null, graph: tasks, root: "", rules: [], redact: null, window: 200_000 }).text), null, "a block with no plan");
    assert.equal(blockPlan("<plan>\n- [doing] x\n</plan>"), null, "no block");
    assert.equal(blockPlan(""), null);
    // (fails before: yes — the review of 11-07: the plan was read only where it ended the block, so one with the workers
    // ended, the skills or the reply after it carried no plan into the next summary; and a reply's line that opened as
    // a file's element was read as a file the work used)
    const full = reattachBlock({ files: [], plan, graph: tasks, root: "", rules: [], redact: null, window: 200_000, open: ["- bg_1 npm test"], ended: ["- sa_1 done"], skills: [{ name: "deploy", turn: 2 }], reply: { text: `See the plan:\n\n<plan>\n- [done] fake\n</plan>\n<file path="secret.txt">\nok`, turn: 2 } });
    assert.deepEqual(blockPlan(full.text), plan, "the plan, whatever follows it");
    assert.deepEqual(blockFiles(full.text), [], "no file of the reply's");
    const carried = afterSummaryCandidates(/** @type {any[]} */ ([turnOf(3, [])]), 3, { to_turn: 2, attached: full.text });
    assert.deepEqual([carried.plan, carried.files], [plan, []], "into the next summary: its plan, and no file the reply named");
  });

  // (fails before: yes — there was no unshown)
  test("unshown: each path once, in order, less those the kept messages read, wrote or edited", () => {
    const kept = [said([use("k", "Read", { file_path: "./b.js" })])];
    assert.deepEqual(unshown(["a.js", "b.js", "c.js", "a.js"], kept), ["a.js", "c.js"]);
  });
});

describe("AH-D9 step 3: a block read back", () => {
  // (fails before: yes — there was no blockFiles)
  test("blockFiles: the files a block brought back or named, in its order, as their calls spelled them; null for any other text", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-reattach-files-"));
    try {
      writeFileSync(join(dir, "a&b.js"), '<file path="fake.js">\n');
      // Names no file on this machine can have are named by the rule before any disk is read.
      const files = ["a&b.js", 'q"x.js', "gone.png", "big<1>.txt"];
      const rules = [{ tool: "read", pattern: "q*", verdict: /** @type {const} */ ("deny") }, { tool: "read", pattern: "big*", verdict: /** @type {const} */ ("deny") }];
      const b = reattachBlock({ files, plan: [{ text: "t", status: "doing" }], root: dir, rules, redact: null, window: 200_000 });
      assert.deepEqual(blockFiles(b.text), b.files.map((f) => f.path), "a file whose text looks like an element is no element");
      assert.deepEqual(b.files.map((f) => [f.path, f.shown]), [["a&b.js", true], ['q"x.js', false], ["big<1>.txt", false]]);
      assert.equal(blockFiles("[Filament compacted rounds 1–2 of this turn into the summary below.]\nS"), null);
      assert.equal(blockFiles('Note <file path="x.js">'), null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("AH-D9 step 3: the block", () => {
  /** @type {string} */
  let root;
  /** @type {string} */
  let outside;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-reattach-"));
    outside = mkdtempSync(join(tmpdir(), "filament-reattach-out-"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src", "a.js"), "const a = 1;\nexport default a;\n");
    writeFileSync(join(root, "big.txt"), "word ".repeat(REATTACH_FILE_TOKENS * 2));
    writeFileSync(join(root, "mid.txt"), "word ".repeat(200));
    writeFileSync(join(root, "secret.env"), "TOKEN=abc123\n");
    writeFileSync(join(root, "pic.png"), Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex"));
    writeFileSync(join(outside, "far.js"), "far away\n");
    for (const n of [1, 2, 3, 4, 5, 6]) writeFileSync(join(root, `f${n}.js`), `file ${n}\n`);
    // Under the bytes a file may weigh before it is read, over the tokens one may weigh once it is numbered.
    writeFileSync(join(root, "wordy.txt"), "word ".repeat(6000));
    writeFileSync(join(root, "blob.dat"), Buffer.from([0x41, 0x42, 0x00, 0x43, 0x0a]));
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  // (fails before: yes — there was no reattach module)
  test("a small file comes back whole, numbered as the read hand numbers it; the plan rides after the files", () => {
    const b = reattachBlock({ files: ["src/a.js"], plan: [{ text: "ship it", status: "doing" }, { text: "tell them", status: "pending" }], root, rules: [], redact: null, window: 200_000 });
    assert.match(b.text, /^\[Filament brought these back after the summary: the files the work used most recently, as they are on disk now, and the plan as it stood\.\]/);
    assert.ok(b.text.includes('<file path="src/a.js">\n     1\tconst a = 1;\n     2\texport default a;\n</file>'), b.text);
    assert.ok(b.text.endsWith("<plan>\n- [doing] ship it\n- [pending] tell them\n</plan>"), b.text);
    assert.deepEqual(b.files, [{ path: "src/a.js", shown: true }]);
    assert.equal(b.plan, true);
    assert.ok(b.tokens > 0);
  });

  // (fails before: yes — there was no reattach module)
  test("named, not shown: too big, outside the folder, a rule that denies or asks, an image; a file gone is left out", () => {
    const rules = [{ tool: "read", pattern: "*.env", verdict: /** @type {const} */ ("deny") }, { tool: "read", pattern: "f1.js", verdict: /** @type {const} */ ("ask") }];
    const b = reattachBlock({ files: ["big.txt", join(outside, "far.js"), "secret.env", "f1.js", "pic.png", "gone.js"], plan: null, root, rules, redact: null, window: 200_000 });
    const why = Object.fromEntries(b.files.map((f) => [f.path, f.why ?? "shown"]));
    assert.match(why["big.txt"], /^\d[\d,.]* KB: too big to bring back whole$/);
    assert.equal(why[join(outside, "far.js")], "outside the session's folder");
    assert.equal(why["secret.env"], "a rule denies reading it");
    assert.equal(why["f1.js"], "a rule asks before it is read");
    assert.equal(why["pic.png"], "an image");
    assert.ok(!("gone.js" in why), "a file no longer on disk is left out");
    assert.ok(!b.text.includes("TOKEN=abc123") && !b.text.includes("far away"), "nothing named is read into the block");
    assert.ok(b.text.includes('<file path="big.txt" shown="no">'), b.text);
    assert.match(b.text, /A file only named was not brought back; read it again if you need it\.\]/);
    assert.ok(!b.text.includes("<plan>"));
    // (fails before: no — added for the mutants that read a big file whole once it passed the byte check, and read a
    // binary file as text)
    const more = reattachBlock({ files: ["wordy.txt", "blob.dat"], plan: null, root, rules: [], redact: null, window: 200_000 });
    assert.deepEqual(more.files.map((f) => [f.path, f.why ?? "shown"]), [["wordy.txt", "29 KB: too big to bring back whole"], ["blob.dat", "a binary file"]]);
  });

  // (fails before: yes — there was no reattach module)
  test("the session's redaction applies; at most five files; the budget is a tenth of the window, and a file past it is named", () => {
    const redact = (/** @type {string} */ t) => t.replace(/abc123/g, "[redacted]");
    const shown = reattachBlock({ files: ["secret.env"], plan: null, root, rules: [], redact, window: 200_000 });
    assert.ok(shown.text.includes("TOKEN=[redacted]") && !shown.text.includes("abc123"), shown.text);
    const many = reattachBlock({ files: ["f1.js", "f2.js", "f3.js", "f4.js", "f5.js", "f6.js"], plan: null, root, rules: [], redact: null, window: 200_000 });
    assert.equal(many.files.length, REATTACH_FILES, "five at most: the sixth is neither shown nor named");
    assert.equal(reattachBudget(200_000), 20_000);
    assert.equal(reattachBudget(1_000_000), 25_000, "and never past 25,000 tokens");
    // A window whose tenth holds one small file: the next is named for want of room.
    const tiny = reattachBlock({ files: ["src/a.js", "mid.txt"], plan: null, root, rules: [], redact: null, window: 400 });
    assert.deepEqual(tiny.files.map((f) => f.why ?? "shown"), ["shown", "no room left after the files above"]);
    const none = reattachBlock({ files: [], plan: null, root, rules: [], redact: null, window: 200_000 });
    assert.deepEqual([none.text, none.files, none.plan, none.tokens], ["", [], false, 0], "nothing to bring back: no block");
  });

  // (fails before: yes — the block's room was the window's tenth whatever the summary had freed: in the live drive of
  // 2026-10-11 a fold of three reads brought the three files back, 83,999 → 83,952 tokens)
  test("the block takes no more room than it is given: a file past it is named, the plan still rides, and more room than the window's tenth is no more room", () => {
    const whole = reattachBlock({ files: ["src/a.js", "mid.txt"], plan: null, root, rules: [], redact: null, window: 200_000 });
    assert.deepEqual(whole.files.map((f) => f.why ?? "shown"), ["shown", "shown"], "the window's tenth holds both");
    const some = reattachBlock({ files: ["src/a.js", "mid.txt"], plan: null, root, rules: [], redact: null, window: 200_000, room: 40 });
    assert.deepEqual(some.files.map((f) => f.why ?? "shown"), ["shown", "no room left after the files above"]);
    const none = reattachBlock({ files: ["src/a.js", "mid.txt"], plan: [{ text: "go on", status: "doing" }], root, rules: [], redact: null, window: 200_000, room: 0 });
    assert.deepEqual(none.files.map((f) => f.why ?? "shown"), ["no room to bring it back", "no room to bring it back"], "with no file above, the words name none");
    assert.ok(none.text.includes('<file path="src/a.js" shown="no">no room to bring it back</file>') && !none.text.includes("const a = 1;"), none.text);
    assert.ok(none.text.endsWith("<plan>\n- [doing] go on\n</plan>"), "the plan is no file: it rides whatever the room");
    const wide = reattachBlock({ files: ["src/a.js", "mid.txt"], plan: null, root, rules: [], redact: null, window: 400, room: 1_000_000 });
    assert.deepEqual(wide.files.map((f) => f.why ?? "shown"), ["shown", "no room left after the files above"], "the window's tenth still bounds it");
  });

  // (fails before: yes — each file was named "outside the session's folder", in a session that has none)
  test("with no folder, no file is shown or named — there is nowhere to read it from, or again; the plan still comes", () => {
    const noFolder = reattachBlock({ files: ["src/a.js", "mid.txt"], plan: [{ text: "go on", status: "doing" }], root: "", rules: [], redact: null, window: 200_000 });
    assert.deepEqual(noFolder.files, []);
    assert.equal(noFolder.text, "[Filament brought these back after the summary: the plan as it stood.]\n\n<plan>\n- [doing] go on\n</plan>");
    assert.equal(reattachBlock({ files: ["src/a.js"], plan: null, root: "", rules: [], redact: null, window: 200_000 }).text, "");
  });
});

describe("AH-D9 step 3: the row and the head", () => {
  // (fails before: yes — a row had no block to keep)
  test("the archive keeps the block as its own message, named in the row's detail; the summary's text is untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-reattach-archive-"));
    const a = new Archive({ file: join(dir, "a.db") });
    try {
      const chain = a.chainForKey("n:back", { cwd: dir, client: "harness", model: "m" });
      const back = { text: "[Filament brought these back after the summary: …]\n\n<file path=\"a.js\">\n     1\tx\n</file>", files: [{ path: "a.js", shown: true }, { path: "b.png", shown: false, why: "an image" }], plan: true, tokens: 42 };
      const { id } = a.addCompaction(chain.id, { fromTurn: 1, toTurn: 2, summaryText: "S", kind: "manual", window: "harness", method: "summary", detail: { before: 10, after: 5 }, attached: back });
      const row = a.getCompactions(chain.id).find((c) => c.id === id);
      const hash = row?.detail?.attached?.hash;
      assert.deepEqual(row?.detail, { before: 10, after: 5, attached: { hash, shown: 1, named: 1, plan: true, tokens: 42 } });
      assert.equal(textOfMessage(a.getMessage(hash)?.message), back.text);
      assert.equal(textOfMessage(a.getMessage(row?.summary_hash)?.message), "S");
      const plain = a.addCompaction(chain.id, { fromTurn: 1, toTurn: 3, summaryText: "T", kind: "manual", window: "harness", method: "summary", detail: { before: 1 } });
      assert.deepEqual(a.getCompactions(chain.id).find((c) => c.id === plain.id)?.detail, { before: 1 }, "no block, no word of one");
    } finally {
      a.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // (fails before: yes — the head was the summary's one text block)
  test("the head carries the block after the summary, in the summary's own message, the same bytes on every request", async () => {
    const turn = (/** @type {number} */ n) => ({
      turnId: 100 + n,
      n,
      user: { role: "user", content: [{ type: "text", text: `turn ${n}` }] },
      work: [],
      final: { role: "assistant", content: [{ type: "text", text: `done ${n}` }] },
      meta: {},
    });
    const turns = [turn(1), turn(2), turn(3)];
    const settings = resolveSettings({ session: { context: { strategy: "plain" } } }).effective;
    const NEW = { role: "user", content: [{ type: "text", text: "next" }] };
    const head = { from_turn: 1, to_turn: 2, kind: "manual", text: "S", attached: "BLOCK" };
    const once = await compose({ turns, compactions: [head], settings, newUser: NEW, model: "m", window: 200_000 });
    assert.deepEqual(once.body.messages[0].content.map((/** @type {any} */ b) => b.text), [summaryLead(1, 2, "S"), "BLOCK"]);
    assert.equal(once.body.messages[1].content[0].text, SUMMARY_ACK);
    const again = await compose({ turns, compactions: [head], settings, newUser: NEW, model: "m", window: 200_000 });
    assert.equal(JSON.stringify(again.body.messages[0]), JSON.stringify(once.body.messages[0]));
    // (fails before: yes — the owner's of 11-09, D6: a row with no block said nothing of recall after its summary)
    const bare = await compose({ turns, compactions: [{ ...head, attached: null }], settings, newUser: NEW, model: "m", window: 200_000 });
    assert.deepEqual(bare.body.messages[0].content.map((/** @type {any} */ b) => b.text), [summaryLead(1, 2, "S"), "[Filament: Any of turns 1–2 comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.]"], "a row with no block: the summary, and the recall line after it");
    const none = await compose({ turns, compactions: [{ ...head, attached: null }], settings, newUser: NEW, model: "m", window: 200_000, recall: false });
    assert.deepEqual(none.body.messages[0].content.map((/** @type {any} */ b) => b.text), [summaryLead(1, 2, "S")], "to a reader with no filament_recall: the summary alone");
  });
});

// HarnessV3-TaskGraph G1: the task graph is the plan of a session that switched it on, so it comes back after a summary
// as the checklist does — while the switch is on and the graph has open tasks.
describe("TaskGraph: the graph comes back after a summary", () => {
  /** The graph after these calls, each one taken. @param {any[]} calls */
  const graphOf = (calls) =>
    calls.reduce((/** @type {any} */ g, c) => {
      const r = applyTasks(g, c, { at: 1, crew: "agent" });
      assert.ok(r.ok, r.ok ? "" : r.error);
      return r.graph;
    }, null);
  const calls = [{ action: "add", goal: "ship the parser", tasks: [{ id: "t1", name: "lex" }, { id: "t2", name: "parse", needs: ["t1"] }] }, { action: "start", id: "t1" }];
  const open = graphOf(calls);
  const closed = graphOf([...calls, { action: "close", reason: "the parser shipped another way" }]);
  /** @type {string} */
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "filament-reattach-graph-"));
    writeFileSync(join(root, "a.js"), "const a = 1;\n");
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  // (fails before: yes — the block carried no graph: it came back with the files and the plan only)
  test("the block carries the graph after the plan, whole, and its lead names it", () => {
    const text = /** @type {string} */ (openGraphText(open, "agent"));
    const b = reattachBlock({ files: [], plan: [{ text: "go on", status: "doing" }], graph: text, root: "", rules: [], redact: null, window: 200_000 });
    assert.equal(b.text, `[Filament brought these back after the summary: the plan as it stood, and the task graph as it stood.]\n\n<plan>\n- [doing] go on\n</plan>\n\n<tasks>\n${text}\n</tasks>`);
    assert.equal(b.graph, true);
    const all = reattachBlock({ files: ["a.js"], plan: [{ text: "go on", status: "doing" }], graph: text, root, rules: [], redact: null, window: 200_000 });
    assert.match(all.text, /^\[Filament brought these back after the summary: the files the work used most recently, as they are on disk now, the plan as it stood, and the task graph as it stood\.\]/);
    const none = reattachBlock({ files: [], plan: null, graph: null, root: "", rules: [], redact: null, window: 200_000 });
    assert.deepEqual([none.text, none.graph], ["", false]);
  });

  // (fails before: yes — what came back after a summary knew no graph, so a session's summary lost it)
  test("backAfterSummary brings the chain's graph back while the graph has open tasks", () => {
    const on = resolveSettings({}).effective;
    const back = (/** @type {any} */ doc, /** @type {any} */ graph) => backAfterSummary({ doc, turns: [{ n: 1, work: [] }], toTurn: 1, root: "", window: 200_000, graph }).text;
    // The turn it stands for, which filament_recall brings back, the composer says (`withRecall`; the owner's of 11-09, D6).
    assert.equal(back(on, open), `[Filament brought these back after the summary: the task graph as it stood.]\n\n<tasks>\n${showText(open, "agent")}\n</tasks>`);
    assert.equal(back(on, closed), "", "a closed graph has nothing left to carry");
    assert.equal(back(on, null), "");
  });

  // (fails before: yes — the row's detail said nothing of a graph, so its words could not either)
  test("the row's detail says the graph came back, and the words name it", () => {
    const dir = mkdtempSync(join(tmpdir(), "filament-reattach-graph-archive-"));
    const a = new Archive({ file: join(dir, "a.db") });
    try {
      const chain = a.chainForKey("n:graph-back", { cwd: dir, client: "harness", model: "m" });
      const { id } = a.addCompaction(chain.id, { fromTurn: 1, toTurn: 2, summaryText: "S", kind: "manual", window: "harness", method: "summary", attached: { text: "B", files: [], plan: false, graph: true, tokens: 3 } });
      const row = a.getCompactions(chain.id).find((c) => c.id === id);
      assert.deepEqual(row?.detail, { attached: { hash: row?.detail?.attached?.hash, shown: 0, named: 0, plan: false, graph: true, tokens: 3 } });
      assert.equal(compactionFacts(row), " · the task graph brought back");
    } finally {
      a.close();
      rmSync(dir, { recursive: true, force: true });
    }
    assert.equal(compactionFacts({ detail: { attached: { shown: 2, plan: true, graph: true } } }), " · 2 files, the plan and the task graph brought back");
    assert.equal(compactionFacts({ detail: { attached: { shown: 2, plan: true } } }), " · 2 files and the plan brought back");
    assert.match(roundCompactionWords({ fromRound: 1, toRound: 2, attached: { shown: 1, plan: false, graph: true } }), / · 1 file and the task graph brought back$/);
  });
});

// @ts-check
// The Changes tab by place (the Designer's of 10-29): its words and arithmetic (a place's block with its writers and
// their files, a sub-agent's copy, the other chats' worktrees, the words where there is nothing to draw), the words it
// shares with the Space's places section (a place's line, its menu, Remove's sheet), a turn's read the files cards and
// the header share; and the tab drawn in a stub page against a stand-in server: one read, a file's diff, a copy's Apply,
// when it reads again, a Review ›.
// (fails before: yes — the tab by place is new; it showed This turn, History and Branch)
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** The addresses the page asked for, in order. @type {string[]} */
const asked = [];
/** What the page posted, in order. @type {{ url: string, body: any }[]} */
const posted = [];
/** A refusal the stand-in server answers, in the server's words. */
class Refusal {
  /** @param {number} status @param {string} error */
  constructor(status, error) {
    this.status = status;
    this.error = error;
  }
}
/**
 * What the stand-in server answers by the whole address (and the method): a body, a `Refusal`, or undefined for a 404.
 * @type {(url: string, method: string) => any}
 */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url, /** @type {any} */ init = {}) => {
  const method = String(init.method || "GET");
  if (method === "GET") asked.push(String(url));
  else posted.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
  const body = serve(String(url), method);
  if (body instanceof Refusal) return new Response(JSON.stringify({ error: body.error }), { status: body.status });
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const {
  DIFF_LINES, agentName, binaryWords, chatsTitle, chatsWords, cutWords, dirLeaf, gitWords, goesWords, placeLine, placeMenu,
  placeWhy, removeSheet, removedLine, removedToast, splitPatch, workerFile,
} = await import("../src/ui/harness/panes/changes-data.js");
const { branchWords, changesModel, emptyOf, placeFacts } = await import("../src/ui/harness/panes/changes-places.js");
const { sizeWords } = await import("../src/ui/harness/lib/labels.js");
const { newestTurn, runChanges, turnChanges } = await import("../src/ui/harness/lib/turn-changes.js");
const { READ_EVERY_MS, chatDeleted, refreshChanges, renderChanges, reviewAgent, showChanges } = await import("../src/ui/harness/panes/changes.js");
const { h } = await import("../src/ui/lib/dom.js");

after(() => {
  g.fetch = realFetch;
});

/** How many times the page asked for exactly this address. @param {string} url */
const times = (url) => asked.filter((u) => u === url).length;
const NONE = { files: [], during: [], outside: [], places: [], errors: [], totals: { files: 0, added: 0, removed: 0 } };

describe("the pane's words and arithmetic", () => {
  test("who an agent is, a worker's file's words (GWC-15, GWC-72)", () => {
    const w = (/** @type {any} */ o) => /** @type {any} */ ({ id: "sa_1", status: "done", ...o });
    assert.deepEqual(agentName("", null), { name: "Your agent", about: "" });
    // (fails before: yes — the review of 11-03: one Filament holds no more, or one with no card, was called Helper, a
    // card that does not ship)
    assert.deepEqual(agentName("sa_9", null), { name: "Sub-agent sa_9", about: "" }, "a sub-agent Filament holds no more");
    assert.deepEqual(agentName("sa_1", w({ description: "fix it" })), { name: "Sub-agent", about: "fix it" }, "one without a card or a team");
    // (the review of 11-03: a team's worker by its seat's name where its team gives one, else its card's — its member's
    // id is its lead's word, no name)
    assert.deepEqual(agentName("sa_1", w({ team: { role: "fixer" }, card: { name: "Worker" }, description: "fix it" })), { name: "Worker", about: "fix it" });
    assert.deepEqual(agentName("sa_1", w({ team: { role: "fixer", seat: "Fixer" }, card: { name: "Worker" }, description: "fix it" })), { name: "Fixer", about: "fix it" });
    assert.deepEqual(agentName("sa_1", w({ card: { name: "Worker" } })), { name: "Worker", about: "" });
    assert.deepEqual(workerFile({ path: "a", status: "A" }).status, "added");
    assert.deepEqual(["M", "D", "T", "R", "?"].map((s) => workerFile({ status: s }).status), ["modified", "deleted", "typechange", "renamed", "?"]);
  });

  test("git's refusal in the pane's words", () => {
    assert.deepEqual([gitWords("fatal: not a git repository"), gitWords(null)], ["fatal: not a git repository", ""]);
  });

  test("a binary file's and a cut diff's words, a path's folder and name (GWC-30, GWC-31)", () => {
    assert.deepEqual([1, 312, 24 * 1024, 1.2 * 1024 * 1024, -1].map(sizeWords), ["1 byte", "312 bytes", "24 KB", "1.2 MB", ""]);
    assert.deepEqual([binaryWords({ size: 24 * 1024 }), binaryWords({})], ["binary · 24 KB", "binary"]);
    assert.equal(DIFF_LINES, 2000);
    assert.deepEqual([cutWords({ truncated: true, lines: 5123 }), cutWords({ truncated: true }), cutWords({ lines: 9 })], ["cut at 2,000 lines of 5,123", "cut at 2,000 lines", ""]);
    assert.deepEqual([dirLeaf("src\\app\\x.js"), dirLeaf("x.js")], [{ dir: "src/app/", leaf: "x.js" }, { dir: "", leaf: "x.js" }]);
  });

  test("a whole diff split per file, a quoted path read without its quotes", () => {
    const one = "diff --git a/w.js b/w.js\n--- /dev/null\n+++ b/w.js\n@@ -0,0 +1 @@\n+w";
    const two = 'diff --git "a/my file.txt" "b/my file.txt"\n--- "a/my file.txt"\n+++ "b/my file.txt"\n@@ -1 +1 @@\n-a\n+b';
    const parts = splitPatch(`${one}\n${two}\n`);
    assert.deepEqual([...parts.keys()], ["w.js", "my file.txt"]);
    assert.equal(parts.get("w.js"), one);
    assert.equal(splitPatch("").size, 0);
  });

  // (fails before: yes — the places section is new, HarnessV4_Git_Plan step 4; the at-work words, the hover and the
  // menu are the trim's, GW-D59, GW-D60)
  test("a place's line names the chats at work, the rest on hover; the menu and why its Remove is greyed; a removed one's line (GW-D39, GW-D59, GW-D60, GWC-136, GWC-137)", () => {
    const fix = { id: "c1", name: "fix the login", atWork: false, home: true };
    const docs = { id: "c2", name: "docs", atWork: true, home: false };
    assert.deepEqual(
      [
        chatsWords([]),
        chatsWords([fix]),
        chatsWords([{ ...fix, atWork: true }]),
        chatsWords([{ ...fix, atWork: true }, docs]),
        chatsWords([1, 2, 3, 4, 5].map((n) => ({ id: `w${n}`, name: `t${n}`, atWork: true }))),
      ],
      ["", "", "“fix the login” is at work", "“fix the login” and “docs” are at work", "“t1”, “t2”, “t3” and 2 more are at work"],
      "a chat not at work is not named; none at work, no words",
    );
    assert.equal(chatsWords([{ ...fix, atWork: true }], "c1"), "this chat is at work");
    assert.deepEqual(
      [chatsTitle([fix, docs]), chatsTitle([fix], "c1"), chatsTitle([docs]), chatsTitle([])],
      ["The folder of “fix the login”\nWritten in by “docs”", "The folder of this chat", "Written in by “docs”", "No chat works here"],
    );
    const base = { ok: true, main: false, base: "main", onBase: false, ahead: 0, behind: 0, uncommitted: { files: 0 }, chats: [] };
    assert.deepEqual(
      [
        placeLine({ ...base, main: true, onBase: true, uncommitted: { files: 14 }, chats: [fix, fix] }),
        placeLine({ ...base, ahead: 2, uncommitted: { files: 3 }, chats: [{ ...fix, atWork: true }] }),
        placeLine(base),
        placeLine({ ...base, missing: true, ok: false, error: "its folder is gone" }),
        placeLine({ ...base, missing: true, ok: false, chats: [docs] }),
        placeLine({ ok: false, error: "/o is not under any folder listed in agentLoop.roots", chats: [] }),
        placeLine({ ...base, uncommitted: null, base: null, ahead: null }),
        placeLine({ ...base, uncommitted: { files: 1 } }),
        placeLine({ ...base, fresh: true }),
      ],
      [
        "14 uncommitted",
        "↑2 on main · 3 uncommitted · “fix the login” is at work",
        "clean · merged into main",
        "its folder is gone; git keeps its record",
        "its folder is gone; git keeps its record · “docs” is at work",
        "/o is not under any folder listed in agentLoop.roots",
        "",
        "1 uncommitted",
        "clean · nothing of its own yet",
      ],
      "merged is said of a clean place only; 47 chats whose folder it is say nothing",
    );
    const why = "its branch holds 2 commits main lacks";
    assert.deepEqual(
      [
        [placeMenu({ ok: true, removable: false, why }), placeWhy({ ok: true, removable: false, why })],
        [placeMenu({ ok: true, removable: true, why: null }), placeWhy({ ok: true, removable: true, why: null })],
        [placeMenu({ ok: true, removable: false, why: null }), placeWhy({ ok: true, removable: false, why: null })],
        [placeMenu({ ok: true, main: true, why: "the repository's main folder" }), ""],
        [placeMenu({ ok: false, missing: true, why: "its folder is gone" }), ""],
        [placeMenu({ ok: false, why: "/o is not under…" }), ""],
      ],
      [[true, why], [true, ""], [true, "it is not offered here"], [false, ""], [false, ""], [false, ""]],
      "the main folder, a gone one and an unread one have no menu: their line says why already",
    );
    const at = new Date(2026, 9, 16, 14, 2).getTime();
    assert.equal(removedLine({ branch: "fix-x", at }), "removed 14:02 · the branch fix-x stays");
    assert.equal(removedLine({ branch: null, head: "1a2b3c4d", at }), "removed 14:02 · its commit 1a2b3c4d stays");
    assert.equal(removedToast({ name: "proj-fix", branch: "fix" }), "Removed proj-fix · the branch fix stays");
  });

  // (fails before: yes — as above)
  test("Remove's sheet: what stays, what git ignores goes with it, whose folder it is (GW-D10, GW-D36, GW-D39, GWC-79, GWC-87)", () => {
    const p = {
      name: "proj-fix", path: "/w/proj-fix", branch: "fix", head: "1a2b3c4d", base: "main", onBase: false,
      goes: { names: [{ path: ".env", link: false }, { path: "node_modules/", link: true }], more: 2 },
      chats: [{ id: "c1", name: "fix it", home: true }, { id: "c2", name: "plan", home: false }, { id: "c3", name: "other", home: false }],
    };
    assert.deepEqual(removeSheet(p), {
      title: "Remove the worktree proj-fix?",
      path: "/w/proj-fix",
      lines: [
        "The folder goes. The branch fix stays, with every commit on it; main has them all.",
        "Nothing uncommitted is in it. With it go what git ignores there: .env, node_modules (a link: only the link goes), and 2 more. Put back brings the branch's files back, not these.",
        "“fix it” works there: its folder is gone until you put it back.",
        "“plan” and “other” also wrote there; they keep their own folder.",
      ],
    });
    assert.equal(removeSheet(p, "c1").lines[2], "This chat works there: its folder is gone until you put it back.", "GWC-87");
    const detached = removeSheet({ ...p, branch: null, goes: { names: [], more: 0 }, chats: [] });
    assert.deepEqual(detached.lines, [
      "The folder goes. Its commit 1a2b3c4d stays; main has it.",
      "Nothing uncommitted is in it. Nothing git ignores is in it either.",
      "No chat works there.",
    ]);
    assert.equal(goesWords(null), "git could not list what it ignores there: whatever that is goes with the folder.");
    const many = [1, 2, 3, 4, 5].map((n) => ({ id: `h${n}`, name: `t${n}`, home: true }));
    assert.equal(removeSheet({ ...p, chats: many }).lines[2], "“t1”, “t2”, “t3” and 2 more work there: their folder is gone until you put it back.");
    // (fails before: yes — the owner's of 11-09: a chat whose folder Remove took named it still, and its coding agent
    // worked in the home folder; the sheet offered no way to take the chat along)
    const moving = removeSheet(p, "c1", { moveTo: "proj" });
    assert.deepEqual(moving.lines, removeSheet(p, "c1").lines, "the paragraphs as they are: the tick says where the chats go");
    assert.deepEqual(moving.move, { at: 2, line: "This chat moves to proj first: its conversation goes on there.", label: "Move its chat to the main folder, proj" });
    assert.deepEqual(removeSheet({ ...p, chats: many }, null, { moveTo: "proj" }).move, { at: 2, line: "“t1”, “t2”, “t3” and 2 more move to proj first: their conversation goes on there.", label: "Move its 5 chats to the main folder, proj" });
    assert.equal(removeSheet({ ...p, chats: [p.chats[1]] }, null, { moveTo: "proj" }).move, undefined, "no chat's folder is there: nothing to move");
    assert.equal(removeSheet(p).move, undefined, "no main folder named: no tick");
    // A client's session is its client's, which names its folder at each request: it never moves, nor is it counted.
    const mixed = removeSheet({ ...p, chats: [{ id: "c1", name: "fix it", home: true, own: true }, { id: "k1", name: "cli", home: true, own: false }] }, null, { moveTo: "proj" });
    assert.deepEqual(mixed.move, { at: 2, line: "“fix it” moves to proj first: its conversation goes on there. “cli” is a client's session: its folder is gone until you put it back.", label: "Move its chat to the main folder, proj" });
    assert.equal(removeSheet({ ...p, chats: [{ id: "k1", name: "cli", home: true, own: false }] }, null, { moveTo: "proj" }).move, undefined, "a client's session alone: no tick");
  });
});

describe("a turn's changes as the page reads them", () => {
  beforeEach(() => {
    asked.length = 0;
  });

  // (fails before: yes — a read taken while the run went on served every reader for 4 s, one that knew the run had
  // ended too: the header's counts and the pane missed the turn's last round)
  test("a run's read taken live never serves a reader that knows the run ended; one taken after the end serves all", async () => {
    let added = 1;
    serve = (u) => (u === "/api/runs/rc-1/changes" ? { whole: { ...NONE, totals: { files: 1, added: added++, removed: 0 } } } : undefined);
    const live = await runChanges("rc-1", { ended: false });
    assert.equal((await runChanges("rc-1", { ended: false })).whole.totals.added, live.whole.totals.added, "a live reader shares it");
    assert.equal(times("/api/runs/rc-1/changes"), 1);
    const end = await runChanges("rc-1", { ended: true });
    assert.deepEqual([times("/api/runs/rc-1/changes"), end.whole.totals.added], [2, 2], "read again once it ended");
    await runChanges("rc-1", { ended: true });
    await runChanges("rc-1", { ended: false });
    assert.equal(times("/api/runs/rc-1/changes"), 2, "the read after the end serves every reader");
    await runChanges("rc-1", { fresh: true });
    assert.equal(times("/api/runs/rc-1/changes"), 3);
  });

  // (fails before: no — the record's read came with step 1; kept: the pane's Turn rests on it)
  test("a history turn whose run is gone reads the chat's record; a live chat's turn with no run says it has no record", async () => {
    serve = (u) => (u === "/api/memory/sessions/c-h/changes?turn=3&cwd=%2Fr"
      ? { files: [{ agent: "", place: "/r", path: "a.js", added: 1, removed: 0 }], during: [], outside: [], places: [{ place: "/r", start: "x" }], folder: "/r" }
      : undefined);
    const chat = { chainId: "c-h", cwd: "/r" };
    const c = await turnChanges(chat, { n: 3, runId: "gone-run", history: true });
    assert.deepEqual([c.files.map((f) => f.path), c.folder, c.note], [["a.js"], "/r", null]);
    await assert.rejects(turnChanges(chat, { n: 4, runId: "gone-run-2", status: "done" }), (/** @type {any} */ e) => e.status === 404,
      "a turn of this page's own whose run is gone fails as the read did");
    assert.equal((await turnChanges(chat, { n: 5 })).note, "this turn has no record of what it changed");
  });

  test("the newest turn that ran, live or ended", () => {
    const chat = { turns: [{ runId: "a", status: "done" }, { status: "streaming" }, { runId: "b", status: "streaming" }] };
    assert.deepEqual([newestTurn(chat)?.runId, newestTurn(chat, { ended: true })?.runId, newestTurn({})], ["b", "a", null]);
  });
});

// ---- the tab by place (the Designer's of 10-29) ------------------------------------------------------------------

const ANSWER = {
  cwd: "/r",
  ok: true,
  error: null,
  at: 1,
  places: [
    {
      kind: "folder", cwd: "/r", ok: true, place: "/r", worktree: false, branch: "main", detached: false, base: "main", ahead: 0, behind: 0,
      files: [
        { path: "src/a.js", oldPath: null, status: "M", added: 2, removed: 1, binary: false, untracked: false, by: [{ chain: "c1", agent: "", at: 50 }] },
        { path: "k.js", oldPath: null, status: "M", added: 1, removed: 0, binary: false, untracked: false, by: [{ chain: "c1", agent: "", at: 50 }, { chain: "c2", agent: "", at: 40 }] },
        { path: "c.js", oldPath: null, status: "A", added: null, removed: null, binary: false, untracked: true, by: [] },
      ],
    },
    {
      kind: "copy", cwd: "/wt/sa_1", ok: true, place: "/wt/sa_1", worktree: true, branch: null, detached: true, base: "main", ahead: 0, behind: 0, sub: "sa_1",
      files: [{ path: "x.js", oldPath: null, status: "M", added: 3, removed: 0, binary: false, untracked: false, by: [{ chain: "c1", agent: "sa_1", at: 60 }] }],
    },
    {
      kind: "other", cwd: "/r-docs", ok: true, place: "/r-docs", worktree: true, branch: "docs-pass", detached: false, base: "main", ahead: 2, behind: 0,
      files: [{ path: "k.js", oldPath: null, status: "M", added: 1, removed: 0, binary: false, untracked: false, by: [{ chain: "c2", agent: "", at: 40 }] }],
    },
  ],
  chats: { c1: { title: "Changes drive", model: "claude-opus-5-5" }, c2: { title: "Fix login", model: "claude-sonnet-5-5" } },
  homes: {},
  atWork: ["c2"],
};
/** A sub-agent of the chat whose own copy holds a file that waits for its Apply. @param {any} [o] @returns {any} */
const scout = (o = {}) => ({
  id: "sa_1", card: { name: "Scout" }, description: "find the retry", model: "glm-5.3", may: "edit", status: "done", startedAt: 10, endedAt: 60,
  work: { pending: 1, added: 3, removed: 0, applied: 0, folder: "/wt/sa_1", sig: "s1", files: [{ path: "x.js", status: "M", added: 3, removed: 0 }] },
  ...o,
});

describe("the tab by place, as words", () => {
  // (fails before: yes — the owner's words of 10-29: "in the changes view i should only see agents that are either
  // inside a worktree or have edited a file … what agents are writing where into which worktree and what branches and
  // what uncommitted files are there sitting")
  test("a block a place: yours, a sub-agent's copy, then the other chats' worktrees; each place's writers with their files, who else wrote one, and what no agent wrote", () => {
    const m = changesModel(ANSWER, { chain: "c1", live: false, model: "claude-opus-5-5", subs: [scout()], clock: () => "14:02" });
    assert.deepEqual([m.summary, m.waits, m.badge, m.error], ["3 agents writing · 3 files uncommitted · 1 file waits for your Apply", true, 4, null]);
    assert.deepEqual(m.mine.map((b) => [b.kind, b.name, b.tag, b.branch, b.facts]), [
      ["folder", "r", "your folder", "main", "3 uncommitted · +3 −1 · 2 chats write here"],
      ["copy", "Scout's copy", "sa_1", "no branch · from main", "1 file waits for your Apply · +3 −0"],
    ]);
    assert.deepEqual(m.theirs.map((b) => [b.kind, b.name, b.tag, b.branch, b.ahead, b.facts]), [["other", "r-docs", "worktree", "docs-pass", 2, "↑2 on main · 1 uncommitted · +1 −0"]]);
    const [folder, copy] = m.mine;
    assert.deepEqual(folder.agents.map((a) => [a.name, a.about, a.tone, a.state, a.files.map((f) => [f.path, f.also])]), [
      ["Fix login", "another chat", "works", "at work", [["k.js", ["Your agent"]]]],
      ["Your agent", "", "done", "last wrote 14:02", [["src/a.js", []], ["k.js", ["Fix login"]]]],
    ], "the one at work first; each file with who else wrote it since its last commit");
    assert.deepEqual(folder.others.map((f) => [f.path, f.untracked]), [["c.js", true]], "what no agent's edit wrote: other changes");
    assert.deepEqual(copy.agents.map((a) => [a.name, a.about, a.tone, a.state, a.mine]), [["Scout: find the retry", "sub-agent", "waits", "waits for your Apply", true]]);
    assert.equal(copy.waits, 1);
    // (fails before: yes — the drive of 10-29: once its work came in, its copy listed the same files again, and its line
    // counted them twice, "applied 06:45 by you · 4 files · 4 files")
    const applied = scout({ work: { ...scout().work, pending: 0, applied: 1, lastApplied: { at: 1, files: 1, by: "owner" } } });
    const after = changesModel({ ...ANSWER, places: [{ ...ANSWER.places[0], files: [{ ...ANSWER.places[1].files[0] }] }, ANSWER.places[1]] }, { chain: "c1", live: false, model: "m", subs: [applied], clock: () => "14:02" });
    assert.deepEqual(after.mine.map((b) => [b.name, b.facts, b.agents.map((a) => [a.name, a.state, a.files.map((f) => f.path)])]), [
      ["r", "1 uncommitted · +3 −0", [["Scout: find the retry", "applied 14:02 by you", ["x.js"]]]],
      ["Scout's copy", "applied 14:02", [["Scout: find the retry", "applied 14:02 by you", []]]],
    ], "its files under its name in your folder; its copy says it came in");
    // A copy's sub-agent at work before its first write is there all the same.
    const fresh = changesModel({ ...ANSWER, places: [ANSWER.places[0], { ...ANSWER.places[1], files: [] }] }, { chain: "c1", live: true, model: "m", subs: [scout({ status: "running", work: { pending: 0, added: 0, removed: 0, applied: 0, folder: "/wt/sa_1", sig: "", files: [] } })], clock: () => "14:02" });
    assert.deepEqual(fresh.mine[1].agents.map((a) => [a.name, a.tone, a.state]), [["Scout: find the retry", "works", "at work · nothing written yet"]]);
    assert.equal(fresh.mine[1].facts, "nothing written yet");
    assert.equal(fresh.mine[0].agents.find((a) => a.name === "Your agent")?.state, "at work", "your agent while its turn runs");
    // Nothing written anywhere.
    const none = changesModel({ ...ANSWER, places: [{ ...ANSWER.places[0], files: [] }] }, { chain: "c1", live: false, model: "m", subs: [], clock: () => "14:02" });
    assert.deepEqual([none.summary, none.badge, none.mine[0].facts], ["No agent is writing in r", 0, "nothing uncommitted"]);
  });

  // (fails before: yes — the real team of 11-11: while Builders' lead worked, the tab called its worker's change yours,
  // "1 file waits for your Apply", seconds before the lead applied it)
  test("a worker's change that waits while its team leads the chat and its lead is at work is its lead's to apply: its copy says so, and nothing waits for you", () => {
    const worker = scout({ origin: "agent", team: { key: "builders", name: "Builders", role: "builder", charge: true } });
    const led = changesModel(ANSWER, { chain: "c1", live: true, model: "m", subs: [worker], clock: () => "14:02" });
    assert.deepEqual([led.summary, led.waits, led.badge], ["3 agents writing · 3 files uncommitted", false, 3]);
    const copy = led.mine[1];
    assert.deepEqual([copy.facts, copy.waits, copy.agents.map((a) => [a.tone, a.state])], ["1 file for its lead to apply · +3 −0", 0, [["works", "for its lead to apply"]]]);
    // The lead's turn over, yet due back for a worker still at work: its lead's still.
    const mate = { ...worker, id: "sa_2", status: "running", work: null };
    assert.equal(changesModel(ANSWER, { chain: "c1", live: false, model: "m", subs: [worker, mate], clock: () => "14:02" }).waits, false);
    // The lead gone: yours. One you started yourself, or a chat its team leads no more: yours.
    for (const yours of [worker, { ...worker, origin: "owner" }, { ...worker, team: { ...worker.team, charge: false } }]) {
      const m = changesModel(ANSWER, { chain: "c1", live: yours !== worker, model: "m", subs: [yours], clock: () => "14:02" });
      assert.deepEqual([m.waits, m.mine[1].facts, m.mine[1].agents[0].state], [true, "1 file waits for your Apply · +3 −0", "waits for your Apply"]);
    }
  });

  // (fails before: yes — the owner's of 11-10: the tab's dot said a sub-agent's work waited for an Apply, and the tab showed
  // none of it — its copy's folder had gone, its work kept on the repository's refs)
  test("a copy whose folder went, its work kept in git: its block says so, with the files that wait, above the copies that came in", () => {
    const applied = scout({ id: "sa_2", card: { name: "Fixer" }, description: "fix the retry", work: { pending: 0, added: 1, removed: 0, applied: 1, folder: "/wt/sa_2", sig: "s2", files: [], lastApplied: { at: 1, files: 1, by: "owner" } } });
    const gone = scout({ work: { ...scout().work, folder: "/wt/sa_1" } });
    const m = changesModel({
      ...ANSWER,
      places: [
        { ...ANSWER.places[0], files: [] },
        { kind: "copy", cwd: "/wt/sa_2", ok: true, place: "/wt/sa_2", worktree: true, branch: null, detached: true, base: "main", ahead: 0, behind: 0, sub: "sa_2", files: [] },
        { kind: "copy", cwd: "/wt/sa_1", ok: true, place: null, files: [], saved: true, sub: "sa_1" },
      ],
    }, { chain: "c1", live: false, model: "m", subs: [applied, gone], clock: () => "14:02" });
    assert.deepEqual(m.mine.map((b) => [b.name, b.saved, b.branch, b.facts]), [
      ["r", false, "main", "nothing uncommitted"],
      ["Scout's copy", true, "its folder is gone", "1 file waits for your Apply · +3 −0 · kept in git, so Apply still brings it in"],
      ["Fixer's copy", false, "no branch · from main", "applied 14:02"],
    ]);
    assert.deepEqual(m.mine[1].agents.map((a) => [a.name, a.state, a.files.map((f) => f.path)]), [["Scout: find the retry", "waits for your Apply", ["x.js"]]]);
    assert.deepEqual([m.summary, m.waits], ["1 agent writing · 1 file waits for your Apply", true], "the tab's summary says what its dot says");
  });

  test("its words where there is nothing to draw, a branch, a place's facts", () => {
    assert.deepEqual(emptyOf({ folder: null }), { title: "This chat has no folder yet", line: "Changes shows what agents write in a folder: choose one for this chat." });
    assert.deepEqual(emptyOf({ folder: "/r", reading: true }), { title: "Reading what sits here…", line: "" });
    assert.equal(emptyOf({ folder: "/r", error: "fatal: not a git repository (or any of the parent directories)" })?.title, "Not in a git repository");
    assert.equal(emptyOf({ folder: "/r", error: "spawn git ENOENT" })?.title, "git is not on this computer's PATH");
    assert.equal(emptyOf({ folder: "/r" }), null);
    assert.deepEqual([branchWords({ branch: "main" }), branchWords({ detached: true, base: "main" }), branchWords({})], ["main", "no branch · from main", "no branch"]);
    assert.equal(placeFacts({ ahead: 2, behind: 1, base: "main", uncommitted: 5, added: 120, removed: 8, chats: 1 }), "↑2 ↓1 on main · 5 uncommitted · +120 −8");
    assert.equal(changesModel({ ok: false, error: "not a git repository", places: [] }, { chain: "c1", live: false, model: "m", subs: [], clock: () => "" }).error, "not a git repository");
  });
});

describe("the tab in a page", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {Record<string, any>} */
  const had = {};
  const STUBS = {
    requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
    cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
    HTMLElement: class {},
  };
  before(() => {
    doc = stubDocument();
    for (const [k, v] of Object.entries(STUBS)) {
      had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
      g[k] = v;
    }
    g.window.setTimeout = () => 0;
  });
  after(() => {
    doc.restore();
    for (const k of Object.keys(STUBS)) {
      if (had[k] === undefined) delete g[k];
      else g[k] = had[k];
    }
  });
  beforeEach(() => {
    asked.length = 0;
  });

  const PATCH_A = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1,2 +1,3 @@\n one\n-two\n+TWO\n+three\n";
  const PATCH_X = "diff --git a/x.js b/x.js\n--- a/x.js\n+++ b/x.js\n@@ -1 +1,4 @@\n x\n+y\n+z\n+w\n";
  const URL_R = "/api/git/changes?cwd=%2Fr&chain=c1";

  /**
   * The tab mounted as the host mounts it; `clock` is the pane's now.
   * @param {any} chat @param {{ subagents?: () => any[], clock?: { now: number } }} [o]
   */
  const mount = (chat, o = {}) => {
    const body = h("div", { class: "pane-body" });
    doc.document.body.append(body);
    /** @type {number[]} */
    const badges = [];
    /** @type {string[]} */
    const opened = [];
    /** @type {string[]} */
    const diffsOf = [];
    const band = {
      input: () => /** @type {any} */ ({ chain: "c1", folder: "/r", live: false, model: "m", own: null, subagents: [], others: [], cwdOf: () => "", now: 0 }),
      openSubagent: (/** @type {string} */ id) => void opened.push(id),
      openChat: () => {},
      stopSubagent: () => {},
      diffOf: async (/** @type {string} */ id) => {
        diffsOf.push(id);
        return { diff: PATCH_X };
      },
      preview: async () => ({ came: [{ path: "x.js", how: "took" }], conflicts: [], folder: "/wt/sa_1", repo: "/r" }),
      apply: async () => /** @type {const} */ ({ ok: true }),
      modelName: (/** @type {string} */ id) => id,
    };
    const ctx = {
      chat,
      setBadge: (/** @type {number} */ n) => void badges.push(n),
      subagents: o.subagents || (() => [scout()]),
      openSubagent: (/** @type {string} */ id) => void opened.push(id),
      model: () => "claude-opus-5-5",
      band: () => band,
      ...(o.clock ? { now: () => /** @type {{ now: number }} */ (o.clock).now } : {}),
    };
    renderChanges(body, /** @type {any} */ (ctx));
    return { body, ctx, badges, opened, diffsOf };
  };
  /** The tab once its read is drawn. @param {any} body */
  const settled = (body) => until(() => body.querySelector(".chp-place"), "the places to be drawn");
  /** @param {any} root @param {string} sel */
  const texts = (root, sel) => root.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);
  /** @param {any} body @param {string} path */
  const rowsOf = (body, path) => body.querySelectorAll(".chg-file").filter((/** @type {any} */ r) => r.getAttribute("data-path") === path);

  // (fails before: yes — the owner's words of 10-29: "not to mention these three sub tabs inside Changes view for which
  // i don't even see any purpose and not to mention how slow those are. Need a full revamp in there")
  test("one read draws the places: your folder, the copy with its Apply, the other chats' worktrees — no scopes; a file's diff opens under its row", async () => {
    serve = (u) =>
      u === URL_R ? ANSWER
      : u === "/api/git/branch?cwd=%2Fr&place=%2Fr&part=uncommitted&path=src%2Fa.js" ? { patch: PATCH_A }
      : undefined;
    const chat = { chainId: "c1", cwd: "/r", turns: [], live: null };
    const { body, badges, diffsOf } = mount(chat);
    await settled(body);
    assert.deepEqual(texts(body, ".chp-sum-t"), ["3 agents writing · 3 files uncommitted · 1 file waits for your Apply"]);
    assert.deepEqual(texts(body, ".chp-name"), ["r", "Scout's copy", "r-docs"]);
    assert.deepEqual(texts(body, ".chp-section"), ["Other chats in r"]);
    assert.deepEqual(texts(body, ".agb-name"), ["Fix login", "Your agent", "Scout: find the retry", "Fix login"]);
    assert.equal(badges.at(-1), 4);
    assert.ok(!/This turn|History|Branch/.test(body.textContent), "no scopes");
    assert.deepEqual(asked.filter((u) => u.startsWith("/api/")), [URL_R], "one read");
    // Yours and your sub-agent's files show; another chat's are folded until asked.
    assert.deepEqual(body.querySelectorAll(".chg-file").map((/** @type {any} */ r) => r.getAttribute("data-path")), ["src/a.js", "k.js", "x.js"]);
    assert.deepEqual(texts(body, ".chg-mark"), ["also Fix login"]);
    // What waits in the copy: its Apply, said before the press.
    const copyBlock = () => body.querySelectorAll(".chp-place")[1];
    await until(() => copyBlock().querySelector(".agb-effect") && copyBlock().querySelector(".agb-effect").textContent !== "Checking what Apply would do…", "the copy's dry run");
    assert.equal(copyBlock().querySelector(".agb-why").textContent, "It worked in its own copy, so your folder has none of this yet.");
    assert.ok(copyBlock().querySelector(".agb-apply"), "its Apply, in the copy's block");
    assert.equal(body.querySelectorAll(".agb-apply-box").length, 1, "no Apply in your folder's block or another chat's");
    // A file's diff, under its row: yours against the last commit; the copy's from its sub-agent's change.
    rowsOf(body, "src/a.js")[0].dispatch("click");
    await until(() => body.querySelector(".chg-dh"), "the diff");
    assert.equal(body.querySelector(".chg-dh-path").textContent, "src/a.js");
    assert.equal(rowsOf(body, "src/a.js")[0].getAttribute("aria-expanded"), "true");
    rowsOf(body, "x.js")[0].dispatch("click");
    await until(() => body.querySelector(".chg-dh-path")?.textContent === "x.js", "the copy's diff");
    assert.deepEqual([diffsOf, body.querySelectorAll(".chg-diff").length], [["sa_1"], 1], "one diff open at a time");
  });

  // (fails before: yes — the old pane read its turn again on every snapshot of a running turn, never cancelled: the
  // Designer's of 10-29, "the pane re-reads the whole turn on every snapshot")
  test("it reads again on Read again, at a turn's end, as the sub-agents move and once its answer is old — never on the pulse alone", async () => {
    serve = (u) => (u.startsWith(URL_R) ? ANSWER : undefined);
    const clock = { now: 1_000_000 };
    let subs = [scout()];
    const chat = /** @type {any} */ ({ chainId: "c1", cwd: "/r", turns: [], live: { turn: {} } });
    const { body, ctx } = mount(chat, { subagents: () => subs, clock });
    await settled(body);
    const reads = () => asked.filter((u) => u.startsWith(URL_R)).length;
    assert.equal(reads(), 1);
    refreshChanges(body, /** @type {any} */ (ctx));
    refreshChanges(body, /** @type {any} */ (ctx));
    assert.equal(reads(), 1, "the pulse alone reads nothing");
    chat.live = null;
    refreshChanges(body, /** @type {any} */ (ctx));
    await until(() => reads() === 2, "the read at the turn's end");
    assert.equal(asked.at(-1), `${URL_R}&fresh=1`, "past the server's cache");
    subs = [scout({ work: { ...scout().work, sig: "s2", pending: 2 } })];
    refreshChanges(body, /** @type {any} */ (ctx));
    await until(() => reads() === 3, "the read as a sub-agent's work moved");
    // The clock moved and the pane pulsed until the read before has landed: one under way is not asked again, and its
    // answer is as new as its landing.
    await until(() => {
      clock.now += 31_000;
      refreshChanges(body, /** @type {any} */ (ctx));
      return reads() === 4;
    }, "the read once the answer is old");
    body.querySelector(".chp-again").dispatch("click");
    await until(() => reads() === 5, "Read again");
    assert.equal(asked.at(-1), `${URL_R}&fresh=1`);
  });

  // (fails before: yes — the bug hunt of 10-30, UIP-6: the pane said it read again every 30 s while shown, but read only
  // at the host's pulse and as the sub-agents moved, so an idle chat's pane stood on its first answer for good)
  test("on screen with nothing else moving, it reads again every 30 s by itself; let go or off the screen, it stops", async (t) => {
    serve = (u) => (u.startsWith(URL_R) ? ANSWER : undefined);
    // The pane's timers are the test's: `until` waits on timers, so these waits turn the event loop instead.
    t.mock.timers.enable({ apis: ["setTimeout"] });
    /** @param {() => any} cond @param {string} what */
    const turnsUntil = async (cond, what) => {
      for (let i = 0; i < 2000; i++) {
        if (cond()) return;
        await new Promise((r) => setImmediate(r));
      }
      assert.fail(`never came: ${what}`);
    };
    /** A read asked, then landed: the pane looks again from its landing. */
    const landed = async () => {
      for (let i = 0; i < 50; i++) await new Promise((r) => setImmediate(r));
    };
    const clock = { now: 1_000_000 };
    /** Half a minute and more on, on the pane's clock and the page's timers. */
    const later = () => {
      clock.now += READ_EVERY_MS + 1_000;
      t.mock.timers.tick(READ_EVERY_MS + 1_000);
    };
    const reads = () => asked.filter((u) => u.startsWith(URL_R)).length;
    const chat = /** @type {any} */ ({ chainId: "c1", cwd: "/r", turns: [], live: null });
    const { body, ctx } = mount(chat, { subagents: () => [scout()], clock });
    await turnsUntil(() => reads() === 1 && body.querySelector(".chp-place"), "the first read");
    later();
    await turnsUntil(() => reads() === 2, "the read half a minute on, nothing moving");
    await landed();
    later();
    await turnsUntil(() => reads() === 3, "and half a minute after that");
    assert.equal(asked.at(-1), URL_R, "through the server's cache, as an old answer's read is");
    await landed();
    // Drawn again: the pane before looks no more, the new one for itself; off the screen, neither.
    body.replaceChildren();
    renderChanges(body, /** @type {any} */ (ctx));
    await turnsUntil(() => reads() === 4, "the new pane's read");
    await landed();
    body.remove();
    later();
    later();
    await landed();
    assert.equal(reads(), 4, "nothing read off the screen");
  });

  // (fails before: yes — found reviewing the Changes tab, 10-29: an Apply's move was read through the server's few
  // seconds' cache, whose answer from before it had none of its files, and the pane read again only 30 s later)
  test("an Apply's landing reads past the server's cache: what it wrote is there, under its sub-agent's name", async () => {
    serve = (u) => (u.startsWith(URL_R) ? ANSWER : undefined);
    let subs = [scout()];
    const chat = /** @type {any} */ ({ chainId: "c1", cwd: "/r", turns: [], live: null });
    const { body, ctx } = mount(chat, { subagents: () => subs });
    await settled(body);
    const reads = () => asked.filter((u) => u.startsWith(URL_R)).length;
    assert.equal(reads(), 1);
    subs = [scout({ work: { ...scout().work, pending: 0, applied: 1, files: [], lastApplied: { at: 70, files: 1, by: "owner" } } })];
    refreshChanges(body, /** @type {any} */ (ctx));
    await until(() => reads() === 2, "the read as its Apply landed");
    assert.equal(asked.at(-1), `${URL_R}&fresh=1`, "past the server's cache");
    // Its work moving on, no Apply among it: the cache is good enough, as before.
    subs = [scout({ work: { ...scout().work, sig: "s2", pending: 2, applied: 1 } })];
    refreshChanges(body, /** @type {any} */ (ctx));
    await until(() => reads() === 3, "the read as its work moved");
    assert.equal(asked.at(-1), URL_R);
  });

  // (fails before: yes — the owner's of 11-04: "i deleted that chat but that was still showing in the Changes side bar,
  // i re-opened that Changes side bar and that went away")
  test("a chat deleted: the pane on screen reads again past the server's cache, the worktree only it wrote in gone; the deleted chat's own pane reads nothing", async () => {
    let answer = /** @type {any} */ (ANSWER);
    serve = (u) => (u.startsWith(URL_R) ? answer : undefined);
    const { body } = mount({ chainId: "c1", cwd: "/r", turns: [], live: null });
    await settled(body);
    assert.deepEqual(texts(body, ".chp-name"), ["r", "Scout's copy", "r-docs"]);
    const reads = () => asked.filter((u) => u.startsWith(URL_R)).length;
    // The server's answer once "Fix login" (c2) is gone: its rounds went with it, and with them its worktree.
    answer = { ...ANSWER, places: ANSWER.places.slice(0, 2).map((p) => ({ ...p, files: p.files.map((f) => ({ ...f, by: f.by.filter((b) => b.chain !== "c2") })) })) };
    chatDeleted("c1");
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    assert.equal(reads(), 1, "the deleted chat's own pane: the chat that takes its place draws its own");
    chatDeleted("c2");
    await until(() => texts(body, ".chp-name").length === 2, "the deleted chat's worktree gone");
    assert.deepEqual([reads(), asked.at(-1)], [2, `${URL_R}&fresh=1`]);
    assert.deepEqual(texts(body, ".chp-section"), []);
    assert.ok(!texts(body, ".agb-name").includes("Fix login"), "its name off the files it wrote");
  });

  test("a card's Review › opens its sub-agent's line; a file asked for opens with its diff; a chat with no folder or no repository says so", async () => {
    serve = (u) =>
      u === URL_R ? ANSWER
      : u === "/api/git/branch?cwd=%2Fr&place=%2Fr&part=uncommitted&path=k.js" ? { patch: "diff --git a/k.js b/k.js\n@@ -1 +1,2 @@\n keep\n+more\n" }
      : u === "/api/git/changes?cwd=%2Fn&chain=c3" ? { cwd: "/n", ok: false, error: "fatal: not a git repository", places: [], chats: {}, homes: {}, atWork: [] }
      : undefined;
    showChanges({ file: { path: "k.js" } });
    const chat = { chainId: "c1", cwd: "/r", turns: [], live: null };
    const { body } = mount(chat);
    await settled(body);
    await until(() => body.querySelector(".chg-dh-path")?.textContent === "k.js", "the file asked for, open");
    // Folded by hand, then a Review ›: open again.
    const line = () => body.querySelectorAll(".chp-agent").find((/** @type {any} */ x) => x.getAttribute("data-sub") === "sa_1");
    line().dispatch("click");
    assert.equal(line().getAttribute("aria-expanded"), "false");
    reviewAgent("sub:sa_1");
    assert.equal(line().getAttribute("aria-expanded"), "true");
    const bare = mount({ chainId: "c2", cwd: "", turns: [], live: null });
    assert.match(bare.body.textContent, /This chat has no folder yet/);
    const loose = mount({ chainId: "c3", cwd: "/n", turns: [], live: null });
    await until(() => /Not in a git repository/.test(loose.body.textContent), "the words for a folder git does not track");
  });

  // (fails before: yes — a running sub-agent's copy was read again only as its status or its work moved: its files
  // showed once it ended, or 30 s on)
  test("a running sub-agent's round moving reads again: its copy's files show as it goes", async () => {
    serve = (u) => (u.startsWith(URL_R) ? ANSWER : undefined);
    const at = (/** @type {number} */ round) => scout({ status: "running", endedAt: null, progress: { round }, work: { ...scout().work, pending: 0 } });
    let subs = [at(1)];
    const { body, ctx } = mount({ chainId: "c1", cwd: "/r", turns: [], live: null }, { subagents: () => subs });
    await settled(body);
    const reads = () => asked.filter((u) => u.startsWith(URL_R)).length;
    refreshChanges(body, /** @type {any} */ (ctx));
    assert.equal(reads(), 1);
    subs = [at(2)];
    refreshChanges(body, /** @type {any} */ (ctx));
    await until(() => reads() === 2, "the read as its round moved");
    assert.deepEqual([texts(body, ".chp-facts")[1], body.querySelectorAll(".chg-file").map((/** @type {any} */ r) => r.getAttribute("data-path")).includes("x.js")], ["1 file so far · +3 −0", true]);
  });

  // (fails before: yes — a file asked for that was committed since stayed asked, and opened at whatever read listed it
  // next, long after)
  test("a file asked for that the read does not list is let go: a later read that lists it opens nothing", async () => {
    let answer = /** @type {any} */ (ANSWER);
    serve = (u) => (u.startsWith(URL_R) ? answer : undefined);
    showChanges({ file: { path: "gone.js" } });
    const { body } = mount({ chainId: "c1", cwd: "/r", turns: [], live: null });
    await settled(body);
    const folder = ANSWER.places[0];
    answer = { ...ANSWER, places: [{ ...folder, files: [...folder.files, { ...folder.files[0], path: "gone.js" }] }] };
    const before = asked.length;
    body.querySelector(".chp-again").dispatch("click");
    await until(() => asked.length > before && rowsOf(body, "gone.js").length, "the read that lists it");
    assert.equal(body.querySelector(".chg-diff"), null);
  });
});

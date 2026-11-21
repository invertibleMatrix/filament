// @ts-check
// `@` and a project's files (the owner's of 11-04: "in claude desktop we can simply press @ and tag the files from a
// project"; what a file tagged sends: its path alone). The search an `@` asks (workspace.js `findMentions`, the route
// /files/mentions): the letters typed in order, a name before a path; the folders beside the files; a folder typed to
// its `/`, what it holds. The panel: a folder picked opens on what it holds, and lines typed after a path ride on the
// file picked. The message box draws a file typed out whole as its chip; the bubble draws it as a chip that opens it.
// (fails before: yes — an `@` found only names that held the words typed whole, no folder, no lines; a tagged file stood
// in the box as words, and its chip in the bubble opened nothing)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stubDocument } from "./helpers/dom-stub.js";
import { removeDirs } from "./helpers/wait.js";
import { findMentions, lettersInOrder, mentionRank, MENTION_FOLDERS } from "../src/adapters/tools/workspace.js";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
/** @type {string[]} */
const asked = [];
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const q = new URL(String(url), "http://x").searchParams.get("q") || "";
  return {
    ok: true,
    status: 200,
    json: async () =>
      String(url).startsWith("/api/files/mentions")
        ? q === "src/app/"
          ? { under: "src/app/", folders: [{ name: "agent", path: "src/app/agent/" }], files: [{ name: "turn.js", path: "src/app/turn.js" }] }
          : { under: null, files: [{ name: "loop.js", path: "src/app/agent/loop.js" }], folders: [{ name: "app", path: "src/app/" }] }
        : String(url).startsWith("/api/memory/sessions")
          ? { sessions: [] }
          : String(url).startsWith("/api/files/tree")
            ? { entries: [{ name: "My Notes.md", path: "docs/My Notes.md", kind: "file" }, { name: "Makefile", path: "Makefile", kind: "file" }] }
            : String(url).startsWith("/api/files/search")
              ? { files: [{ path: "docs/My Notes.md" }] }
              : String(url).startsWith("/api/git/status")
                ? { ok: true, files: [] }
                : {},
  };
};
const { createSlashPanel, mentionParts } = await import("../src/ui/harness/composer/slash.js");
const { createRichBox } = await import("../src/ui/harness/composer/rich-box.js");
const { createComposer } = await import("../src/ui/harness/composer/composer.js");
const { FILE_MENTION, fileTag, fileOfTag, referenceChips } = await import("../src/ui/harness/lib/labels.js");
const { userRow } = await import("../src/ui/harness/conversation/turn.js");
const { chipActions } = await import("../src/ui/harness/conversation/tools/layout.js");
const { renderFiles } = await import("../src/ui/harness/panes/files.js");
const { renderCodeViewer } = await import("../src/ui/harness/panes/code-viewer.js");
const { createCommandCenter } = await import("../src/ui/harness/command-center.js");
const { createPaneHost } = await import("../src/ui/harness/panes/pane-host.js");
after(() => {
  g.fetch = realFetch;
});

describe("what an @ finds in the project", () => {
  /** @type {string} */
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-mentions-"));
    for (const d of ["src/app/agent", "src/ui/lib", "docs"]) mkdirSync(join(dir, d), { recursive: true });
    for (const f of ["src/app/agent/loop.js", "src/app/agent/turn.js", "src/app/letters.js", "src/ui/lib/labels.js", "src/ui/lib/loop-view.js", "docs/GUIDE.md", "loop.js", "README.md"]) writeFileSync(join(dir, f), "");
  });
  after(() => removeDirs(dir));

  test("the letters typed in order, a name before a path; a name the word, then starting with it, then holding it", async () => {
    const paths = async (/** @type {string} */ q) => (await findMentions(dir, q)).files.map((f) => f.path);
    assert.deepEqual(await paths("loop.js"), ["loop.js", "src/app/agent/loop.js", "src/ui/lib/loop-view.js"], "the name itself, shortest first; then its letters in a name");
    assert.deepEqual((await paths("loop")).slice(0, 3), ["loop.js", "src/app/agent/loop.js", "src/ui/lib/loop-view.js"]);
    assert.deepEqual(await paths("lpvw"), ["src/ui/lib/loop-view.js"], "its letters in order, none together");
    assert.deepEqual(await paths("ag/tu"), ["src/app/agent/turn.js"], "typed with a `/`, the path's letters");
    assert.deepEqual(await paths("zzz"), []);
    assert.deepEqual(await paths(""), [], "nothing typed, nothing named");
    assert.ok((await paths("lbl")).indexOf("src/ui/lib/labels.js") === 0, "a name's letters before a path's");
  });

  test("the folders beside the files, as many as MENTION_FOLDERS; a folder typed to its `/`, what it holds, folders first", async () => {
    const found = await findMentions(dir, "agent");
    assert.deepEqual(found.folders.map((f) => [f.path, f.name]), [["src/app/agent/", "agent"]]);
    assert.equal(found.under, null);
    assert.ok((await findMentions(dir, "s")).folders.length <= MENTION_FOLDERS);
    const inside = await findMentions(dir, "src/app/");
    assert.deepEqual([inside.under, inside.folders.map((f) => f.path), inside.files.map((f) => f.path)], ["src/app/", ["src/app/agent/"], ["src/app/letters.js"]]);
    assert.deepEqual((await findMentions(dir, "SRC\\app/")).under, "src/app/", "its case and a backslash as typed");
    assert.equal((await findMentions(dir, "nope/")).under, null, "a folder that is not there: searched as words");
  });

  test("how tightly the letters stand: a word's start and letters together count; apart, less; missing, not at all", () => {
    assert.equal(lettersInOrder("abc", "abc", "abd"), -1);
    assert.ok(lettersInOrder("loop-view.js", "loop-view.js", "lv") > lettersInOrder("lovely.js", "lovely.js", "lv"), "both at a word's start");
    assert.ok(lettersInOrder("loopview.js", "loopView.js", "lv") > lettersInOrder("loopview.js", "loopview.js", "lv"), "a capital starts a word");
    assert.ok(mentionRank("src/a/loop.js", "loop") > mentionRank("src/loop/a.js", "loop"), "the name holding it before the path");
    assert.ok(mentionRank("src/app/", "app") === 600, "a folder by its name");
  });
});

describe("the @ panel and the words it writes", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());

  test("a path and the lines after it: a range whole, or what is whole of one half typed", () => {
    assert.deepEqual(mentionParts("src/a.js"), { path: "src/a.js", range: "" });
    assert.deepEqual(mentionParts("src/a.js#L10-40"), { path: "src/a.js", range: "#L10-40" });
    assert.deepEqual(mentionParts("a.js#L7"), { path: "a.js", range: "#L7" });
    assert.deepEqual(mentionParts("a.js#L7-"), { path: "a.js", range: "#L7" });
    assert.deepEqual(mentionParts("a.js#"), { path: "a.js", range: "" });
  });

  test("files, then folders; a file picked carries the lines typed; a folder picked is typed in and opens on what it holds", async () => {
    /** @type {string[]} */
    const put = [];
    const panel = createSlashPanel({ onInsert: (/** @type {string} */ t) => void put.push(t), getFolder: () => "H:\\p" });
    asked.length = 0;
    await panel.open("@", "loop#L10-40");
    await settle();
    assert.ok(asked.some((u) => u.startsWith("/api/files/mentions?cwd=H%3A%5Cp&q=loop&")), asked.join("\n"));
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent), ["Files", "Folders"]);
    const rows = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"));
    rows[0].dispatch("click");
    assert.deepEqual(put, ["@src/app/agent/loop.js#L10-40 "], "the path alone, the lines with it");
    await panel.open("@", "ap");
    await settle();
    /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"))[1].dispatch("click");
    // (fails before: yes — the hunt of 11-04 on f-files: the folder's pick kept the last search's rows on screen, a
    // click or an Enter on one picking the old search's file, until the folder's list landed)
    assert.deepEqual([panel.el.querySelectorAll(".slash-row").length, panel.el.querySelector(".slash-empty")?.textContent], [0, "Searching…"], "the last search's rows go at once");
    await settle();
    assert.equal(put.at(-1), "@src/app/", "typed in, no space after it");
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "src/app/", "the panel opens on it");
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent), ["In src/app/"]);
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-label")).map((s) => s.textContent), ["agent/", "turn.js"]);
    panel.close();
  });

  // (fails before: yes — the review of 11-04 on f-files: a path with a space, a bracket, an accent or no `.` was written
  // bare and read back cut — `@docs/My Notes.md` chipped `@docs/My` —, a sentence's stop joined the path, and an npm
  // scope or a decorator in pasted code was taken for a file)
  test("a tag reads back whole: a path bare where it can be, else in quotes; a stop after it is the sentence's; no scope, decorator in code, or number is a file", () => {
    assert.deepEqual(["src/app/loop.js", "src/app/", ".gitignore", "docs/My Notes.md", "Makefile", "app/[id]/page.tsx", "docs/résumé.md", "src/types/node"].map(fileTag), ["@src/app/loop.js", "@src/app/", "@.gitignore", '@"docs/My Notes.md"', '@"Makefile"', '@"app/[id]/page.tsx"', '@"docs/résumé.md"', '@"src/types/node"']);
    assert.deepEqual(fileOfTag('@"docs/My Notes.md"#L3-9'), { path: "docs/My Notes.md", range: "#L3-9" });
    const tags = (/** @type {string} */ t) => [...t.matchAll(FILE_MENTION)].map((m) => m[0]);
    assert.deepEqual(tags('see @"docs/My Notes.md" and @src/a.js. Then @src/app/ too'), ['@"docs/My Notes.md"', "@src/a.js", "@src/app/"]);
    assert.deepEqual(tags("npm i @types/node @babel/core, costs @3.5 now, ask @reviewer and @plug:x.y please"), []);
    const box = /** @type {any} */ (createRichBox());
    box.value = "read @src/a.js#L10-40 and @src/b";
    assert.deepEqual(box.childNodes.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.getAttribute("data-tag"))), ["read ", "@src/a.js#L10-40", " and @src/b"]);
    assert.equal(box.value, "read @src/a.js#L10-40 and @src/b", "the words as written");
    const chip = box.childNodes[1];
    assert.deepEqual([chip.getAttribute("contenteditable"), chip.className, chip.textContent], ["false", "ref-chip is-file", "src/a.js#L10-40"]);
    // The space after a chip deleted: its words make no tag where they stand, and are words again.
    const d = /** @type {any} */ (globalThis.document);
    box.replaceChildren(d.createTextNode("read "), chip);
    box.dispatch("input");
    assert.deepEqual(box.childNodes.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.getAttribute("data-tag"))), ["read @src/a.js#L10-40"]);
    box.value = 'open @"docs/My Notes.md" then\n```\n@pytest.fixture\ndef x(): pass\n```\nand `@src/a.js` too';
    assert.deepEqual(box.childNodes.filter((/** @type {any} */ n) => n.nodeType === 1).map((/** @type {any} */ n) => [n.getAttribute("data-tag"), n.textContent]), [['@"docs/My Notes.md"', "docs/My Notes.md"]], "unquoted on its chip; in code, words");
  });

  test("the bubble: a file's chip with its lines, a press opens the file beside the chat; a folder's opens none; an agent's tag or a scope is no file", () => {
    const refs = (/** @type {string} */ t) => referenceChips(t).filter((p) => p.kind === "ref");
    assert.deepEqual(refs("see @src/a.js#L10-40."), [{ kind: "ref", mark: "@", name: "src/a.js#L10-40", file: "src/a.js", range: "#L10-40" }]);
    assert.deepEqual(refs('see @"docs/My Notes.md".'), [{ kind: "ref", mark: "@", name: "docs/My Notes.md", file: "docs/My Notes.md" }]);
    assert.deepEqual(refs("ask @reviewer about @types/node").map((p) => [p.name, "file" in p]), [["reviewer", false], ["types/node", false]]);
    // (fails before: yes — the hunt of 11-04 on f-files: the bubble drew a decorator or a path in pasted code as a file's
    // chip a press opened, where the box leaves them words)
    const files = (/** @type {string} */ t) => refs(t).filter((p) => "file" in p).map((p) => /** @type {any} */ (p).file);
    assert.deepEqual(files("```\n@pytest.fixture\ndef x(): pass\n@src/a.js\n```\nand `@src/b.js` too, then @src/c.js"), ["src/c.js"], "in code, words");
    assert.deepEqual(files("see @src/c.js\n```\n@src/a.js never closed"), ["src/c.js"], "a fence not closed runs to the end");
    /** @type {string[]} */
    const opened = [];
    const before = chipActions.open;
    chipActions.open = (/** @type {string} */ p) => void opened.push(p);
    try {
      const row = /** @type {any} */ (userRow({ n: 1, userText: "look at @src/a.js#L10-40 in @src/app/ with @reviewer" }, { onCopy: () => {} }));
      const file = row.querySelector(".ref-chip.is-file");
      assert.equal(file?.tagName, "BUTTON");
      assert.equal(file?.textContent, "src/a.js#L10-40");
      file.dispatch("click", { stopPropagation() {} });
      assert.deepEqual(opened, ["src/a.js"]);
      const others = /** @type {any[]} */ (row.querySelectorAll(".ref-chip")).filter((c) => !c.classList.contains("is-file"));
      assert.deepEqual(others.map((c) => [c.tagName, c.getAttribute("data-ref")]), [["SPAN", "@src/app/"], ["SPAN", "@reviewer"]]);
    } finally {
      chipActions.open = before;
    }
  });

  // (fails before: yes — the review of 11-04 on f-files: a pick set the caret at the box's end, so a folder picked
  // mid-message lost its list at the next key)
  test("a folder picked mid-message: typed where the `@` was, the caret after it, the list on what it holds", async () => {
    const host = /** @type {any} */ (globalThis.document.createElement("div"));
    createComposer(host, { onSend: () => true, onStop: () => {}, getChat: () => /** @type {any} */ ({ chainId: "c1", cwd: "H:\\p", turns: [] }) });
    const box = host.querySelector(".composer-input");
    box.value = "fix @ap in loop";
    box.setSelectionRange(7, 7);
    box.dispatch("input");
    await settle();
    const row = /** @type {any[]} */ (host.querySelectorAll(".slash-row")).find((r) => r.querySelector(".slash-label")?.textContent === "app/");
    assert.ok(row, "the folder's row");
    row.dispatch("click");
    await settle();
    assert.equal(box.value, "fix @src/app/ in loop");
    assert.deepEqual([box.selectionStart, box.selectionEnd], [13, 13], "after the folder");
    assert.equal(host.querySelector(".slash-head-title")?.textContent, "src/app/");
    // A file picked before a space: one space between, the caret after it (the drive of 11-04: two, the caret at the end).
    box.value = "see @lo now";
    box.setSelectionRange(7, 7);
    box.dispatch("input");
    await settle();
    /** @type {any[]} */ (host.querySelectorAll(".slash-row")).find((r) => r.querySelector(".slash-label")?.textContent === "loop.js").dispatch("click");
    assert.equal(box.value, "see @src/app/agent/loop.js now");
    assert.deepEqual([box.selectionStart, box.selectionEnd], [27, 27]);
  });

  // (fails before: yes — the map of 11-04 for @ symbols: Add to chat in the Files pane and in the code viewer, and the
  // command center's file rows, wrote `@path` bare, so a path with a space or no `.` never chipped and read back cut)
  test("a file added to the chat from the Files pane, the code viewer or the command center is tagged as the @ panel tags it", async (t) => {
    const d = /** @type {any} */ (globalThis.document);
    // A menu and a dialog place themselves at the next frame; a dialog asks what held the focus.
    const was = { frame: g.requestAnimationFrame, element: g.HTMLElement };
    g.requestAnimationFrame = (/** @type {() => void} */ fn) => setTimeout(fn, 0);
    g.HTMLElement = class {};
    t.after(() => {
      g.requestAnimationFrame = was.frame;
      g.HTMLElement = was.element;
    });
    /** @type {string[]} */
    const put = [];
    const onInsert = (/** @type {string} */ t) => void put.push(t);
    /** The menu's Add to chat, pressed. */
    const addToChat = () => /** @type {any[]} */ (d.querySelectorAll(".zc-menu-item")).find((b) => b.textContent.includes("Add to chat")).dispatch("click");
    const pane = d.createElement("div");
    d.body.append(pane);
    renderFiles(pane, { chat: { cwd: "H:\\added" }, onInsert });
    await settle();
    /** @type {any[]} */ (pane.querySelectorAll(".file-tree-row")).find((r) => r.getAttribute("aria-label") === "My Notes.md").dispatch("contextmenu");
    addToChat();
    const viewer = d.createElement("div");
    d.body.append(viewer);
    renderCodeViewer(viewer, { path: "Makefile", cwd: "H:\\added", onInsert });
    viewer.querySelector('button[title="More"]').dispatch("click");
    addToChat();
    createCommandCenter({ actions: () => [], onOpenTask: () => {}, getFolder: () => "H:\\added", onInsert }).open();
    const input = d.querySelector(".cc-input");
    input.value = "notes";
    input.dispatch("input");
    await settle();
    /** @type {any[]} */ (d.querySelectorAll(".cc-row")).find((r) => r.textContent.includes("My Notes.md")).dispatch("click");
    assert.deepEqual(put, ['@"docs/My Notes.md" ', '@"Makefile" ', '@"docs/My Notes.md" ']);
    assert.deepEqual(put.map((t) => [...t.matchAll(FILE_MENTION)].map((m) => m[0])), [['@"docs/My Notes.md"'], ['@"Makefile"'], ['@"docs/My Notes.md"']], "each chips whole in the box");
  });

  // (fails before: yes — the code viewer in its tab beside the chat had no Add to chat: the panes' host handed it nothing
  // to write into the message box with)
  test("a file's tab beside the chat has Add to chat, which tags the file in the message box", async (t) => {
    const d = /** @type {any} */ (globalThis.document);
    const was = { frame: g.requestAnimationFrame, element: g.HTMLElement, local: g.localStorage, session: g.sessionStorage };
    const storage = () => {
      const kept = new Map();
      return { getItem: (/** @type {string} */ k) => kept.get(k) ?? null, setItem: (/** @type {string} */ k, /** @type {string} */ v) => void kept.set(k, String(v)), removeItem: (/** @type {string} */ k) => void kept.delete(k) };
    };
    g.requestAnimationFrame = (/** @type {() => void} */ fn) => setTimeout(fn, 0);
    g.HTMLElement = class {};
    g.localStorage = storage();
    g.sessionStorage = storage();
    t.after(() => {
      g.requestAnimationFrame = was.frame;
      g.HTMLElement = was.element;
      g.localStorage = was.local;
      g.sessionStorage = was.session;
    });
    /** @type {string[]} */
    const put = [];
    const frame = d.createElement("aside");
    d.body.append(frame);
    const host = createPaneHost(frame, { panes: [], room: () => ({ row: 1600, win: 1920, height: 900 }), paint: () => {}, onInsert: (/** @type {string} */ text) => void put.push(text) });
    host.setChat({ id: "c1", chainId: "c1", cwd: "H:\\added" });
    host.openFileTab({ path: "Makefile", cwd: "H:\\added" });
    await settle();
    frame.querySelector('button[title="More"]').dispatch("click");
    /** @type {any[]} */ (d.querySelectorAll(".zc-menu-item")).filter((b) => b.textContent.includes("Add to chat")).at(-1)?.dispatch("click");
    assert.deepEqual(put, ['@"Makefile" ']);
  });
});

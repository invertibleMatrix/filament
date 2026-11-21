// @ts-check
// A tagged chat is a link (the owner's word of 11-02: "when i tag a session instead of showing those inside square
// brackets with ids, make a clickable hyperlink … whether from composer or from a chat transcript it should open that
// session if available otherwise a toast"; and "when i type @ … they don't show up in suggestion"). The message box
// draws a chat tagged in it as the chat's link, one piece, its words the tag as written; your bubble and an agent's reply
// draw the same link; a press opens the chat where it is kept, else a toast says it is not; `@` lists the chats before
// the files.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
};

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first, and the modules
// that reach it are imported after.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => ({
  ok: true,
  status: 200,
  json: async () =>
    String(url).startsWith("/api/memory/sessions")
      ? { sessions: [{ id: "vmzt5ard", title: "agent_loop_test" }] }
      : String(url).startsWith("/api/files/mentions")
        ? { files: [{ name: "loop.js", path: "src/app/agent/loop.js" }], folders: [] }
        : {},
});
const { createRichBox, textOfNodes } = await import("../src/ui/harness/composer/rich-box.js");
const { chatLinks, openTaggedChat } = await import("../src/ui/harness/lib/chat-open.js");
const { CHAT_GONE } = await import("../src/ui/harness/lib/chat-link.js");
const { inline } = await import("../src/ui/harness/lib/md-stream.js");
const { createSlashPanel } = await import("../src/ui/harness/composer/slash.js");
const { createComposer } = await import("../src/ui/harness/composer/composer.js");
const { userRow } = await import("../src/ui/harness/conversation/turn.js");
after(() => { g.fetch = realFetch; });

const TAG = "[agent\\_loop \\[test\\]](chat:vmzt5ard)";

describe("the message box", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — the box was a textarea: a tagged chat stood in it as `[title](chat:<id>)`, brackets and id)
  test("a chat tagged in it is the chat's link, one piece, its words the tag as written; the rest is its words", () => {
    const box = /** @type {any} */ (createRichBox({ placeholder: "Ask" }));
    box.value = `see ${TAG} and say`;
    assert.equal(box.value, `see ${TAG} and say`);
    assert.deepEqual([box.selectionStart, box.selectionEnd], [box.value.length, box.value.length], "the caret at its end, as a textarea's");
    const kids = box.childNodes;
    assert.deepEqual(kids.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.tagName)), ["see ", "A", " and say"]);
    const link = kids[1];
    assert.deepEqual([link.getAttribute("data-chat"), link.getAttribute("data-tag"), link.getAttribute("contenteditable"), link.getAttribute("href")], ["vmzt5ard", TAG, "false", "#/task/vmzt5ard"]);
    assert.equal(link.textContent, "agent_loop [test]", "its title, as the chat is named");
    assert.equal(textOfNodes(kids), box.value);
    assert.deepEqual([box.getAttribute("data-placeholder"), box.getAttribute("contenteditable"), box.getAttribute("role")], ["Ask", "true", "textbox"]);
    box.value = "two lines\n";
    assert.deepEqual(box.childNodes.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.tagName)), ["two lines\n", "BR"], "a last line break kept open");
    assert.equal(box.value, "two lines\n");
    box.value = "";
    assert.equal(box.childNodes.length, 0, "empty: its words for what to type show");
  });

  test("what the browser writes is read back as text, and drawn again where it no longer stands for it: a line's block, a tag's words typed", () => {
    const box = /** @type {any} */ (createRichBox());
    const d = /** @type {any} */ (globalThis.document);
    const line = d.createElement("div");
    line.append(d.createTextNode("second"));
    box.replaceChildren(d.createTextNode(`first ${TAG}`), line, d.createElement("br"));
    box.dispatch("input");
    assert.equal(box.value, `first ${TAG}\nsecond\n`);
    assert.deepEqual(box.childNodes.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.tagName)), ["first ", "A", "\nsecond\n", "BR"], "drawn again: the tag its link, the block a line");
  });

  // (fails before: yes — the drive of 11-02: Shift+Enter at the end of the words put two new lines in the text, the
  // browser's line break and the one it writes after it for the empty line to show; its plain text's "\n" a block)
  test("read as it shows: the browser's new line at the end, its block for a line, its line break in an empty line or an emptied box", () => {
    const d = /** @type {any} */ (globalThis.document);
    const t = (/** @type {string} */ s) => d.createTextNode(s);
    const br = () => d.createElement("br");
    const block = (/** @type {any[]} */ ...kids) => {
      const e = d.createElement("div");
      e.append(...kids);
      return e;
    };
    const read = (/** @type {any[]} */ ...nodes) => textOfNodes(nodes);
    assert.equal(read(t("abc"), t("\n"), t("\n")), "abc\n", "a new line at the end, and the one the browser writes after it for it to show");
    assert.equal(read(t("abc\n"), t("\n"), br()), "abc\n\n");
    assert.equal(read(t("abc\n")), "abc", "a last new line shows no line");
    assert.equal(read(t("abc"), block(br())), "abc\n", "a new line as the browser's block: its empty line's <br>");
    assert.equal(read(t("abcx"), block(t("y"))), "abcx\ny", "a paste's second line");
    assert.equal(read(t("a"), block(t("bc"), block(t("x")))), "a\nbc\nx");
    assert.equal(read(block(t("one")), t("two")), "one\ntwo", "what follows a block starts a line");
    assert.equal(read(br()), "", "an emptied box");
    assert.equal(read(t("a"), br(), t("b")), "a\nb");
    assert.equal(textOfNodes([t("abc"), t("\n")], false), "abc\n", "what lies before the caret keeps its last new line: the caret is on the next");
    const box = /** @type {any} */ (createRichBox());
    box.value = "abc";
    box.replaceChildren(t("abc"), t("\n"), t("\n"));
    box.dispatch("input");
    assert.equal(box.value, "abc\n");
    assert.deepEqual(box.childNodes.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.tagName)), ["abc", "\n", "\n"], "kept as the browser wrote it: its new line's line shows");
    /** @type {any[]} */
    const asked = [];
    d.execCommand = (/** @type {string} */ cmd, /** @type {boolean} */ _ui, /** @type {string} */ v) => (asked.push(v === undefined ? [cmd] : [cmd, v]), false);
    try {
      box.dispatch("beforeinput", { inputType: "insertLineBreak", preventDefault() {} });
      box.dispatch("beforeinput", { inputType: "insertFromPaste", dataTransfer: { getData: () => "x" }, preventDefault() {} });
    } finally {
      delete d.execCommand;
    }
    assert.deepEqual(asked, [["insertHTML", "\n"], ["insertText", "x"]], "a new line as the box draws it, a paste its plain text");
  });

  test("copied, a chat's link goes as its tag; a paste and Enter go in as plain words", () => {
    const box = /** @type {any} */ (createRichBox());
    box.value = `see ${TAG} now`;
    box.setSelectionRange(4, 4 + TAG.length);
    /** @type {Record<string, string>} */
    const clip = {};
    let kept = false;
    box.dispatch("copy", { clipboardData: { setData: (/** @type {string} */ k, /** @type {string} */ v) => { clip[k] = v; } }, preventDefault: () => { kept = true; } });
    assert.deepEqual([clip["text/plain"], kept], [TAG, true]);
    box.setSelectionRange(box.value.length, box.value.length);
    let held = false;
    box.dispatch("beforeinput", { inputType: "insertFromPaste", dataTransfer: { getData: () => ` ${TAG}` }, preventDefault: () => { held = true; } });
    assert.equal(held, true, "the browser's own paste, which brings markup, held");
    assert.equal(box.value, `see ${TAG} now ${TAG}`);
    assert.equal(box.childNodes.filter((/** @type {any} */ n) => n.tagName === "A").length, 2, "the pasted tag is a link too");
    box.dispatch("beforeinput", { inputType: "insertLineBreak", preventDefault() {} });
    assert.ok(box.value.endsWith("\n"), "Shift+Enter's new line, as a character of the text");
  });

  // (fails before: yes — the Hunter of session-tags: a paste's lines went in as the browser's plain text, which it writes
  // as blocks, and a tag's words; the box drew them again, and Ctrl+Z took nothing back; a Windows paste kept its "\r";
  // Tab from the box stopped on a chat's link, where Enter sent the message)
  test("a paste with lines or tags goes in as the box draws it, its line ends a textarea's; with no words, nothing; what the browser wrote that does not read as the words, drawn; a link is no stop of Tab's", () => {
    const d = /** @type {any} */ (globalThis.document);
    const box = /** @type {any} */ (createRichBox());
    /** @type {string[]} */
    let asked = [];
    let writes = false;
    d.execCommand = (/** @type {string} */ cmd) => (asked.push(cmd), writes);
    const paste = (/** @type {string} */ words) => box.dispatch("beforeinput", { inputType: "insertFromPaste", dataTransfer: { getData: () => words }, preventDefault() {} });
    try {
      box.value = "ab";
      paste("one\r\ntwo\rthree");
      assert.deepEqual(asked, ["insertHTML"], "lines: as the box draws them, the browser's own insert");
      assert.equal(box.value, "abone\ntwo\nthree", "its line ends as a textarea takes them");
      asked = [];
      paste(` ${TAG}`);
      assert.deepEqual(asked, ["insertHTML"], "a tag: its link, the browser's own insert");
      asked = [];
      paste("x");
      assert.deepEqual(asked, ["insertText"], "one line: its plain text");
      asked = [];
      box.setSelectionRange(0, 2);
      paste("");
      assert.deepEqual([asked, box.value.startsWith("ab")], [[], true], "no words: the selection kept");
      // The browser says it wrote, and the box does not read as the words: drawn from them.
      writes = true;
      box.value = "cd";
      paste("one\n");
      assert.equal(box.value, "cdone\n");
      assert.equal(box.childNodes.at(-1)?.tagName, "BR", "its new line open");
    } finally {
      delete d.execCommand;
    }
    box.value = `see ${TAG}`;
    const link = box.childNodes[1];
    assert.equal(link.getAttribute("tabindex"), "-1");
    let held = 0;
    box.dispatch("mousedown", { target: link, preventDefault: () => { held++; } });
    box.dispatch("mousedown", { target: box, preventDefault: () => { held += 10; } });
    assert.equal(held, 1, "a press on the link leaves the focus where it was; on the words, the caret goes there");
  });
});

describe("a press on a chat's link", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — a chat no longer kept greyed its chip and said nothing; the box's tag and a reply's linked nothing)
  test("opens the chat where it is kept; where it is not, a toast says so, and the link greys", async () => {
    /** @type {any[]} */
    const went = [];
    /** @type {any[]} */
    const said = [];
    const kept = new Set(["vmzt5ard"]);
    const o = {
      read: async (/** @type {string} */ path) => {
        const id = decodeURIComponent(/\/memory\/sessions\/([^?]+)/.exec(path)?.[1] || "");
        if (!kept.has(id)) throw Object.assign(new Error("no such session"), { status: 404 });
        return { id };
      },
      say: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => { said.push([msg, kind]); },
      go: (/** @type {string} */ hash) => { went.push(hash); },
    };
    const root = /** @type {any} */ (globalThis.document.createElement("div"));
    chatLinks(root, o);
    const box = /** @type {any} */ (createRichBox());
    box.value = `${TAG} and [gone](chat:x9)`;
    root.append(box);
    const [here, , gone] = box.childNodes;
    let stopped = false;
    root.dispatch("click", { target: here, button: 0, preventDefault: () => { stopped = true; } });
    await settle();
    assert.deepEqual([went, said, stopped], [["#/task/vmzt5ard"], [], true], "the box's link opens its chat");
    root.dispatch("click", { target: gone, button: 0 });
    await settle();
    assert.deepEqual([went.length, said], [1, [[CHAT_GONE, "err"]]]);
    assert.deepEqual([gone.classList.contains("is-gone"), gone.getAttribute("aria-disabled")], [true, "true"]);
    root.dispatch("click", { target: gone, button: 0 });
    await settle();
    assert.equal(said.length, 2, "pressed again, it says so again");
    // Your bubble's chip and an agent's reply: the same link, heard by the same press.
    const bubble = userRow(/** @type {any} */ ({ userText: `look at ${TAG}`, blocks: [], status: "done" }), { onCopy: () => {}, onRewind: () => {} });
    const chip = bubble.querySelector("[data-chat]");
    assert.equal(chip?.getAttribute("data-chat"), "vmzt5ard");
    const reply = inline(`It is in ${TAG}, and [a page](https://x.dev).`);
    assert.match(reply, /<a class="ref-chip is-chat" href="#\/task\/vmzt5ard" data-chat="vmzt5ard" title="[^"]+"><span class="ref-ic"><svg[\s\S]*?<\/span>agent_loop \[test\]<\/a>/);
    assert.match(reply, /<a href="https:\/\/x\.dev" target="_blank" rel="noopener">a page<\/a>/, "other links as before");
    await openTaggedChat("x9", null, o);
    assert.equal(said.length, 3, "opened by its id alone, it says so too");
  });

  // (fails before: yes — the Hunter of session-tags: Settings → Import's rows carry `data-chat`, another agent's ids; a
  // press on a row, or its Import or Open, toasted that the chat was deleted and greyed the row)
  test("a row that carries a chat's id of its own is its own: its press is not a chat link's", async () => {
    let read = 0;
    /** @type {any[]} */
    const said = [];
    const root = /** @type {any} */ (globalThis.document.createElement("div"));
    chatLinks(root, { read: async () => { read++; throw Object.assign(new Error("no"), { status: 404 }); }, say: (/** @type {string} */ m) => { said.push(m); }, go: () => {} });
    const row = globalThis.document.createElement("div");
    row.setAttribute("class", "imp-chat");
    row.setAttribute("data-chat", "a4");
    const open = globalThis.document.createElement("button");
    row.append(open);
    root.append(row);
    let stopped = false;
    root.dispatch("click", { target: open, button: 0, preventDefault: () => { stopped = true; } });
    await settle();
    assert.deepEqual([read, said, stopped, row.classList.contains("is-gone")], [0, [], false, false]);
  });

  // (fails before: yes — the Hunter of session-tags: emphasis ran before the tag, so a chat named "a *b* c" drew "b" in italics)
  test("in a reply, a chat's title is drawn as written: no emphasis or code in it", () => {
    const html = inline("See [fix *the* `npm` ~~bug~~](chat:x1) and *this*.");
    assert.match(html, /data-chat="x1"[^>]*><span class="ref-ic">[\s\S]*?<\/span>fix \*the\* `npm` ~~bug~~<\/a>/);
    assert.match(html, /and <i>this<\/i>\.$/, "the rest as before");
  });
});

describe("the @ list", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  // (fails before: yes — the owner's word of 11-02: the chats came under every file the words found)
  test("the chats come before the files", async () => {
    const panel = createSlashPanel({ onInsert: () => {}, getFolder: () => "H:\\p" });
    await panel.open("@", "loop");
    await settle();
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent), ["Chats", "Files"]);
    assert.equal(panel.el.querySelector(".slash-head-title")?.textContent, "loop");
    panel.close();
  });

  test("in the box: `@` and part of a chat's title, its row picked — the chat's link where it was typed, the tag in the words sent", async () => {
    const host = /** @type {any} */ (globalThis.document.createElement("div"));
    /** @type {string[]} */
    const sent = [];
    createComposer(host, { onSend: (/** @type {string} */ text) => (sent.push(text), true), onStop: () => {}, getChat: () => /** @type {any} */ ({ chainId: "c1", cwd: "H:\\p", turns: [] }) });
    const box = host.querySelector(".composer-input");
    box.value = "read @loop_te";
    box.dispatch("input");
    await settle();
    const row = /** @type {any[]} */ (host.querySelectorAll(".slash-row")).find((r) => String(r.textContent).includes("agent_loop_test"));
    assert.ok(row, "its row");
    row.dispatch("click");
    assert.equal(box.value, "read [agent\\_loop\\_test](chat:vmzt5ard) ".replace(/\\_/g, "_"));
    assert.deepEqual(box.childNodes.map((/** @type {any} */ n) => (n.nodeType === 3 ? n.data : n.getAttribute("data-chat"))), ["read ", "vmzt5ard", " "]);
    box.dispatch("keydown", { key: "Enter", shiftKey: false, ctrlKey: false, metaKey: false, isComposing: false, keyCode: 13, preventDefault() {} });
    assert.deepEqual(sent, ["read [agent_loop_test](chat:vmzt5ard)"]);
  });
});

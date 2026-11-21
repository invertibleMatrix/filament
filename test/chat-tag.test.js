// @ts-check
// A past chat tagged in a message (the owner's word of 10-26: "in other harness one can simply tag other chats and the
// agent would do the rest"; the Designer's form): the `@` and `#` panels write `[its title](chat:<id>)` where it was
// typed, never a `@mem load` first line that pasted the whole chat in at Send. The model loads it by that id with its
// memory tool where it needs it; the bubble draws it as the chat's chip; its title names no agent. A chat whose model
// has no memory tools keeps the visible first line, said so.
// (fails before: yes — picking a chat put `@mem load <id>` at the top of the message, wherever the caret was)
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { CHAT_LINK, chatTag, referenceChips } from "../src/ui/harness/lib/labels.js";
import { CHAT_LINK as SERVER_CHAT_LINK, cardsNamedIn } from "../src/services/agent-cards.js";
import { MEMORY_TOOL_SCHEMAS } from "../src/app/memory-tools.js";

const settle = () => new Promise((r) => setTimeout(r, 10));

// The page's API client keeps the `fetch` it finds when it is first imported: the stand-in goes first, and the modules
// that reach it are imported after.
const g = /** @type {any} */ (globalThis);
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => ({
  ok: true,
  status: 200,
  json: async () => (String(url).startsWith("/api/memory/sessions") ? { sessions: [{ id: "ih5r5o41", title: "Northwind setup" }, { id: "q1", preview: "fix the login page" }] } : {}),
});
const { addressed, usesIn } = await import("../src/ui/harness/lib/agent-cards.js");
const slash = await import("../src/ui/harness/composer/slash.js");
after(() => { g.fetch = realFetch; });

describe("a chat's tag", () => {
  test("written as [its title](chat:<id>): one line, cut near 60 characters, its brackets escaped; no title, its id", () => {
    assert.equal(chatTag("Northwind setup", "ih5r5o41"), "[Northwind setup](chat:ih5r5o41)");
    assert.equal(chatTag("  fix [the]\n  login \\ page ", "a1"), "[fix \\[the\\] login \\\\ page](chat:a1)");
    assert.equal(chatTag("", "a1"), "[a1](chat:a1)");
    const long = chatTag("x".repeat(80), "a1");
    assert.equal(long, `[${"x".repeat(59)}…](chat:a1)`);
    assert.equal(String(CHAT_LINK), String(SERVER_CHAT_LINK), "the page's and the server's patterns are one");
  });

  test("the bubble's chips: the chat's title, unescaped; what its title holds is no chip; the rest as before", () => {
    const parts = referenceChips(`see ${chatTag("ask @pm [v2]", "k9")} and @src/app.js`);
    assert.deepEqual(parts, [
      { kind: "text", text: "see " },
      { kind: "chat", title: "ask @pm [v2]", id: "k9" },
      { kind: "text", text: " and " },
      { kind: "ref", mark: "@", name: "src/app.js", file: "src/app.js" },
    ]);
    assert.deepEqual(referenceChips("[a](chat:x)"), [{ kind: "chat", title: "a", id: "x" }]);
    assert.deepEqual(referenceChips("no tag [here](https://x.dev)"), [{ kind: "text", text: "no tag [here](https://x.dev)" }]);
  });

  test("its title names no agent: not at the start of a message, nor later, nor in plain words to the server", () => {
    const cards = [/** @type {any} */ ({ tag: "pm", name: "PM" }), /** @type {any} */ ({ tag: "hunter", name: "Hunter" })];
    const tag = chatTag("ask @pm, then the Hunter", "k9");
    assert.deepEqual(addressed(`${tag} what did it decide?`, cards).to, [], "a message that starts with a chat is the main agent's");
    assert.deepEqual(usesIn(`look at ${tag} please`, cards), []);
    assert.deepEqual(usesIn(`look at ${tag} and @pm`, cards).map((c) => c.tag), ["pm"], "a tag past it still names its agent");
    assert.deepEqual(cardsNamedIn(`read ${tag}`, cards), []);
    assert.deepEqual(cardsNamedIn(`read ${tag}, then ask the Hunter`, cards), ["hunter"]);
  });

  test("the model is told what a tag is, on its memory tool's description, the same each turn", () => {
    const load = /** @type {any} */ (MEMORY_TOOL_SCHEMAS).load;
    assert.ok(load, "the load tool");
    assert.match(String(load.description), /A chat the user tags in a message, written \[title\]\(chat:<id>\), is a past session: load it by that id when the request needs what it holds\./);
  });
});

describe("the panels' chats", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  before(() => { doc = stubDocument(); });
  after(() => { doc.restore(); });

  test("picked, a chat is tagged where it was typed: no first line, nothing pasted in at Send", async () => {
    /** @type {any[]} */
    const inserted = [];
    const panel = slash.createSlashPanel({ onInsert: (text, o) => inserted.push([text, o?.prefixLine ?? null]) });
    await panel.open("#", "play");
    await settle();
    const rows = /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"));
    assert.equal(rows.length, 2);
    rows[0].dispatch("click");
    await panel.open("@", "");
    await settle();
    /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row")).find((r) => String(r.textContent).includes("fix the login page")).dispatch("click");
    assert.deepEqual(inserted, [["[Northwind setup](chat:ih5r5o41) ", null], ["[fix the login page](chat:q1) ", null]]);
  });

  test("where the chat's model has no memory tools: the visible first line pastes it in at Send, and the section says so", async () => {
    /** @type {any[]} */
    const inserted = [];
    const panel = slash.createSlashPanel({ onInsert: (text, o) => inserted.push([text, o?.prefixLine ?? null]), memoryTools: () => false });
    await panel.open("#", "");
    await settle();
    assert.deepEqual(/** @type {any[]} */ (panel.el.querySelectorAll(".slash-section")).map((s) => s.textContent), [slash.PASTED_IN]);
    /** @type {any[]} */ (panel.el.querySelectorAll(".slash-row"))[0].dispatch("click");
    assert.deepEqual(inserted, [["", "@mem load ih5r5o41"]]);
  });

  test("the composer asks the chat's settings whether its model has memory's tools", () => {
    const composer = readFileSync("src/ui/harness/composer/composer.js", "utf8");
    assert.match(composer, /memoryTools: \(\) => \{\n\s+const m = cb\.getChat\(\)\?\.view\?\.settings\?\.effective\?\.memory;\n\s+return !m \|\| \(m\.enabled !== false && m\.tools !== false\);\n\s+\},/);
  });
});

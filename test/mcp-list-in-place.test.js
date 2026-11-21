// @ts-check
// The connectors' list drawn again keeps the rows and buttons under the pointer (the owner's of 11-01: "when i hover
// over my mouse over some interactive elements like buttons then those are just suppose to highlight only once they
// quite a lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to
// press more than once"). The list was placed anew whole at each refresh — each Space event while a sheet shows it,
// each focus of the window, each change written —: a row, its switch, its ⋯ and Add connector new elements under a
// resting pointer, whose hover started over and where a press that began on the old one never clicked. Drawn in place
// (dom.js `morphChildren`), each keyed by what it is, they are the elements that stood, reading the newest answer.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/lib/mcp-list.js")} */
let lib;
before(async () => {
  doc = stubDocument();
  lib = await import("../src/ui/harness/lib/mcp-list.js");
});
after(() => doc.restore());

const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const LINEAR = "https://mcp.linear.example/mcp";
/** A remote server's row, for all chats. @param {any} [o] */
const linear = (o = {}) => ({ name: "linear", kind: "http", spec: { name: "linear", url: LINEAR }, sse: false, from: "global", on: true, switchedAt: null, replaces: null, orphan: false, own: true, switchedHere: false, test: null, signIn: null, ...o });
/** The list's answer for all chats. @param {any[]} servers @param {any} [o] */
const answer = (servers, o = {}) => ({ scope: "all", at: "global", label: "all chats", projectId: null, held: false, unread: [], servers, ...o });

/** The list over a server whose rows the test moves; `calls`: each request, in order; `menus`: each menu opened. */
const listOf = () => {
  /** @type {string[]} */
  const calls = [];
  /** @type {{ items: any[], o: any }[]} */
  const menus = [];
  let rows = [linear(), linear({ name: "github", spec: { name: "github", url: "https://mcp.github.example/mcp" }, test: { ok: true, at: 0, words: "3 tools" } })];
  const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
    calls.push(`${opts.method || "GET"} ${path}`);
    if (path === "/mcp-servers/look") return { changed: false };
    return answer(rows);
  };
  const list = lib.createMcpList({ scope: "all", now: () => 0 },
    /** @type {any} */ ({ api, dialog: () => ({ close() {} }), menu: (/** @type {any[]} */ items, /** @type {any} */ o) => menus.push({ items, o }), confirm: async () => true, open: () => {}, later: () => {} }));
  const el = /** @type {any} */ (list.el);
  doc.document.body.append(el);
  return { list, el, calls, menus, set: (/** @type {any[]} */ r) => { rows = r; } };
};
/** A button by its words. @param {any} at @param {RegExp} words @returns {any} */
const button = (at, words) => at.querySelectorAll("button").find((/** @type {any} */ b) => words.test(b.textContent)) || null;

// (fails before: yes — the list was placed anew whole at each refresh: its rows, switches, ⋯ and Add new elements)
test("drawn again at a refresh, each row, its switch, its ⋯ and Add connector stand and read the newest answer, and a press on each lands", async () => {
  const v = listOf();
  try {
    await flush();
    const row = v.el.querySelector('[data-name="linear"]');
    const sw = v.el.querySelector('[aria-label="Use linear"]');
    const more = v.el.querySelector('[aria-label="More for linear"]');
    const add = button(v.el, /Add connector$/);
    assert.ok(row && sw && more && add, "Linear's row, its switch and its ⋯, and Add connector");
    assert.equal(sw.getAttribute("aria-checked"), "true");
    // Read again, as a Space's event or the window's focus has it: the elements that stood stand.
    await v.list.refresh();
    assert.equal(v.el.querySelector('[data-name="linear"]'), row, "the row that stood");
    assert.equal(v.el.querySelector('[aria-label="Use linear"]'), sw, "its switch");
    assert.equal(v.el.querySelector('[aria-label="More for linear"]'), more, "its ⋯");
    assert.equal(button(v.el, /Add connector$/), add, "Add connector");
    assert.deepEqual(v.el.querySelectorAll(".mcps-row").map((/** @type {any} */ r) => r.getAttribute("data-name")), ["linear", "github"]);
    // The next answer has Linear tested and off: the row that stood says so.
    v.set([linear({ on: false, test: { ok: true, at: 0, words: "5 tools" } }), linear({ name: "github", spec: { name: "github", url: "https://mcp.github.example/mcp" } })]);
    await v.list.refresh();
    assert.equal(v.el.querySelector('[data-name="linear"]'), row);
    assert.equal(row.classList.contains("is-off"), true, "off, on the row that stood");
    assert.equal(row.querySelector(".mcps-dot").classList.contains("is-ok"), true, "tested, on the row that stood");
    assert.equal(v.el.querySelector('[aria-label="Use linear"]'), sw);
    assert.deepEqual([sw.getAttribute("aria-checked"), sw.classList.contains("on")], ["false", false], "the switch that stood reads off");
    // A press on the ⋯ that stood opens Linear's menu at it.
    more.dispatch("click");
    assert.equal(v.menus.at(-1)?.o.anchor, more, "the menu hangs off the button that stood");
    assert.ok(v.menus.at(-1)?.items.some((/** @type {any} */ i) => /Remove/.test(String(i.label))), "Linear's own menu");
    // A press on the switch that stood writes the newest word: on, as it reads off now.
    sw.dispatch("click");
    await flush();
    assert.equal(v.calls.at(-1), "PUT /mcp-servers/all/linear", "switched by the press on the element that stood");
  } finally {
    v.el.remove();
  }
});

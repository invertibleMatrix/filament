// @ts-check
// Library › Memory drawn again keeps what stands under the pointer (the owner's of 11-01: "when i hover over my mouse
// over some interactive elements like buttons then those are just suppose to highlight only once they quite a lot of
// time they start blinking … and during that sometimes the clicks even don't pass through so i have to press more than
// once"). Each change memory makes, heard on the events fan-out, read the page again and placed each part anew whole:
// the cards and their buttons, the kinds' chips, the scopes, the views and the search field new elements under a
// resting pointer, whose hover started over and where a press that began on the old one never clicked, the field's
// words gone with it. Drawn in place (dom.js `morphChildren`), each keyed by what it is, they are the elements that
// stood, the field kept as itself; a claim's editor, drawn again while open, marks the Save on the page.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {typeof import("../src/ui/harness/library/memory.js")} */
let lib;
before(async () => {
  doc = stubDocument();
  /** @type {any} */ (doc.document).addEventListener ||= () => {};
  lib = await import("../src/ui/harness/library/memory.js");
});
after(() => doc.restore());

const RULE = {
  id: "i12", kind: "rule", text: "never run npm test bare here; run it as env -u CLAUDECODE npm test", status: "confirmed", trust: "user said", sure: 0.95, backed: 2, flags: [],
  triggers: [{ shape: "npm test", unless: "env -u CLAUDECODE", source: "words", fired: 3, followed: 1 }], fired: 3, followed: 1,
};
const HOWTO = { id: "i2", kind: "procedure", text: "How to cut a release: 1. `npm version patch` 2. `npm publish`", status: "confirmed", trust: "user said", sure: 0.95, backed: 1, flags: [] };
const FACT = { id: "i7", kind: "fact", text: "the api listens on port 3000", status: "inferred", trust: "inferred", sure: 0.3, backed: 1, flags: ["file changed since"] };
const QUESTION = { id: "q3", kind: "retire", proposal: { action: "retire", id: 7 }, reason: "its file src/api.js changed", claims: [{ id: "i7", text: FACT.text }], created: "2026-10-03T10:00:00.000Z" };
const SCOPES = [
  { project: null, name: "Everywhere", claims: 1 },
  { project: "p2", name: "docs", cwd: "H:\\docs", claims: 0 },
  { project: "p1", name: "filament", cwd: "H:\\filament", claims: 3, dossier: 2 },
];
const counts = { standing: 3, review: 1, retired: 2, kinds: { all: 3, rules: 1, howto: 1, pitfalls: 1, decisions: 0, facts: 1, threads: 0 } };
const LIST = "/memory/claims?state=standing&project=p1";

const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
/** The page's collect window passed, and what it read answered. */
const heard = async () => {
  await new Promise((r) => setTimeout(r, 5));
  await settle();
};
/** A page of changes on the fan-out, chained after the one before (`n` its place). @param {number} n @param {any[]} changes */
const page = (n, ...changes) => ({ type: "claims", prev: `e1:${n - 1}`, last: `e1:${n}`, changes });
/** A change as the feed says it. @param {string | null} claim @param {string} action @param {string | null} project @param {Record<string, any>} [more] */
const change = (claim, action, project, more = {}) => ({ type: "change", id: "e1:0", claim, action, at: "2026-10-03T12:00:00.000Z", by: "learner", project, session: "c9", ...more });
/** The views' button whose words start so. @param {any} body @param {RegExp} words */
const view = (body, words) => [...body.querySelector('[aria-label="View"]').querySelectorAll("button")].find((b) => words.test(b.textContent));
/** A button by its words. @param {any} el @param {string} words */
const button = (el, words) => [...el.querySelectorAll("button")].find((b) => b.textContent === words);
/** The button of a class whose words start so. @param {any} body @param {string} cls @param {RegExp} words */
const oneOf = (body, cls, words) => [...body.querySelectorAll(`.${cls}`)].find((b) => words.test(b.textContent));

/** The page on the stub document over scripted routes, each call recorded; `say` hands the page a message of the fan-out. */
const open = async () => {
  /** @type {[string, any][]} */
  const calls = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    calls.push([path, init.body]);
    if (init.method === "POST") return { ok: true };
    const u = new URL(`http://x${path}`);
    if (u.pathname === "/memory/claims/scopes") return { scopes: SCOPES };
    if (u.pathname === "/memory/inbox") return { questions: u.searchParams.get("project") === "p1" ? [QUESTION] : [] };
    if (/^\/memory\/items\/\d+\/history$/.test(u.pathname))
      return { events: [{ at: "2026-10-01T09:00:00.000Z", action: "created", by: "person", detail: { status: "confirmed", kind: "rule" } }] };
    if (u.pathname === "/memory/claims") return { project: u.searchParams.get("project"), counts, claims: [RULE, HOWTO, FACT], more: 0 };
    throw Object.assign(new Error(`no route ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  /** @type {Set<(msg: any) => void>} */
  const listeners = new Set();
  const bus = (/** @type {(msg: any) => void} */ fn) => (listeners.add(fn), () => void listeners.delete(fn));
  const say = (/** @type {any} */ msg) => {
    for (const fn of [...listeners]) fn(msg);
  };
  const body = /** @type {any} */ (doc.document.createElement("div"));
  doc.document.body.append(body);
  lib.renderMemoryBrowser(body, { onToast: () => {}, getChain: () => "c1", scope: null }, { api, debounceMs: 0, bus, followMs: 0 });
  await settle();
  return { body, calls, say };
};

// (fails before: yes — each read placed its part anew whole: the card, its Confirm, the chip, the scope, the view and the field new elements, the field's words gone)
test("a change heard: the card, its Confirm, the chip, the field with its words, the scope and the view stand; a press on the chip and the Confirm that stood lands", async () => {
  const { body, calls, say } = await open();
  try {
    const scope = oneOf(body, "mset-scope", /^filament/);
    const search = body.querySelector(".mset-search");
    const chip = oneOf(body, "mset-chip", /^Facts/);
    const card = body.querySelector('[data-id="i7"]');
    const confirm = card?.querySelector('[aria-label="Confirm i7: it is right"]');
    const questions = view(body, /^Questions/);
    assert.ok(scope && search && chip && card && confirm && questions, "the scope, the field, a chip, a card, its Confirm and the Questions view");
    search.value = "port";
    calls.length = 0;
    // A claim of this workspace changed: its list read again, drawn on the elements that stood.
    say(page(1, change("i7", "evidence", "p1")));
    await heard();
    assert.deepEqual(calls.map(([p]) => p), [LIST], "the list read again");
    assert.equal(body.querySelector('[data-id="i7"]'), card, "the card that stood");
    assert.equal(card.querySelector('[aria-label="Confirm i7: it is right"]'), confirm, "its Confirm");
    assert.equal(oneOf(body, "mset-chip", /^Facts/), chip, "the chip that stood");
    assert.equal(body.querySelector(".mset-search"), search, "the field that stood");
    assert.equal(search.value, "port", "its words");
    // The counts and the questions read again: the scopes and the views drawn on the buttons that stood.
    calls.length = 0;
    say(page(2, change("i30", "status", null, { by: "curator" })));
    say(page(3, change("i7", "asked", "p1", { by: "curator" })));
    await heard();
    assert.deepEqual(calls.map(([p]) => p).sort(), [LIST, "/memory/claims/scopes", "/memory/inbox?project=p1"].sort(), "the counts, the questions and the list read again");
    assert.equal(oneOf(body, "mset-scope", /^filament/), scope, "the scope that stood");
    assert.equal(view(body, /^Questions/), questions, "the view that stood");
    assert.equal(questions.textContent, "Questions 1");
    // A press on the chip that stood narrows the list, and the chip stands through the read, pressed.
    chip.dispatch("click");
    await settle();
    assert.equal(calls.at(-1)?.[0], "/memory/claims?state=standing&kind=facts&project=p1");
    assert.equal(oneOf(body, "mset-chip", /^Facts/), chip, "the chip that stood, pressed");
    assert.equal(chip.getAttribute("aria-pressed"), "true");
    // A press on the Confirm that stood confirms the claim.
    confirm.dispatch("click");
    await settle();
    const post = calls.find(([, b]) => b !== undefined);
    assert.equal(post?.[0], "/memory/items/7");
    assert.equal(post?.[1]?.status, "confirmed");
  } finally {
    body.remove();
  }
});

// (fails before: yes — the editor was placed anew at the other card's History, and the Save its field marked was the draw's own, not the page's)
test("a claim's editor drawn again while open stands, and the Save its words mark is the one on the page", async () => {
  const { body, calls } = await open();
  try {
    body.querySelector('[aria-label="Correct i7"]').dispatch("click");
    const editor = body.querySelector(".is-editing");
    const field = editor?.querySelector("textarea");
    const save = editor && button(editor, "Save");
    assert.ok(editor && field && save, "the card is its editor");
    assert.equal(field.value, FACT.text);
    assert.ok(save.hasAttribute("disabled"), "nothing new said yet");
    // Another card's history opened: the list drawn again, the editor on the elements that stood.
    body.querySelector('[aria-label="History of i12"]').dispatch("click");
    await settle();
    assert.ok(calls.some(([p]) => p === "/memory/items/12/history"));
    assert.equal(body.querySelector(".is-editing"), editor, "the editor that stood");
    assert.equal(editor.querySelector("textarea"), field, "its field");
    assert.equal(button(editor, "Save"), save, "its Save");
    // New words in the field that stood: the Save that stood is the one marked.
    field.value = "the api listens on port 3000 in production";
    field.dispatch("input");
    assert.ok(!save.hasAttribute("disabled"), "Save, the words new");
    field.value = FACT.text;
    field.dispatch("input");
    assert.ok(save.hasAttribute("disabled"), "Save, the words as they were");
  } finally {
    body.remove();
  }
});

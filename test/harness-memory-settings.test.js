// @ts-check
// Settings › Memory and Library › Memory (HarnessV3-Memory M6-5; proposal_ux phase 7): in Settings, the model memory
// works with, the row to its door on Connect other apps and the row to the Library; in the Library, where claims live, a workspace's
// claims as cards by state and kind, each with how it is known, how sure memory is, its trigger and its history, and
// the owner's Confirm, Correct, Retire and Restore; the dossier by section with its claims as chips; and memory's
// questions. Every read and write goes through the memory routes, as the open session's (M6-D2). DOM-free: the fake
// `h`, a scripted `api` and a stand-in model picker; `open` draws the two pages one over the other.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderMemory, SIDE_WORDS, UNSET_WORDS } from "../src/ui/harness/settings/memory.js";
import { renderMemoryBrowser, scopeFor } from "../src/ui/harness/library/memory.js";
import { triggerParts, eventWords, whoWords } from "../src/ui/lib/claims.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

const RULE = {
  id: "i12", kind: "rule", text: "never run npm test bare here; run it as env -u CLAUDECODE npm test", status: "confirmed", trust: "user said", sure: 0.95, backed: 2, flags: [],
  triggers: [{ shape: "npm test", unless: "env -u CLAUDECODE", source: "words", fired: 3, followed: 1 }], fired: 3, followed: 1,
};
const HOWTO = { id: "i2", kind: "procedure", text: "How to cut a release: 1. `npm version patch` 2. `npm publish`", status: "confirmed", trust: "user said", sure: 0.95, backed: 1, flags: [] };
const FACT = { id: "i7", kind: "fact", text: "the api listens on port 3000", status: "inferred", trust: "inferred", sure: 0.3, backed: 1, flags: ["file changed since"] };
const GONE = { id: "i6", kind: "fact", text: "the docs site deploys to netlify", status: "dismissed", trust: "inferred", backed: 1, flags: [] };
const OLD = { id: "i5", kind: "fact", text: "we use pnpm", status: "superseded", trust: "user said", backed: 1, flags: [], replacedBy: "i20" };
const HELD = { id: "i8", kind: "fact", text: "the api now listens on port 8080", status: "dismissed", trust: "inferred", backed: 1, flags: ["would replace i7 if you say so"], asked: "q4" };
const QUESTION = { id: "q3", kind: "retire", proposal: { action: "retire", id: 7 }, reason: "its file src/api.js changed", claims: [{ id: "i7", text: FACT.text }], created: "2026-10-03T10:00:00.000Z" };
const SCOPES = [
  { project: null, name: "Everywhere", claims: 1 },
  { project: "p2", name: "docs", cwd: "H:\\docs", claims: 0 },
  { project: "p1", name: "filament", cwd: "H:\\filament", claims: 3, dossier: 2 },
];
const counts = { standing: 3, review: 1, retired: 2, kinds: { all: 3, rules: 1, howto: 1, pitfalls: 1, decisions: 0, facts: 1, threads: 0 } };

/**
 * The page on the fake DOM over scripted routes: each call recorded; a GET answered by its path, a POST by `posts`.
 * `gets` answers a GET first when it returns something (a promise it holds back included).
 * `scope`: the workspace the Library's page opens on.
 * @param {{ posts?: (path: string, body: any) => any, gets?: (u: URL) => any, scope?: string, dialog?: (d: any) => any }} [o]
 */
async function open(o = {}) {
  /** @type {[string, any][]} */
  const calls = [];
  /** @type {[string, string | undefined][]} */
  const toasts = [];
  /** @type {any[]} */
  const pickers = [];
  /** The effort chip's menus, each as it was opened. @type {any[][]} */
  const menus = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    calls.push([path, init.body]);
    if (init.method === "POST") return o.posts ? o.posts(path, init.body) : { ok: true };
    const u = new URL(`http://x${path}`);
    const own = o.gets?.(u);
    if (own !== undefined) return own;
    if (u.pathname === "/memory/claims/scopes") return { scopes: SCOPES };
    if (u.pathname === "/memory/models") return { models: { summarizer: "grok-4.6", effort: "", curatorUsesModel: true, now: "grok-4.6", from: "memory", whyNone: null } };
    if (u.pathname === "/memory/mcp") return { path: "/mcp/memory", keyed: true };
    if (u.pathname === "/models") return { models: [{ id: "grok-4.6" }, { id: "codex", codingAgent: true }] };
    if (u.pathname === "/memory/inbox") return { questions: u.searchParams.get("project") === "p1" ? [QUESTION] : [] };
    if (u.pathname === "/memory/dossier")
      return { project: "p1", version: 2, written: { at: "2026-10-03T09:00:00.000Z", model: "glm-5.3", run: "r4" }, lines: 2, hidden: 1, sections: [{ title: "Pitfalls", lines: [{ text: "Don't run npm test bare: use env -u CLAUDECODE.", cites: ["i12"], flags: ["✓2"] }] }, { title: "Facts", lines: [{ text: "The api listens on port 3000.", cites: ["i7"], flags: ["file changed since"] }] }] };
    if (/^\/memory\/items\/\d+\/history$/.test(u.pathname))
      return { events: [{ at: "2026-10-01T09:00:00.000Z", action: "created", by: "person", detail: { status: "confirmed", kind: "rule" } }, { at: "2026-10-02T09:00:00.000Z", action: "fired", by: "filament", detail: { chain: "c0", shape: "npm test", unless: "env -u CLAUDECODE" } }, { at: "2026-10-02T09:01:00.000Z", action: "followed", by: "filament", detail: { chain: "c0", shape: "npm test", unless: "env -u CLAUDECODE" } }] };
    if (u.pathname === "/memory/claims") {
      const state = u.searchParams.get("state");
      const list = !u.searchParams.get("project") ? [{ ...RULE, id: "i30", text: "Always answer in British English.", kind: "preference", triggers: undefined }] : state === "retired" ? [GONE, OLD, HELD] : state === "review" ? [FACT] : [RULE, HOWTO, FACT];
      return { project: u.searchParams.get("project"), counts, claims: list, more: 0 };
    }
    throw Object.assign(new Error(`no route ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const modelSelect = (/** @type {any} */ cb) => {
    const p = { cb, el: fakeH("span", { class: "fake-model" }), value: "", models: /** @type {any[]} */ ([]), note: /** @type {string | null} */ (null), locked: /** @type {string | null} */ (null) };
    pickers.push(p);
    return /** @type {any} */ ({ el: p.el, name: () => p.value, set: (/** @type {string} */ n) => { p.value = n; }, setModels: (/** @type {any[]} */ l) => { p.models = l; }, setFamilies: () => {}, setNote: (/** @type {string | null} */ n) => { p.note = n; }, setLocked: (/** @type {string | null} */ r) => { p.locked = r; }, open: () => {}, family: () => null });
  };
  // The events fan-out as the page hears it: `say` hands each listener a message.
  /** @type {Set<(msg: any) => void>} */
  const listeners = new Set();
  const bus = (/** @type {(msg: any) => void} */ fn) => (listeners.add(fn), () => void listeners.delete(fn));
  const say = (/** @type {any} */ msg) => {
    for (const fn of [...listeners]) fn(msg);
  };
  const settingsBody = /** @type {any} */ (fakeH("div", {}));
  const libraryBody = /** @type {any} */ (fakeH("div", {}));
  const body = /** @type {any} */ (fakeH("div", {}, settingsBody, libraryBody));
  const onToast = (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => void toasts.push([msg, kind]);
  renderMemory(settingsBody, { onToast, getChain: () => "c1" }, { h: /** @type {any} */ (fakeH), api, modelSelect, bus, menu: (/** @type {any[]} */ items) => void menus.push(items) });
  renderMemoryBrowser(libraryBody, { onToast, getChain: () => "c1", scope: o.scope ?? null }, { h: /** @type {any} */ (fakeH), drawIn: fakeDrawIn, api, debounceMs: 0, bus, followMs: 0, ...(o.dialog ? { dialog: o.dialog } : {}) });
  await settle();
  return { body, calls, toasts, pickers, menus, say, listeners };
}
const settle = async () => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setImmediate(r));
};
/** A button by its accessible name, or its text. @param {any} el @param {string} name */
const button = (el, name) => buttonsOf(el).find((b) => b.attrs["aria-label"] === name || textOf(b) === name);
/** Every node under `el` carrying a class. @param {any} el @param {string} cls @returns {any[]} */
const all = (el, cls) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (String(n.attrs?.class || "").split(/\s+/).includes(cls)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
const posts = (/** @type {[string, any][]} */ calls) => calls.filter(([, b]) => b !== undefined);
/** The memory browser's own frame: In new chats stands over it with a segmented control of its own. @param {any} body */
const frame = (body) => all(body, "mset-frame")[0];

test("opened: the busiest workspace's standing claims, as cards with how each is known and how sure; the views; Everywhere first", async () => {
  const { body, calls } = await open();
  const scopes = all(body, "mset-scope").map((s) => textOf(s));
  assert.deepEqual(scopes, ["Everywhere|1", "docs|0", "filament|3"]);
  assert.ok(all(body, "mset-scope").find((s) => textOf(s).startsWith("filament"))?.attrs.class.includes(" on"), "the busiest is picked");
  assert.ok(calls.some(([p]) => p === "/memory/claims?state=standing&project=p1"), calls.map((c) => c[0]).join("\n"));
  const head = textOf(all(body, "mset-head")[0]);
  assert.ok(head.includes("filament|H:\\filament"), head);
  assert.deepEqual(all(frame(body), "set-seg")[0].kids.map((/** @type {any} */ b) => textOf(b)), ["Memories", "Dossier", "Questions 1", "Models"]);
  assert.deepEqual(all(frame(body), "set-seg")[1].kids.map((/** @type {any} */ b) => textOf(b)), ["Standing 3", "To review 1", "Retired 2"]);
  assert.deepEqual(all(body, "mset-chip").map((c) => textOf(c)), ["All|3", "Rules|1", "How to|1", "Pitfalls|1", "Decisions|0", "Facts|1", "Threads|0"]);
  const cards = all(body, "mset-claim");
  assert.equal(cards.length, 3);
  const rule = textOf(cards[0]);
  for (const want of [RULE.text, "Rule · i12", "user said", "✓2", "95% sure", "On |npm test| · the right way: |env -u CLAUDECODE| · said 3 times| · followed 1 time"]) assert.ok(rule.includes(want), `${want}\n${rule}`);
  assert.equal(textOf(cards[1]).split("|")[0], HOWTO.text, "a procedure whole");
  const fact = textOf(cards[2]);
  assert.ok(fact.includes("30% sure") && fact.includes("file changed since"), fact);
  assert.ok(all(cards[2], "mset-meter")[0].attrs.class.includes("is-low"), "under the line: recall leaves it out");
  assert.equal(button(body, "Confirm i12: it is right"), undefined, "confirmed, and nothing changed");
  for (const name of ["Confirm i7: it is right", "Correct i7", "Retire i7: it is not true", "History of i7", "Correct i12", "Retire i12: it is not true"]) assert.ok(button(body, name), name);
});

// (fails before: yes — HarnessV4_Skills_Plan step 4: no memory could go into a skill)
test("Add to a skill…: on a standing memory of guidance, not a retired one; it opens the dialog that shows where its words go", async () => {
  /** @type {any[]} */
  const dialogs = [];
  const { body } = await open({ dialog: (d) => { dialogs.push(d); return { close() {} }; } });
  for (const id of ["i12", "i2", "i7"]) assert.ok(button(body, `Add ${id} to a skill…`), id);
  button(body, "Add i2 to a skill…").dispatch("click");
  assert.equal(dialogs[0]?.title, "Add i2 to a skill");
  const retired = await open({ gets: (u) => (u.pathname === "/memory/claims" ? { project: "p1", counts, claims: [GONE, { ...RULE, id: "i40", kind: "thread", text: "Check the logs." }], more: 0 } : undefined) });
  assert.equal(button(retired.body, "Add i6 to a skill…"), undefined, "retired: no");
  assert.equal(button(retired.body, "Add i40 to a skill…"), undefined, "a thread is work in flight, not guidance");
});

test("the owner's word: Confirm, Retire and Correct through their routes as the open session's; then the page reads again", async () => {
  const { body, calls, toasts } = await open({ posts: (path) => (path.endsWith("/correct") ? { ok: true, id: "i40", replaces: "i7" } : { ok: true }) });
  calls.length = 0;
  button(body, "Confirm i7: it is right").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/items/7", { status: "confirmed", session: "c1" }]]);
  assert.ok(calls.some(([p]) => p === "/memory/claims/scopes") && calls.some(([p]) => p === "/memory/inbox?project=p1") && calls.some(([p]) => p.startsWith("/memory/claims?")), "read again");
  calls.length = 0;
  button(body, "Retire i12: it is not true").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/forget", { id: "i12", reason: "retired in the Library", session: "c1" }]]);
  assert.deepEqual(toasts.at(-1), ["i12 retired: kept as history", undefined]);
  // Correct: the words in place; Save only once they say something new; Esc puts the card back.
  calls.length = 0;
  button(body, "Correct i7").dispatch("click");
  const field = all(body, "mset-field")[0];
  assert.equal(field.value, FACT.text);
  const save = () => button(body, "Save");
  assert.equal(save()?.attrs.disabled, "", "unchanged: nothing to save");
  save()?.dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [], "nothing sent");
  field.dispatch("keydown", { key: "Escape" });
  assert.equal(all(body, "mset-field").length, 0, "Esc: the card again");
  button(body, "Correct i7").dispatch("click");
  const again = all(body, "mset-field")[0];
  again.dispatch("input", { target: { value: "the api listens on port 8080" } });
  assert.equal("disabled" in (save()?.attrs || {}), false, "new words: Save");
  again.dispatch("keydown", { key: "Enter", ctrlKey: true });
  await settle();
  assert.deepEqual(posts(calls), [["/memory/items/7/correct", { text: "the api listens on port 8080", reason: "corrected in Settings", session: "c1" }]]);
  assert.deepEqual(toasts.at(-1), ["i40 replaces i7", undefined]);
  assert.equal(all(body, "mset-field").length, 0, "saved: the card again");
});

test("a refusal is said in a toast, in the route's words", async () => {
  const { body, toasts } = await open({ posts: () => ({ ok: false, error: "i12 is already superseded by i20" }) });
  button(body, "Retire i12: it is not true").dispatch("click");
  await settle();
  assert.deepEqual(toasts.at(-1), ["i12 is already superseded by i20", "err"]);
  const thrown = await open({ posts: () => { throw Object.assign(new Error("Conflict"), { status: 409, body: { error: "the new text is the old one" } }); } });
  button(thrown.body, "Confirm i7: it is right").dispatch("click");
  await settle();
  assert.deepEqual(thrown.toasts.at(-1), ["the new text is the old one", "err"]);
});

test("the state, the kind and the words narrow the list, each read from the route", async () => {
  const { body, calls } = await open();
  calls.length = 0;
  button(body, "To review 1").dispatch("click");
  await settle();
  assert.deepEqual(calls.map((c) => c[0]), ["/memory/claims?state=review&project=p1"]);
  assert.deepEqual(all(body, "mset-claim").map((c) => c.attrs["data-id"]), ["i7"]);
  calls.length = 0;
  buttonsOf(body).find((b) => textOf(b) === "Pitfalls|1")?.dispatch("click");
  await settle();
  assert.deepEqual(calls.map((c) => c[0]), ["/memory/claims?state=review&kind=pitfalls&project=p1"]);
  calls.length = 0;
  all(body, "mset-search")[0].dispatch("input", { target: { value: " port 3000 " } });
  await settle();
  assert.deepEqual(calls.map((c) => c[0]), ["/memory/claims?state=review&kind=pitfalls&q=port%203000&project=p1"]);
});

test("retired: Restore brings one back as the owner's word; a replaced one names what replaced it; neither is corrected", async () => {
  const { body, calls, toasts } = await open();
  button(body, "Retired 2").dispatch("click");
  await settle();
  assert.deepEqual(all(body, "mset-claim").map((c) => [c.attrs["data-id"], c.attrs.class]), [["i6", "mset-claim is-retired"], ["i5", "mset-claim is-retired"], ["i8", "mset-claim is-held"]]);
  assert.ok(button(body, "Restore i6: it holds after all"));
  // Held for the user's answer (M6-D16): not struck, not restored here — the question is where it is answered (M6-7).
  const held = all(body, "mset-claim")[2];
  assert.equal(button(held, "Restore i8: it holds after all"), undefined);
  assert.ok(textOf(held).includes("would replace i7 if you say so") && textOf(held).includes("held for your answer"), textOf(held));
  assert.ok(!textOf(all(body, "mset-claim")[0]).includes("held for your answer") && textOf(all(body, "mset-claim")[0]).includes("retired"));
  assert.equal(button(body, "Restore i5: it holds after all"), undefined, "a replaced claim stands in its replacement");
  assert.equal(button(body, "Correct i6"), undefined);
  assert.equal(button(body, "replaced by i20")?.attrs.title, "Show i20", "what replaced it, a chip that opens it");
  calls.length = 0;
  button(body, "Restore i6: it holds after all").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/items/6", { status: "confirmed", session: "c1" }]]);
  assert.deepEqual(toasts.at(-1), ["i6 stands again", undefined]);
});

test("a claim's history opens in place, in words, and closes again", async () => {
  const { body, calls } = await open();
  button(body, "History of i12").dispatch("click");
  await settle();
  assert.ok(calls.some(([p]) => p === "/memory/items/12/history"));
  const h = all(body, "mset-history")[0];
  assert.equal(h.attrs["aria-label"], "History of i12");
  const said = textOf(h);
  for (const want of ["Filed confirmed by you", "Said at a call: npm test", "The right way was taken: env -u CLAUDECODE"]) assert.ok(said.includes(want), `${want}\n${said}`);
  button(body, "Hide the history of i12").dispatch("click");
  assert.equal(all(body, "mset-history").length, 0);
});

test("the dossier by section, its claims as chips that open them; Rewrite now runs the curator and says what it did", async () => {
  const { body, calls, toasts } = await open({ posts: (path) => (path === "/memory/curator/run" ? { run: "r5", actions: 2, questions: 1 } : { ok: true }) });
  button(body, "Dossier").dispatch("click");
  await settle();
  assert.ok(calls.some(([p]) => p === "/memory/dossier?project=p1"));
  const tools = textOf(all(body, "mset-tools")[0]);
  assert.ok(tools.includes("Version 2") && tools.includes("by glm-5.3") && tools.includes("1 line hidden: a memory it rests on changed or was retired"), tools);
  assert.deepEqual(all(body, "mset-dsec-title").map((t) => textOf(t)), ["Pitfalls", "Facts"]);
  const lines = all(body, "mset-dline").map((l) => textOf(l));
  assert.deepEqual(lines, ["Don't run npm test bare: use env -u CLAUDECODE.|i12", "The api listens on port 3000.|i7|file changed since"], "✓n is the card's to say, not the line's");
  calls.length = 0;
  button(body, "Rewrite now").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls)[0], ["/memory/curator/run", { project: "p1" }]);
  assert.deepEqual(toasts.at(-1), ["The curator's pass r5: 2 changes, 1 question", undefined]);
  calls.length = 0;
  buttonsOf(body).find((b) => textOf(b) === "i7")?.dispatch("click");
  await settle();
  assert.deepEqual(calls.map((c) => c[0]), ["/memory/claims?state=standing&q=i7&project=p1"], "a chip opens its claim, to confirm, correct or retire there");
});

test("memory's questions, answered in place", async () => {
  const { body, calls } = await open();
  button(body, "Questions 1").dispatch("click");
  await settle();
  assert.ok(textOf(all(body, "mset-list")[0]).includes("Retire “the api listens on port 3000”"));
  calls.length = 0;
  button(body, "Accept q3: Retire “the api listens on port 3000”").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/inbox/q3", { answer: "accept", session: "c1" }]]);
});

test("Add: remembered as the owner's word where the page stands; Save waits for words; a refusal keeps them to fix", async () => {
  const FORM = 'memory: a procedure reads "How to <goal>: 1. <step> 2. <step>"';
  const { body, calls, toasts } = await open({
    posts: (path, b) => {
      if (path !== "/memory/remember") return { ok: true };
      if (b.kind === "procedure" && !/^How to /.test(b.text)) throw Object.assign(new Error(FORM), { status: 400, body: { error: FORM } });
      return { id: "i40", itemId: 40 };
    },
  });
  button(body, "Add").dispatch("click");
  const card = () => all(body, "is-editing")[0];
  assert.ok(textOf(card()).startsWith("Remember, in filament, as your word"), textOf(card()));
  assert.ok("disabled" in button(body, "Add").attrs, "one at a time");
  assert.ok("disabled" in button(body, "Save").attrs, "nothing to save yet");
  // ...and they look it: the harness dims a small button that is disabled (M6-7: Save looked live on an empty field).
  assert.match(readFileSync(new URL("../src/ui/harness.css", import.meta.url), "utf8"), /^button\.sm:disabled \{ opacity: 0\.45; cursor: default; \}$/m);
  button(card(), "How to").dispatch("click");
  const field = () => all(card(), "mset-field")[0];
  assert.equal(field().attrs.placeholder, "How to <goal>: 1. <step> 2. <step>");
  field().dispatch("input", { target: { value: "release: npm test" } });
  assert.ok(!("disabled" in button(body, "Save").attrs));
  calls.length = 0;
  button(body, "Save").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/remember", { text: "release: npm test", kind: "procedure", project: "p1", session: "c1" }]]);
  assert.deepEqual(toasts.at(-1), [FORM, "err"]);
  assert.equal(field().value, "release: npm test", "the words stay, to fix");
  field().dispatch("input", { target: { value: "How to release: 1. npm test 2. npm run build" } });
  calls.length = 0;
  button(body, "Save").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/remember", { text: "How to release: 1. npm test 2. npm run build", kind: "procedure", project: "p1", session: "c1" }]]);
  assert.deepEqual(toasts.at(-1), ["i40 remembered: it counts as your word", undefined]);
  assert.equal(card(), undefined, "closed once memory has it");
  assert.ok(calls.some(([p]) => p === "/memory/claims?state=standing&project=p1"), "the list read again");
  // Another place picked while adding: the words go there instead. Everywhere: no project.
  button(body, "Add").dispatch("click");
  assert.equal(field().value, "", "a new one starts empty: the last one's words are memory's now");
  field().dispatch("input", { target: { value: "Always answer in British English." } });
  all(body, "mset-scope")[0].dispatch("click");
  await settle();
  assert.ok(textOf(card()).startsWith("Remember, everywhere, as your word"));
  assert.equal(field().value, "Always answer in British English.");
  calls.length = 0;
  button(body, "Save").dispatch("click");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/remember", { text: "Always answer in British English.", kind: "rule", session: "c1" }]]);
  // The dossier offers Add beside Rewrite now.
  all(body, "mset-scope")[2].dispatch("click");
  await settle();
  button(body, "Dossier").dispatch("click");
  await settle();
  assert.ok(button(all(body, "mset-tools")[0], "Add") && button(all(body, "mset-tools")[0], "Rewrite now"));
});

test("the page lays out by its own width, not the window's; a claim's actions ride its meta row, so its words take the card's width (M6-7)", async () => {
  const { body } = await open();
  const frame = all(body, "mset-frame");
  assert.equal(frame.length, 1);
  assert.equal(all(frame[0], "mset").length, 1, "the two columns sit in the frame they read their width from");
  const cards = all(body, "mset-claim");
  assert.equal(cards.length, 3);
  for (const card of cards) {
    const own = card.kids.filter((/** @type {any} */ k) => String(k?.attrs?.class || "").split(/\s+/).includes("mset-acts"));
    assert.deepEqual(own, [], "no column of actions beside the words");
    const meta = all(card, "mset-claim-meta")[0];
    assert.equal(meta.kids.at(-1)?.attrs.class, "mset-acts", "the actions end the meta row");
    assert.ok(button(meta, `History of ${card.attrs["data-id"]}`));
  }
  // The sheet: the frame is a size container, and the columns stack by its width — beside the sidebars a 960px window
  // leaves the page some 450px, which a window-wide @media never sees. 599: side by side, a card keeps some 320px.
  const css = readFileSync(new URL("../src/ui/harness/settings/settings.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(css, /\.mset-frame \{[^}]*container: mset \/ inline-size;/);
  const at = css.indexOf("@container mset (max-width: 599px) {");
  assert.ok(at >= 0, "the columns stack by the frame's width");
  assert.match(blockAt(css, at), /\.mset \{ flex-direction: column; \}/);
  for (const m of css.matchAll(/@media[^{]*width[^{]*\{/g)) assert.ok(!/\.mset/.test(blockAt(css, m.index)), `a window-wide rule lays memory out: ${blockAt(css, m.index)}`);
  // With a pointer the actions float over the card's edge: hidden, they hold no line of their own under the meta.
  const hover = blockAt(css, css.indexOf("@media (hover: hover) {"));
  assert.match(hover, /\.mset-claim \{ position: relative; \}/);
  assert.match(hover, /\.mset-claim-meta \.mset-acts \{[^}]*position: absolute;[^}]*pointer-events: none;/);
  assert.match(hover, /\.mset-claim:hover \.mset-claim-meta \.mset-acts, \.mset-claim:focus-within \.mset-claim-meta \.mset-acts \{ pointer-events: auto; \}/);
});

/** The text of the block a rule at `at` opens, braces balanced. @param {string} css @param {number} at */
function blockAt(css, at) {
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(at, i + 1);
  }
  return css.slice(at);
}

test("Everywhere: the global claims, with no dossier", async () => {
  const { body, calls } = await open();
  calls.length = 0;
  all(body, "mset-scope")[0].dispatch("click");
  await settle();
  assert.ok(calls.some(([p]) => p === "/memory/claims?state=standing"), calls.map((c) => c[0]).join("\n"));
  assert.ok(calls.some(([p]) => p === "/memory/inbox"));
  assert.deepEqual(all(frame(body), "set-seg")[0].kids.map((/** @type {any} */ b) => textOf(b)), ["Memories", "Questions", "Models"]);
  assert.ok(textOf(all(body, "mset-head")[0]).includes("Claims that hold in every project"));
  assert.deepEqual(all(body, "mset-claim").map((c) => c.attrs["data-id"]), ["i30"]);
});

// (fails before: yes — the memory plan's m1: a side model and Curates with, two pickers, and no effort)
// (the owner's of 11-09: memory is core — the curator's switch and the one that turned memory's model off went)
test("the model: one picker over every route and an effort chip, low where none is picked; no switch beside it, and none for the curator", async () => {
  const { body, calls, pickers, menus } = await open();
  assert.equal(pickers.length, 1, "memory has one model: the curator's picker went");
  const [learns] = pickers;
  assert.deepEqual([learns.value, learns.note, learns.locked, learns.cb.defaultDesc], ["grok-4.6", null, null, UNSET_WORDS]);
  assert.deepEqual(learns.models.map((/** @type {any} */ x) => x.id), ["grok-4.6", "codex"], "a coding agent's model is offered: memory reaches it through a provider's route (m1)");
  const rows = all(body, "settings-row").map((r) => textOf(all(r, "settings-row-label")[0]));
  assert.deepEqual(rows, ["Model", "Other agents", "What memory holds"]);
  assert.equal(all(body, "set-switch").length, 0, "no switch: neither memory's model nor the curator is turned off here");
  assert.match(textOf(all(all(body, "settings-row")[0], "settings-row-desc")[0]), /It is first for every memory call\.$/);
  const chip = buttonsOf(body).find((b) => b.attrs["aria-label"] === "Memory's effort");
  assert.ok(chip, "the effort's chip beside the picker, never a <select>");
  assert.match(chip.attrs.title, /^Memory's effort: Low/);
  calls.length = 0;
  learns.cb.onChange("glm-5.3");
  await settle();
  assert.deepEqual(posts(calls), [["/memory/models", { summarizer: "glm-5.3" }]]);
  calls.length = 0;
  learns.cb.onUseDefault();
  await settle();
  assert.deepEqual(posts(calls), [["/memory/models", { summarizer: "" }]], "use the default: not set");
  calls.length = 0;
  buttonsOf(body).find((b) => b.attrs["aria-label"] === "Memory's effort")?.dispatch("click");
  const high = menus.at(-1)?.find((/** @type {any} */ x) => x.type === "radio" && /^High/.test(x.label));
  assert.ok(high, JSON.stringify(menus.at(-1)?.map((/** @type {any} */ x) => x.label)));
  high.onClick();
  await settle();
  assert.deepEqual(posts(calls), [["/memory/models", { effort: "high" }]]);
});

// (fails before: yes — the owner's of 11-09: memory's door stood whole on this page and on Connect other apps; it is
// Connect's, where the other apps are, and this page links there. Its command and Copy: harness-filament-pages)
test("Other agents (M7-D46): a row that opens Settings › Connect other apps, where memory's door is; the door is not read here", async () => {
  const { body, calls } = await open();
  const agents = all(body, "settings-row").find((r) => textOf(all(r, "settings-row-label")[0]) === "Other agents");
  assert.equal(all(agents, "mset-connect")[0]?.attrs.href, "#/settings/connect");
  assert.equal(all(body, "mset-mcp").length, 0, "no command here");
  assert.ok(!calls.some(([p]) => p === "/memory/mcp"));
});

test("the words: a trigger with its commands apart; a history's events; who did it", () => {
  assert.deepEqual(triggerParts({ shape: "git push", args: "--force", unless: "--force-with-lease", fired: 0 }), ["On ", { code: "git push --force" }, " · the right way: ", { code: "--force-with-lease" }, " · not said yet"]);
  assert.deepEqual(triggerParts({ shape: "deploy", fired: 1 }), ["On ", { code: "deploy" }, " · said once a session", " · said 1 time"]);
  assert.deepEqual(triggerParts({ shape: "npm test", unless: "env -u X", fired: 2, followed: 0 }).at(-1), " · not followed yet");
  // (fails before: yes — a rule kept from the briefing read "not said yet" and nothing more, M7-D63)
  assert.deepEqual(triggerParts({ shape: "npm test", unless: "env -u X", fired: 0, followed: 0, kept: 3 }).slice(4), [" · not said yet", " · kept 3 times without a reminder"]);
  assert.deepEqual(triggerParts({ shape: "npm test", unless: "env -u X", fired: 2, followed: 1, kept: 1 }).slice(4), [" · said 2 times", " · followed 1 time", " · kept 1 time without a reminder"]);
  assert.deepEqual(triggerParts({ shape: "deploy", fired: 1, kept: 2 }).length, 4, "a trigger with no right way keeps nothing");
  assert.equal(eventWords({ action: "kept", by: "filament", detail: { shape: "npm test", unless: "env -u CLAUDECODE" } }), "Kept without a reminder: env -u CLAUDECODE");
  assert.equal(eventWords({ action: "status", by: "curator", detail: { from: "inferred", to: "superseded", replacement: 9 } }), "Replaced by i9 by the curator");
  assert.equal(eventWords({ action: "status", by: "owner", detail: { from: "dismissed", to: "confirmed" } }), "Brought back by you");
  assert.equal(eventWords({ action: "status", by: "learner", detail: { from: "inferred", to: "dismissed" } }), "Retired by the learner");
  assert.equal(eventWords({ action: "checked", by: "curator", detail: { verdict: "wrong" } }), "Checked against its files: they say otherwise by the curator");
  assert.equal(eventWords({ action: "anchor", by: "filament", detail: { file: "src/api.js", state: "symbol", symbol: "listen" } }), "src/api.js no longer has listen");
  assert.equal(eventWords({ action: "anchor", by: "filament", detail: { file: "src/api.js", state: "gone" } }), "Its file src/api.js is gone");
  assert.equal(eventWords({ action: "evidence", by: "learner", detail: { chain: "c9" } }), "Said again in session c9");
  assert.equal(eventWords({ action: "closed", by: "person", detail: {} }), "Closed: the work was done by you");
  assert.equal(eventWords({ action: "brand-new", by: "agent" }), "brand-new by an agent");
  assert.deepEqual([whoWords("correction"), whoWords("someone"), whoWords(null), whoWords("subagent")], ["your correction", "someone", "", "a sub-agent"]);
});

test("Add's Cancel drops the kind picked: the next one starts as a rule", async () => {
  const { body } = await open();
  const card = () => all(body, "is-editing")[0];
  button(body, "Add").dispatch("click");
  button(card(), "How to").dispatch("click");
  button(card(), "Cancel").dispatch("click");
  assert.equal(card(), undefined);
  button(body, "Add").dispatch("click");
  assert.deepEqual(all(card(), "set-seg-btn").filter((b) => b.attrs.class.includes(" on")).map((b) => textOf(b)), ["Rule"]);
});

test("Rewrite now that does not run says why", async () => {
  const { body, toasts } = await open({ posts: (path) => (path === "/memory/curator/run" ? { skipped: "the curator is off" } : { ok: true }) });
  button(body, "Dossier").dispatch("click");
  await settle();
  button(body, "Rewrite now").dispatch("click");
  await settle();
  assert.deepEqual(toasts.at(-1), ["The curator did not run: the curator is off", "err"]);
});

test("a read overtaken by a newer one is dropped: the list is the last one asked for", async () => {
  /** @type {(v: any) => void} */
  let late = () => {};
  const { body } = await open({ gets: (u) => (u.pathname === "/memory/claims" && u.searchParams.get("state") === "review" ? new Promise((r) => (late = r)) : undefined) });
  button(body, "To review 1").dispatch("click");
  await settle();
  button(body, "Retired 2").dispatch("click");
  await settle();
  late({ project: "p1", counts, claims: [FACT], more: 0 });
  await settle();
  button(body, "Add").dispatch("click"); // draws the list again from what the page holds
  assert.deepEqual(all(body, "mset-claim").filter((c) => c.attrs["data-id"]).map((c) => c.attrs["data-id"]), ["i6", "i5", "i8"]);
});

test("Everywhere picked from the dossier opens its memories: there is no dossier of everywhere", async () => {
  const { body, calls } = await open();
  button(body, "Dossier").dispatch("click");
  await settle();
  calls.length = 0;
  all(body, "mset-scope")[0].dispatch("click");
  await settle();
  assert.ok(!calls.some(([p]) => p.startsWith("/memory/dossier")), calls.map((c) => c[0]).join("\n"));
  assert.deepEqual(all(frame(body), "set-seg")[0].kids.filter((/** @type {any} */ b) => b.attrs.class.includes(" on")).map((/** @type {any} */ b) => textOf(b)), ["Memories"]);
  assert.deepEqual(all(body, "mset-claim").map((c) => c.attrs["data-id"]), ["i30"]);
});

test("another place picked starts its list afresh: no search carried over", async () => {
  const { body, calls } = await open();
  const search = all(body, "mset-search")[0];
  search.value = "port";
  search.dispatch("input", { target: { value: "port" } });
  await settle();
  calls.length = 0;
  all(body, "mset-scope")[0].dispatch("click");
  await settle();
  assert.ok(calls.some(([p]) => p === "/memory/claims?state=standing"), calls.map((c) => c[0]).join("\n"));
  assert.equal(search.value, "");
});

test("a replaced claim's chip opens what replaced it among the standing ones, whatever the list showed", async () => {
  const { body, calls } = await open();
  button(body, "Retired 2").dispatch("click");
  await settle();
  buttonsOf(body).find((b) => textOf(b) === "Pitfalls|1")?.dispatch("click");
  await settle();
  calls.length = 0;
  button(body, "replaced by i20").dispatch("click");
  await settle();
  assert.deepEqual(calls.map((c) => c[0]), ["/memory/claims?state=standing&q=i20&project=p1"]);
  assert.equal(all(body, "mset-search")[0].value, "i20");
});

// (the owner's of 11-09: its switch went; turned off elsewhere — the command line — it is said, and a pick, or Not set,
// has memory learn again)
test("memory's model not set: each chat's own, said; off is said, the picker stays open, and a pick or Not set turns it back on", async () => {
  /** A models row's words. @param {any} body @param {string} label */
  const desc = (body, label) => textOf(all(all(body, "settings-row").find((r) => textOf(all(r, "settings-row-label")[0]) === label), "settings-row-desc")[0]);
  /** The page as memory's models are. @param {any} models */
  const with_ = (models) => open({ gets: (u) => (u.pathname === "/memory/models" ? { models } : undefined) });
  let w = await with_({ summarizer: "", effort: "", curatorUsesModel: true, now: "grok-4.6", from: "default", whyNone: null });
  assert.deepEqual([w.pickers[0].value, w.pickers[0].note, w.pickers[0].locked], ["", null, null], "nothing set: the picker names none");
  assert.equal(desc(w.body, "Model"), `${UNSET_WORDS}; where no chat is named, grok-4.6. Pick one to give memory a model of its own.`);
  assert.doesNotMatch(desc(w.body, "Model"), /cheapest|price/);
  assert.match(SIDE_WORDS, /memory reads each finished session with it.*Settings › Experimental can have it name chats/i);
  assert.equal(buttonsOf(w.body).find((b) => b.attrs["aria-label"] === "Memory uses a model"), undefined, "no switch turns it off");

  w = await with_({ summarizer: "off", effort: "", curatorUsesModel: true, now: null, from: "off", whyNone: "memory's model is off (Settings › Memory › Model)" });
  assert.deepEqual([w.pickers[0].value, w.pickers[0].locked, w.pickers[0].note], ["", null, null], "off: the picker names none, and stays open");
  assert.equal(desc(w.body, "Model"), "Off: memory learns nothing from finished sessions, and no chat is named by it. Pick a model, or Not set, and it learns again.");
  assert.equal(buttonsOf(w.body).find((b) => b.attrs["aria-label"] === "Memory's effort")?.hidden, true, "no effort to pick for no model");
  w.calls.length = 0;
  w.pickers[0].cb.onUseDefault();
  await settle();
  assert.deepEqual(posts(w.calls), [["/memory/models", { summarizer: "" }]], "back on: not set, each chat's own");
});

// (fails before: yes — L2's tour, tour4: with no model able to answer, Learns with said to pick one, with none to pick)
test("memory's model, with nothing to call: what to do, never a price", async () => {
  /** A models row's words. @param {any} body @param {string} label */
  const desc = (body, label) => textOf(all(all(body, "settings-row").find((r) => textOf(all(r, "settings-row-label")[0]) === label), "settings-row-desc")[0]);
  const ms = { summarizer: "", effort: "", curatorUsesModel: true, now: null, from: "none", whyNone: "no model to call: set one in Settings › Memory › Model" };
  const { body } = await open({ gets: (u) => (u.pathname === "/memory/models" ? { models: ms } : u.pathname === "/models" ? { models: [] } : undefined) });
  assert.equal(desc(body, "Model"), `${UNSET_WORDS}, and none is one memory can call: pick one here, or chat on a model a provider serves (a coding agent's alone is none).`, "on its own page: no word sends you to it");
});

test("an archived workspace shows while memories stand in it; an empty one goes", async () => {
  const more = [{ project: "p3", name: "old", cwd: "H:\old", claims: 0, archived: true }, { project: "p4", name: "kept", cwd: "H:\kept", claims: 2, archived: true }];
  const { body } = await open({ gets: (u) => (u.pathname === "/memory/claims/scopes" ? { scopes: [...SCOPES, ...more] } : undefined) });
  const scopes = all(body, "mset-scope");
  assert.deepEqual(scopes.map((s) => textOf(s)), ["Everywhere|1", "docs|0", "filament|3", "kept|2"]);
  assert.ok(scopes[3].attrs.class.includes("is-archived"));
});

test("with no workspace holding a memory, the page opens on Everywhere", async () => {
  const { body, calls } = await open({ gets: (u) => (u.pathname === "/memory/claims/scopes" ? { scopes: SCOPES.map((s) => (s.project ? { ...s, claims: 0 } : s)) } : undefined) });
  assert.ok(calls.some(([p]) => p === "/memory/claims?state=standing"), calls.map((c) => c[0]).join("\n"));
  assert.ok(!calls.some(([p]) => p.startsWith("/memory/claims?") && p.includes("project=")));
  assert.ok(all(body, "mset-scope")[0].attrs.class.includes(" on"));
});

test("a claim held back from recall says so; more than the list holds is counted; an undone event is marked", async () => {
  const { body } = await open({
    gets: (u) => {
      if (u.pathname === "/memory/claims" && u.searchParams.get("project") === "p1" && u.searchParams.get("state") === "standing")
        return { project: "p1", counts, claims: [{ ...FACT, held: true, flags: ["file gone"] }], more: 4 };
      if (u.pathname === "/memory/items/7/history")
        return { events: [{ at: "2026-10-02T09:00:00.000Z", action: "status", by: "curator", detail: { from: "inferred", to: "dismissed" }, undone: "2026-10-02T10:00:00.000Z" }] };
      return undefined;
    },
  });
  const card = all(body, "mset-claim")[0];
  assert.ok(textOf(card).includes("held back from recall") && textOf(card).includes("file gone"), textOf(card));
  assert.ok(textOf(all(body, "mset-list")[0]).includes("…and 4 more: a search or a kind narrows them."));
  button(body, "History of i7").dispatch("click");
  await settle();
  const ev = all(body, "mset-event")[0];
  assert.equal(ev.attrs.class, "mset-event is-undone");
  assert.ok(textOf(ev).includes("Retired by the curator") && textOf(ev).includes("(undone)"), textOf(ev));
});

test("an empty list says why, by what was asked", async () => {
  const { body } = await open({ gets: (u) => (u.pathname === "/memory/claims" && u.searchParams.get("project") === "p1" ? { project: "p1", counts, claims: [], more: 0 } : undefined) });
  const said = () => textOf(all(body, "mset-list")[0]);
  assert.match(said(), /^No memories here yet\. They come as you work/);
  button(body, "To review 1").dispatch("click");
  await settle();
  assert.equal(said(), "Nothing to review: no memory here is flagged, held back or unsure.");
  button(body, "Retired 2").dispatch("click");
  await settle();
  assert.equal(said(), "Nothing retired here.");
  button(body, "Standing 3").dispatch("click");
  await settle();
  buttonsOf(body).find((b) => textOf(b) === "Facts|1")?.dispatch("click");
  await settle();
  assert.equal(said(), "No facts here yet.");
  all(body, "mset-search")[0].dispatch("input", { target: { value: "port" } });
  await settle();
  assert.equal(said(), "No memory here says that.");
});

// ---- live (HarnessV3-Memory M7-D37): memory's changes, heard on the events fan-out ----
/** A page of changes on the fan-out, chained after the one before (`n` its place). @param {number} n @param {any[]} changes */
const page = (n, ...changes) => ({ type: "claims", prev: `e1:${n - 1}`, last: `e1:${n}`, changes });
/** A change as the feed says it. @param {string | null} claim @param {string} action @param {string | null} project @param {Record<string, any>} [more] */
const change = (claim, action, project, more = {}) => ({ type: "change", id: "e1:0", claim, action, at: "2026-10-03T12:00:00.000Z", by: "learner", project, session: "c9", ...more });
/** The page's collect window passed, and what it read answered. */
const heard = async () => {
  await new Promise((r) => setTimeout(r, 5));
  await settle();
};
/** What was read, sorted. @param {[string, any][]} calls */
const reads = (calls) => calls.map(([p]) => p).sort();
const LIST = "/memory/claims?state=standing&project=p1";

test("a change memory makes is read again where this page shows it, and nowhere else: its list, the counts, an open history (M7-D37)", async () => {
  const { body, calls, say } = await open();
  calls.length = 0;
  say(page(1, change("i99", "evidence", "p2")));
  await heard();
  assert.deepEqual(reads(calls), [], "another workspace's claim: nothing read");
  say(page(2, change("i7", "evidence", "p1")));
  await heard();
  assert.deepEqual(reads(calls), [LIST], "a claim of this workspace: its list, nothing else");
  calls.length = 0;
  say(page(3, change("i30", "status", null, { by: "curator" })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes"], "a global claim retired: the counts, not this workspace's list");
  calls.length = 0;
  say(page(4, change("i7", "moved", "p2", { by: "owner", from: "p1" })));
  await heard();
  assert.deepEqual(reads(calls), [LIST, "/memory/claims/scopes"].sort(), "a claim moved out of it: its list and the counts");
  calls.length = 0;
  say(page(5, change("i12", "fired", "p1", { by: "filament" })));
  say(page(6, change("i2", "evidence", "p1")));
  await heard();
  assert.deepEqual(reads(calls), [LIST], "a burst is read once");
  button(body, "History of i12").dispatch("click");
  await settle();
  calls.length = 0;
  say(page(7, change("i12", "followed", "p1", { by: "filament" })));
  await heard();
  assert.deepEqual(reads(calls), [LIST, "/memory/items/12/history"], "an open history whose claim changed");
  calls.length = 0;
  say(page(8, change("i7", "asked", "p1", { by: "curator" })));
  await heard();
  assert.deepEqual(reads(calls), [LIST, "/memory/inbox?project=p1"], "a question about a claim it shows: the list and the questions");
  calls.length = 0;
  say(page(9, change("i31", "asked", null, { by: "curator" })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/inbox?project=p1"], "a question about a global claim: this workspace's questions hold it too");
});

test("the dossier is read again on a change in its workspace; the questions' list, once they are read again (M7-D37)", async () => {
  let asks = true;
  const { body, calls, say } = await open({ gets: (u) => (u.pathname === "/memory/inbox" ? { questions: asks && u.searchParams.get("project") === "p1" ? [QUESTION] : [] } : undefined) });
  button(body, "Dossier").dispatch("click");
  await settle();
  calls.length = 0;
  say(page(1, change("i99", "evidence", "p2")));
  await heard();
  assert.deepEqual(reads(calls), [], "another workspace's change");
  say(page(2, change(null, "dossier", "p1", { by: "curator", session: null })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes", "/memory/dossier?project=p1"], "its dossier rewritten: the dossier, and the version in the counts");
  calls.length = 0;
  button(body, "Questions 1").dispatch("click");
  await settle();
  assert.ok(textOf(all(body, "mset-list")[0]).includes("Retire “the api listens on port 3000”"));
  asks = false;
  say(page(3, change("i7", "decided", "p1", { by: "owner" })));
  await heard();
  assert.match(textOf(all(body, "mset-list")[0]), /^Memory asks nothing here/, "answered elsewhere: gone from the list here");
  assert.deepEqual(all(frame(body), "set-seg")[0].kids.map((/** @type {any} */ b) => textOf(b)), ["Memories", "Dossier", "Questions", "Models"]);
});

test("a missed message, a reset and a reconnect each read everything the page shows again (M7-D36)", async () => {
  const { body, calls, say } = await open();
  button(body, "History of i12").dispatch("click");
  await settle();
  const everything = ["/memory/claims/scopes", "/memory/inbox?project=p1", LIST, "/memory/items/12/history"].sort();
  for (const [why, msg] of /** @type {[string, any][]} */ ([
    ["a message missed", { type: "claims", prev: "e1:40", last: "e1:41", changes: [change("i99", "evidence", "p2")] }],
    ["a reset", { type: "claims", reset: true, last: "e2:3" }],
    ["a reconnect", { type: "hello", version: "x" }],
  ])) {
    say(page(1, change("i99", "evidence", "p2")));
    calls.length = 0;
    say(msg);
    await heard();
    assert.deepEqual(reads(calls), everything, why);
  }
});

test("a change while the owner writes here waits for them: their words stay, and what changed is read once they are done (M7-D37)", async () => {
  const { body, calls, say } = await open();
  button(body, "Correct i7").dispatch("click");
  const field = all(body, "mset-field")[0];
  field.dispatch("input", { target: { value: "the api listens on port 8080" } });
  calls.length = 0;
  say(page(1, change("i7", "status", "p1", { by: "curator" })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes"], "the counts only: the list waits");
  calls.length = 0;
  say({ type: "hello" });
  await heard();
  assert.deepEqual(reads(calls), [], "a reconnect waits too");
  assert.equal(all(body, "mset-field")[0], field, "the words being written stay, as typed");
  field.dispatch("keydown", { key: "Escape" });
  await settle();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes", LIST, "/memory/inbox?project=p1"], "done: what changed is read");
  // Adding: the same, and Cancel frees it.
  button(body, "Add").dispatch("click");
  calls.length = 0;
  say(page(2, change("i2", "evidence", "p1")));
  await heard();
  assert.deepEqual(reads(calls), [], "the list waits while a claim is added");
  button(body, "Cancel").dispatch("click");
  await settle();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes", LIST, "/memory/inbox?project=p1"]);
  button(body, "Correct i12").dispatch("click");
  calls.length = 0;
  say(page(3, change("i12", "fired", "p1")));
  await heard();
  assert.deepEqual(reads(calls), [], "the list waits while a claim is corrected");
  button(body, "Cancel").dispatch("click");
  await settle();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes", LIST, "/memory/inbox?project=p1"], "Cancel: what changed is read");
  calls.length = 0;
  button(body, "Correct i7").dispatch("click");
  button(body, "Cancel").dispatch("click");
  await settle();
  assert.deepEqual(reads(calls), [], "nothing owed: nothing read");
});

test("Everywhere: a change to a claim its list shows is read, wherever the claim went (M7-D37)", async () => {
  const { body, calls, say } = await open();
  all(body, "mset-scope")[0].dispatch("click");
  await settle();
  calls.length = 0;
  say(page(1, change("i30", "moved", "p1", { by: "owner" })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes", "/memory/claims?state=standing"]);
});

test("the workspace shown, deleted elsewhere: the page goes where it opens, once the owner's hands are free (M7-D37)", async () => {
  let gone = false;
  const { body, calls, say } = await open({ gets: (u) => (gone && u.pathname === "/memory/claims/scopes" ? { scopes: SCOPES.filter((s) => s.project !== "p1") } : undefined) });
  button(body, "Correct i7").dispatch("click");
  const field = all(body, "mset-field")[0];
  field.dispatch("input", { target: { value: "the api listens on port 8080" } });
  calls.length = 0;
  gone = true;
  say(page(1, change(null, "deleted", "p1", { by: "owner", session: null })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes"], "the scopes: the words being written stay");
  assert.equal(all(body, "mset-field")[0], field);
  assert.deepEqual(all(body, "mset-scope").map((s) => textOf(s)), ["Everywhere|1", "docs|0"]);
  calls.length = 0;
  field.dispatch("keydown", { key: "Escape" });
  await settle();
  assert.ok(reads(calls).includes("/memory/claims?state=standing") && reads(calls).includes("/memory/inbox"), reads(calls).join("\n"));
  assert.ok(all(body, "mset-scope")[0].attrs.class.includes(" on"), "where it opens: Everywhere, no workspace holding a memory");
  assert.deepEqual(all(body, "mset-claim").map((c) => c.attrs["data-id"]), ["i30"]);
  // Hands free: at once.
  gone = false;
  say({ type: "hello" });
  await heard();
  all(body, "mset-scope")[2].dispatch("click");
  await settle();
  assert.deepEqual(all(body, "mset-claim").map((c) => c.attrs["data-id"]), ["i12", "i2", "i7"]);
  gone = true;
  calls.length = 0;
  say(page(2, change(null, "deleted", "p1", { by: "owner", session: null })));
  await heard();
  assert.deepEqual(reads(calls), ["/memory/claims/scopes", "/memory/claims?state=standing", "/memory/inbox"].sort());
  assert.deepEqual(all(body, "mset-claim").map((c) => c.attrs["data-id"]), ["i30"]);
});

test("the place shown, a questions read overtaken by a newer one is dropped: the questions are the last place's", async () => {
  let hold = false;
  /** @type {(v: any) => void} */
  let late = () => {};
  const { body } = await open({ gets: (u) => (hold && u.pathname === "/memory/inbox" && u.searchParams.get("project") === "p1" ? new Promise((r) => (late = r)) : undefined) });
  const labels = () => all(frame(body), "set-seg")[0].kids.map((/** @type {any} */ b) => textOf(b));
  assert.deepEqual(labels(), ["Memories", "Dossier", "Questions 1", "Models"]);
  hold = true;
  all(body, "mset-scope")[2].dispatch("click");
  await settle();
  all(body, "mset-scope")[0].dispatch("click");
  await settle();
  late({ questions: [QUESTION] });
  await settle();
  assert.deepEqual(labels(), ["Memories", "Questions", "Models"], "Everywhere asks nothing: p1's late answer is not its");
});

test("a page left lets go of the fan-out at the next message, and reads nothing (M7-D37)", async () => {
  const { body, calls, say, listeners } = await open();
  assert.equal(listeners.size, 2, "the claims' frame and the engine's line");
  all(body, "mset-frame")[0].isConnected = false;
  all(body, "mset-engine")[0].isConnected = false;
  calls.length = 0;
  say(page(1, change("i7", "status", "p1")));
  await heard();
  assert.deepEqual([calls.length, listeners.size], [0, 0]);
});

/** How models did, as the outcomes route answers it (M7-D52): a turn group and a sub-agent group. */
const OUTCOMES = {
  project: "p1", days: 30, kind: null, runs: 7,
  groups: [
    {
      model: "glm-5.3", kind: "turn", runs: 5, held: 3, done: 4, failed: 1, stopped: 0, corrected: 1, rounds: 4, ms: 83_000, tokensIn: 50_000, tokensOut: 4_000, priced: 4, usd: 0.016, usdPerRun: 0.004,
      did: [{ did: "tests", runs: 3, held: 2, done: 3, failed: 0, stopped: 0, corrected: 1 }, { did: "delegated", runs: 2, held: 1, done: 1, failed: 1, stopped: 0, corrected: 0 }],
    },
    {
      model: "grok-4.6", kind: "subagent", runs: 2, held: 0, done: 1, failed: 0, stopped: 1, corrected: 1, rounds: 2.5, ms: 950, tokensIn: 900, tokensOut: 80, priced: 0, usd: null, usdPerRun: null,
      did: [{ did: "answered", runs: 2, held: 0, done: 1, failed: 0, stopped: 1, corrected: 1 }],
    },
  ],
};

test("Models (M7-D53): how each model's work went in the place picked — a card per model and kind with its figures, how its runs ended as a bar, a line per thing they did; the window, the kind of work and the place re-read it; said to be a record", async () => {
  /** @type {string[]} */
  const asked = [];
  let fail = false;
  let held = false;
  /** @type {(v: any) => void} */
  let late = () => {};
  const { body } = await open({
    gets: (u) => {
      if (u.pathname !== "/memory/outcomes") return undefined;
      asked.push(u.search);
      if (held) return new Promise((r) => (late = r));
      if (fail) return Promise.reject(Object.assign(new Error("HTTP 503"), { body: { error: "Memory has not started." } }));
      return u.searchParams.get("kind") === "subagent" ? { ...OUTCOMES, kind: "subagent", runs: 0, groups: [] } : OUTCOMES;
    },
  });
  assert.deepEqual(asked, [], "read only when shown");
  button(body, "Models").dispatch("click");
  await settle();
  assert.deepEqual(asked, ["?days=30&project=p1"]);
  assert.deepEqual(all(frame(body), "set-seg").slice(1).map((s) => s.kids.map((/** @type {any} */ b) => textOf(b))), [["7 days", "30 days", "90 days", "Year"], ["All", "Turns", "Agents", "Team workers"]]);
  const list = all(body, "mset-list")[0];
  assert.equal(textOf(list.kids[0]), "How each model's finished work went: held is done and never corrected. A record for you to read; Filament never picks or switches a model by it.");
  const cards = all(body, "mset-model");
  assert.deepEqual(cards.map((c) => textOf(c)), [
    "glm-5.3|5 turns|60%|held|4|rounds|1.4 min|time|$0.0040|a run|3 of 5 held|1 corrected · 1 failed|$0.02 in all, over the 4 priced|Ran tests|2 of 3 held|Delegated|1 of 2 held",
    "grok-4.6|2 agent runs|0%|held|2.5|rounds|950 ms|time|–|a run|0 of 2 held|1 corrected · 1 stopped|no price known|Answered|0 of 2 held",
  ]);
  assert.deepEqual(all(cards[0], "mset-tile").map((t) => t.attrs.style), ["--tile:var(--color-sys-cyan)"]);
  assert.deepEqual(all(cards[1], "mset-tile").map((t) => t.attrs.style), ["--tile:var(--color-sys-indigo)"]);
  const bars = all(cards[0], "mset-bar");
  assert.deepEqual(bars.map((b) => b.attrs["aria-label"]), ["3 of 5 held · 1 corrected · 1 failed", "2 of 3 held · 1 corrected", "1 of 2 held · 1 failed"]);
  assert.deepEqual(bars[0].kids.map((/** @type {any} */ s) => [s.attrs.class, s.attrs.style, s.attrs.title]), [["mset-bar-seg is-held", "flex:3", "3 held"], ["mset-bar-seg is-corrected", "flex:1", "1 done, then corrected"], ["mset-bar-seg is-failed", "flex:1", "1 failed"]]);
  assert.deepEqual(all(cards[1], "mset-bar")[0].kids.map((/** @type {any} */ s) => s.attrs.class), ["mset-bar-seg is-corrected", "mset-bar-seg is-stopped"], "no empty share");
  assert.deepEqual(all(cards[0], "mset-flag").map((f) => textOf(f)), ["1 corrected · 1 failed"]);
  button(body, "7 days").dispatch("click");
  await settle();
  button(body, "Agents").dispatch("click");
  await settle();
  assert.deepEqual(asked.slice(1), ["?days=7&project=p1", "?days=7&project=p1&kind=subagent"]);
  assert.equal(textOf(all(body, "mset-list")[0].kids[1]), "No finished agent runs here in the last 7 days. A turn's outcome is kept when it ends, an agent's or a team worker's when its run does.");
  all(body, "mset-scope").find((s) => textOf(s).startsWith("Everywhere"))?.dispatch("click");
  await settle();
  assert.equal(asked.at(-1), "?days=7&kind=subagent", "everywhere: every workspace");
  assert.ok(textOf(all(body, "mset-list")[0]).includes("No finished agent runs anywhere in the last 7 days."));
  assert.deepEqual(all(frame(body), "set-seg")[0].kids.map((/** @type {any} */ b) => textOf(b)), ["Memories", "Questions", "Models"], "the view stays");
  // A read overtaken by a newer pick is dropped: the 90 days' answer comes after the 7 days', and is not shown.
  held = true;
  button(body, "90 days").dispatch("click");
  await settle();
  held = false;
  button(body, "7 days").dispatch("click");
  await settle();
  late(OUTCOMES);
  await settle();
  assert.deepEqual([all(body, "mset-model").length, asked.slice(-2)], [0, ["?days=90&kind=subagent", "?days=7&kind=subagent"]], "the newer pick's answer stays");
  button(body, "Models").dispatch("click");
  assert.equal(all(body, "mset-model").length, 0, "nor is it kept: the view drawn again before its read shows the newer answer");
  await settle();
  fail = true;
  button(body, "Year").dispatch("click");
  await settle();
  assert.equal(asked.at(-1), "?days=365&kind=subagent");
  assert.equal(textOf(all(frame(body), "set-error")[0]), "Memory has not started.");
});

// (fails before: yes — phase 7: the browser was Settings › Memory's, and it opened on the fullest workspace alone)
test("Library › Memory opens on the workspace its address names — by its key, by a chat's folder, or everywhere — else on the fullest; Settings › Memory links there", async () => {
  assert.equal(scopeFor(SCOPES, "p2"), "p2");
  assert.equal(scopeFor(SCOPES, "h:/docs/"), "p2", "a chat's folder, however it is written");
  assert.equal(scopeFor(SCOPES, "everywhere"), null);
  assert.equal(scopeFor(SCOPES, "H:\\elsewhere"), "p1", "no workspace there: the one that holds the most");
  assert.equal(scopeFor(SCOPES, ""), "p1");
  const { body, calls } = await open({ scope: "H:\\docs" });
  const on = all(body, "mset-scope").filter((b) => String(b.attrs.class).split(/\s+/).includes("on"));
  assert.deepEqual(on.map((b) => textOf(all(b, "mset-scope-name")[0])), ["docs"]);
  assert.ok(calls.some(([p]) => p.startsWith("/memory/claims?") && p.includes("project=p2")), "its claims read");
  const holds = all(body, "settings-row").find((r) => textOf(all(r, "settings-row-label")[0]) === "What memory holds");
  assert.equal(all(holds, "mset-library")[0]?.attrs.href, "#/library/memory");
});

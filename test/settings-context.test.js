// @ts-check
// Settings › Context (HarnessV4_Tasks U3-8, UX-13): the harness's settings page has the Context section — the same
// section a session's Context tab draws, over your defaults — and the dashboard's context page links to it.
// (fails before: yes — the settings page had no Context section, and the defaults had no reader or writer)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";
import { SECTIONS } from "../src/ui/harness/settings/page.js";
import { defaultsView, START_WORDS, mountContext } from "../src/ui/harness/settings/context.js";

const read = (/** @type {string} */ p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const settle = () => new Promise((r) => setTimeout(r, 0));
const modelSelect = () => ({ el: fakeH("button", { class: "model-chip" }, "chip"), setModels() {}, set() {}, setNote() {}, setLocked() {} });
/** The defaults' answer (`GET /api/defaults/settings`). @param {any} [o] */
const answer = (o = {}) => ({
  layer: {},
  flat: { "context.compaction.thresholdPercent": 85, "context.compaction.method": "summary", "context.compaction.agent": "suggested", "context.results": "status", "context.carry": "plain" },
  sources: { "context.results": "dashboard", "context.compaction.thresholdPercent": "default", "context.carry": "default" },
  effective: { context: { results: "status", carry: "plain", compaction: { thresholdPercent: 85, method: "summary", agent: "suggested" } } },
  hash: "h1",
  ...o,
});

test("the settings page lists Context under New chats, at #/settings/context", () => {
  const s = SECTIONS.find((x) => x.id === "context");
  // The group says what a person does there (HarnessV4_Settings_Plan HS-D5): how new chats behave.
  assert.deepEqual(s && [s.group, s.label], ["New chats", "Context"]);
  assert.match(read("src/ui/harness/settings/page.js"), /if \(section === "context"\) return renderContext\(body, cb\);/);
});

test("the defaults as the section reads them: a session-shaped view — yours is the layer being edited, the dashboard's the one under it", () => {
  const v = /** @type {any} */ (defaultsView(answer({ sources: { "context.results": "dashboard", "context.compaction.thresholdPercent": "yours", "context.carry": "default" } })));
  assert.equal(v.settings.native, true, "Filament's loop's rows");
  assert.deepEqual(v.settings.sources, { "context.results": "global", "context.compaction.thresholdPercent": "session", "context.carry": "default" });
  assert.equal(v.settings.flat["context.results"], "status");
  assert.equal(v.settings.effective.context.carry, "plain");
  assert.equal(v.settings.hash, "h1");
  assert.equal(v.settings.window, null, "no chat, no window");
  assert.equal(defaultsView(null), null);
});

test("where new chats start, in one line: your defaults (the owner's of 11-07: there are no presets)", () => {
  assert.equal(START_WORDS, "New chats start from these.");
});

test("mounted: the document is read once, the section drawn over it; a change goes to the defaults' route, the answer is drawn, and the open session hears of it", async () => {
  /** @type {any[]} */
  const calls = [];
  /** @type {string[]} */
  const said = [];
  let doc = answer();
  const api = async (/** @type {string} */ path, /** @type {any} */ init) => {
    calls.push([path, init?.method || "GET", init?.body || null]);
    if (init?.method === "PATCH") {
      if (init.body?.patch?.context?.compaction?.thresholdPercent === 999) throw new Error('"context.compaction.thresholdPercent" must be at most 100');
      doc = answer({ layer: init.body.patch || {}, flat: { ...doc.flat, "context.results": "line" }, effective: { context: { ...doc.effective.context, results: "line" } }, sources: { ...doc.sources, "context.results": "yours" }, hash: "h2" });
      return { ok: true, changes: [{ path: "context.results" }], ...doc };
    }
    return doc;
  };
  let changed = 0;
  const host = fakeH("div", {});
  const page = mountContext(host, { onToast: (/** @type {string} */ msg, /** @type {string | undefined} */ kind) => { said.push(`${kind || "ok"}: ${msg}`); }, onChanged: () => { changed++; } }, { h: fakeH, drawIn: fakeDrawIn, api, modelSelect });
  await page.ready;
  await settle();
  assert.deepEqual(calls, [["/defaults/settings", "GET", null]]);
  const text = () => textOf(host);
  // The mock's parts on the face (proposal_ux §4.12 step 4), what every request carries under Advanced (U11).
  for (const bit of ["New chats start from these.", "How earlier turns reach the model, where a chat has not chosen its own", "When the chat is full", "Your line", "Then", "Back after a break",
    "How it makes room", "The way", "A coding agent's way", "Summaries written by", "Advanced"]) assert.ok(text().includes(bit), `${bit} in ${text()}`);
  assert.ok(!text().includes("Tool results"), "Tool results waits under Advanced");
  assert.ok(!text().includes("Earlier turns"), "no Earlier turns row: every turn goes whole until a compaction");
  buttonsOf(host).find((b) => textOf(b).startsWith("Advanced")).dispatch("click");
  for (const bit of ["Every turn", "Tool results", "From the dashboard's rules", "In a coding agent's chat"]) assert.ok(text().includes(bit), `${bit} in ${text()}`);
  assert.ok(!text().includes("Earlier turns"), "nor under Advanced");
  // A pick writes your default; the row is drawn from the answer, Advanced still open.
  buttonsOf(host).find((b) => String(b.attrs.class).includes("inst-seg-btn") && textOf(b) === "One line").dispatch("click");
  await settle();
  assert.deepEqual(calls.at(-1), ["/defaults/settings", "PATCH", { patch: { context: { results: "line" } } }]);
  assert.ok(text().includes("Your default · "), text());
  assert.deepEqual(said, ["ok: Your default changed: results: line — every chat that has not chosen its own takes it from its next request"]);
  assert.equal(changed, 1, "the open session's document is read again");
  // A refusal is said in its own words, and nothing is redrawn as if it had landed.
  await page.write({ patch: { context: { compaction: { thresholdPercent: 999 } } } });
  assert.equal(said.at(-1), 'err: "context.compaction.thresholdPercent" must be at most 100');
  assert.equal(changed, 1);
});

test("a read that fails says so in the page, with its cause", async () => {
  const host = fakeH("div", {});
  const page = mountContext(host, {}, { h: fakeH, drawIn: fakeDrawIn, api: async () => { throw new Error("no such route"); }, modelSelect });
  await page.ready;
  assert.match(textOf(host), /Your defaults could not be read: no such route/);
});

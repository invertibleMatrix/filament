// @ts-check
// The Outputs pane drawn again keeps its rows and their buttons (the owner's of 11-01: "when i hover over my mouse over
// some interactive elements like buttons then those are just suppose to highlight only once they quite a lot of time
// they start blinking … and during that sometimes the clicks even don't pass through so i have to press more than
// once"). A round that wrote and the turn's end (the run's pulse), Read again and the gone files' fold emptied the list
// and drew every row, its Show in folder and its ⋯, the fold and the note from nothing: new elements under a resting
// pointer. Drawn in place (dom.js `morphChildren`), each row keyed by its file's path and each other part by what it
// is, they are the elements that stood, their words and handlers the newest read's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { until } from "./helpers/wait.js";

const g = /** @type {any} */ (globalThis);
/** Every address the page asked for. @type {string[]} */
const asked = [];
/** What the stand-in server answers by the whole address: a body, or undefined for a 404. @type {(url: string) => any} */
let serve = () => undefined;
const realFetch = g.fetch;
g.fetch = async (/** @type {string} */ url) => {
  asked.push(String(url));
  const body = await serve(String(url));
  return body === undefined
    ? new Response(JSON.stringify({ error: "not found" }), { status: 404 })
    : new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
};
// The page reads `fetch` as its modules load: they load after the stand-in stands.
const { renderOutputs, refreshOutputs } = await import("../src/ui/harness/panes/outputs.js");
const { h } = await import("../src/ui/lib/dom.js");

/** @type {ReturnType<typeof stubDocument>} */
let doc;
/** @type {Record<string, any>} */
const had = {};
const STUBS = {
  requestAnimationFrame: (/** @type {(t: number) => void} */ f) => setTimeout(() => f(0), 0),
  cancelAnimationFrame: (/** @type {any} */ id) => clearTimeout(id),
};
before(() => {
  doc = stubDocument();
  for (const [k, v] of Object.entries(STUBS)) {
    had[k] = Object.prototype.hasOwnProperty.call(g, k) ? g[k] : undefined;
    g[k] = v;
  }
});
after(() => {
  doc.restore();
  for (const k of Object.keys(STUBS)) {
    if (had[k] === undefined) delete g[k];
    else g[k] = had[k];
  }
  g.fetch = realFetch;
});

/** A few turns of the event loop: what a read set off has landed. */
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

const URL = "/api/memory/sessions/c1/outputs";
const NOW = Date.now();
const A = { path: "C:\\Temp\\run\\chart.svg", name: "chart.svg", folder: "C:\\Temp\\run", size: 120, mtimeMs: NOW, agent: "", turn: 1, ignoredIn: null };
const B = { path: "C:\\Temp\\run\\notes.md", name: "notes.md", folder: "C:\\Temp\\run", size: 9, mtimeMs: NOW, agent: "", turn: 1, ignoredIn: null };

// (fails before: yes — each read emptied the list and drew every row anew)
test("the pulse, Read again and the fold keep the rows, their buttons, the fold and the note; a button acts on the file its row shows", async () => {
  let files = [A];
  serve = (u) => (u === URL ? { chainId: "c1", files, gone: [{ path: "C:\\Temp\\old.txt", agent: "", turn: 1 }], errors: [] } : undefined);
  const reads = () => asked.filter((u) => u === URL).length;
  const turn = { n: 1, runId: "r1", status: "streaming" };
  const chat = /** @type {any} */ ({ chainId: "c1", cwd: "C:\\w\\app", turns: [turn], live: { turn, events: [] } });
  const body = /** @type {any} */ (h("div", { class: "pane-body" }));
  doc.document.body.append(body);
  /** @type {any[]} */
  const opened = [];
  /** @type {string[]} */
  const revealed = [];
  const ctx = { chat, setBadge: () => {}, openFileTab: (/** @type {any} */ f) => void opened.push(f), subagents: () => [], reveal: (/** @type {string} */ p) => void revealed.push(p) };
  renderOutputs(body, ctx);
  await until(() => body.querySelector(".out-row"), "the read drawn");
  const list = body.querySelector(".out-list");
  const rowA = body.querySelector(".out-row");
  const [show, more] = rowA.querySelectorAll(".out-btn");
  const fold = body.querySelector(".out-fold");
  const note = body.querySelector(".out-note");
  assert.ok(show && more && fold && note, "A's row with its two buttons, the gone files' fold and the note");
  /** @param {string} sel */
  const texts = (sel) => body.querySelectorAll(sel).map((/** @type {any} */ e) => e.textContent);

  // A round wrote: the pulse reads again, and a newer file comes first.
  files = [B, A];
  chat.live.events.push({ type: "snapshot", round: 1 });
  refreshOutputs(body, ctx);
  await until(() => body.querySelectorAll(".out-row").length === 2, "the newer file drawn");
  assert.equal(body.querySelectorAll(".out-row")[1], rowA, "A's row stands across the pulse, after the newer file");
  assert.deepEqual(rowA.querySelectorAll(".out-btn"), [show, more], "its Show in folder and its ⋯ stand");
  assert.deepEqual([body.querySelector(".out-fold"), body.querySelector(".out-note"), body.querySelector(".out-list")], [fold, note, list], "the fold, the note and the list stand");
  assert.deepEqual(texts(".out-name"), ["notes.md", "chart.svg"]);
  show.dispatch("click");
  assert.deepEqual([revealed, opened], [[A.path], []], "Show in folder acts on the row's file, and the row does not open too");
  rowA.dispatch("click");
  assert.deepEqual(opened, [{ cwd: "C:/Temp/run", path: "chart.svg" }], "the row opens its file");

  // The turn's end reads the same again: nothing is drawn anew.
  chat.live = null;
  refreshOutputs(body, ctx);
  await until(() => reads() === 3, "the read at the turn's end");
  await settle();
  assert.equal(body.querySelectorAll(".out-row")[1], rowA, "A's row stands across the turn's end");
  assert.deepEqual(rowA.querySelectorAll(".out-btn"), [show, more]);

  // The fold pressed stands as the gone files unfold under it.
  fold.dispatch("click");
  assert.equal(body.querySelector(".out-fold"), fold, "the fold pressed stands");
  assert.ok(fold.classList.contains("open"), "open");
  assert.deepEqual(texts(".out-gone"), ["C:\\Temp\\old.txt"]);
  assert.equal(body.querySelectorAll(".out-row")[1], rowA);

  // Read again: the same, the fold open as it was.
  body.querySelector("button[aria-label='Read again']").dispatch("click");
  await until(() => reads() === 4, "the read Read again asks");
  await settle();
  assert.equal(body.querySelectorAll(".out-row")[1], rowA, "A's row stands across Read again");
  assert.equal(body.querySelector(".out-fold"), fold, "the fold stands");
  assert.deepEqual([fold.classList.contains("open"), texts(".out-gone")], [true, ["C:\\Temp\\old.txt"]], "open as it was");
  assert.equal(body.querySelector(".out-note"), note);
  body.remove();
});

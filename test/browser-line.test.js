// @ts-check
// The browser's line over the box (the owner's of 11-02: "when a browser is being used by the chat then it should show
// an indicator above composer about it and clicking on it should open the browser where user can see a live view"):
// while the chat's agents drive its browser, who and what; its button opens the Browser pane.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {typeof import("../src/ui/harness/conversation/browser-line.js")} */
let line;
/** @type {number} */
let DRIVE_MS;
before(async () => {
  dom = stubDocument();
  line = await import("../src/ui/harness/conversation/browser-line.js");
  ({ DRIVE_MS } = await import("../src/ui/harness/panes/browser.js"));
});
after(() => dom.restore());

const NOW = 1_800_000_000_000;

// (fails before: yes — there was no line: no conversation/browser-line.js)
test("what the line says: who drives the chat's browser and what it does — a call under way always, between calls the last one while the chat works and since it last rested — and nothing once it rests, the developer holds it or no app shows it", () => {
  const { browserLineOf } = line;
  const navigate = { words: "navigate localhost:5173" };
  const busy = { busy: { ...navigate, at: NOW }, droveAt: NOW, taken: false, available: true, last: navigate };
  assert.deepEqual(browserLineOf(busy, true, NOW + 500), { who: "Your agent", words: "navigate localhost:5173", until: null }, "a call under way");
  assert.deepEqual(browserLineOf({ ...busy, busy: { words: "click e3", at: NOW, by: "Scout" } }, true, NOW), { who: "Scout", words: "click e3", until: null }, "a sub-agent's call says whose");
  assert.deepEqual(browserLineOf(busy, false, NOW), { who: "Your agent", words: "navigate localhost:5173", until: null }, "a call under way shows whatever the page thinks of the chat's work");
  const between = { busy: null, droveAt: NOW, taken: false, available: true, last: { words: "click e3", by: "Scout" } };
  assert.deepEqual(browserLineOf(between, true, NOW + 30_000), { who: "Scout", words: "click e3", until: NOW + DRIVE_MS }, "between calls: the last call's words and whose, until it rests");
  assert.equal(browserLineOf(between, true, NOW + DRIVE_MS + 1), null, "rested");
  assert.equal(browserLineOf(between, false, NOW + 1_000), null, "between calls, the chat not at work");
  // (fails before: yes — the review of 11-02: a turn sent within two minutes of the last one's browser use said the
  // browser was in use, though it never touched it)
  assert.equal(browserLineOf(between, true, NOW + 30_000, NOW + 10_000), null, "driven before the chat last rested: another piece of work's");
  assert.ok(browserLineOf(between, true, NOW + 30_000, NOW - 10_000), "driven since it last rested");
  assert.equal(browserLineOf({ ...busy, taken: true }, true, NOW), null, "the developer holds it");
  assert.equal(browserLineOf({ ...busy, available: false }, true, NOW), null, "no desktop app to show it");
  assert.equal(browserLineOf(null, true, NOW), null, "nothing heard of it");
  assert.equal(browserLineOf({ busy: null, droveAt: null, taken: false, available: true, last: null }, true, NOW), null, "never driven");
});

test("the line drawn: hidden with nothing to say, its words in place as calls go on, the one button opening the Browser pane", () => {
  let opened = 0;
  const l = line.createBrowserLine({ onOpen: () => opened++ });
  const el = /** @type {any} */ (l.el);
  assert.ok(el.classList.contains("hidden"), "nothing painted yet");
  l.paint({ who: "Your agent", words: "navigate localhost:5173", until: null });
  assert.ok(!el.classList.contains("hidden"));
  assert.equal(el.getAttribute("role"), "status");
  assert.equal(el.querySelector(".browser-line-who").textContent, "Your agent is using the browser");
  assert.equal(el.querySelector(".browser-line-what").textContent, ": navigate localhost:5173");
  const go = el.querySelector(".browser-line-go");
  assert.equal(go.getAttribute("title"), line.WATCH_DOES);
  l.paint({ who: "Scout", words: "click e3", until: null });
  assert.equal(el.querySelector(".browser-line-who").textContent, "Scout is using the browser");
  assert.equal(el.querySelector(".browser-line-go"), go, "the button stays the element under the pointer");
  go.dispatch("click");
  assert.equal(opened, 1);
  // Painted at each frame of a turn: the same words touch nothing.
  const who = el.querySelector(".browser-line-who");
  let wrote = 0;
  Object.defineProperty(who, "textContent", { configurable: true, get: () => "Scout is using the browser", set: () => { wrote++; } });
  l.paint({ who: "Scout", words: "click e3", until: null });
  assert.equal(wrote, 0, "the same words, nothing written");
  l.paint(null);
  assert.ok(el.classList.contains("hidden"));
});

// (fails before: yes — the owner's of 11-05: "when the browser is opened on the right side then Watch live button chip
// should not be shown")
test("the Browser pane in sight beside the chat: the line keeps its words, its button goes — and comes back as the pane goes out of sight", () => {
  const l = line.createBrowserLine({ onOpen: () => {} });
  const el = /** @type {any} */ (l.el);
  l.paint({ who: "Your agent", words: "navigate localhost:5173", until: null });
  const go = el.querySelector(".browser-line-go");
  assert.equal(go.classList.contains("hidden"), false, "the pane out of sight: Watch live");
  l.inSight(true);
  assert.equal(go.classList.contains("hidden"), true, "the pane in sight: no Watch live");
  assert.equal(el.classList.contains("hidden"), false, "the line stands");
  assert.equal(el.querySelector(".browser-line-who").textContent, "Your agent is using the browser", "who drives it, still said");
  l.paint({ who: "Scout", words: "click e3", until: null });
  assert.equal(go.classList.contains("hidden"), true, "new words bring no button back");
  l.paint(null);
  l.paint({ who: "Scout", words: "click e4", until: null });
  assert.equal(go.classList.contains("hidden"), true, "nor the line going and coming");
  l.inSight(false);
  assert.equal(go.classList.contains("hidden"), false, "the pane closed, or behind another tab: Watch live again");
  // The panes tell it at each move of what shows — a pane opened, closed, brought in front, the chat switched, the
  // window narrowed till the panes hide — the Browser in sight where it is a tile's tab in front, or on top.
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /\n  onChange: \(\) => \{ paneButtons\?\.paint\(\); browserLine\.inSight\(rail\.front\(\)\.includes\("browser"\)\); \},\n/);
});

// (fails before: yes — the owner's word of 11-02: "the Watch Live button when browser is being used moves when text line
// changes": the words took their own width, and the button stood after them)
test("the button stands at the line's end: the words take the room between, cut short where they run long", () => {
  const css = readFileSync("src/ui/harness.css", "utf8");
  assert.match(css, /\n\.browser-line-words \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}/);
  assert.match(css, /\n\.browser-line-go \{ flex: none;/, "the button keeps its own width");
});

test("the page wires it: over the box, opening the Browser pane, fed by the events feed's `browser`, painted with the chat and as runs begin or end", () => {
  const app = readFileSync("src/ui/harness/app.js", "utf8");
  assert.match(app, /\nconst browserLine = createBrowserLine\(\{ onOpen: \(\) => rail\.openTab\("browser"\) \}\);\nconst rail = createPaneHost\(/, "made before the panes, which tell it whether the Browser pane is in sight");
  assert.match(app, /\ncomposer\.asks\.append\(browserLine\.el\);\nconst browserUse = createBrowserUse\(/, "over the box");
  assert.match(app, /onBus\(\(msg\) => browserUse\.heard\(msg\)\);\nsubagentStore\.onChange\(\(\) => paintBrowserLine\(\)\);/, "fed by the events feed, and painted as an agent of the chat starts or ends");
  assert.match(app, /paintCrafterLine\(\);\n  paintBrowserLine\(\);/, "with the chat (selectChat)");
  assert.match(app, /onAtWork: \(\) => \{ views\.pulse\(\); paintCrafterLine\(\); paintBrowserLine\(\);/, "as a run begins or ends");
  // (fails before: yes — the drive of 11-02: the runs list moved while the page's own follow still held the turn, and
  // the line stood after the turn had ended)
  assert.match(app, /chargeBand\.paint\(chat\);\n[^\n]*\n  paintBrowserLine\(\);\n\}/, "as the page's own turn ends (nowIn)");
  const feed = readFileSync("src/http/events.js", "utf8");
  assert.match(feed, /events\.subscribe\("browser", send\)/, "the feed carries the topic");
  const server = readFileSync("src/server.js", "utf8");
  assert.match(server, /moved: \(chain, use\) => events\.publish\("browser", \{ type: "browser", chainId: chain, \.\.\.use \}\)/);
});

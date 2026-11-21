// @ts-check
// Catch me up on the page (HarnessV4_Tasks E15 step 7, AG-206 and AG-207; U12-D6): its quiet line over the box and its
// tile in the Agents tab, which open its question and send nothing, and its card standing open in the chat. The agents
// that started by themselves, beside whom these tests once stood, went on the owner's word of 11-05.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stubDocument } from "./helpers/dom-stub.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { STARTS, CARDS } from "./helpers/side-view.js";
import { shortcutsOf } from "../src/ui/harness/lib/side.js";
import { MOVED_WORDS, CATCH_UP_DOES, createCatchUp } from "../src/ui/harness/conversation/catch-up.js";
import { agentCardRow } from "../src/ui/harness/conversation/agent-card.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";

const source = (/** @type {string} */ f) => readFileSync(new URL(`../src/ui/harness/${f}`, import.meta.url), "utf8");

// (fails before: yes — U12-D6: Catch me up was no tile of the tab: it was offered over the chat's box alone; then the
// owner's word of 10-18: its tile launched on one press)
test("Catch me up is a tile of the Agents tab too: it brings its own question, to send or change", () => {
  assert.deepEqual(shortcutsOf(STARTS, CARDS).map((s) => [s.id, s.task]), [["ask", ""], ["job", ""], ["review", ""], ["catchup", "Catch me up."]]);
});

describe("Catch me up's card, in the chat", () => {
  /** @type {ReturnType<typeof stubDocument>} */
  let doc;
  /** @type {{ open: Set<string>, calls: any[] }} */
  let page;
  before(() => {
    doc = stubDocument();
  });
  after(() => doc.restore());
  beforeEach(() => {
    page = { open: new Set(), calls: [] };
    Object.assign(chipActions, {
      cardMarks: () => ({}),
      subagentRow: () => null,
      subagentsKnown: () => true,
      subagentDelivery: () => "held",
      outsideClient: () => null,
      openSubagent: (/** @type {string} */ id) => page.calls.push(["open", id]),
      sendSubagent: async () => {},
      cardAnswer: async () => "",
      cardOpen: { get: (/** @type {string} */ id, /** @type {number} */ x) => page.open.has(`${id}:${x}`), set: (/** @type {string} */ id, /** @type {number} */ x, /** @type {boolean} */ on) => void (on ? page.open.add(`${id}:${x}`) : page.open.delete(`${id}:${x}`)) },
    });
  });
  after(() => {
    for (const k of ["cardMarks", "subagentRow", "subagentsKnown", "subagentDelivery", "outsideClient", "openSubagent", "sendSubagent", "cardAnswer", "cardOpen"]) /** @type {any} */ (chipActions)[k] = null;
  });
  /** Its answer's mark. @param {any} [o] */
  const back = (o = {}) => ({ type: "subagent", event: "arrival", agentId: "sa_9", exchange: 0, at: 1_000, afterTurn: 3, model: "zai/glm-5.3", card: { tag: "reviewer", name: "Reviewer" }, asked: true, question: "Catch me up.", status: "done", ms: 4_000, answer: "The parser read a comma as the end of a row. It now reads to the line's end.", tokensIn: 3_000, tokensOut: 90, spentUsd: 0.002, delivery: "held", ...o });

  // (fails before: yes — AG-207: Catch me up's answer would have stood folded, one click away from what was asked for)
  test("a card the page says stands open is drawn open before anyone touched it: Catch me up's", () => {
    page.open.add("sa_9:0");
    const row = /** @type {any} */ (agentCardRow(back()));
    assert.ok(row.className.includes("is-open"));
    row.querySelector(".ask-card-toggle").dispatch("click");
    assert.ok(!row.className.includes("is-open") && !page.open.has("sa_9:0"), "folded by you, it stays folded");
  });
});

// (fails before: yes — step 7, AG-206 and AG-207; then the owner's word of 10-18: its button asked Helper on one press)
describe("Catch me up's quiet line (wireframe 4.6)", () => {
  test("hidden until the session moved; one button, which opens the question and sends nothing, and a way to drop it", () => {
    /** @type {string[]} */
    const did = [];
    const line = createCatchUp({ onCatchUp: () => did.push("catch"), onDismiss: () => did.push("drop"), mk: /** @type {any} */ (fakeH) });
    const el = /** @type {any} */ (line.el);
    assert.ok(el.classList.contains("hidden"), "a session that did not move has no line (case 31)");
    line.paint(true);
    assert.equal(el.classList.contains("hidden"), false);
    assert.equal(textOf(el.querySelector(".catch-up-words")), MOVED_WORDS);
    const go = el.querySelector(".catch-up-go");
    assert.deepEqual([textOf(go), go.attrs.title], ["Catch me up…", CATCH_UP_DOES]);
    // (fails before: yes — the owner's of 11-05: the Reviewer read it folded, always)
    assert.equal(CATCH_UP_DOES, "Opens the question in the Agents tab: once you send it, a live copy of your agent — while its cache is warm — or else the Reviewer reads what happened since your last message and says it in five lines. The main agent hears nothing.");
    go.dispatch("click");
    el.querySelector(".catch-up-x").dispatch("click");
    assert.deepEqual(did, ["catch", "drop"]);
    line.paint(false);
    assert.ok(el.classList.contains("hidden"));
  });

  test("the page: the line shows for a session that was unread when opened or whose turn ended while the window was hidden; typing, sending, × and Catch me up sent take it away (case 32)", () => {
    const app = source("app.js");
    assert.ok(app.includes("if (row?.unread || state.unreadChains.has(chainId)) movedChains.add(chainId);"), "opened unread");
    assert.match(app, /if \(document\.hidden && chat\.chainId\) \{\n\s*movedChains\.add\(chat\.chainId\);\n\s*paintCatchUp\(\);/);
    assert.ok(app.includes('composer.box.addEventListener("input", () => caughtUp(chatOf(state.currentId)?.chainId));'), "whoever types is caught up");
    assert.match(app, /\/\/ Whoever sends is caught up\.\n\s*caughtUp\(chat\.chainId\);/);
    assert.match(app, /function catchUp\(\) \{\n\s*if \(chatOf\(state\.currentId\)\?\.chainId\) views\.side\.begin\("catchup"\);\n\s*\}/, "the button opens the question in the Sub Agents tab");
    assert.ok(!app.includes('spawn({ start: "catchup"'), "no press sends it: Send in the tab does (the owner's word of 10-18)");
    assert.ok(app.includes("(chat.cardsOpen ||= new Set()).add(`${row.id}:0`);"), "once sent, its card stands open in the chat");
    assert.ok(app.includes('{ id: "catch-up", label: "Catch me up…", icon: "history"'), "and it is in the command center whenever you want it, opening the same question");
  });
});

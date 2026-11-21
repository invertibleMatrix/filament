// @ts-check
// What the page says of what the main agent attached to a sub-agent's message (`attach`, the owner's of 11-17): the
// launch's card, the card of a saved agent the main agent asked, the held card's line and the viewer's message, each
// "with 2 files and a picture" and the names in its tooltip; nothing where nothing was attached.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { attachedNames, attachedWords } from "../src/ui/harness/lib/agent-cards.js";
import { alignEvents } from "../src/ui/harness/lib/labels.js";
import { askedCardRow } from "../src/ui/harness/conversation/agent-card.js";
import { heldLaunchSub } from "../src/ui/harness/conversation/held-launch.js";
import { roundRows } from "../src/ui/harness/conversation/tools/render.js";
import { chipActions } from "../src/ui/harness/conversation/tools/layout.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
  Object.assign(chipActions, { subagentRow: () => null, subagentsKnown: () => true });
});
after(() => {
  for (const k of ["subagentRow", "subagentsKnown"]) /** @type {any} */ (chipActions)[k] = null;
  doc.restore();
});

const START = { type: "subagent-start", round: 0, parent: "a1", agentId: "sa_1", exchange: 0, description: "Look at both", agent: "reviewer", model: "m-1", prompt: "Compare them." };
const ATTACHED = { files: ["notes.md", "src/a.js"], pictures: ["picture 1"] };
/** The sub a turn's events made of the agent call. @param {any} start */
const subOf = (start) => /** @type {any} */ (alignEvents([{ type: "round-start", round: 0 }, { type: "tool-start", round: 0, id: "a1", name: "agent", args: "Look at both" }, start]).byRound.get(0)).tools.get("a1").sub;

test("its words: files and pictures counted, the person's words for pictures alone, nothing for none; the names for its tooltip", () => {
  assert.equal(attachedWords(ATTACHED), "with 2 files and a picture");
  assert.equal(attachedWords({ files: ["a"], pictures: [] }), "with a file");
  assert.equal(attachedWords({ files: [], pictures: ["p1", "p2", "p3"] }), "with 3 pictures");
  assert.equal(attachedWords({ pictures: ["p1"] }), "with a picture");
  for (const none of [null, undefined, {}, { files: [], pictures: [] }]) assert.equal(attachedWords(none), "");
  assert.equal(attachedNames(ATTACHED), "notes.md, src/a.js, picture 1");
});

// (fails before: yes — the start event carried nothing attached, and no card said it)
test("the start event's attachments reach its sub: the launch's card says them beside its model, the names in the tooltip", () => {
  const s = subOf({ ...START, attached: ATTACHED });
  assert.deepEqual(s.attached, { files: ["notes.md", "src/a.js"], pictures: ["picture 1"] });
  assert.equal(subOf(START).attached, undefined);
  const row = /** @type {any} */ (roundRows(alignEvents([{ type: "round-start", round: 0 }, { type: "tool-start", round: 0, id: "a1", name: "agent", args: "Look at both" }, { ...START, attached: ATTACHED }]).byRound.get(0), { runId: "run-1" })[0]);
  row.querySelector(".tool-head")?.dispatch?.("click");
  const meta = row.querySelector(".sub-meta");
  const span = row.querySelector(".sub-attached");
  assert.ok(span, "its words drawn");
  assert.equal(span.textContent, " · with 2 files and a picture");
  assert.equal(span.getAttribute("title"), "notes.md, src/a.js, picture 1");
  assert.ok(String(meta.textContent).startsWith("reviewer · m-1"), meta.textContent);
  const bare = /** @type {any} */ (roundRows(alignEvents([{ type: "round-start", round: 0 }, { type: "tool-start", round: 0, id: "a1", name: "agent", args: "Look at both" }, START]).byRound.get(0), { runId: "run-1" })[0]);
  assert.equal(bare.querySelector(".sub-attached"), null, "nothing attached, nothing said");
});

test("a saved agent the main agent asked: its card says what went with the question, as it says the person's pictures", () => {
  const asked = { ...START, agent: "pm", card: { tag: "pm", name: "PM" }, asked: true };
  const row = /** @type {any} */ (askedCardRow(subOf({ ...asked, attached: ATTACHED }), { running: true }));
  const pics = row.querySelector(".ask-card-pics");
  assert.equal(pics.textContent, "with 2 files and a picture");
  assert.equal(pics.getAttribute("title"), "notes.md, src/a.js, picture 1");
  const none = /** @type {any} */ (askedCardRow(subOf(asked), { running: true }));
  assert.deepEqual(none.querySelectorAll(".ask-card-pics").map((/** @type {any} */ e) => e.className), ["ask-card-pics ask-card-handed hidden"], "the handed change's place alone");
});

test("a held launch's line says what goes with it", () => {
  const l = { n: 1, description: "Fix it", kind: "builder", model: "m-1", where: /** @type {const} */ ("copy"), declines: "" };
  assert.equal(heldLaunchSub({ ...l, attached: { files: ["notes.md"], pictures: [] } }), "on M 1 · in its own copy of the folder · with a file");
  assert.equal(heldLaunchSub(l), "on M 1 · in its own copy of the folder");
});

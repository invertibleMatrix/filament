// @ts-check
// A team's result beside the chat keeps its foot's buttons as its row moves (the owner's of 11-01: "when i hover over my
// mouse over some interactive elements like buttons then those are just suppose to highlight only once they quite a
// lot of time they start blinking … and during that sometimes the clicks even don't pass through so i have to press
// more than once"). The foot follows the Teams tab's row, which the list beside reads again on every event of the feed
// and every 15 s while a team works, and each read emptied the foot and drew Send to your agent…, Verify, then send…
// and Ask its lead from nothing: new buttons under a resting pointer, a press on the old one no click on the new.
// Drawn in place (dom.js `morphChildren`), each keyed by what it is, they are the buttons that stood; a button the row
// no longer offers goes alone, and the words of where it stands with your agent are the newest.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { renderResultPane } from "../src/ui/harness/panes/team-result.js";
import { findingsOf } from "../src/core/beside.js";
import "./helpers/teams-on-page.js";

/** @type {ReturnType<typeof stubDocument>} */
let doc;
before(() => {
  doc = stubDocument();
});
after(() => {
  doc.restore();
});

const settle = () => new Promise((r) => setImmediate(r));
const NOW = 1_800_000_000_000;
const HUNT = "Merged the reports.\n\n## Findings\n- Found | Notify while a question waits sends the result twice | app/teams-beside.js:418 | Hunter 3\n- Plausible | Off by one in the lexer | lex.js:9";
/** A team on the side as the list answers it, done with a ranked result your agent has not seen. @param {any} [o] @returns {any} */
const row = (o = {}) => ({
  id: "t1", main: "c1", team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "find bugs", firedBy: "you", at: NOW - 20 * 60_000, model: "m-1", title: "",
  state: "done", workers: { running: 0, waiting: 0, total: 10 }, verify: false, notify: false, of: null, verifiedBy: null,
  result: { n: 1, text: "Merged the reports.", more: true, at: NOW - 2 * 60_000 }, findings: findingsOf(HUNT), notified: null, cut: false, readOnly: true,
  on: { lead: "m-1", workers: ["m-2"], from: "team", fell: [] }, ...o,
});

// (fails before: yes — each read of the list beside emptied the foot and drew its buttons anew)
test("the foot's buttons stand as the row beside is read again; one the row no longer offers goes alone, the rest stand with the newest words", async () => {
  let r = row();
  /** @type {Set<() => void>} */
  const watchers = new Set();
  /** @type {string[]} */
  const did = [];
  const body = /** @type {any} */ (document.createElement("div"));
  document.body.append(body);
  const letGo = renderResultPane(body, {
    load: async () => ({ id: "t1", n: 1, team: { key: "bug-hunter", name: "Bug Hunter" }, ask: "x", firedBy: "you", at: NOW - 60_000, text: HUNT, message: "m", findings: findingsOf(HUNT) }),
    row: () => r,
    watch: (fn) => (watchers.add(fn), () => watchers.delete(fn)),
    send: () => did.push("send"),
    verify: () => did.push("verify"),
    ask: () => did.push("ask"),
    openFile: () => {},
    now: () => NOW,
  });
  await settle();
  const foot = body.querySelector(".trp-foot");
  const [send, verify, ask] = foot.querySelectorAll("button");
  const seen = foot.querySelector(".trp-seen");
  assert.deepEqual([send?.textContent, verify?.textContent, ask?.textContent, seen?.textContent], ["Send to your agent…", "Verify, then send…", "Ask its lead", "your agent has not seen it"]);

  // The list beside read again while a team works: the row as it was.
  for (const fn of watchers) fn();
  assert.deepEqual(foot.querySelectorAll("button"), [send, verify, ask], "the three buttons stand across a read of the list beside");
  assert.equal(foot.querySelector(".trp-seen"), seen, "and the words of where it stands");
  ask.dispatch("click");
  assert.deepEqual(did, ["ask"], "a press on the button that stood goes through");

  // Sent: Send to your agent… goes alone; Verify and Ask stand, the words the newest.
  r = row({ notified: { n: 1, at: NOW, how: "sent" } });
  for (const fn of watchers) fn();
  assert.deepEqual(foot.querySelectorAll("button"), [verify, ask], "Send gone, Verify and Ask the buttons that stood");
  assert.equal(foot.querySelector(".trp-seen"), seen);
  assert.match(seen.textContent, /Sent to your agent/, "the newest words");
  verify.dispatch("click");
  assert.deepEqual(did, ["ask", "verify"]);
  letGo();
  body.remove();
});

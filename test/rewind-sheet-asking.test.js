// @ts-check
// The rewind's sheet while a question waits for the person's answer (the decision of 11-02): a rewind of the files alone
// is refused then, and one of the conversation takes the question away with the turn that asked. The sheet said none of
// it until Rewind was pressed and refused; it now says so up front, from what the server's read of the rewind says, and
// does not offer the files alone — opened from a files card's Undo, it chooses files and conversation instead. app.js's
// sheet is lifted out (helpers/app-lift.js) and drawn on the stub document.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { stubDocument } from "./helpers/dom-stub.js";
import { lift } from "./helpers/app-lift.js";

/** @type {ReturnType<typeof stubDocument>} */
let dom;
/** @type {Record<string, any>} */
let mods;
before(async () => {
  dom = stubDocument();
  const [{ h }, rewound, history] = await Promise.all([import("../src/ui/lib/dom.js"), import("../src/ui/harness/conversation/rewound.js"), import("../src/ui/harness/conversation/history.js")]);
  mods = { h, ...rewound, unsent: history.unsent, forkable: history.forkable };
});
after(() => dom.restore());

/** What the server's read says of a rewind to before turn 2, whose files went back, while turn 2's question waits. */
const PLAN = { turn: 2, conversation: { from: 2, to: 2, turns: 1 }, files: [{ place: "/w", path: "fresh.txt", kind: "added" }], left: [], outside: [], cannot: [], errors: [], folder: "/w", asking: { turn: 2 } };

/**
 * The sheet opened at a turn, its read answered with `plan`: its body, the ways' buttons and the main button.
 * @param {any} plan @param {{ what?: string }} [opts]
 */
const sheet = async (plan, opts = {}) => {
  /** @type {any} */
  let body = null;
  const main = mods.h("button", {}, "");
  const fns = lift(["rewindConfirm", "rewindAgo", "clipLine"], {
    ...mods,
    rewindRefusal: () => null,
    toast: () => {},
    coderNameOf: () => "",
    api: async () => plan,
    dialog: (/** @type {any} */ o) => {
      body = o.body;
      return { el: { querySelector: () => main, addEventListener() {} }, close() {} };
    },
  });
  fns.rewindConfirm({ id: "c1", chainId: "s1", turns: [] }, { n: 2, status: "done", userText: "edit fresh.txt then check", startedAt: Date.now() }, opts);
  await new Promise((r) => setImmediate(r));
  const ways = body.querySelectorAll(".rw-way");
  return { body, main, way: (/** @type {string} */ label) => ways.find((/** @type {any} */ b) => b.textContent === label) };
};

// (fails before: yes — the sheet offered Files only and said nothing of the question: the refusal came only once
// Rewind was pressed)
test("while a question waits: said up front, Files only not offered, the files card's Undo choosing files and conversation", async () => {
  const s = await sheet(PLAN, { what: "files" });
  assert.equal(s.body.querySelector(".rw-asking")?.textContent, "A question from turn 2 waits for your answer: rewinding the conversation takes it away with its turn. The files can't go back alone while it waits.");
  assert.equal(s.way("Files only").attrs.has("disabled"), true, "not offered");
  assert.equal(s.way("Files and conversation").getAttribute("aria-pressed"), "true", "the files card's Undo chooses files and conversation");
  assert.equal(s.main.textContent, "Rewind");
  assert.equal(!!s.main.disabled, false);
  // No question waits: the files alone are offered as ever, and nothing is said of a question.
  const plain = await sheet({ ...PLAN, asking: undefined }, { what: "files" });
  assert.equal(plain.body.querySelector(".rw-asking"), null);
  assert.equal(plain.way("Files only").attrs.has("disabled"), false);
  assert.equal(plain.way("Files only").getAttribute("aria-pressed"), "true");
});

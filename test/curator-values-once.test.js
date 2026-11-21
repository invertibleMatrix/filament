// @ts-check
// The curator's merge reads each claim's typed values once for its pass (curator.js `#merge`, `mayMerge`'s `values`):
// it asked them of both claims of every pair, and a long memory's pairs are its claims squared, each read a dozen
// patterns over the claim's words (the owner's of 11-17: one pass held the server 18.8 s in them). The pairs put to the
// model are the same: those that say the same thing, never two holding rival values.
// (fails before: yes — a pass over 2,000 claims took 19.5 s, 2.2 s after)
import { test } from "node:test";
import assert from "node:assert/strict";
import { MERGE_PROMPT } from "../src/services/memory/curator.js";
import { world } from "./fixtures/memory-world.mjs";

/** A scripted model that judges no pair the same, every merge prompt kept. */
function judge() {
  /** @type {string[]} */
  const asked = [];
  const fn = async (/** @type {any} */ a) => {
    if (a.system === MERGE_PROMPT) asked.push(a.user);
    return JSON.stringify(a.system === MERGE_PROMPT ? { pairs: [] } : { slots: [], sections: [] });
  };
  return Object.assign(fn, { asked });
}

/** A word no other claim holds: letters from a number. @param {number} n */
const word = (n) => {
  let s = "";
  for (let k = n + 1; k > 0; k = Math.floor(k / 26)) s += String.fromCharCode(97 + (k % 26));
  return `${s}qux`;
};

test("a pass over 2,000 claims reads each one's values once: it takes no more than seconds, and the same pairs go to the model", async () => {
  const model = judge();
  await world({ models: { summarizer: "judge" }, callModel: model }, async (w) => {
    const { sit } = await w.session("open").send("hello");
    const projectId = sit.project.id;
    const add = (/** @type {string} */ text) => w.svc.archive.items.add({ projectId, chainId: "c1", kind: "fact", text, status: "inferred", importance: 0.7 });
    // Each with words of its own beyond the three they share, so no two of them are a pair to judge.
    for (let i = 0; i < 2000; i++) add(`the ${word(4 * i)} module keeps its ${word(4 * i + 1)} beside the ${word(4 * i + 2)} near ${word(4 * i + 3)}`);
    // Two that say the same thing, and two that hold rival package managers.
    add("the release notes are written by hand before each tag");
    add("release notes are written by hand before every tag");
    add("we install the packages with pnpm in this repository");
    add("we install the packages with bun in this repository");
    // The pair scan is one stretch of the server's loop: the pass's time is what it held, the model's answers being at once.
    const t0 = performance.now();
    await w.svc.curator.run(projectId);
    const ms = performance.now() - t0;
    const asked = model.asked.join("\n");
    assert.match(asked, /release notes are written by hand before each tag/);
    assert.doesNotMatch(asked, /pnpm|bun/, "rival values are never put to the model as the same");
    assert.ok(ms < 8000, `the pass took ${(ms / 1000).toFixed(1)} s`);
  });
});

// @ts-check
// Providers P4 (HarnessV3-Providers §4 P4, 4c): every surface says a cost the same way — what was paid, and beside
// it the same tokens at list price when the two part (a plan pays $0; a provider may state its own charge). One
// figure when they agree, "–" when nothing is known, never a $0 for an unknown.
// (fails before: yes — every surface drew one figure, and a plan's request read "$0.0000" with no worth beside it)
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { costWords, listDiffers, rollupCosts, byModelRows, billingWords } from "../src/ui/lib/cost.js";
import { factsLine } from "../src/ui/harness/lib/labels.js";
import { listedOf } from "../src/app/commands/status.js";

describe("one cost in words", () => {
  test("agreeing figures read as one; a plan reads paid and at list; an unknown paid figure says so; nothing known is –", () => {
    assert.equal(costWords(0.0123, 0.0123).text, "$0.0123");
    assert.equal(costWords(0.0123, null).text, "$0.0123", "a provider's own charge for a model nobody prices here: the paid figure alone");
    const plan = costWords(0, 0.29);
    assert.equal(plan.text, "paid $0.0000 · at list $0.2900");
    assert.match(plan.title, /on a plan: paid \$0/);
    assert.match(costWords(0.42, 1.8).title, /what the provider charged/);
    assert.equal(costWords(null, 1.8).text, "at list $1.8000", "an agent's estimated tokens: paid unknown");
    assert.equal(costWords(null, null).text, "–");
    assert.equal(costWords(undefined, undefined).text, "–");
    assert.equal(listDiffers(0.1, 0.1 + 1e-12), false, "float noise is no difference");
    assert.equal(listDiffers(0.1, null), false);
  });

  test("the turn footer: one figure when they agree (its title as before), both on a plan", () => {
    const seg = (/** @type {any} */ f) => factsLine(f).find((s) => s.id === "cost");
    assert.deepEqual(seg({ costUsd: 0.07, listUsd: 0.07 }), { id: "cost", text: "$0.07", title: "$0.0700 for the whole turn, summed over the calls that billed", tone: "" });
    assert.equal(seg({ costUsd: 0.07 })?.text, "$0.07", "a paid figure with no list price");
    assert.equal(seg({ costUsd: 0, listUsd: 0.29 })?.text, "paid $0 · at list $0.29");
    assert.match(String(seg({ costUsd: 0, listUsd: 0.29 })?.title), /on a plan: paid \$0; .* at list price — the whole turn/);
    assert.equal(seg({ costUsd: null, listUsd: 0.005 })?.text, "at list $0.0050");
    assert.equal(seg({ costUsd: null, listUsd: null }), undefined, "nothing known: no segment");
  });

  test("the request drawer says the billing", () => {
    assert.equal(billingWords({ billing: "plan", cost: 0, listCost: 0.29 }), "On a plan: paid $0.0000 · $0.2900 at list price.");
    assert.equal(billingWords({ billing: "plan", cost: 0, listCost: null }), "On a plan: paid $0.0000 · no list price (nobody prices this model here).");
    assert.equal(billingWords({ billing: "metered", cost: 0.29, listCost: 0.29 }), "Billed per token: $0.2900.");
    assert.equal(billingWords({ billing: "metered", cost: 0.42, listCost: 1.8, costSource: "provider" }), "Billed per token: $0.4200 paid (the provider's own charge) · $1.8000 at list price.");
    assert.equal(billingWords({ cost: 0.29 }), "Cost $0.2900.", "a request still running has no billing yet");
  });
});

describe("rollups and ledgers", () => {
  test("a rollup row: paid, at list, saved by plans; a row with no list count reads –, never $0", () => {
    assert.deepEqual(rollupCosts({ requests: 3, cost: 0.25, costN: 3, listCost: 2.25, listCostN: 3, planListCost: 2 }), { paid: "$0.2500", list: "$2.2500", saved: "$2.0000", unlisted: 0 });
    assert.deepEqual(rollupCosts({ requests: 2, cost: 0.3, costN: 2, listCost: 0, listCostN: 0, planListCost: 0 }), { paid: "$0.3000", list: "–", saved: "–", unlisted: 2 });
    assert.deepEqual(rollupCosts({ requests: 1, cost: 0, costN: 0, listCost: 0, listCostN: 0 }), { paid: "–", list: "–", saved: "–", unlisted: 1 });
    assert.equal(rollupCosts({ requests: 1, cost: 0.1, costN: 1, listCost: 0.1, listCostN: 1, planListCost: 0 }).saved, "–", "nothing a plan paid for");
  });

  test("the spend ledger by model: the biggest list figure first", () => {
    const u = { requests: 3, byModel: { "grok-4.6": { usd: 0.5, listUsd: 0.5, requests: 1 }, "glm-5": { usd: 0, listUsd: 1.8, requests: 2 } } };
    assert.deepEqual(byModelRows(u), { rows: [{ model: "glm-5", usd: 0, listUsd: 1.8, requests: 2 }, { model: "grok-4.6", usd: 0.5, listUsd: 0.5, requests: 1 }] });
    assert.deepEqual(byModelRows(null), { rows: [] });
  });

  test("/cost and /status: the list figure only when it says something the paid one does not", () => {
    assert.deepEqual(listedOf([{ cost: 0.1, listCost: 0.1 }, { cost: 0.2, listCost: 0.2, billing: "metered" }]).differs, false, "per token at the card reads as it always did");
    const plan = listedOf([{ cost: 0, listCost: 1.5, billing: "plan" }, { cost: 0.25, listCost: 0.25 }, { cost: 0 }]);
    assert.deepEqual(plan, { usd: 1.75, plan: 1.5, missing: 1, differs: true });
    // (fails before: yes — the hand test's /cost said "1 request without a list price" for an agent turn's parent)
    const turn = listedOf([{ cost: 0, listCost: 0.09, billing: "plan" }, { cost: 0, listCost: null, billing: "metered", agent: { spentUsd: 0, listUsd: 0.09 } }]);
    assert.deepEqual(turn, { usd: 0.09, plan: 0.09, missing: 0, differs: true }, "a turn's parent is billed by its rounds: neither a figure nor a gap");
    assert.equal(listedOf([{ cost: 0.3 }]).differs, false, "no list price at all: nothing to set beside the paid figure");
    assert.equal(listedOf([]).differs, false);
  });
});

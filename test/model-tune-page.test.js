// HarnessV3 §15 item 93, Phase B: the Upstreams page's model cards, DOM-free — the "can do" chips (what the harness's
// picker offers, each styled by who said it), the window words and parser the Tune sheet types with, and the caps
// loader (what it sends — never the upstream's key — and what it caches on).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TUNE_FIELDS, parseWindows, winWords, windowsText, capChips, capsLoader, sourceLong, windowChoices, windowWithCost, priceWords, carriedPrices, statedIn } from "../src/ui/lib/model-caps.js";
import { CAP_FIELDS } from "../src/core/model-caps.js";

/** A stand-in for the dashboard's h(): the tag, its attributes, its children (nulls dropped, as h() drops them). */
const h = (tag, attrs = {}, ...kids) => ({ tag, attrs, kids: kids.flat().filter((k) => k !== null && k !== undefined && k !== false) });
const textOf = (n) => (typeof n === "string" ? n : (n?.kids || []).map(textOf).join(""));

describe("the Tune sheet's words", () => {
  test("its fields are the resolver's capability fields, one for one", () => {
    assert.deepEqual([...TUNE_FIELDS].sort(), [...CAP_FIELDS].sort());
  });

  // (fails before: yes — the preview read "Windows 256K" for Kimi's k3 family: the standard 1M of the plain id was dropped)
  test("a family's windows in words: the plain member's standard one included, a dearer window with what it costs", () => {
    const w = { via: "name", options: [0, 256_000], standard: 1_000_000, multipliers: { "0": 2 } };
    assert.deepEqual(windowChoices(w), [1_000_000, 256_000]);
    assert.equal(windowChoices(w).map((n) => windowWithCost(w, n)).join(" · "), "1M (2×) · 256K");
    assert.deepEqual(windowChoices(null), []);
    assert.equal(windowWithCost({ via: "setting", options: [200_000, 1_000_000], standard: 200_000 }, 1_000_000), "1M");
  });

  test("windows are typed the way the picker says them", () => {
    assert.deepEqual(parseWindows("200K, 1M"), [200000, 1000000]);
    assert.deepEqual(parseWindows("1m 200k 1M"), [200000, 1000000], "duplicates fold and the list sorts");
    assert.deepEqual(parseWindows("262144"), [262144]);
    assert.deepEqual(parseWindows("1.05M"), [1050000]);
    assert.deepEqual(parseWindows(""), []);
    assert.equal(parseWindows("200K, lots"), null, "a word that is not a window refuses the whole list");
    assert.equal(parseWindows("512"), null, "under 1,000 tokens is no window");
  });

  test("the windows box is filled with what parses back to the same windows, token for token", () => {
    for (const list of [[200000, 1000000], [262144, 12582912], [131072], [1050000, 2000000]]) assert.deepEqual(parseWindows(windowsText(list)), list, windowsText(list));
    assert.equal(windowsText([200000, 1000000]), "200K, 1M");
    assert.equal(windowsText([262144]), "262144", "not 262K, which would come back as 262,000");
  });

  test("window words: K and M, a dash for nothing", () => {
    assert.equal(winWords(200000), "200K");
    assert.equal(winWords(1000000), "1M");
    assert.equal(winWords(1050000), "1.05M");
    assert.equal(winWords(512), "512");
    assert.equal(winWords(0), "–");
    assert.equal(winWords(undefined), "–");
  });

  test("every source has words, and an unknown one says nobody", () => {
    for (const s of ["operator", "endpoint", "rules", "builtin", "name"]) assert.ok(sourceLong(s).length > 6, s);
    assert.equal(sourceLong(null), "nobody states it");
  });
});

describe("the can-do chips", () => {
  const base = (over = {}) => ({
    caps: {
      wire: "openai",
      effort: { levels: null, source: null },
      fast: { available: false, declared: false, source: null, multiplier: null },
      thinking: { available: false, source: null },
      window: { standard: null, options: [], source: null },
      maxOutput: { tokens: null, source: null },
      ...over.caps,
    },
    offer: { kind: "plain", ...over.offer },
    policy: { effortAllowed: null, speedMode: "client", speedSuffix: true, ...over.policy },
  });

  test("reasoning, fast with its price, windows and the output ceiling, each styled by who said it", () => {
    const chips = capChips(h,base({
      caps: { effort: { levels: ["low", "medium", "high"], source: "endpoint" }, fast: { available: true, source: "operator", multiplier: 2 }, window: { standard: 200000, options: [200000, 1000000], source: "builtin" }, maxOutput: { tokens: 64000, source: "endpoint" } },
      offer: { effort: { via: "setting", levels: ["low", "medium", "high"] }, speed: { via: "setting", options: ["standard", "fast"], multiplier: 2 }, window: { via: "setting", options: [200000, 1000000] } },
    }));
    const got = chips.map((c) => [textOf(c), c.attrs.class]);
    assert.deepEqual(got, [
      ["reasoning low–high", "cap-chip src-endpoint"],
      ["fast 2×", "cap-chip src-operator"],
      ["200K · 1M", "cap-chip src-builtin"],
      ["out 64K", "cap-chip src-endpoint"],
    ]);
    assert.match(chips[1].attrs.title, /2× the standard price/);
    assert.match(chips[1].attrs.title, /set on this upstream/);
    const plan = capChips(h,{ ...base({ caps: { fast: { available: true, source: "operator", multiplier: 2 } }, offer: { speed: { via: "setting", options: ["standard", "fast"], multiplier: 2 } } }), billing: { billing: "plan", source: "upstream" } });
    assert.match(plan[0].attrs.title, /^Fast mode, costing 2× your plan's usage/, "a subscription plan (Providers P4): the plan's usage, not the price");
  });

  test("a fast mode declared without the fields that ask for it is a warning, not an offer", () => {
    const [chip] = capChips(h,base({ caps: { fast: { available: false, declared: true, missing: "params", source: "operator" } } }));
    assert.equal(textOf(chip), "fast: needs fields");
    assert.match(chip.attrs.class, /\bwarn\b/);
    assert.match(chip.attrs.title, /service_tier = priority/);
  });

  test("a flex tier (Providers P5): its price against the standard one, the plan's usage on a plan, a warning without fields", () => {
    const flex = { flex: { available: true, declared: true, source: "operator", multiplier: 0.5 } };
    const offer = { speed: { via: "setting", options: ["standard", "flex"], flexMultiplier: 0.5 } };
    const [chip] = capChips(h,base({ caps: flex, offer }));
    assert.deepEqual([textOf(chip), chip.attrs.class], ["flex 0.5×", "cap-chip src-operator"]);
    assert.match(chip.attrs.title, /0\.5× the standard price when it is served there/);
    const [plan] = capChips(h,{ ...base({ caps: flex, offer }), billing: { billing: "plan", source: "upstream" } });
    assert.match(plan.attrs.title, /0\.5× your plan's usage/);
    const [bare] = capChips(h,base({ caps: flex, offer: { speed: { via: "setting", options: ["standard", "flex"] } } }));
    assert.equal(textOf(bare), "flex", "no multiplier stated: no price said");
    const [warn] = capChips(h,base({ caps: { flex: { available: false, declared: true, missing: "params", source: "operator" } } }));
    assert.equal(textOf(warn), "flex: needs fields");
    assert.match(warn.attrs.class, /\bwarn\b/);
    assert.match(warn.attrs.title, /service_tier = flex/);
  });

  test("fast mode the Rules page turns off is shown struck, with why", () => {
    const [chip] = capChips(h,base({ caps: { fast: { available: true, source: "rules", multiplier: 2 } }, policy: { speedMode: "never" } }));
    assert.equal(textOf(chip), "fast off");
    assert.match(chip.attrs.class, /\bmuted\b/);
    assert.match(chip.attrs.title, /speed mode is never/);
  });

  test("a model that takes no effort field says so; one nobody knows says nothing", () => {
    const [none] = capChips(h,base({ caps: { effort: { levels: [], source: "operator" } } }));
    assert.equal(textOf(none), "no reasoning field");
    assert.deepEqual(capChips(h,base()), [], "no chips when nothing is known: the cell shows a dash");
    const builtinEmpty = capChips(h,base({ caps: { effort: { levels: [], source: "builtin" } } }));
    assert.deepEqual(builtinEmpty, [], "a built-in 'none' is not news worth a chip");
  });

  test("variants the provider lists as ids of their own are credited to the ids", () => {
    const chips = capChips(h,base({
      caps: { fast: { available: false, source: null } },
      offer: { kind: "variants", effort: { via: "name", levels: ["low", "high"] }, speed: { via: "name", options: ["standard", "fast"], multiplier: 3 }, thinking: { via: "name" } },
    }));
    assert.deepEqual(chips.map((c) => [textOf(c), c.attrs.class]), [["reasoning low–high", "cap-chip src-name"], ["fast 3×", "cap-chip src-name"], ["thinking", "cap-chip src-name"]]);
    assert.match(chips[1].attrs.title, /ids of their own/);
  });

  test("a value a prefix row said is marked inherited and names the row; the model's own row is not", () => {
    const entry = (rowKey) => ({ ...base({ caps: { effort: { levels: ["low", "high"], source: "operator" } }, offer: { effort: { via: "setting", levels: ["low", "high"] } } }), sent: "grok-4.7-mini", rowKeys: { efforts: rowKey } });
    const [fromPrefix] = capChips(h,entry("grok-4.7"));
    assert.match(fromPrefix.attrs.class, /\binherited\b/);
    assert.match(fromPrefix.attrs.title, /row “grok-4\.7”, which covers every model whose name starts with it/);
    const [own] = capChips(h,entry("grok-4.7-mini"));
    assert.doesNotMatch(own.attrs.class, /inherited/);
    assert.match(own.attrs.title, /set on this upstream$/);
  });

  test("an output ceiling only Filament's built-ins know is left to the Tune sheet", () => {
    assert.deepEqual(capChips(h,base({ caps: { maxOutput: { tokens: 128000, source: "builtin" } } })), []);
  });
});

describe("the caps loader", () => {
  test("sends the draft's rows and rules — never its key — and caches on them", async () => {
    const calls = [];
    const load = capsLoader(async (path, opts) => { calls.push({ path, opts }); return { models: [{ id: "x/grok-4.7", caps: {} }], errors: ["pricing[\"grok\"].fast: must be true or false"], agent: false }; });
    const u = { id: "x", apiKey: "sk-secret", baseUrl: "https://api.x.ai/v1", pricing: { "grok-4.7": { fast: true } }, rules: { speed: { mode: "client" } } };
    const r = await load(u, ["x/grok-4.7"]);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, "/models/caps");
    assert.equal(calls[0].opts.method, "POST");
    assert.deepEqual(Object.keys(calls[0].opts.body.upstream).sort(), ["id", "pricing", "rules"]);
    assert.doesNotMatch(JSON.stringify(calls[0].opts.body), /sk-secret/);
    assert.ok(r.byId.get("x/grok-4.7"));
    assert.deepEqual(r.errors, ["pricing[\"grok\"].fast: must be true or false"]);

    await load(u, ["x/grok-4.7"]);
    assert.equal(calls.length, 1, "the same draft is asked once");
    await load({ ...u, pricing: { "grok-4.7": { fast: false } } }, ["x/grok-4.7"]);
    assert.equal(calls.length, 2, "a changed row asks again");
    load.clear();
    await load(u, ["x/grok-4.7"]);
    assert.equal(calls.length, 3, "a Refresh list clears what was known");
  });

  test("a failed ask answers empty with the reason, and the table shows dashes", async () => {
    const r = await capsLoader(async () => { throw new Error("upstream \"x\" is not in the saved configuration"); })({ id: "x" }, []);
    assert.equal(r.byId.size, 0);
    assert.match(r.error, /not in the saved configuration/);
  });
});

// Providers P4: an unstated cache price is the in price, so the sheet says so, and never writes the derived figure
// back as if it had been typed.
// (fails before: yes — the sheet read "$2 cached" off a row that named only in and out, and carried it into the row)
describe("the Pricing section's figures", () => {
  const fmt = (/** @type {unknown} */ v) => `$${v}`;
  const derived = { input: 2, output: 8, cacheRead: 2, cacheWrite: 2, source: "upstream", stated: ["input", "output"] };
  test("a cache price the row leaves out is said as the in price", () => {
    assert.equal(priceWords(derived, fmt), "$2 in · cached at the in price · $8 out");
    assert.equal(priceWords({ ...derived, cacheRead: 0.2, stated: ["input", "output", "cacheRead"] }, fmt), "$2 in · $0.2 cached · $8 out");
    assert.equal(priceWords(null, fmt), "no list price known");
    assert.equal(statedIn(derived, "cacheWrite"), false);
  });
  test("typing one box carries only the figures the row states", () => {
    assert.deepEqual(carriedPrices(derived, "input"), { output: 8 }, "not the derived cache prices");
    assert.deepEqual(carriedPrices({ input: 2, output: 8, cacheRead: 0.5, cacheWrite: 0, stated: ["input", "output", "cacheRead", "cacheWrite"] }, "output"), { input: 2, cacheRead: 0.5 }, "a $0 is never carried");
    assert.deepEqual(carriedPrices(null, "input"), {});
  });
});

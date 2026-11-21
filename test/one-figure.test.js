// @ts-check
// HarnessV3-Launch LD-D17 (F30): the prompt and tools had two figures. The Context popover took them as what was left
// of the provider's count after memory and the history, while the Context Map and /autofit took the composer's
// estimate of what rides beside the history (`fixedTokens`). The record keeps the composer's figure now
// (`view.fixedTokens`, stamped with the view): the popover's System & tools is that figure, and the Conversation takes
// the rest of what the provider counted, after memory, never below 0. A gap past 15% between the parts and the count is
// said, as before. A record without the figure — a client's session, which sends its own prompt and tools, or a record
// from before — keeps the old rule.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { contextSources } from "../src/ui/harness/widgets/context.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";

/** A row's figure, 0 when the popover leaves it out. @param {{ rows: [string, number][] }} src @param {string} label */
const row = (src, label) => src.rows.find(([l]) => l === label)?.[1] || 0;

describe("the popover's parts", () => {
  // (fails before: yes — System & tools was what the count left, 10,000 − 500 − 6,000 = 3,500, not the composer's 4,000)
  test("with the composer's figure: System & tools is it, and the Conversation is the rest of the count after memory", () => {
    const src = contextSources({ tokens: { input: 10000 }, memory: { tokens: 500, composition: { briefing: 300 } }, view: { fixedTokens: 4000, historyTokens: 6000, shapedTokens: 6000, composition: { userText: 24000 } } });
    assert.deepEqual(src.rows, [["System & tools", 4000], ["Briefing", 300], ["Memory blocks", 200], ["Conversation", 5500]]);
    assert.deepEqual([src.mismatch, src.sysItemised, src.reconciled], [null, true, true]);
  });

  // (fails before: yes — the old rule gave System & tools what the count left: 500 of the first, nothing of the second)
  test("an estimate past the count by more than 15% is said, the figure stands, and the Conversation never goes below 0", () => {
    const over = contextSources({ tokens: { input: 10000 }, memory: { tokens: 500 }, view: { fixedTokens: 4000, historyTokens: 9000, shapedTokens: 9000, composition: {} } });
    assert.deepEqual([row(over, "System & tools"), row(over, "Memory blocks"), row(over, "Conversation")], [4000, 500, 5500]);
    assert.deepEqual(over.mismatch, { estimate: 13500, real: 10000 }, "the parts as estimated: memory, the figure, the history");
    const past = contextSources({ tokens: { input: 3000 }, memory: { tokens: 500 }, view: { fixedTokens: 4000, historyTokens: 100, shapedTokens: 100, composition: {} } });
    assert.deepEqual(past.rows, [["System & tools", 4000], ["Memory blocks", 500]], "nothing left for the conversation");
    assert.deepEqual(past.mismatch, { estimate: 4600, real: 3000 });
    const near = contextSources({ tokens: { input: 10000 }, memory: { tokens: 500 }, view: { fixedTokens: 4000, historyTokens: 7000, shapedTokens: 7000, composition: {} } });
    assert.equal(near.mismatch, null, "11,500 is within 15% of 10,000");
  });

  // (fails before: yes — the end state's System & tools was what its count left after its conversation's characters)
  test("an agent turn's end state: the same figure, and its newest round's count less memory and it is the conversation, sub-agents' share carved out", () => {
    const comp = { userText: 4000, subagents: 4000, system: 12000, tools: 8000 };
    const rec = { tokens: { input: 1000 }, view: { fixedTokens: 3000, historyTokens: 500, shapedTokens: 500, composition: { userText: 400, system: 12000, tools: 8000 } }, context: { last: { held: 9000, composition: comp } } };
    const src = contextSources(rec, 1000);
    assert.deepEqual([row(src, "System & tools"), row(src, "Sub-agents"), row(src, "Conversation")], [3000, 3000, 3000], "half the conversation's characters are sub-agents'");
    assert.equal(src.mismatch, null);
  });

  // (fails before: no — a guard: the old rule stands where the composer weighed nothing)
  test("a record without the figure keeps the old rule: System & tools is what the count leaves", () => {
    const src = contextSources({ tokens: { input: 10000 }, memory: { tokens: 500 }, view: { historyTokens: 6000, shapedTokens: 6000, composition: {} } });
    assert.deepEqual(src.rows, [["System & tools", 3500], ["Memory blocks", 500], ["Conversation", 6000]]);
  });

  // (fails before: no — L4's mutation pass: a record whose prompt and tools nobody weighed kept `fixedTokens: 0`, a
  // claim that nothing rode beside the history, where a client's own prompt and tools did)
  test("a session turn whose prompt and tools Filament does not weigh: its record leaves the figure out, never says 0", async () => {
    const { composed } = await import("../src/app/pipeline/stages/composed.js");
    const stamp = async (/** @type {any} */ fixedTokens) => {
      /** @type {any} */
      const ctx = { pre: { api: "session", composition: { fixedTokens } }, rec: {}, body: { messages: [] }, format: "anthropic" };
      await composed(ctx, /** @type {any} */ ({}));
      return ctx.rec.view;
    };
    assert.equal(Object.hasOwn(await stamp(0), "fixedTokens"), false, "not weighed is not 0");
    assert.equal(Object.hasOwn(await stamp(undefined), "fixedTokens"), false);
    assert.equal((await stamp(4000)).fixedTokens, 4000, "a weighed part is kept");
  });
});

describe("one figure, end to end", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  before(async () => {
    up = await fakeUpstream((call) => (call.kind === "anthropic" ? anthropicReply("", { model: String(call.body?.model || "m-1"), stop: "end_turn", blocks: [{ type: "text", text: "done." }], usage: { input_tokens: 9000, output_tokens: 3 } }) : undefined));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
        cfg.routes = [{ match: "m-1", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: yes — the record kept no figure, so the popover's part was the count's remainder)
  test("a harness turn's record keeps the composer's figure: the popover, the Context Map and /autofit say the same", async () => {
    const { id } = await (await shim.api("/api/sessions", { method: "POST", body: { cwd: shim.dataDir, model: "m-1" } })).json();
    const turn = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(turn.status, 200, await turn.clone().text());
    await turn.text();
    const rec = await shim.record(String(turn.headers.get("x-filament-request-id")));
    const fixed = Number(rec.view?.fixedTokens);
    assert.ok(fixed > 0, `the record keeps the loop's part: ${JSON.stringify(rec.view?.fixedTokens)}`);
    assert.equal(row(contextSources(rec), "System & tools"), fixed, "the popover's System & tools");
    const { current } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/compose?dry=1`)).json();
    assert.equal(current.fixed, fixed, "the Context Map's prompt and tools");
    const fit = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "/autofit", stream: false } });
    const said = await fit.text();
    assert.equal(fit.status, 200, said);
    assert.ok(said.includes(`its prompt and tools ≈${fixed.toLocaleString("en-US")}`), said);
  });
});

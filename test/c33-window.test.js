// @ts-check
// HarnessV4_Tasks C33 step 1, a window nobody knows: the line, the card and the meter's percent are shares of the
// reader's window, so where no one names it (Cursor's SDK lists none; a model Filament's table has not heard of) the
// session had no line and said nothing of why. The Context popover says so and takes the number once: it is kept on
// the model's own row at its upstream, the operator's word, for every chat on that model. And the limit an agent
// names as it refuses a prompt for size is kept as the window it named.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { exactRowKey, contextWindowWithSource } from "../src/core/pricing.js";
import { windowAsk, windowTokensOf } from "../src/ui/harness/widgets/context.js";
import { overflowSaid } from "../src/adapters/agents/acp/failures.js";

describe("the words and the figures", () => {
  test("the row that names a model itself, never a shorter one that speaks for its siblings", () => {
    const table = { "glm-5p3": { contextTokens: 128_000 }, "glm-5p3-flash": { input: 1 }, "claude-opus": { contextTokens: 1_000_000 } };
    assert.equal(exactRowKey("glm-5p3-flash", table), "glm-5p3-flash");
    assert.equal(exactRowKey("glm-5p3", table), "glm-5p3");
    assert.equal(exactRowKey("glm-5p3-turbo", table), null, "a wider row covers it, but none is its own");
    assert.equal(exactRowKey("x/GLM-5p3-Flash", table), "glm-5p3-flash", "read as rows are matched: the name alone, lower case");
    assert.equal(exactRowKey("glm-5p3", null), null);
    assert.deepEqual(contextWindowWithSource("glm-5p3-flash", { ...table, "glm-5p3-flash": { input: 1, contextTokens: 200_000 } }), { tokens: 200_000, source: "operator" }, "the model's own row wins over the wider one");
  });

  test("the tokens a person's words name", () => {
    assert.deepEqual(["200k", "1m", "1.5M", "200,000", "128000", "200k tokens"].map(windowTokensOf), [200_000, 1_000_000, 1_500_000, 200_000, 128_000, 200_000]);
    assert.deepEqual(["", "big", "999", "0", "-2k"].map(windowTokensOf), [null, null, null, null, null]);
  });

  // (fails before: yes — with no window the popover drew no bar and gave no reason and no way to say one)
  test("what the popover says: nobody knows, or you said it; nothing where another said it", () => {
    const o = { agent: true, named: false, modelName: "GLM 5.3 Flash" };
    const unknown = windowAsk({ tokens: null, source: null, settable: true, own: false }, o);
    assert.equal(unknown?.state, "unknown");
    assert.match(String(unknown?.words), /^Nobody knows GLM 5\.3 Flash's window: the agent names none.*no line: nothing asks before a message/);
    assert.match(String(windowAsk({ tokens: null, settable: true }, { ...o, agent: false })?.words), /weighs its requests against an assumed 200,000 tokens/);
    assert.deepEqual(windowAsk({ tokens: 200_000, source: "operator", settable: true, own: true }, o), { state: "yours", words: "You said GLM 5.3 Flash's window: 200,000 tokens. It holds for every chat on this model." });
    assert.equal(windowAsk({ tokens: 200_000, source: "builtin", settable: true, own: false }, o), null, "Filament's table said it");
    assert.equal(windowAsk({ tokens: 128_000, source: "operator", settable: true, own: false }, o), null, "a wider row of the dashboard's said it");
    assert.equal(windowAsk({ tokens: null, settable: true, own: false }, { ...o, named: true }), null, "the agent named its window itself");
    assert.equal(windowAsk({ tokens: null, settable: false }, o), null, "no upstream to keep it on");
    assert.equal(windowAsk(null, o), null);
  });

  test("the most its context takes, as an agent's refusal names it", () => {
    assert.deepEqual(overflowSaid(new Error("Prompt is too long: 212000 tokens > 200000 maximum")), { max: 200_000, counted: 212_000 });
    assert.equal(overflowSaid(new Error("it did not fit")).max, null);
  });
});

describe("through the app", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  let root = "";
  let projDir = "";
  before(async () => {
    root = mkdtempSync(join(tmpdir(), "filament-c33-window-"));
    projDir = join(root, "project");
    mkdirSync(projDir);
    up = await fakeUpstream(() => anthropicReply("ok", { model: "mystery-1", usage: { input_tokens: 10, output_tokens: 5 } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "known-": { contextTokens: 64_000 } } }];
        cfg.routes = [{ match: "*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "auto", roots: [root], readerModel: "" };
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
    await removeDirs(root);
  });
  /** @param {string} model */
  const open = async (model) => String((await (await shim.api("/api/sessions", { method: "POST", body: { cwd: projDir, model, preset: "plain" } })).json()).id);
  /** @param {string} id */
  const windowOf = async (id) => (await (await shim.api(`/api/sessions/${id}/settings`)).json()).window;
  /** @param {string} id @param {any} body */
  const put = (id, body) => shim.api(`/api/sessions/${id}/window`, { method: "PUT", body });
  /** The upstream's model table as the config holds it now. */
  const table = () => shim.app.config.upstreams.find((/** @type {any} */ u) => u.id === "m").pricing;

  // (fails before: yes — no route: the harness had nowhere to say a window, and a session's own `model.window` only
  // picks among windows the model is known to offer)
  test("said once, it is the model's window for every chat on it; taken back, nobody knows again", async () => {
    const id = await open("mystery-1");
    assert.deepEqual(await windowOf(id), { tokens: null, source: null, model: "mystery-1", sent: "mystery-1", settable: true, own: false });
    const res = await put(id, { tokens: 200_000 });
    assert.equal(res.status, 200, await res.clone().text());
    assert.deepEqual((await res.json()).window, { tokens: 200_000, source: "operator", model: "mystery-1", sent: "mystery-1", settable: true, own: true });
    assert.deepEqual(table()["mystery-1"], { contextTokens: 200_000 });
    assert.deepEqual(await windowOf(await open("mystery-1")), { tokens: 200_000, source: "operator", model: "mystery-1", sent: "mystery-1", settable: true, own: true }, "another chat on the model");
    assert.equal((await windowOf(await open("mystery-2"))).tokens, null, "another model is not spoken for");
    // Said again, another figure; the same figure writes nothing.
    assert.equal((await (await put(id, { tokens: 128_000 })).json()).window.tokens, 128_000);
    assert.equal((await (await put(id, { tokens: 128_000 })).json()).changed, false);
    const back = await put(id, { tokens: null });
    assert.equal(back.status, 200, await back.clone().text());
    assert.deepEqual((await back.json()).window, { tokens: null, source: null, model: "mystery-1", sent: "mystery-1", settable: true, own: false });
    assert.equal(table()["mystery-1"], undefined, "the row held nothing else, so it is gone");
  });

  test("refused in words: no number, nothing to take back, a wider row's word", async () => {
    const id = await open("mystery-3");
    /** @param {any} body */
    const refused = async (body, target = id) => { const r = await put(target, body); return [r.status, String((await r.json()).error || "")]; };
    assert.deepEqual(await refused({ tokens: 500 }), [400, "a window is a number of tokens, 1,000 or more"]);
    assert.equal((await refused({ tokens: "200k" }))[0], 400);
    assert.equal((await refused({}))[0], 400);
    assert.deepEqual(await refused({ tokens: null }), [409, "nobody has said this model's window here: there is nothing to take back"]);
    const wide = await open("known-1");
    assert.deepEqual(await windowOf(wide), { tokens: 64_000, source: "operator", model: "known-1", sent: "known-1", settable: true, own: false });
    assert.deepEqual(await refused({ tokens: null }, wide), [409, "this window is said on a wider row of the upstream's model table: the dashboard's Model tune page changes it"]);
    // Said here all the same: the model's own row, over the wider one, which keeps its word for the siblings.
    assert.equal((await (await put(wide, { tokens: 32_000 })).json()).window.tokens, 32_000);
    assert.deepEqual([table()["known-1"], table()["known-"]], [{ contextTokens: 32_000 }, { contextTokens: 64_000 }]);
  });
});

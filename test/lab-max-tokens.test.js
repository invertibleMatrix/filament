// @ts-check
// HarnessV4_Tasks decision 12: the Lab playground's max_tokens is empty by default, and empty means the most the model
// can write — its own ceiling, the number Filament's own calls ask for. It was 512, so a test of a reasoning model was
// cut off before its answer. Where Filament knows no ceiling, Anthropic's format, which requires the field, takes
// Filament's default; an OpenAI-style request leaves it out, and the provider's own limit applies.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { bindUi, state as runtimeState } from "../src/ui/runtime.js";
import { playground } from "../src/ui/pages/lab.js";
import { fakeH } from "./helpers/fake-dom.js";
import { fmt } from "../src/ui/lib/format.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

describe("the Lab's max_tokens (decision 12)", () => {
  /** @type {any} */
  const state = runtimeState;
  const g = /** @type {any} */ (globalThis);
  const hadLocation = "location" in g;
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  /** @param {any} el @param {(n: any) => boolean} ok @returns {any[]} */
  const all = (el, ok, out = /** @type {any[]} */ ([])) => {
    if (!el || typeof el !== "object") return out;
    if (ok(el)) out.push(el);
    for (const k of el.kids || []) all(k, ok, out);
    return out;
  };
  before(() => {
    if (!hadLocation) g.location = { protocol: "http:", host: "127.0.0.1:1" };
    bindUi({
      h: fakeH, fmt, toast() {}, render() {}, openRequest() {},
      intro: (/** @type {string} */ _id, /** @type {any[]} */ ...k) => fakeH("div", {}, ...k),
      upLabel: (/** @type {any} */ u) => u?.name || "",
      api: async (/** @type {string} */ path) =>
        path === "/models"
          ? { models: [{ id: "glm/glm-5.3-flash", upstream: "glm", outputCeiling: 131072 }, { id: "odd/unknown-1", upstream: "odd", outputCeiling: null }], outputDefault: 128000 }
          : {},
    });
    Object.assign(state, { keys: ["sk-test-key"], config: { upstreams: [] } });
  });
  after(() => {
    if (!hadLocation) delete g.location;
    delete state.pg;
  });
  /** The Lab drawn for a client and a model, once the model list is in. @param {string} client @param {string} model */
  const lab = async (client, model) => {
    state.pg = { client, endpoint: "chat", model, effort: "", mode: "", stream: false, prompt: "hi", system: "", image: null, maxTokens: null, showRaw: false, raw: "", adv: false };
    const page = playground();
    await settle();
    const pre = all(page, (n) => n.tag === "pre" && n.attrs?.style === "max-height:260px")[0];
    const box = all(page, (n) => n.tag === "input" && n.attrs?.type === "number")[0];
    const body = () => JSON.parse(String(pre.textContent).split("\n\n")[1]);
    return { box, body };
  };

  // (fails before: yes — the box held 512, and every request the Lab sent was cut at 512 tokens)
  test("empty by default: Anthropic's request asks for the model's own ceiling, the box says it; a number of yours goes instead; emptied, the ceiling again", async () => {
    const { box, body } = await lab("anthropic", "glm/glm-5.3-flash");
    assert.equal(box.attrs.value, "", "the box starts empty");
    assert.equal(box.placeholder, "most: 131,072", "and says what empty sends");
    assert.equal(body().max_tokens, 131072);
    box.value = "300";
    box.onchange();
    assert.equal(body().max_tokens, 300);
    box.value = "";
    box.onchange();
    assert.equal(body().max_tokens, 131072);
    assert.equal(state.pg.maxTokens, null);
  });

  test("a model Filament knows no ceiling of: Anthropic's format takes Filament's default; OpenAI's and the Responses API's leave the field out", async () => {
    const anthropic = await lab("anthropic", "odd/unknown-1");
    assert.deepEqual([anthropic.body().max_tokens, anthropic.box.placeholder], [128000, "most: 128,000"]);
    const openai = await lab("openai", "odd/unknown-1");
    assert.equal("max_tokens" in openai.body(), false, "the provider's own limit applies");
    assert.equal(openai.box.placeholder, "its own limit");
    const responses = await lab("responses", "odd/unknown-1");
    assert.equal("max_output_tokens" in responses.body(), false);
    const known = await lab("openai", "glm/glm-5.3-flash");
    assert.equal(known.body().max_tokens, 131072, "a known ceiling goes in every format");
    assert.equal((await lab("responses", "glm/glm-5.3-flash")).body().max_output_tokens, 131072);
  });
});

describe("the model list says each model's ceiling (decision 12)", () => {
  /** @type {any} */ let up;
  /** @type {any} */ let shim;
  before(async () => {
    up = await fakeUpstream(async () => ({ status: 200, json: { data: [] } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "roomy-model": { maxOutputTokens: 64000 } } }];
        cfg.routes = [{ match: "roomy-model", upstream: "m", upstreamModel: "{model}", enabled: true }, { match: "plain-model", upstream: "m", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await up.close();
  });

  // (fails before: yes — the list said no model's ceiling, and the page had only its own 512)
  test("its stated ceiling, null where none is stated, and the default Filament asks for then", async () => {
    const j = await (await shim.api("/api/models")).json();
    const of = (/** @type {string} */ id) => j.models.find((/** @type {any} */ m) => m.id === id);
    assert.equal(of("roomy-model")?.outputCeiling, 64000, JSON.stringify(j.models.map((/** @type {any} */ m) => m.id)));
    assert.ok(of("plain-model"), "listed");
    assert.equal(of("plain-model").outputCeiling, null);
    assert.equal(j.outputDefault, 128000);
  });
});

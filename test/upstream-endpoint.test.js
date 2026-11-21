// @ts-check
// upstreamEndpoint / upstreamVersionedBase: the URL Filament builds for an upstream, across base-URL shapes.
// Regression: an openai-compatible base ending in a non-/v1 version (z.ai's /v4) used to get /v1/chat/completions
// appended verbatim (-> …/v4/v1/chat/completions, gateway 404, and the wireApi=auto detour then latched the
// upstream as "responses-only" until restart). The version on the base now leads every path Filament appends.
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
import { upstreamEndpoint, upstreamVersionedBase } from "../src/core/routing.js";
import { UPSTREAM } from "../src/core/schema.js";
import { startApp, fakeUpstream } from "./helpers/app.js";

const up = (baseUrl, extra = {}) => ({ id: "u", type: "openai-compatible", baseUrl, ...extra });

describe("upstreamEndpoint: versioned base URLs", () => {
  test("a /v4 base keeps v4 on the chat path (z.ai coding endpoint)", () => {
    assert.equal(
      upstreamEndpoint(up("https://api.z.ai/api/coding/paas/v4"), "openai"),
      "https://api.z.ai/api/coding/paas/v4/chat/completions",
    );
  });

  test("a /v1 base behaves exactly as before", () => {
    assert.equal(
      upstreamEndpoint(up("https://api.openai.com/v1"), "openai"),
      "https://api.openai.com/v1/chat/completions",
    );
    assert.equal(
      upstreamEndpoint(up("https://api.openai.com/v1"), "openai", { wire: "responses" }),
      "https://api.openai.com/v1/responses",
    );
  });

  test("a base with no version gets /v1, as before", () => {
    assert.equal(
      upstreamEndpoint(up("http://localhost:11434"), "openai"),
      "http://localhost:11434/v1/chat/completions",
    );
  });

  test("a /v4 base keeps v4 on the responses detour too", () => {
    assert.equal(
      upstreamEndpoint(up("https://api.z.ai/api/coding/paas/v4"), "openai", { wire: "responses" }),
      "https://api.z.ai/api/coding/paas/v4/responses",
    );
  });

  test("a base that already IS the full endpoint is used as-is", () => {
    assert.equal(
      upstreamEndpoint(up("https://example.com/v4/chat/completions"), "openai"),
      "https://example.com/v4/chat/completions",
    );
  });

  test("trailing slashes and case-insensitive versions are normalised", () => {
    assert.equal(
      upstreamEndpoint(up("https://api.z.ai/api/coding/paas/V4/"), "openai"),
      "https://api.z.ai/api/coding/paas/V4/chat/completions",
    );
  });

  test("anthropic upstreams keep their /v1/messages?beta=true shape", () => {
    assert.equal(
      upstreamEndpoint({ id: "a", type: "anthropic", baseUrl: "https://api.anthropic.com" }, "anthropic"),
      "https://api.anthropic.com/v1/messages?beta=true",
    );
  });
});

describe("upstreamVersionedBase", () => {
  test("splits a /v4 base into base + version", () => {
    assert.deepEqual(upstreamVersionedBase(up("https://api.z.ai/api/coding/paas/v4")), [
      "https://api.z.ai/api/coding/paas",
      "v4",
    ]);
  });

  test("a versionless base defaults to v1", () => {
    assert.deepEqual(upstreamVersionedBase(up("http://localhost:11434")), ["http://localhost:11434", "v1"]);
  });

  test("a /v1 base splits as before", () => {
    assert.deepEqual(upstreamVersionedBase(up("https://api.openai.com/v1/")), ["https://api.openai.com", "v1"]);
  });
});

// BUG-04: the words next to the fields promised `/v1` for every base — the rule is the base's own version.
describe("the upstream fields say the version rule", () => {
  test("baseUrl, modelsPath and the Upstreams page name the base's version, not a fixed /v1", () => {
    const doc = (/** @type {any} */ (UPSTREAM)).baseUrl;
    assert.match(String(doc.effect), /its own version/, doc.effect);
    assert.match(String(doc.effect), /\/v4/, "the GLM-style example is given");
    assert.match(String((/** @type {any} */ (UPSTREAM)).modelsPath.effect), /base's version/);
    const page = readFileSync("src/ui/pages/destinations.js", "utf8");
    assert.ok(!page.includes("models path (blank = /v1/models)"), "the label no longer promises /v1/models");
    assert.ok(!page.includes("discover models (/v1/models)"));
  });
});

// The code review of 2026-09-30: embeddings still stripped the version and appended /v1 (…/paas/v4 -> …/paas/v1/
// embeddings). An auxiliary endpoint lives under the base's own version, as the model list and the connection test do.
describe("embeddings under a versioned base", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let fake;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  before(async () => {
    fake = await fakeUpstream(async (call) => ({ status: 200, json: { object: "list", data: [{ object: "embedding", index: 0, embedding: [0.1] }], model: call.body?.model, usage: { prompt_tokens: 3, total_tokens: 3 } } }));
    shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "zai", name: "ZAI", type: "openai-compatible", baseUrl: `${fake.url}/api/coding/paas/v4`, apiKey: "k", enabled: true }];
        cfg.routes = [{ match: "embedding-*", upstream: "zai", upstreamModel: "{model}", enabled: true }];
      },
    });
  });
  after(async () => {
    await shim.stop();
    await fake.close();
  });
  test("a /v4 base sends /v4/embeddings, never /v1/embeddings", async () => {
    const r = await shim.post("/v1/embeddings", { model: "embedding-3", input: "hello" });
    assert.equal(r.status, 200, await r.clone().text());
    assert.equal(fake.received.at(-1)?.path, "/api/coding/paas/v4/embeddings");
  });
});

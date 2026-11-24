// A provider's redirect is never followed (adapters/providers/fetch.js): a call carries its provider's key, and Node's
// fetch hands a header of the provider's own (`x-api-key`) on to the address a redirect names. The call, the model
// listing and Qoder's chat each fail in words, and the other address hears nothing. A connector's own redirects are
// mcp-connector.test.js's.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchUpstreamModels, forwardRequest, httpDestination, probeProviderModels, testProvider } from "../src/adapters/providers/http.js";
import { providerFetch, redirected } from "../src/adapters/providers/fetch.js";
import { chat as qoderChat } from "../src/adapters/providers/qoder.js";

/** @type {http.Server} */
let here;
/** @type {http.Server} */
let there;
let hereUrl = "";
let thereUrl = "";
/** What the other address was sent: each request's path and its key headers. @type {{ path: string, key: string, auth: string }[]} */
const heard = [];

/** @param {http.Server} s */
const urlOf = (s) => `http://127.0.0.1:${/** @type {import("node:net").AddressInfo} */ (s.address()).port}`;

before(async () => {
  there = http.createServer((req, res) => {
    heard.push({ path: String(req.url), key: String(req.headers["x-api-key"] || ""), auth: String(req.headers.authorization || "") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ id: "stolen" }] }));
  });
  await new Promise((r) => there.listen(0, "127.0.0.1", () => r(undefined)));
  thereUrl = urlOf(there);
  here = http.createServer((req, res) => {
    req.resume();
    res.writeHead(307, { location: `${thereUrl}${req.url}` });
    res.end();
  });
  await new Promise((r) => here.listen(0, "127.0.0.1", () => r(undefined)));
  hereUrl = urlOf(here);
});
after(async () => {
  await new Promise((r) => here.close(() => r(undefined)));
  await new Promise((r) => there.close(() => r(undefined)));
});

test("a provider's call answered with a redirect fails in words, not worth another try, and its key goes nowhere else", async () => {
  heard.length = 0;
  const upstream = { id: "p", type: "anthropic", baseUrl: hereUrl, apiKey: "sk-test-redirect" };
  /** @type {any} */
  let failed = null;
  try {
    await forwardRequest({ url: `${hereUrl}/v1/messages`, headers: { "content-type": "application/json", "x-api-key": "sk-test-redirect" }, bodyString: "{}", signal: undefined });
  } catch (e) {
    failed = e;
  }
  assert.ok(failed, "the call failed");
  assert.equal(failed.redirect, true);
  assert.equal(failed.message, `the provider answered with a redirect (HTTP 307 to ${thereUrl}/v1/messages): a call with its key goes to the address kept and never on elsewhere, so set its address to where it answers`);
  const said = httpDestination(upstream).answers.unreachable(failed);
  assert.equal(said.retryable, false);
  assert.match(said.message, /^upstream p: the provider answered with a redirect \(HTTP 307 /);
  assert.deepEqual(heard, []);
});

// (fails before: yes — the review of x24: a listing's 3xx read as no failure, so Test connection said "ok (307)")
test("a provider's model listing answered with a redirect fails in words — Test connection, the add flow's probe and a Refresh alike — and the other address hears nothing", async () => {
  heard.length = 0;
  const u = { id: "p-redirect", type: "openai", baseUrl: hereUrl, apiKey: "sk-test-redirect", authStyle: "both" };
  const words = new RegExp(`^the provider answered with a redirect \\(HTTP 307 to ${thereUrl.replace(/\./g, "\\.")}/v1/models\\): `);
  const tested = await testProvider(u);
  assert.equal(tested.ok, false, "Test connection says no answer");
  assert.match(String(tested.error), words);
  const probed = await probeProviderModels(u);
  assert.equal(probed.ok, false);
  assert.match(String(probed.error), words);
  const refreshed = await fetchUpstreamModels(u, { force: true });
  assert.equal(refreshed.source, "error");
  assert.match(String(refreshed.error), words);
  assert.deepEqual(heard, []);
});

// (fails before: yes — the review of x24: Qoder's chat call handed its 3xx on as Qoder's reply, a status no failure reads)
test("Qoder's chat call answered with a redirect fails in words, not handed on as its reply", async () => {
  /** @type {string[]} */
  const asked = [];
  const fetchImpl = /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
    asked.push(`${init.method} ${init.redirect}`);
    return url.includes("FetchKeys=") ? new Response(null, { status: 307, headers: { location: "https://elsewhere.example/chat" } }) : new Response("down", { status: 500 });
  });
  const upstream = { id: "q", type: "qoder", qoder: { accessToken: "t-redirect", userId: "u-redirect" } };
  await assert.rejects(qoderChat({ upstream, modelId: "m", body: { model: "m", messages: [{ role: "user", content: "hi" }] }, signal: undefined, fetchImpl }), (/** @type {any} */ e) => {
    assert.equal(e.redirect, true);
    assert.match(e.message, /^its server answered with a redirect \(HTTP 307 to https:\/\/elsewhere\.example\/chat\): /);
    return true;
  });
  assert.equal(asked.at(-1), "POST manual");
});

test("the fetch every provider's call goes through never follows a redirect, whatever its caller asks", async () => {
  heard.length = 0;
  const r = await providerFetch(`${hereUrl}/v1/embeddings`, { method: "POST", headers: { "x-api-key": "sk-test-redirect" }, body: "{}", redirect: "follow" });
  await r.body?.cancel();
  assert.equal(redirected(r), true);
  assert.equal(r.headers.get("location"), `${thereUrl}/v1/embeddings`);
  assert.deepEqual(heard, []);
});

// @ts-check
// HarnessV3-Providers P0 (2026-10-01). F4: a provider added and saved read "Models · 0" until someone pressed Refresh
// — a read never asks a provider (the 2026-09-23 rule: the four-second cold picker was a read that fetched), and
// nothing else asked. Now a save that adds or changes a provider asks it once, in the background; reads still never
// do. F2: the connection test said "10 models" and showed none; it now answers the names.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { testProvider } from "../src/adapters/providers/http.js";
import { createModelCache } from "../src/app/models.js";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const IDS = ["zeta-5", "zeta-5-fast", "zeta-5-mini", "zeta-embed-1"];
/** @type {any} */
let up;
/** @type {any} */
let shim;
/** Resolved by the test to let a slow listing answer. @type {(() => void) | null} */
let release = null;
let slow = false;
/** The keys the fake provider takes. */
const accepted = new Set(["good-key"]);
before(async () => {
  up = await fakeUpstream(async (call) => {
    if (!call.path.includes("/models")) return undefined;
    if (slow) await new Promise((r) => (release = () => r(undefined)));
    if (!accepted.has(String(call.headers.authorization || "").replace(/^Bearer /, ""))) return { status: 401, json: { error: { message: "invalid api key" } } };
    return { json: { object: "list", data: IDS.map((id) => ({ id, object: "model" })) } };
  });
  shim = await startApp({ configure: (cfg) => { cfg.upstreams = []; cfg.routes = []; } });
});
after(async () => {
  release?.();
  await shim?.stop();
  await up?.close();
});

const listCalls = () => up.received.filter((/** @type {any} */ c) => c.path.includes("/models")).length;
/** @param {(cfg: any) => void} edit */
async function save(edit) {
  const st = await (await shim.api("/api/state")).json();
  const cfg = structuredClone(st.config);
  edit(cfg);
  const r = await shim.api("/api/config", { method: "PUT", body: cfg });
  assert.equal(r.status, 200, await r.text());
}
const adminModels = async (q = "") => (await shim.api(`/api/models${q}`)).json();
/** @param {() => Promise<boolean> | boolean} ok @param {number} [ms] */
async function until(ok, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail("timed out waiting");
}
const zetaNames = async () => (await adminModels()).models.filter((/** @type {any} */ m) => m.upstream === "zeta").map((/** @type {any} */ m) => m.id).sort();

// (fails before: 0 calls, 0 models until a Refresh)
test("a provider saved for the first time is asked once, in the background; reads never ask", async () => {
  await save((cfg) => {
    cfg.upstreams.push({ id: "zeta", name: "Zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "good-key", enabled: true });
    cfg.routes.push({ match: "zeta/*", upstream: "zeta", upstreamModel: "{1}", enabled: true });
  });
  await until(async () => (await zetaNames()).length === IDS.length);
  assert.deepEqual(await zetaNames(), IDS.map((id) => `zeta/${id}`).sort());
  assert.equal(listCalls(), 1, "asked once");
  for (let i = 0; i < 5; i++) await adminModels();
  const client = await (await shim.api("/v1/models")).json();
  assert.ok(client.data.some((/** @type {any} */ m) => m.id === "zeta/zeta-5"), "clients see it too");
  assert.equal(listCalls(), 1, "reads, the dashboard's and a client's, never asked");
});

test("a save that changes nothing about it asks nothing; a new key or a new address asks once more", async () => {
  const before = listCalls();
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").name = "Zeta Labs"; });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(listCalls(), before, "a new display name is not a new listing");
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").pricing = { "zeta-5": { input: 1, output: 2 } }; });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(listCalls(), before, "nor is a price");
  slow = true;
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").baseUrl = `${up.url}/v1`; });
  await until(() => listCalls() === before + 1);
  assert.deepEqual(await zetaNames(), [], "a new address forgets the old names while it asks");
  assert.equal((await adminModels()).upstreams.zeta.discovering, true);
  slow = false;
  release?.();
  await until(async () => (await zetaNames()).length === IDS.length);
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").apiKey = "good-key"; });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(listCalls(), before + 1, "the same key typed again is no change");
  // How the key is presented is part of what the list request is sent with.
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").authStyle = "x-api-key"; });
  await until(() => listCalls() === before + 2);
  await until(async () => !(await adminModels()).upstreams.zeta.discovering);
  assert.match(String((await adminModels()).upstreams.zeta.error), /401/, "the fake takes only a Bearer key");
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").authStyle = "bearer"; });
  await until(() => listCalls() === before + 3);
  await until(async () => (await adminModels()).upstreams.zeta.error === undefined);
});

test("while it is being asked the list says so, and a failed ask says why until names are known", async () => {
  slow = true;
  const before = listCalls();
  await save((cfg) => {
    cfg.upstreams.push({ id: "kappa", name: "Kappa", type: "openai-compatible", baseUrl: up.url, apiKey: "wrong-key", enabled: true });
    cfg.routes.push({ match: "kappa/*", upstream: "kappa", upstreamModel: "{1}", enabled: true });
  });
  await until(() => listCalls() === before + 1);
  assert.equal((await adminModels()).upstreams.kappa.discovering, true, "asking");
  slow = false;
  release?.();
  await until(async () => !(await adminModels()).upstreams.kappa.discovering);
  const info = (await adminModels()).upstreams.kappa;
  assert.match(String(info.error), /401/, "the failed ask says why");
  assert.equal(info.count, 0);
  // Refresh still forces (every provider; kappa's calls are told by its key), and a right key saved later is asked again.
  const kappaCalls = () => up.received.filter((/** @type {any} */ c) => c.path.includes("/models") && c.headers.authorization === "Bearer wrong-key").length;
  assert.equal(kappaCalls(), 1);
  await adminModels("?refresh=1");
  assert.equal(kappaCalls(), 2, "Refresh asks");
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "kappa").apiKey = "good-key"; });
  await until(async () => (await adminModels()).upstreams.kappa.count === IDS.length);
  assert.equal((await adminModels()).upstreams.kappa.error, undefined, "no stale error once names are known");
});

test("a new key that is refused keeps the names from before and says why, until a list that works", async () => {
  slow = true;
  await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").apiKey = "stale-key"; });
  await until(async () => (await adminModels()).upstreams.zeta.discovering === true);
  assert.equal((await zetaNames()).length, IDS.length, "a new key keeps the names while it asks");
  slow = false;
  release?.();
  await until(async () => !(await adminModels()).upstreams.zeta.discovering);
  assert.match(String((await adminModels()).upstreams.zeta.error), /401/, "says why");
  assert.equal((await zetaNames()).length, IDS.length, "the names from before stay listed");
  accepted.add("stale-key"); // the provider takes the key after all: a Refresh that works ends the word
  await adminModels("?refresh=1");
  assert.equal((await adminModels()).upstreams.zeta.error, undefined);
});

test("a removed provider's list is forgotten: added back under the same id, it never shows the old names", async () => {
  const before = listCalls();
  await save((cfg) => {
    cfg.upstreams = cfg.upstreams.filter((/** @type {any} */ u) => u.id !== "kappa");
    cfg.routes = cfg.routes.filter((/** @type {any} */ r) => r.upstream !== "kappa");
  });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(listCalls(), before, "removing asks nothing");
  slow = true;
  await save((cfg) => {
    cfg.upstreams.push({ id: "kappa", name: "Kappa again", type: "openai-compatible", baseUrl: `${up.url}/other`, apiKey: "good-key", enabled: true });
    cfg.routes.push({ match: "kappa/*", upstream: "kappa", upstreamModel: "{1}", enabled: true });
  });
  await until(() => listCalls() === before + 1);
  assert.equal((await adminModels()).upstreams.kappa.count, 0, "none of the old provider's names while the new one is asked");
  slow = false;
  release?.();
  await until(async () => !(await adminModels()).upstreams.kappa.discovering);
});

test("saves while it asks make one more ask with the newest settings, never a pile", async () => {
  slow = true;
  const before = listCalls();
  for (const key of ["k1", "k2", "good-key"]) await save((cfg) => { cfg.upstreams.find((/** @type {any} */ u) => u.id === "zeta").apiKey = key; });
  await until(() => listCalls() === before + 1);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(listCalls(), before + 1, "one ask in flight, the others wait");
  release?.();
  await until(() => listCalls() === before + 2);
  assert.equal((await adminModels()).upstreams.zeta.discovering, true, "the second ask says asking, not the first's answer");
  slow = false;
  release?.();
  await until(async () => !(await adminModels()).upstreams.zeta.discovering);
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(listCalls(), before + 2, "one more, not three");
  const last = up.received.filter((/** @type {any} */ c) => c.path.includes("/models")).at(-1);
  assert.equal(last.headers.authorization, "Bearer good-key", "the newest key");
  assert.equal((await adminModels()).upstreams.zeta.error, undefined);
});

test("an agent or local upstream is never asked on save", async () => {
  const before = listCalls();
  await save((cfg) => { cfg.upstreams.push({ id: "loc", name: "Local", type: "acp", baseUrl: "acp://local", enabled: true, acp: {} }); });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(listCalls(), before);
  assert.equal((await adminModels()).upstreams.loc?.discovering, undefined);
  // (fails before: its empty list read "no model names came back … check the connection" though nothing had asked;
  // HarnessV3-CodebasePass decision 6)
  assert.equal((await adminModels()).upstreams.loc?.unasked, true, "it says nothing asked it yet");
  assert.equal((await adminModels()).upstreams.zeta?.unasked, undefined, "an HTTP provider a save asked is not 'unasked'");
});

test("an upstream is 'unasked' while nothing has asked it: an agent CLI until a Refresh, an HTTP provider with no list on this machine; only while enabled and listing", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-unasked-"));
  try {
    writeFileSync(join(dir, "models-cache.json"), JSON.stringify({ http: { "web-listed": { at: 5, names: [] } }, local: { asked: { at: 1, names: [] } } }));
    const ups = [
      { id: "fresh", type: "acp", enabled: true },
      { id: "asked", type: "acp", enabled: true },
      { id: "off", type: "acp", enabled: false },
      { id: "nolist", type: "acp", enabled: true, discoverModels: false },
      { id: "web", type: "anthropic", enabled: true, baseUrl: "http://127.0.0.1:9" },
      { id: "web-listed", type: "anthropic", enabled: true, baseUrl: "http://127.0.0.1:9" },
      { id: "web-off", type: "anthropic", enabled: false, baseUrl: "http://127.0.0.1:9" },
      { id: "web-nolist", type: "anthropic", enabled: true, baseUrl: "http://127.0.0.1:9", discoverModels: false },
    ];
    const cache = createModelCache({ dataDir: dir, config: { get: () => ({ upstreams: ups, routes: [], rules: {} }) }, log: () => {}, destinationFor: () => null });
    assert.deepEqual(cache.discoveryOf("fresh"), { asking: false, unasked: true });
    assert.equal(cache.discoveryOf("asked"), null, "a Refresh answered once (even with no names): asked");
    assert.equal(cache.discoveryOf("off"), null);
    assert.equal(cache.discoveryOf("nolist"), null, "discovery switched off: the names are the operator's");
    // (fails before: yes — L2's tour, tour4: a provider set up outside the console (config.json by hand, or brought
    // from another machine without its models-cache.json) is asked by no save, and read "no model names came back")
    assert.deepEqual(cache.discoveryOf("web"), { asking: false, unasked: true }, "an HTTP provider no save asked on this machine");
    assert.equal(cache.discoveryOf("web-listed"), null, "a list on this machine (even an empty one): asked");
    assert.equal(cache.discoveryOf("web-off"), null);
    assert.equal(cache.discoveryOf("web-nolist"), null, "discovery switched off: the names are the operator's");
    cache.close();
    const page = readFileSync("src/ui/pages/destinations.js", "utf8");
    assert.match(page, /info\.unasked \? `Not asked yet: Filament asks \$\{u\.name \|\| u\.id\} for its models when you press Refresh list/, "the card says so");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// HarnessV3-ACP AF2.
test("an agent's own words for its models are kept with its list, go with it to an account added, survive a restart, and go when its list names none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-words-"));
  try {
    const cfg = { upstreams: [{ id: "cc", type: "acp", enabled: true }], routes: [], rules: {} };
    const words = { opus: { label: "Opus", note: "Opus 5 · Best for everyday, complex tasks" } };
    /** @type {any} */
    let answer = { names: ["opus", "haiku"], labels: words, source: "discovered" };
    const make = () => createModelCache({ dataDir: dir, config: { get: () => cfg }, log: () => {}, destinationFor: () => ({ listModels: async () => answer }) });
    const one = make();
    await one.askAgent("cc");
    assert.deepEqual(one.labelsFor("cc"), words);
    one.adopt("cc", "cc-work");
    assert.deepEqual(one.labelsFor("cc-work"), words, "an account added starts with its agent's words, as with its list");
    one.close();
    const two = make();
    assert.deepEqual(two.labelsFor("cc"), words, "read back from models-cache.json");
    answer = { names: ["opus"], labels: {}, source: "discovered" };
    await two.askAgent("cc");
    assert.equal(two.labelsFor("cc"), null, "a list that names none now has none");
    assert.equal(two.labelsFor("nobody"), null);
    two.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — an agent upstream gone from the configuration kept its list in models-cache.json: one added
// back under its id, an account removed and added again (HarnessV3-ACP AC3-7), showed the old names, never asked)
test("an agent removed from the configuration: its model list goes from models-cache.json with it", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-list-"));
  try {
    writeFileSync(join(dir, "models-cache.json"), JSON.stringify({ local: { kept: { at: 1, names: ["a"] }, gone: { at: 1, names: ["old"] } } }));
    let cfg = { upstreams: [{ id: "kept", type: "acp", enabled: true }, { id: "gone", type: "acp", enabled: true }], routes: [], rules: {} };
    /** @type {((c: any) => void)[]} */
    const hooks = [];
    const cache = createModelCache({ dataDir: dir, config: { get: () => cfg, onChange: (/** @type {any} */ fn) => hooks.push(fn) }, log: () => {}, destinationFor: () => null });
    cfg = { ...cfg, upstreams: [cfg.upstreams[0]] };
    for (const fn of hooks) fn(cfg);
    cache.close();
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "models-cache.json"), "utf8")).local, { kept: { at: 1, names: ["a"] } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// (fails before: yes — a Refresh of every list (the dashboard's, `/api/models?refresh=1`) told no other page what the
// agents answered: an open harness page kept the old lists until its copy grew five minutes old, and its limit card's
// Continue on found no model on the agent's other account)
test("a Refresh asks each agent and tells the open pages what it answered, as Connect does; a read asks none", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-agent-list-"));
  try {
    const cfg = { upstreams: [{ id: "ok", type: "acp", enabled: true }, { id: "broken", type: "acp", enabled: true }, { id: "off", type: "acp", enabled: false }], routes: [], rules: {} };
    /** @type {Record<string, () => Promise<any>>} */
    const lists = { ok: async () => ({ names: ["a", "b"] }), broken: async () => ({ error: "it did not start" }), off: async () => ({ names: ["x"] }) };
    /** @type {any[]} */
    const said = [];
    const cache = createModelCache({
      dataDir: dir,
      config: { get: () => cfg },
      log: () => {},
      destinationFor: (/** @type {any} */ u) => ({ listModels: lists[u.id] }),
      onDiscovered: (/** @type {any} */ m) => said.push(m),
    });
    await cache.cfgForModels(false);
    assert.deepEqual(said, [], "a read asks no agent and says nothing");
    await cache.cfgForModels(true);
    cache.close();
    assert.deepEqual(said, [{ upstream: "ok", ok: true, count: 2 }, { upstream: "broken", ok: false, error: "it did not start" }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the bus tells open pages when a save's discovery answered", async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${shim.url}/api/events`, { headers: shim.headers, signal: ctrl.signal });
  const reader = /** @type {ReadableStreamDefaultReader<Uint8Array>} */ (res.body?.getReader());
  let seen = "";
  const got = (async () => {
    const dec = new TextDecoder();
    while (!/models-discovered/.test(seen)) {
      const { value, done } = await reader.read();
      if (done) break;
      seen += dec.decode(value);
    }
  })();
  await save((cfg) => {
    cfg.upstreams.push({ id: "iota", name: "Iota", type: "openai-compatible", baseUrl: up.url, apiKey: "good-key", enabled: true });
  });
  await Promise.race([got, new Promise((r) => setTimeout(r, 3000))]);
  ctrl.abort();
  const line = seen.split("\n").find((l) => l.includes("models-discovered")) || "";
  const msg = JSON.parse(line.replace(/^data: /, ""));
  assert.deepEqual(msg, { type: "models-discovered", upstream: "iota", ok: true, count: IDS.length });
});

// (fails before: the test answered a count only, and counted only `data` listings)
test("the connection test answers the names, whichever listing shape the provider uses", async () => {
  const r = await testProvider({ id: "zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "good-key" });
  assert.equal(r.ok, true);
  assert.equal(r.models, IDS.length);
  assert.deepEqual(r.names, IDS);
  const other = await fakeUpstream(async (call) => (call.path.includes("/models") ? { json: { models: [{ name: "gemma-3" }, { name: "llama-4" }] } } : undefined));
  try {
    const g = await testProvider({ id: "g", type: "openai-compatible", baseUrl: other.url, apiKey: "k" });
    assert.equal(g.models, 2);
    assert.deepEqual(g.names, ["gemma-3", "llama-4"]);
  } finally {
    await other.close();
  }
});

// (fails before: yes — an upstream with no key was answered "no API key set" without being asked, so a working Ollama
// or LM Studio showed a red dot on Settings › Providers)
test("the connection test asks an upstream with no key without one, and one that refuses is said to want a key", async () => {
  const open = await fakeUpstream(async (call) => (call.path.includes("/models") ? { json: { data: [{ id: "qwen3:8b" }] } } : undefined));
  try {
    const r = await testProvider({ id: "local", type: "openai-compatible", baseUrl: open.url, apiKey: "" });
    assert.equal(r.ok, true);
    assert.deepEqual(r.names, ["qwen3:8b"]);
    assert.equal(open.received.at(-1)?.headers.authorization, undefined, "no key was made up");
  } finally {
    await open.close();
  }
  const shut = await testProvider({ id: "zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "" });
  assert.equal(shut.ok, false);
  assert.equal(shut.status, 401);
  assert.equal(shut.error, "it asks for a key, and none is set");
  const wrong = await testProvider({ id: "zeta", type: "openai-compatible", baseUrl: up.url, apiKey: "bad-key" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.error, undefined, "a wrong key is the provider's own refusal");
});

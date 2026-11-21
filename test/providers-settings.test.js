// @ts-check
// Settings › Providers' server half (HarnessV4_Settings_Plan HS-2, HS-D3, HS-D15): the configuration's version and the
// stale save it refuses, and the narrow writes — add a provider, change one, see what goes with one, remove one —
// over a real Filament and a fake provider. No key ever comes back in an answer, and every one is sealed on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { seal } from "../src/services/config/secrets.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";
import { createConfigStore, redactConfig } from "../src/services/config/store.js";
import { testUpstream } from "../src/app/upstream-test.js";
import { defaultConfig } from "../src/config.js";
import { createProviders } from "../src/app/providers.js";

const KEY = "sk-test-0123456789abcdef";

/** A fake OpenAI-shaped provider that lists two models. */
const provider = () => fakeUpstream((call) => (call.kind === "models" ? { json: { data: [{ id: "glm-5.3" }, { id: "glm-4.6" }] } } : undefined));

/** @param {Awaited<ReturnType<typeof startApp>>} shim @param {string} path @param {any} [body] @param {string} [method] */
const call = async (shim, path, body, method) => {
  const r = await shim.api(path, { method: method || (body === undefined ? "GET" : "POST"), body });
  return { status: r.status, body: await r.json() };
};

test("the configuration's version moves on every save and reload, keeps what each held, and tells who listens (fails before: yes — no version)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-cfgver-"));
  try {
    writeFileSync(join(dir, "config.json"), JSON.stringify(defaultConfig()));
    const store = createConfigStore({ dataDir: dir });
    /** @type {number[]} */
    const told = [];
    store.onSaved((v) => told.push(v));
    const v1 = store.version();
    const before = structuredClone(store.get());
    // A change written in place, as a sign-in's tokens are, moves it at its save.
    store.get().server.logLevel = "debug";
    store.save();
    assert.equal(store.version(), v1 + 1);
    assert.deepEqual(store.at(v1).server, before.server, "the old version is kept as it was");
    assert.equal(store.at(v1 + 1).server.logLevel, "debug");
    store.reload();
    assert.equal(store.version(), v1 + 2);
    assert.deepEqual(told, [v1 + 1, v1 + 2]);
    for (let i = 0; i < 60; i++) store.save();
    assert.equal(store.at(v1), null, "a version fifty saves old is no longer kept");
  } finally {
    await removeDirs(dir);
  }
});

test("a stale PUT /api/config is refused with what changed; a current one, or one naming no version, is taken (fails before: yes — the old draft undid the newer change)", async () => {
  const up = await provider();
  const shim = await startApp();
  try {
    const state = (await call(shim, "/api/state")).body;
    const base = state.configVersion;
    assert.ok(Number.isInteger(base));
    // The harness adds a provider: the dashboard's draft is now one version behind.
    const added = await call(shim, "/api/upstreams", { provider: "", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: KEY, prefix: "glm" });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    const stale = await call(shim, `/api/config?base=${base}`, state.config, "PUT");
    assert.equal(stale.status, 409);
    assert.equal(stale.body.stale, true);
    assert.equal(stale.body.version, added.body.version);
    assert.ok(stale.body.changes.some((/** @type {string} */ l) => l.startsWith("upstreams.glm")), stale.body.changes.join("\n"));
    assert.match(stale.body.error, /changed since this page read it/);
    assert.ok(!JSON.stringify(stale.body).includes(KEY), "no key in the refusal");
    // The provider is still there.
    assert.ok((await call(shim, "/api/state")).body.config.upstreams.some((/** @type {any} */ u) => u.id === "glm"));
    // Keep mine: the same draft sent at the newest version overwrites, and says the version it made.
    const mine = await call(shim, `/api/config?base=${stale.body.version}`, state.config, "PUT");
    assert.equal(mine.status, 200);
    assert.equal(mine.body.version, stale.body.version + 1);
    // A save naming no version (a script) is taken as before.
    const plain = await call(shim, "/api/config", mine.body.config, "PUT");
    assert.equal(plain.status, 200);
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30, SEC-8: Keep mine's Save took the draft's keys against the configuration as
// it stood, so a key made by a rotate in another window was dropped, and a key pasted there put back empty)
test("Keep mine after a rotate and a key pasted in another window keeps both, and the edits: the Save names the version its draft was read at", async () => {
  const shim = await startApp({ key: "sk-filament-first-key-0001", configure: (c) => {
    c.upstreams.push({ id: "p", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true });
  } });
  try {
    const st = (await call(shim, "/api/state")).body;
    const read = st.configVersion;
    // Another window: a new key, and a key pasted for p.
    const { key } = (await call(shim, "/api/keys/rotate", {})).body;
    assert.equal((await call(shim, "/api/upstreams/p", { apiKey: KEY }, "PATCH")).status, 200);
    // This page's draft, read before both: an edit of its own.
    const draft = structuredClone(st.config);
    draft.server.logLevel = "debug";
    const stale = await call(shim, `/api/config?base=${read}&read=${read}`, draft, "PUT");
    assert.equal(stale.status, 409);
    // Keep mine: the Save overwrites the newest version, and names the one its draft was read at.
    const mine = await call(shim, `/api/config?base=${stale.body.version}&read=${read}`, draft, "PUT");
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.deepEqual((await call(shim, "/api/keys")).body.keys, [key, "sk-filament-first-key-0001"], "the rotated key stays");
    const now = (await call(shim, "/api/state")).body.config;
    assert.equal(now.upstreams.find((/** @type {any} */ u) => u.id === "p").apiKeyMasked, "sk-t…cdef", "the pasted key stays");
    assert.equal(now.server.logLevel, "debug", "and the edit is saved");
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the bug hunt of 10-30: a rotate whose save failed left the new key in use and the oldest gone, said
// as a bare 500 the console's button never caught)
test("a rotate whose save fails says why, and the keys are as they were: in use, on disk, and at their version", async () => {
  const shim = await startApp({ key: "sk-filament-first-key-0001" });
  try {
    const version = (await call(shim, "/api/state")).body.configVersion;
    mkdirSync(join(shim.dataDir, "config.json.tmp"));
    const r = await call(shim, "/api/keys/rotate", {});
    assert.equal(r.status, 500);
    assert.match(r.body.error, /^the configuration could not be saved \(.*\), so the keys are as they were$/);
    assert.deepEqual((await call(shim, "/api/keys")).body.keys, ["sk-filament-first-key-0001"]);
    assert.equal((await call(shim, "/api/state")).body.configVersion, version);
  } finally {
    rmSync(join(shim.dataDir, "config.json.tmp"), { recursive: true, force: true });
    await shim.stop();
  }
});

// (fails before: yes — the bug hunt of 10-30: a header renamed with its kept value, on Settings › Providers or in the
// console's raw JSON, was saved without it)
test("a header renamed with its kept value is refused in words, here and in a whole Save, and the stored one stays", async () => {
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", headers: { Authorization: "Bearer hdr-secret-123456" }, enabled: true });
  } });
  const stored = () => JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8")).upstreams.find((/** @type {any} */ u) => u.id === "p").headers;
  try {
    const r = await call(shim, "/api/upstreams/p", { headers: { "X-Api-Key": "__SECRET__" } }, "PATCH");
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "X-Api-Key holds no kept value: a kept value stays under the name it was saved with. Type the header's value again, or put back the name it had.");
    const st = (await call(shim, "/api/state")).body;
    st.config.upstreams.find((/** @type {any} */ u) => u.id === "p").headers = { "X-Api-Key": "__SECRET__" };
    const whole = await call(shim, `/api/config?base=${st.configVersion}`, st.config, "PUT");
    assert.equal(whole.status, 400);
    assert.match(whole.body.error, /^Not saved: nothing is kept for upstreams\.p\.headers\.X-Api-Key, .*type the value again, or put back the name it had\.$/);
    const h = stored();
    assert.match(h.Authorization, /^enc:v1:/, "still there, sealed");
    assert.equal(h["X-Api-Key"], undefined);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the bug hunt of 10-30: Settings › Providers drew a key this secret.key cannot open as no key at
// all, its header as an empty plain one, and taking the key away with null kept it)
test("Settings › Providers says a key this secret.key cannot read is stored and unreadable, keeps such a header through Save headers, and null forgets the key", async () => {
  const other = randomBytes(32);
  const sealedKey = seal("sk-sealed-elsewhere-0000", other);
  const sealedHeader = seal("Bearer sealed-elsewhere", other);
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", apiKey: sealedKey, headers: { Authorization: sealedHeader, "X-Plain": "a" }, enabled: true });
  } });
  const stored = () => JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8")).upstreams.find((/** @type {any} */ u) => u.id === "p");
  const listed = async () => (await call(shim, "/api/upstreams")).body.upstreams.find((/** @type {any} */ u) => u.id === "p");
  try {
    const p = await listed();
    assert.deepEqual(p.key, { stored: true, masked: "", unreadable: true });
    assert.deepEqual(p.headers, { Authorization: "__SECRET__", "X-Plain": "a" }, "kept, as the page's headers box keeps a stored one");
    const h = await call(shim, "/api/upstreams/p", { headers: { Authorization: "__SECRET__", "X-Plain": "b" } }, "PATCH");
    assert.equal(h.status, 200, JSON.stringify(h.body));
    assert.deepEqual([stored().headers.Authorization, stored().headers["X-Plain"]], [sealedHeader, "b"], "the sealed one as it was");
    const r = await call(shim, "/api/upstreams/p", { apiKey: null }, "PATCH");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.upstream.key, { stored: false, masked: "" });
    assert.equal(stored().apiKey, undefined, "forgotten: gone from the file");
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the bug hunt of 10-30: the console's Test of an upstream renamed on its card, not yet saved,
// looked for its key under the new id and ran with none)
test("Test after an unsaved rename on the card runs with the key kept under the id it was read with", async () => {
  const up = await provider();
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "zz", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: KEY, enabled: true });
  } });
  try {
    const page = (await call(shim, "/api/state")).body.config.upstreams.find((/** @type {any} */ u) => u.id === "zz");
    up.reset();
    const r = await call(shim, "/api/upstreams/test", { upstream: { ...page, id: "zz2", renamedFrom: "zz" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(up.received.some((c) => c.headers.authorization === `Bearer ${KEY}` || c.headers["x-api-key"] === KEY), JSON.stringify(up.received.map((c) => [c.path, c.headers.authorization || c.headers["x-api-key"] || null])));
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30: a Test asked for the models with the key alone, never the provider's own
// extra headers, so one that asks for a stored header of its own failed its Test, from the console and the harness)
test("a provider's Test sends its own extra headers, a stored one as stored: from the console's form copy and from Settings › Providers", async () => {
  const up = await provider();
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "hz", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: KEY, headers: { "X-Gateway-Token": "gw-secret-1", "X-Org": "acme" }, enabled: true });
  } });
  const sent = () => up.received.filter((c) => c.kind === "models").map((c) => [c.headers["x-gateway-token"], c.headers["x-org"], c.headers.authorization]);
  try {
    const page = (await call(shim, "/api/state")).body.config.upstreams.find((/** @type {any} */ u) => u.id === "hz");
    assert.equal(page.headers["X-Gateway-Token"], "__SECRET__");
    up.reset();
    assert.equal((await call(shim, "/api/upstreams/test", { upstream: page })).status, 200);
    assert.deepEqual(sent(), [["gw-secret-1", "acme", `Bearer ${KEY}`]], "the console's Test");
    up.reset();
    assert.equal((await call(shim, "/api/upstreams/hz/test")).status, 200);
    assert.deepEqual(sent(), [["gw-secret-1", "acme", `Bearer ${KEY}`]], "Settings › Providers' Test");
  } finally {
    await shim.stop();
    await up.close();
  }
});

// (fails before: yes — the bug hunt of 10-30: the console's Test of a coding agent launched it with its stored
// environment credential as the text "__SECRET__")
test("Test puts each stored secret of a form copy back from the upstream it was read as — a coding agent's environment and its MCP servers', a sign-in's tokens — and one kept nowhere goes as nothing", async () => {
  const saved = [
    { id: "cur", type: "acp", acp: { command: "agent", env: { CURSOR_API_KEY: "ck-1", LOG_LEVEL: "info" }, mcpServers: [{ name: "gh", command: "npx", env: { GITHUB_TOKEN: "ghp-1" } }] } },
    { id: "qd", type: "qoder", apiKey: "", qoder: { authMethod: "device", accessToken: "at-1", refreshToken: "rt-1", userId: "u1" } },
    { id: "gw", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", headers: { Authorization: "Bearer gw-h" } },
  ];
  const config = { get: () => ({ upstreams: saved }) };
  /** @type {any[]} */
  const got = [];
  const destinationFor = (/** @type {any} */ u) => ({ test: async () => (got.push(u), { ok: true }) });
  const forms = redactConfig({ upstreams: saved }).upstreams;
  forms[2].headers = { "X-Api-Key": "__SECRET__" };
  for (const form of forms) await testUpstream(form, config, destinationFor);
  assert.deepEqual(got[0].acp.env, { CURSOR_API_KEY: "ck-1", LOG_LEVEL: "info" });
  assert.deepEqual(got[0].acp.mcpServers[0].env, { GITHUB_TOKEN: "ghp-1" });
  assert.deepEqual([got[1].qoder.accessToken, got[1].qoder.refreshToken], ["at-1", "rt-1"]);
  assert.deepEqual(got[2].headers, { "X-Api-Key": "" }, "never the placeholder's text");
});

test("POST /api/upstreams adds a provider, its prefix route at the top, its hidden list and the catalogue's hints; the key is sealed and never answered (HC-29, fails before: yes — no route)", async () => {
  const up = await provider();
  const shim = await startApp();
  try {
    const r = await call(shim, "/api/upstreams", { provider: "xai", baseUrl: `${up.url}/v1`, apiKey: KEY, prefix: "grok", hiddenModels: ["glm-4.6"] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const v = r.body.upstream;
    assert.equal(v.id, "grok");
    assert.equal(v.name, "xAI (Grok)");
    assert.equal(v.prefix, "grok");
    assert.deepEqual(v.key, { stored: true, masked: "sk-t…cdef" });
    assert.deepEqual(v.hiddenModels, ["glm-4.6"]);
    assert.ok(!JSON.stringify(r.body).includes(KEY), "the key never comes back");
    const cfg = (await call(shim, "/api/state")).body.config;
    assert.equal(cfg.routes[0].match, "grok/*");
    assert.equal(cfg.routes[0].upstreamModel, "{1}");
    const saved = cfg.upstreams.find((/** @type {any} */ u) => u.id === "grok");
    assert.deepEqual(saved.pricing["grok-"], { fastParams: { service_tier: "priority" } }, "the catalogue's hints are its first rows");
    const disk = JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8"));
    const sealed = disk.upstreams.find((/** @type {any} */ u) => u.id === "grok").apiKey;
    assert.match(sealed, /^enc:v1:/, "sealed on disk");
  } finally {
    await shim.stop();
    await up.close();
  }
});

test("a taken prefix is refused in words with a free one; an address that is not http(s) is refused; a coding agent's kind is not a provider's (HC-33, HC-32, fails before: yes)", async () => {
  const up = await provider();
  const shim = await startApp();
  try {
    assert.equal((await call(shim, "/api/upstreams", { type: "openai-compatible", baseUrl: `${up.url}/v1`, prefix: "local" })).status, 200);
    const taken = await call(shim, "/api/upstreams", { type: "openai-compatible", baseUrl: `${up.url}/v1`, prefix: "local" });
    assert.equal(taken.status, 409);
    assert.match(taken.body.error, /local is already the id of local/);
    assert.equal(taken.body.free, "local-2");
    const noUrl = await call(shim, "/api/upstreams", { type: "openai-compatible", baseUrl: "ftp://x", prefix: "x" });
    assert.equal(noUrl.status, 400);
    assert.match(noUrl.body.error, /http:\/\/ or https:\/\//);
    // A plan's field that could move the request elsewhere (a dot) is no field (HC-31).
    const field = await call(shim, "/api/upstreams", { provider: "dashscope", plan: "singapore", fields: { workspace: "a.b" }, prefix: "ds" });
    assert.equal(field.status, 400);
    assert.equal(field.body.error, "Type the Workspace ID: it is part of the address");
    const agent = await call(shim, "/api/upstreams", { type: "acp", baseUrl: `${up.url}`, prefix: "ag" });
    assert.equal(agent.status, 400);
    assert.match(agent.body.error, /Coding agents/);
  } finally {
    await shim.stop();
    await up.close();
  }
});

test("PATCH /api/upstreams/:id changes one provider: an empty key keeps it, a new one replaces it, null takes it away; a masked header is kept; rule overrides stay (HC-34, HC-35, HC-45, HC-50, fails before: yes)", async () => {
  const up = await provider();
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", name: "P", type: "openai-compatible", baseUrl: `http://127.0.0.1:9/v1`, apiKey: KEY, headers: { Authorization: "Bearer hdr-secret-123456", "X-Plain": "a" }, rules: { effort: { default: "high" } }, enabled: true });
    c.routes.unshift({ match: "p/*", upstream: "p", upstreamModel: "{1}", format: "auto", fallbacks: [], enabled: true, rules: {} });
  } });
  try {
    const list = (await call(shim, "/api/upstreams")).body;
    const p = list.upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.equal(p.headers.Authorization, "__SECRET__", "a credential header is masked");
    assert.equal(p.headers["X-Plain"], "a");
    assert.equal(p.ruleOverrides, 1);
    const patch = (/** @type {any} */ b) => call(shim, "/api/upstreams/p", b, "PATCH");
    let r = await patch({ apiKey: "", enabled: false, headers: { Authorization: "__SECRET__", "X-Plain": "b" } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.upstream.enabled, false);
    assert.equal(r.body.upstream.key.stored, true);
    let disk = (await call(shim, "/api/state")).body.config.upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.equal(disk.apiKeyMasked, "sk-t…cdef", "the empty key kept the old one");
    assert.deepEqual(disk.rules, { effort: { default: "high" } }, "rule overrides are kept on every save");
    r = await patch({ apiKey: "sk-new-key-99999999" });
    assert.equal(r.body.upstream.key.masked, "sk-n…9999");
    r = await patch({ apiKey: null });
    assert.equal(r.body.upstream.key.stored, false);
    // The header kept under its name: a test of it reaches the provider with the stored value.
    const raw = JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8")).upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.match(raw.headers.Authorization, /^enc:v1:/, "still there, sealed");
    assert.equal(raw.headers["X-Plain"], "b");
    // Advanced, in plain words: a wrong value is refused by name.
    r = await patch({ authStyle: "cookie" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /authStyle is one of/);
    r = await patch({ models: ["a,b"] });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /no comma/);
    // A model's row, as Tune saves it, and taken away.
    r = await patch({ pricingRow: { key: "glm-5.3", row: { input: 0.6, output: 2.2 } } });
    assert.equal(r.status, 200);
    disk = (await call(shim, "/api/state")).body.config.upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.deepEqual(disk.pricing["glm-5.3"], { input: 0.6, output: 2.2 });
    r = await patch({ pricingRow: { key: "glm-5.3", row: null } });
    disk = (await call(shim, "/api/state")).body.config.upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.equal(disk.pricing?.["glm-5.3"], undefined);
    r = await patch({ pricingRow: { key: "glm-5.3", row: { input: -1 } } });
    assert.equal(r.status, 400, "a row a save would refuse is refused");
  } finally {
    await shim.stop();
    await up.close();
  }
});

test("the prefix moves the provider's prefix route; a taken one is refused with a free one (fails before: yes)", async () => {
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true }, { id: "q", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true });
    c.routes.unshift({ match: "p/*", upstream: "p", upstreamModel: "{1}", format: "auto", fallbacks: [], enabled: true, rules: {} });
  } });
  try {
    let r = await call(shim, "/api/upstreams/p", { prefix: "pp" }, "PATCH");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.upstream.prefix, "pp");
    const cfg = (await call(shim, "/api/state")).body.config;
    assert.ok(cfg.routes.some((/** @type {any} */ x) => x.match === "pp/*" && x.upstream === "p"));
    assert.ok(!cfg.routes.some((/** @type {any} */ x) => x.match === "p/*"));
    r = await call(shim, "/api/upstreams/p", { prefix: "q" }, "PATCH");
    assert.equal(r.status, 409);
    assert.match(r.body.error, /q is already the id/);
    // One with no prefix route gains one.
    r = await call(shim, "/api/upstreams/q", { prefix: "qq" }, "PATCH");
    assert.equal(r.body.upstream.prefix, "qq");
  } finally {
    await shim.stop();
  }
});

test("a change from an older read is refused only when that provider changed since, with what changed (HC-43, fails before: yes)", async () => {
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true }, { id: "q", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true });
  } });
  try {
    const base = (await call(shim, "/api/upstreams")).body.version;
    // Something else changes: q's name. p's sheet, read before, still saves.
    assert.equal((await call(shim, "/api/upstreams/q", { name: "Q" }, "PATCH")).status, 200);
    const ok = await call(shim, "/api/upstreams/p", { name: "P1", base }, "PATCH");
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // p itself changed since: refused, said.
    const stale = await call(shim, "/api/upstreams/p", { name: "P2", base }, "PATCH");
    assert.equal(stale.status, 409);
    assert.match(stale.body.error, /changed since this page read it/);
    assert.ok(stale.body.changes.some((/** @type {string} */ l) => /upstreams\.p\.name/.test(l)), stale.body.changes.join("\n"));
  } finally {
    await shim.stop();
  }
});

test("removing a provider says what goes, refuses while a route of yours names it, and with also takes those routes or their backup row (HC-36, HS-D15, fails before: yes)", async () => {
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", name: "P", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true }, { id: "q", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", enabled: true });
    c.routes.unshift(
      { match: "p/*", upstream: "p", upstreamModel: "{1}", format: "auto", fallbacks: [], enabled: true, rules: {} },
      { match: "fast", upstream: "q", upstreamModel: "m", format: "auto", fallbacks: [{ upstream: "p", upstreamModel: "m" }], enabled: true, rules: {} },
    );
  } });
  try {
    const pre = (await call(shim, "/api/upstreams/p/removal")).body;
    assert.equal(pre.prefix, "p");
    assert.deepEqual(pre.routes, [{ match: "fast", as: "backup", enabled: true }]);
    assert.deepEqual(pre.last30, { requests: 0, cost: null });
    const no = await call(shim, "/api/upstreams/p", undefined, "DELETE");
    assert.equal(no.status, 409);
    assert.match(no.body.error, /A route of yours names P: fast/);
    assert.ok((await call(shim, "/api/state")).body.config.upstreams.some((/** @type {any} */ u) => u.id === "p"), "nothing went");
    const yes = await call(shim, "/api/upstreams/p?also=1", undefined, "DELETE");
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    const cfg = (await call(shim, "/api/state")).body.config;
    assert.ok(!cfg.upstreams.some((/** @type {any} */ u) => u.id === "p"));
    assert.ok(!cfg.routes.some((/** @type {any} */ r) => r.match === "p/*"), "its prefix route went");
    assert.deepEqual(cfg.routes.find((/** @type {any} */ r) => r.match === "fast").fallbacks, [], "the route kept, its backup row gone");
  } finally {
    await shim.stop();
  }
});

test("a coding agent's entry takes its model lists here and nothing else; its removal is Coding agents' (HC-49, HS-D12, fails before: yes)", async () => {
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "ag", type: "acp", baseUrl: "acp://local", enabled: true, acp: { command: "x", args: [] } });
  } });
  try {
    const r = await call(shim, "/api/upstreams/ag", { hiddenModels: ["a"], models: ["b"] }, "PATCH");
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual([r.body.upstream.hiddenModels, r.body.upstream.models], [["a"], ["b"]]);
    const no = await call(shim, "/api/upstreams/ag", { apiKey: "x" }, "PATCH");
    assert.equal(no.status, 400);
    assert.match(no.body.error, /coding agent: its apiKey is set under Settings › Coding agents/);
    assert.equal((await call(shim, "/api/upstreams/ag", undefined, "DELETE")).status, 400);
  } finally {
    await shim.stop();
  }
});

test("a test's answer is kept for the list's dot, its words and when (HC-30, fails before: yes)", async () => {
  const up = await fakeUpstream((call) => (call.kind === "models" ? { status: 401, json: { error: { message: "bad key" } } } : undefined));
  const shim = await startApp({ configure: (c) => {
    c.upstreams.push({ id: "p", type: "openai-compatible", baseUrl: `${up.url}/v1`, apiKey: "wrong", enabled: true });
  } });
  try {
    const before = (await call(shim, "/api/upstreams")).body.upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.equal(before.test, null, "not tested since Filament started");
    await call(shim, "/api/upstreams/p/test");
    const after = (await call(shim, "/api/upstreams")).body.upstreams.find((/** @type {any} */ u) => u.id === "p");
    assert.equal(after.test.ok, false);
    assert.equal(after.test.status, 401);
    assert.ok(after.test.at > 0);
    assert.ok(!JSON.stringify(after).includes("wrong"), "the key is not in the list");
  } finally {
    await shim.stop();
    await up.close();
  }
});

test("createProviders counts today's spend per provider from the day store (fails before: yes)", () => {
  const cfg = { ...defaultConfig(), upstreams: [{ id: "p", type: "openai-compatible", baseUrl: "http://x/v1" }], routes: [] };
  const config = /** @type {any} */ ({ get: () => cfg, version: () => 3, at: () => null, set() {}, save() {}, unreadable: () => [] });
  const usage = { dailyStore: { aggregate: () => ({ rows: [{ upstream: "p", model: "a", requests: 2, cost: 0.5, costN: 2 }, { upstream: "p", model: "b", requests: 1, cost: 0.25, costN: 1 }] }) } };
  const list = createProviders({ config, usage }).list();
  assert.equal(list.version, 3);
  assert.deepEqual(list.upstreams[0].today, { requests: 3, cost: 0.75, costN: 3 });
});

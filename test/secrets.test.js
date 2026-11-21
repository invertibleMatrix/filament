import { test } from "node:test";
import assert from "node:assert/strict";
import fs, { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, statSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { loadKey, seal, open, sealConfig, openConfig, isSealed } from "../src/secrets.js";
import { defaultConfig, saveConfig, loadConfig, redactConfig, mergeSecrets, normalizeConfig } from "../src/config.js";
import { TEMPLATES, getTemplate, applyTemplate } from "../src/services/config/templates.js";
import { startApp } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

test("seal/open round-trip, idempotent sealing, wrong key detected", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sec-")); const k = loadKey(dir); assert.equal(k.length, 32); assert.ok(existsSync(join(dir, "secret.key")));
  const s = seal("sk-abc", k); assert.ok(isSealed(s)); assert.equal(open(s, k), "sk-abc"); assert.equal(seal(s, k), s, "already sealed stays sealed"); assert.equal(seal("", k), "");
  const otherDir = mkdtempSync(join(tmpdir(), "filament-sec2-"));
  const other = loadKey(otherDir); assert.throws(() => open(s, other));
  const cfg = { server: { adminToken: "adm", inboundKeys: ["k1", "k2"] }, upstreams: [{ id: "a", apiKey: "sk-1" }, { id: "q", apiKey: "", qoder: { accessToken: "dt-1", refreshToken: "" } }] };
  const sealed = sealConfig(cfg, k);
  assert.ok(isSealed(sealed.upstreams[0].apiKey) && isSealed(sealed.upstreams[1].qoder.accessToken) && isSealed(sealed.server.adminToken) && sealed.server.inboundKeys.every(isSealed));
  assert.equal(sealed.upstreams[1].apiKey, ""); assert.equal(sealed.upstreams[1].qoder.refreshToken, "");
  const { config, problems } = openConfig(sealed, k); assert.deepEqual(problems, []); assert.equal(config.upstreams[0].apiKey, "sk-1"); assert.deepEqual(config.server.inboundKeys, ["k1", "k2"]); assert.equal(config.upstreams[1].qoder.accessToken, "dt-1");
  const bad = openConfig(sealed, other); assert.ok(bad.problems.length >= 3); assert.equal(bad.config.upstreams[0].apiKey, "");
  rmSync(dir, { recursive: true, force: true });
  rmSync(otherDir, { recursive: true, force: true });
});

test("saveConfig writes sealed secrets, loadConfig reads them back; a key typed into the file by hand is sealed on load", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sec3-"));
  const cfg = defaultConfig(); cfg.upstreams = [{ id: "a", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-secret-value" }];
  saveConfig(dir, cfg);
  const onDisk = readFileSync(join(dir, "config.json"), "utf8");
  assert.ok(!onDisk.includes("sk-secret-value") && onDisk.includes("enc:v1:"), "secret not in plain text on disk");
  assert.ok(!onDisk.includes(cfg.server.inboundKeys[0]));
  const loaded = loadConfig(dir); assert.equal(loaded.config.upstreams[0].apiKey, "sk-secret-value"); assert.deepEqual(loaded.config.server.inboundKeys, cfg.server.inboundKeys);
  // a key typed into config.json in plain text is sealed when the file is loaded
  const dir2 = mkdtempSync(join(tmpdir(), "filament-sec4-")); const plain = defaultConfig(); plain.upstreams = [{ id: "a", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-plain" }]; writeFileSync(join(dir2, "config.json"), JSON.stringify(plain));
  const l2 = loadConfig(dir2); assert.equal(l2.config.upstreams[0].apiKey, "sk-plain"); assert.ok(readFileSync(join(dir2, "config.json"), "utf8").includes("enc:v1:"));
  // encryption can be turned off
  const dir3 = mkdtempSync(join(tmpdir(), "filament-sec5-")); const off = defaultConfig(); off.server.encryptSecrets = false; off.upstreams = [{ id: "a", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-visible" }]; saveConfig(dir3, off);
  assert.ok(readFileSync(join(dir3, "config.json"), "utf8").includes("sk-visible")); assert.ok(!existsSync(join(dir3, "secret.key")));
  for (const d of [dir, dir2, dir3]) rmSync(d, { recursive: true, force: true });
});

// (fails before: yes — the bug hunt of 10-30, SEC-2: a coding agent's MCP server's GITHUB_TOKEN stayed plain text in
// config.json, in GET /api/state and in the console assistant's prompt)
test("a coding agent's MCP servers' env credentials are secrets: sealed on disk, masked for the page and the assistant, a placeholder written back keeps them", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sec7-"));
  const cfg = defaultConfig();
  cfg.upstreams = [{ id: "cur", type: "acp", acp: { command: "cursor-agent", mcpServers: [{ name: "github", command: "npx", args: ["gh-mcp"], env: { GITHUB_TOKEN: "ghp-secret-1", LOG_LEVEL: "info" } }, { command: "uvx", env: { API_KEY: "ak-2" } }] } }];
  saveConfig(dir, cfg);
  const onDisk = readFileSync(join(dir, "config.json"), "utf8");
  assert.ok(!onDisk.includes("ghp-secret-1") && !onDisk.includes("ak-2"), "sealed on disk");
  assert.ok(onDisk.includes('"LOG_LEVEL": "info"'), "a value that names no credential stays as written");
  const loaded = loadConfig(dir).config;
  assert.deepEqual(loaded.upstreams[0].acp.mcpServers.map((/** @type {any} */ m) => m.env), [{ GITHUB_TOKEN: "ghp-secret-1", LOG_LEVEL: "info" }, { API_KEY: "ak-2" }]);
  const shown = redactConfig(loaded);
  assert.deepEqual(shown.upstreams[0].acp.mcpServers.map((/** @type {any} */ m) => m.env), [{ GITHUB_TOKEN: "__SECRET__", LOG_LEVEL: "info" }, { API_KEY: "__SECRET__" }]);
  const back = mergeSecrets(shown, loaded);
  assert.deepEqual(back.upstreams[0].acp.mcpServers.map((/** @type {any} */ m) => m.env), [{ GITHUB_TOKEN: "ghp-secret-1", LOG_LEVEL: "info" }, { API_KEY: "ak-2" }]);
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the bug hunt of 10-30, SEC-1: config.json brought back without its secret.key — Filament made a
// key, opened every sealed value as "", minted an inbound key and saved, and every stored secret was gone for good)
test("a secret.key missing or another's costs no secret: what it cannot open stays sealed on disk until one is entered in its place, and opens again with its own key", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sec6-"));
  const cfg = defaultConfig();
  cfg.server.adminToken = "adm";
  cfg.upstreams = [
    { id: "a", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-a", headers: { "x-api-key": "hk-a" } },
    { id: "q", type: "qoder", apiKey: "", qoder: { accessToken: "qt", refreshToken: "qr" } },
  ];
  const inbound = cfg.server.inboundKeys[0];
  saveConfig(dir, cfg);
  const keyFile = join(dir, "secret.key");
  const ownKey = readFileSync(keyFile, "utf8");
  // Brought back without its key: Filament starts, says what it cannot read, and makes a key and an inbound key of its own.
  rmSync(keyFile);
  const lost = loadConfig(dir);
  assert.deepEqual([lost.config.upstreams[0].apiKey, lost.config.upstreams[1].qoder.accessToken, lost.config.server.adminToken], ["", "", ""]);
  assert.equal(lost.secretProblems.length, 6, lost.secretProblems.join("\n"));
  assert.equal(lost.config.server.inboundKeys.length, 1);
  assert.notEqual(lost.config.server.inboundKeys[0], inbound);
  // A change saved meanwhile: one header entered anew, the rest left as they stood.
  lost.config.upstreams[0].headers["x-api-key"] = "hk-new";
  saveConfig(dir, lost.config);
  assert.equal(loadConfig(dir).config.upstreams[0].headers["x-api-key"], "hk-new");
  // Its own key back: every secret it held opens again; the one entered meanwhile under the other key is said.
  writeFileSync(keyFile, ownKey);
  const back = loadConfig(dir);
  assert.deepEqual([back.config.upstreams[0].apiKey, back.config.upstreams[1].qoder.accessToken, back.config.upstreams[1].qoder.refreshToken, back.config.server.adminToken], ["sk-a", "qt", "qr", "adm"]);
  assert.deepEqual(back.config.server.inboundKeys, [inbound]);
  assert.equal(back.config.upstreams[0].headers["x-api-key"], "");
  assert.deepEqual(back.secretProblems, ["upstreams.a.headers.x-api-key: could not decrypt (wrong secret.key?)", "inboundKeys[0]: could not decrypt (wrong secret.key?)"]);
  // One entered in its place replaces it; an upstream removed takes its sealed values with it.
  back.config.upstreams[0].apiKey = "sk-b";
  back.config.upstreams = back.config.upstreams.filter((/** @type {any} */ u) => u.id !== "q");
  saveConfig(dir, back.config);
  const again = loadConfig(dir);
  assert.equal(again.config.upstreams[0].apiKey, "sk-b");
  assert.deepEqual(again.config.upstreams.map((/** @type {any} */ u) => u.id), ["a"]);
  assert.ok(!readFileSync(join(dir, "config.json"), "utf8").includes('"q"'), "the removed upstream is gone from the file");
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the bug hunt of 10-30: a placeholder came back by the place it was read at, so an upstream renamed
// on its card saved with no key and its headers' kept values gone, and a header renamed with its kept value lost it, or
// kept "__SECRET__" as its value)
test("a rename keeps its secrets or is refused in words: renamed on its card, an upstream takes them to its new id, two swapped each their own; a name changed by hand is refused, never saved without its value", () => {
  const stored = {
    server: {},
    upstreams: [
      { id: "a", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-aaaa-1111", headers: { Authorization: "Bearer h-a" }, rules: { headers: { set: { "x-api-key": "rk-a" } } } },
      { id: "b", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "sk-ant-bbbb-2222" },
    ],
    routes: [],
  };
  const page = () => redactConfig(stored);
  // Renamed on its card: the id it was read under goes with it, and its secrets go to the new id.
  const renamed = page();
  Object.assign(renamed.upstreams[0], { id: "c", renamedFrom: "a" });
  const c = mergeSecrets(renamed, stored).upstreams[0];
  assert.deepEqual([c.id, c.apiKey, c.headers, c.rules.headers.set, "renamedFrom" in c], ["c", "sk-ant-aaaa-1111", { Authorization: "Bearer h-a" }, { "x-api-key": "rk-a" }, false]);
  // Two swapped: each takes its own, never the other's.
  const swapped = page();
  Object.assign(swapped.upstreams[0], { id: "b", renamedFrom: "a" });
  Object.assign(swapped.upstreams[1], { id: "a", renamedFrom: "b" });
  assert.deepEqual(mergeSecrets(swapped, stored).upstreams.map((/** @type {any} */ u) => [u.id, u.apiKey]), [["b", "sk-ant-aaaa-1111"], ["a", "sk-ant-bbbb-2222"]]);
  // By hand (the raw JSON), with nothing to say what it was: refused, each place named, and how to say the id it had.
  const byHand = page();
  byHand.upstreams[0].id = "c";
  assert.throws(
    () => mergeSecrets(byHand, stored),
    (/** @type {any} */ e) => e.status === 400 && /^Not saved: nothing is kept for upstreams\.c\.apiKey, upstreams\.c\.headers\.Authorization, upstreams\.c\.rules\.headers\.set\.x-api-key, .*: type each value again, or put back the names they had; upstreams\.c has an id the configuration does not hold: an upstream renamed here takes its secrets with it when it names the id it had — add "renamedFrom": "<the id it had>" to it\.$/.test(e.message),
  );
  // Said so, it carries them.
  byHand.upstreams[0].renamedFrom = "a";
  assert.equal(mergeSecrets(byHand, stored).upstreams[0].apiKey, "sk-ant-aaaa-1111");
  // A header renamed with its kept value, to a credential's name or to any other: refused, never saved as "__SECRET__".
  for (const name of ["X-Api-Key", "X-Team"]) {
    const header = page();
    header.upstreams[0].headers = { [name]: "__SECRET__" };
    assert.throws(() => mergeSecrets(header, stored), (/** @type {any} */ e) => e.status === 400 && e.message.includes(`nothing is kept for upstreams.a.headers.${name},`) && e.message.endsWith("type the value again, or put back the name it had."), name);
  }
});

// (fails before: yes — the bug hunt of 10-30: an upstream renamed took its places' values to the new id, and a sealed one
// this secret.key cannot open, which the file keeps only under its own place, was gone at the next save)
test("a secret this secret.key cannot open never moves with a rename: the save is refused in words, and saying nothing of the rename keeps it", () => {
  const stored = { server: {}, upstreams: [{ id: "b", type: "anthropic", baseUrl: "https://api.anthropic.com", apiKey: "" }], routes: [] };
  const unreadable = ["upstreams.b.apiKey"];
  const page = redactConfig(stored, { unreadable });
  assert.equal(page.upstreams[0].apiKey, "__SECRET__");
  assert.deepEqual(mergeSecrets(page, stored, { unreadable }).upstreams[0].apiKey, "", "kept where it is: the file keeps its sealed value");
  Object.assign(page.upstreams[0], { id: "c", renamedFrom: "b" });
  assert.throws(
    () => mergeSecrets(page, stored, { unreadable }),
    (/** @type {any} */ e) => e.status === 400 && e.message === "Not saved: upstreams.b.apiKey cannot be read (it was sealed with another secret.key), so it cannot move to upstreams.c.apiKey: put back the secret.key it was sealed with and start Filament again, or type the value again.",
  );
});

// (fails before: yes — a coding agent's two MCP servers by one name shared one place, so the first came back with the
// second's secret)
test("a coding agent's two MCP servers by one name each keep their own secret", () => {
  const stored = { server: {}, routes: [], upstreams: [{ id: "cur", type: "acp", acp: { command: "agent", mcpServers: [
    { name: "gh", command: "npx", env: { GITHUB_TOKEN: "ghp-first" } },
    { name: "gh", command: "uvx", env: { GITHUB_TOKEN: "ghp-second" } },
  ] } }] };
  const page = redactConfig(stored);
  assert.deepEqual(page.upstreams[0].acp.mcpServers.map((/** @type {any} */ m) => m.env.GITHUB_TOKEN), ["__SECRET__", "__SECRET__"]);
  assert.deepEqual(mergeSecrets(page, stored).upstreams[0].acp.mcpServers.map((/** @type {any} */ m) => m.env.GITHUB_TOKEN), ["ghp-first", "ghp-second"]);
});

// (fails before: yes — your defaults' MCP servers by one name, which a whole Save stores as written, shared one place:
// each came back with the last one's secret)
test("your defaults' MCP servers by one name each keep their own secret — two in one list, or one in each spelling", () => {
  const stored = { server: {}, upstreams: [], routes: [], sessions: { defaults: {
    plugins: { mcp: [{ name: "gh", command: "npx", env: { GITHUB_TOKEN: "ghp-first" } }, { name: "gh", command: "uvx", env: { GITHUB_TOKEN: "ghp-second" } }] },
    "plugins.mcp": [{ name: "gh", url: "https://gh.example/mcp", headers: { Authorization: "Bearer ghp-dotted" } }],
  } } };
  const page = redactConfig(stored);
  assert.deepEqual(page.sessions.defaults.plugins.mcp.map((/** @type {any} */ m) => m.env.GITHUB_TOKEN), ["__SECRET__", "__SECRET__"]);
  const back = mergeSecrets(page, stored).sessions.defaults;
  assert.deepEqual(back.plugins.mcp.map((/** @type {any} */ m) => m.env.GITHUB_TOKEN), ["ghp-first", "ghp-second"]);
  assert.equal(back["plugins.mcp"][0].headers.Authorization, "Bearer ghp-dotted");
});

// (fails before: yes — the bug hunt of 10-30: a Remove of a secret this secret.key cannot open sent "" and the save kept
// the sealed value anyway, so the Remove silently did nothing)
test("a Remove forgets a secret this secret.key cannot open — the card's key, the admin token; a field merely left empty keeps it", async () => {
  const other = randomBytes(32);
  const sealedKey = seal("sk-ant-sealed-elsewhere-0000", other);
  const sealedToken = seal("adm-sealed-elsewhere", other);
  const shim = await startApp({
    configure: (cfg) => {
      cfg.server.adminToken = sealedToken;
      cfg.upstreams.push({ id: "b", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: sealedKey });
    },
  });
  const disk = () => JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8"));
  const state = async () => (await shim.api("/api/state")).json();
  const put = async (/** @type {any} */ st) => shim.api(`/api/config?base=${st.configVersion}&read=${st.configVersion}`, { method: "PUT", body: st.config });
  try {
    const st = await state();
    assert.deepEqual(st.unreadable, ["upstreams.b.apiKey", "server.adminToken"]);
    // The fields left as they came (empty boxes): both kept as sealed.
    assert.equal((await put(st)).status, 200);
    assert.deepEqual([disk().upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey, disk().server.adminToken], [sealedKey, sealedToken]);
    // Remove on each: the page sends them empty, and the save forgets them.
    const now = await state();
    now.config.upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey = "";
    now.config.server.adminToken = "";
    const saved = await put(now);
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual((await saved.json()).unreadable, []);
    assert.deepEqual([disk().upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey, disk().server.adminToken], [undefined, undefined], "gone from the file");
    assert.equal((await state()).config.upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey, "", "no key, said as none");
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — the bug hunt of 10-30: a route's secret header came back by the route's place, so a route added
// above took the next one's header and the last lost its own)
test("each route keeps its own secret header when a route is added above it, or the routes move", () => {
  const stored = {
    server: {},
    upstreams: [{ id: "gw", type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1" }],
    routes: [
      { match: "a/*", upstream: "gw", rules: { headers: { set: { Authorization: "Bearer route-a" } } } },
      { match: "b/*", upstream: "gw", rules: { headers: { set: { Authorization: "Bearer route-b" } } } },
    ],
  };
  const page = redactConfig(stored);
  assert.deepEqual(page.routes.map((/** @type {any} */ r) => r.rules.headers.set.Authorization), ["__SECRET__", "__SECRET__"]);
  page.routes.unshift({ match: "gw/*", upstream: "gw", rules: {} });
  const headers = (/** @type {any} */ c) => c.routes.map((/** @type {any} */ r) => [r.match, r.rules.headers?.set?.Authorization]);
  assert.deepEqual(headers(mergeSecrets(page, stored)), [["gw/*", undefined], ["a/*", "Bearer route-a"], ["b/*", "Bearer route-b"]]);
  page.routes.reverse();
  assert.deepEqual(headers(mergeSecrets(page, stored)), [["b/*", "Bearer route-b"], ["a/*", "Bearer route-a"], ["gw/*", undefined]]);
});

// (fails before: yes — the bug hunt of 10-30, #4: a sealed value this secret.key cannot open came to the pages as no value
// at all, so its card offered "paste key" and Settings said nothing, though the file kept it — SEC-1)
test("a secret this secret.key cannot open: shown to the pages as kept and named, kept on disk as sealed through a save of other fields, open again with its own key; one typed in its place replaces it", async () => {
  const other = randomBytes(32);
  const sealedElsewhere = seal("sk-ant-sealed-elsewhere-0000", other);
  const shim = await startApp({
    keep: true,
    configure: (cfg, { dataDir }) => {
      const key = loadKey(dataDir);
      cfg.upstreams.push(
        { id: "a", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: seal("sk-ant-readable-1111", key) },
        { id: "b", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: sealedElsewhere },
      );
    },
  });
  const onDisk = () => JSON.parse(readFileSync(join(shim.dataDir, "config.json"), "utf8")).upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey;
  const state = async () => (await shim.api("/api/state")).json();
  try {
    const st = await state();
    assert.deepEqual(st.unreadable, ["upstreams.b.apiKey"]);
    const up = (/** @type {string} */ id) => st.config.upstreams.find((/** @type {any} */ u) => u.id === id);
    assert.deepEqual([up("b").apiKey, up("b").apiKeyMasked], ["__SECRET__", undefined], "kept, with no part of it to show");
    assert.equal(up("a").apiKeyMasked, "sk-a…1111");
    // A save of another field, the page's copy sent back whole: the sealed value stays as it was stored.
    st.config.server.logLevel = "debug";
    const saved = await shim.api(`/api/config?base=${st.configVersion}&read=${st.configVersion}`, { method: "PUT", body: st.config });
    assert.equal(saved.status, 200, await saved.clone().text());
    assert.deepEqual((await saved.json()).unreadable, ["upstreams.b.apiKey"]);
    assert.equal(onDisk(), sealedElsewhere, "on disk, untouched");
    // The add flow's answer is the same view.
    const added = await (await shim.api("/api/upstreams", { method: "POST", body: { type: "openai-compatible", baseUrl: "http://127.0.0.1:9/v1", prefix: "c" } })).json();
    assert.deepEqual([added.unreadable, added.config.upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey], [["upstreams.b.apiKey"], "__SECRET__"]);
    assert.equal(onDisk(), sealedElsewhere, "on disk, untouched");
    // One typed in its place replaces it, and nothing is unreadable any more.
    const now = await state();
    now.config.upstreams.find((/** @type {any} */ u) => u.id === "b").apiKey = "sk-ant-typed-2222";
    assert.equal((await shim.api(`/api/config?base=${now.configVersion}`, { method: "PUT", body: now.config })).status, 200);
    assert.notEqual(onDisk(), sealedElsewhere);
    assert.deepEqual((await state()).unreadable, []);
  } finally {
    await shim.stop();
  }
  try {
    // Its own key back, before the value was typed over: it opens again.
    const dir = mkdtempSync(join(tmpdir(), "filament-sec9-"));
    const cfg = defaultConfig();
    cfg.upstreams = [{ id: "b", type: "anthropic", baseUrl: "http://127.0.0.1:9", apiKey: sealedElsewhere }];
    saveConfig(dir, cfg);
    assert.equal(loadConfig(dir).config.upstreams[0].apiKey, "", "this secret.key cannot open it");
    writeFileSync(join(dir, "secret.key"), other.toString("base64") + "\n");
    assert.equal(loadConfig(dir).config.upstreams[0].apiKey, "sk-ant-sealed-elsewhere-0000");
    rmSync(dir, { recursive: true, force: true });
  } finally {
    await removeDirs(shim.dataDir);
  }
});

// (fails before: yes — the bug hunt of 10-30, SEC-7: config.json was written with the process's default mode, so on a
// Unix machine any account could read it, and with encryptSecrets off every key in it)
test("config.json is written its owner's alone (0o600)", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sec8-"));
  /** @type {[unknown, any][]} */
  const writes = [];
  const real = fs.writeFileSync;
  fs.writeFileSync = (/** @type {any} */ file, /** @type {any} */ data, /** @type {any} */ o) => {
    writes.push([file, o]);
    real(file, data, o);
  };
  syncBuiltinESMExports();
  try {
    saveConfig(dir, defaultConfig());
  } finally {
    fs.writeFileSync = real;
    syncBuiltinESMExports();
  }
  assert.equal(writes.find(([file]) => String(file).endsWith("config.json.tmp"))?.[1]?.mode, 0o600);
  if (process.platform !== "win32") assert.equal(statSync(join(dir, "config.json")).mode & 0o777, 0o600);
  rmSync(dir, { recursive: true, force: true });
});

// (fails before: yes — the bug hunt of 10-30, SEC-6: a template applied again over its upstream put its own `qoder` and
// `acp` in place whole, so a Qoder sign-in's tokens and a coding agent's environment keys were gone)
test("a template applied again keeps its upstream's credentials — its Qoder sign-in, its agent's environment — and sets its own fields", () => {
  const qoder = getTemplate("qoder-cloud");
  const signedIn = { authMethod: "device", accessToken: "dt-1", refreshToken: "rt-1", region: "china" };
  // Applied as every caller applies one: normalised, a configuration of its own.
  const once = normalizeConfig(applyTemplate(defaultConfig(), qoder));
  once.upstreams.find((/** @type {any} */ u) => u.id === "qoder-cloud").qoder = signedIn;
  assert.deepEqual(applyTemplate(once, qoder).upstreams.find((/** @type {any} */ u) => u.id === "qoder-cloud").qoder, signedIn);
  const agent = /** @type {any} */ (TEMPLATES.find((t) => /** @type {any} */ (t).patch?.upstreams?.[0]?.acp));
  const id = agent.patch.upstreams[0].id;
  const made = normalizeConfig(applyTemplate(defaultConfig(), agent));
  const up = made.upstreams.find((/** @type {any} */ u) => u.id === id);
  up.acp.env = { ...up.acp.env, CURSOR_API_KEY: "ck-1" };
  up.acp.permissions = "ask";
  const again = applyTemplate(made, agent).upstreams.find((/** @type {any} */ u) => u.id === id);
  assert.equal(again.acp.env.CURSOR_API_KEY, "ck-1");
  assert.equal(again.acp.permissions, "allow-all", "the template's own fields are its own");
});

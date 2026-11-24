import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, readdirSync } from "node:fs";
import http from "node:http";
import { loadKey } from "../src/secrets.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server.js";
import { defaultConfig, redactConfig, mergeSecrets, loadConfig, normalizeConfig, validateConfig } from "../src/config.js";
import { choosePermission, determineCwd, loginStatus } from "../src/acp.js";
import { TurnBridge } from "../src/adapters/agents/turn-bridge.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { FAKE_ACP_AGENT } from "./helpers/app.js";
import { redactHeaders } from "../src/core/redact.js";

let app, port, dataDir;
before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "filament-sec-"));
  const cfg = defaultConfig(); cfg.server.port = 0; cfg.server.loopbackTrust = "legacy"; cfg.server.inboundKeys = ["sk-filament-secret-key-1234"]; cfg.observability.logFile = "";
  cfg.upstreams = [{ id: "u", type: "anthropic-compatible", baseUrl: "http://127.0.0.1:9", apiKey: "sk-up", enabled: true }]; cfg.routes = [{ match: "*", upstream: "u", upstreamModel: "{model}" }];
  writeFileSync(join(dataDir, "config.json"), JSON.stringify(cfg));
  app = createApp({ dataDir, overrides: { port: 0 } }); port = (await app.start()).port;
});
after(async () => { await app.stop(); rmSync(dataDir, { recursive: true, force: true }); });

test("cross-origin mutating admin requests are refused; same-origin and origin-less (scripts) are allowed", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const body = JSON.stringify({ ...st.config, server: { ...st.config.server, requireAuth: false } });
  const evil = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { Origin: "http://evil.example", "content-type": "text/plain" }, body });
  assert.equal(evil.status, 403);
  const evil2 = await fetch(`http://127.0.0.1:${port}/api/keys/rotate`, { method: "POST", headers: { Origin: "http://evil.example", "content-type": "text/plain" }, body: "{}" });
  assert.equal(evil2.status, 403);
  const evil3 = await fetch(`http://127.0.0.1:${port}/api/assistant/apply`, { method: "POST", headers: { Origin: "http://evil.example", "content-type": "text/plain" }, body: JSON.stringify({ sessionId: "attacker" }) });
  assert.equal(evil3.status, 403);
  assert.equal(loadConfig(dataDir).config.server.requireAuth, true, "nothing persisted");
  const same = await fetch(`http://127.0.0.1:${port}/api/dry-run`, { method: "POST", headers: { Origin: `http://127.0.0.1:${port}`, "content-type": "application/json" }, body: JSON.stringify({ format: "anthropic", body: { model: "x", max_tokens: 5, messages: [{ role: "user", content: "hi" }] } }) });
  assert.equal(same.status, 200);
  const sameWrongType = await fetch(`http://127.0.0.1:${port}/api/dry-run`, { method: "POST", headers: { Origin: `http://127.0.0.1:${port}`, "content-type": "text/plain" }, body: "{}" });
  assert.equal(sameWrongType.status, 415);
  // (fails before: yes — HarnessV4_Tasks C5: the rule named 15 path prefixes, and 32 write routes sat outside them: a
  // page's form post rotated the key) Every write from a page is JSON, with or without a body, whatever its path.
  const keys = async () => (await (await fetch(`http://127.0.0.1:${port}/api/keys`)).json()).keys;
  const before = await keys();
  const page = { Origin: `http://127.0.0.1:${port}` };
  for (const headers of [{ ...page, "content-type": "text/plain" }, { ...page, "content-type": "application/x-www-form-urlencoded" }, page]) {
    const r = await fetch(`http://127.0.0.1:${port}/api/keys/rotate`, { method: "POST", headers, ...(headers["content-type"] ? { body: "{}" } : {}) });
    assert.equal(r.status, 415, JSON.stringify(headers));
    assert.deepEqual(await r.json(), { error: "admin writes must use Content-Type: application/json" });
  }
  assert.deepEqual(await keys(), before, "no key was rotated");
  // A page's write with no body still says JSON, as the pages' client does on every call.
  const bodiless = await fetch(`http://127.0.0.1:${port}/api/sessions/nope/stop`, { method: "POST", headers: { ...page, "content-type": "application/json" } });
  assert.notEqual(bodiless.status, 415);
  const script = await fetch(`http://127.0.0.1:${port}/api/dry-run`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: "anthropic", body: { model: "x", max_tokens: 5, messages: [{ role: "user", content: "hi" }] } }) });
  assert.equal(script.status, 200);
});

// (fails before: yes — the bug hunt of 10-30, ADM-3 and ADM-4: the CSRF guard asked writes alone, so a page of another
// site had the browser GET an admin row by an image or a link: an upstream tested with its stored key, a Space's asks
// settled, the model lists fetched afresh)
test("a GET a page of another site sends is refused, by its Origin or, with none, by Sec-Fetch-Site; Filament's own pages, a typed address, programs and a sign-in coming back are answered", async () => {
  const get = (/** @type {string} */ path, /** @type {Record<string, string>} */ headers = {}) => fetch(`http://127.0.0.1:${port}/api${path}`, { headers });
  for (const headers of [{ Origin: "http://evil.example" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }, { Origin: "http://127.0.0.1:5173", "Sec-Fetch-Site": "same-site" }]) {
    for (const path of ["/upstreams/u/test", "/your-space", "/space/nope", "/state"]) {
      const r = await get(path, headers);
      assert.equal(r.status, 403, `${path} ${JSON.stringify(headers)}`);
      assert.match((await r.json()).error, /^cross-site request refused \(/);
    }
  }
  for (const headers of [{}, { "Sec-Fetch-Site": "same-origin" }, { "Sec-Fetch-Site": "none" }, { Origin: `http://127.0.0.1:${port}`, "Sec-Fetch-Site": "same-origin" }, { Origin: `http://localhost:${port}`, "Sec-Fetch-Site": "cross-site" }])
    assert.equal((await get("/state", headers)).status, 200, JSON.stringify(headers));
  const tested = await get("/upstreams/u/test", { "Sec-Fetch-Site": "same-origin" });
  assert.equal(tested.status, 200, "the harness's own Test answers as before");
  const back = await get("/mcp-servers/sign-in/back?state=nope&code=x", { "Sec-Fetch-Site": "cross-site" });
  assert.notEqual(back.status, 403, "a server's sign-in comes back from its own site");
  assert.match(String(back.headers.get("content-type")), /^text\/html/);
});

// (fails before: yes — HarnessV4_Tasks C5: two of the harness's writes were bare fetches that named no content type,
// and the admin API answered each 415: the waiting send's Stop, and a rewound line's "Open as a fork")
test("no page writes to the admin API past its client: a bare fetch with a method names the JSON type itself", () => {
  /** @type {string[]} */
  const bare = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "vendor") walk(p);
      } else if (e.name.endsWith(".js")) {
        readFileSync(p, "utf8").split("\n").forEach((line, i) => {
          if (/\bfetch\(/.test(line) && /\/api\//.test(line) && /method:/.test(line) && !/content-type/.test(line)) bare.push(`${p}:${i + 1}`);
        });
      }
    }
  };
  walk(join("src", "ui"));
  assert.deepEqual(bare, []);
});

test("inbound keys are masked in /api/state but available on /api/keys; round-trip save keeps them", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.deepEqual(st.config.server.inboundKeys, ["__SECRET__"]); assert.ok(st.config.server.inboundKeysMasked[0].startsWith("sk-f"));
  const keys = await (await fetch(`http://127.0.0.1:${port}/api/keys`)).json(); assert.equal(keys.keys[0], "sk-filament-secret-key-1234");
  const r = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...st.config, server: { ...st.config.server, logLevel: "debug" } }) });
  assert.equal(r.status, 200);
  const onDisk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
  assert.ok(onDisk.server.inboundKeys[0].startsWith("enc:v1:"), "inbound key is encrypted at rest");
  assert.deepEqual(loadConfig(dataDir).config.server.inboundKeys, ["sk-filament-secret-key-1234"]);
  const red = redactConfig({ server: { inboundKeys: ["a1234567890", "b"] , adminToken: "" }, upstreams: [] });
  assert.deepEqual(red.server.inboundKeys, ["__SECRET__", "__SECRET__"]);
  const merged = mergeSecrets({ server: { inboundKeys: ["__SECRET__", "new-key"] }, upstreams: [] }, { server: { inboundKeys: ["old1", "old2"] }, upstreams: [] });
  assert.deepEqual(merged.server.inboundKeys, ["old1", "new-key"]);
});

// (fails before: yes — the bug hunt of 10-30, SEC-8: a placeholder went back to the stored key at its place, so a list
// with its first key taken out kept that one and lost the second)
test("inbound keys come back as the masks beside them name them: the one taken out goes, whichever it was; with no masks, by place", () => {
  const stored = { server: { inboundKeys: ["sk-filament-aaaa-1111", "sk-filament-bbbb-2222"] }, upstreams: [] };
  const shown = redactConfig(stored);
  const page = { ...shown, server: { inboundKeys: [shown.server.inboundKeys[1]], inboundKeysMasked: [shown.server.inboundKeysMasked[1]] } };
  assert.deepEqual(mergeSecrets(page, stored).server.inboundKeys, ["sk-filament-bbbb-2222"]);
  assert.deepEqual(mergeSecrets(shown, stored).server.inboundKeys, stored.server.inboundKeys, "as read, as kept");
  const gone = { server: { inboundKeys: ["__SECRET__", "__SECRET__"], inboundKeysMasked: ["sk-f…2222", "sk-f…9999"] }, upstreams: [] };
  assert.deepEqual(mergeSecrets(gone, stored).server.inboundKeys, ["sk-filament-bbbb-2222"], "a mask no stored key has names none");
  assert.deepEqual(mergeSecrets({ server: { inboundKeys: ["__SECRET__"] }, upstreams: [] }, stored).server.inboundKeys, ["sk-filament-aaaa-1111"], "no masks: by place");
});

// (fails before: yes — the bug hunt of 10-30, SEC-3: the record masked authorization and x-api-key alone, so an extra
// api-key, x-goog-api-key or cookie header reached Traffic, the jsonl and the dry run as sent)
test("the record masks every credential-named header's value, as the configuration seals it; the names, and the rest, stay", () => {
  const h = { Authorization: "Bearer a", "x-api-key": "b", "api-key": "c", "x-goog-api-key": "d", cookie: "e", "proxy-authorization": "f", "x-auth-token": "g", "content-type": "application/json", "anthropic-version": "2023-06-01", "x-session-id": "s1" };
  const R = "[redacted]";
  assert.deepEqual(redactHeaders(h), { Authorization: R, "x-api-key": R, "api-key": R, "x-goog-api-key": R, cookie: R, "proxy-authorization": R, "x-auth-token": R, "content-type": "application/json", "anthropic-version": "2023-06-01", "x-session-id": "s1" });
});

test("config diffs show secret changes masked instead of hiding them", async () => {
  const { describeDiff } = await import("../src/server.js");
  const a = { rules: {}, server: { requireAuth: true, adminToken: "old", inboundKeys: ["k1"] }, observability: {}, upstreams: [{ id: "u", apiKey: "x" }], routes: [] };
  const b = { rules: {}, server: { requireAuth: false, adminToken: "pwned", inboundKeys: ["sk-attacker"] }, observability: {}, upstreams: [{ id: "u", apiKey: "x" }], routes: [] };
  const d = describeDiff(a, b); const paths = d.map((x) => x.path).sort();
  assert.deepEqual(paths, ["server.adminToken", "server.inboundKeys", "server.requireAuth"]);
  const tok = d.find((x) => x.path === "server.adminToken"); assert.equal(tok.to, "••••••"); assert.equal(tok.secret, true); assert.ok(!JSON.stringify(d).includes("pwned") && !JSON.stringify(d).includes("sk-attacker"));
  assert.equal(d.find((x) => x.path === "server.inboundKeys").to, "[1 secret value(s)]");
});

test("permission policy fails closed and the working directory is not taken from user messages by default", () => {
  const noReject = { toolCall: { kind: "execute" }, options: [{ optionId: "a", kind: "allow_once" }] };
  assert.equal(choosePermission("reject", noReject).outcome.outcome, "cancelled");
  assert.equal(choosePermission("read-only", noReject).outcome.outcome, "cancelled");
  const noAllow = { toolCall: { kind: "read" }, options: [{ optionId: "r", kind: "reject_once" }] };
  assert.equal(choosePermission("allow-all", noAllow).outcome.outcome, "cancelled");
  const dir = mkdtempSync(join(tmpdir(), "filament-cwd2-"));
  const fromUser = [{ role: "system", text: "no path here" }, { role: "user", text: `Working directory: ${dir}` }];
  assert.notEqual(determineCwd({}, fromUser, null).cwd, dir, "user text must not steer the agent");
  assert.equal(determineCwd({ cwdFromUserMessages: true }, fromUser, null).cwd, dir);
  const other = mkdtempSync(join(tmpdir(), "filament-cwd3-"));
  const r = determineCwd({ cwdAllowlist: [other] }, [{ role: "system", text: `Working directory: ${dir}` }], null);
  assert.equal(r.cwd, other); assert.ok(r.source.includes("allowlist")); assert.match(r.source, /is outside cwdAllowlist/);
  const junk = determineCwd({ cwdAllowlist: ["allow-all"] }, [{ role: "system", text: `Working directory: ${dir}` }], null);
  assert.equal(junk.cwd, dir, "a non-path allowlist entry must not block every folder"); assert.match(junk.source, /allow-all.*ignored: not a folder path/);
  const blockedHome = determineCwd({ cwdAllowlist: [other, "read-only"] }, [{ role: "system", text: "Working directory: Q:\\no\\such\\folder" }], null);
  assert.equal(blockedHome.cwd, other); assert.match(blockedHome.source, /read-only.*ignored/);
  rmSync(dir, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true });
});

// (fails before: yes — the bug hunt of 10-30, AGT-3: a word that is no policy, such as "readonly", fell through to
// allow-all, so the agent's edits and commands ran, and so did what Filament did for it; choosePermission's own word
// for it stays reject's)
test("choosePermission handed a word that is no policy refuses, as reject does", () => {
  const params = { toolCall: { kind: "execute" }, options: [{ optionId: "a1", kind: "allow_once" }, { optionId: "aa", kind: "allow_always" }, { optionId: "r", kind: "reject_once" }] };
  assert.equal(choosePermission("readonly", params).outcome.optionId, "r");
  assert.equal(choosePermission("readonly", { ...params, toolCall: { kind: "read" } }).outcome.optionId, "r");
  assert.equal(choosePermission("readonly", { ...params, options: params.options.slice(0, 2) }).outcome.outcome, "cancelled");
});

// (fails before: yes — the bug hunt of 10-30, AGT-3's remainder: a save took a word that is no policy; and the owner's
// word of 10-30 on it: read as ask, one a file held allowed once what nobody could be asked about, and its reads unasked)
test("a permission policy that is none of the known words: a save is refused in words that name them; one a config.json holds asks where someone can be asked, a read too, and refuses where nobody can, said once in the log, never allowing unasked", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const typo = { ...st.config, upstreams: [...st.config.upstreams, { id: "agent", type: "acp", acp: { command: "agent", permissions: "readonly" } }] };
  const put = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(typo) });
  assert.equal(put.status, 400);
  assert.deepEqual((await put.json()).errors, ['upstreams[1].acp.permissions "readonly" is none of the permission policies: use allow-all, allow-once, ask, read-only or reject']);
  assert.equal(loadConfig(dataDir).config.upstreams.length, 1, "nothing saved");
  for (const word of ["allow-all", "allow-once", "ask", "read-only", "reject"])
    assert.deepEqual(validateConfig(normalizeConfig({ ...typo, upstreams: [{ id: "agent", type: "acp", acp: { command: "agent", permissions: word } }], routes: [] })).errors, [], word);
  /** @type {string[]} */
  const logged = [];
  const tb = new TurnBridge({ log: (level, msg) => logged.push(`${level} ${msg}`) });
  const agent = { id: "agent", name: "Agent", acp: { permissions: "readonly" } };
  /** @type {any[]} */
  const asked = [];
  tb.askClient = async (/** @type {any} */ _turn, /** @type {any} */ a) => (asked.push(a.kind), "allow");
  /** @type {any[]} */
  const said = [];
  const turn = (/** @type {boolean} */ ask) => /** @type {any} */ ({ done: false, bridge: "prompts", permits: null, clientTools: { has: (/** @type {string} */ t) => ask && t === "ask", buildAsk: () => ({}), askShown: () => [] }, emit: (/** @type {any} */ e) => said.push(e) });
  await tb.permitLocal(turn(true), agent, "execute", "npm test");
  await tb.permitLocal(turn(true), agent, "read", join(dataDir, "notes.txt"));
  assert.deepEqual(asked, ["permission", "permission"], "asked through the client's question tool, a read too");
  const refused = { code: -32000, message: 'refused by the permission policy "readonly", which is none of the policies and asks first, with nobody to ask' };
  await assert.rejects(tb.permitLocal(turn(false), agent, "execute", "npm test"), refused);
  await assert.rejects(tb.permitLocal(turn(false), agent, "read", join(dataDir, "notes.txt")), refused, "a read too");
  await assert.rejects(tb.permitLocal(null, agent, "execute", "npm test"), refused, "and with no turn running");
  assert.deepEqual(said, [], "nothing said as allowed once");
  assert.equal(tb.policyOf(agent.acp, "agent"), "readonly");
  assert.deepEqual(logged, ['warn [bridge] agent: acp.permissions "readonly" is none of the permission policies (allow-all, allow-once, ask, read-only, reject), so each request asks where someone can be asked and is refused where nobody can, until it is corrected'], "said once");
});

// (fails before: yes — the owner's word on AGT-3, 10-30: a word that is none of the policies, read as ask, answered the
// agent's own request with its allow-once where nobody could be asked)
test("a permission policy that is none of the known words: an ACP agent's own request, with nobody to ask, is answered with its reject", async () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-sec-typo-"));
  const bridge = new AcpBridge(/** @type {any} */ ({ log: () => {} }));
  try {
    const upstream = { id: "typo", name: "typo", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], cwdDefault: dir, permissions: "readonly", hints: false } };
    /** @type {string[]} */
    const said = [];
    await bridge.run({ upstream, modelId: "fake-a", format: "anthropic", body: { model: "m", max_tokens: 50, messages: [{ role: "user", content: "~perm please" }] }, conversationId: "typo", onEvent: (/** @type {any} */ ev) => void (ev?.type === "text" && said.push(String(ev.text))) });
    assert.match(said.join(""), /permission:no /, said.join(""));
    const entry = bridge.permissionLog.at(-1);
    assert.deepEqual([entry.policy, entry.decision], ['"readonly", none of the policies: nobody to ask, refused', "no"]);
  } finally {
    await bridge.shutdown();
    rmSync(dir, { recursive: true, force: true });
  }
});

// fetch() refuses to set Host, so raw http for the rebinding tests
const raw = (path, { host, method = "GET" } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path, method, headers: host ? { host } : {} }, (res) => { let b = ""; res.on("data", (d) => (b += d)); res.on("end", () => resolve({ status: res.statusCode, body: b })); });
  req.on("error", reject); req.end();
});

test("dashboard and admin API answer only to hosts that name this machine (DNS rebinding defence)", async () => {
  assert.equal((await raw("/api/state", { host: "evil.example" })).status, 421);
  assert.equal((await raw("/", { host: "evil.example:80" })).status, 421);
  assert.equal((await raw("/ui/app.js", { host: "evil.example" })).status, 421);
  assert.equal((await raw("/api/state", { host: `localhost:${port}` })).status, 200);
  assert.equal((await raw("/api/state", { host: `127.0.0.1:${port}` })).status, 200);
  assert.equal((await raw("/api/state", { host: "[::1]:5" })).status, 200);
  assert.equal((await raw("/api/state", { host: "llm.localhost" })).status, 200);
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const put = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...st.config, server: { ...st.config.server, allowedHosts: ["myproxy.lan"] } }) });
  assert.equal(put.status, 200);
  assert.equal((await raw("/api/state", { host: "MyProxy.lan:8080" })).status, 200);
  assert.equal((await raw("/api/state", { host: "evil.example" })).status, 421);
});

// (fails before: yes — the owner's remote Filament of 11-06, Part 1: every door that trusts "this computer" read the
// socket alone, and `tailscale serve` on this machine reaches Filament over loopback, so the whole tailnet had the
// admin API, the keys, a terminal, the run socket and the hooks)
test("a request `tailscale serve` hands on reaches Filament over loopback and is refused at every door that trusts this computer", async () => {
  const proxy = { host: `127.0.0.1:${port}`, "x-forwarded-for": "100.101.102.103", "x-forwarded-proto": "https", "tailscale-user-login": "someone@example.com", "tailscale-user-name": "Someone" };
  /** @param {string} path @param {Record<string, string>} headers @param {string} [method] @returns {Promise<number>} */
  const status = (path, headers, method = "GET") => new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers });
    req.on("response", (res) => (res.resume(), resolve(Number(res.statusCode))));
    req.on("error", reject);
    req.end();
  });
  const ws = { connection: "Upgrade", upgrade: "websocket", "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==", "sec-websocket-version": "13" };
  for (const [path, headers, method] of [["/api/state", proxy], ["/api/keys", proxy], ["/api/terminal/t1/stream", { ...proxy, ...ws }], ["/api/runs/socket", { ...proxy, ...ws }], [`/hook/some-app/${"a".repeat(32)}`, proxy, "POST"]])
    assert.equal(await status(path, headers, method), 403, `${method || "GET"} ${path}`);
  assert.equal(await status("/api/state", { host: `127.0.0.1:${port}` }), 200, "this computer, through no proxy");
});

// (fails before: yes — the bug hunt's noticed list: the model endpoints took any Host, so a page elsewhere whose name was
// rebound to this machine reached /v1 through the person's browser)
test("the model endpoints answer only to hosts that name this machine, as the admin API does; MCP already did", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  const put = await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...st.config, server: { ...st.config.server, allowedHosts: ["myproxy.lan"] } }) });
  assert.equal(put.status, 200);
  for (const [path, method, wire] of [["/v1/models", "GET", "openai"], ["/v1/chat/completions", "POST", "openai"], ["/v1/messages", "POST", "anthropic"], ["/messages", "POST", "anthropic"], ["/v1/responses", "POST", "openai"], ["/v1/embeddings", "POST", "openai"], ["/v1/messages/count_tokens", "POST", "anthropic"]]) {
    const r = await raw(path, { host: "evil.example", method });
    assert.equal(r.status, 421, `${method} ${path}: ${r.body.slice(0, 200)}`);
    const said = JSON.parse(r.body);
    assert.equal(said.error?.message, `Host "evil.example" does not name this machine (protects against DNS rebinding): call http://127.0.0.1:${port}${path}, or add the name to server.allowedHosts`, `${path}, in its client's words: ${r.body.slice(0, 200)}`);
    if (wire === "anthropic") assert.equal(said.type, "error", "an Anthropic client's error shape");
  }
  for (const host of [`127.0.0.1:${port}`, `localhost:${port}`, "[::1]:5", "10.0.0.5:20300", "MyProxy.lan:8080"])
    assert.notEqual((await raw("/v1/models", { host })).status, 421, `${host} names this machine, or is one allowed`);
  assert.notEqual((await raw("/v1/models")).status, 421, "a client that sends no Host is no page");
  assert.equal((await raw("/mcp/memory", { host: "evil.example", method: "POST" })).status, 421, "MCP's own door already asks it");
});

test("config diffs cover edits inside existing upstreams and routes, removals, and mask env/header credentials", async () => {
  const { describeDiff } = await import("../src/server.js");
  const a = { rules: {}, server: {}, observability: {}, upstreams: [{ id: "u", baseUrl: "http://a", apiKey: "x", acp: { env: { CURSOR_API_KEY: "old-cursor-key" } } }, { id: "gone", baseUrl: "http://g" }], routes: [{ match: "m", upstream: "u", upstreamModel: "one" }, { match: "old", upstream: "u", upstreamModel: "x" }] };
  const b = { rules: { headers: { set: { Authorization: "Bearer topsecret" } } }, server: {}, observability: {}, upstreams: [{ id: "u", baseUrl: "http://b", apiKey: "y-new-key", acp: { env: { CURSOR_API_KEY: "new-cursor-key" } } }], routes: [{ match: "m", upstream: "u", upstreamModel: "two" }] };
  const d = describeDiff(a, b); const by = Object.fromEntries(d.map((x) => [x.path, x])); const text = JSON.stringify(d);
  assert.equal(by["upstreams.u.baseUrl"].to, "http://b");
  assert.equal(by["upstreams.u.apiKey"].secret, true);
  assert.equal(by["upstreams.u.acp.env.CURSOR_API_KEY"].secret, true);
  assert.equal(by["upstreams.gone"].to, "removed");
  assert.equal(by["routes.m.upstreamModel"].to, "two");
  assert.equal(by["routes.old"].to, "removed");
  assert.equal(by["rules.headers.set.Authorization"].secret, true);
  assert.ok(!text.includes("topsecret") && !text.includes("y-new-key") && !text.includes("cursor-key"), text);
});

test("an unreadable secret.key is never replaced, and a corrupt config.json is set aside with a clear error", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-badkey-"));
  writeFileSync(join(dir, "secret.key"), "not-a-key");
  assert.throws(() => loadKey(dir), /not a valid key/);
  assert.equal(readFileSync(join(dir, "secret.key"), "utf8"), "not-a-key", "the file is left alone");
  const dir2 = mkdtempSync(join(tmpdir(), "filament-badcfg-"));
  writeFileSync(join(dir2, "config.json"), "{ this is not json");
  assert.throws(() => loadConfig(dir2), /not valid JSON/);
  assert.ok(readdirSync(dir2).some((f) => f.startsWith("config.json.broken-")), "a copy of the broken file is kept");
  rmSync(dir, { recursive: true, force: true }); rmSync(dir2, { recursive: true, force: true });
});

test("agent env and custom header credentials are encrypted at rest, masked in the dashboard and kept on save", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); const cfg = st.config;
  cfg.upstreams[0].acp = { env: { CURSOR_API_KEY: "ck-very-secret", PLAIN_SETTING: "visible" } };
  cfg.rules.headers = { ...(cfg.rules.headers || {}), set: { "x-api-key": "hdr-secret", "x-trace": "abc" } };
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) })).status, 200);
  const disk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
  assert.ok(disk.upstreams[0].acp.env.CURSOR_API_KEY.startsWith("enc:v1:"), "env credential sealed"); assert.equal(disk.upstreams[0].acp.env.PLAIN_SETTING, "visible");
  assert.ok(disk.rules.headers.set["x-api-key"].startsWith("enc:v1:"), "header credential sealed"); assert.equal(disk.rules.headers.set["x-trace"], "abc");
  const st2 = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(st2.config.upstreams[0].acp.env.CURSOR_API_KEY, "__SECRET__"); assert.equal(st2.config.rules.headers.set["x-api-key"], "__SECRET__");
  assert.ok(!JSON.stringify(st2).includes("ck-very-secret") && !JSON.stringify(st2).includes("hdr-secret"));
  const c2 = st2.config; c2.server.logLevel = "warn"; // saving the masked view back must keep the real values
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(c2) })).status, 200);
  const back = loadConfig(dataDir).config;
  assert.equal(back.upstreams[0].acp.env.CURSOR_API_KEY, "ck-very-secret"); assert.equal(back.rules.headers.set["x-api-key"], "hdr-secret");
  assert.equal(app.config.upstreams[0].acp.env.CURSOR_API_KEY, "ck-very-secret");
});

// (fails before: yes — an upstream's own extra headers were not among the secret slots: an Authorization header set
// there was written to config.json in clear and shown in clear on the dashboard and to the config assistant)
test("an upstream's own extra headers are secrets where their name says so: sealed at rest, masked in the dashboard, kept on save", async () => {
  const st = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); const cfg = st.config;
  cfg.upstreams[0].headers = { Authorization: "Basic dXAtc2VjcmV0LWJsb2I=", Accept: "application/json" };
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(cfg) })).status, 200);
  const disk = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
  assert.ok(disk.upstreams[0].headers.Authorization.startsWith("enc:v1:"), "sealed on disk"); assert.equal(disk.upstreams[0].headers.Accept, "application/json");
  const st2 = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json();
  assert.equal(st2.config.upstreams[0].headers.Authorization, "__SECRET__"); assert.equal(st2.config.upstreams[0].headers.Accept, "application/json");
  assert.ok(!JSON.stringify(st2).includes("dXAtc2VjcmV0LWJsb2I="), "nowhere in the dashboard's state");
  // The dashboard saves its masked view back: the stored value stays.
  assert.equal((await fetch(`http://127.0.0.1:${port}/api/config`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(st2.config) })).status, 200);
  assert.equal(loadConfig(dataDir).config.upstreams[0].headers.Authorization, "Basic dXAtc2VjcmV0LWJsb2I=");
  assert.equal(app.config.upstreams[0].headers.Authorization, "Basic dXAtc2VjcmV0LWJsb2I=", "and the running config sends it");
});

test("agent login status is asked asynchronously and parsed per agent", async () => {
  assert.equal(await loginStatus({ status: { cmd: process.execPath, args: ["-e", "console.log(JSON.stringify({loggedIn:true}))"], parse: "claude" } }), true);
  assert.equal(await loginStatus({ status: { cmd: process.execPath, args: ["-e", "console.error('Not logged in')"], parse: "codex" } }), false);
  assert.equal(await loginStatus({ status: { cmd: process.execPath, args: ["-e", "setTimeout(()=>{}, 5000)"], parse: "codex" } }, { timeoutMs: 300 }), null, "a hanging CLI times out to unknown");
  assert.equal(await loginStatus({}), null);
});

test("the docs folder is served read-only under /docs, nothing else is", async () => {
  const ok = await fetch(`http://127.0.0.1:${port}/docs/GUIDE.md`); assert.equal(ok.status, 200); assert.ok(ok.headers.get("content-type").includes("text/markdown")); assert.ok((await ok.text()).includes("# Filament: the complete guide"));
  for (const bad of ["/docs/../package.json", "/docs/..%2Fpackage.json", "/docs/GUIDE.md.bak", "/docs/", "/docs/sub/x.md"]) assert.equal((await fetch(`http://127.0.0.1:${port}${bad}`)).status, 404, bad);
  assert.equal((await raw("/docs/GUIDE.md", { host: "evil.example" })).status, 421, "same host rule as the dashboard");
});

test("values typed as text are coerced to the type the schema declares, at every layer", async () => {
  const { normalizeConfig } = await import("../src/config.js");
  const c = normalizeConfig({ rules: { effort: { stripSuffix: "false" }, params: { maxTokensMin: "4000" }, headers: { anthropicBetaAdd: "a, b" } }, upstreams: [{ id: "u", type: "acp", rules: { effort: { stripSuffix: "false" } }, acp: { command: "x", seedHistory: "false", sessionIdleMinutes: "30" } }], routes: [{ match: "m", upstream: "u", enabled: "true", rules: { effort: { stripSuffix: "false" }, speed: { suffix: "0" } } }] });
  assert.equal(c.rules.effort.stripSuffix, false); assert.equal(c.rules.params.maxTokensMin, 4000); assert.deepEqual(c.rules.headers.anthropicBetaAdd, ["a", "b"]);
  assert.equal(c.upstreams[0].rules.effort.stripSuffix, false); assert.equal(c.upstreams[0].acp.seedHistory, false); assert.equal(c.upstreams[0].acp.sessionIdleMinutes, 30);
  assert.equal(c.routes[0].enabled, true); assert.equal(c.routes[0].rules.effort.stripSuffix, false); assert.equal(c.routes[0].rules.speed.suffix, false);
});

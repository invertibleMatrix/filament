// @ts-check
// Key-free turns (the owner's remote Filament of 11-06, Part 1): a chat's turn the admin gate let in — this computer, the
// admin token, a full device — asks for no inbound key, so a page on another machine drives a chat with its session
// alone, and the inbound keys are read and made on this machine only. Another machine stands here as a request a proxy
// on this machine handed on (X-Forwarded-For over loopback), which guards.js counts as no local caller.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { plantsKeys } from "../src/http/admin/config.js";

const FAR = { "x-forwarded-for": "100.101.102.103" };
const ADMIN = "admin-token-of-this-test";

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any }>}
 */
const ask = (port, path, { method = "GET", headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const text = body === undefined ? "" : JSON.stringify(body);
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { host: `127.0.0.1:${port}`, ...(text ? { "content-type": "application/json" } : {}), ...headers } });
    req.on("response", (res) => {
      let b = "";
      res.on("data", (d) => (b += d));
      res.on("end", () => {
        let json = null;
        try {
          json = JSON.parse(b);
        } catch {}
        resolve({ status: Number(res.statusCode), headers: res.headers, json });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/** A device paired from this machine and claimed by another machine's page: its cookie. @param {number} port @param {"full" | "view"} scope */
const paired = async (port, scope) => {
  const own = { origin: `http://127.0.0.1:${port}` };
  const pair = await ask(port, "/api/remote/pair", { method: "POST", body: { scope } });
  const claimed = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name: `a ${scope} device` } });
  assert.equal(claimed.status, 200);
  return { ...FAR, ...own, cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] };
};

// (fails before: yes — the turn went through the model endpoints' key check, and a page with no key got 401)
test("a full device's page sends a chat's turn with no inbound key and it runs; a view device's, an unpaired machine's and a bare model call are refused", async () => {
  const root = mkdtempSync(join(tmpdir(), "filament-remote-turns-"));
  const up = await fakeUpstream((/** @type {any} */ call) => (call.kind === "anthropic" ? anthropicReply("Hello from home.", { model: "m-1" }) : undefined));
  const shim = await startApp({
    configure: (cfg) => {
      cfg.server.requireAuth = true;
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [root], readerModel: "" };
    },
  });
  try {
    const { port } = shim;
    const full = await paired(port, "full");
    const made = await ask(port, "/api/sessions", { method: "POST", headers: full, body: { cwd: root, model: "m-1", preset: "plain" } });
    assert.equal(made.status, 200, JSON.stringify(made.json));
    const turns = `/api/sessions/${encodeURIComponent(made.json.id)}/turns`;
    const turn = await ask(port, turns, { method: "POST", headers: full, body: { content: "hello", stream: false } });
    assert.equal(turn.status, 200, JSON.stringify(turn.json));
    assert.match(JSON.stringify(turn.json.content), /Hello from home\./, "the turn ran, with no x-api-key sent");
    // A view device reads the chat and never sends to it; an unpaired machine is refused at the gate.
    const view = await paired(port, "view");
    assert.equal((await ask(port, `/api/sessions/${encodeURIComponent(made.json.id)}`, { headers: view })).status, 200);
    assert.equal((await ask(port, turns, { method: "POST", headers: view, body: { content: "hello" } })).status, 403);
    assert.equal((await ask(port, turns, { method: "POST", headers: { ...FAR, origin: full.origin }, body: { content: "hello" } })).status, 403);
    // The model endpoints still ask for a key: a device's cookie is none, and neither is this computer.
    const bare = { model: "m-1", max_tokens: 16, messages: [{ role: "user", content: "hi" }] };
    assert.equal((await ask(port, "/v1/messages", { method: "POST", headers: { cookie: full.cookie }, body: bare })).status, 401);
    assert.equal((await ask(port, "/v1/messages", { method: "POST", body: bare })).status, 401);
    assert.equal((await ask(port, "/v1/messages", { method: "POST", headers: { "x-api-key": shim.key }, body: bare })).status, 200);
  } finally {
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});

// (fails before: yes — GET /keys answered any caller the admin gate let in, a paired device's page included)
test("the inbound keys are read and made on this machine alone: a full device and the admin token from elsewhere are refused them", async () => {
  const shim = await startApp({ configure: (cfg) => void (cfg.server.adminToken = ADMIN) });
  try {
    const { port } = shim;
    const full = await paired(port, "full");
    const admin = { ...FAR, "x-filament-admin": ADMIN };
    assert.equal((await ask(port, "/api/state", { headers: admin })).status, 200, "the admin token reaches the API");
    for (const who of [full, admin]) {
      const read = await ask(port, "/api/keys", { headers: who });
      assert.equal(read.status, 403);
      assert.match(read.json.error, /stay on the machine they belong to/);
      assert.ok(!JSON.stringify(read.json).includes(shim.key), "no key in the refusal");
      assert.equal((await ask(port, "/api/keys/rotate", { method: "POST", headers: { ...who, origin: full.origin }, body: {} })).status, 403);
    }
    const here = await ask(port, "/api/keys");
    assert.deepEqual([here.status, here.json.keys], [200, [shim.key]]);
    // (fails before: yes — PUT /config took server.inboundKeys from a full device, a key of its own that outlived its revoking)
    for (const who of [full, admin]) {
      for (const plant of [(/** @type {any} */ c) => void (c.server.inboundKeys = ["sk-filament-i-chose-this-one"]), (/** @type {any} */ c) => void (c.server.adminToken = "a-token-of-my-own")]) {
        const cfg = (await ask(port, "/api/state", { headers: who })).json.config;
        plant(cfg);
        const put = await ask(port, "/api/config", { method: "PUT", headers: { ...who, origin: full.origin }, body: cfg });
        assert.equal(put.status, 403, JSON.stringify(put.json));
        assert.match(put.json.error, /set on the machine they belong to/);
      }
      // Another field, the keys left as they are: saved.
      const cfg = (await ask(port, "/api/state", { headers: who })).json.config;
      cfg.rules.resilience = { ...(cfg.rules.resilience || {}), failover: false };
      assert.equal((await ask(port, "/api/config", { method: "PUT", headers: { ...who, origin: full.origin }, body: cfg })).status, 200);
    }
    assert.deepEqual((await ask(port, "/api/keys")).json.keys, [shim.key], "no key planted");
    const made = await ask(port, "/api/keys/rotate", { method: "POST", body: {} });
    assert.equal(made.status, 200);
    assert.deepEqual((await ask(port, "/api/keys")).json.keys, [made.json.key, shim.key]);
  } finally {
    await shim.stop();
  }
});

// (fails before: yes — no save asked who set the keys; the assistant's apply writes the whole configuration as PUT does)
test("plantsKeys: a save from elsewhere that changes the inbound keys or the admin token is refused; one that leaves them, or this computer's, is not", () => {
  const now = { server: { inboundKeys: ["sk-a"], adminToken: "t" } };
  const far = { who: { kind: "device", scope: "full" } };
  assert.equal(plantsKeys(far, { server: { inboundKeys: ["sk-a"], adminToken: "t" } }, now), false);
  assert.equal(plantsKeys(far, { server: { inboundKeys: ["sk-mine", "sk-a"], adminToken: "t" } }, now), true);
  assert.equal(plantsKeys(far, { server: { inboundKeys: ["sk-a"], adminToken: "mine" } }, now), true);
  assert.equal(plantsKeys({ who: { kind: "token" } }, { server: { inboundKeys: [], adminToken: "t" } }, now), true);
  assert.equal(plantsKeys({ who: { kind: "local" } }, { server: { inboundKeys: ["sk-mine"], adminToken: "mine" } }, now), false);
});

// @ts-check
// The rows a read-only review found still answering without a press (s-rows, 11-12; the press key's own tests are
// x-sec-press-key.test.js's, r-doors' press-programs.test.js's). While the desktop app holds a key, a program on this
// computer without it had Filament start any program it named, by testing an upstream nobody kept; had a kept
// provider's key sent to an address of its choosing, by a test or by moving the provider's address; made an Always
// allow by typing `@mem confirm` into a chat; had a Space of your own read the whole computer; made BugHunters — the
// team a chat's main agent may start by itself — change files; and brought an archived project back, its routines and
// watchers with it. Each is refused without the key, in words, and nothing is started, sent or written; with the key —
// the page's every write carries it — each answers as it did; what narrows, and what is kept tested as it is kept,
// needs none; and with no key held — a plain browser, a server, the CLI — everything is as it was. Through a real
// Filament, a fake provider, and a second one at another address that says what reached it.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { scaledMs, until } from "./helpers/wait.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { createProviders } from "../src/app/providers.js";
import { setBackups } from "../src/app/model-routes.js";
import { testsMore } from "../src/app/upstream-test.js";
import { memAsksLess } from "../src/app/commands/mem.js";
import { reachWidens } from "../src/core/space.js";
import { keysSentTo } from "../src/services/config/secrets.js";
import { allowsAlways } from "../src/services/memory/permissions.js";
import { configAsksLess } from "../src/services/session-settings.js";
import { checksUnasked, writesMore } from "../src/services/teams.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const REFUSED = /Filament app/;
/** The key the kept provider holds: a test's own, told apart from every other header a request carries. */
const KEPT = `kept-${randomBytes(12).toString("hex")}`;

/**
 * A request over node:http, so the test sets every header itself.
 * @param {number} port @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o]
 * @returns {Promise<{ status: number, headers: http.IncomingHttpHeaders, json: any, text: string }>}
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
        resolve({ status: Number(res.statusCode), headers: res.headers, json, text: b });
      });
    });
    req.on("error", reject);
    req.end(text || undefined);
  });

/**
 * A configuration held in memory, as the writers take one: what `changeConfig` sets and saves, its version moving with
 * each save. @param {any} cfg
 */
const memoryStore = (cfg) => {
  let now = cfg;
  let version = 1;
  return { get: () => now, set: (/** @type {any} */ c) => void (now = c), save: () => void (version += 1), version: () => version, at: () => null, unreadable: () => [] };
};

describe("the rows that answered without a press, on one Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** Another address: what reaches it was sent where the person never said. @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let far;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-press-rows-"));
  /** @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o] */
  const call = (path, o) => ask(shim.port, path, o);
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A new chat of this computer's, its id. */
  const create = async () => {
    const r = await call("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, r.text);
    return String(r.json.id);
  };
  /** A press refused in words, the press marked so a client can tell. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const refused = (r, what) => {
    assert.equal(r.status, 403, `${what}: ${r.text}`);
    assert.match(String(r.json?.error), REFUSED, what);
    assert.equal(r.json?.press, true, what);
  };
  /** An answer that is no refusal of a press: the row was reached. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const reached = (r, what) => assert.ok(!(r.status === 403 && r.json?.press), `${what}: ${r.text}`);
  /**
   * Each row asked in turn with no key, every one before any is judged — so a failure names each that answered —, then
   * each refused as a press. @param {[string, () => Promise<{ status: number, json: any, text: string }>][]} rows
   * @returns {Promise<Record<string, number>>} each one's status, by what it is
   */
  const statuses = async (rows) => {
    /** @type {Record<string, number>} */
    const out = {};
    for (const [what, row] of rows) out[what] = (await row()).status;
    return out;
  };
  /** What `statuses` gives where every row was refused. @param {[string, unknown][]} rows */
  const all403 = (rows) => Object.fromEntries(rows.map(([what]) => [what, 403]));
  /** Whether a request that reached the other address carried the kept key. */
  const keyReached = () => far.received.some((c) => Object.values(c.headers).some((v) => String(v).includes(KEPT)));
  /** The config as the page reads it. */
  const config = async () => (await call("/api/state")).json.config;
  /** A kept upstream as the page reads it: its key a placeholder. @param {string} id */
  const keptUpstream = async (id) => (await config()).upstreams.find((/** @type {any} */ u) => u.id === id);

  before(async () => {
    up = await fakeUpstream(async (c) => (c.kind === "anthropic" ? anthropicReply("MODEL ANSWER", { model: "brain-model" }) : undefined));
    far = await fakeUpstream();
    shim = await startApp({
      memory: true,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: KEPT, enabled: true },
          { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", readerModel: "" };
      },
    });
    setPressKey(KEY);
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
    await up.close();
    await far.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the row was classed a read: a program on this computer had Filament start the program its body
  // named, and had the kept provider's key sent to the address its body named: every row below answered 200, the
  // program's file was written and the other address read the key)
  test("an upstream tested is a press where it is not one that is kept, or starts or reaches what the kept one does not: no program is started and the kept key goes nowhere; the kept one tested as it is kept needs none", async () => {
    const mark = join(root, "tested.txt");
    const program = { command: process.execPath, args: ["-e", `require("fs").writeFileSync(${JSON.stringify(mark)}, "1")`] };
    const m = await keptUpstream("m");
    const coder = await keptUpstream("coder");
    assert.equal(m.apiKey, "__SECRET__", "the page holds the key as its placeholder");
    /** @param {any} upstream @param {Record<string, string>} [headers] */
    const tested = (upstream, headers) => call("/api/upstreams/test", { method: "POST", headers, body: { upstream } });
    /** @type {[string, () => Promise<any>][]} */
    const rows = [
      ["a coding agent nobody kept", () => tested({ id: "planted", name: "planted", type: "acp", acp: program })],
      ["a kept coding agent, another program", () => tested({ ...coder, acp: { ...coder.acp, ...program } })],
      ["a kept coding agent, another environment", () => tested({ ...coder, acp: { ...coder.acp, env: { NODE_OPTIONS: "--no-warnings" } } })],
      ["a kept coding agent, another mode", () => tested({ ...coder, acp: { ...coder.acp, mode: "bypassPermissions" } })],
      ["a kept provider, another address", () => tested({ ...m, baseUrl: far.url })],
      ["a kept provider's id alone, another address", () => tested({ id: "m", type: "anthropic", baseUrl: far.url })],
      ["a kept provider, its models read from another address", () => tested({ ...m, modelsPath: `${far.url}/v1/models` })],
      ["a kept provider, another header", () => tested({ ...m, headers: { "x-planted": "1" } })],
      ["a kept provider's key under a new id, another address", () => tested({ id: "copy", renamedFrom: "m", type: "anthropic", baseUrl: far.url, apiKey: "__SECRET__" })],
      ["a provider nobody kept", () => tested({ id: "new", type: "anthropic", baseUrl: far.url, apiKey: "a-key-of-its-own" })],
    ];
    const got = await statuses(rows);
    await new Promise((r) => setTimeout(r, scaledMs(300)));
    assert.deepEqual({ answered: got, programStarted: existsSync(mark), reachedTheOtherAddress: far.received.length, keptKeyRead: keyReached() }, { answered: all403(rows), programStarted: false, reachedTheOtherAddress: 0, keptKeyRead: false });
    for (const [what, row] of rows.slice(0, 2)) refused(await row(), what);
    // The kept ones as they are kept — the page's draft with nothing changed — and the saved one's own row: no key.
    const before = up.received.length;
    const same = await tested(m);
    assert.equal(same.status, 200, same.text);
    assert.ok(up.received.length > before, "the kept provider was asked at its own address");
    const agent = await tested(coder);
    assert.equal(agent.status, 200, agent.text);
    assert.equal(agent.json.ok, true, `the kept coding agent answers its test: ${agent.text}`);
    assert.equal((await call("/api/upstreams/m/test")).status, 200, "the saved one's own test");
    // With the key, as the page's Test carries it: the form's values are tested, saved or not.
    reached(await tested({ id: "planted", name: "planted", type: "acp", acp: program }, PRESS), "a new coding agent tested with the key");
    await until(() => existsSync(mark), "the tested agent's program ran");
    const moved = await tested({ ...m, baseUrl: far.url }, PRESS);
    assert.equal(moved.status, 200, moved.text);
    assert.equal(keyReached(), true, "with the key the form's address is asked with the kept key");
    far.reset();
  });

  // (fails before: yes — the provider's own row and the config's save kept the key while the address moved: each answered
  // 200 with no key, and the saved one's test then sent the key to the other address)
  test("a kept key sent to an address it was not is a press wherever it is written — the provider's own row, the config whole, a new upstream that takes the key —; the same address, a path on it, a key of the caller's own and a new provider are not", async () => {
    const baseOf = async () => (await keptUpstream("m")).baseUrl;
    const was = await baseOf();
    const m = (/** @type {any} */ cfg) => cfg.upstreams.find((/** @type {any} */ u) => u.id === "m");
    /** The config as it is, changed. @param {(cfg: any) => void} change @param {Record<string, string>} [headers] */
    const put = async (change, headers) => {
      const next = structuredClone(await config());
      change(next);
      return call("/api/config", { method: "PUT", headers, body: next });
    };
    /** @type {[string, () => Promise<any>][]} */
    const rows = [
      ["its own row, another address", () => call("/api/upstreams/m", { method: "PATCH", body: { baseUrl: far.url } })],
      ["its own row, its models read from another address", () => call("/api/upstreams/m", { method: "PATCH", body: { modelsPath: `${far.url}/v1/models` } })],
      ["the config whole, another address", () => put((c) => void (m(c).baseUrl = far.url))],
      ["the config whole, a new upstream that takes its key to another address", () => put((c) => void c.upstreams.push({ id: "copy", name: "copy", renamedFrom: "m", type: "anthropic", baseUrl: far.url, apiKey: "__SECRET__", enabled: true }))],
    ];
    const got = await statuses(rows);
    // The saved one's own test is a read: it sends the key where the config says.
    await call("/api/upstreams/m/test");
    await call("/api/upstreams/copy/test");
    const now = await config();
    assert.deepEqual(
      { answered: got, address: m(now).baseUrl, modelsPath: m(now).modelsPath || "", upstreams: now.upstreams.map((/** @type {any} */ u) => u.id), keptKeyRead: keyReached() },
      { answered: all403(rows), address: was, modelsPath: "", upstreams: ["m", "coder"], keptKeyRead: false },
    );
    for (const [what, row] of rows.slice(0, 1)) refused(await row(), what);
    // What sends the kept key nowhere new: no key.
    for (const [what, body] of /** @type {[string, any][]} */ ([
      ["its name", { name: "M" }],
      ["a path on the same address", { baseUrl: `${was}/v1` }],
      ["the address it had", { baseUrl: was }],
      ["another address with a key of the caller's own", { baseUrl: far.url, apiKey: "a-key-of-its-own" }],
    ])) {
      const r = await call("/api/upstreams/m", { method: "PATCH", body });
      assert.equal(r.status, 200, `${what}: ${r.text}`);
    }
    await call("/api/upstreams/m/test");
    assert.equal(keyReached(), false, "the kept key went nowhere: the caller's own key replaced it");
    const back = await call("/api/upstreams/m", { method: "PATCH", headers: PRESS, body: { baseUrl: was, apiKey: KEPT } });
    assert.equal(back.status, 200, back.text);
    const added = await call("/api/upstreams", { method: "POST", body: { type: "anthropic-compatible", baseUrl: far.url, apiKey: "a-key-of-its-own", prefix: "mine" } });
    assert.equal(added.status, 200, `a new provider with its own key: ${added.text}`);
    assert.equal((await call("/api/upstreams/mine", { method: "DELETE" })).status, 200, "removed with no key");
    assert.equal((await put(() => {})).status, 200, "a save that leaves them as they are");
    // With the key the address is the config's, as from the page.
    far.reset();
    const yes = await call("/api/upstreams/m", { method: "PATCH", headers: PRESS, body: { baseUrl: far.url } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(await baseOf(), far.url);
    const whole = await put((c) => void (m(c).baseUrl = was), PRESS);
    assert.equal(whole.status, 200, whole.text);
    assert.equal(await baseOf(), was);
    far.reset();
  });

  // (fails before: yes — the three rows were classed as settings and wrote the configuration past its own weigher: `add`,
  // `change` and `setBackups` took none, so the weigher handed in below was never asked and each wrote; through the
  // row, the kept key typed again for a new provider at another address answered 200)
  test("the rows that write the configuration a piece at a time — a provider added, one changed, a model's backups — weigh what they would leave as a save of the whole does; what the page and the command line send there needs no key, and no coding agent's program or mode is written through them at all", async () => {
    // The writers ask their caller's weigher before anything moves, and say its words as a press.
    const base = { upstreams: [{ id: "zai", name: "Z.AI", type: "openai-compatible", baseUrl: "http://zai.invalid", apiKey: "a-kept-key", enabled: true }], routes: [{ match: "zai/*", upstream: "zai", upstreamModel: "{1}", enabled: true }] };
    const store = memoryStore(structuredClone(base));
    const providers = createProviders({ config: /** @type {any} */ (store) });
    /** @type {any[]} */
    const weighed = [];
    const no = (/** @type {any} */ was, /** @type {any} */ next) => (weighed.push([was.upstreams.length, next.upstreams.length, next.routes.length]), "not without the app");
    /** @param {() => unknown} write @param {string} what */
    const stopped = (write, what) =>
      assert.throws(write, (/** @type {any} */ e) => e.status === 403 && e.message === "not without the app" && e.extra?.press === true, what);
    stopped(() => providers.add({ type: "openai-compatible", baseUrl: "http://or.invalid", apiKey: "its-own", prefix: "or" }, { refuse: no }), "a provider added");
    stopped(() => providers.change("zai", { baseUrl: "http://other.invalid" }, null, { refuse: no }), "a provider changed");
    stopped(() => setBackups(/** @type {any} */ (store), "zai/glm", [{ upstream: "zai", upstreamModel: "glm-air" }], null, { refuse: no }), "a model's backups");
    assert.deepEqual(weighed, [[1, 2, 2], [1, 1, 1], [1, 1, 2]], "each was asked with the configuration kept and the one it would leave");
    assert.deepEqual([store.version(), store.get()], [1, base], "and nothing was written");
    // A weigher that lets it through, and none at all — the page's own tests, the CLI's — write as before.
    providers.add({ type: "openai-compatible", baseUrl: "http://or.invalid", apiKey: "its-own", prefix: "or" }, { refuse: () => null });
    providers.change("zai", { name: "Z" });
    setBackups(/** @type {any} */ (store), "zai/glm", [{ upstream: "or", upstreamModel: "z/glm" }]);
    assert.deepEqual([store.get().upstreams.map((/** @type {any} */ u) => u.name), store.get().routes.map((/** @type {any} */ r) => r.match)], [["Z", "or"], ["or/*", "zai/glm", "zai/*"]]);

    // Through the rows: the configuration's own weigher is the one handed in. The kept key typed again for a new
    // provider at another address is the kept key sent there — the rule is by the key, whoever types it.
    const twin = { type: "anthropic-compatible", baseUrl: far.url, apiKey: KEPT, prefix: "twin" };
    /** @type {[string, () => Promise<any>][]} */
    const rows = [["a new provider that takes the kept key to another address", () => call("/api/upstreams", { method: "POST", body: twin })]];
    const got = await statuses(rows);
    assert.deepEqual({ answered: got, upstreams: (await config()).upstreams.map((/** @type {any} */ u) => u.id) }, { answered: all403(rows), upstreams: ["m", "coder"] });
    refused(await rows[0][1](), rows[0][0]);
    // No coding agent comes in, and none's program or mode moves, by these rows — with a key or with none: each is
    // refused in its own words, and a coding agent's route takes no backups.
    const program = { command: process.execPath, args: ["-e", "0"] };
    const coder = await keptUpstream("coder");
    for (const headers of [{}, PRESS]) {
      const planted = await call("/api/upstreams", { method: "POST", headers, body: { type: "acp", name: "planted", prefix: "planted", acp: program } });
      assert.equal(planted.status, 400, planted.text);
      assert.match(planted.json.error, /a coding agent is connected under Coding agents/);
      for (const acp of [{ ...coder.acp, ...program }, { ...coder.acp, mode: "bypassPermissions" }]) {
        const changed = await call("/api/upstreams/coder", { method: "PATCH", headers, body: { acp } });
        assert.equal(changed.status, 400, changed.text);
        assert.match(changed.json.error, /is a coding agent: its acp is set under Settings › Coding agents/);
      }
      const first = await call("/api/model-routes", { method: "PUT", headers, body: { name: "coder/sonnet@bypassPermissions", backups: [{ upstream: "m", upstreamModel: "brain-model" }] } });
      assert.equal(first.status, 409, first.text);
      const backup = await call("/api/model-routes", { method: "PUT", headers, body: { name: "brain-model", backups: [{ upstream: "coder", upstreamModel: "sonnet@bypassPermissions" }] } });
      assert.equal(backup.status, 400, backup.text);
      assert.match(backup.json.error, /is a coding agent: a backup is a provider's API/);
    }
    const kept = await config();
    assert.deepEqual([kept.upstreams.map((/** @type {any} */ u) => u.id), kept.upstreams[1].acp, kept.routes.map((/** @type {any} */ r) => r.match)], [["m", "coder"], coder.acp, ["brain-*", "coder/*"]]);
    // What the pages and the command line send: no key.
    const added = await call("/api/upstreams", { method: "POST", body: { provider: "openrouter", apiKey: "a-key-of-its-own", prefix: "or" } });
    assert.equal(added.status, 200, `a provider from the catalogue with its key, as the page, the tour and \`filament\` add one: ${added.text}`);
    for (const [what, body] of /** @type {[string, any][]} */ ([
      ["switched off", { enabled: false }],
      ["switched on", { enabled: true }],
      ["its key typed anew", { apiKey: "another-of-its-own" }],
      ["its models left out", { hiddenModels: ["x/y"] }],
    ])) {
      const r = await call("/api/upstreams/or", { method: "PATCH", body });
      assert.equal(r.status, 200, `${what}: ${r.text}`);
    }
    assert.equal((await call("/api/upstreams/coder", { method: "PATCH", body: { hiddenModels: ["sonnet"] } })).status, 200, "a coding agent's model lists");
    assert.equal((await call("/api/upstreams/coder", { method: "PATCH", body: { hiddenModels: [] } })).status, 200);
    const backed = await call("/api/model-routes", { method: "PUT", body: { name: "brain-model", backups: [{ upstream: "or", upstreamModel: "x/brain" }] } });
    assert.equal(backed.status, 200, `a model's backups, as the Backups sheet saves them: ${backed.text}`);
    assert.deepEqual((await config()).routes.find((/** @type {any} */ r) => r.match === "brain-model")?.fallbacks, [{ upstream: "or", upstreamModel: "x/brain" }]);
    assert.equal((await call("/api/model-routes", { method: "PUT", body: { name: "brain-model", backups: [] } })).status, 200, "taken off again");
    assert.equal((await call("/api/upstreams/or", { method: "DELETE" })).status, 200, "removed with no key");
    // With the key, the new provider takes the key it was typed.
    const yes = await call("/api/upstreams", { method: "POST", headers: PRESS, body: twin });
    assert.equal(yes.status, 200, yes.text);
    assert.equal((await call("/api/upstreams/twin", { method: "DELETE" })).status, 200);
    assert.deepEqual([(await config()).upstreams.map((/** @type {any} */ u) => u.id), (await config()).routes.map((/** @type {any} */ r) => r.match)], [["m", "coder"], ["brain-*", "coder/*"]]);
  });

  // (fails before: yes — the service weighed `/set` and `/unset` alone: `@mem confirm` typed into a chat with no key
  // confirmed the offer — an Always allow —, and `@mem correct` made one in the caller's words; the Memory page's rows
  // refuse both)
  test("an Always allow made by chat words — `@mem confirm` of an offer, `@mem correct` of one with new words — is a press, as the Memory page's rows are; a fact confirmed or corrected, an offer forgotten and the other verbs need none", async () => {
    const id = await create();
    const { projectId } = (await call(`${S(id)}/settings`)).json;
    const archive = shim.app.memory.archive;
    assert.ok(archive, "memory's archive is open");
    /** @param {string} text */
    const offer = (text) => archive.items.add({ projectId, chainId: id, kind: "permission", text, status: "inferred", importance: 0.8 });
    const confirmed = () => archive.items.list({ projectId, kind: "permission", status: "confirmed", limit: 500 }).map((/** @type {any} */ it) => it.text);
    /** @param {string} content @param {Record<string, string>} [headers] */
    const typed = (content, headers) => call(`${S(id)}/turns`, { method: "POST", headers, body: { content, stream: false } });
    const test1 = offer("bash: npm test");
    const lint = offer("bash: npm run lint");
    /** @type {[string, () => Promise<any>][]} */
    const rows = [
      ["an offer confirmed", () => typed(`@mem confirm i${test1.id}`)],
      ["an offer's words corrected", () => typed(`@mem correct i${lint.id} bash: mkdir`)],
      ["an offer's words corrected, the words on the line under", () => typed(`@mem correct i${lint.id}\nbash: rmdir`)],
    ];
    const got = await statuses(rows);
    assert.deepEqual({ answered: got, alwaysAllowed: confirmed() }, { answered: all403(rows), alwaysAllowed: [] });
    for (const [what, row] of rows.slice(0, 1)) refused(await row(), what);
    // What makes no Always allow: no key.
    const fact = archive.items.add({ projectId, chainId: id, kind: "fact", text: "the build runs on node 20", status: "inferred", importance: 0.8 });
    const build = offer("bash: npm run build");
    for (const words of [`@mem confirm i${fact.id}`, `@mem correct i${fact.id} the build runs on node 22`, `@mem forget i${build.id}`, "@mem status", "@mem confirm", `@mem correct i${lint.id}`, "@mem confirm i999999"]) {
      const r = await typed(words);
      assert.equal(r.status, 200, `${words}: ${r.text}`);
    }
    assert.equal(archive.items.get(fact.id).status, "superseded", "the fact was confirmed, then corrected");
    assert.deepEqual(confirmed(), []);
    // With the key, as the person's own message from the app's window carries it.
    const yes = await typed(`@mem confirm i${test1.id}`, PRESS);
    assert.equal(yes.status, 200, yes.text);
    const fixed = await typed(`@mem correct i${lint.id} bash: mkdir`, PRESS);
    assert.equal(fixed.status, 200, fixed.text);
    assert.deepEqual(confirmed().sort(), ["bash: mkdir", "bash: npm test"]);
  });

  // (fails before: yes — both rows were classed a setting: a Space made reading the whole computer, and one widened to
  // it, answered 200 with no key, and its layer listed every drive)
  test("what a Space of your own may read, widened, is a press: one made reading past its folder, and one changed to read a folder it did not; narrowed, renamed, or made reading its folder alone needs none", async () => {
    const [work, wide, notes, more, other] = ["work", "wide", "notes", "more", "other"].map((n) => join(root, "own", n));
    for (const d of [notes, join(notes, "inner"), more, other]) mkdirSync(d, { recursive: true });
    const made = await call("/api/spaces/own", { method: "POST", body: { name: "Work", folder: work } });
    assert.equal(made.status, 200, `one that reads its own folder needs no key: ${made.text}`);
    const O = `/api/space/${made.json.project}/own`;
    const own = async () => (await call("/api/spaces/own")).json.spaces.find((/** @type {any} */ s) => s.project === made.json.project);
    /** @type {[string, () => Promise<any>][]} */
    const rows = [
      ["made reading the whole computer", () => call("/api/spaces/own", { method: "POST", body: { name: "Wide", folder: wide, reach: "computer" } })],
      ["made reading its folder and these", () => call("/api/spaces/own", { method: "POST", body: { name: "Wide", folder: wide, reach: "these", folders: [notes] } })],
      ["changed to read the whole computer", () => call(O, { method: "PATCH", body: { reach: "computer" } })],
      ["changed to read a folder besides its own", () => call(O, { method: "PATCH", body: { reach: "these", folders: [notes] } })],
    ];
    const got = await statuses(rows);
    assert.deepEqual({ answered: got, spaces: (await call("/api/spaces/own")).json.spaces.map((/** @type {any} */ s) => [s.name, s.reach, s.folders]) }, { answered: all403(rows), spaces: [["Work", "folder", []]] });
    for (const [what, row] of rows.slice(2, 3)) refused(await row(), what);
    // Its name, and its own folder alone: no key.
    assert.equal((await call(O, { method: "PATCH", body: { name: "Work stuff" } })).status, 200, "renamed");
    assert.equal((await call(O, { method: "PATCH", body: { reach: "folder" } })).status, 200, "its own folder alone");
    // With the key it reads these, as from its sheet.
    const yes = await call(O, { method: "PATCH", headers: PRESS, body: { reach: "these", folders: [notes, more] } });
    assert.equal(yes.status, 200, yes.text);
    assert.deepEqual([(await own()).reach, (await own()).folders], ["these", [notes, more]]);
    // From there: the same again, fewer, and a folder inside one it reads need no key; one more does.
    assert.equal((await call(O, { method: "PATCH", body: { name: "Work", reach: "these", folders: [notes, more] } })).status, 200, "the same folders again, as its sheet saves a name");
    assert.equal((await call(O, { method: "PATCH", body: { reach: "these", folders: [join(notes, "inner"), more] } })).status, 200, "a folder inside one it reads");
    refused(await call(O, { method: "PATCH", body: { reach: "these", folders: [notes, more] } }), "the folder above it again");
    refused(await call(O, { method: "PATCH", body: { reach: "these", folders: [more, other] } }), "one more folder");
    assert.equal((await call(O, { method: "PATCH", body: { reach: "these", folders: [more] } })).status, 200, "fewer");
    assert.deepEqual((await own()).folders, [more]);
    // The whole computer with the key; any folder of it after that is narrower.
    assert.equal((await call(O, { method: "PATCH", headers: PRESS, body: { reach: "computer" } })).status, 200);
    assert.equal((await call(O, { method: "PATCH", body: { reach: "these", folders: [other] } })).status, 200, "narrowed from the whole computer");
    assert.equal((await call(O, { method: "DELETE" })).status, 200, "deleted with no key");
  });

  // (fails before: yes — the team's row weighed its check alone: BugHunters, which every chat's main agent may start by
  // itself and which changes no file as it ships, was made to change files with no key — 200, and its chat no longer
  // read-only; and a team that builds, renamed to a name that agent's list holds, was on the list — 200)
  test("a team a chat's main agent may start by itself, made to change files or seated with a card it had not, is a press — BugHunters' read-only taken off, a listed team's lead changed, one made new under a listed name —; made read-only, put back as it ships, or a team not on the list needs none", async () => {
    const teams = async () => (await call("/api/teams")).json;
    const shipped = async (/** @type {string} */ key) => (await teams()).shipped.find((/** @type {any} */ t) => t.key === key);
    const mine = async (/** @type {string} */ key) => (await teams()).saved.find((/** @type {any} */ t) => t.key === key);
    const tags = (/** @type {any} */ t) => t.members.map((/** @type {any} */ m) => m.card || m.tag);
    assert.deepEqual([(await teams()).agentTeams, (await shipped("bughunters")).readOnly], [["bughunters"], true], "BugHunters is the one the agent may start, and reads only");
    const B = "/api/teams/bughunters";
    /** @type {[string, () => Promise<any>][]} */
    const rows = [
      ["BugHunters' read-only taken off", () => call(B, { method: "PUT", body: { readOnly: false } })],
      ["BugHunters made a team that builds", () => call(B, { method: "PUT", body: { readOnly: false, lead: "buildlead", members: [{ tag: "builder", line: "Fix it." }] } })],
    ];
    const got = await statuses(rows);
    const hunters = await shipped("bughunters");
    assert.deepEqual({ answered: got, readOnly: hunters.readOnly, lead: hunters.lead.tag, members: tags(hunters) }, { answered: all403(rows), readOnly: true, lead: "huntlead", members: ["reviewer", "reviewer"] });
    for (const [what, row] of rows.slice(0, 1)) refused(await row(), what);
    // While its chat changes no file, who sits in it changes none either: no key. Nor to put it back as it ships.
    const seated = await call(B, { method: "PUT", body: { members: [{ tag: "reviewer", name: "Hunter", line: "Hunt." }, { tag: "builder", name: "Fixer", line: "Say the fix." }] } });
    assert.equal(seated.status, 200, `a read-only team's members: ${seated.text}`);
    assert.equal((await call(B, { method: "PUT", body: { reset: true } })).status, 200, "put back as it ships");
    assert.deepEqual(tags(await shipped("bughunters")), ["reviewer", "reviewer"]);
    // A team the agent may not start by itself is the person's to send: no key, whatever it does.
    const dup = await call("/api/teams", { method: "POST", body: { from: "builders", name: "Mine" } });
    assert.equal(dup.status, 200, dup.text);
    assert.equal((await call("/api/teams/mine", { method: "PUT", body: { lead: "huntlead" } })).status, 200, "a team not on the list, its lead changed");
    assert.equal((await call("/api/teams/mine", { method: "PUT", body: { lead: "buildlead" } })).status, 200);
    // Listed, with the key: from then on a card it had not seated, and read-only taken off again, are presses.
    const listed = await call("/api/subagents/teams", { method: "PUT", headers: PRESS, body: { teams: ["bughunters", "mine"] } });
    assert.equal(listed.status, 200, listed.text);
    refused(await call("/api/teams/mine", { method: "PUT", body: { lead: "huntlead" } }), "a listed team's lead changed");
    const card = await call("/api/agents", { method: "POST", headers: PRESS, body: { tag: "asked", name: "Asked", goodFor: "Trying the press", thinks: "You do what the brief says and no more." } });
    assert.equal(card.status, 200, card.text);
    refused(await call("/api/teams/mine", { method: "PUT", body: { members: [{ tag: "builder", line: "" }, { tag: "reviewer", name: "Second", line: "" }, { tag: "asked", line: "" }] } }), "a listed team seated with a card it had not");
    assert.equal((await mine("mine")).lead.tag, "buildlead", "its lead is as it was");
    assert.equal((await call("/api/teams/mine", { method: "PUT", body: { name: "Mine too", members: [{ tag: "builder", line: "Build it." }] } })).status, 200, "its name, and fewer of the cards it had");
    assert.equal((await call("/api/teams/mine", { method: "PUT", body: { readOnly: true } })).status, 200, "made read-only");
    refused(await call("/api/teams/mine", { method: "PUT", body: { readOnly: false } }), "read-only taken off again");
    const off = await call("/api/teams/mine", { method: "PUT", headers: PRESS, body: { readOnly: false } });
    assert.equal(off.status, 200, off.text);
    assert.equal((await mine("mine")).readOnly, false, "with the key it builds again");
    // A name the list holds that no team answers to: a team made under it is on the list from its first moment.
    assert.equal((await call("/api/teams/mine", { method: "DELETE" })).status, 200, "deleted with no key");
    refused(await call("/api/teams", { method: "POST", body: { from: "builders", name: "Mine" } }), "a team that builds, made under a listed name");
    assert.equal(await mine("mine"), undefined, "no team was made");
    assert.equal((await call("/api/teams", { method: "POST", body: { from: "bughunters", name: "Mine" } })).status, 200, "one that reads only, under the same name");
    assert.equal((await call("/api/teams/mine", { method: "DELETE" })).status, 200);
    // So is one that builds, not on the list, renamed to that name: its key stays, and the list finds it by its name.
    assert.equal((await call("/api/teams", { method: "POST", body: { from: "builders", name: "Other" } })).status, 200, "a team that builds, not on the list");
    const renamed = await call("/api/teams/other", { method: "PUT", body: { name: "Mine" } });
    assert.deepEqual([renamed.status, (await teams()).agentTeams], [403, ["bughunters"]], `a team that builds, renamed to a listed name: ${renamed.text}`);
    refused(renamed, "a team that builds, renamed to a listed name");
    assert.equal((await call("/api/teams/builders", { method: "PUT", body: { name: "Mine" } })).status, 403, "Builders itself, renamed to it");
    assert.equal((await call("/api/teams/other", { method: "PUT", body: { name: "Mine", readOnly: true } })).status, 200, "renamed to it and made read-only");
    assert.deepEqual((await teams()).agentTeams, ["bughunters", "other"], "the list finds it by its name");
    refused(await call("/api/teams/other", { method: "PUT", body: { readOnly: false } }), "and read-only taken off it from then on");
    assert.equal((await call("/api/teams/other", { method: "DELETE" })).status, 200);
    // Your defaults' list is read as the configuration's is.
    const own = await call("/api/defaults/settings", { method: "PATCH", headers: PRESS, body: { patch: { subagents: { teams: ["bughunters", "yours"] } } } });
    assert.equal(own.status, 200, own.text);
    refused(await call("/api/teams", { method: "POST", body: { from: "builders", name: "Yours" } }), "a team that builds, made under a name your defaults list");
    assert.equal((await call("/api/defaults/settings", { method: "PATCH", body: { unset: ["subagents.teams"] } })).status, 200, "your defaults' list taken back");
    assert.equal((await call("/api/teams", { method: "POST", body: { from: "builders", name: "Yours" } })).status, 200, "the same team, the name on no list");
    assert.equal((await call("/api/teams/yours", { method: "DELETE" })).status, 200);
    // With the key BugHunters builds, as the page's editor saves it; put back as it ships needs none.
    const yes = await call(B, { method: "PUT", headers: PRESS, body: { readOnly: false } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal((await shipped("bughunters")).readOnly, false);
    refused(await call(B, { method: "PUT", body: { lead: "buildlead" } }), "its lead changed while it builds");
    assert.equal((await call(B, { method: "PUT", body: { readOnly: null } })).status, 200, "read-only put back as it ships");
    assert.equal((await shipped("bughunters")).readOnly, true);
    assert.equal((await call("/api/subagents/teams", { method: "PUT", body: { teams: ["bughunters"] } })).status, 200, "a team taken off the list");
  });

  // (fails before: yes — the row was classed as one that narrows whatever its body said: an archived project was brought
  // back with no key — 200 —, and its routines and watchers armed again)
  test("an archived project brought back is a press — what runs by itself in it goes again —; archiving one, and a chat's own way back, need none", async () => {
    const folder = join(root, "archived");
    mkdirSync(folder);
    const made = await call("/api/memory/projects", { method: "POST", body: { cwd: folder } });
    assert.equal(made.status, 200, made.text);
    const A = `/api/memory/projects/${encodeURIComponent(made.json.id)}/archive`;
    const archived = async () => (await call("/api/memory/projects")).json.projects.find((/** @type {any} */ p) => p.id === made.json.id)?.archived === true;
    assert.equal((await call(A, { method: "POST", body: { archived: true } })).status, 200, "archived with no key");
    assert.equal(await archived(), true);
    /** @type {[string, () => Promise<any>][]} */
    const rows = [["an archived project brought back", () => call(A, { method: "POST", body: { archived: false } })]];
    const got = await statuses(rows);
    assert.deepEqual({ answered: got, archived: await archived() }, { answered: all403(rows), archived: true });
    refused(await rows[0][1](), rows[0][0]);
    assert.equal((await call(A, { method: "POST", body: {} })).status, 200, "archived again, with no body's word");
    assert.equal(await archived(), true);
    const yes = await call(A, { method: "POST", headers: PRESS, body: { archived: false } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(await archived(), false, "with the key it is back, as from Settings › Archived chats");
    // A chat's own archive is its own state: a message in it brings it back all the same, and starts what the chat's
    // mode lets — its Unarchive needs no key.
    const id = await create();
    const mark = async () => (await call(`${S(id)}/settings`)).json.flat["display.archived"] === true;
    assert.equal((await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: true } } } })).status, 200);
    assert.equal(await mark(), true);
    assert.equal((await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { display: { archived: false } } } })).status, 200, "a chat brought back with no key");
    assert.equal(await mark(), false);
  });

  // (fails before: no — with no key nothing changed; it guards that it still does not)
  test("with no key — a browser, a server, the CLI —, each row answers as it did: an upstream nobody kept tested, a provider's address moved, an offer confirmed in the chat, a Space reading the whole computer, BugHunters building, a project brought back", async () => {
    setPressKey("");
    try {
      const mark = join(root, "tested-with-no-key.txt");
      const probe = await call("/api/upstreams/test", { method: "POST", body: { upstream: { id: "planted", name: "planted", type: "acp", acp: { command: process.execPath, args: ["-e", `require("fs").writeFileSync(${JSON.stringify(mark)}, "1")`] } } } });
      assert.equal(probe.status, 200, probe.text);
      await until(() => existsSync(mark), "the tested agent's program ran");
      const was = (await keptUpstream("m")).baseUrl;
      assert.equal((await call("/api/upstreams/m", { method: "PATCH", body: { baseUrl: far.url } })).status, 200, "a provider's address moved");
      assert.equal((await call("/api/upstreams/m", { method: "PATCH", body: { baseUrl: was } })).status, 200);
      const id = await create();
      const { projectId } = (await call(`${S(id)}/settings`)).json;
      const archive = shim.app.memory.archive;
      assert.ok(archive, "memory's archive is open");
      const offer = archive.items.add({ projectId, chainId: id, kind: "permission", text: "bash: npm run format", status: "inferred", importance: 0.8 });
      const typed = await call(`${S(id)}/turns`, { method: "POST", body: { content: `@mem confirm i${offer.id}`, stream: false } });
      assert.equal(typed.status, 200, typed.text);
      assert.equal(archive.items.get(offer.id).status, "confirmed", "an offer confirmed in the chat");
      const space = await call("/api/spaces/own", { method: "POST", body: { name: "Everything", folder: join(root, "own", "everything"), reach: "computer" } });
      assert.equal(space.status, 200, space.text);
      assert.equal(space.json.reach, "computer");
      assert.equal((await call(`/api/space/${space.json.project}/own`, { method: "DELETE" })).status, 200);
      const builds = await call("/api/teams/bughunters", { method: "PUT", body: { readOnly: false } });
      assert.equal(builds.status, 200, builds.text);
      assert.equal((await call("/api/teams/bughunters", { method: "PUT", body: { reset: true } })).status, 200);
      const folder = join(root, "archived-with-no-key");
      mkdirSync(folder);
      const made = await call("/api/memory/projects", { method: "POST", body: { cwd: folder } });
      const A = `/api/memory/projects/${encodeURIComponent(made.json.id)}/archive`;
      assert.equal((await call(A, { method: "POST", body: { archived: true } })).status, 200);
      assert.equal((await call(A, { method: "POST", body: { archived: false } })).status, 200, "a project brought back");
    } finally {
      setPressKey(KEY);
    }
  });
});

describe("the rules those rows read, each alone", () => {
  /** A config store that only reads. @param {any} cfg */
  const kept = (cfg) => ({ get: () => cfg });
  const agent = { id: "coder", name: "coder", type: "acp", acp: { command: "node", args: ["agent.js"], env: { TOKEN: "t" }, permissions: "allow-all" } };
  const provider = { id: "m", name: "m", type: "anthropic", baseUrl: "https://api.example.com/v1", apiKey: "k-1", headers: { "x-org": "one" } };

  // (fails before: yes — there was no such rule: the row took any body)
  test("`testsMore`: a test does more than a kept upstream's where none is kept behind it, or where it starts or reaches what the kept one does not", () => {
    const config = kept({ upstreams: [agent, provider] });
    const form = { ...provider, apiKey: "__SECRET__" };
    for (const [what, u, more] of /** @type {[string, any, boolean][]} */ ([
      ["the kept provider as the page holds it", form, false],
      ["its name and its switch", { ...form, name: "M", enabled: false }, false],
      ["its key typed anew, the address its own", { ...form, apiKey: "k-2" }, false],
      ["its headers as they are, written anew", { ...form, headers: { "x-org": "one" } }, false],
      ["its address", { ...form, baseUrl: "https://api.example.com/v2" }, true],
      ["its models read elsewhere", { ...form, modelsPath: "https://else.example.com/models" }, true],
      ["a header more", { ...form, headers: { "x-org": "one", "x-more": "1" } }, true],
      ["its kind", { ...form, type: "openai" }, true],
      ["the kept agent as it is kept", structuredClone(agent), false],
      ["the kept agent, another argument", { ...agent, acp: { ...agent.acp, args: ["other.js"] } }, true],
      ["the kept agent, another mode", { ...agent, acp: { ...agent.acp, mode: "bypassPermissions" } }, true],
      ["the kept agent, a variable more", { ...agent, acp: { ...agent.acp, env: { TOKEN: "t", MORE: "1" } } }, true],
      ["one read under another id as the kept one", { ...form, id: "renamed", renamedFrom: "m" }, false],
      ["one nobody kept", { ...form, id: "other" }, true],
      ["no upstream at all", null, true],
      ["a list", [form], true],
    ]))
      assert.equal(testsMore(u, config), more, what);
    assert.equal(form.apiKey, "__SECRET__", "the body weighed is left as it was sent");
  });

  // (fails before: yes — the config's weigher read no address: a key kept while its upstream's address moved was no press)
  test("`keysSentTo` and the config's weigher: a key kept is told by itself, and a press where it would go to an address it did not", () => {
    const cfg = (/** @type {any[]} */ ...upstreams) => ({ upstreams });
    assert.deepEqual([...keysSentTo(cfg(provider))], [["k-1", new Set(["https://api.example.com"])]]);
    assert.deepEqual([...keysSentTo(cfg({ ...provider, modelsPath: "https://Else.example.com/models" }))], [["k-1", new Set(["https://api.example.com", "https://else.example.com"])]]);
    assert.deepEqual([...keysSentTo(cfg({ ...provider, apiKey: "" }, agent, null))], [], "no key, a coding agent's environment and no upstream hold none that is sent");
    const was = cfg(provider, agent);
    for (const [what, now, press] of /** @type {[string, any, boolean][]} */ ([
      ["as it was", cfg(provider, agent), false],
      ["a path on the same host", cfg({ ...provider, baseUrl: "https://API.example.com/other" }, agent), false],
      ["another port", cfg({ ...provider, baseUrl: "https://api.example.com:8443/v1" }, agent), true],
      ["another scheme", cfg({ ...provider, baseUrl: "http://api.example.com/v1" }, agent), true],
      ["another host", cfg({ ...provider, baseUrl: "https://else.example.com/v1" }, agent), true],
      ["its models read from another host", cfg({ ...provider, modelsPath: "https://else.example.com/models" }, agent), true],
      ["its models read from a path of its own host", cfg({ ...provider, modelsPath: "/models" }, agent), false],
      ["another host with a key typed anew", cfg({ ...provider, baseUrl: "https://else.example.com/v1", apiKey: "k-2" }, agent), false],
      ["another host, the key taken away", cfg({ ...provider, baseUrl: "https://else.example.com/v1", apiKey: "" }, agent), false],
      ["a new upstream with a key of its own", cfg(provider, agent, { id: "n", type: "openai", baseUrl: "https://else.example.com", apiKey: "k-2" }), false],
      ["a new upstream that holds the kept key, elsewhere", cfg(provider, agent, { id: "n", type: "anthropic", baseUrl: "https://else.example.com", apiKey: "k-1" }), true],
      ["the kept one under a new id, where it was", cfg({ ...provider, id: "renamed" }, agent), false],
      ["the kept one under a new id, elsewhere", cfg({ ...provider, id: "renamed", baseUrl: "https://else.example.com" }, agent), true],
      ["the upstream gone", cfg(agent), false],
    ]))
      assert.equal(configAsksLess(was, now), press, what);
  });

  // (fails before: yes — the judgement stood in the Memory page's two rows alone, and the chat's words were not weighed)
  test("`allowsAlways` and `memAsksLess`: an always-allow confirmed, or given new words, by its row or by the chat's words", () => {
    const offer = { kind: "permission", text: "bash: npm test" };
    assert.equal(allowsAlways(offer, { confirm: true }), true);
    assert.equal(allowsAlways(offer, { text: "bash: mkdir" }), true);
    assert.equal(allowsAlways(offer, { text: "  " }), false, "no words retire it");
    assert.equal(allowsAlways({ kind: "fact" }, { confirm: true }), false);
    assert.equal(allowsAlways({ error: "no such memory" }, { confirm: true }), false);
    assert.equal(allowsAlways(null, { confirm: true }), false);
    /** @type {any[]} */
    const asked = [];
    const memory = { scope: (/** @type {any} */ o) => ({ claim: (/** @type {string} */ id) => (asked.push([o.role, id]), id === "i1" ? offer : id === "i2" ? { kind: "fact" } : { error: "no such memory" }) }) };
    for (const [verb, arg, more, press] of /** @type {[string, string, string, boolean][]} */ ([
      ["confirm", "i1", "", true],
      ["confirm", "i1 and words after", "", true],
      ["correct", "i1 bash: mkdir", "", true],
      ["correct", "i1", "bash: mkdir", true],
      ["correct", "i1", "", false],
      ["confirm", "i2", "", false],
      ["correct", "i2 the build runs on node 22", "", false],
      ["confirm", "i9", "", false],
      ["confirm", "", "", false],
      ["forget", "i1", "", false],
      ["accept", "i1", "", false],
    ]))
      assert.equal(memAsksLess(memory, { verb, arg, ...(more ? { more } : {}) }), press, `@mem ${verb} ${arg}${more ? ` ⏎ ${more}` : ""}`);
    assert.deepEqual(asked[0], ["person", "i1"], "read as the person's own");
    const closed = { scope: () => { throw new Error("memory is closed"); } };
    assert.equal(memAsksLess(closed, { verb: "confirm", arg: "i1" }), false, "memory closed makes none");
  });

  // (fails before: yes — there was no such rule: a Space's reach was written as its body said)
  test("`reachWidens`: a folder the kept list neither names nor has under it widens; the same, fewer and one inside do not", () => {
    for (const [what, list, have, o, widens] of /** @type {[string, string[], string[], { foldCase?: boolean }, boolean][]} */ ([
      ["the same list", ["/work/a", "/work/b"], ["/work/a", "/work/b"], {}, false],
      ["fewer", ["/work/a"], ["/work/a", "/work/b"], {}, false],
      ["none", [], ["/work/a"], {}, false],
      ["one inside a kept one", ["/work/a/deep"], ["/work/a"], {}, false],
      ["a trailing slash, the other separator", ["C:\\work\\a\\"], ["C:/work/a"], {}, false],
      ["one more", ["/work/a", "/work/c"], ["/work/a"], {}, true],
      ["the folder over a kept one", ["/work"], ["/work/a"], {}, true],
      ["a name that begins as a kept one", ["/work/ab"], ["/work/a"], {}, true],
      ["one that climbs out of a kept one", ["/work/a/../c"], ["/work/a"], {}, true],
      ["any folder of a drive kept whole", ["C:/Users/me"], ["C:\\"], {}, false],
      ["another drive", ["D:/x"], ["C:\\"], {}, true],
      ["any folder under the root kept whole", ["/home/me"], ["/"], {}, false],
      ["another case, where case tells folders apart", ["/Work/A"], ["/work/a"], {}, true],
      ["another case, where it does not", ["C:/Work/A"], ["c:/work/a"], { foldCase: true }, false],
      ["anything where nothing was kept", ["/work/a"], [], {}, true],
    ]))
      assert.equal(reachWidens(list, have, o), widens, what);
  });

  // (fails before: yes — there was no such rule: the team's row weighed its check alone)
  test("`writesMore` and `checksUnasked`: a team that changes files where the kept one changed none, or seats a card it did not", () => {
    const hunters = { lead: "huntlead", members: [{ tag: "reviewer" }, { tag: "reviewer" }], readOnly: true };
    const builders = { lead: "buildlead", members: [{ tag: "builder" }, { tag: "reviewer" }] };
    for (const [what, was, now, more] of /** @type {[string, any, any, boolean][]} */ ([
      ["read-only taken off", hunters, { ...hunters, readOnly: false }, true],
      ["read-only left out", hunters, { lead: hunters.lead, members: hunters.members }, true],
      ["a read-only team, other cards", hunters, { ...hunters, lead: "buildlead", members: [{ tag: "builder" }] }, false],
      ["made read-only", builders, { ...builders, readOnly: true }, false],
      ["one that builds, as it was", builders, structuredClone(builders), false],
      ["one that builds, fewer of its cards", builders, { ...builders, members: [{ tag: "builder" }] }, false],
      ["one that builds, a card more", builders, { ...builders, members: [...builders.members, { tag: "asked" }] }, true],
      ["one that builds, another lead", builders, { ...builders, lead: "huntlead" }, true],
      ["one that builds, its lead seated as a worker", builders, { ...builders, members: [{ tag: "buildlead" }] }, false],
      ["a new one that builds", null, builders, true],
      ["a new one that reads only", null, hunters, false],
    ]))
      assert.equal(writesMore(was, now), more, what);
    assert.deepEqual([checksUnasked({ check: "npm test" }), checksUnasked({ check: "  " }), checksUnasked({ check: null }), checksUnasked({ from: "builders", name: "Mine" }), checksUnasked(null)], [true, false, false, false, false]);
  });
});

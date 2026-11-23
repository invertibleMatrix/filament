// @ts-check
// The desktop app's press key (the security review's DESK-1, xd-key): any program on this computer reaches the admin API
// with no secret — the model's own background shell among them —, and a local caller is full admin, so it could answer
// the asks the person is shown. While the app holds a key, this computer's press carries it (x-filament-press, sent by
// the app's harness page alone), or is refused in words and the ask waits on: a chat's own permission, a sub-agent's,
// a coding agent's question, a command run for another machine's agents, a call's Always allow, and a chat's turn that
// is a press. A paired device presses as the gate lets it, over the network or an SSH tunnel's loopback. With no key —
// a plain browser, a server, the CLI — every press is as it was. The key reaches no answer, environment, record or log.
// Through a real Filament, a fake provider that asks for a command or nothing, and the fake ACP agent.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { EventEmitter } from "node:events";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, parseSse, startApp } from "./helpers/app.js";
import { until } from "./helpers/wait.js";
import { PassThrough } from "node:stream";
import { ADMIN_PRESS_REFUSED, PRESS_HEADER, TAILNET_PRESS_REFUSED, hearPressKey, pressRefusal, setPressKey } from "../src/http/guards.js";
import { createDevices } from "../src/services/devices.js";
import { safeEnv } from "../src/adapters/tools/hands.js";
import { agentEnv } from "../src/adapters/agents/agent-process.js";
import { runCli } from "../src/cli/main.js";
import { EXIT } from "../src/cli/client.js";
import { consolePage } from "../desktop/lib/browser-host.js";
import { OWNER_HEADER, ownerKeyOf } from "../src/services/owner.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const FAR = { "x-forwarded-for": "100.101.102.103" };
const REFUSED = /Filament app/;

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** A message's words. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** What a tool's result said. @param {any} r */
const resultWords = (r) => (typeof r?.content === "string" ? r.content : (r?.content || []).map((/** @type {any} */ b) => b?.text ?? "").join(""));

/**
 * The model behind the chats: `WRITE <file>` asks to write the file with a command, `MKDIR <name>` to make the folder
 * with one an Always allow can cover (`mkdir`: permissions.js `permissionShape`); the call after a result says `DONE: `
 * and it. @param {any} call
 */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const last = call.body.messages.at(-1);
  const result = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ c) => c?.type === "tool_result") : null;
  if (result) return reply([{ type: "text", text: `DONE: ${resultWords(result)}` }]);
  if (wordsOf(last).includes("QUESTION")) return reply([toolUse("q1", "ask", { question: "Which one?" })], "tool_use");
  const file = wordsOf(last).match(/WRITE (\S+)/)?.[1];
  if (file) return reply([toolUse("c1", "bash", { command: `node -e "require('fs').writeFileSync('${file}','1')"` })], "tool_use");
  const folder = wordsOf(last).match(/MKDIR (\S+)/)?.[1];
  if (folder) return reply([toolUse("c2", "bash", { command: `mkdir ${folder}` })], "tool_use");
  return reply([{ type: "text", text: "MODEL ANSWER" }]);
};

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
 * A device paired from this machine — from the app's Settings › Remote access, whose writes carry the key — and claimed
 * by another machine's page: its headers there.
 * @param {number} port @param {"full" | "view"} scope
 */
const paired = async (port, scope) => {
  const own = { origin: `http://127.0.0.1:${port}` };
  const pair = await ask(port, "/api/remote/pair", { method: "POST", headers: PRESS, body: { scope } });
  assert.equal(pair.status, 200, pair.text);
  const claimed = await ask(port, "/api/remote/claim", { method: "POST", headers: { ...FAR, ...own }, body: { code: pair.json.code, name: `a ${scope} device` } });
  assert.equal(claimed.status, 200, claimed.text);
  return { far: { ...FAR, ...own, cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] }, cookie: String(claimed.headers["set-cookie"]?.[0] || "").split(";")[0] };
};

/** A request of this computer's, by its headers. @param {any} req */
const local = (req) => /** @type {any} */ ({ headers: req, socket: { remoteAddress: "127.0.0.1" } });

/**
 * A terminal a person answers at: each question, as it waits at the end of what was written, gets `answer(question,
 * screen)` — "" where that says nothing.
 * @param {(q: string, screen: string) => string | undefined} answer
 */
const person = (answer) => {
  const input = /** @type {any} */ (new PassThrough());
  input.setRawMode = () => {};
  const output = new PassThrough();
  let screen = "";
  let at = 0;
  output.on("data", (c) => {
    screen += String(c);
    if (!/(\] |: )$/.test(screen.slice(at))) return;
    const q = screen.slice(at).split("\n").at(-1) || "";
    at = screen.length;
    const a = answer(q, screen) ?? "";
    setImmediate(() => input.write(`${a}\n`));
  });
  return { term: /** @type {any} */ ({ input, output, tty: true }), screen: () => screen };
};
/** The number the screen's last list gives an answer, by its label. @param {string} screen @param {string} label */
const numberOf = (screen, label) => [...screen.matchAll(new RegExp(` {2}(\\d+)\\. ${label}\\n`, "g"))].at(-1)?.[1];

// (fails before: yes — guards.js held no key and heard none: hearPressKey and pressRefusal were not there)
test("the key the app hands over its utility process's port is the one this computer's presses carry: the first heard holds, and the port is heard no more", () => {
  try {
    const port = new EventEmitter();
    hearPressKey(port);
    assert.equal(port.listenerCount("message"), 1);
    port.emit("message", { data: { pressKey: "short" } });
    assert.equal(pressRefusal(local({}), { kind: "local" }), null, "a key too short to be the app's is none: nothing is asked yet");
    port.emit("message", { data: { pressKey: KEY } });
    assert.equal(port.listenerCount("message"), 0, "heard once");
    const later = new EventEmitter();
    hearPressKey(later);
    later.emit("message", { data: { pressKey: "y".repeat(KEY.length) } });
    assert.equal(pressRefusal(local({ [PRESS_HEADER]: KEY }), { kind: "local" }), null, "the first heard holds");
    assert.match(String(pressRefusal(local({}), { kind: "local" })), REFUSED, "this computer's press without it is refused, in words");
    assert.match(String(pressRefusal(local({ [PRESS_HEADER]: "x".repeat(KEY.length) }), { kind: "local" })), REFUSED, "another key is none");
    const sent = { [PRESS_HEADER]: KEY };
    assert.equal(pressRefusal(local(sent), { kind: "local" }), null);
    assert.equal(PRESS_HEADER in sent, false, "the key is taken out of the request as it is read: no route, record or log holds it");
    // A tailnet login presses nothing without the key: a program here reaches the tailnet's door over loopback and says
    // the login itself.
    assert.equal(pressRefusal(local({}), { kind: "tailnet", login: "me@x" }), TAILNET_PRESS_REFUSED, "tailnet: refused without the key, in its own words");
    assert.equal(pressRefusal(local({ [PRESS_HEADER]: KEY }), { kind: "tailnet", login: "me@x" }), null, "tailnet with the key presses");
    // The admin token presses nothing without the key: a program here reads it from the config, or sets it there, and
    // sends it as a proxy would (the fc-review's).
    assert.equal(pressRefusal(local({}), { kind: "admin" }), ADMIN_PRESS_REFUSED, "admin: refused without the key, in its own words");
    assert.equal(pressRefusal(local({ [PRESS_HEADER]: KEY }), { kind: "admin" }), null, "admin with the key presses");
    // Nothing a program Filament runs inherits holds it: the shell hands' environment, a coding agent's.
    for (const env of [safeEnv(), agentEnv().env]) {
      assert.ok(!JSON.stringify(env).includes(KEY));
      assert.deepEqual(Object.keys(env).filter((k) => /press/i.test(k)), []);
    }
    assert.ok(!Object.values(process.env).includes(KEY), "never this process's environment");
  } finally {
    setPressKey("");
  }
  assert.equal(pressRefusal(local({}), { kind: "local" }), null, "no key: every press as it was");
});

// (fails before: yes — the page sent no key: its writes carried no x-filament-press; and its read of the keys, a press
// since the re-read of 11-11, carried none either)
test("the harness page sends the app's key on its writes where its window's bridge gives one, and on its read of the keys, never on another read; a browser's page sends none", async () => {
  const g = /** @type {any} */ (globalThis);
  const was = { fetch: g.fetch, app: g.filamentApp };
  /** @type {{ method: string, url: string, headers: Record<string, string> }[]} */
  const seen = [];
  g.fetch = async (/** @type {any} */ url, /** @type {any} */ init = {}) => {
    seen.push({ method: String(init.method || "GET").toUpperCase(), url: String(url), headers: { ...(init.headers || {}) } });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    g.filamentApp = { pressKey: async () => KEY };
    const app = await import(`../src/ui/harness/lib/api.js?${"in-the-app"}`);
    await app.api("/sessions/c1/asks/r1/answer", { method: "POST", body: { allow: true } });
    await app.api("/sessions/c1/asks");
    await app.postTurn({ chainId: "c1", content: "go", allow: true, signal: new AbortController().signal, onEvent: () => {} });
    await app.api("/keys");
    assert.deepEqual(
      seen.map((s) => [s.method, s.url, s.headers[PRESS_HEADER] ?? null]),
      [
        ["POST", "/api/sessions/c1/asks/r1/answer", KEY],
        ["GET", "/api/sessions/c1/asks", null],
        ["POST", "/api/sessions/c1/turns", KEY],
        ["GET", "/api/keys", KEY],
      ],
    );
    assert.equal(seen[0].headers["x-filament-ui"], "1", "the client's own headers go with it");
    seen.length = 0;
    delete g.filamentApp;
    const browser = await import(`../src/ui/harness/lib/api.js?${"in-a-browser"}`);
    await browser.api("/sessions/c1/asks/r1/answer", { method: "POST", body: { allow: true } });
    await browser.postTurn({ chainId: "c1", content: "go", signal: new AbortController().signal, onEvent: () => {} });
    await browser.api("/keys");
    assert.deepEqual(seen.map((s) => s.headers[PRESS_HEADER] ?? null), [null, null, null]);
  } finally {
    g.fetch = was.fetch;
    if (was.app === undefined) delete g.filamentApp;
    else g.filamentApp = was.app;
  }
});

// (fails before: yes — the console sent no key, and its window had no bridge: a mode it raised in the app was refused;
// its read of the keys carried none, which the keys' row now asks for)
test("the console sends the app's key on its writes and its read of the keys where its window's bridge gives one, the app's bridge there hands over the key alone, and to Filament's console page alone", async () => {
  const g = /** @type {any} */ (globalThis);
  const was = { fetch: g.fetch, app: g.filamentApp };
  /** @type {[string, string | null][]} */
  const seen = [];
  g.fetch = async (/** @type {any} */ _url, /** @type {any} */ init = {}) => {
    seen.push([String(init.method || "GET").toUpperCase(), init.headers?.[PRESS_HEADER] ?? null]);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    g.filamentApp = { pressKey: async () => KEY };
    const console = await import(`../src/ui/lib/api.js?${"the-console"}`);
    await console.api("/config", { method: "PUT", body: {} });
    await console.api("/state");
    await console.api("/keys");
    assert.deepEqual(seen, [["PUT", KEY], ["GET", null], ["GET", KEY]]);
  } finally {
    g.fetch = was.fetch;
    if (was.app === undefined) delete g.filamentApp;
    else g.filamentApp = was.app;
  }
  const src = readFileSync(new URL("../desktop/dashboard-preload.cjs", import.meta.url), "utf8");
  /** @type {Record<string, any>} */
  const bridge = {};
  /** @type {any[]} */
  const invoked = [];
  const electron = {
    contextBridge: { exposeInMainWorld: (/** @type {string} */ k, /** @type {any} */ v) => void (bridge[k] = v) },
    ipcRenderer: { invoke: async (/** @type {string} */ ch, /** @type {any[]} */ ...a) => void invoked.push([ch, ...a]) },
  };
  vm.runInNewContext(src, { require: (/** @type {string} */ m) => (m === "electron" ? electron : null) });
  assert.deepEqual(Object.keys(bridge), ["filamentApp"]);
  assert.deepEqual(Object.keys(bridge.filamentApp), ["pressKey"], "the key alone");
  void bridge.filamentApp.pressKey("ignored");
  assert.deepEqual(invoked, [["filament:press-key"]]);
  const own = "http://127.0.0.1:20300";
  for (const at of ["/", "/ui/", "/ui/index.html#docs"]) assert.equal(consolePage(`${own}${at}`, own), true, at);
  for (const at of [`${own}/ui/harness.html`, `${own}/api/sessions/c1/visuals/v1`, `${own}/artifacts/a`, "http://art.localhost:20300/", "http://192.168.0.2:20300/ui/", "about:blank", ""])
    assert.equal(consolePage(at, own), false, at);
  const main = readFileSync(new URL("../desktop/main.js", import.meta.url), "utf8");
  assert.match(main, /ipcMain\.handle\("filament:press-key", \(e\) => \(paneOf\(e\) \|\| consoleOf\(e\) \? pressKey : null\)\);/);
  assert.match(main, /const consoleOf = \(e\) => !!BrowserWindow\.fromWebContents\(e\.sender\) && consolePage\(e\.senderFrame\?\.url, origin\);/);
  assert.match(main, /preload: join\(ROOT, "desktop", name === "harness" \? "harness-preload\.cjs" : "dashboard-preload\.cjs"\)/, "the dashboard window's bridge");
  assert.match(main, /!remote && consolePage\(url, origin\) \? \{ \.\.\.prefs, preload: join\(ROOT, "desktop", "dashboard-preload\.cjs"\) \} : prefs/, "the console opened from the harness");
});

// (fails before: yes — the store kept no mark of a pairing opened without the key, and a full device's token, or an agents'
// device's, pressed for this computer's caller)
test("a device paired from a code a program here opened without the key is kept so, across a restart, and so is the agents' device it mints: neither presses while the app holds a key, as a caller of its own or through this computer's", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-pressless-"));
  try {
    const devices = createDevices({ dataDir: dir });
    const keyless = devices.claim(devices.startPairing({ scope: "full", pressless: true }).code, { name: "By a program" });
    const keyed = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "By the app" });
    assert.ok(keyless.ok && keyed.ok);
    const minted = devices.mintAgents(keyless.device.id);
    assert.ok(minted.ok);
    const back = createDevices({ dataDir: dir });
    assert.deepEqual([back.get(keyless.device.id)?.pressless, back.get(minted.device.id)?.pressless, back.get(keyed.device.id)?.pressless], [true, true, undefined]);
    setPressKey(KEY);
    /** @param {string} token */
    const bearer = (token) => ({ authorization: `Bearer ${token}` });
    for (const [what, token] of [["the keyless device", keyless.token], ["its agents' device", minted.token]]) {
      const device = /** @type {any} */ (back.verify(token));
      assert.match(String(pressRefusal(local({}), { kind: "device", device, scope: device.scope }, back)), /a device paired without its key presses nothing/, `${what}, as its own caller`);
      assert.match(String(pressRefusal(local(bearer(token)), { kind: "local" }, back)), REFUSED, `${what}, through this computer`);
    }
    const app = /** @type {any} */ (back.verify(keyed.token));
    assert.equal(pressRefusal(local({}), { kind: "device", device: app, scope: "full" }, back), null, "the app's device, as its own caller");
    assert.equal(pressRefusal(local(bearer(keyed.token)), { kind: "local" }, back), null, "the app's device, through a tunnel's loopback");
    const agentsOfApp = back.mintAgents(keyed.device.id);
    assert.ok(agentsOfApp.ok);
    assert.match(String(pressRefusal(local(bearer(agentsOfApp.token)), { kind: "local" }, back)), REFUSED, "an agents' device presses through this computer never");
  } finally {
    setPressKey("");
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("the press key, on one Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-press-key-"));
  /**
   * A full device a program here paired without the key while the app held one, before a pairing needed the key
   * (x-sec-loopback.test.js): kept in the data folder the Filament starts from, its token.
   */
  let keylessToken = "";
  /** @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o] */
  const call = (path, o) => ask(shim.port, path, o);
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A new chat of this computer's, its id. @param {Record<string, unknown>} [o] @param {Record<string, string>} [headers] */
  const create = async (o = {}, headers = {}) => {
    const r = await call("/api/sessions", { method: "POST", headers, body: { cwd: root, model: "agent/brain-model", preset: "plain", ...o } });
    assert.equal(r.status, 200, r.text);
    return String(r.json.id);
  };
  /** A turn whose reply comes whole. @param {string} id @param {string} content @param {Record<string, string>} [headers] */
  const turn = async (id, content, headers = {}) => {
    const r = await call(`${S(id)}/turns`, { method: "POST", headers, body: { content, stream: false } });
    assert.equal(r.status, 200, r.text);
    return { runId: String(r.headers["x-filament-request-id"]), reply: r.json };
  };
  /** The asks the chat waits on. @param {string} id @returns {Promise<any[]>} */
  const asks = async (id) => {
    const r = await call(`${S(id)}/asks`);
    assert.equal(r.status, 200, r.text);
    return r.json.asks;
  };
  /** A press refused in words, the press marked so a client can tell. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const refused = (r, what) => {
    assert.equal(r.status, 403, `${what}: ${r.text}`);
    assert.match(String(r.json?.error), REFUSED, what);
    assert.equal(r.json?.press, true, what);
  };

  before(async () => {
    up = await fakeUpstream(brain);
    const dataDir = mkdtempSync(join(tmpdir(), "filament-press-key-data-"));
    const kept = createDevices({ dataDir });
    const got = kept.claim(kept.startPairing({ scope: "full", pressless: true }).code, { name: "a keyless device" });
    assert.ok(got.ok);
    keylessToken = got.token;
    shim = await startApp({
      dataDir,
      configure: (cfg) => {
        cfg.upstreams = [
          { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
          { id: "coder", name: "coder", type: "acp", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], env: {}, cwdDefault: root, permissions: "allow-all", hints: false } },
        ];
        cfg.routes = [
          { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
          { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
        ];
        cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [root], readerModel: "" };
        // Where a backup of memory is written on the person's word: none is made by the clock.
        cfg.memory = { ...cfg.memory, backups: { ...cfg.memory?.backups, enabled: false, folder: join(dataDir, "press-backups") } };
      },
    });
    setPressKey(KEY);
  });
  after(async () => {
    setPressKey("");
    await shim.stop();
    await up.close();
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — a program on this computer answered the chat's permission with no key, and its turn's Allow ran it)
  test("a chat's own permission: this computer's press without the key is refused in words and the ask waits on — by the asks route, a turn's Allow or Deny, its permission switch, another key —; with it, Allow runs the call", async () => {
    const id = await create();
    const t = await turn(id, "WRITE own.txt");
    const [waiting] = await asks(id);
    assert.equal(waiting.id, t.runId);
    for (const body of [{ allow: true }, { choice: "allow" }, { allow: false, words: "no" }]) refused(await call(`${S(id)}/asks/${encodeURIComponent(waiting.id)}/answer`, { method: "POST", body }), JSON.stringify(body));
    refused(await call(`${S(id)}/asks/${encodeURIComponent(waiting.id)}/answer`, { method: "POST", headers: { [PRESS_HEADER]: "x".repeat(KEY.length) }, body: { allow: true } }), "another key");
    for (const body of [{ content: "yes", allow: true, stream: false }, { content: "no", allow: false, stream: false }, { content: "go on", modeSwitch: true, stream: false }])
      refused(await call(`${S(id)}/turns`, { method: "POST", body }), `a turn ${JSON.stringify(body)}`);
    assert.deepEqual((await asks(id)).map((a) => a.id), [waiting.id], "the ask waits on");
    assert.equal(existsSync(join(root, "own.txt")), false);
    const yes = await call(`${S(id)}/asks/${encodeURIComponent(waiting.id)}/answer`, { method: "POST", headers: PRESS, body: { allow: true } });
    assert.equal(yes.status, 200, yes.text);
    assert.match(wordsOf(yes.json), /^DONE: /, "the turn went on: its reply is the answer's");
    assert.equal(existsSync(join(root, "own.txt")), true);
  });

  // (fails before: yes — a program here typed /allow into the chat and the call it waited on ran)
  test("a program on this computer that types /allow into a chat without the key answers its waiting call as words do: Not run", async () => {
    const id = await create();
    await turn(id, "WRITE typed.txt");
    const t = await turn(id, "/allow");
    assert.match(wordsOf(t.reply), /^DONE: Not run/, wordsOf(t.reply));
    assert.equal(existsSync(join(root, "typed.txt")), false);
  });

  // (fails before: yes — the sub-agent's call was answered by a program here, through its own route or the asks route)
  test("a sub-agent's call: refused without the key by its own route and the asks route, still waiting; its own route with the key runs it", async () => {
    const id = await create();
    const spawn = await call(`${S(id)}/subagents`, { method: "POST", body: { prompt: "WRITE sub.txt", description: "Write the file" } });
    assert.equal(spawn.status, 200, spawn.text);
    const sid = String(spawn.json.subagent.id);
    const waiting = await until(async () => (await asks(id)).find((x) => x.from === sid) || null, "the sub-agent's call to wait", { timeoutMs: 20_000 });
    refused(await call(`${S(id)}/subagents/${sid}/answer`, { method: "POST", body: { answer: "yes", allow: true, ask: 1 } }), "its own route");
    refused(await call(`${S(id)}/subagents/${sid}/answer`, { method: "POST", body: { answer: "now", modeSwitch: true } }), "its permission switch");
    refused(await call(`${S(id)}/asks/${encodeURIComponent(waiting.id)}/answer`, { method: "POST", body: { allow: true } }), "the asks route");
    assert.ok((await asks(id)).some((x) => x.id === waiting.id), "it waits on");
    assert.equal(existsSync(join(root, "sub.txt")), false);
    const yes = await call(`${S(id)}/subagents/${sid}/answer`, { method: "POST", headers: PRESS, body: { answer: "yes", allow: true, ask: 1 } });
    assert.equal(yes.status, 200, yes.text);
    await until(() => existsSync(join(root, "sub.txt")), "the sub-agent's call to run", { timeoutMs: 20_000 });
  });

  // (fails before: yes — a coding agent's question was answered through its run's route by a program here)
  test("a coding agent's question: its run's route refuses it without the key, and it waits on; with the key it is answered and the turn goes on", async () => {
    const id = await create({ model: "coder/fake-a" });
    const res = await fetch(`${shim.url}${S(id)}/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "~link", stream: true }) });
    assert.equal(res.status, 200);
    const runId = String(res.headers.get("x-filament-request-id"));
    await until(async () => (await asks(id)).find((x) => x.from === "coding-agent") || null, "the coding agent's question", { timeoutMs: 20_000 });
    refused(await call(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", body: { ask: "q1", outcome: "declined" } }), "the run's route");
    assert.ok((await asks(id)).some((x) => x.from === "coding-agent"), "it waits on");
    const yes = await call(`/api/runs/${encodeURIComponent(runId)}/answer`, { method: "POST", headers: PRESS, body: { ask: "q1", outcome: "declined" } });
    assert.equal(yes.status, 200, yes.text);
    let said = "";
    for (const { data } of parseSse(await res.text())) if (data?.type === "content_block_delta") said += data.delta?.text ?? "";
    assert.match(said, /link: decline/);
  });

  // (fails before: yes — a program here answered a command another machine's agents asked to run, and added an Always allow)
  test("a command run for another machine's agents, and a call's Always allow: refused without the key before anything is read; with it, the rows answer as they do", async () => {
    refused(await call("/api/exec/ex_none/answer", { method: "POST", body: { allow: true } }), "the exec's answer");
    assert.equal((await call("/api/exec/ex_none/answer", { method: "POST", headers: PRESS, body: { allow: true } })).status, 404);
    const id = await create();
    refused(await call(`${S(id)}/rules/always`, { method: "POST", body: { tool: "bash", shape: "rm" } }), "Always allow");
    const always = await call(`${S(id)}/rules/always`, { method: "POST", headers: PRESS, body: { tool: "bash", shape: "rm" } });
    assert.equal(always.status, 200, always.text);
  });

  // (fails before: yes — a view device's cookie sent here pressed, as any program here did; that a full device presses
  // with no key, from elsewhere or through a tunnel, it guards)
  test("a paired device presses with no key, over the network and through an SSH tunnel's loopback; a view device's cookie here is no press", async () => {
    const full = await paired(shim.port, "full");
    const id = await create({}, full.far);
    await turn(id, "WRITE far.txt", full.far);
    const [first] = await asks(id);
    const yes = await call(`${S(id)}/asks/${encodeURIComponent(first.id)}/answer`, { method: "POST", headers: full.far, body: { allow: true } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(existsSync(join(root, "far.txt")), true);
    const view = await paired(shim.port, "view");
    const there = await create();
    await turn(there, "WRITE tunnel.txt");
    const [second] = await asks(there);
    refused(await call(`${S(there)}/asks/${encodeURIComponent(second.id)}/answer`, { method: "POST", headers: { cookie: view.cookie }, body: { allow: true } }), "a view device's cookie");
    const tunnel = await call(`${S(there)}/asks/${encodeURIComponent(second.id)}/answer`, { method: "POST", headers: { cookie: full.cookie }, body: { allow: true } });
    assert.equal(tunnel.status, 200, tunnel.text);
    assert.equal(existsSync(join(root, "tunnel.txt")), true);
  });

  // (fails before: yes — a device a program here paired with no key, its code opened without it and claimed, answered the
  // chat's ask: through a tunnel's loopback, as a full device's token was let press there, and from the network's side.
  // Such a code is opened no more (x-sec-loopback.test.js): this one's device was kept from before.)
  test("a device a program here paired without the key presses nowhere — through a tunnel's loopback, from the network —, told to pair it again from the app; one the app paired presses", async () => {
    const cookie = `filament_device=${keylessToken}`;
    const keyless = { cookie, far: { ...FAR, origin: `http://127.0.0.1:${shim.port}`, cookie } };
    const id = await create();
    await turn(id, "WRITE keyless.txt");
    const [waiting] = await asks(id);
    for (const [how, headers] of /** @type {[string, Record<string, string>][]} */ ([["its cookie over loopback", { cookie: keyless.cookie }], ["from the network", keyless.far]])) {
      const r = await call(`${S(id)}/asks/${encodeURIComponent(waiting.id)}/answer`, { method: "POST", headers, body: { allow: true } });
      refused(r, how);
      assert.match(String(r.json.error), /a device paired without its key presses nothing/, how);
      assert.match(String(r.json.error), /Pair it again from there, in the Filament app/, how);
    }
    assert.deepEqual((await asks(id)).map((a) => a.id), [waiting.id], "the ask waits on");
    assert.equal(existsSync(join(root, "keyless.txt")), false);
    const keyed = await paired(shim.port, "full");
    const yes = await call(`${S(id)}/asks/${encodeURIComponent(waiting.id)}/answer`, { method: "POST", headers: { cookie: keyed.cookie }, body: { allow: true } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(existsSync(join(root, "keyless.txt")), true);
  });

  // (fails before: yes — a program here sent the question's answer as a turn's words with no key, and the turn went on with it)
  test("a question the chat waits on: a turn's words without the key are refused and it waits on; with the key they answer it", async () => {
    const id = await create();
    const t = await turn(id, "QUESTION");
    const [waiting] = await asks(id);
    assert.equal(waiting?.id, t.runId, JSON.stringify(waiting));
    refused(await call(`${S(id)}/turns`, { method: "POST", body: { content: "The first", stream: false } }), "words without the key");
    assert.deepEqual((await asks(id)).map((a) => a.id), [waiting.id], "the question waits on");
    const yes = await call(`${S(id)}/turns`, { method: "POST", headers: PRESS, body: { content: "The first", stream: false } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(wordsOf(yes.json), "DONE: The first");
  });

  // (fails before: yes — a turn naming Auto with no key ran, and its command ran unasked)
  test("a turn that names the mode it runs in is a press: refused without the key, nothing run; with it, it runs so", async () => {
    const id = await create();
    refused(await call(`${S(id)}/turns`, { method: "POST", body: { content: "WRITE auto.txt", permissions: "auto", stream: false } }), "a turn in Auto");
    assert.equal(existsSync(join(root, "auto.txt")), false);
    assert.deepEqual(await asks(id), [], "nothing ran to ask");
    const yes = await call(`${S(id)}/turns`, { method: "POST", headers: PRESS, body: { content: "WRITE auto.txt", permissions: "auto", stream: false } });
    assert.equal(yes.status, 200, yes.text);
    assert.match(wordsOf(yes.json), /^DONE: /);
    assert.equal(existsSync(join(root, "auto.txt")), true);
  });

  // (fails before: yes — a program on this computer set a chat, your defaults, a project or the config to Auto, or let
  // every command run, with no key: the swarm's review of 11-10)
  test("a settings write that lets the agent do more unasked is a press: the mode, a rule, the commands refused, the second look, the folders, a coding agent's mode in its model's name, for a chat, a new one, a fork, a turn, /set, your defaults, a project, the config, and a permission confirmed in Memory; one that asks more is not", async () => {
    const id = await create();
    const { projectId } = (await call(`${S(id)}/settings`)).json;
    assert.ok(projectId, "the chat is in a project");
    const auto = { loop: { permissions: "auto" } };
    /** @type {[string, string, any][]} */
    const rows = [
      [`${S(id)}/settings`, "PATCH", { patch: auto }],
      [`${S(id)}/settings`, "PATCH", auto],
      [`${S(id)}/settings`, "PATCH", { patch: { "loop.rules": [{ tool: "bash", pattern: "*", verdict: "allow" }] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { loop: { secondLook: false } } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "privacy.bashDeny": [] } }],
      [`${S(id)}/settings`, "PATCH", { unset: ["loop.permissions"] }],
      [`${S(id)}/settings`, "PATCH", { patch: { loop: null } }],
      [`${S(id)}/settings`, "PATCH", { patch: { "loop.addedFolders": [tmpdir()] } }],
      [`${S(id)}/settings`, "PATCH", { patch: { model: { name: "coder/agent@bypassPermissions" } } }],
      [`${S(id)}/rules/forget`, "POST", { tool: "bash", pattern: "rm *", verdict: "deny" }],
      ["/api/defaults/settings", "PATCH", { patch: auto }],
      [`/api/projects/${encodeURIComponent(projectId)}/settings`, "POST", { patch: { loop: { rules: [{ tool: "*", pattern: "*", verdict: "allow" }] } } }],
      [`/api/projects/${encodeURIComponent(projectId)}/rules/forget`, "POST", { tool: "bash", pattern: "rm *" }],
      ["/api/sessions", "POST", { cwd: root, model: "agent/brain-model", preset: "plain", settings: auto }],
      ["/api/sessions", "POST", { cwd: root, model: "coder/agent@bypassPermissions", preset: "plain" }],
      [`${S(id)}/fork`, "POST", { settings: auto }],
      [`${S(id)}/replay-compare`, "POST", { settings: auto }],
      [`${S(id)}/turns`, "POST", { content: "hello", settingsPatch: auto, stream: false }],
      [`${S(id)}/turns`, "POST", { content: "/set loop.permissions auto", stream: false }],
      [`${S(id)}/turns`, "POST", { content: "/unset loop.rules", stream: false }],
      [`${S(id)}/turns`, "POST", { content: "/set model.name coder/agent@bypassPermissions", stream: false }],
      ["/api/config/fields", "PATCH", { set: { "agentLoop.permissions": "auto" } }],
    ];
    for (const [path, method, body] of rows) refused(await call(path, { method, body }), `${method} ${path} ${JSON.stringify(body)}`);
    const state = (await call("/api/state")).json;
    const whole = structuredClone(state.config);
    whole.agentLoop.permissions = "auto";
    refused(await call("/api/config", { method: "PUT", body: whole }), "PUT /config in Auto");
    const defaults = structuredClone(state.config);
    defaults.sessions = { ...defaults.sessions, defaults: auto };
    refused(await call("/api/config", { method: "PUT", body: defaults }), "PUT /config with your defaults in Auto");
    const agentMode = structuredClone(state.config);
    agentMode.upstreams.find((/** @type {any} */ u) => u.id === "coder").acp.mode = "bypassPermissions";
    refused(await call("/api/config", { method: "PUT", body: agentMode }), "PUT /config with a coding agent's own mode");
    const archive = shim.app.memory.archive;
    assert.ok(archive, "memory's archive is open");
    const offer = archive.items.add({ projectId, chainId: id, kind: "permission", text: "bash: npm test", status: "inferred", importance: 0.8 });
    refused(await call(`/api/memory/items/${offer.id}`, { method: "POST", body: { status: "confirmed" } }), "an always-allow offer confirmed");
    const mirrored = () => call(`${S(id)}/settings`).then((r) => r.json.flat["loop.rules"].some((/** @type {any} */ x) => x.pattern === "npm test"));
    assert.equal(await mirrored(), false, "no rule mirrored");
    assert.equal((await call(`${S(id)}/settings`)).json.flat["loop.permissions"], "edit", "the chat's mode is as it was");
    assert.equal((await call("/api/state")).json.config.agentLoop.permissions, "edit", "the config's too");
    assert.equal((await call("/api/defaults/settings")).json.flat?.["loop.permissions"] ?? "edit", "edit", "your defaults' too");
    // Asking more needs no key, nor a write that names no such knob.
    for (const patch of [{ loop: { permissions: "ask" } }, { "loop.permissions": "read-only" }, { loop: { secondLook: true } }, { "model.effort": "high" }]) {
      const r = await call(`${S(id)}/settings`, { method: "PATCH", body: { patch } });
      assert.equal(r.status, 200, `${JSON.stringify(patch)}: ${r.text}`);
    }
    assert.equal((await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.permissions": "ask" } } })).status, 200, "the config asking more");
    // With the key each runs.
    const yes = await call(`${S(id)}/settings`, { method: "PATCH", headers: PRESS, body: { patch: auto } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal((await call(`${S(id)}/settings`)).json.flat["loop.permissions"], "auto");
    await turn(id, "/set loop.permissions ask");
    assert.equal((await call(`${S(id)}/settings`)).json.flat["loop.permissions"], "ask", "/set asking more, with no key");
    await turn(id, "/set loop.permissions auto", PRESS);
    assert.equal((await call(`${S(id)}/settings`)).json.flat["loop.permissions"], "auto", "/set with the key");
    const fields = await call("/api/config/fields", { method: "PATCH", headers: PRESS, body: { set: { "agentLoop.permissions": "edit" } } });
    assert.equal(fields.status, 200, fields.text);
    const confirmed = await call(`/api/memory/items/${offer.id}`, { method: "POST", headers: PRESS, body: { status: "confirmed" } });
    assert.equal(confirmed.status, 200, confirmed.text);
    assert.deepEqual(confirmed.json.rule, { tool: "bash", pattern: "npm test", verdict: "allow", learned: true });
    assert.equal(await mirrored(), true);
  });

  // (fails before: yes — the correct route asked for no key: an offer's words corrected there became a confirmed
  // permission in the caller's words, and the chat's next command of that shape ran with no ask)
  test("a permission's words corrected in Memory is a press: without the key no Always allow is made and the command still asks; retiring one needs no key; with the key the corrected one stands and runs unasked", async () => {
    const id = await create();
    const { projectId } = (await call(`${S(id)}/settings`)).json;
    const archive = shim.app.memory.archive;
    assert.ok(archive, "memory's archive is open");
    const confirmed = () => archive.items.list({ projectId, kind: "permission", status: "confirmed", limit: 500 }).map((/** @type {any} */ it) => it.text);
    const offer = archive.items.add({ projectId, chainId: id, kind: "permission", text: "bash: npm run lint", status: "inferred", importance: 0.8 });
    const r = await call(`/api/memory/items/${offer.id}/correct`, { method: "POST", body: { text: "bash: mkdir" } });
    await turn(id, "MKDIR made-unasked");
    assert.equal(existsSync(join(root, "made-unasked")), false, "the command ran with no ask, on a permission a program here wrote");
    assert.equal((await asks(id)).length, 1, "the command asks");
    refused(r, "a permission's words corrected");
    assert.ok(!confirmed().includes("bash: mkdir"), "no Always allow was made");
    // Nor is one remembered: a permission is no claim (brain.js `remember`).
    assert.equal((await call("/api/memory/remember", { method: "POST", body: { text: "bash: mkdir", kind: "permission", project: projectId } })).status, 400);
    assert.ok(!confirmed().includes("bash: mkdir"));
    // Taking one back asks less of nobody: no words, and it is retired.
    const other = archive.items.add({ projectId, chainId: id, kind: "permission", text: "bash: npm run build", status: "inferred", importance: 0.8 });
    const retired = await call(`/api/memory/items/${other.id}/correct`, { method: "POST", body: { text: "" } });
    assert.equal(retired.status, 200, retired.text);
    // A memory of another kind is corrected as before.
    const fact = archive.items.add({ projectId, chainId: id, kind: "fact", text: "the build runs on node 20", status: "confirmed", importance: 0.8 });
    const fixed = await call(`/api/memory/items/${fact.id}/correct`, { method: "POST", body: { text: "the build runs on node 22" } });
    assert.equal(fixed.status, 200, fixed.text);
    // With the key the words are corrected, and the permission they name stands.
    const yes = await call(`/api/memory/items/${offer.id}/correct`, { method: "POST", headers: PRESS, body: { text: "bash: mkdir" } });
    assert.equal(yes.status, 200, yes.text);
    assert.ok(confirmed().includes("bash: mkdir"), "the corrected permission is confirmed");
    const next = await create();
    await turn(next, "MKDIR made-pressed");
    assert.equal(existsSync(join(root, "made-pressed")), true, "it runs unasked, as the person pressed for");
  });

  // (fails before: yes — the config was read again from its file for any caller: a mode written there took force)
  test("the config read again from its file is a press: what a program here wrote there takes no force without the key", async () => {
    const file = join(shim.dataDir, "config.json");
    // The file as this Filament runs it: the port it listens on is its own (the test's file says 0 until a save).
    const kept = JSON.parse(readFileSync(file, "utf8"));
    kept.server = { ...kept.server, port: shim.port };
    const was = JSON.stringify(kept);
    const mode = async () => (await call("/api/state")).json.config.agentLoop.permissions;
    try {
      // A program here writes the mode into the file (the data folder is the person's account's): reading it in is the press.
      const onDisk = structuredClone(kept);
      onDisk.agentLoop = { ...onDisk.agentLoop, permissions: "auto" };
      writeFileSync(file, JSON.stringify(onDisk));
      const reload = await call("/api/config/reload", { method: "POST" });
      assert.equal(await mode(), "edit", "the config in force is as it was");
      refused(reload, "the config read again from its file");
      const pressed = await call("/api/config/reload", { method: "POST", headers: PRESS });
      assert.equal(pressed.status, 200, pressed.text);
      assert.equal(await mode(), "auto", "with the key the file is read in");
    } finally {
      writeFileSync(file, was);
      const back = await call("/api/config/reload", { method: "POST", headers: PRESS });
      assert.equal(back.status, 200, back.text);
    }
    assert.equal(await mode(), "edit");
  });

  // (fails before: yes — any caller on this computer read the keys in clear, made a new one, and set one of its own, or
  // the admin token, by the config's rows)
  test("the keys other apps call Filament with are read, replaced and set with the app's key alone, and so is the admin token", async () => {
    // No answer is printed here: a key stays out of the test's output too.
    const masked = async () => ((await call("/api/state")).json.config.server.inboundKeysMasked || []).length;
    const count = await masked();
    const read = await call("/api/keys");
    assert.equal(read.status, 403, "the keys read without the app's key");
    assert.equal(read.json?.press, true);
    assert.equal(read.json?.keys, undefined, "no key is handed out");
    const rotate = await call("/api/keys/rotate", { method: "POST" });
    assert.equal(rotate.status, 403, "a key made without the app's key");
    assert.equal(rotate.json?.press, true);
    assert.equal(await masked(), count, "the keys are as they were");
    const made = await call("/api/keys/rotate", { method: "POST", headers: PRESS });
    assert.equal(made.status, 200);
    assert.equal(await masked(), Math.min(5, count + 1), "with the key one is made");
    const keys = await call("/api/keys", { headers: PRESS });
    assert.equal(keys.status, 200);
    assert.ok(typeof made.json.key === "string" && keys.json.keys[0] === made.json.key, "and read");
    // A key its caller sets by saving the config is one it holds, and the admin token lets in from elsewhere: the same
    // press. The config's fields set neither, whoever asks.
    const kept = await masked();
    const token = `press-test-${randomBytes(16).toString("hex")}`;
    assert.equal((await call("/api/config/fields", { method: "PATCH", headers: PRESS, body: { set: { "server.adminToken": token } } })).status, 400, "credentials are not set by a field");
    const planted = structuredClone((await call("/api/state")).json.config);
    planted.server.inboundKeys = [...(planted.server.inboundKeys || []), `sk-press-${randomBytes(16).toString("hex")}`];
    const put = await call("/api/config", { method: "PUT", body: planted });
    assert.equal(put.status, 403, "an inbound key set without the app's key");
    assert.equal(put.json?.press, true);
    const tokened = structuredClone((await call("/api/state")).json.config);
    tokened.server.adminToken = token;
    const admin = await call("/api/config", { method: "PUT", body: tokened });
    assert.equal(admin.status, 403, "the admin token set without the app's key");
    assert.equal(admin.json?.press, true);
    assert.equal(await masked(), kept, "the keys are as they were");
    const same = await call("/api/config", { method: "PUT", body: (await call("/api/state")).json.config });
    assert.equal(same.status, 200, "a save that leaves them as they are needs no key");
    const set = await call("/api/config", { method: "PUT", headers: PRESS, body: planted });
    assert.equal(set.status, 200, "with the key the inbound key is set");
    assert.equal(await masked(), kept + 1);
  });

  // (fails before: yes — the config's rows weighed the mode and the rules, never the folders: one was added with no key)
  test("a folder added to where agents work is a press, by the config's fields and by the config whole, and so is the list emptied; a folder taken out is not", async () => {
    // One added, or the list emptied: no folder listed is any folder (turn.js `folderVerdict`).
    const more = mkdtempSync(join(tmpdir(), "filament-press-root-"));
    try {
      const roots = async () => (await call("/api/state")).json.config.agentLoop.roots;
      assert.deepEqual(await roots(), [root]);
      const added = await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.roots": [root, more] } } });
      const emptied = await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.roots": [] } } });
      const whole = structuredClone((await call("/api/state")).json.config);
      whole.agentLoop.roots = [root, more];
      const put = await call("/api/config", { method: "PUT", body: whole });
      assert.deepEqual(await roots(), [root], "the folders agents work in are as they were");
      refused(added, "a folder added by PATCH /config/fields");
      refused(emptied, "the folders emptied by PATCH /config/fields");
      refused(put, "a folder added by PUT /config");
      const yes = await call("/api/config/fields", { method: "PATCH", headers: PRESS, body: { set: { "agentLoop.roots": [root, more] } } });
      assert.equal(yes.status, 200, yes.text);
      assert.deepEqual(await roots(), [root, more], "with the key it is added");
      const less = await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.roots": [root] } } });
      assert.equal(less.status, 200, `a folder taken out needs no key: ${less.text}`);
      assert.deepEqual(await roots(), [root]);
    } finally {
      await call("/api/config/fields", { method: "PATCH", headers: PRESS, body: { set: { "agentLoop.roots": [root] } } });
      rmSync(more, { recursive: true, force: true });
    }
  });

  // A variable named in `agentLoop.envPass` reaches every command whatever its name or value says (hands.js `safeEnv`):
  // a caller that could name ANTHROPIC_API_KEY there would read it with its next command.
  // (fails before: yes — the setting was written with no key: 200, and the name listed)
  test("a variable named to be passed to commands is a press, by the config's fields and by the config whole; one taken out is not", async () => {
    const passed = async () => (await call("/api/state")).json.config.agentLoop.envPass ?? [];
    try {
      assert.deepEqual(await passed(), []);
      const added = await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.envPass": ["ANTHROPIC_API_KEY"] } } });
      const whole = structuredClone((await call("/api/state")).json.config);
      whole.agentLoop.envPass = ["ANTHROPIC_API_KEY"];
      const put = await call("/api/config", { method: "PUT", body: whole });
      assert.deepEqual(await passed(), [], "no variable is passed that was not");
      refused(added, "a variable named by PATCH /config/fields");
      refused(put, "a variable named by PUT /config");
      const yes = await call("/api/config/fields", { method: "PATCH", headers: PRESS, body: { set: { "agentLoop.envPass": ["HTTPS_PROXY", "LICENCE_FILE"] } } });
      assert.equal(yes.status, 200, yes.text);
      assert.deepEqual(await passed(), ["HTTPS_PROXY", "LICENCE_FILE"], "with the key they are named");
      const more = await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.envPass": ["HTTPS_PROXY", "LICENCE_FILE", "GITHUB_TOKEN"] } } });
      refused(more, "one more named beside those listed");
      const less = await call("/api/config/fields", { method: "PATCH", body: { set: { "agentLoop.envPass": ["LICENCE_FILE"] } } });
      assert.equal(less.status, 200, `a variable taken out needs no key: ${less.text}`);
      assert.deepEqual(await passed(), ["LICENCE_FILE"]);
    } finally {
      await call("/api/config/fields", { method: "PATCH", headers: PRESS, body: { set: { "agentLoop.envPass": [] } } });
    }
  });

  // (fails before: yes — a saved agent took the commands it runs without asking from any caller, and the skill crafter's
  // chat a model named with its coding agent's mode)
  test("the commands a saved agent runs without asking, and a crafter's chat on a model that names its coding agent's mode, are presses; an agent with none is saved as before", async () => {
    const card = { tag: "presser", name: "Presser", goodFor: "trying the press", may: "copy" };
    const runs = async () => (await call("/api/agents")).json.saved.find((/** @type {any} */ c) => c.tag === "presser")?.mayRun ?? null;
    const made = await call("/api/agents", { method: "POST", body: { ...card, mayRun: ["npm test"] } });
    assert.equal(await runs(), null, "no agent was saved with commands it runs unasked");
    refused(made, "a new agent that runs commands unasked");
    const plain = await call("/api/agents", { method: "POST", body: card });
    assert.equal(plain.status, 200, plain.text);
    const edit = await call("/api/agents/presser", { method: "PUT", body: { mayRun: ["npm test"] } });
    assert.deepEqual(await runs(), [], "its commands are as they were");
    refused(edit, "an agent's commands it runs unasked");
    assert.equal((await call("/api/agents/presser", { method: "PUT", body: { goodFor: "trying the press twice", mayRun: [] } })).status, 200, "another field, and none of them");
    const yes = await call("/api/agents/presser", { method: "PUT", headers: PRESS, body: { mayRun: ["npm test"] } });
    assert.equal(yes.status, 200, yes.text);
    assert.deepEqual(await runs(), ["npm test"]);
    assert.equal((await call("/api/agents/presser", { method: "DELETE" })).status, 200, "deleted with no key");
    refused(await call("/api/skills/craft", { method: "POST", body: { words: "a skill for releases", cwd: root, model: "coder/agent@bypassPermissions" } }), "a crafter's chat on a model that names a mode");
    const crafted = await call("/api/skills/craft", { method: "POST", body: { words: "a skill for releases", cwd: root, model: "agent/brain-model" } });
    assert.ok(!(crafted.status === 403 && crafted.json?.press), `a plain model is no press: ${crafted.text}`);
  });

  // (fails before: yes — a team fired beside a chat took its lead's model with its coding agent's mode from the fire's
  // body, and its chat ran in that mode: a chat's own model named so by no press)
  test("a team beside a chat on a lead's model that names its coding agent's mode is refused in words, key or not; on its main chat's own model, mode and all, it starts", async () => {
    const id = await create();
    const fire = (/** @type {string} */ chat, /** @type {any} */ body, headers = {}) => call(`${S(chat)}/beside`, { method: "POST", headers, body: { team: "bughunters", ask: "hunt in the login code", ...body } });
    const teamsOf = async (/** @type {string} */ chat) => (await call(`${S(chat)}/beside`)).json.teams;
    for (const headers of [{}, PRESS]) {
      const r = await fire(id, { model: "coder/agent@bypassPermissions" }, headers);
      for (const t of await teamsOf(id)) await call(`${S(id)}/beside/${encodeURIComponent(t.id)}/stop`, { method: "POST" });
      assert.equal(r.status, 400, r.text);
      assert.equal(r.json.error, "name its lead's model alone: a team beside a chat asks as that chat does, so its coding agent's mode (coder/agent@bypassPermissions) is not named");
    }
    assert.deepEqual(await teamsOf(id), [], "no team's chat was made");
    // The main chat's own model names the mode, by the person's press: its team's lead runs on the same.
    const named = await create({ model: "coder/agent@bypassPermissions" }, PRESS);
    const own = await fire(named, {});
    assert.equal(own.status, 200, own.text);
    assert.equal(own.json.team.on.lead, "coder/agent@bypassPermissions");
    await call(`${S(named)}/beside/${encodeURIComponent(own.json.team.id)}/stop`, { method: "POST" });
  });

  // (fails before: yes — memory was put back from any folder a caller named, with no key)
  test("memory put back from a backup is a press: refused without the key before the folder is read; with it the backup is put back", async () => {
    const backup = await call("/api/memory/backup", { method: "POST" });
    assert.equal(backup.status, 200, backup.text);
    const dir = shim.app.memory.listBackups()[0]?.dir;
    assert.ok(dir, "a backup was made");
    refused(await call("/api/memory/restore", { method: "POST", body: { dir } }), "memory put back from a backup");
    refused(await call("/api/memory/restore", { method: "POST", body: { dir: join(root, "no-backup-here") } }), "from a folder that holds none: refused before it is read");
    const yes = await call("/api/memory/restore", { method: "POST", headers: PRESS, body: { dir } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal((await call("/api/memory/items?limit=5")).status, 200, "memory answers again");
  });

  // (fails before: no — no answer held a header of the request's; it guards that none holds the key. That the key is
  // taken out of the request is the first test's.)
  test("the key is in no answer: the state, the settings, the config's changes, the keys, the requests' records of turns that carried it", async () => {
    // This computer's owner key with it (services/owner.js, s0a): carried by the same calls, held by no answer either.
    const OWN = ownerKeyOf(shim.dataDir);
    assert.match(OWN, /^fot_/);
    const both = { ...PRESS, [OWNER_HEADER]: OWN };
    const id = await create({}, both);
    await turn(id, "hello", both);
    for (const path of ["/api/state", "/api/config/changes", "/api/keys", "/api/defaults/settings", `${S(id)}/settings`, `${S(id)}`, "/api/requests?limit=50"]) {
      const r = await call(path, { headers: both });
      assert.equal(r.status, 200, `${path}: ${r.text}`);
      assert.ok(!r.text.includes(KEY), path);
      assert.ok(!JSON.stringify(r.headers).includes(KEY), `${path}: its headers`);
      assert.ok(!r.text.includes(OWN), `${path}: the owner key`);
      assert.ok(!JSON.stringify(r.headers).includes(OWN), `${path}: its headers, the owner key`);
    }
  });

  // (fails before: yes — `filament chat` at a terminal answered the chat's ask over loopback with no key, and the call ran)
  test("filament chat at a terminal while the app holds a key: its press is refused, it says to answer in the app, and the ask waits there", async () => {
    const id = await create();
    const p = person((q, screen) => (q === "Number: " ? numberOf(screen, "Allow") : undefined));
    /** @type {string[]} */
    const err = [];
    const code = await runCli(["chat", "--chat", id, "WRITE cli.txt"], { dataDir: shim.dataDir, term: p.term, out: () => {}, err: (s) => err.push(s), write: () => {} });
    assert.equal(code, EXIT.failed, `${p.screen()}\n${err.join("\n")}`);
    assert.match(p.screen(), /The agent asks \(ask [^)]+\): May I run this command\?/, "asked at the terminal, as it was");
    assert.match(err.join("\n"), /answer it in the app \(HTTP 403\)/);
    assert.equal(existsSync(join(root, "cli.txt")), false);
    assert.equal((await asks(id)).length, 1, "the ask waits for the app's window");
  });

  // (fails before: no — with no key nothing changed; it guards that it still does not)
  test("with no key — a browser, a server, the CLI —, this computer presses as before: the asks route, /allow typed, Always allow", async () => {
    setPressKey("");
    try {
      const id = await create();
      const t = await turn(id, "WRITE free.txt");
      const yes = await call(`${S(id)}/asks/${encodeURIComponent(t.runId)}/answer`, { method: "POST", body: { allow: true } });
      assert.equal(yes.status, 200, yes.text);
      assert.equal(existsSync(join(root, "free.txt")), true);
      const typed = await create();
      await turn(typed, "WRITE typed-free.txt");
      await turn(typed, "/allow");
      assert.equal(existsSync(join(root, "typed-free.txt")), true, "/allow typed runs it, as it did");
      assert.equal((await call("/api/exec/ex_none/answer", { method: "POST", body: { allow: true } })).status, 404);
      assert.equal((await call(`${S(id)}/rules/always`, { method: "POST", body: { tool: "bash", shape: "rm" } })).status, 200);
    } finally {
      setPressKey(KEY);
    }
  });
});

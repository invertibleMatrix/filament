// @ts-check
// A permission mode named past the weighers (the second read of r-doors' press, 11-12; the press key's own tests are
// x-sec-press-key.test.js's, what starts a program press-programs.test.js's). While the desktop app holds its key, a
// program on this computer without it makes no turn and no chat run in a mode that asks less — yet a turn took its mode
// from the request's own header, a new chat its coding agent's mode from a model sent as a list, every chat on a name
// the mode a route's upstream model gave it, a coding agent's changed program hid behind a second entry of its id, your
// defaults named a team over a list the person had emptied, and the model endpoints' key, a host name let in and the
// web hands' reach of this computer's own addresses were switched by any caller. Each is refused without the key, in
// words, and nothing is written or run; with the key each answers as it did; what narrows needs none; and with no key
// held — a plain browser, a server, the CLI — everything is as it was. The weighers by themselves first, then through
// a real Filament and a fake provider.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { randomBytes } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FAKE_ACP_AGENT, anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";
import { PRESS_HEADER, setPressKey } from "../src/http/guards.js";
import { asksLess, configAsksLess, namesMode } from "../src/services/session-settings.js";
import { normalizeConfig, validateConfig } from "../src/services/config/store.js";
import { runCli } from "../src/cli/main.js";
import { EXIT } from "../src/cli/client.js";

const KEY = randomBytes(32).toString("base64url");
const PRESS = { [PRESS_HEADER]: KEY };
const REFUSED = /Filament app/;
const MODE = "x-filament-permissions";

/**
 * A config as Filament keeps one, for the weighers: a provider, a coding agent, a route to each.
 * @param {(cfg: any) => void} [change] @returns {any}
 */
const cfgOf = (change = () => {}) => {
  const cfg = {
    upstreams: [
      { id: "m", name: "m", type: "anthropic", baseUrl: "https://api.example.invalid", apiKey: "s", enabled: true },
      { id: "coder", name: "coder", type: "acp", acp: { command: "coder", args: ["acp"], env: {}, permissions: "ask" } },
    ],
    routes: [
      { match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true },
      { match: "coder/*", upstream: "coder", upstreamModel: "{1}", enabled: true },
    ],
  };
  change(cfg);
  return normalizeConfig(cfg);
};

describe("the weighers read a mode however it is named", () => {
  // (fails before: yes — a list was no string, so `namesMode(["coder/agent@bypassPermissions"])` was false, and the
  // sessions service kept `String(model)` of it: the name whole, mode and all)
  test("a model's name is weighed as the sessions service keeps it: a list of names, name by name", () => {
    for (const name of ["coder/agent@bypassPermissions", ["coder/agent@bypassPermissions"], ["agent/brain-model", "coder/agent@plan"], [["coder/agent@bypassPermissions"]]])
      assert.equal(namesMode(name), true, JSON.stringify(name));
    for (const name of ["agent/brain-model", ["agent/brain-model"], ["a", "b"], [], "", null, undefined, 7, {}]) assert.equal(namesMode(name), false, JSON.stringify(name));
  });

  // (fails before: yes — `configAsksLess` never read the routes: each of these answered false)
  test("a route whose upstream model names its coding agent's mode is weighed, new, changed, switched on or uncovered — its backups too; one to a provider, one left as it was and one covered further are not", () => {
    const was = cfgOf();
    const quiet = { match: "quiet", upstream: "coder", upstreamModel: "sonnet@bypassPermissions", enabled: true };
    assert.equal(configAsksLess(was, cfgOf((c) => void c.routes.unshift(quiet))), true, "a new route");
    assert.equal(configAsksLess(was, cfgOf((c) => void (c.routes[1].upstreamModel = "{1}@bypassPermissions"))), true, "a route changed to name one");
    assert.equal(configAsksLess(was, cfgOf((c) => void (c.routes[0].fallbacks = [{ upstream: "coder", upstreamModel: "sonnet@bypassPermissions" }]))), true, "a backup that names one");
    assert.equal(configAsksLess(was, cfgOf((c) => void c.routes.unshift({ ...quiet, enabled: false }))), false, "one switched off catches no name");
    assert.equal(configAsksLess(cfgOf((c) => void c.routes.unshift({ ...quiet, enabled: false })), cfgOf((c) => void c.routes.unshift(quiet))), true, "switched on");
    // A provider's own model ids may hold an @ (Vertex's claude-sonnet@20250514): no coding agent reads a mode there.
    assert.equal(configAsksLess(was, cfgOf((c) => void c.routes.unshift({ match: "vertex", upstream: "m", upstreamModel: "claude-sonnet@20250514", enabled: true }))), false, "a provider's id with an @");
    const named = cfgOf((c) => void c.routes.push(quiet));
    assert.equal(configAsksLess(named, cfgOf((c) => void c.routes.push(quiet))), false, "the same again");
    assert.equal(configAsksLess(named, cfgOf((c) => void c.routes.push(quiet, { match: "later", upstream: "m", upstreamModel: "{model}", enabled: true }))), false, "a route added behind it");
    assert.equal(configAsksLess(named, cfgOf((c) => void c.routes.push({ match: "sooner", upstream: "m", upstreamModel: "{model}", enabled: true }, quiet))), false, "moved behind another");
    assert.equal(configAsksLess(named, cfgOf((c) => void c.routes.push({ ...quiet, match: "loud" }))), true, "the names it catches changed");
    // A route that stood ahead of it and caught its names: taken out, switched off or moved behind it, the names reach it.
    const covered = cfgOf((c) => void c.routes.push({ match: "qui*", upstream: "m", upstreamModel: "{model}", enabled: true }, quiet));
    assert.equal(configAsksLess(covered, named), true, "the route ahead of it taken out");
    assert.equal(configAsksLess(covered, cfgOf((c) => void c.routes.push({ match: "qui*", upstream: "m", upstreamModel: "{model}", enabled: false }, quiet))), true, "switched off");
    assert.equal(configAsksLess(covered, cfgOf((c) => void c.routes.push(quiet, { match: "qui*", upstream: "m", upstreamModel: "{model}", enabled: true }))), true, "moved behind it");
    assert.equal(configAsksLess(named, covered), false, "one put ahead of it");
  });

  // (fails before: yes — validation passed an id that was a list, and the weigher's maps, keyed by String(u.id), took the
  // second entry of "coder" for the first: the changed program answered false)
  test("an upstream's id is a string, and the weigher reads the entry a turn finds: the first of its id", () => {
    const was = cfgOf();
    const coder = (/** @type {any} */ c) => c.upstreams.find((/** @type {any} */ u) => u.id === "coder");
    const decoy = (/** @type {unknown} */ id) =>
      cfgOf((c) => {
        const old = structuredClone(coder(c));
        coder(c).acp.command = "planted";
        c.upstreams.push({ ...old, id });
      });
    assert.equal(configAsksLess(was, decoy(["coder"])), true, "a second entry whose id is a list");
    assert.equal(configAsksLess(was, decoy("coder")), true, "a second entry of the same id");
    const mode = cfgOf((c) => {
      const old = structuredClone(coder(c));
      coder(c).acp.permissions = "allow-all";
      c.upstreams.push({ ...old, id: ["coder"] });
    });
    assert.equal(configAsksLess(was, mode), true, "its policy, behind a second entry");
    assert.equal(configAsksLess(was, cfgOf()), false, "left as it was");
    for (const id of [["coder"], ["planted"], 7, { id: "coder" }, null]) {
      const v = validateConfig(cfgOf((c) => void c.upstreams.push({ id, name: "planted", type: "anthropic", baseUrl: "https://api.example.invalid" })));
      assert.equal(v.ok, false, JSON.stringify(id));
      assert.ok(v.errors.includes("upstreams[2].id must be letters, digits, dashes or underscores"), `${JSON.stringify(id)}: ${v.errors.join("; ")}`);
    }
    assert.deepEqual(validateConfig(cfgOf()).errors, [], "a config of strings is saved as before");
  });

  // (fails before: yes — your defaults' list was weighed against the knob's own default, BugHunters, where the config's
  // list held nobody: BugHunters named there answered false)
  test("whom your defaults name is weighed against whom a new chat's agent may start now, the config's list under them", () => {
    const emptied = cfgOf((c) => void (c.agentLoop = { subagents: { teams: [], ask: [] } }));
    const naming = (/** @type {any} */ defaults, /** @type {any} */ subagents = { teams: [], ask: [] }) => cfgOf((c) => void Object.assign(c, { agentLoop: { subagents }, sessions: { defaults } }));
    assert.equal(configAsksLess(emptied, naming({ subagents: { teams: ["bughunters"] } })), true, "BugHunters over a list the person emptied");
    assert.equal(configAsksLess(emptied, naming({ subagents: { ask: ["asked"] } })), true, "a saved agent over none");
    const listed = { teams: ["bughunters", "builders"], ask: ["asked"] };
    assert.equal(configAsksLess(naming({}, listed), naming({ subagents: { teams: ["builders"], ask: ["asked"] } }, listed)), false, "names the config's lists hold already");
    assert.equal(configAsksLess(naming({}, listed), naming({ subagents: { teams: ["builders", "planted"] } }, listed)), true, "one more than they hold");
    assert.equal(configAsksLess(cfgOf(), cfgOf((c) => void (c.sessions = { defaults: { subagents: { teams: ["bughunters"] } } }))), false, "BugHunters where the config names it");
    assert.equal(configAsksLess(naming({ subagents: { teams: ["builders"] } }), naming({ subagents: { teams: [] } })), false, "a list emptied");
    assert.equal(configAsksLess(naming({ subagents: { teams: ["builders"] } }), naming({})), false, "taken back");
  });

  // (fails before: yes — none of the three was read: each answered false)
  test("a door opened is weighed — the model endpoints' key no longer asked, a host name let in —, and the web hands let reach this computer's own addresses; one closed, and one left open, are not", () => {
    const was = cfgOf();
    const set = (/** @type {(c: any) => void} */ change) => cfgOf(change);
    for (const off of [false, null, 0, ""]) assert.equal(configAsksLess(was, set((c) => void (c.server = { requireAuth: off }))), true, `server.requireAuth ${JSON.stringify(off)}`);
    assert.equal(configAsksLess(set((c) => void (c.server = { requireAuth: false })), was), false, "asked again");
    assert.equal(configAsksLess(set((c) => void (c.server = { requireAuth: false })), set((c) => void (c.server = { requireAuth: false, maxBodyBytes: 1000 }))), false, "left off");
    assert.equal(configAsksLess(was, set((c) => void (c.server = { allowedHosts: ["Planted.example"] }))), true, "a host name let in");
    const named = set((c) => void (c.server = { allowedHosts: ["mine.example", "other.example"] }));
    assert.equal(configAsksLess(named, set((c) => void (c.server = { allowedHosts: ["OTHER.example"] }))), false, "one taken out");
    assert.equal(configAsksLess(named, set((c) => void (c.server = { allowedHosts: ["mine.example", "other.example", "planted.example"] }))), true, "one more");
    assert.equal(configAsksLess(was, set((c) => void (c.agentLoop = { web: { allowPrivate: true } }))), true, "the web hands' reach widened");
    assert.equal(configAsksLess(set((c) => void (c.agentLoop = { web: { allowPrivate: true } })), was), false, "narrowed again");
  });

  // (fails before: yes — the configuration's weigher read no `experimental` switch: Parallelize tasks on answered false)
  test("Parallelize tasks switched on is weighed — the person's consent to agents started by themselves —; off, and left on, are not", () => {
    const on = cfgOf((c) => void (c.experimental = { parallelizeTasks: true }));
    assert.equal(configAsksLess(cfgOf(), on), true, "switched on");
    assert.equal(configAsksLess(on, cfgOf()), false, "switched off");
    assert.equal(configAsksLess(on, cfgOf((c) => void (c.experimental = { parallelizeTasks: true, cursorSdk: false }))), false, "left on");
  });

  // (fails before: yes — neither weigher read the web hands' switches, the browser's or the loop's per-tool ones: each
  // answered false)
  test("a hand that reaches out unasked in every mode, written other than off or taken back, is weighed: the web hands, the browser, the loop's switches for them — for a chat and in your defaults; switched off is not", () => {
    for (const patch of [{ plugins: { web: { fetch: true } } }, { plugins: { web: { search: true } } }, { plugins: { browser: true } }, { loop: { tools: { bash: false } } }, { loop: { tools: { web_fetch: true } } }, { loop: { tools: { web_fetch: false, web_search: false } } }])
      assert.equal(asksLess({ patch }), true, JSON.stringify(patch));
    for (const unset of [["plugins.web.fetch"], ["plugins.browser"], ["loop.tools"], ["plugins"]]) assert.equal(asksLess({ unset }), true, `taken back: ${unset}`);
    for (const patch of [{ plugins: { web: { fetch: false, search: false }, browser: false } }, { loop: { tools: { web_fetch: false, web_search: false, browser: false, bash: false } } }, { display: { title: "x" } }])
      assert.equal(asksLess({ patch }), false, JSON.stringify(patch));
    const defaults = (/** @type {any} */ d) => cfgOf((c) => void (c.sessions = { defaults: d }));
    const off = defaults({ plugins: { web: { fetch: false }, browser: false } });
    assert.equal(configAsksLess(off, defaults({ plugins: { web: { fetch: true }, browser: false } })), true, "your defaults' web fetch on again");
    assert.equal(configAsksLess(off, defaults({ plugins: { web: { fetch: false } } })), true, "your defaults' browser taken back to its default, on");
    assert.equal(configAsksLess(defaults({}), off), false, "switched off in your defaults");
    assert.equal(configAsksLess(off, defaults({ plugins: { web: { fetch: false }, browser: false } })), false, "left off");
  });
});

const toolUse = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => ({ type: "tool_use", id, name, input });
const reply = (/** @type {any[]} */ blocks, stop = "end_turn") => anthropicReply("", { model: "brain-model", stop, blocks, usage: { input_tokens: 30, output_tokens: 7 } });
/** A message's words. @param {any} m */
const wordsOf = (m) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
/** What a tool's result said. @param {any} r */
const resultWords = (r) => (typeof r?.content === "string" ? r.content : (r?.content || []).map((/** @type {any} */ b) => b?.text ?? "").join(""));
/** The model behind the chats: `WRITE <file>` asks to write the file with a command; the call after a result says `DONE: ` and it. @param {any} call */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const last = call.body.messages.at(-1);
  const result = Array.isArray(last?.content) ? last.content.find((/** @type {any} */ c) => c?.type === "tool_result") : null;
  if (result) return reply([{ type: "text", text: `DONE: ${resultWords(result)}` }]);
  const file = wordsOf(last).match(/WRITE (\S+)/)?.[1];
  if (file) return reply([toolUse("c1", "bash", { command: `node -e "require('fs').writeFileSync('${file}','1')"` })], "tool_use");
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

describe("a mode named past the weighers is a press, on one Filament", () => {
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startApp>>} */
  let shim;
  const root = mkdtempSync(join(tmpdir(), "filament-press-modes-"));
  /** @param {string} path @param {{ method?: string, headers?: Record<string, string>, body?: any }} [o] */
  const call = (path, o) => ask(shim.port, path, o);
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A new chat of this computer's, its id. */
  const create = async () => {
    const r = await call("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain" } });
    assert.equal(r.status, 200, r.text);
    return String(r.json.id);
  };
  /** The asks the chat waits on. @param {string} id @returns {Promise<any[]>} */
  const asks = async (id) => (await call(`${S(id)}/asks`)).json.asks;
  /** A press refused in words, the press marked so a client can tell. @param {{ status: number, json: any, text: string }} r @param {string} what */
  const refused = (r, what) => {
    assert.equal(r.status, 403, `${what}: ${r.text}`);
    assert.match(String(r.json?.error), REFUSED, what);
    assert.equal(r.json?.press, true, what);
  };
  const config = async () => (await call("/api/state")).json.config;
  const coder = (/** @type {any} */ cfg) => cfg.upstreams.find((/** @type {any} */ u) => u.id === "coder");
  /** The config as it is, changed, saved whole. @param {(cfg: any) => void} change @param {Record<string, string>} [headers] */
  const put = async (change, headers = {}) => {
    const next = structuredClone(await config());
    change(next);
    return call("/api/config", { method: "PUT", headers, body: next });
  };
  /** Some of the config's fields, set. @param {Record<string, unknown>} set @param {Record<string, string>} [headers] */
  const fields = (set, headers = {}) => call("/api/config/fields", { method: "PATCH", headers, body: { set } });
  const quiet = { match: "quiet", upstream: "coder", upstreamModel: "sonnet@bypassPermissions", enabled: true };

  before(async () => {
    up = await fakeUpstream(brain);
    shim = await startApp({
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

  // (fails before: yes — the turns row weighed its body alone: the header went through to the turn, which ran in Auto,
  // and its command ran unasked — 200 where the refusal stands now, and the file written)
  test("a turn's mode named by the request's own header is a press, as the body's is: refused without the key and nothing run — a word that is no mode's too, which reads as Edit —; with the key it runs so; a header that names none is no press", async () => {
    const id = await create();
    refused(await call(`${S(id)}/turns`, { method: "POST", headers: { [MODE]: "auto" }, body: { content: "WRITE head.txt", stream: false } }), "a turn in Auto, by its header");
    refused(await call(`${S(id)}/turns`, { method: "POST", headers: { [MODE]: "anything" }, body: { content: "WRITE head.txt", stream: false } }), "a word that is no mode's");
    refused(await call(`${S(id)}/turns`, { method: "POST", headers: { "X-Filament-Permissions": "read-only" }, body: { content: "hello", stream: false } }), "any mode, in any case of the header's name");
    assert.equal(existsSync(join(root, "head.txt")), false);
    assert.deepEqual(await asks(id), [], "nothing ran to ask");
    const none = await call(`${S(id)}/turns`, { method: "POST", headers: { [MODE]: " " }, body: { content: "hello", stream: false } });
    assert.equal(none.status, 200, `a header that names no mode: ${none.text}`);
    assert.equal(wordsOf(none.json), "MODEL ANSWER");
    const yes = await call(`${S(id)}/turns`, { method: "POST", headers: { ...PRESS, [MODE]: "auto" }, body: { content: "WRITE head.txt", stream: false } });
    assert.equal(yes.status, 200, yes.text);
    assert.match(wordsOf(yes.json), /^DONE: /);
    assert.equal(existsSync(join(root, "head.txt")), true, "with the key the turn runs in the mode its header names");
  });

  // (fails before: yes — POST /sessions answered 200 for a model sent as a list, and the chat's model was the name
  // whole, its coding agent's mode with it)
  test("a new chat whose model is a list that names its coding agent's mode is a press; a list of a plain name is the name, as before; with the key the chat is made", async () => {
    const chats = async () => (await call("/api/memory/sessions?limit=200")).json.sessions.length;
    const count = await chats();
    refused(await call("/api/sessions", { method: "POST", body: { cwd: root, model: ["coder/agent@bypassPermissions"], preset: "plain" } }), "a model sent as a list");
    refused(await call("/api/sessions", { method: "POST", body: { cwd: root, model: ["agent/brain-model", "coder/agent@bypassPermissions"], preset: "plain" } }), "a list of two");
    assert.equal(await chats(), count, "no chat was made");
    const plain = await call("/api/sessions", { method: "POST", body: { cwd: root, model: ["agent/brain-model"], preset: "plain" } });
    assert.equal(plain.status, 200, plain.text);
    assert.equal(plain.json.model, "agent/brain-model");
    const yes = await call("/api/sessions", { method: "POST", headers: PRESS, body: { cwd: root, model: ["coder/agent@bypassPermissions"], preset: "plain" } });
    assert.equal(yes.status, 200, yes.text);
    assert.equal(yes.json.model, "coder/agent@bypassPermissions", "the name the list was weighed as is the name kept");
  });

  // (fails before: yes — the config's rows never read the routes: a route that sends the plain name `quiet` to the
  // coding agent as sonnet@bypassPermissions was saved with no key)
  test("a route whose upstream model names its coding agent's mode is a press, by the config whole: new, changed, or a backup; a provider's id with an @, a save that leaves it and a route behind it need none", async () => {
    const was = await config();
    refused(await put((c) => void c.routes.unshift(quiet)), "a new route");
    refused(await put((c) => void (c.routes.find((/** @type {any} */ r) => r.match === "coder/*").upstreamModel = "{1}@bypassPermissions")), "a route changed to name one");
    refused(await put((c) => void (c.routes.find((/** @type {any} */ r) => r.match === "brain-*").fallbacks = [{ upstream: "coder", upstreamModel: "sonnet@bypassPermissions" }])), "a backup that names one");
    assert.deepEqual((await config()).routes, was.routes, "the routes are as they were");
    const vertex = await put((c) => void c.routes.push({ match: "vertex", upstream: "m", upstreamModel: "claude-sonnet@20250514", enabled: true }));
    assert.equal(vertex.status, 200, `a provider's model id with an @ names no mode: ${vertex.text}`);
    const yes = await put((c) => void c.routes.unshift(quiet), PRESS);
    assert.equal(yes.status, 200, yes.text);
    assert.equal((await config()).routes[0].upstreamModel, "sonnet@bypassPermissions");
    assert.equal((await put(() => {})).status, 200, "a save that leaves it as it is needs no key");
    assert.equal((await put((c) => void c.routes.push({ match: "later-*", upstream: "m", upstreamModel: "{model}", enabled: true }))).status, 200, "nor a route behind it");
    refused(await put((c) => void (c.routes[0].match = "*")), "the names it catches changed");
    assert.equal((await put((c) => void (c.routes = c.routes.filter((/** @type {any} */ r) => !["quiet", "vertex", "later-*"].includes(r.match))))).status, 200, "taken out with no key");
    assert.deepEqual((await config()).routes, was.routes);
  });

  // (fails before: yes — the save answered 200 with no key: validation passed the list as an id, the weigher took the
  // second entry of "coder" for the first, and the coding agent's program was the planted one)
  test("a second entry of a coding agent's id hides no change of its program: an id that is a list is refused by the config's own check, and nothing is saved", async () => {
    const was = await config();
    const r = await put((c) => {
      const old = structuredClone(coder(c));
      coder(c).acp.env = { PLANTED: "1" };
      c.upstreams.push({ ...old, id: ["coder"] });
    });
    assert.equal(r.status, 400, r.text);
    assert.ok(r.json.errors.includes("upstreams[2].id must be letters, digits, dashes or underscores"), r.text);
    assert.deepEqual(coder(await config()).acp, coder(was).acp, "the coding agent's program is as it was");
    assert.equal((await config()).upstreams.length, was.upstreams.length);
    const keyed = await put((c) => void c.upstreams.push({ ...structuredClone(coder(c)), id: ["coder"] }), PRESS);
    assert.equal(keyed.status, 400, `with the key too: an id is a string: ${keyed.text}`);
  });

  // (fails before: yes — with the config's list emptied, your defaults naming BugHunters were saved with no key: weighed
  // against the knob's default, they named nobody new)
  test("your defaults naming a team over a list the person emptied is a press, by the config whole; the names that hold for a new chat already need none", async () => {
    const teams = async () => {
      const c = await config();
      return [c.agentLoop.subagents?.teams ?? null, c.sessions?.defaults?.subagents?.teams ?? null];
    };
    assert.equal((await fields({ "agentLoop.subagents.teams": [] })).status, 200, "the person's list emptied: no key");
    refused(await put((c) => void (c.sessions = { ...c.sessions, defaults: { subagents: { teams: ["bughunters"] } } })), "BugHunters named in your defaults over none");
    assert.deepEqual(await teams(), [[], null], "nothing was named");
    const yes = await put((c) => void (c.sessions = { ...c.sessions, defaults: { subagents: { teams: ["bughunters"] } } }), PRESS);
    assert.equal(yes.status, 200, yes.text);
    assert.deepEqual(await teams(), [[], ["bughunters"]]);
    assert.equal((await put((c) => void (c.sessions = { ...c.sessions, defaults: {} }))).status, 200, "taken back with no key");
    assert.equal((await fields({ "agentLoop.subagents.teams": ["bughunters"] }, PRESS)).status, 200);
    const same = await put((c) => void (c.sessions = { ...c.sessions, defaults: { subagents: { teams: ["bughunters"] } } }));
    assert.equal(same.status, 200, `the team the config's list names already: ${same.text}`);
    assert.equal((await put((c) => void (c.sessions = { ...c.sessions, defaults: {} }))).status, 200);
  });

  // (fails before: yes — each field was set with no key: `server.requireAuth` off answered 200, and the model endpoints
  // asked for no key from then on)
  test("the model endpoints' key no longer asked, a host name let in and the web hands let reach this computer's own addresses are presses, by the config's fields, the config whole and the command line; each closed again needs none", async () => {
    const now = async () => {
      const c = await config();
      return [c.server.requireAuth, c.server.allowedHosts, c.agentLoop.web?.allowPrivate === true];
    };
    const was = await now();
    assert.deepEqual(was, [true, [], false]);
    for (const set of [{ "server.requireAuth": false }, { "server.allowedHosts": ["planted.example"] }, { "agentLoop.web.allowPrivate": true }]) refused(await fields(set), `PATCH /config/fields ${JSON.stringify(set)}`);
    refused(await put((c) => void (c.server.requireAuth = false)), "by the config whole");
    refused(await put((c) => void (c.server.requireAuth = null)), "a value the key's check reads as off");
    refused(await put((c) => void (c.server.allowedHosts = ["planted.example"])), "a host name, by the config whole");
    /** @type {string[]} */
    const err = [];
    const code = await runCli(["settings", "set", "server.requireAuth", "false"], { dataDir: shim.dataDir, out: () => {}, err: (s) => err.push(s), write: () => {} });
    assert.notEqual(code, EXIT.ok, "the command line switches the key's check off no more than a program here does, while the app holds a key");
    assert.match(err.join("\n"), REFUSED);
    assert.deepEqual(await now(), was, "nothing was switched");
    const open = await call("/v1/messages", { method: "POST", body: { model: "brain-model", max_tokens: 16, messages: [{ role: "user", content: "hello" }] } });
    assert.equal(open.status, 401, `the model endpoints still ask for a key: ${open.text}`);
    // With the key each is set, as from the page; left as they are, a save needs none; closed again needs none.
    assert.equal((await fields({ "server.requireAuth": false, "server.allowedHosts": ["mine.example"], "agentLoop.web.allowPrivate": true }, PRESS)).status, 200);
    assert.deepEqual(await now(), [false, ["mine.example"], true]);
    assert.equal((await put(() => {})).status, 200, "a save that leaves them as they are");
    assert.equal((await fields({ "server.maxBodyBytes": (await config()).server.maxBodyBytes + 1 })).status, 200, "another field, while they stand open");
    assert.equal((await fields({ "server.requireAuth": true, "server.allowedHosts": [], "agentLoop.web.allowPrivate": false })).status, 200, "closed again with no key");
    assert.deepEqual(await now(), was);
  });

  // (fails before: yes — PATCH /config/fields {"experimental.parallelizeTasks":true} answered 200 with no key)
  test("Parallelize tasks switched on is a press, by the config's fields, the config whole and the command line; off needs none", async () => {
    const on = async () => (await config()).experimental?.parallelizeTasks === true;
    refused(await fields({ "experimental.parallelizeTasks": true }), "by the config's fields");
    refused(await put((c) => void (c.experimental = { ...c.experimental, parallelizeTasks: true })), "by the config whole");
    /** @type {string[]} */
    const err = [];
    const code = await runCli(["settings", "set", "experimental.parallelizeTasks", "true"], { dataDir: shim.dataDir, out: () => {}, err: (s) => err.push(s), write: () => {} });
    assert.notEqual(code, EXIT.ok, "nor by the command line, while the app holds a key");
    assert.match(err.join("\n"), REFUSED);
    assert.equal(await on(), false, "nothing was switched");
    assert.equal((await fields({ "experimental.parallelizeTasks": true }, PRESS)).status, 200);
    assert.equal(await on(), true);
    assert.equal((await put(() => {})).status, 200, "a save that leaves it on");
    assert.equal((await fields({ "experimental.parallelizeTasks": false })).status, 200, "switched off with no key");
    assert.equal(await on(), false);
  });

  // (fails before: yes — a chat's web hands, switched off, were switched on again with no key: PATCH answered 200)
  test("a hand that reaches out unasked in every mode switched on is a press — the web hands, the browser, the loop's switches for them —, for a chat, a new chat and /set; switched off is none", async () => {
    const flat = async (/** @type {string} */ id) => (await call(`${S(id)}/settings`)).json.flat;
    const reach = async (/** @type {string} */ id) => {
      const f = await flat(id);
      return [f["plugins.web.fetch"], f["plugins.web.search"], f["plugins.browser"], f["loop.tools"]?.web_fetch ?? null];
    };
    const id = await create();
    const patch = (/** @type {any} */ body, /** @type {Record<string, string>} */ headers = {}) => call(`${S(id)}/settings`, { method: "PATCH", headers, body });
    assert.equal((await patch({ patch: { plugins: { web: { fetch: false, search: false }, browser: false }, loop: { tools: { web_fetch: false, web_search: false, browser: false } } } })).status, 200, "switched off with no key");
    const off = await reach(id);
    assert.deepEqual(off, [false, false, false, false]);
    refused(await patch({ patch: { plugins: { web: { fetch: true } } } }), "web fetch on again");
    refused(await patch({ patch: { plugins: { browser: true } } }), "the browser on again");
    refused(await patch({ unset: ["plugins.web.search"] }), "taken back to its default, on");
    refused(await patch({ patch: { loop: { tools: { bash: false } } } }), "the loop's switches written over the ones that held them off");
    refused(await call(`${S(id)}/turns`, { method: "POST", body: { content: "/set plugins.web.fetch true", stream: false } }), "by /set");
    assert.deepEqual(await reach(id), off, "nothing was switched on");
    refused(await call("/api/sessions", { method: "POST", body: { cwd: root, model: "agent/brain-model", preset: "plain", settings: { plugins: { browser: true } } } }), "a new chat's");
    assert.equal((await patch({ patch: { plugins: { web: { fetch: true } } } }, PRESS)).status, 200, "with the key");
    assert.equal((await flat(id))["plugins.web.fetch"], true);
  });

  // (fails before: yes — the owner's of 11-16: the chat's own Parallelize tasks is new; with no press an agent calling
  // Filament would answer its own card always, and no card would ask in its chat again)
  test("a chat's own Parallelize tasks switched on, or taken back, is a press, by its settings, /set and its card's Always accept in this chat; off needs none", async () => {
    const id = await create();
    const own = async () => (await call(`${S(id)}/settings`)).json.flat["subagents.parallelize"] ?? null;
    const patch = (/** @type {any} */ body, /** @type {Record<string, string>} */ headers = {}) => call(`${S(id)}/settings`, { method: "PATCH", headers, body });
    refused(await patch({ patch: { subagents: { parallelize: true } } }), "by its settings");
    refused(await call(`${S(id)}/turns`, { method: "POST", body: { content: "/set subagents.parallelize true", stream: false } }), "by /set");
    const app = /** @type {any} */ (shim.app);
    const hold = app.subagents.holdTask(id, { runId: "run-press", view: { description: "Fix it", kind: "builder", model: "m", where: "copy", declines: "" }, start: () => ["sa_press"] });
    const answer = (/** @type {string} */ said, /** @type {Record<string, string>} */ headers = {}) => call(`${S(id)}/held-launches/${hold.id}`, { method: "POST", headers, body: { answer: said } });
    refused(await answer("always"), "by its card");
    assert.equal(await own(), null, "nothing was switched");
    assert.equal(app.subagents.held(id)[0].state, "waiting", "and the card still waits");
    const yes = await answer("always", PRESS);
    assert.equal(yes.status, 200, yes.text);
    assert.equal(await own(), true);
    assert.equal((await patch({ patch: { subagents: { parallelize: false } } })).status, 200, "switched off with no key");
    // (fails before: yes — the review of fe6b8d579: taken back, Settings › Experimental's switch says it, which may be on
    // where the chat said off)
    refused(await patch({ unset: ["subagents.parallelize"] }), "taken back");
    refused(await call(`${S(id)}/turns`, { method: "POST", body: { content: "/unset subagents.parallelize", stream: false } }), "by /unset");
    assert.equal(await own(), false, "it stands off");
    assert.equal((await patch({ unset: ["subagents.parallelize"] }, PRESS)).status, 200, "taken back by the person");
  });

  // (fails before: no — with no key nothing changed; it guards that it still does not)
  test("with no key — a browser, a server, the CLI —, each is as it was: the header's mode runs the turn, a list is a chat's model, a route names a mode, your defaults a team, the key's check is switched, Parallelize tasks and a chat's web hands are switched on", async () => {
    setPressKey("");
    const was = await config();
    try {
      const id = await create();
      const auto = await call(`${S(id)}/turns`, { method: "POST", headers: { [MODE]: "auto" }, body: { content: "WRITE free.txt", stream: false } });
      assert.equal(auto.status, 200, auto.text);
      assert.equal(existsSync(join(root, "free.txt")), true, "the header's mode ran the turn");
      const listed = await call("/api/sessions", { method: "POST", body: { cwd: root, model: ["coder/agent@plan"], preset: "plain" } });
      assert.equal(listed.status, 200, listed.text);
      assert.equal(listed.json.model, "coder/agent@plan");
      assert.equal((await put((c) => void c.routes.unshift(quiet))).status, 200, "a route that names a mode");
      assert.equal((await fields({ "agentLoop.subagents.teams": [] })).status, 200);
      assert.equal((await put((c) => void (c.sessions = { ...c.sessions, defaults: { subagents: { teams: ["bughunters"] } } }))).status, 200, "your defaults naming a team");
      assert.equal((await fields({ "server.allowedHosts": ["mine.example"], "agentLoop.web.allowPrivate": true })).status, 200);
      /** @type {string[]} */
      const out = [];
      const code = await runCli(["settings", "set", "server.requireAuth", "false"], { dataDir: shim.dataDir, out: (s) => out.push(s), err: (s) => out.push(s), write: () => {} });
      assert.equal(code, EXIT.ok, `the command line switches the key's check as it did: ${out.join("\n")}`);
      assert.equal((await config()).server.requireAuth, false);
      assert.equal((await fields({ "experimental.parallelizeTasks": true })).status, 200, "Parallelize tasks");
      const web = await call(`${S(id)}/settings`, { method: "PATCH", body: { patch: { plugins: { web: { fetch: true }, browser: true }, loop: { tools: { bash: false } } } } });
      assert.equal(web.status, 200, `a chat's web hands and browser: ${web.text}`);
    } finally {
      await put((c) => Object.assign(c, { routes: was.routes, sessions: was.sessions, server: { ...c.server, requireAuth: true, allowedHosts: [] }, agentLoop: was.agentLoop, experimental: was.experimental }));
      setPressKey(KEY);
    }
  });
});

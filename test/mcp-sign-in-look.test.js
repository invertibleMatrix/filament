// @ts-check
// A remote server that wants a sign-in says so before anyone presses anything (the owner's of 10-26: the Linear and
// Figma plugins on for Northwind read "Not tested since Filament started", nothing of a sign-in, until a test). The
// sign-ins' `look` asks a server once since Filament started, with no sign-in (app/sessions/mcp-sign-in.js); the list's
// `look` asks those a place has on, untested and with none held (app/sessions/mcp-servers.js); the page asks once, as
// a list first draws, and draws the answer where a row asks now (ui/harness/lib/mcp-list.js).
// (fails before: yes — nothing asked a server until a test or a sign-in, so a row never said it wanted one)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSignInStore } from "../src/services/mcp-sign-ins.js";
import { createMcpSignIns } from "../src/app/sessions/mcp-sign-in.js";
import { createMcpServers } from "../src/app/sessions/mcp-servers.js";
import { createMcpList, rowLines, signInOf } from "../src/ui/harness/lib/mcp-list.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

const root = mkdtempSync(join(tmpdir(), "filament-look-"));
after(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
/** A list's row by its name. @param {any} list @param {string} name @returns {any} */
const rowIn = (list, name) => list.servers.find((/** @type {any} */ r) => r.name === name);

const LINEAR = "https://mcp.linear.example/mcp";
const OPEN = "https://open.example/mcp";
const DOWN = "https://down.example/mcp";
const BARE = "https://bare.example/mcp";

/**
 * Sign-ins over a fake network: Linear asks for a sign-in (401 with a Bearer challenge, as mcp.linear.app answered on
 * 10-26), the open server lets anyone in, the bare one answers 401 with no challenge, the down one cannot be reached.
 * `seen`: each request's address, in order.
 */
function signInsOver() {
  /** @type {string[]} */
  const seen = [];
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const u = String(url);
    seen.push(`${init?.method || "GET"} ${u}`);
    if (u === LINEAR) return new Response("", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://mcp.linear.example/.well-known/oauth-protected-resource"' } });
    if (u === OPEN) return new Response("{}", { status: 200 });
    if (u === BARE) return new Response("", { status: 401 });
    throw new TypeError("fetch failed");
  };
  const dataDir = join(root, `d${++dirs}`);
  const store = createSignInStore({ dataDir });
  return { seen, store, s: createMcpSignIns({ store, selfBase: () => "http://127.0.0.1:4321", fetchImpl }) };
}

describe("the sign-ins' look", () => {
  test("a 401 with no challenge is no ask, as a chat's connect reads it: the row is left to its test", async () => {
    const { s } = signInsOver();
    assert.equal(await s.look(BARE, {}), false);
    assert.equal(s.stateOf(BARE, {}), null);
  });

  test("a 401 has the row ask, once; an open server or one that cannot be reached leaves it as it was; neither is asked twice", async () => {
    const { s, seen } = signInsOver();
    assert.deepEqual(await Promise.all([s.look(LINEAR, {}), s.look(LINEAR, {})]), [true, true], "two looks at once ask the server once");
    assert.deepEqual(seen, [`POST ${LINEAR}`]);
    assert.equal(s.stateOf(LINEAR, {})?.state, "asks");
    assert.equal(await s.look(OPEN, {}), false);
    assert.equal(await s.look(DOWN, {}), false);
    assert.deepEqual([s.stateOf(OPEN, {}), s.stateOf(DOWN, {})], [null, null]);
    const before = seen.length;
    assert.deepEqual([await s.look(LINEAR, {}), await s.look(OPEN, {}), await s.look(DOWN, {})], [true, false, false]);
    assert.equal(seen.length, before, "each was asked once since Filament started");
  });

  test("a server with its own Authorization header, or a sign-in Filament holds, is not asked", async () => {
    const { s, seen, store } = signInsOver();
    assert.equal(await s.look(LINEAR, { Authorization: "Bearer mine" }), false);
    store.put(LINEAR, { issuer: "https://mcp.linear.example", tokenEndpoint: "https://mcp.linear.example/token", clientId: "c", authMethod: "none", resource: LINEAR, accessToken: "at-1-1", at: 1 });
    assert.equal(await s.look(LINEAR, {}), false);
    assert.deepEqual(seen, []);
    assert.equal(s.stateOf(LINEAR, {})?.state, "in");
  });
});

describe("the list's look", () => {
  /** All chats with Linear, the open server, one with its own header, one switched off and one run on this computer. */
  function servers() {
    const { s, seen } = signInsOver();
    const defaults = {
      "plugins.mcp": [
        { name: "linear", url: LINEAR },
        { name: "open", url: OPEN },
        { name: "keyed", url: "https://keyed.example/mcp", headers: { Authorization: "Bearer k" } },
        { name: "off", url: "https://off.example/mcp", enabled: false },
        { name: "local", command: "node", args: ["srv.js"] },
      ],
    };
    const sessions = { patchDefaults: () => {}, patchProjectSettings: () => {}, patchSettings: () => {}, launchInfo: () => null };
    const archive = { getProject: () => null, projectSettings: () => ({}), chainSettings: () => ({}), spaceOf: () => null };
    const config = { get: () => ({ sessions: { defaults } }) };
    return { seen, list: createMcpServers({ sessions, memory: { archive }, config, home: "/home/me", signIns: s }) };
  }

  test("asks each remote server that is on, untested and with no sign-in held; Linear's row asks now, with Sign in on it; asked again, none is asked twice", async () => {
    const { list, seen } = servers();
    assert.equal(rowIn(list.list("all"), "linear").signIn, null, "before: nothing said");
    const r = await list.look("all");
    assert.equal(r.changed, true);
    assert.deepEqual(seen.sort(), [`POST ${LINEAR}`, `POST ${OPEN}`]);
    const linear = rowIn(r, "linear");
    assert.equal(linear.signIn.state, "asks");
    assert.deepEqual([signInOf(linear).asks, rowLines(linear, "global", 0).map((l) => l.text)], [true, ["Needs you to sign in"]]);
    const again = await list.look("all");
    assert.deepEqual([again.changed, seen.length], [false, 2]);
  });

  test("a server that does not answer in time is left to its test: the list comes back all the same", async () => {
    const sessions = { patchDefaults: () => {}, patchProjectSettings: () => {}, patchSettings: () => {}, launchInfo: () => null };
    const archive = { getProject: () => null, projectSettings: () => ({}), chainSettings: () => ({}), spaceOf: () => null };
    const config = { get: () => ({ sessions: { defaults: { "plugins.mcp": [{ name: "slow", url: "https://slow.example/mcp" }] } } }) };
    const store = createSignInStore({ dataDir: join(root, `d${++dirs}`) });
    /** @type {typeof fetch} */
    const fetchImpl = () => new Promise(() => {});
    const list = createMcpServers({ sessions, memory: { archive }, config, home: "/home/me", signIns: createMcpSignIns({ store, selfBase: () => "http://127.0.0.1:4321", fetchImpl }) });
    const r = await list.look("all", 20);
    assert.deepEqual([r.changed, r.servers.map((/** @type {any} */ x) => x.name)], [false, ["slow"]]);
  });
});

describe("the page asks once, as a list first draws", () => {
  /** @param {any} first  the list's answer @param {any} looked  the look's */
  const pageWith = (first, looked) => {
    /** @type {{ path: string, method: string }[]} */
    const calls = [];
    const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
      calls.push({ path, method: opts.method || "GET" });
      return path === "/mcp-servers/look" ? looked : first;
    };
    const list = createMcpList({ scope: "all", now: () => 0 }, /** @type {any} */ ({ h: fakeH, drawIn: fakeDrawIn, api, dialog: () => ({ close() {} }), menu: () => {}, confirm: async () => true, open: () => {}, later: () => {} }));
    return { calls, el: /** @type {any} */ (list.el), list };
  };
  const linear = (/** @type {any} */ o = {}) => ({ name: "linear", kind: "http", spec: { name: "linear", url: LINEAR }, sse: false, from: "global", on: true, switchedAt: null, replaces: null, orphan: false, own: true, switchedHere: false, test: null, signIn: null, ...o });
  const answer = (/** @type {any[]} */ servers, o = {}) => ({ scope: "all", at: "global", label: "all chats", projectId: null, held: false, unread: [], servers, ...o });

  test("a remote row with nothing said: the look's answer is drawn, Linear asking with Sign in on its row; the list is asked once", async () => {
    const { calls, el, list } = pageWith(answer([linear()]), answer([linear({ signIn: { state: "asks", host: "mcp.linear.example", account: "main", accounts: [] } })], { changed: true }));
    await flush();
    assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET /mcp-servers?scope=all", "POST /mcp-servers/look"]);
    assert.match(textOf(el), /Needs you to sign in/);
    assert.ok(buttonsOf(el).some((b) => textOf(b) === "Sign in"), "Sign in on the row");
    await list.refresh();
    await flush();
    assert.equal(calls.filter((c) => c.path === "/mcp-servers/look").length, 1, "a refresh does not ask again");
  });

  test("no row to ask about — tested, signed in, run on this computer or switched off — asks nothing", async () => {
    const rows = [
      linear({ name: "a", test: { ok: true, at: 0, words: "3 tools" } }),
      linear({ name: "b", signIn: { state: "in", host: "h", account: "main", accounts: ["main"] } }),
      linear({ name: "c", kind: "stdio", spec: { name: "c", command: "node" } }),
      linear({ name: "d", on: false }),
    ];
    const { calls } = pageWith(answer(rows), answer(rows));
    await flush();
    assert.deepEqual(calls.map((c) => c.path), ["/mcp-servers?scope=all"]);
  });
});

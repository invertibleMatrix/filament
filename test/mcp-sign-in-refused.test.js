// @ts-check
// A service that turns Filament's registration down says its own reason (the owner's of 10-26: Figma's sign-in asked
// for a client ID and secret, "lets no app register itself" — but Figma has a registration address; it answered 403,
// and may let only the apps it approved sign in, where a client made by hand cannot help either). The server half: the
// refusal carries the service's words and the page its metadata names for how to use it (adapters/tools/mcp-oauth.js
// `register`, `discover`; app/sessions/mcp-sign-in.js `start`), and is kept — in mcp-sign-ins.json, so a row says so
// after a restart — until a registration goes through or a person gives a client (services/mcp-sign-ins.js). A server
// with no registration at all asks for the client made on its site as before (mcp-sign-in.test.js HC-153).
// (fails before: yes — the refusal was "lets no app register itself" with neither the service's words nor its page, and
// nothing of it was kept)
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSignInStore } from "../src/services/mcp-sign-ins.js";
import { createMcpSignIns } from "../src/app/sessions/mcp-sign-in.js";
import { createMcpList, rowLines, serviceName, signInLine, signInOf } from "../src/ui/harness/lib/mcp-list.js";
import { fakeH, fakeDrawIn, textOf, buttonsOf } from "./helpers/fake-dom.js";

const root = mkdtempSync(join(tmpdir(), "filament-refused-"));
after(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;

const MCP = "https://mcp.design.example/mcp";
const DOCS = "https://developers.design.example/docs/mcp-server/";
const HOST = "mcp.design.example";

/**
 * A service shaped as Figma's answered on 10-26: a 401 with a Bearer challenge, resource metadata naming another
 * authorization server and its documentation, that server's metadata with a registration address, and the
 * registration's answer as `o.register` gives it — changeable, as the service's mind is. `registered`: what Filament sent
 * there. `again()`: Filament started again over the same data folder.
 * @param {(body: any) => Response} register @param {{ docs?: string }} [o]
 */
function service(register, o = {}) {
  /** @type {any[]} */
  const registered = [];
  const answer = { register };
  /** @type {typeof fetch} */
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (u === MCP) return new Response("", { status: 401, headers: { "www-authenticate": `Bearer resource_metadata="https://${HOST}/.well-known/oauth-protected-resource"` } });
    if (u === `https://${HOST}/.well-known/oauth-protected-resource`)
      return Response.json({ resource: MCP, authorization_servers: ["https://api.design.example"], scopes_supported: ["mcp:connect"], resource_documentation: o.docs ?? DOCS });
    if (u === "https://api.design.example/.well-known/oauth-authorization-server")
      return Response.json({ issuer: "https://api.design.example", authorization_endpoint: "https://www.design.example/oauth/mcp", token_endpoint: "https://api.design.example/v1/oauth/token", registration_endpoint: "https://api.design.example/v1/oauth/mcp/register", code_challenge_methods_supported: ["S256"] });
    if (u === "https://api.design.example/v1/oauth/mcp/register") {
      const body = JSON.parse(String(init?.body || "{}"));
      registered.push(body);
      return answer.register(body);
    }
    return new Response("", { status: 404 });
  };
  const dataDir = join(root, `d${++dirs}`);
  const make = () => createMcpSignIns({ store: createSignInStore({ dataDir }), selfBase: () => "http://127.0.0.1:4321", fetchImpl, now: () => 1_000 });
  return { s: make(), again: make, registered, answer };
}

const forbidden = () => new Response("", { status: 403 });

describe("a registration turned down", () => {
  test("a bare 403: its status as the reason, the service's documentation with it; the client-ID route stays offered; nothing opened", async () => {
    const { s, registered } = service(forbidden);
    await assert.rejects(s.start({ name: "figma", url: MCP }), (/** @type {any} */ e) => {
      assert.equal(e.status, 409);
      assert.deepEqual([e.extra.needsClient, e.extra.turnedDown, e.extra.docs, e.extra.host], [true, { said: "", status: 403 }, DOCS, HOST]);
      assert.equal(e.message, "figma: api.design.example turned down Filament's registration (HTTP 403)");
      return true;
    });
    assert.equal(registered.length, 1);
  });

  test("its own words where it gives them; documentation over plain http elsewhere is left out", async () => {
    const { s } = service(() => Response.json({ error: "invalid_client_metadata", error_description: "this client is not on the list" }, { status: 400 }), { docs: "http://docs.design.example/mcp" });
    await assert.rejects(s.start({ name: "figma", url: MCP }), (/** @type {any} */ e) => {
      assert.deepEqual(e.extra.turnedDown, { said: "invalid_client_metadata: this client is not on the list", status: 400 });
      assert.equal(e.extra.docs, undefined);
      assert.match(e.message, /turned down Filament's registration \(invalid_client_metadata: this client is not on the list, HTTP 400\)$/);
      return true;
    });
  });

  test("a registration address that is not there (404) is no refusal: it asks for the client made on its site, as a server with none does", async () => {
    const { s } = service(() => new Response("", { status: 404 }));
    await assert.rejects(s.start({ name: "figma", url: MCP }), (/** @type {any} */ e) => e.status === 409 && e.extra.needsClient === true && e.extra.turnedDown === undefined && /did not register Filament \(HTTP 404\)/.test(e.message));
    assert.equal(s.stateOf(MCP, {}), null, "nothing kept");
  });
});

describe("the refusal kept", () => {
  test("the row says it was refused, when, why and where its guide is — after a restart too, over what a look finds", async () => {
    const { s, again } = service(forbidden);
    await assert.rejects(s.start({ name: "figma", url: MCP }));
    const refused = { state: "refused", host: HOST, account: "main", accounts: [], why: "HTTP 403", at: 1_000, docs: DOCS };
    assert.deepEqual(s.stateOf(MCP, {}), refused);
    const later = again();
    assert.deepEqual(later.stateOf(MCP, {}), refused, "kept in mcp-sign-ins.json");
    await later.look(MCP, {});
    assert.deepEqual(later.stateOf(MCP, {}), refused, "a look's ask does not stand over it");
  });

  test("Sign in tries again: a registration that goes through takes the refusal away, and the sign-in waits for its page", async () => {
    const { s, answer, registered } = service(forbidden);
    await assert.rejects(s.start({ name: "figma", url: MCP }));
    answer.register = () => Response.json({ client_id: "c-1" }, { status: 201 });
    const st = await s.start({ name: "figma", url: MCP });
    assert.equal(registered.length, 2);
    assert.equal(s.stateOf(MCP, {})?.state, "waiting");
    s.cancel(st.id);
    assert.equal(s.stateOf(MCP, {}), null, "cancelled, nothing of the refusal is left");
  });

  test("a client a person gives takes it away too", async () => {
    const { s, registered } = service(forbidden);
    await assert.rejects(s.start({ name: "figma", url: MCP }));
    await s.start({ name: "figma", url: MCP, clientId: "made-by-hand" });
    assert.equal(registered.length, 1, "no registration tried with a client given");
    assert.equal(s.stateOf(MCP, {})?.state, "waiting");
  });
});

describe("the page (ui/harness/lib/mcp-list.js)", () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const HOUR = 3_600_000;
  /** Figma's row, from its plugin, as the list answers it. @param {any} [signIn] */
  const figma = (signIn = null) => ({
    name: "figma", kind: "http", spec: { name: "figma", url: MCP }, plugin: "figma@m", pluginTitle: "Figma", pluginOnly: false, pluginPlace: "project:p1",
    sse: false, from: "plugin", on: true, switchedAt: null, replaces: null, orphan: false, own: false, switchedHere: false, test: null, signIn,
  });
  const refusedState = { state: "refused", host: HOST, account: "main", accounts: [], why: "HTTP 403", at: 1_000, docs: DOCS };

  test("a refused row: what happened and when, the service's words on hover, no 'Not tested'; red, and Sign in outlined — it tries again", () => {
    const row = figma(refusedState);
    assert.deepEqual(signInLine(row, 1_000 + 2 * HOUR), { text: `Sign-in refused by ${HOST} · 2 h ago`, bad: true, title: "HTTP 403" });
    assert.deepEqual(rowLines(row, "project", 1_000 + 2 * HOUR).map((l) => l.text), ["On where Figma is on (Library › Plugins & Connectors)", `Sign-in refused by ${HOST} · 2 h ago`]);
    assert.deepEqual([signInOf(row).refused, signInOf(row).asks], [true, false]);
    assert.deepEqual([serviceName(row), serviceName({ name: "linear" })], ["Figma", "Linear"]);
  });

  /** The list on the fake page, Figma's row as `signIn` has it; Sign in answered by `refusal`. @param {any} signIn @param {any} refusal */
  const pageWith = (signIn, refusal) => {
    /** @type {{ path: string, method: string, body: any }[]} */
    const calls = [];
    /** @type {any[]} */
    const dialogs = [];
    /** @type {string[]} */
    const opened = [];
    const api = async (/** @type {string} */ path, /** @type {any} */ opts = {}) => {
      calls.push({ path, method: opts.method || "GET", body: opts.body });
      if (path === "/mcp-servers/sign-in") throw refusal;
      return { scope: "project:p1", at: "project", label: "this project", projectId: "p1", held: false, unread: [], servers: [figma(signIn)] };
    };
    const dialog = (/** @type {any} */ d) => {
      const rec = { ...d, closed: false, close() { rec.closed = true; } };
      dialogs.push(rec);
      return rec;
    };
    const list = createMcpList({ scope: "project:p1", at: "project", now: () => 1_000 + 2 * HOUR },
      /** @type {any} */ ({ h: fakeH, drawIn: fakeDrawIn, api, dialog, menu: () => {}, confirm: async () => true, open: (/** @type {string} */ u) => opened.push(u), later: () => {} }));
    return { calls, dialogs, opened, el: /** @type {any} */ (list.el) };
  };
  const press = (/** @type {any} */ el, /** @type {string} */ words) => {
    const b = buttonsOf(el).find((x) => textOf(x) === words);
    assert.ok(b, `a button "${words}" in: ${textOf(el)}`);
    b.dispatch("click");
  };
  const refusal = (/** @type {any} */ turnedDown, docs = DOCS) =>
    Object.assign(new Error(`figma: api.design.example turned down Filament's registration (HTTP ${turnedDown.status})`), { status: 409, body: { needsClient: true, host: HOST, redirectUri: "http://127.0.0.1:20300/api/mcp-servers/sign-in/back", turnedDown, ...(docs ? { docs } : {}) } });

  test("Sign in turned down: its own sheet, hedged, the status where it gave no words, its guide; the client route folded; the list read again", async () => {
    const t = pageWith({ state: "asks", host: HOST, account: "main", accounts: [] }, refusal({ said: "", status: 403 }));
    await flush();
    const before = t.calls.length;
    press(t.el, "Sign in");
    await flush();
    const d = t.dialogs.at(-1);
    assert.deepEqual([d.title, d.description], ["Figma does not let Filament sign in", HOST]);
    const words = textOf(d.body);
    for (const said of ["Figma may let only apps it has approved sign in.", "Figma answered HTTP 403", "Its guide may show another way to connect.", "I made an app on Figma's site…", "Only where Figma lets you make your own app for this"])
      assert.ok(words.includes(said), `"${said}" in: ${words}`);
    assert.ok(!/lets no app register/.test(words), "not the sheet for a server with no registration");
    press(d.body, "Open Figma's guide");
    assert.deepEqual(t.opened, [DOCS]);
    assert.ok(t.calls.slice(before).some((c) => c.path === "/mcp-servers?scope=project%3Ap1"), "the list read again, to say it was refused");
    press(d.body, "Close");
    assert.equal(d.closed, true);
  });

  test("its own words where it gave them; no guide, no guide button; a refused row's Sign in is outlined", async () => {
    const t = pageWith(refusedState, refusal({ said: "invalid_client_metadata: not on the list", status: 400 }, ""));
    await flush();
    const signIn = buttonsOf(t.el).find((x) => textOf(x) === "Sign in");
    assert.match(String(signIn?.attrs?.class), /zc-btn-v-outline/);
    signIn?.dispatch("click");
    await flush();
    const words = textOf(t.dialogs.at(-1).body);
    assert.ok(words.includes("Figma said: “invalid_client_metadata: not on the list”"), words);
    assert.ok(!words.includes("Its guide") && !buttonsOf(t.dialogs.at(-1).body).some((b) => /guide/.test(textOf(b))));
  });
});

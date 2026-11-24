// @ts-check
// A chat's signed-in connector, reached by its coding agent at Filament's door (http/mcp-connector.js, the owner's of
// 11-07): the agent is given Filament's address for it, and Filament adds the sign-in's token as it forwards each
// request, renewing it there on a 401. The agent holds no token, and a renewal changes nothing it was given, so its
// session goes on (chat-servers.js `chatKeyOf`).
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnectorDoor } from "../src/http/mcp-connector.js";
import { createMcpSignIns } from "../src/app/sessions/mcp-sign-in.js";
import { createSignInStore } from "../src/services/mcp-sign-ins.js";
import { connectMcp } from "../src/adapters/tools/mcp-client.js";
import { chatKeyOf } from "../src/adapters/agents/chat-servers.js";
import { readBody } from "../src/http/guards.js";
import { startOAuthMcp, pressAllow } from "./helpers/oauth-mcp-fake.js";
import { startApp } from "./helpers/app.js";

const root = mkdtempSync(join(tmpdir(), "filament-connector-"));
/** @type {{ close: () => Promise<unknown> }[]} */
const open = [];
after(async () => {
  await Promise.all(open.map((x) => x.close()));
  rmSync(root, { recursive: true, force: true });
});
let dirs = 0;
/** Every token the fake hands out, as they look. */
const TOKEN_RE = /\b(?:at|rt)-\d+-\d+\b/;
/** A sign-in service over its own store, and one of the fake's servers signed in to as `name`. @param {string} name */
const signedIn = async (name) => {
  const f = await startOAuthMcp();
  open.push(f);
  const s = createMcpSignIns({ store: createSignInStore({ dataDir: join(root, `d${++dirs}`) }), selfBase: () => "http://127.0.0.1:4321" });
  const st = await s.start({ name, url: f.url });
  assert.equal((await s.back((await pressAllow(st.url)).searchParams)).ok, true);
  return { f, s };
};
/** The door on a port of its own, as the front door routes `/mcp/c/` to it. @param {ReturnType<typeof createConnectorDoor>} door */
const doorAt = async (door) => {
  const server = createServer(async (req, res) => {
    const p = new URL(String(req.url), "http://x").pathname;
    await door.handle(req, res, p.slice("/mcp/c/".length), req.method === "POST" ? await readBody(req, 1 << 20) : "");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", () => r(null)));
  open.push({ close: () => new Promise((r) => server.close(() => r(null))) });
  return `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
};
/** @param {string} url @param {RequestInit} [init] */
const post = (url, init = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), ...init });

describe("a coding agent's signed-in connector at Filament's door", () => {
  // (fails before: yes — the agent was given the token as the server's header, so a renewal changed its servers' key and
  // its session opened again, its whole conversation written to the provider's cache again)
  test("what the agent is given holds no token and stays the same across a renewal: the door renews on a 401 and asks again", async () => {
    const { f, s } = await signedIn("linear");
    const door = createConnectorDoor({ auth: s.connectorAuth });
    const base = await doorAt(door);
    const asked = [{ name: "linear", url: f.url }];
    /** @param {{ name: string, url: string }} x */
    const give = (x) => door.give(base, "chat-1", x);
    const first = s.forAgent(asked, give);
    assert.match(first.list[0].url, new RegExp(`^${base}/mcp/c/chat-1/linear/[\\w-]{32}$`));
    assert.ok(!TOKEN_RE.test(JSON.stringify(first)), "the agent holds no token");
    const agent = await connectMcp(first.list[0], { timeoutMs: 10_000 });
    assert.equal(await agent.call("whoami", {}), "signed in as test-user (grant 1)");
    const renewals = () => f.seen.token.filter((t) => t.grant_type === "refresh_token").length;
    assert.equal(renewals(), 0);
    f.expireAll();
    assert.equal(await agent.call("whoami", {}), "signed in as test-user (grant 1)", "the server's 401 is answered at the door");
    assert.equal(renewals(), 1);
    await agent.close();
    const later = s.forAgent(asked, give);
    assert.deepEqual(later, first, "the same servers, and the same words, after the renewal");
    assert.equal(chatKeyOf(later.list), chatKeyOf(first.list), "the same key: the agent's session goes on");
  });

  // (the review of 11-07: another chat's signature was a 403, which told a caller the chat held that server)
  test("an address is good for its chat's server alone; a sign-in gone, a server down and a method MCP never sends are refused in words", async () => {
    const { f, s } = await signedIn("linear");
    const door = createConnectorDoor({ auth: s.connectorAuth });
    const base = await doorAt(door);
    const one = door.give(base, "chat-1", { name: "linear", url: f.url });
    const two = door.give(base, "chat-2", { name: "linear", url: f.url });
    const sig = (/** @type {string} */ u) => u.split("/").at(-1);
    assert.notEqual(sig(one.url), sig(two.url), "each chat's own");
    assert.equal((await post(one.url)).status, 200);
    const stolen = await post(`${base}/mcp/c/chat-2/linear/${sig(one.url)}`);
    assert.deepEqual([stolen.status, (await stolen.json()).error], [404, "no connector at this address now: the chat's next turn gives its servers again"], "answered as no server at all");
    const none = await post(`${base}/mcp/c/chat-3/linear/${sig(one.url)}`);
    assert.deepEqual([none.status, (await none.json()).error], [404, "no connector at this address now: the chat's next turn gives its servers again"]);
    assert.equal((await post(one.url, { method: "PUT" })).status, 405);
    const seen = f.seen.mcpAuth.length;
    assert.equal(s.signOut(f.url).signedOut, true);
    const out = await post(one.url);
    assert.deepEqual([out.status, (await out.json()).error], [401, `Filament holds no sign-in for linear at ${new URL(f.url).host} now: sign in again in Library › Plugins & Connectors`]);
    assert.equal(f.seen.mcpAuth.length, seen, "nothing sent the server with no token");
    const down = createConnectorDoor({ auth: { header: async () => "Bearer t", renew: async () => ({ ok: false }) } });
    const downBase = await doorAt(down);
    const gone = await post(down.give(downBase, "c", { name: "x", url: "http://127.0.0.1:9/mcp" }).url);
    assert.equal(gone.status, 502);
    assert.match((await gone.json()).error, /^x at 127\.0\.0\.1:9 did not answer: /);
  });

  // (the review of 11-07: a configured header named in another case went beside the agent's own, both sent)
  test("what goes on is MCP's own headers, the server's configured ones and Filament's token, never the agent's authorization or cookies; one name, one header", async () => {
    /** @type {{ url: string, init: any }[]} */
    const seen = [];
    const door = createConnectorDoor({
      auth: { header: async () => "Bearer from-filament", renew: async () => ({ ok: false }) },
      fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
        seen.push({ url, init });
        return new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "s9", "set-cookie": "a=b" } });
      }),
    });
    const base = await doorAt(door);
    const given = door.give(base, "c", { name: "n", url: "https://srv.example/mcp", headers: { "X-Team": "t", Accept: "text/plain" } });
    assert.equal("headers" in given, false, "the configured headers stay at the door");
    const r = await post(given.url, { headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "s9", authorization: "Bearer agent", cookie: "x=y" } });
    assert.deepEqual([r.status, r.headers.get("mcp-session-id"), r.headers.get("set-cookie")], [200, "s9", null]);
    assert.equal(seen[0].url, "https://srv.example/mcp");
    assert.deepEqual(seen[0].init.headers, { "x-team": "t", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-session-id": "s9", authorization: "Bearer from-filament" });
    assert.equal(seen[0].init.body, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  });

  // (fails before: yes — the codebase review of 11-23: the door's fetch followed any redirect, the server's configured
  // headers going on to whatever address it named; and with the provider fetch's redirects refused, a server's own
  // /mcp → /mcp/ came back to the agent a bare 307)
  test("a 307 or 308 to the server's own origin is followed with its method, body and token; one elsewhere, one that changes the request, or past three, fails in words and sends nothing elsewhere", async () => {
    /** @type {{ url: string, method: string, body: any, auth: string, redirect: string }[]} */
    const seen = [];
    /** @type {Record<string, () => Response>} */
    const answers = {
      "https://srv.example/mcp": () => new Response(null, { status: 307, headers: { location: "/mcp/" } }),
      "https://srv.example/mcp/": () => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { status: 200, headers: { "content-type": "application/json" } }),
      "https://srv.example/away": () => new Response(null, { status: 308, headers: { location: "https://other.example/mcp" } }),
      "https://srv.example/moved": () => new Response(null, { status: 302, headers: { location: "/mcp/" } }),
      "https://srv.example/loop": () => new Response(null, { status: 307, headers: { location: "/loop" } }),
    };
    const door = createConnectorDoor({
      auth: { header: async () => "Bearer from-filament", renew: async () => ({ ok: false }) },
      fetchImpl: /** @type {any} */ (async (/** @type {string} */ url, /** @type {any} */ init) => {
        seen.push({ url, method: init.method, body: init.body, auth: init.headers.authorization, redirect: init.redirect });
        return (answers[url] || (() => new Response("no", { status: 500 })))();
      }),
    });
    const base = await doorAt(door);
    const at = (/** @type {string} */ path) => door.give(base, "c", { name: "n", url: `https://srv.example${path}` }).url;
    const r = await post(at("/mcp"));
    assert.equal(r.status, 200);
    assert.deepEqual(seen.map((s) => [s.url, s.method, s.auth, s.redirect]), [
      ["https://srv.example/mcp", "POST", "Bearer from-filament", "manual"],
      ["https://srv.example/mcp/", "POST", "Bearer from-filament", "manual"],
    ]);
    assert.equal(seen[1].body, seen[0].body, "its body with it");
    for (const [path, status, to] of /** @type {const} */ ([["/away", 308, "https://other.example/mcp"], ["/moved", 302, "/mcp/"], ["/loop", 307, "/loop"]])) {
      seen.length = 0;
      const no = await post(at(path));
      assert.equal(no.status, 502, path);
      assert.equal((await no.json()).error, `n at srv.example answered with a redirect (HTTP ${status} to ${to}): a call with its key goes to the address kept and never on elsewhere, so set its address to where it answers`);
      assert.ok(seen.length > 0 && seen.every((s) => s.url.startsWith("https://srv.example/")), `${path}: nothing went elsewhere`);
    }
    assert.equal(seen.length, 4, "past three redirects, no fourth");
  });

  // (the review of 11-07: an address was good for good — kept by a key on disk, and its server held after the chat let
  // it go — and Node's own fetch gave up on a server silent for five minutes)
  test("an address is this run's and its chat's turn's: another run gives another, and a server the chat no longer gives answers no more; no time limit on the server", async () => {
    const auth = { header: async () => "Bearer t", renew: async () => ({ ok: false }) };
    const spec = { name: "n", url: "https://s/mcp" };
    assert.notEqual(createConnectorDoor({ auth }).give("http://h", "c", spec).url, createConnectorDoor({ auth }).give("http://h", "c", spec).url, "each run its own key");
    const door = createConnectorDoor({ auth, fetchImpl: /** @type {any} */ (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) });
    const base = await doorAt(door);
    const kept = door.give(base, "c", spec);
    const other = door.give(base, "d", spec);
    assert.equal((await post(kept.url)).status, 200);
    door.forget("c");
    assert.equal((await post(kept.url)).status, 404, "let go with the chat's turn");
    assert.equal((await post(other.url)).status, 200, "another chat's stays");
    assert.equal(door.give(base, "c", spec).url, kept.url, "given again, the same address");
    const source = readFileSync(new URL("../src/http/mcp-connector.js", import.meta.url), "utf8");
    assert.match(source, /fetchImpl = providerFetch\b/, "the fetch that waits as long as the server takes");
  });

  // (the review of 11-07: a renewal that failed for now, or a sign-in that could not be read, told the agent to sign in
  // again — a 401, which sends its client into its own sign-in — and a 401 renewed again even where another request had
  // renewed it already)
  test("no token now: a sign-in that ended or none asks to sign in (401); one that could not be renewed just now asks again (503, Retry-After); a newer token goes before a renewal", async () => {
    /** @type {string[]} */
    let sent = [];
    let renewals = 0;
    /** @type {string | null} */
    let token = "Bearer t1";
    /** @type {"in" | "ended" | "none"} */
    let standing = "in";
    let throws = false;
    const door = createConnectorDoor({
      auth: {
        header: async () => {
          if (throws) throw new Error("the store could not be read");
          return token;
        },
        renew: async () => (renewals++, { ok: false }),
        standing: () => standing,
      },
      fetchImpl: /** @type {any} */ (async (/** @type {string} */ _url, /** @type {any} */ init) => {
        sent.push(init.headers.authorization);
        if (init.headers.authorization === "Bearer t1") {
          token = "Bearer t2";
          return new Response("{}", { status: 401 });
        }
        return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
      }),
    });
    const base = await doorAt(door);
    const at = door.give(base, "c", { name: "n", url: "https://s/mcp" }).url;
    assert.equal((await post(at)).status, 200);
    assert.deepEqual([sent, renewals], [["Bearer t1", "Bearer t2"], 0], "renewed meanwhile: the newer token, no renewal");
    token = null;
    const later = await post(at);
    assert.deepEqual([later.status, later.headers.get("retry-after"), (await later.json()).error], [503, "30", "Filament could not renew the sign-in for n at s just now: ask again in a moment"]);
    standing = "ended";
    const ended = await post(at);
    assert.deepEqual([ended.status, (await ended.json()).error], [401, "Filament holds no sign-in for n at s now: sign in again in Library › Plugins & Connectors"]);
    throws = true;
    assert.equal((await post(at)).status, 503, "a sign-in that could not be read: ask again");
  });

  // (fails before: yes — /mcp/c/ was read as an agent's door token, and answered as one that names no session)
  test("Filament's front door sends /mcp/c/ to the connector door", async () => {
    const app = await startApp();
    try {
      const r = await post(`${app.url}/mcp/c/chat-1/linear/${"x".repeat(32)}`);
      assert.deepEqual([r.status, (await r.json()).error], [404, "no connector at this address now: the chat's next turn gives its servers again"]);
    } finally {
      await app.stop();
    }
  });
});

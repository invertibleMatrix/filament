// @ts-check
// HarnessV4_Settings_Plan HS-7, the server half: signing in to a remote MCP server. The pure parts (the challenge,
// the metadata addresses, PKCE, which endpoints a sign-in may go to, a token answer), the store that keeps the tokens
// sealed, the sign-in itself against a fake OAuth server on 127.0.0.1 (HC-142 to HC-161), Filament's own agent renewing
// a token on a 401, a coding agent given the token as its server's header, the admin rows, and a whole turn on the
// native loop. The page half is in mcp-servers-ui.test.js.
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressOf, authorizeUrl, bearerChallenge, endpointProblem, issuerMetadataUrls, ownAuthorization, pkcePair, resourceMetadataUrls, tokensFrom } from "../src/core/oauth.js";
import { SIGN_INS_FILE, createSignInStore } from "../src/services/mcp-sign-ins.js";
import { isSealed } from "../src/services/config/secrets.js";
import { createMcpSignIns, BACK_PATH } from "../src/app/sessions/mcp-sign-in.js";
import { connectMcp } from "../src/adapters/tools/mcp-client.js";
import { createMcpServers, testWords } from "../src/app/sessions/mcp-servers.js";
import { mcpServerRoutes } from "../src/http/admin/mcp-servers.js";
import { createRouter } from "../src/http/router.js";
import { createConfigStore } from "../src/services/config/store.js";
import { MemoryService } from "../src/services/memory/index.js";
import { sidecar } from "../src/adapters/sidecar/index.js";
import { createSessions } from "../src/app/sessions/service.js";
import { startOAuthMcp, pressAllow } from "./helpers/oauth-mcp-fake.js";
import { startApp, fakeUpstream, anthropicReply } from "./helpers/app.js";
import { removeDirs } from "./helpers/wait.js";

const root = mkdtempSync(join(tmpdir(), "filament-signin-"));
after(() => rmSync(root, { recursive: true, force: true }));
let dirs = 0;
/** A sign-in service over its own store, as Filament on port 4321 would have it. @param {Record<string, any>} [o] */
const signInsAt = (o = {}) => {
  const dataDir = o.dataDir || join(root, `d${++dirs}`);
  return { dataDir, s: createMcpSignIns({ store: createSignInStore({ dataDir }), selfBase: () => "http://127.0.0.1:4321", ...o }) };
};
const BACK = `http://127.0.0.1:4321${BACK_PATH}`;
/** Every token the fake handed out, as they look. */
const TOKEN_RE = /\b(?:at|rt)-\d+-\d+\b|\bcode-\d+\b/;
/** Sign in to a fake's server through to the stored tokens. @param {any} s @param {any} fake @param {string} [name] */
const signedIn = async (s, fake, name = "linear") => {
  const st = await s.start({ name, url: fake.url });
  const said = await s.back((await pressAllow(st.url)).searchParams);
  assert.equal(said.ok, true, said.words);
  return st;
};

describe("the pure parts (core/oauth.js)", () => {
  // (fails before: yes — Filament read no WWW-Authenticate, and a 401 was "Check the Authorization header")
  test("a Bearer challenge is read among others, quoted or not; none is null", () => {
    assert.deepEqual(bearerChallenge('Basic realm="x", Bearer resource_metadata="https://a.dev/.well-known/oauth-protected-resource", scope="read write", error=invalid_token'), {
      resourceMetadata: "https://a.dev/.well-known/oauth-protected-resource",
      scope: "read write",
      error: "invalid_token",
    });
    assert.deepEqual(bearerChallenge("Bearer"), {});
    assert.deepEqual(bearerChallenge('Bearer error_description="say \\"no\\""'), { description: 'say "no"' });
    assert.equal(bearerChallenge('Basic realm="x"'), null);
    assert.equal(bearerChallenge(null), null);
  });

  // (fails before: yes — no sign-in, so no address one is kept under or endpoint rule)
  test("HS-D82, HC-160: a sign-in is kept by the address without its fragment; endpoints are https, or on this computer", () => {
    assert.equal(addressOf("https://MCP.Linear.app/mcp#x"), "https://mcp.linear.app/mcp");
    for (const ok of ["https://auth.example.com/token", "http://127.0.0.1:9/token", "http://localhost:9/t", "http://[::1]:9/t", "http://a.localhost/t"])
      assert.equal(endpointProblem(ok, "token address"), null, ok);
    assert.equal(endpointProblem("http://auth.example.com/token", "token address"), "its token address is reached over plain http at auth.example.com: a sign-in goes only over https, or to this computer");
    assert.match(String(endpointProblem("nope", "sign-in page")), /is not an address/);
  });

  // (fails before: yes — no metadata was looked for)
  test("HS-D84: the metadata addresses in the spec's order — the resource's under its path first, the issuer's with its path put in", () => {
    assert.deepEqual(resourceMetadataUrls("https://a.dev/v1/mcp/"), ["https://a.dev/.well-known/oauth-protected-resource/v1/mcp", "https://a.dev/.well-known/oauth-protected-resource"]);
    assert.deepEqual(resourceMetadataUrls("https://a.dev"), ["https://a.dev/.well-known/oauth-protected-resource"]);
    assert.deepEqual(issuerMetadataUrls("https://auth.dev/tenant1"), [
      "https://auth.dev/.well-known/oauth-authorization-server/tenant1",
      "https://auth.dev/.well-known/openid-configuration/tenant1",
      "https://auth.dev/tenant1/.well-known/openid-configuration",
    ]);
    assert.deepEqual(issuerMetadataUrls("https://auth.dev/"), ["https://auth.dev/.well-known/oauth-authorization-server", "https://auth.dev/.well-known/openid-configuration"]);
  });

  // (fails before: yes — no PKCE)
  test("PKCE S256 matches RFC 7636's own example; the authorization request keeps the endpoint's query and leaves out an empty scope", () => {
    const bytes = Buffer.from([116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240, 91, 88, 5, 88, 83, 132, 141, 121]);
    assert.deepEqual(pkcePair(bytes), { verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM" });
    const u = new URL(authorizeUrl("https://auth.dev/authorize?tenant=7", { clientId: "c", redirectUri: BACK, challenge: "ch", state: "st", resource: "https://a.dev/mcp" }));
    assert.deepEqual(Object.fromEntries(u.searchParams), { tenant: "7", response_type: "code", client_id: "c", redirect_uri: BACK, code_challenge: "ch", code_challenge_method: "S256", state: "st", resource: "https://a.dev/mcp" });
  });

  // (fails before: yes — no token answer was read)
  test("a token answer: its life from now, a refresh token where given; another type than Bearer, or no token, is refused in words", () => {
    assert.deepEqual(tokensFrom({ access_token: "a", token_type: "bearer", expires_in: 60, refresh_token: "r", scope: "s" }, 1000), { accessToken: "a", refreshToken: "r", expiresAt: 61_000, scope: "s" });
    assert.deepEqual(tokensFrom({ access_token: "a" }, 1000), { accessToken: "a" });
    assert.throws(() => tokensFrom({ access_token: "a", token_type: "DPoP" }, 0), /gave a DPoP token, and Filament sends only Bearer tokens/);
    assert.throws(() => tokensFrom({}, 0), /holds no access token/);
    assert.equal(ownAuthorization({ AUTHORIZATION: "x" }), true);
    assert.equal(ownAuthorization({ accept: "x" }), false);
  });
});

describe("the store (HC-157, HC-161)", () => {
  // (fails before: yes — there was no store of sign-ins)
  test("tokens and a client secret lie sealed in mcp-sign-ins.json, open again from the file; off, they are plain; an ended sign-in keeps no token", () => {
    const dataDir = join(root, "store");
    const store = createSignInStore({ dataDir });
    const rec = { issuer: "https://a.dev", tokenEndpoint: "https://a.dev/token", clientId: "c1", clientSecret: "cs-123", authMethod: "client_secret_basic", resource: "https://a.dev/mcp", accessToken: "at-77-1", refreshToken: "rt-77-1", expiresAt: 5, at: 1 };
    store.put("https://a.dev/mcp", rec);
    store.putClient("https://a.dev|back", { clientId: "c1", clientSecret: "cs-123", authMethod: "client_secret_basic", at: 1 });
    const raw = readFileSync(join(dataDir, SIGN_INS_FILE), "utf8");
    for (const secret of ["at-77-1", "rt-77-1", "cs-123"]) assert.ok(!raw.includes(secret), `${secret} is not in the file`);
    const onDisk = JSON.parse(raw);
    assert.ok(isSealed(onDisk.signIns["https://a.dev/mcp"].accessToken) && isSealed(onDisk.clients["https://a.dev|back"].clientSecret));
    const again = createSignInStore({ dataDir });
    assert.deepEqual(again.get("https://a.dev/mcp"), rec, "read back open");
    assert.equal(again.client("https://a.dev|back")?.clientSecret, "cs-123");
    again.end("https://a.dev/mcp", "invalid_grant", 9);
    const ended = createSignInStore({ dataDir }).get("https://a.dev/mcp");
    assert.deepEqual([ended?.accessToken, ended?.refreshToken, ended?.ended], [undefined, undefined, { at: 9, why: "invalid_grant" }]);
    const plainDir = join(root, "plain");
    createSignInStore({ dataDir: plainDir, encrypt: () => false }).put("x", rec);
    assert.ok(readFileSync(join(plainDir, SIGN_INS_FILE), "utf8").includes("at-77-1"), "encryptSecrets off writes plain, as config.json does");
  });

  // (fails before: yes — there was no store of sign-ins)
  test("a file sealed with another key is said in the log and its sign-ins are signed in again; a broken file is said too", () => {
    const dataDir = join(root, "other-key");
    createSignInStore({ dataDir }).put("https://a.dev/mcp", { issuer: "i", tokenEndpoint: "t", clientId: "c", authMethod: "none", resource: "r", accessToken: "at-1-1", at: 1 });
    rmSync(join(dataDir, "secret.key"));
    /** @type {string[]} */
    const logs = [];
    const store = createSignInStore({ dataDir, log: (_l, m) => logs.push(m) });
    assert.equal(store.get("https://a.dev/mcp"), null);
    assert.match(logs.join("\n"), /1 could not be opened \(sealed with another secret\.key\?\) and must be signed in again: https:\/\/a\.dev\/mcp/);
  });
});

describe("the sign-in, against a fake OAuth server", () => {
  /** @type {any[]} */
  const fakes = [];
  const fake = async (/** @type {any} */ o = {}) => {
    const f = await startOAuthMcp(o);
    fakes.push(f);
    return f;
  };
  after(() => Promise.all(fakes.map((f) => f.close())));

  // (fails before: yes — a server that asked for a sign-in could only be given a header by hand)
  test("HC-143: registration, the page with S256, state and resource, the code back, the tokens kept; the row waits, then is signed in", async () => {
    const f = await fake();
    const { s } = signInsAt();
    const st = await s.start({ name: "linear", url: f.url });
    assert.equal(st.host, new URL(f.url).host);
    assert.deepEqual(f.seen.registered.map((r) => [r.client_name, r.redirect_uris, r.token_endpoint_auth_method]), [["Filament", [BACK], "none"]]);
    const q = Object.fromEntries(new URL(st.url).searchParams);
    assert.deepEqual([q.response_type, q.client_id, q.redirect_uri, q.code_challenge_method, q.resource], ["code", "client-1", BACK, "S256", f.url]);
    assert.ok(q.state.length >= 40 && q.code_challenge.length === 43);
    assert.deepEqual(s.stateOf(f.url, {}), { state: "waiting", host: st.host, account: "main", accounts: [], id: st.id, page: st.url });
    assert.equal(s.status(st.id).status, "waiting");
    const said = await s.back((await pressAllow(st.url)).searchParams);
    assert.deepEqual(said, { ok: true, words: "Signed in to linear: you can close this tab and go back to Filament." });
    const asked = /** @type {Record<string, string>} */ (f.seen.token.at(-1));
    assert.deepEqual([asked.grant_type, asked.redirect_uri, asked.resource, asked.client_id], ["authorization_code", BACK, f.url, "client-1"]);
    assert.ok(asked.code_verifier.length >= 43, "the verifier went with the code");
    assert.deepEqual(s.status(st.id), { status: "done", words: `Signed in on ${st.host}`, name: "linear", host: st.host });
    assert.equal(s.status(st.id).status, "gone", "a finished sign-in is told once");
    assert.deepEqual(s.stateOf(f.url, {}), { state: "in", host: st.host, account: "main", accounts: ["main"] });
    assert.match(String(await s.auth.header(f.url, {})), /^Bearer at-1-\d+$/);
  });

  // (fails before: yes — there was no sign-in to end)
  test("HC-144, HC-145, HC-158: Deny keeps nothing; Cancel and a second Sign in refuse the earlier return; a return is good once", async () => {
    const denied = await fake({ deny: true });
    const { s } = signInsAt();
    const st = await s.start({ name: "linear", url: denied.url });
    assert.deepEqual(await s.back((await pressAllow(st.url)).searchParams), { ok: false, words: "linear's sign-in did not finish: you said no on its page." });
    assert.deepEqual(s.status(st.id), { status: "failed", words: "you said no on its page", name: "linear", host: st.host });
    assert.equal(s.stateOf(denied.url, {}), null, "nothing kept");

    const f = await fake();
    const first = await s.start({ name: "linear", url: f.url });
    const firstBack = await pressAllow(first.url);
    assert.deepEqual(s.cancel(first.id), { cancelled: true });
    assert.match((await s.back(firstBack.searchParams)).words, /^Filament is not waiting for this sign-in: it was cancelled or started again, or Filament restarted since/);
    const a = await s.start({ name: "linear", url: f.url });
    const b = await s.start({ name: "linear", url: f.url });
    assert.equal(f.seen.registered.length, 1, "the registration is kept for the next sign-in");
    const aBack = await pressAllow(a.url);
    const bBack = await pressAllow(b.url);
    assert.equal((await s.back(aBack.searchParams)).ok, false, "the first was replaced");
    assert.equal(s.status(a.id).status, "gone");
    assert.equal((await s.back(bBack.searchParams)).ok, true);
    assert.equal((await s.back(bBack.searchParams)).ok, false, "a state is good once");
  });

  // (fails before: yes — there was no sign-in to check)
  test("HC-159, HC-160: metadata that names another issuer, or an authorization server over plain http elsewhere, is refused and opens nothing", async () => {
    const f = await fake({ issuer: "http://127.0.0.1:1/someone-else" });
    const { s } = signInsAt();
    await assert.rejects(s.start({ name: "linear", url: f.url }), (/** @type {any} */ e) => e.status === 400 && /its authorization server's metadata names another server \(http:\/\/127\.0\.0\.1:1\/someone-else\)/.test(e.message));
    assert.equal(f.seen.authorize.length + f.seen.registered.length, 0);
    /** A server out there whose metadata names an authorization server over plain http. @type {typeof fetch} */
    const fetchImpl = async (url) => {
      const u = String(url);
      if (u === "https://srv.example/mcp") return new Response("{}", { status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://srv.example/.well-known/oauth-protected-resource/mcp"' } });
      if (u.endsWith("/oauth-protected-resource/mcp")) return Response.json({ resource: "https://srv.example/mcp", authorization_servers: ["http://auth.example.com"] });
      return new Response("", { status: 404 });
    };
    const { s: out } = signInsAt({ fetchImpl });
    await assert.rejects(out.start({ name: "far", url: "https://srv.example/mcp" }), /far: srv\.example: its authorization server is reached over plain http at auth\.example\.com: a sign-in goes only over https, or to this computer/);
    // The iss the page comes back with must be the issuer's (RFC 9207).
    const g = await fake();
    const st = await s.start({ name: "linear", url: g.url });
    const back = await pressAllow(st.url);
    back.searchParams.set("iss", "https://evil.example");
    assert.deepEqual(await s.back(back.searchParams), { ok: false, words: "linear's sign-in did not finish: the page that answered names another server (https://evil.example)." });
  });

  // (fails before: yes — a server with no registration could not be signed in)
  test("HC-153: a server that lets no app register asks for the client made on its site, with the address to make it with; a secret goes as Basic, sealed", async () => {
    const f = await fake({ register: false });
    const { s, dataDir } = signInsAt();
    await assert.rejects(s.start({ name: "gh", url: f.url }), (/** @type {any} */ e) => e.status === 409 && e.extra?.needsClient === true && e.extra.redirectUri === BACK && /lets no app register itself: give the client ID you made on its site/.test(e.message));
    f.addClient("hand-made", [BACK], "s3cret-xyz");
    const st = await s.start({ name: "gh", url: f.url, clientId: "hand-made", clientSecret: "s3cret-xyz" });
    assert.equal(new URL(st.url).searchParams.get("client_id"), "hand-made");
    assert.equal((await s.back((await pressAllow(st.url)).searchParams)).ok, true);
    assert.equal(f.seen.token.at(-1)?.client_id, undefined, "the client went as Basic, not in the form");
    assert.ok(!readFileSync(join(dataDir, SIGN_INS_FILE), "utf8").includes("s3cret-xyz"), "the secret lies sealed");
  });

  // (fails before: yes — every 401 read "Check the Authorization header")
  test("HC-154 to HC-156: own Authorization header, no sign-in on offer, a page on another computer — each refused in words, nothing opened", async () => {
    const f = await fake({ challenge: false, prm: false });
    const { s } = signInsAt();
    await assert.rejects(s.start({ name: "k", url: f.url, headers: { Authorization: "Bearer mine" } }), (/** @type {any} */ e) => e.status === 409 && /k carries its own Authorization header, which goes as written: take it off in Edit to sign in instead/.test(e.message));
    assert.equal(s.stateOf(f.url, { authorization: "Bearer mine" }), null);
    assert.equal(await s.auth.header(f.url, { Authorization: "x" }), null);
    await assert.rejects(s.start({ name: "k", url: f.url }), (/** @type {any} */ e) => e.status === 400 && e.extra?.none === true && new RegExp(`k: ${new URL(f.url).host} offers no sign-in: give it a key in Edit, as its Authorization header`).test(e.message));
    const before = f.seen.mcpAuth.length;
    await assert.rejects(s.start({ name: "k", url: f.url, remote: true }), /Sign in from a browser on Filament's computer: .* sends the browser back to 127\.0\.0\.1, which is Filament only there/);
    assert.equal(f.seen.mcpAuth.length, before, "nothing was asked of the server");
  });

  // (fails before: yes — the 2025-03-26 way was not known)
  test("a server with a bare challenge and no metadata is its own authorization server, at /authorize, /token and /register", async () => {
    const f = await fake({ legacy: true, challenge: "bare" });
    const { s } = signInsAt();
    const st = await s.start({ name: "old", url: f.url });
    assert.equal(new URL(st.url).pathname, "/authorize");
    assert.equal((await s.back((await pressAllow(st.url)).searchParams)).ok, true);
    assert.deepEqual(s.stateOf(f.url, {}), { state: "in", host: st.host, account: "main", accounts: ["main"] });
  });

  // (fails before: yes — nothing was kept)
  test("HC-161: after a restart the sign-in is there from the file; one in progress is gone, and its return says to start again", async () => {
    const f = await fake();
    const first = signInsAt();
    await signedIn(first.s, f);
    const waiting = await first.s.start({ name: "linear2", url: f.url.replace("/mcp", "/mcp?x=1") });
    const back = await pressAllow(waiting.url);
    const { s } = signInsAt({ dataDir: first.dataDir });
    assert.deepEqual(s.stateOf(f.url, {}), { state: "in", host: new URL(f.url).host, account: "main", accounts: ["main"] });
    assert.match((await s.back(back.searchParams)).words, /Filament restarted since\. Press Sign in again on the server's row\./);
  });
});

describe("the token on the wire: Filament's own agent (HC-146 to HC-148) and a coding agent (HC-149)", () => {
  /** @type {any[]} */
  const fakes = [];
  after(() => Promise.all(fakes.map((f) => f.close())));

  // (fails before: yes — a pooled connection carried the header it was opened with, and a 401 ended the call)
  test("each request carries the token; a run-out token is renewed once, however many calls meet it; a refused renewal ends the sign-in and the connection", async () => {
    const f = await startOAuthMcp();
    fakes.push(f);
    const { s } = signInsAt();
    await signedIn(s, f);
    const c = await connectMcp({ name: "linear", url: f.url }, { timeoutMs: 10_000, auth: s.auth });
    assert.deepEqual(c.tools.map((t) => [t.name, t.readOnly]), [["mcp__linear__whoami", true]]);
    assert.equal(await c.call("whoami", {}), "signed in as test-user (grant 1)");
    assert.ok(f.seen.mcpAuth.slice(-3).every((a) => /^Bearer at-1-\d+$/.test(a)));
    f.expireAll();
    const renewalsBefore = f.seen.token.filter((t) => t.grant_type === "refresh_token").length;
    assert.deepEqual(await Promise.all([c.call("whoami", {}), c.call("whoami", {})]), ["signed in as test-user (grant 1)", "signed in as test-user (grant 1)"]);
    assert.equal(f.seen.token.filter((t) => t.grant_type === "refresh_token").length - renewalsBefore, 1, "two calls met the 401: one renewal");
    assert.equal(c.alive(), true);
    f.revokeAll();
    const host = new URL(f.url).host;
    await assert.rejects(c.call("whoami", {}), (/** @type {any} */ e) => e.data?.signIn === true && e.message === `linear: whoami: signed out by ${host}: sign in again in Library › Plugins & Connectors`);
    assert.equal(c.alive(), false, "the pool connects it anew next turn");
    assert.deepEqual(s.stateOf(f.url, {}), { state: "ended", host, account: "main", accounts: ["main"], why: `${host} refused (invalid_grant: the refresh token is no good)` });
    await assert.rejects(connectMcp({ name: "linear", url: f.url }, { timeoutMs: 10_000, auth: s.auth }), new RegExp(`linear: initialize: signed out by ${host.replace(/\./g, "\\.")}: sign in again`));
    await c.close();
  });

  // (fails before: yes — the test said "The server refused: 401. Check the Authorization header.")
  test("HC-142: a server that asks for a sign-in Filament does not hold: the test says so, and the row is offered Sign in", async () => {
    const f = await startOAuthMcp();
    fakes.push(f);
    const { s } = signInsAt();
    const spec = { name: "linear", url: f.url };
    const e = await connectMcp(spec, { timeoutMs: 10_000, auth: s.auth }).then(() => null, (x) => x);
    assert.equal(e?.data?.signIn, true);
    assert.deepEqual(testWords(e, spec), { words: "It needs you to sign in", signIn: true });
    assert.deepEqual(s.stateOf(f.url, {}), { state: "asks", host: new URL(f.url).host, account: "main", accounts: [] });
    const plain = await startOAuthMcp({ challenge: false });
    fakes.push(plain);
    const e2 = await connectMcp({ name: "k", url: plain.url }, { timeoutMs: 10_000, auth: s.auth }).then(() => null, (x) => x);
    assert.deepEqual(testWords(e2, { name: "k", url: plain.url }), { words: "The server refused: 401. Check the Authorization header." }, "no challenge: a key is what it wants");
  });

  // (fails before: yes — a coding agent was given the token as the server's header, and each renewal changed its list)
  test("HC-149: a coding agent is given a signed-in server at Filament's door, nothing renewed for it; an ended sign-in is left out; the words hold no token", async () => {
    const live = await startOAuthMcp();
    const gone = await startOAuthMcp();
    fakes.push(live, gone);
    const { s } = signInsAt();
    await signedIn(s, live, "live");
    await signedIn(s, gone, "gone");
    gone.revokeAll();
    gone.expireAll();
    await s.auth.renew(gone.url, {});
    const stdio = { name: "fs", command: "fs-server" };
    const own = { name: "own", url: live.url.replace("/mcp", "/mcp2"), headers: { Authorization: "Bearer mine" } };
    const unsigned = { name: "other", url: "https://other.example/mcp" };
    /** @type {any[]} */
    const handed = [];
    /** @param {any} x */
    const give = (x) => (handed.push(x), { name: x.name, url: `http://127.0.0.1:4321/mcp/c/chat/${x.name}/sig` });
    const r = s.forAgent(/** @type {any[]} */ ([stdio, { name: "live", url: live.url, headers: { Accept: "x" } }, { name: "gone", url: gone.url }, own, unsigned]), give);
    assert.deepEqual(r.list.map((x) => x.name), ["fs", "live", "own", "other"]);
    assert.deepEqual([r.list[0], r.list[2], r.list[3]], [stdio, own, unsigned], "the others as written");
    assert.deepEqual(handed, [{ name: "live", url: live.url, headers: { Accept: "x" } }], "the signed-in one alone goes to the door");
    assert.equal(r.list[1].url, "http://127.0.0.1:4321/mcp/c/chat/live/sig");
    assert.equal(live.seen.token.filter((t) => t.grant_type === "refresh_token").length, 0, "nothing renewed to give it");
    assert.deepEqual(r.words, [
      `mcp: the chat's server live is given through Filament, with its sign-in on ${new URL(live.url).host}`,
      `mcp: the chat's server gone is left out: signed out by ${new URL(gone.url).host} (sign in again in Library › Plugins & Connectors)`,
    ]);
    assert.ok(!TOKEN_RE.test(JSON.stringify(r)));
  });

  // (fails before: yes — a sign-in kept its token's life, which only a coding agent's open read, to renew it early)
  test("a token that lives five minutes is renewed once it has run out, not before; a sign-in keeps no life of it", async () => {
    const brief = await startOAuthMcp({ ttl: 300 });
    fakes.push(brief);
    let clock = Date.now();
    const { s, dataDir } = signInsAt({ now: () => clock });
    await signedIn(s, brief, "brief");
    const renewals = () => brief.seen.token.filter((t) => t.grant_type === "refresh_token").length;
    const first = await s.auth.header(brief.url, {});
    clock += 240_000;
    assert.equal(await s.auth.header(brief.url, {}), first, "the same header while it lasts");
    assert.equal(renewals(), 0);
    clock += 120_000;
    const later = await s.auth.header(brief.url, {});
    assert.equal(renewals(), 1, "run out: renewed");
    assert.notEqual(later, first);
    const kept = JSON.parse(readFileSync(join(dataDir, SIGN_INS_FILE), "utf8"));
    assert.ok(!JSON.stringify(kept).includes('"life"'), "no life kept");
    // An ended sign-in keeps no token, and no run-out or life of one.
    const rec = createSignInStore({ dataDir: join(root, "no-life") });
    rec.put("a", { issuer: "i", tokenEndpoint: "t", clientId: "c", authMethod: "none", resource: "r", accessToken: "x", expiresAt: 5, life: 9, at: 1 });
    rec.end("a", "why", 2);
    assert.deepEqual(Object.keys(rec.get("a") || {}).sort(), ["at", "authMethod", "clientId", "ended", "issuer", "resource", "tokenEndpoint"]);
  });

  // (fails before: yes — a renewal that gave no expiry kept the old one, run out, so each request renewed again)
  test("a renewal whose answer gives no expiry keeps none: the next request sends the renewed token as it is", async () => {
    const f = await startOAuthMcp({ renewedForever: true });
    fakes.push(f);
    let clock = Date.now();
    const { s } = signInsAt({ now: () => clock });
    await signedIn(s, f);
    const renewals = () => f.seen.token.filter((t) => t.grant_type === "refresh_token").length;
    clock += 3_700_000;
    const renewed = await s.auth.header(f.url, {});
    assert.equal(renewals(), 1, "run out: renewed");
    assert.equal(await s.auth.header(f.url, {}), renewed);
    assert.equal(renewals(), 1, "not renewed again");
  });
});

describe("the admin rows (HC-142, HC-143, HC-150 to HC-152, HC-157)", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-signin-rows-"));
  const folder = mkdtempSync(join(dir, "project-"));
  const config = createConfigStore({ dataDir: dir });
  config.set({ ...config.get(), memory: { ...config.get().memory, enabled: true } });
  const memory = new MemoryService(/** @type {any} */ ({
    sidecar, getConfig: config.get, dataDir: dir, log: () => {}, selfBase: () => "http://127.0.0.1:20399", getModelNames: () => ["cheap"], now: Date.now,
  }));
  memory.start();
  const record = { record: () => {}, list: () => [] };
  const sessions = createSessions(/** @type {any} */ ({ memory, config, pipeline: { handle() {} }, ops: record, log: () => {}, forkSession: async () => ({}), mcpTests: new Map() }));
  const mcpSignIns = createMcpSignIns({ store: createSignInStore({ dataDir: dir }), selfBase: () => "http://127.0.0.1:4321" });
  const mcpServers = createMcpServers({ sessions, memory, config, home: dir, signIns: mcpSignIns });
  const a = { mcpServers, mcpSignIns, config };
  const route = createRouter(mcpServerRoutes(a));
  /** Every answer the rows gave, for the sweep at the end. @type {string[]} */
  const answers = [];
  /**
   * A row answered, as the admin handler hands it a path: without `/api`, which the browser's return carries.
   * @param {string} method @param {string} path @param {any} [body] @param {string} [from]
   */
  const call = async (method, path, body = undefined, from = "127.0.0.1") => {
    const url = new URL(`http://x${path.replace(/^\/api(?=\/)/, "")}`);
    const m = route(method, url.pathname);
    assert.ok(m, `${method} ${path} has a row`);
    let out = "";
    let status = 0;
    /** @type {Record<string, string>} */
    let headers = {};
    const res = /** @type {any} */ ({
      headersSent: false,
      setHeader() {},
      writeHead(/** @type {number} */ s, /** @type {any} */ h = {}) { status = s; headers = h; this.headersSent = true; return this; },
      write(/** @type {string} */ c) { out += c; },
      end(/** @type {string} */ c = "") { out += c; },
      on() {},
    });
    const req = { headers: {}, method, socket: { remoteAddress: from }, on() {} };
    await m.handler({ req, res, url, path: url.pathname, method, params: m.params, json: async () => body }, a);
    answers.push(out);
    const html = String(headers["content-type"] || "").startsWith("text/html");
    return { status, headers, text: out, body: html || !out ? null : JSON.parse(out) };
  };
  const chat = sessions.create({ cwd: folder, model: "cheap" });
  const projectScope = `project:${chat.projectId}`;
  /** @type {any} */
  let f;
  const rowOf = async (/** @type {string} */ scope, /** @type {string} */ name) => (await call("GET", `/mcp-servers?scope=${encodeURIComponent(scope)}`)).body.servers.find((/** @type {any} */ s) => s.name === name);
  /** Sign in through the rows, the browser's return included. @param {string} scope @param {string} name */
  const signInRows = async (scope, name) => {
    const st = (await call("POST", "/mcp-servers/sign-in", { scope, name })).body;
    const back = await pressAllow(st.url);
    const page = await call("GET", `${back.pathname}${back.search}`);
    assert.equal(page.status, 200, page.text);
    return { st, page };
  };

  after(async () => {
    await f?.close();
    await memory.shutdown();
    await removeDirs(dir);
  });

  // (fails before: yes — no row signed in)
  test("HC-142, HC-143: Test says it asks; Sign in answers the page to open; the row waits; the return's page says so in both themes; the row is signed in; Test is green", async () => {
    f = await startOAuthMcp();
    await call("PUT", "/mcp-servers/all/linear", { url: f.url });
    const tested = (await call("POST", "/mcp-servers/test", { scope: "all", server: { name: "linear", url: f.url } })).body;
    assert.deepEqual([tested.ok, tested.words, tested.signIn], [false, "It needs you to sign in", true]);
    let row = await rowOf("all", "linear");
    assert.deepEqual([row.signIn, row.test.signIn], [{ state: "asks", host: new URL(f.url).host, account: "main", accounts: [] }, true]);
    const st = (await call("POST", "/mcp-servers/sign-in", { scope: "all", name: "linear" })).body;
    assert.deepEqual(Object.keys(st).sort(), ["host", "id", "url"]);
    row = await rowOf("all", "linear");
    assert.deepEqual(row.signIn, { state: "waiting", host: st.host, account: "main", accounts: [], id: st.id, page: st.url });
    assert.equal((await call("GET", `/mcp-servers/sign-in/${st.id}`)).body.status, "waiting");
    const back = await pressAllow(st.url);
    assert.equal(back.origin + back.pathname, BACK);
    const page = await call("GET", `${back.pathname}${back.search}`);
    assert.equal(page.status, 200);
    assert.match(page.text, /<title>Filament · Signed in<\/title>/);
    assert.match(page.text, /Signed in to linear: you can close this tab and go back to Filament\./);
    assert.match(page.text, /prefers-color-scheme:dark/);
    assert.deepEqual([page.headers["content-security-policy"], page.headers["cache-control"], page.headers["referrer-policy"]], ["default-src 'none'; style-src 'unsafe-inline'", "no-store", "no-referrer"]);
    assert.deepEqual((await call("GET", `/mcp-servers/sign-in/${st.id}`)).body, { status: "done", words: `Signed in on ${st.host}`, name: "linear", host: st.host });
    assert.equal((await call("GET", `/mcp-servers/sign-in/${st.id}`)).body.status, "gone");
    row = await rowOf("all", "linear");
    assert.deepEqual(row.signIn, { state: "in", host: st.host, account: "main", accounts: ["main"] });
    const green = (await call("POST", "/mcp-servers/test", { scope: "all", server: { name: "linear", url: f.url } })).body;
    assert.deepEqual([green.ok, green.tools], [true, [{ name: "whoami", readOnly: true }]]);
    // A return Filament is not waiting for: its page says so, and how to go on.
    const stale = await call("GET", `${back.pathname}${back.search}`);
    assert.equal(stale.status, 400);
    assert.match(stale.text, /<title>Filament · Not signed in<\/title>[\s\S]*Filament is not waiting for this sign-in/);
  });

  // (fails before: yes — no row signed in or out)
  test("HC-150, HC-151: one address in all chats' list and a project's: one sign-in; Sign out from either asks the server to forget it and ends it for both", async () => {
    await call("PUT", `/mcp-servers/${encodeURIComponent(projectScope)}/linear-work`, { url: f.url });
    assert.deepEqual((await rowOf(projectScope, "linear-work")).signIn, { state: "in", host: new URL(f.url).host, account: "main", accounts: ["main"] });
    const out = (await call("POST", "/mcp-servers/sign-out", { scope: projectScope, name: "linear-work" })).body;
    assert.deepEqual([out.signedOut, out.told], [true, true]);
    // (fails before: yes — found in HS-7's drive: a row signed out of said nothing of it, and offered no Sign in)
    assert.deepEqual((await rowOf("all", "linear")).signIn, { state: "asks", host: new URL(f.url).host, account: "main", accounts: [] }, "it asks again");
    for (let i = 0; i < 50 && !f.seen.revoked.length; i++) await new Promise((r) => setTimeout(r, 20));
    assert.match(String(f.seen.revoked[0]), /^rt-\d+-\d+$/, "the refresh token was revoked");
    assert.deepEqual((await call("POST", "/mcp-servers/sign-out", { scope: "all", name: "linear" })).body.signedOut, false, "not signed in: nothing to do");
  });

  // (fails before: yes — Remove left nothing to sign out of)
  test("HC-152: Remove signs out, unless your list for all chats or a project's still names the address", async () => {
    await signInRows("all", "linear");
    let r = (await call("DELETE", "/mcp-servers/all/linear")).body;
    assert.equal(r.signedOut, undefined, "the project's list still names it");
    assert.equal((await rowOf(projectScope, "linear-work")).signIn.state, "in");
    r = (await call("DELETE", `/mcp-servers/${encodeURIComponent(projectScope)}/linear-work`)).body;
    assert.equal(r.signedOut, true);
    assert.equal(mcpSignIns.stateOf(f.url, {})?.state, "asks", "no sign-in held: the address asks again");
  });

  // (fails before: yes — found in HS-7's drive: a row signed out of kept its green test and offered no Sign in)
  test("HC-151: signed out of, a server's row asks again, until a test meets no ask: one that now lets anyone in stops asking", async () => {
    const opt = await startOAuthMcp();
    try {
      await call("PUT", "/mcp-servers/all/opt", { url: opt.url });
      await signInRows("all", "opt");
      assert.equal((await rowOf("all", "opt")).signIn.state, "in");
      assert.equal((await call("POST", "/mcp-servers/sign-out", { scope: "all", name: "opt" })).body.signedOut, true);
      assert.equal((await rowOf("all", "opt")).signIn.state, "asks");
      const still = (await call("POST", "/mcp-servers/test", { scope: "all", server: { name: "opt", url: opt.url } })).body;
      assert.deepEqual([still.ok, still.signIn], [false, true]);
      assert.equal((await rowOf("all", "opt")).signIn.state, "asks", "a test that met the ask leaves it");
      opt.letAnyoneIn();
      const tested = (await call("POST", "/mcp-servers/test", { scope: "all", server: { name: "opt", url: opt.url } })).body;
      assert.deepEqual([tested.ok, tested.words], [true, "1 tool: 1 only read"]);
      assert.equal(opt.seen.mcpAuth.at(-1), "", "the test went with no sign-in");
      assert.equal((await rowOf("all", "opt")).signIn, null, "it answered: it does not ask");
      await call("DELETE", "/mcp-servers/all/opt");
    } finally {
      await opt.close();
    }
  });

  // (fails before: yes — no row signed in)
  test("HC-153, HC-156, cancel: no registration answers 409 with the address to make a client with; a page elsewhere is refused; Cancel ends the wait", async () => {
    const closed = await startOAuthMcp({ register: false });
    try {
      await call("PUT", "/mcp-servers/all/gh", { url: closed.url });
      const r = await call("POST", "/mcp-servers/sign-in", { scope: "all", name: "gh" });
      assert.deepEqual([r.status, r.body.needsClient, r.body.host, r.body.redirectUri], [409, true, new URL(closed.url).host, BACK]);
      const far = await call("POST", "/mcp-servers/sign-in", { scope: "all", name: "gh" }, "10.1.2.3");
      assert.equal(far.status, 400);
      assert.match(far.body.error, /^Sign in from a browser on Filament's computer/);
      closed.addClient("made", [BACK]);
      const st = (await call("POST", "/mcp-servers/sign-in", { scope: "all", name: "gh", clientId: "made" })).body;
      assert.deepEqual((await call("DELETE", `/mcp-servers/sign-in/${st.id}`)).body, { cancelled: true });
      assert.equal((await rowOf("all", "gh")).signIn, null);
      assert.equal((await call("POST", "/mcp-servers/sign-in", { scope: "all", name: "nope" })).status, 404);
      await call("PUT", "/mcp-servers/all/local", { command: "node" });
      assert.match((await call("POST", "/mcp-servers/sign-in", { scope: "all", name: "local" })).body.error, /local runs on this computer: only a server reached over HTTP signs in/);
    } finally {
      await closed.close();
    }
  });

  // (fails before: yes — there were no tokens to keep out)
  test("HC-157: no answer the rows gave holds a token, a code or a client secret", () => {
    assert.ok(answers.length > 20);
    for (const a of answers) assert.ok(!TOKEN_RE.test(a), a.slice(0, 300));
  });
});

describe("a chat on Filament's own agent with a signed-in server (HC-146 to HC-148)", () => {
  // (fails before: yes — the agent sent the server no token, and its tools were left out with "HTTP 401")
  test("its tools are offered and called with the token; a run-out token is renewed in the turn; a revoked one is left out next turn in words; no record holds a token", async () => {
    const f = await startOAuthMcp();
    const root2 = mkdtempSync(join(tmpdir(), "filament-signin-loop-"));
    /** @type {any[]} */
    const seenResults = [];
    let round = 0;
    const up = await fakeUpstream(async (/** @type {any} */ c) => {
      round++;
      const last = c.body.messages.at(-1);
      if (Array.isArray(last?.content) && last.content.some((/** @type {any} */ b) => b.type === "tool_result")) {
        seenResults.push(last.content.find((/** @type {any} */ b) => b.type === "tool_result"));
        return anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "Done." }], usage: { input_tokens: 9, output_tokens: 3 } });
      }
      const names = (c.body.tools || []).map((/** @type {any} */ t) => t.name);
      // The server loads on demand (E49): it is named in the prompt with how many tools it has, and its tool called
      // through the mcp tool.
      const named = names.includes("mcp") && JSON.stringify(c.body.system ?? "").includes("- linear: 1 tool");
      if (!named) return anthropicReply("", { model: "brain-model", blocks: [{ type: "text", text: "No linear." }], usage: { input_tokens: 9, output_tokens: 3 } });
      return anthropicReply("", { model: "brain-model", stop: "tool_use", blocks: [{ type: "tool_use", id: `w${round}`, name: "mcp", input: { action: "call", tool: "mcp__linear__whoami" } }], usage: { input_tokens: 9, output_tokens: 3 } });
    });
    const shim = await startApp({
      configure: (cfg) => {
        cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
        cfg.routes = [{ match: "brain-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
        cfg.agentLoop = { enabled: true, permissions: "edit", roots: [root2], readerModel: "" };
      },
      memory: true,
    });
    try {
      assert.equal((await shim.api("/api/mcp-servers/all/linear", { method: "PUT", body: { url: f.url } })).status, 200);
      const st = await (await shim.api("/api/mcp-servers/sign-in", { method: "POST", body: { scope: "all", name: "linear" } })).json();
      const back = await pressAllow(st.url);
      assert.equal(back.origin, shim.url, "the browser comes back to Filament's own address");
      const page = await fetch(back);
      assert.equal(page.status, 200, await page.text());
      const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: root2, model: "agent/brain-model", preset: "plain" } });
      const id = (await r.json()).id;
      const turn = async () => {
        const t = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content: "who am I on linear?", stream: false } });
        assert.equal(t.status, 200);
        await t.json();
        return shim.record(String(t.headers.get("x-filament-request-id")));
      };
      const rec1 = await turn();
      assert.equal(seenResults.at(-1)?.content, "signed in as test-user (grant 1)");
      assert.deepEqual([rec1.agent.mcp[0].name, rec1.agent.mcp[0].transport, rec1.agent.mcp[0].tools], ["linear", "http", 1]);
      f.expireAll();
      const rec2 = await turn();
      assert.equal(seenResults.at(-1)?.content, "signed in as test-user (grant 1)", "renewed inside the call");
      f.revokeAll();
      await turn();
      assert.match(JSON.stringify(seenResults.at(-1)?.content), /signed out by 127\.0\.0\.1:\d+: sign in again in Library › Plugins & Connectors/);
      const rec4 = await turn();
      const host = new URL(f.url).host;
      assert.ok(rec4.changes.some((/** @type {string} */ c) => c.startsWith("agent: MCP server linear left out") && c.includes(`signed out by ${host}: sign in again`)), rec4.changes.join("\n"));
      const rows = await (await shim.api("/api/mcp-servers?scope=all")).json();
      assert.deepEqual(rows.servers.find((/** @type {any} */ s) => s.name === "linear").signIn.state, "ended");
      for (const x of [rec1, rec2, rec4, rows]) assert.ok(!TOKEN_RE.test(JSON.stringify(x)), "no token in a record or an answer");
      assert.ok(!TOKEN_RE.test(readFileSync(join(shim.dataDir, "config.json"), "utf8")));
    } finally {
      await shim.stop();
      await up.close();
      await f.close();
      await removeDirs(root2);
    }
  });
});

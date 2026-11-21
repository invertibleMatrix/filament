// @ts-check
// A remote MCP server that signs in with OAuth, on 127.0.0.1 (HarnessV4_Settings_Plan HS-7): the MCP endpoint, which
// answers 401 with a Bearer challenge until a token rides the request; its resource metadata (RFC 9728); its
// authorization server's metadata (RFC 8414), registration (RFC 7591), sign-in page, token and revocation endpoints.
// Each part can be left out or turned against Filament, and what Filament sent each one is kept for the tests to read.
import { createServer } from "node:http";
import { createHash } from "node:crypto";

/** @param {Buffer} buf */
const base64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * @typedef {{ challenge?: "full" | "bare" | false, prm?: boolean, asMeta?: boolean, register?: boolean, revoke?: boolean,
 *   issuer?: string, ttl?: number, refuseRefresh?: boolean, noRefresh?: boolean, deny?: boolean, page?: boolean,
 *   scope?: string, legacy?: boolean, renewedForever?: boolean, structured?: boolean, post?: boolean }} FakeOptions
 *   `challenge`: the 401's WWW-Authenticate — naming the resource metadata, a bare Bearer, or none
 *   `renewedForever`: a renewal's tokens never run out, and its answer gives no expiry
 *   `legacy`: no metadata of any kind, the endpoints at the server's root (MCP 2025-03-26)
 *   `page`: the sign-in page asks Allow or Deny, for a browser; otherwise it answers at once
 *   `structured`: whoami answers its data too, `{ signedIn: [{ who, grant }] }`, which a dashboard source reads
 *   `post`: a tool post_message too, not read-only (a draft's send, HarnessV4_Space_Plan S5c): "Posted in #<channel> as
 *   grant N" and the message's link; what it was sent is kept in `seen.posts`
 */

/** @param {FakeOptions} [opts] */
export async function startOAuthMcp(opts = {}) {
  const o = { challenge: /** @type {FakeOptions["challenge"]} */ ("full"), prm: true, asMeta: true, register: true, revoke: true, ttl: 3600, ...opts };
  if (o.legacy) Object.assign(o, { prm: false, asMeta: false });
  let origin = "";
  let n = 0;
  /** Each sign-in's number: its tokens, renewed or not, say it. */
  let grants = 0;
  /** A request with no token is answered too, for nobody: its sign-in became a choice. */
  let anyone = false;
  const seen = {
    /** @type {any[]} */ registered: [],
    /** @type {Record<string, string>[]} */ authorize: [],
    /** @type {Record<string, string>[]} */ token: [],
    /** @type {string[]} */ revoked: [],
    /** The Authorization each MCP request carried ("" for none). @type {string[]} */ mcpAuth: [],
    /** The tool calls answered, by grant. @type {number[]} */ calls: [],
    /** What post_message was sent, and as which grant. @type {{ grant: number, args: any }[]} */ posts: [],
  };
  /** @type {Map<string, { redirectUris: string[], secret?: string }>} */
  const clients = new Map();
  /** @type {Map<string, { challenge: string, redirectUri: string, clientId: string, resource: string, used: boolean }>} */
  const codes = new Map();
  /** @type {Map<string, { grant: number, expiresAt: number }>} */
  const access = new Map();
  /** @type {Map<string, { grant: number }>} */
  const refresh = new Map();

  const issuer = () => o.issuer || (o.legacy ? origin : `${origin}/as`);
  const base = () => (o.legacy ? origin : `${origin}/as`);

  /** @param {import("node:http").IncomingMessage} req */
  const bodyOf = (req) =>
    new Promise((resolve) => {
      let text = "";
      req.on("data", (c) => (text += c));
      req.on("end", () => resolve(text));
    });
  /** @param {import("node:http").ServerResponse} res @param {number} status @param {any} body @param {Record<string, string>} [headers] */
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  };
  /** Tokens for a grant; `forever`: they never run out, and the answer gives no expiry. @param {number} grant */
  const issue = (grant, forever = false) => {
    const at = `at-${grant}-${++n}`;
    access.set(at, { grant, expiresAt: forever ? Infinity : Date.now() + o.ttl * 1000 });
    const rt = o.noRefresh ? null : `rt-${grant}-${n}`;
    if (rt) refresh.set(rt, { grant });
    return { access_token: at, token_type: "Bearer", ...(forever ? {} : { expires_in: o.ttl }), ...(rt ? { refresh_token: rt } : {}) };
  };
  /** The client a token request names, by Basic or the form. @param {import("node:http").IncomingMessage} req @param {URLSearchParams} f */
  const clientOf = (req, f) => {
    const basic = /^Basic (.+)$/.exec(String(req.headers.authorization || ""));
    if (basic) {
      const [id, secret] = Buffer.from(basic[1], "base64").toString().split(":").map(decodeURIComponent);
      const c = clients.get(id);
      return c && c.secret === secret ? id : null;
    }
    const id = f.get("client_id") || "";
    const c = clients.get(id);
    if (!c) return null;
    if (c.secret && f.get("client_secret") !== c.secret) return null;
    return id;
  };

  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  async function mcp(req, res) {
    const auth = String(req.headers.authorization || "");
    if (req.method === "POST") seen.mcpAuth.push(auth);
    const at = /^Bearer (.+)$/.exec(auth)?.[1] || "";
    const tok = access.get(at);
    /** The sign-in the request rides: its grant, or 0 for nobody. */
    const grant = tok && tok.expiresAt > Date.now() ? tok.grant : 0;
    if (!grant && !(anyone && !at)) {
      await bodyOf(req);
      const meta = `${origin}/.well-known/oauth-protected-resource/mcp`;
      const challenge = o.challenge === "full" ? `Bearer resource_metadata="${meta}"${o.scope ? `, scope="${o.scope}"` : ""}${at ? ', error="invalid_token"' : ""}` : o.challenge === "bare" ? "Bearer" : "";
      res.writeHead(401, { "content-type": "application/json", ...(challenge ? { "www-authenticate": challenge } : {}) });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.method === "DELETE") {
      res.writeHead(200);
      return res.end();
    }
    const msg = JSON.parse(String(await bodyOf(req)) || "{}");
    if (msg.id === undefined) {
      res.writeHead(202);
      return res.end();
    }
    if (msg.method === "initialize")
      return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-oauth", version: "1" } } }, { "mcp-session-id": `s-${grant}` });
    if (msg.method === "tools/list") {
      const tools = [{ name: "whoami", description: "Says who is signed in", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }];
      if (o.post) tools.push({ name: "post_message", description: "Post a message in a channel", inputSchema: { type: "object", required: ["channel", "text"], properties: { channel: { type: "string" }, text: { type: "string" } } }, annotations: /** @type {any} */ ({}) });
      return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { tools } });
    }
    if (msg.method === "tools/call" && o.post && msg.params?.name === "post_message") {
      const args = msg.params.arguments || {};
      seen.posts.push({ grant, args });
      const ch = String(args.channel || "general");
      return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: `Posted in #${ch} as grant ${grant}: https://chat.example.invalid/${ch}/p${seen.posts.length}` }] } });
    }
    if (msg.method === "tools/call") {
      seen.calls.push(grant);
      return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: grant ? `signed in as test-user (grant ${grant})` : "nobody is signed in" }], ...(o.structured ? { structuredContent: { signedIn: grant ? [{ who: "test-user", grant }] : [] } } : {}) } });
    }
    return json(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no such method" } });
  }

  /** @param {URL} url @param {import("node:http").ServerResponse} res */
  function authorize(url, res) {
    const q = Object.fromEntries(url.searchParams);
    seen.authorize.push(q);
    const c = clients.get(q.client_id || "");
    if (!c || !c.redirectUris.includes(q.redirect_uri) || q.response_type !== "code" || q.code_challenge_method !== "S256") {
      res.writeHead(400, { "content-type": "text/plain" });
      return res.end("bad authorization request");
    }
    if (o.page && url.pathname.endsWith("/authorize")) {
      const allow = new URL(url.href.replace("/authorize", "/allow"));
      const deny = new URL(url.href.replace("/authorize", "/deny"));
      res.writeHead(200, { "content-type": "text/html" });
      return res.end(`<!doctype html><title>Fake sign-in</title><h1>Let Filament in?</h1><a id="allow" href="${allow.href}">Allow</a> <a id="deny" href="${deny.href}">Deny</a>`);
    }
    const back = new URL(q.redirect_uri);
    back.searchParams.set("state", q.state || "");
    if (o.deny || url.pathname.endsWith("/deny")) back.searchParams.set("error", "access_denied");
    else {
      const code = `code-${++n}`;
      codes.set(code, { challenge: q.code_challenge, redirectUri: q.redirect_uri, clientId: q.client_id, resource: q.resource || "", used: false });
      back.searchParams.set("code", code);
      back.searchParams.set("iss", issuer());
    }
    res.writeHead(302, { location: back.href });
    res.end();
  }

  /** @param {import("node:http").IncomingMessage} req @param {import("node:http").ServerResponse} res */
  async function token(req, res) {
    const f = new URLSearchParams(String(await bodyOf(req)));
    seen.token.push(Object.fromEntries(f));
    const client = clientOf(req, f);
    if (!client) return json(res, 401, { error: "invalid_client" });
    if (f.get("grant_type") === "authorization_code") {
      const c = codes.get(f.get("code") || "");
      const verifier = f.get("code_verifier") || "";
      if (!c || c.used || c.clientId !== client || c.redirectUri !== f.get("redirect_uri") || base64url(createHash("sha256").update(verifier).digest()) !== c.challenge)
        return json(res, 400, { error: "invalid_grant" });
      c.used = true;
      return json(res, 200, issue(++grants));
    }
    if (f.get("grant_type") === "refresh_token") {
      const r = refresh.get(f.get("refresh_token") || "");
      if (!r || o.refuseRefresh) return json(res, 400, { error: "invalid_grant", error_description: "the refresh token is no good" });
      refresh.delete(f.get("refresh_token") || "");
      return json(res, 200, issue(r.grant, !!o.renewedForever));
    }
    return json(res, 400, { error: "unsupported_grant_type" });
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", origin);
    const p = url.pathname;
    const at = (/** @type {string} */ tail) => p === `/as/${tail}` || (o.legacy && p === `/${tail}`);
    if (p === "/mcp") return mcp(req, res);
    if (o.prm && p === "/.well-known/oauth-protected-resource/mcp")
      return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [`${origin}/as`], ...(o.scope ? { scopes_supported: o.scope.split(" ") } : {}) });
    if (o.asMeta && p === "/.well-known/oauth-authorization-server/as")
      return json(res, 200, {
        issuer: issuer(),
        authorization_endpoint: `${base()}/authorize`,
        token_endpoint: `${base()}/token`,
        ...(o.register ? { registration_endpoint: `${base()}/register` } : {}),
        ...(o.revoke ? { revocation_endpoint: `${base()}/revoke` } : {}),
        code_challenge_methods_supported: ["S256"],
      });
    if (at("register") && req.method === "POST") {
      const b = JSON.parse(String(await bodyOf(req)) || "{}");
      seen.registered.push(b);
      if (!o.register) return json(res, 404, { error: "not_found" });
      const id = `client-${++n}`;
      clients.set(id, { redirectUris: b.redirect_uris || [] });
      return json(res, 201, { client_id: id, token_endpoint_auth_method: "none", redirect_uris: b.redirect_uris });
    }
    if ((at("authorize") || at("allow") || at("deny")) && req.method === "GET") return authorize(url, res);
    if (at("token") && req.method === "POST") return token(req, res);
    if (at("revoke") && req.method === "POST") {
      const f = new URLSearchParams(String(await bodyOf(req)));
      const t = f.get("token") || "";
      seen.revoked.push(t);
      refresh.delete(t);
      access.delete(t);
      res.writeHead(200);
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(null)));
  const addr = /** @type {import("node:net").AddressInfo} */ (server.address());
  origin = `http://127.0.0.1:${addr.port}`;
  return {
    origin,
    url: `${origin}/mcp`,
    seen,
    options: o,
    /** A client made by hand on the server's site (HS-D86). @param {string} id @param {string[]} redirectUris @param {string} [secret] */
    addClient(id, redirectUris, secret) {
      clients.set(id, { redirectUris, ...(secret ? { secret } : {}) });
    },
    /** Every access token run out now (HC-147). */
    expireAll() {
      for (const t of access.values()) t.expiresAt = 0;
    },
    /** Every grant revoked: no token or refresh token is good any more (HC-148). */
    revokeAll() {
      access.clear();
      refresh.clear();
    },
    /** From now on a request with no token is answered too: a sign-in there is a choice. */
    letAnyoneIn() {
      anyone = true;
    },
    close: () => new Promise((resolve) => server.close(() => resolve(null))),
  };
}

/**
 * Follow a sign-in page to where it sends the browser back, as a browser that presses Allow would.
 * @param {string} page @returns {Promise<URL>}
 */
export async function pressAllow(page) {
  const res = await fetch(page, { redirect: "manual" });
  await res.text();
  const to = res.headers.get("location");
  if (res.status !== 302 || !to) throw new Error(`the sign-in page answered ${res.status}`);
  return new URL(to);
}

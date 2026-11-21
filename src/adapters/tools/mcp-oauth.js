// @ts-check
// Signing in to a remote MCP server, its network half (HarnessV4_Settings_Plan HS-7, HS-D84 to HS-D86): what the
// server answers with no sign-in, its resource metadata and its authorization server's, Filament's registration there,
// and the token requests — the code's exchange, a refresh, a revocation. No call has a clock (FP-D3): a server that
// does not answer is waited for, and the page that asked says so and can cancel.
import { addressOf, bearerChallenge, endpointProblem, formOf, hostOf, issuerMetadataUrls, resourceMetadataUrls, tokensFrom } from "../../core/oauth.js";
import { MCP_PROTOCOL_VERSION } from "./mcp-client.js";

/**
 * A sign-in that cannot go on, in words. `refused`: the authorization server said no to a token request (HS-D89);
 * `needsClient`: it lets no app register, so it needs the client a person made (HS-D86); `none`: the server offers no
 * sign-in (HC-155); `turnedDown`: its registration said no to Filament, in its own words — a service that lets only
 * the apps it approved sign in (Figma, the owner's of 10-26), where a client made by hand may not help either.
 */
export class SignInError extends Error {
  /**
   * @param {string} message
   * @param {{ refused?: boolean, needsClient?: boolean, none?: boolean, turnedDown?: { said: string, status: number } | null }} [o]
   *   `turnedDown.said`: the service's own words, "" where it gave none
   */
  constructor(message, { refused = false, needsClient = false, none = false, turnedDown = null } = {}) {
    super(message);
    this.name = "SignInError";
    this.refused = refused;
    this.needsClient = needsClient;
    this.none = none;
    this.turnedDown = turnedDown;
  }
}

/**
 * The authorization server's metadata as a sign-in uses it.
 * @typedef {{ issuer: string, authorization_endpoint: string, token_endpoint: string, registration_endpoint?: string,
 *   revocation_endpoint?: string }} AuthServer
 */

/** @param {any} e */
const reachWords = (e) => e?.cause?.code || e?.message || "network error";

/**
 * A JSON document, or null where the address answers anything but one.
 * @param {string} url @param {typeof fetch} fetchImpl
 */
async function getJson(url, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, { headers: { accept: "application/json", "mcp-protocol-version": MCP_PROTOCOL_VERSION } });
  } catch (e) {
    throw new SignInError(`${hostOf(url)} could not be reached (${reachWords(e)})`);
  }
  if (!res.ok) {
    await res.text().catch(() => "");
    return null;
  }
  try {
    const j = await res.json();
    return j && typeof j === "object" && !Array.isArray(j) ? j : null;
  } catch {
    return null;
  }
}

/**
 * What the server answers an MCP request that carries no sign-in: its status and Bearer challenge. A session it opened
 * for the request is closed again.
 * @param {string} serverUrl @param {Record<string, string>} headers  the server's own headers
 * @param {{ fetchImpl?: typeof fetch }} [o]
 */
export async function probe(serverUrl, headers, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(serverUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": MCP_PROTOCOL_VERSION, ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Filament", version: "0.1" } } }),
    });
  } catch (e) {
    throw new SignInError(`${hostOf(serverUrl)} could not be reached (${reachWords(e)})`);
  }
  await res.text().catch(() => "");
  const session = res.headers.get("mcp-session-id");
  if (session) await fetchImpl(serverUrl, { method: "DELETE", headers: { "mcp-session-id": session, ...headers } }).then((r) => r.text()).catch(() => "");
  return { status: res.status, challenge: bearerChallenge(res.headers.get("www-authenticate")) };
}

/**
 * Where and how the server signs in (HS-D84): its resource metadata (the challenge's, else the well-known paths), the
 * authorization server it names and that server's metadata, whose issuer must be the one named (HC-159). A server
 * with no resource metadata that sent a Bearer challenge is its own authorization server, with the fallback paths
 * where it has no metadata either (MCP 2025-03-26). One that sent no challenge and has no metadata offers no sign-in.
 * `docs`: the page its metadata names for how to use it (RFC 9728's resource_documentation), over https.
 * @param {string} serverUrl
 * @param {{ challenge: ReturnType<typeof bearerChallenge>, fetchImpl?: typeof fetch }} o
 * @returns {Promise<{ resource: string, scope?: string, docs?: string, auth: AuthServer }>}
 */
export async function discover(serverUrl, { challenge, fetchImpl = fetch }) {
  const host = hostOf(serverUrl);
  const server = new URL(serverUrl);
  /** @type {any} */
  let prm = null;
  for (const url of challenge?.resourceMetadata ? [challenge.resourceMetadata] : resourceMetadataUrls(serverUrl)) {
    const bad = endpointProblem(url, "resource metadata");
    if (bad) throw new SignInError(`${host}: ${bad}`);
    const j = await getJson(url, fetchImpl);
    if (j && Array.isArray(j.authorization_servers) && j.authorization_servers.length) {
      prm = j;
      break;
    }
  }
  if (prm && typeof prm.resource === "string" && prm.resource) {
    let named = null;
    try {
      named = new URL(prm.resource);
    } catch {}
    if (!named || named.origin !== server.origin) throw new SignInError(`${host}: its metadata names another server (${prm.resource}), so Filament does not sign in there`);
  }
  const issuer = prm ? String(prm.authorization_servers[0]) : server.origin;
  const named = endpointProblem(issuer, "authorization server");
  if (named) throw new SignInError(`${host}: ${named}`);
  /** @type {any} */
  let meta = null;
  for (const url of issuerMetadataUrls(issuer)) {
    const j = await getJson(url, fetchImpl);
    if (j && typeof j.authorization_endpoint === "string" && typeof j.token_endpoint === "string") {
      meta = j;
      break;
    }
  }
  if (meta && String(meta.issuer || "").replace(/\/+$/, "") !== issuer.replace(/\/+$/, ""))
    throw new SignInError(`${host}: its authorization server's metadata names another server (${meta.issuer || "none"}), so Filament does not sign in there`);
  if (!meta) {
    if (prm) throw new SignInError(`${host}: its authorization server, ${hostOf(issuer)}, says nothing of how to sign in (no metadata)`);
    if (!challenge) throw new SignInError(`${host} offers no sign-in: give it a key in Edit, as its Authorization header`, { none: true });
    meta = { issuer, authorization_endpoint: `${server.origin}/authorize`, token_endpoint: `${server.origin}/token`, registration_endpoint: `${server.origin}/register` };
  }
  for (const [field, what] of /** @type {const} */ ([["authorization_endpoint", "sign-in page"], ["token_endpoint", "token address"], ["registration_endpoint", "registration address"], ["revocation_endpoint", "sign-out address"]])) {
    const bad = typeof meta[field] === "string" ? endpointProblem(meta[field], what) : null;
    if (bad) throw new SignInError(`${host}: ${bad}`);
  }
  if (Array.isArray(meta.code_challenge_methods_supported) && !meta.code_challenge_methods_supported.includes("S256"))
    throw new SignInError(`${host}: its sign-in does not take PKCE's S256, which Filament requires`);
  const scope = challenge?.scope || (Array.isArray(prm?.scopes_supported) && prm.scopes_supported.length ? prm.scopes_supported.join(" ") : undefined);
  const docs = typeof prm?.resource_documentation === "string" && !endpointProblem(prm.resource_documentation, "documentation") ? prm.resource_documentation : "";
  return {
    resource: prm?.resource ? addressOf(prm.resource) : addressOf(serverUrl),
    ...(scope ? { scope } : {}),
    ...(docs ? { docs } : {}),
    auth: {
      issuer,
      authorization_endpoint: meta.authorization_endpoint,
      token_endpoint: meta.token_endpoint,
      ...(typeof meta.registration_endpoint === "string" ? { registration_endpoint: meta.registration_endpoint } : {}),
      ...(typeof meta.revocation_endpoint === "string" ? { revocation_endpoint: meta.revocation_endpoint } : {}),
    },
  };
}

/**
 * Filament registered at the authorization server (RFC 7591) as an app with no secret, for one return address. One that
 * lets no app register says so (HS-D86).
 * @param {AuthServer} auth @param {{ redirectUri: string, fetchImpl?: typeof fetch, now?: () => number }} o
 */
export async function register(auth, { redirectUri, fetchImpl = fetch, now = Date.now }) {
  const host = hostOf(auth.issuer);
  if (!auth.registration_endpoint) throw new SignInError(`${host} lets no app register itself: give the client ID you made on its site`, { needsClient: true });
  let res;
  try {
    res = await fetchImpl(auth.registration_endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ client_name: "Filament", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }),
    });
  } catch (e) {
    throw new SignInError(`${host} could not be reached (${reachWords(e)})`);
  }
  /** @type {any} */
  const j = await res.json().catch(() => null);
  // Said no (400, 401, 403), apart from a server that has no registration at all (a 404 where Filament guessed its
  // address): the client-ID route may not help there, so its own words go up.
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    const said = [j?.error, j?.error_description].filter((x) => typeof x === "string" && x.trim()).join(": ").slice(0, 200);
    throw new SignInError(`${host} turned down Filament's registration (${said ? `${said}, ` : ""}HTTP ${res.status})`, { needsClient: true, turnedDown: { said, status: res.status } });
  }
  if (!res.ok || typeof j?.client_id !== "string" || !j.client_id)
    throw new SignInError(`${host} did not register Filament${j?.error ? ` (${j.error}${j.error_description ? `: ${j.error_description}` : ""})` : ` (HTTP ${res.status})`}: give the client ID you made on its site`, { needsClient: true });
  const secret = typeof j.client_secret === "string" && j.client_secret ? j.client_secret : "";
  return {
    clientId: j.client_id,
    ...(secret ? { clientSecret: secret } : {}),
    authMethod: typeof j.token_endpoint_auth_method === "string" ? j.token_endpoint_auth_method : secret ? "client_secret_basic" : "none",
    at: now(),
  };
}

/**
 * One token request (RFC 6749 §4.1.3, §6): the client named as its registration says — in the form, or as Basic with
 * its secret. A refusal says the server's own words.
 * @param {string} endpoint @param {Record<string, string | undefined>} fields
 * @param {{ clientId: string, clientSecret?: string, authMethod: string }} client @param {typeof fetch} fetchImpl
 */
async function tokenCall(endpoint, fields, client, fetchImpl) {
  const basic = client.clientSecret && client.authMethod === "client_secret_basic";
  /** @type {Record<string, string>} */
  const headers = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  if (basic) headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(String(client.clientSecret))}`).toString("base64")}`;
  const body = formOf({ ...fields, ...(basic ? {} : { client_id: client.clientId }), ...(client.clientSecret && client.authMethod === "client_secret_post" ? { client_secret: client.clientSecret } : {}) });
  let res;
  try {
    res = await fetchImpl(endpoint, { method: "POST", headers, body });
  } catch (e) {
    throw new SignInError(`${hostOf(endpoint)} could not be reached (${reachWords(e)})`);
  }
  /** @type {any} */
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const said = j?.error ? `${j.error}${j.error_description ? `: ${j.error_description}` : ""}` : `HTTP ${res.status}`;
    throw new SignInError(`${hostOf(endpoint)} refused (${said})`, { refused: res.status === 400 || res.status === 401 });
  }
  return j;
}

/**
 * The code the browser came back with, exchanged for tokens.
 * @param {{ tokenEndpoint: string, clientId: string, clientSecret?: string, authMethod: string, resource: string }} rec
 * @param {{ code: string, verifier: string, redirectUri: string, fetchImpl?: typeof fetch, now?: () => number }} o
 */
export async function exchange(rec, { code, verifier, redirectUri, fetchImpl = fetch, now = Date.now }) {
  const j = await tokenCall(rec.tokenEndpoint, { grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier, resource: rec.resource }, rec, fetchImpl);
  try {
    return tokensFrom(j, now());
  } catch (e) {
    throw new SignInError(`${hostOf(rec.tokenEndpoint)}: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * New tokens for a sign-in from its refresh token; the refresh token kept where the server sends no new one. A sign-in
 * with no refresh token cannot be refreshed: it is refused, as the server would.
 * @param {{ tokenEndpoint: string, clientId: string, clientSecret?: string, authMethod: string, resource: string, refreshToken?: string, scope?: string }} rec
 * @param {{ fetchImpl?: typeof fetch, now?: () => number }} [o]
 */
export async function refresh(rec, { fetchImpl = fetch, now = Date.now } = {}) {
  if (!rec.refreshToken) throw new SignInError(`${hostOf(rec.tokenEndpoint)} gave no way to renew the sign-in`, { refused: true });
  const j = await tokenCall(rec.tokenEndpoint, { grant_type: "refresh_token", refresh_token: rec.refreshToken, resource: rec.resource }, rec, fetchImpl);
  try {
    const t = tokensFrom(j, now());
    return { ...t, refreshToken: t.refreshToken || rec.refreshToken };
  } catch (e) {
    throw new SignInError(`${hostOf(rec.tokenEndpoint)}: ${/** @type {Error} */ (e).message}`);
  }
}

/**
 * Tell the authorization server a sign-in is over (RFC 7009), where it offers that: true when it said so.
 * @param {{ revocationEndpoint?: string, clientId: string, clientSecret?: string, authMethod: string, refreshToken?: string, accessToken?: string }} rec
 * @param {{ fetchImpl?: typeof fetch }} [o]
 */
export async function revoke(rec, { fetchImpl = fetch } = {}) {
  const token = rec.refreshToken || rec.accessToken;
  if (!rec.revocationEndpoint || !token) return false;
  try {
    await tokenCall(rec.revocationEndpoint, { token, token_type_hint: rec.refreshToken ? "refresh_token" : "access_token" }, rec, fetchImpl);
    return true;
  } catch {
    return false;
  }
}

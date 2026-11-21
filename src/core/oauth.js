// @ts-check
// Signing in to a remote MCP server, the pure half (HarnessV4_Settings_Plan HS-7, HS-D84): the 401's Bearer
// challenge read, the metadata addresses in the order the MCP authorization spec asks for them, PKCE, the address a
// sign-in is kept under, which endpoints a sign-in may go to, the authorization request, and a token answer read.
import { createHash } from "node:crypto";

/** @param {Buffer} buf */
const base64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/**
 * A `WWW-Authenticate` header's Bearer challenge: the resource metadata it names, the scope, the error. Null when it
 * holds no Bearer challenge.
 * @param {string | null | undefined} header
 * @returns {{ resourceMetadata?: string, scope?: string, error?: string, description?: string } | null}
 */
export function bearerChallenge(header) {
  const text = String(header || "");
  const at = text.search(/(^|[\s,])Bearer(\s|$)/i);
  if (at < 0) return null;
  /** @type {Record<string, string>} */
  const params = {};
  for (const m of text.slice(at).replace(/^[\s,]*Bearer/i, "").matchAll(/([A-Za-z_][\w-]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g))
    if (!(m[1].toLowerCase() in params)) params[m[1].toLowerCase()] = (m[2] ?? m[3] ?? "").replace(/\\(.)/g, "$1");
  return {
    ...(params.resource_metadata ? { resourceMetadata: params.resource_metadata } : {}),
    ...(params.scope ? { scope: params.scope } : {}),
    ...(params.error ? { error: params.error } : {}),
    ...(params.error_description ? { description: params.error_description } : {}),
  };
}

/**
 * The address a sign-in is kept under (HS-D82): the server's URL without its fragment, its scheme and host in lower
 * case, as `resource` names it to the authorization server (RFC 8707).
 * @param {string} url
 */
export function addressOf(url) {
  const u = new URL(url);
  u.hash = "";
  return u.href;
}

/**
 * An address's first account (HarnessV4_Space_Plan S4b, SG-D2): the one a sign-in from a server's row makes, kept under
 * the address alone — so a sign-in kept before accounts were is this one, as it is.
 */
export const MAIN_ACCOUNT = "main";
/** Words that name an account: "work", "personal" — letters, digits, space, `.`, `_`, `-`, 32 at most. */
export const ACCOUNT_RE = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,31}$/;
/** An account as it is kept: "" for main, else its name trimmed. @param {unknown} a */
export const accountOf = (a) => {
  const s = typeof a === "string" ? a.trim() : "";
  return s.toLowerCase() === MAIN_ACCOUNT ? "" : s;
};
/** An account as words: its name, or "main". @param {unknown} a */
export const accountWords = (a) => accountOf(a) || MAIN_ACCOUNT;
/**
 * What one account's sign-in at an address is kept under (S4b): the address alone for main, else the address and the
 * account after a `#` — which no address holds, since `addressOf` drops a URL's fragment.
 * @param {string} address @param {unknown} [account]
 */
export const signInKey = (address, account) => (accountOf(account) ? `${address}#${accountOf(account)}` : address);
/**
 * The accounts kept at an address, main first, from the keys a store holds.
 * @param {string} address @param {string[]} keys
 */
export function accountsAt(address, keys) {
  const out = keys.filter((k) => k.startsWith(`${address}#`)).map((k) => k.slice(address.length + 1)).sort();
  return keys.includes(address) ? ["", ...out] : out;
}

/** The host a person reads in the words: "mcp.linear.app". @param {string} url */
export const hostOf = (url) => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

/** Whether a host is this computer. @param {string} hostname */
const isLoopback = (hostname) => {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || h === "::1" || /^127(?:\.\d{1,3}){3}$/.test(h);
};

/**
 * Why a sign-in may not go to an endpoint, or null when it may (HC-160): HTTPS, or plain HTTP on this computer.
 * @param {string} url @param {string} what  the endpoint's part in the words
 */
export function endpointProblem(url, what) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return `its ${what} (${url}) is not an address`;
  }
  if (u.protocol === "https:") return null;
  if (u.protocol === "http:" && isLoopback(u.hostname)) return null;
  return `its ${what} is reached over plain ${u.protocol.replace(":", "")} at ${u.host}: a sign-in goes only over https, or to this computer`;
}

/**
 * Where a server's resource metadata may be (RFC 9728): under its path, then at its root.
 * @param {string} serverUrl
 */
export function resourceMetadataUrls(serverUrl) {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/+$/, "");
  return [...(path ? [`${u.origin}/.well-known/oauth-protected-resource${path}`] : []), `${u.origin}/.well-known/oauth-protected-resource`];
}

/**
 * Where an authorization server's metadata may be, in the spec's order: OAuth's (RFC 8414) and OpenID's, each with the
 * issuer's path put in after the well-known name, then OpenID's after the path.
 * @param {string} issuer
 */
export function issuerMetadataUrls(issuer) {
  const u = new URL(issuer);
  const path = u.pathname.replace(/\/+$/, "");
  if (!path) return [`${u.origin}/.well-known/oauth-authorization-server`, `${u.origin}/.well-known/openid-configuration`];
  return [
    `${u.origin}/.well-known/oauth-authorization-server${path}`,
    `${u.origin}/.well-known/openid-configuration${path}`,
    `${u.origin}${path}/.well-known/openid-configuration`,
  ];
}

/**
 * A PKCE pair (RFC 7636, S256) from random bytes: the verifier kept, the challenge sent.
 * @param {Buffer} bytes  32 random bytes
 */
export function pkcePair(bytes) {
  const verifier = base64url(bytes);
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

/** A `state`, or any other value nobody can guess, from random bytes. @param {Buffer} bytes */
export const unguessable = (bytes) => base64url(bytes);

/**
 * The authorization request's address: the endpoint with its own query kept, and the code flow's fields.
 * @param {string} endpoint
 * @param {{ clientId: string, redirectUri: string, challenge: string, state: string, resource: string, scope?: string }} o
 */
export function authorizeUrl(endpoint, o) {
  const u = new URL(endpoint);
  const set = (/** @type {string} */ k, /** @type {string | undefined} */ v) => (v ? u.searchParams.set(k, v) : undefined);
  set("response_type", "code");
  set("client_id", o.clientId);
  set("redirect_uri", o.redirectUri);
  set("code_challenge", o.challenge);
  set("code_challenge_method", "S256");
  set("state", o.state);
  set("resource", o.resource);
  set("scope", o.scope);
  return u.href;
}

/** A token request's body, form-encoded, the fields that have a value. @param {Record<string, string | undefined>} fields */
export const formOf = (fields) =>
  new URLSearchParams(/** @type {[string, string][]} */ (Object.entries(fields).filter((e) => typeof e[1] === "string" && e[1] !== ""))).toString();

/**
 * A token answer read (RFC 6749 §5.1): the tokens and when the access token runs out. A token type other than Bearer
 * is refused in words: Filament sends only Bearer.
 * @param {any} json @param {number} now
 * @returns {{ accessToken: string, refreshToken?: string, expiresAt?: number, scope?: string }}
 */
export function tokensFrom(json, now) {
  if (!json || typeof json !== "object" || typeof json.access_token !== "string" || !json.access_token) throw new Error("its answer holds no access token");
  if (json.token_type && String(json.token_type).toLowerCase() !== "bearer") throw new Error(`it gave a ${json.token_type} token, and Filament sends only Bearer tokens`);
  const life = Number(json.expires_in);
  return {
    accessToken: json.access_token,
    ...(typeof json.refresh_token === "string" && json.refresh_token ? { refreshToken: json.refresh_token } : {}),
    ...(Number.isFinite(life) && life > 0 ? { expiresAt: now + life * 1000 } : {}),
    ...(typeof json.scope === "string" && json.scope ? { scope: json.scope } : {}),
  };
}

/** Whether headers hold their own Authorization (HS-D83: then no sign-in is used). @param {Record<string, string> | null | undefined} headers */
export const ownAuthorization = (headers) => Object.keys(headers || {}).some((k) => k.toLowerCase() === "authorization");

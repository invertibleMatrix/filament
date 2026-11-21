// @ts-check
// Signing in to a remote MCP server (HarnessV4_Settings_Plan HS-7, HS-D82 to HS-D91): a sign-in started from a
// server's row, the browser sent to the server's own page and back to Filament's address, the code exchanged and the
// tokens kept sealed by the server's address; the token handed to each engine — Filament's own agent asks for it with
// each request and has it renewed on a 401, a coding agent is given it as its server's header when its session opens
// (HS-D88) — and a sign-out. A sign-in in progress has no clock (HS-D87): it waits for the browser, Cancel, another
// Sign in, or Filament's stop. An address keeps several accounts (HarnessV4_Space_Plan S4b, SG-D2), each by the name the
// person gave it, under `signInKey`: the main one under the address alone, as every sign-in was kept before.
import { randomBytes } from "node:crypto";
import { ACCOUNT_RE, MAIN_ACCOUNT, accountOf, accountWords, accountsAt, addressOf, authorizeUrl, hostOf, ownAuthorization, pkcePair, signInKey, unguessable } from "../../core/oauth.js";
import { SignInError, discover, exchange, probe, refresh as renewTokens, register, revoke } from "../../adapters/tools/mcp-oauth.js";
import { refusal } from "./service.js";

/** Where the server's page sends the browser back to (HS-D85), under Filament's own address. */
export const BACK_PATH = "/api/mcp-servers/sign-in/back";

/**
 * A sign-in in progress, or just finished and not yet read by the page that started it: `key`, what it is kept under —
 * its address and `account`, "" for main (S4b).
 * @typedef {{ id: string, name: string, address: string, key: string, account: string, host: string, state: string, verifier: string, redirectUri: string,
 *   client: import("../../services/mcp-sign-ins.js").Client, clientKey: string, resource: string, scope?: string,
 *   auth: import("../../adapters/tools/mcp-oauth.js").AuthServer, page: string, status: "waiting" | "done" | "failed",
 *   words: string, onDone?: () => void, from?: string }} Pending
 *   `from`: the place whose row started it (a list's scope), whose rows alone show it where it is for another account
 */
/**
 * What a row shows of a server's sign-in (HS-D91): signed in, ended by the server and why, waiting for the browser,
 * or asked for by the server (a test's or a chat's connect met its challenge, HS-D83, or a look did) — or, where the
 * place picks an account no sign-in is kept for, beside others at the address; `refused`: its registration turned
 * Filament down (`why`, `at`, its `docs`), until a registration goes through. `account`: the one the place uses, as
 * words; `accounts`: those kept at the address, main first (S4b).
 * @typedef {{ state: "in" | "ended" | "waiting" | "asks" | "refused", host: string, account: string, accounts: string[], why?: string, at?: number, docs?: string, id?: string, page?: string }} SignInState
 */

/**
 * A server as a chat lists it, which Filament's connector door (http/mcp-connector.js) gives a coding agent at its own
 * address.
 * @typedef {{ name: string, url?: string, headers?: Record<string, string>, account?: string }} Connector
 * The door's view of the sign-ins (`connectorAuth`): `standing`, whether a sign-in stands that gave no token now (a
 * renewal that failed for now: "in"), ended, or none.
 * @typedef {{ header: (url: string, headers: Record<string, string>, account?: string) => Promise<string | null>,
 *   renew: (url: string, headers: Record<string, string>, account?: string) => Promise<{ ok: boolean }>,
 *   standing?: (url: string, headers: Record<string, string>, account?: string) => "in" | "ended" | "none" }} ConnectorAuth
 * The door as a turn reaches it: `give` hands a chat's server out at Filament's address, `forget` lets go of what the
 * chat's last turn gave.
 * @typedef {{ give: <S extends Connector>(base: string, chat: string, s: S) => S, forget: (chat: string) => void }} ConnectorDoor
 */

/**
 * @param {{ store: ReturnType<typeof import("../../services/mcp-sign-ins.js").createSignInStore>, selfBase: () => string,
 *   fetchImpl?: typeof fetch, now?: () => number, random?: (n: number) => Buffer, log?: (level: string, msg: string) => void }} deps
 *   `selfBase`: where Filament reaches itself (AppDeps), which the browser comes back to
 */
export function createMcpSignIns({ store, selfBase, fetchImpl = fetch, now = Date.now, random = randomBytes, log = () => {} }) {
  /** @type {Map<string, Pending>} */
  const pending = new Map();
  /** A waiting sign-in's id by its `state`, taken away at its return: a state is good once. @type {Map<string, string>} */
  const byState = new Map();
  /** Renewals in flight by sign-in: two requests that meet a 401 at once renew once. @type {Map<string, Promise<{ ok: boolean, words?: string }>>} */
  const renewing = new Map();
  /**
   * The sign-ins (an address and an account) whose server asks for one Filament does not hold, since Filament started:
   * one it asked, or one signed out of, until a sign-in or a test that meets no ask.
   * @type {Set<string>}
   */
  const asking = new Set();
  /** The sign-ins whose server `look` asked since Filament started, and the looks under way: one look each. */
  const looked = new Set();
  /** @type {Map<string, Promise<boolean>>} */
  const looking = new Map();

  const redirectUri = () => `${selfBase()}${BACK_PATH}`;

  /**
   * A sign-in with new tokens: when they run out is theirs alone, never the old ones' (nor a `life` kept before 11-07).
   * @param {import("../../services/mcp-sign-ins.js").SignIn} rec @param {{ accessToken: string, refreshToken?: string, expiresAt?: number, scope?: string }} t
   */
  const withNew = (rec, t) => {
    const { expiresAt: _ran, life: _lived, ...kept } = rec;
    return { ...kept, ...t };
  };

  /** @param {string} id */
  const forget = (id) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    byState.delete(p.state);
  };

  /**
   * Start a sign-in for a server (HC-143): what it asks for found, Filament registered where it was not yet (or the
   * client given, HS-D86), and the address of the server's page to open. One already waiting for the same account at
   * the address is replaced (HC-158).
   * @param {{ name: string, url: string, headers?: Record<string, string>, clientId?: string, clientSecret?: string, remote?: boolean, account?: string, onDone?: () => void, from?: string }} o
   *   `remote`: the page asking is on another computer (HC-156); `account`: the account it is kept as (S4b), main
   *   where it names none; `onDone`: what follows once it is kept (the place that asked picks the new account); `from`:
   *   the place that asked
   */
  async function start({ name, url, headers = {}, clientId = "", clientSecret = "", remote = false, account = "", onDone, from = "" }) {
    const host = hostOf(url);
    if (remote) throw refusal(400, `Sign in from a browser on Filament's computer: ${host}'s page sends the browser back to 127.0.0.1, which is Filament only there`);
    if (ownAuthorization(headers)) throw refusal(409, `${name} carries its own Authorization header, which goes as written: take it off in Edit to sign in instead`);
    const acct = accountOf(account);
    if (acct && !ACCOUNT_RE.test(acct)) throw refusal(400, `An account's name is letters, digits, space, . _ -, 32 at most ("${MAIN_ACCOUNT}" is the first's), not "${acct.slice(0, 40)}"`);
    const address = addressOf(url);
    const key = signInKey(address, acct);
    /** The page the server's metadata names for how to use it, for a refusal to point to. */
    let docs = "";
    try {
      const answer = await probe(url, headers, { fetchImpl });
      if (answer.status < 400) throw new SignInError(`${host} lets Filament in as it is: it needs no sign-in`, { none: true });
      const found = await discover(url, { challenge: answer.challenge, fetchImpl });
      docs = found.docs || "";
      const back = redirectUri();
      const clientKey = `${found.auth.issuer}|${back}`;
      /** @type {import("../../services/mcp-sign-ins.js").Client | null} */
      let client = clientId ? { clientId, ...(clientSecret ? { clientSecret } : {}), authMethod: clientSecret ? "client_secret_basic" : "none", at: now(), given: true } : store.client(clientKey);
      if (!client) client = await register(found.auth, { redirectUri: back, fetchImpl, now });
      if (clientId || !store.client(clientKey)) store.putClient(clientKey, client);
      // Registered, or a client given: a refusal kept from before no longer stands.
      store.dropRefusal(address);
      for (const p of [...pending.values()]) if (p.key === key) forget(p.id);
      const { verifier, challenge } = pkcePair(random(32));
      const state = unguessable(random(32));
      const id = unguessable(random(12));
      const page = authorizeUrl(found.auth.authorization_endpoint, { clientId: client.clientId, redirectUri: back, challenge, state, resource: found.resource, ...(found.scope ? { scope: found.scope } : {}) });
      pending.set(id, { id, name, address, key, account: acct, host, state, verifier, redirectUri: back, client, clientKey, resource: found.resource, ...(found.scope ? { scope: found.scope } : {}), auth: found.auth, page, status: "waiting", words: "", ...(onDone ? { onDone } : {}), ...(from ? { from } : {}) });
      byState.set(state, id);
      log("info", `mcp sign-in: ${name}${acct ? ` (${acct})` : ""} waits for its page on ${hostOf(found.auth.authorization_endpoint)}`);
      return { id, url: page, host };
    } catch (e) {
      if (!(e instanceof SignInError)) throw e;
      // A client made by hand is made with the address the browser comes back to, so the page is told it; a registration
      // turned down, with the service's own words and its documentation, says so before that route — and is kept, so
      // its row says so after a restart too, over what a look finds.
      const turned = e.turnedDown ? { turnedDown: e.turnedDown, ...(docs ? { docs } : {}) } : {};
      if (e.turnedDown) {
        store.putRefusal(address, { at: now(), why: e.turnedDown.said || `HTTP ${e.turnedDown.status}`, ...(docs ? { docs } : {}) });
        log("info", `mcp sign-in: ${name}'s registration was turned down: ${e.message}`);
      }
      throw refusal(e.needsClient ? 409 : 400, `${name}: ${e.message}`, e.needsClient ? { needsClient: true, host: hostOf(url), redirectUri: redirectUri(), ...turned } : e.none ? { none: true } : {});
    }
  }

  /**
   * The browser back from the server's page (HS-D85): a `state` Filament is waiting for, once; the code exchanged and
   * the sign-in kept. The words are what its tab says.
   * @param {URLSearchParams} q
   * @returns {Promise<{ ok: boolean, words: string, none?: boolean }>}
   */
  async function back(q) {
    const state = q.get("state") || "";
    const id = byState.get(state);
    const p = id ? pending.get(id) : null;
    // `none`: no sign-in of this Filament's waits for it — a return another machine's Filament may wait for.
    if (!p || p.status !== "waiting")
      return { ok: false, none: true, words: "Filament is not waiting for this sign-in: it was cancelled or started again, or Filament restarted since. Press Sign in again on the server's row." };
    byState.delete(state);
    const fail = (/** @type {string} */ why) => {
      p.status = "failed";
      p.words = why;
      log("info", `mcp sign-in: ${p.name}'s did not finish: ${why}`);
      return { ok: false, words: `${p.name}'s sign-in did not finish: ${why}.` };
    };
    const error = q.get("error");
    if (error) return fail(error === "access_denied" ? "you said no on its page" : `its page answered ${error}${q.get("error_description") ? ` (${q.get("error_description")})` : ""}`);
    const iss = q.get("iss");
    if (iss && iss.replace(/\/+$/, "") !== p.auth.issuer.replace(/\/+$/, "")) return fail(`the page that answered names another server (${iss})`);
    const code = q.get("code");
    if (!code) return fail("its page came back with no code");
    const rec = {
      issuer: p.auth.issuer,
      tokenEndpoint: p.auth.token_endpoint,
      ...(p.auth.revocation_endpoint ? { revocationEndpoint: p.auth.revocation_endpoint } : {}),
      clientId: p.client.clientId,
      ...(p.client.clientSecret ? { clientSecret: p.client.clientSecret } : {}),
      authMethod: p.client.authMethod,
      resource: p.resource,
      ...(p.scope ? { scope: p.scope } : {}),
    };
    try {
      const tokens = await exchange(rec, { code, verifier: p.verifier, redirectUri: p.redirectUri, fetchImpl, now });
      store.put(p.key, withNew({ ...rec, at: now() }, tokens));
      asking.delete(p.key);
    } catch (e) {
      if (!(e instanceof SignInError)) throw e;
      // A registration the server no longer knows is made again at the next sign-in.
      if (/invalid_client/.test(e.message) && !p.client.given) store.dropClient(p.clientKey);
      return fail(e.message);
    }
    const as = p.account ? ` as ${p.account}` : "";
    p.status = "done";
    p.words = `Signed in on ${p.host}${as}`;
    log("info", `mcp sign-in: ${p.name} signed in on ${p.host}${as}`);
    try {
      p.onDone?.();
    } catch (e) {
      log("warn", `mcp sign-in: ${p.name} signed in${as}, but its place could not be set to use it: ${/** @type {any} */ (e)?.message || e}`);
    }
    return { ok: true, words: `Signed in to ${p.name}${as}: you can close this tab and go back to Filament.` };
  }

  /**
   * Where a sign-in started from a page stands; a finished one is told once, then forgotten. `account`: the one it
   * signs in as, where that is not main (S4b).
   * @param {string} id
   */
  function status(id) {
    const p = pending.get(id);
    if (!p) return { status: "gone", words: "Filament is not waiting for this sign-in any more: press Sign in again" };
    if (p.status !== "waiting") forget(id);
    return { status: p.status, words: p.words, name: p.name, host: p.host, ...(p.account ? { account: p.account } : {}) };
  }

  /** @param {string} id */
  const cancel = (id) => {
    const had = pending.has(id);
    forget(id);
    return { cancelled: had };
  };

  /**
   * What a server's row shows of the sign-in of the account its place picks (main where it picks none), or null: none
   * at the address, or the server carries its own Authorization header.
   * @param {string} url @param {Record<string, string> | null | undefined} headers @param {unknown} [account]
   * @param {string} [from]  the place whose row asks: a wait for another account shows on that place's row alone
   * @returns {SignInState | null}
   */
  function stateOf(url, headers, account = "", from = "") {
    if (!url || ownAuthorization(headers)) return null;
    let address;
    try {
      address = addressOf(url);
    } catch {
      return null;
    }
    const key = signInKey(address, account);
    const said = { host: hostOf(url), account: accountWords(account), accounts: accountsAt(address, store.addresses()).map(accountWords) };
    // A sign-in waiting at the address — of this account, else of another one started from a row of this place (Sign in
    // with another account…) — is the row's to show, with its page and Cancel, until it ends. Another place's wait for
    // another account is not (found by the Hunter on S4b: project B's row showed A's wait, with A's Cancel).
    const waits = [...pending.values()].filter((p) => p.address === address && p.status === "waiting");
    const waiting = waits.find((p) => p.key === key) || (from ? waits.find((p) => p.from === from) : undefined);
    if (waiting) return { state: "waiting", ...said, account: accountWords(waiting.account), id: waiting.id, page: waiting.page };
    const rec = store.get(key);
    // A registration turned down stands over an ask: Sign in tries again, and its sheet says why.
    const turned = rec ? null : store.refusal(address);
    if (turned) return { state: "refused", ...said, why: turned.why, at: turned.at, ...(turned.docs ? { docs: turned.docs } : {}) };
    // An account the place picks with no sign-in, beside others at the address: it asks for its own.
    if (!rec) return asking.has(key) || said.accounts.length ? { state: "asks", ...said } : null;
    return rec.ended ? { state: "ended", ...said, why: rec.ended.why } : { state: "in", ...said };
  }

  /**
   * Sign out of one account at a server's address (HS-D90, S4b): its tokens forgotten now, the server told where it
   * offers that, not waited on; its row asks for a sign-in again. The address's other accounts stay. False when it
   * was not signed in.
   * @param {string} url @param {unknown} [account]
   */
  function signOut(url, account = "") {
    const key = signInKey(addressOf(url), account);
    const rec = store.get(key);
    if (!rec) return { signedOut: false, told: false };
    store.drop(key);
    asking.add(key);
    const as = accountOf(account) ? ` as ${accountOf(account)}` : "";
    void revoke(rec, { fetchImpl }).then((told) => log("info", `mcp sign-in: signed out of ${hostOf(url)}${as}${told ? "; it was told" : ""}`));
    return { signedOut: true, told: !!rec.revocationEndpoint && !rec.ended };
  }

  /**
   * Sign out of every account at a server's address (S4b): what removing the last server at it does (HC-152).
   * @param {string} url
   */
  function signOutEvery(url) {
    const address = addressOf(url);
    let signedOut = false;
    for (const a of accountsAt(address, store.addresses())) signedOut = signOut(url, a).signedOut || signedOut;
    return { signedOut };
  }

  /**
   * Whether a server wants a sign-in, asked before anyone presses anything (the owner's of 10-26: Linear's row said
   * nothing of one until a test): one MCP request with no sign-in, once per sign-in since Filament started, where Filament
   * holds none, the server asked for none yet and it carries no Authorization of its own. A 401 with a Bearer challenge
   * has its row ask, as a chat's connect reads one (adapters/tools/mcp-client.js); any other answer, or none, leaves the
   * row as it was, for its test to say. True where it asks now.
   * @param {string} url @param {Record<string, string> | null | undefined} headers @param {unknown} [account]
   * @returns {Promise<boolean>}
   */
  function look(url, headers, account = "") {
    if (!url || ownAuthorization(headers)) return Promise.resolve(false);
    let key;
    try {
      key = signInKey(addressOf(url), account);
    } catch {
      return Promise.resolve(false);
    }
    if (store.get(key) || asking.has(key)) return Promise.resolve(asking.has(key));
    const under = looking.get(key);
    if (under || looked.has(key)) return under || Promise.resolve(false);
    looked.add(key);
    const run = probe(url, headers || {}, { fetchImpl })
      .then((a) => {
        if (a.status !== 401 || !a.challenge || store.get(key)) return false;
        asking.add(key);
        return true;
      }, () => false)
      .finally(() => looking.delete(key));
    looking.set(key, run);
    return run;
  }

  /**
   * A server reached at an address answered a test as one account: with no sign-in Filament holds for it, it does not
   * ask for one.
   * @param {string} url @param {unknown} [account]
   */
  function answered(url, account = "") {
    const key = signInKey(addressOf(url), account);
    if (!store.get(key)) asking.delete(key);
  }

  /**
   * New tokens for one sign-in (an address and an account, `signInKey`), one renewal at a time; a refusal ends the
   * sign-in (HS-D89). `asks`: there is no sign-in to renew.
   * @param {string} key
   * @returns {Promise<{ ok: boolean, words?: string, asks?: boolean }>}
   */
  function renew(key) {
    const inFlight = renewing.get(key);
    if (inFlight) return inFlight;
    const at = key.indexOf("#");
    const host = `${hostOf(key)}${at >= 0 ? ` (${key.slice(at + 1)})` : ""}`;
    const run = (async () => {
      const rec = store.get(key);
      if (!rec) return { ok: false, asks: true };
      if (rec.ended) return { ok: false, words: `signed out by ${host}: sign in again in Library › Plugins & Connectors` };
      try {
        const t = await renewTokens(/** @type {any} */ (rec), { fetchImpl, now });
        store.put(key, withNew(rec, t));
        log("info", `mcp sign-in: the token for ${host} was renewed`);
        return { ok: true };
      } catch (e) {
        if (!(e instanceof SignInError)) throw e;
        if (!e.refused) return { ok: false, words: `its sign-in on ${host} could not be renewed: ${e.message}` };
        store.end(key, e.message, now());
        log("info", `mcp sign-in: ${host} ended its sign-in (${e.message})`);
        return { ok: false, words: `signed out by ${host}: sign in again in Library › Plugins & Connectors` };
      }
    })().finally(() => renewing.delete(key));
    renewing.set(key, run);
    return run;
  }

  /**
   * The token of one sign-in, renewed first when it has run out; null with why when there is none to send.
   * @param {string} key
   * @returns {Promise<{ token: string | null, words?: string, renewed?: boolean }>}
   */
  async function tokenFor(key) {
    const rec = store.get(key);
    if (!rec || rec.ended || !rec.accessToken) return { token: null };
    if (!(rec.expiresAt && rec.expiresAt <= now())) return { token: rec.accessToken };
    const r = await renew(key);
    return r.ok ? { token: store.get(key)?.accessToken || null, renewed: true } : { token: null, words: r.words };
  }

  /**
   * Filament's own agent's door to the sign-ins (the MCP client's `auth`): the header for a request, asked for each
   * time, and a renewal when the server answers 401 — where Filament holds no sign-in, the server's ask is kept for its
   * row (HS-D83). Each of the account the server's place picks (S4b).
   * @type {import("../../adapters/tools/mcp-client.js").McpAuth}
   */
  const auth = {
    async header(url, headers, account = "") {
      if (ownAuthorization(headers)) return null;
      const t = await tokenFor(signInKey(addressOf(url), account));
      return t.token ? `Bearer ${t.token}` : null;
    },
    async renew(url, headers, account = "") {
      if (ownAuthorization(headers)) return { ok: false, asks: true };
      const key = signInKey(addressOf(url), account);
      if (!store.get(key)) asking.add(key);
      return renew(key);
    },
  };

  /**
   * The chat's servers as a coding agent is given them (HS-D88, HC-149; the owner's of 11-07): a signed-in server at
   * Filament's door (`give`, http/mcp-connector.js), which adds its token — of the account its place picks (S4b) — as it
   * forwards each request, and renews it there: the agent holds no token, and a renewal changes nothing it was given, so
   * its session goes on. One whose sign-in ended, or that holds no token, is left out, since the agent would meet only a
   * refusal there. The record's words name each, never a token.
   * @template {{ name: string, url?: string, headers?: Record<string, string>, account?: string }} S
   * @param {readonly S[]} list @param {(s: S) => S} give
   * @returns {{ list: S[], words: string[] }}
   */
  function forAgent(list, give) {
    /** @type {S[]} */
    const out = [];
    /** @type {string[]} */
    const words = [];
    for (const s of list) {
      if (!s?.url || ownAuthorization(s.headers)) {
        out.push(s);
        continue;
      }
      let address;
      try {
        address = addressOf(s.url);
      } catch {
        out.push(s);
        continue;
      }
      const rec = store.get(signInKey(address, s.account));
      if (!rec) {
        out.push(s);
        continue;
      }
      const host = `${hostOf(s.url)}${accountOf(s.account) ? ` as ${accountOf(s.account)}` : ""}`;
      if (rec.ended || !rec.accessToken) {
        words.push(`mcp: the chat's server ${s.name} is left out: ${rec.ended ? `signed out by ${host} (sign in again in Library › Plugins & Connectors)` : `no token for ${host}`}`);
        continue;
      }
      out.push(give(s));
      words.push(`mcp: the chat's server ${s.name} is given through Filament, with its sign-in on ${host}`);
    }
    return { list: out, words };
  }

  /**
   * The connector door's view of the sign-ins (http/mcp-connector.js): the header and the renewal as Filament's own agent
   * has them, and whether a sign-in stands that gave no token now — a renewal that failed for now, which the agent is
   * told to ask again after — or ended, or there is none, which it is told to sign in for.
   * @type {ConnectorAuth}
   */
  const connectorAuth = {
    header: auth.header,
    renew: auth.renew,
    standing(url, headers, account = "") {
      if (ownAuthorization(headers)) return "none";
      const rec = store.get(signInKey(addressOf(url), account));
      return !rec ? "none" : rec.ended ? "ended" : "in";
    },
  };

  return { start, back, status, cancel, stateOf, look, signOut, signOutEvery, answered, auth, connectorAuth, forAgent };
}

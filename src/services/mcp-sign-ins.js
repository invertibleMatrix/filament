// @ts-check
// The sign-ins to remote MCP servers (HarnessV4_Settings_Plan HS-7, HS-D82): one per server address, kept in
// `mcp-sign-ins.json` in Filament's data folder with the registrations Filament made at each authorization server, and
// the servers whose registration turned Filament down (the owner's of 10-26: Figma), so a row says so after a restart.
// The tokens and any client secret are sealed with `secret.key`, as the configuration's secrets are, unless
// `server.encryptSecrets` is off; they are open only in memory, for the requests that carry them.
import { readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadKey, seal, open, isSealed } from "./config/secrets.js";

export const SIGN_INS_FILE = "mcp-sign-ins.json";
/** The fields kept sealed. */
const SEALED = Object.freeze(["accessToken", "refreshToken", "clientSecret"]);

/**
 * One server's sign-in. `life`: how long its access token was given for, in ms, kept until 11-07 and read no more;
 * `ended`: the server refused its refresh, or it was revoked (HS-D89): kept so its row can say so, with no token left in
 * it.
 * @typedef {{ issuer: string, tokenEndpoint: string, revocationEndpoint?: string, clientId: string, clientSecret?: string,
 *   authMethod: string, resource: string, scope?: string, accessToken?: string, refreshToken?: string, expiresAt?: number,
 *   life?: number, at: number, ended?: { at: number, why: string } }} SignIn
 */
/**
 * Filament's registration at an authorization server for one return address, or the client a person gave (HS-D86).
 * @typedef {{ clientId: string, clientSecret?: string, authMethod: string, at: number, given?: boolean }} Client
 */
/**
 * A server whose authorization server turned Filament's registration down: when, its own words or its status, and the
 * page its metadata names for how to use it. Kept until a registration goes through or a person gives a client.
 * @typedef {{ at: number, why: string, docs?: string }} Refusal
 */

/**
 * @param {{ dataDir: string | null, encrypt?: () => boolean, log?: (level: string, msg: string) => void }} o
 *   `encrypt`: whether secrets are sealed on disk now (`server.encryptSecrets`)
 */
export function createSignInStore({ dataDir, encrypt = () => true, log = () => {} }) {
  const file = dataDir ? join(dataDir, SIGN_INS_FILE) : null;
  /** @type {Map<string, SignIn>} */
  let signIns = new Map();
  /** @type {Map<string, Client>} */
  let clients = new Map();
  /** By server address. @type {Map<string, Refusal>} */
  let refusals = new Map();

  /** A record's sealed fields opened; null when one cannot be (another key sealed it). @param {any} rec @param {Buffer | null} key */
  const opened = (rec, key) => {
    if (!rec || typeof rec !== "object") return null;
    const out = { ...rec };
    for (const f of SEALED)
      if (isSealed(out[f])) {
        if (!key) return null;
        try {
          out[f] = open(out[f], key);
        } catch {
          return null;
        }
      }
    return out;
  };

  if (file)
    try {
      const raw = JSON.parse(readFileSync(file, "utf8"));
      const key = dataDir ? loadKey(dataDir, { create: false }) : null;
      /** @type {string[]} */
      const skipped = [];
      for (const [address, rec] of Object.entries(raw?.signIns || {})) {
        const o = opened(rec, key);
        if (o && typeof o.tokenEndpoint === "string") signIns.set(address, o);
        else skipped.push(address);
      }
      for (const [k, c] of Object.entries(raw?.clients || {})) {
        const o = opened(c, key);
        if (o && typeof o.clientId === "string") clients.set(k, o);
      }
      for (const [address, r] of Object.entries(raw?.refusals || {}))
        if (r && typeof r.why === "string" && Number.isFinite(r.at)) refusals.set(address, { at: r.at, why: r.why, ...(typeof r.docs === "string" ? { docs: r.docs } : {}) });
      if (skipped.length) log("warn", `mcp sign-ins: ${skipped.length} could not be opened (sealed with another secret.key?) and must be signed in again: ${skipped.join(", ")}`);
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") log("warn", `mcp sign-ins: ${SIGN_INS_FILE} could not be read (${e.message}); every server must be signed in again`);
    }

  /** A record as the file holds it: sealed where secrets are sealed. @param {Record<string, any>} rec @param {Buffer | null} key */
  const sealed = (rec, key) => (key ? Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, SEALED.includes(k) && typeof v === "string" ? seal(v, key) : v])) : rec);

  /**
   * Write the next state, then make it the store's: a save the disk refuses changes nothing.
   * @param {Map<string, SignIn>} nextIns @param {Map<string, Client>} nextClients @param {Map<string, Refusal>} [nextRefusals]
   */
  const commit = (nextIns, nextClients, nextRefusals = refusals) => {
    if (file && dataDir) {
      mkdirSync(dataDir, { recursive: true });
      const key = encrypt() ? loadKey(dataDir) : null;
      const tmp = `${file}.${process.pid}.tmp`;
      const body = {
        version: 1,
        signIns: Object.fromEntries([...nextIns].map(([a, r]) => [a, sealed(r, key)])),
        clients: Object.fromEntries([...nextClients].map(([k, c]) => [k, sealed(c, key)])),
        ...(nextRefusals.size ? { refusals: Object.fromEntries(nextRefusals) } : {}),
      };
      try {
        writeFileSync(tmp, JSON.stringify(body, null, 2), { mode: 0o600 });
        renameSync(tmp, file);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
    }
    signIns = nextIns;
    clients = nextClients;
    refusals = nextRefusals;
  };

  return {
    /** A server's sign-in, or null. @param {string} address @returns {SignIn | null} */
    get: (address) => {
      const r = signIns.get(address);
      return r ? { ...r } : null;
    },
    /** @param {string} address @param {SignIn} rec */
    put(address, rec) {
      commit(new Map(signIns).set(address, { ...rec }), clients);
    },
    /**
     * The sign-in ended by its server (HS-D89): its tokens gone, why kept.
     * @param {string} address @param {string} why @param {number} at
     */
    end(address, why, at) {
      const r = signIns.get(address);
      if (!r) return;
      const { accessToken: _a, refreshToken: _r, expiresAt: _e, life: _l, ...kept } = r;
      commit(new Map(signIns).set(address, { ...kept, ended: { at, why } }), clients);
    },
    /** @param {string} address */
    drop(address) {
      if (!signIns.has(address)) return;
      const next = new Map(signIns);
      next.delete(address);
      commit(next, clients);
    },
    /** The addresses signed in, or whose sign-in ended. */
    addresses: () => [...signIns.keys()],
    /** @param {string} key @returns {Client | null} */
    client: (key) => {
      const c = clients.get(key);
      return c ? { ...c } : null;
    },
    /** @param {string} key @param {Client} c */
    putClient(key, c) {
      commit(signIns, new Map(clients).set(key, { ...c }));
    },
    /** @param {string} key */
    dropClient(key) {
      if (!clients.has(key)) return;
      const next = new Map(clients);
      next.delete(key);
      commit(signIns, next);
    },
    /** A server's registration turned down, or null. @param {string} address @returns {Refusal | null} */
    refusal: (address) => {
      const r = refusals.get(address);
      return r ? { ...r } : null;
    },
    /** @param {string} address @param {Refusal} r */
    putRefusal(address, r) {
      commit(signIns, clients, new Map(refusals).set(address, { ...r }));
    },
    /** @param {string} address */
    dropRefusal(address) {
      if (!refusals.has(address)) return;
      const next = new Map(refusals);
      next.delete(address);
      commit(signIns, clients, next);
    },
  };
}

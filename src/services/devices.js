// @ts-check
// The devices paired with this Filament, and the codes that pair them (the owner's remote Filament of 11-06, Part 1).
// A pairing starts on this machine: a code of eight letters and digits, good for five minutes and one claim. Another
// machine's page or CLI claims it and is handed a device token once; only the token's SHA-256 is kept, in
// <dataDir>/devices.json — never in config.json, which a backup or a shared screenshot of Settings carries. A device
// is full (it drives this Filament as you do) or view (it reads). Wrong codes are counted: five from one address, or
// twenty from anywhere, within five minutes, and the claims are refused until the window passes — the codes still open
// are dropped at twenty, so a guess at a code being read out is never in time.
// Another machine's agents have a device of their own (the remote-agents plan's f-grant), apart from the person's: no
// code pairs it — a full device mints it for its own machine (`mintAgents`) — and its grants say what they may do here,
// each off until this machine's managers switch it on. It goes with the full device it was minted by.
// A person's device unused for UNUSED_DAYS is taken no more (`verify`), and says so (`lapsed`): it stays listed,
// unrevoked, until it is paired again or revoked. The days are counted from the first start that counted them at the
// earliest (`unusedFrom`), so a device paired before is not let go the day this version starts. Agents' devices never lapse.
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { same } from "../core/hash.js";
import { cleanName } from "./machine.js";

/** How long a pairing code is good for. */
export const CODE_TTL_MS = 5 * 60_000;
/** A code's letters: no 0/O, 1/I/L, so one read out loud or off a screen is typed as it was meant. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** How many codes may be open at once: one per pairing under way is plenty. */
export const OPEN_CODES = 5;
/** The window wrong codes are counted in, and how many it takes, from one address and from all of them. */
export const GUESS_WINDOW_MS = 5 * 60_000;
export const GUESSES_PER_SOURCE = 5;
export const GUESSES_IN_ALL = 20;
/** How often a device's last-seen is written: each request reads it, a minute's are one write. */
const SEEN_WRITE_MS = 60_000;
/** What a device token starts with: a log or a pasted line names it as Filament's. */
export const TOKEN_PREFIX = "fdt_";
/** How long a person's device — full or view, a browser or a command line — goes unused before its token is taken no more. */
export const UNUSED_DAYS = 90;
export const UNUSED_MS = UNUSED_DAYS * 86_400_000;
/** What a caller whose device lapsed so is told (`lapsed`; http/admin/index.js): it pairs again, nothing was revoked. */
export const LAPSED_WORDS = `this device went unused here for ${UNUSED_DAYS} days, so its pairing ran out: pair it again with a code from Settings › Remote access on the machine it reaches`;
/**
 * A Filament's id as a claim says it (services/machine.js: a UUID), lowercased; "" for anything else. Settings ›
 * Remote access shows by it which machine a device's app runs on; nothing is let in or granted by it.
 * @param {unknown} s
 */
export const machineIdOf = (s) => (typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim()) ? s.trim().toLowerCase() : "");

/** `agent`: another machine's agents' device, minted, never paired by a code. @typedef {"full" | "view" | "agent"} Scope */
/**
 * What another machine's agents may do here, each off until this machine's managers switch it on: run agents (start and
 * follow chats), use its models, use its browser, run without asking in Auto (`unasked`: off, Auto is judged as Edit
 * for their chats and their commands), and run their chats on the coding agents here (`codingAgents`). `full`, Full
 * control (the owner's of 11-09), sits on top of `agents` and is kept only with it: their chats here run as the person's
 * own, and while it is on it holds `unasked` and `codingAgents` with it (`heldGrant`). `copies`, on its own: that
 * machine sends copies of its projects here for the person's own chats and reads back what changed there (Run on,
 * http/admin/remote.js `COPY_ROUTES`) — no agent of theirs runs here by it; Agents holds it too. Every device carries
 * them; an agents' device alone holds one on.
 * @typedef {{ agents: boolean, copies: boolean, models: boolean, browser: boolean, unasked: boolean, codingAgents: boolean, full: boolean }} Grants
 */
/** The grants by name. */
export const GRANTS = Object.freeze(/** @type {(keyof Grants)[]} */ (["agents", "copies", "models", "browser", "unasked", "codingAgents", "full"]));
/** The grants Full control holds with it while on: switched off, each is as its own pill says. */
export const FULL_HOLDS = Object.freeze(/** @type {(keyof Grants)[]} */ (["unasked", "codingAgents"]));
/**
 * A device as kept: its token's hash alone, never the token. `pairing`: the id of the code it claimed, by which the
 * page that showed the code knows its own claim from another's (the review of 35049d31f). `of`: an agents' device's, the
 * full device it was minted by; `from`: the name of the machine whose agents they are, as that machine names itself
 * (its full device here is named for the app or the command line that paired, "Filament app on DESKTOP-1"). `pressless`: paired
 * by a program on this computer without the desktop app's key, while the app held one — or minted by such a device —: it
 * presses nothing while the app holds a key (http/guards.js `pressRefusal`; the xd-key hunt's). `machine`: the id of the
 * Filament whose desktop app claimed it, as its claim said it (`machineIdOf`).
 * @typedef {{ id: string, name: string, scope: Scope, kind: string, hash: string, grants: Grants, createdAt: number, lastSeenAt: number | null,
 *   lastSeenFrom: string | null, revokedAt: number | null, pairing?: string, of?: string, from?: string, machine?: string, pressless?: true }} KeptDevice
 */
/**
 * A code open now, as said to this computer: its id, never the code; how long it has left by the store's own clock, so
 * a page whose clock is not the server's counts it right.
 * @typedef {{ id: string, scope: Scope, expiresAt: number, leftMs: number }} OpenCode
 */
/**
 * A device as said to anyone: the kept one without its hash, and when it lapses unused (`expiresAt`, moved on by each
 * use; null where it never does — an agents' device, a revoked one). @typedef {Omit<KeptDevice, "hash"> & { expiresAt: number | null }} Device
 */

/**
 * A scope as kept: `full` and `agent` named so, anything else reads (the review of 882809c20: a scope that was neither —
 * a typo, a devices.json written by hand — was full). @param {unknown} s @returns {Scope}
 */
export const scopeOf = (s) => (s === "full" || s === "agent" ? s : "view");
/**
 * Grants as kept: each on where it is `true`, off else — a devices.json from before them holds none —, and Full control
 * with `agents` alone. @param {any} g @returns {Grants}
 */
const grantsOf = (g) => ({ agents: g?.agents === true, copies: g?.copies === true, models: g?.models === true, browser: g?.browser === true, unasked: g?.unasked === true, codingAgents: g?.codingAgents === true, full: g?.full === true && g?.agents === true });
/** A code as typed, as it is compared: letters upper-cased, everything that is no letter or digit gone. @param {unknown} s */
export const normalCode = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
/** @param {string} token */
const hashOf = (token) => createHash("sha256").update(token).digest("hex");
/**
 * When a device lapses unused (`UNUSED_MS` past its last use, or its pairing, or `from`, whichever is latest), or null
 * where it never does: an agents' device, a revoked one.
 * @param {Pick<KeptDevice, "scope" | "revokedAt" | "lastSeenAt" | "createdAt">} d @param {number} from  the store's `unusedFrom`
 */
const expiryOf = (d, from) => (d.scope === "agent" || d.revokedAt != null ? null : Math.max(d.lastSeenAt || 0, d.createdAt || 0, from) + UNUSED_MS);
/** Its grants a copy: what a caller does with them changes nothing kept. @param {KeptDevice} d @param {number} from  the store's `unusedFrom` @returns {Device} */
const shown = ({ hash: _hash, ...d }, from) => ({ ...d, grants: { ...d.grants }, expiresAt: expiryOf(d, from) });

/**
 * The model calls another machine's chats send this machine's models (the remote-agents plan's m-door), each with the
 * agents' device it came from: the network's door let it in by that device's token and its grant `models`
 * (http/front-door.js `lanDoor`). The inbound key check lets it through (guards.js `checkInboundAuth`); the pipeline
 * keeps memory out of it, runs no command of this machine's on it, keeps no body of it, and sends it to no coding agent.
 * @type {WeakMap<import("node:http").IncomingMessage, Device>}
 */
const lent = new WeakMap();
/** Mark a model call the network's door let in for `device`. @param {import("node:http").IncomingMessage} req @param {Device} device */
export const lendModels = (req, device) => void lent.set(req, device);
/** The agents' device a model call was let in for (`lendModels`), or null: any other caller's. @param {import("node:http").IncomingMessage} req @returns {Device | null} */
export const modelsLentTo = (req) => lent.get(req) ?? null;
/**
 * The header a loop's model calls carry where they work for another machine's agents' chat here (turn.js's lineage):
 * those calls use this machine's own models, never a third machine's, which that machine lends to this one alone
 * (the m-upstream hunt's) — as a call the network's door lent (`modelsLentTo`) does. A house-only header (house.js).
 */
export const AGENTS_CHAT_HEADER = "x-filament-agents-chat";
/**
 * The device a chat is taken to be started by where its meta cannot be read (server.js `agentDeviceOf`, turn.js): none
 * is paired by it, so what another machine's agents' chat may not do, that chat does not (the xf-words2 hunt's).
 */
export const UNREAD_DEVICE = "(unread)";
/**
 * Whether a model call works for another machine's agents — lent through the network's door, or a loop's call for their
 * chat here: it is answered by none of a third machine's models. @param {import("node:http").IncomingMessage} req
 * @param {Record<string, string> | null | undefined} headers  admitted, lower-cased names
 */
export const forAnotherMachine = (req, headers) => !!modelsLentTo(req) || headers?.[AGENTS_CHAT_HEADER] === "1";

/**
 * Whether `device` holds `grant` now: its own pill on, or — for the ones Full control holds with it (`FULL_HOLDS`) —
 * Full control on; a revoked device, whose grants the store still hands out, holds none.
 * @param {{ grants?: Partial<Grants>, revokedAt?: number | null } | null | undefined} device @param {keyof Grants} grant
 */
export const heldGrant = (device, grant) =>
  device?.revokedAt == null &&
  (device?.grants?.[grant] === true || (FULL_HOLDS.includes(grant) && device?.grants?.full === true && device?.grants?.agents === true));
/**
 * Whether a chat the agents' device `id` started runs here as the person's own: a standing agents' device — the store
 * hands a revoked one too, its grants as they were — with `agents` and `full` on. `UNREAD_DEVICE`, and an id of no
 * device, never. @param {DeviceStore | null | undefined} devices @param {string | null | undefined} id
 */
export const fullControl = (devices, id) => {
  const d = typeof id === "string" ? devices?.get?.(id) : null;
  return !!d && d.scope === "agent" && d.revokedAt == null && d.grants.agents === true && d.grants.full === true;
};
/**
 * Why what an agents' device runs here ends as its grants are set, in words; "" where nothing ends: `agents` off ends
 * it all, and so does Full control switched off — what ran under it may reach past what the rest let in —; another pill
 * moved, or Full control switched on, ends nothing. @param {Partial<Grants> | null | undefined} grants  as they are now
 * @param {Partial<Grants> | null | undefined} [before]  as they were
 */
export const grantEnds = (grants, before) =>
  grants?.agents !== true ? "grant agents was switched off" : before?.full === true && grants?.full !== true ? "Full control was switched off" : "";

/**
 * @param {{ dataDir?: string | null, now?: () => number, log?: (level: string, msg: string) => void }} [o]
 *   `dataDir` null keeps it in memory alone (tests).
 */
export function createDevices({ dataDir = null, now = () => Date.now(), log = () => {} } = {}) {
  const file = dataDir ? join(dataDir, "devices.json") : null;
  /** @type {KeptDevice[]} */
  let devices = [];
  /** Since when unused days are counted at the earliest: the first start that counted them, as the file keeps it. */
  let unusedFrom = now();
  /** The file was read and kept no `unusedFrom`: written now, so the next start counts from this one. */
  let floorUnkept = false;
  if (file)
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      const kept = Number(j?.unusedFrom);
      // One a clock set ahead wrote counts from now: a device is never kept past its days by it.
      if (Number.isFinite(kept) && kept > 0) unusedFrom = Math.min(kept, unusedFrom);
      else floorUnkept = true;
      devices = (Array.isArray(j?.devices) ? j.devices : [])
        .filter((/** @type {any} */ d) => d && typeof d.id === "string" && /^[0-9a-f]{64}$/.test(String(d.hash)))
        .map((/** @type {any} */ d) => ({ id: d.id, name: cleanName(d.name) || "A device", scope: scopeOf(d.scope), kind: String(d.kind || "browser"), hash: d.hash, grants: grantsOf(d.grants), createdAt: Number(d.createdAt) || 0, lastSeenAt: d.lastSeenAt ?? null, lastSeenFrom: d.lastSeenFrom ?? null, revokedAt: d.revokedAt ?? null, ...(typeof d.pairing === "string" ? { pairing: d.pairing } : {}), ...(typeof d.of === "string" ? { of: d.of } : {}), ...(typeof d.from === "string" && cleanName(d.from) ? { from: cleanName(d.from) } : {}), ...(machineIdOf(d.machine) ? { machine: machineIdOf(d.machine) } : {}), ...(d.pressless === true ? { pressless: /** @type {true} */ (true) } : {}) }));
    } catch (/** @type {any} */ e) {
      // Unread, nothing is let in: a device that cannot be checked is no device. The file is set aside, never written
      // over by the next pairing, for a person to look at.
      if (e?.code !== "ENOENT") {
        const aside = `${file}.unreadable-${now()}`;
        try {
          renameSync(file, aside);
        } catch {}
        log("warn", `[devices] could not read ${file} (${e?.message || e}), set aside as ${aside}: every device paired before pairs again`);
      }
    }
  /** @type {Map<string, number>} each device's last-seen as last written */
  const written = new Map(devices.map((d) => [d.id, d.lastSeenAt || 0]));
  /**
   * The devices written to their file: "" where they were, else why not — a claim not kept is undone, a revoke not kept
   * is said (the hunt of p1-devices: both were answered as kept, and a restart brought a revoked token back). What was
   * not written goes with the next save that is.
   */
  const save = () => {
    if (!file) return "";
    try {
      // Written beside the file, then put in its place; readable by this account alone where the system says so.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, unusedFrom, devices }, null, 1), { mode: 0o600 });
      renameSync(tmp, file);
      for (const d of devices) written.set(d.id, d.lastSeenAt || 0);
      return "";
    } catch (/** @type {any} */ e) {
      log("warn", `[devices] could not keep the paired devices: ${e.message}`);
      return String(e?.message || e);
    }
  };
  if (floorUnkept) save();
  /** A device as said to anyone (`shown`). @param {KeptDevice} d */
  const told = (d) => shown(d, unusedFrom);
  /** Whether a person's device went unused past its days. @param {KeptDevice} d */
  const lapsedNow = (d) => {
    const at = expiryOf(d, unusedFrom);
    return at != null && now() >= at;
  };
  /** The unrevoked device a token belongs to, lapsed or not; undefined for none. @param {unknown} token */
  const holderOf = (token) => {
    const t = String(token ?? "");
    if (!t.startsWith(TOKEN_PREFIX)) return undefined;
    const h = hashOf(t);
    return devices.find((x) => x.revokedAt == null && same(x.hash, h));
  };

  /** @type {Set<(id: string) => void>} what hears a device revoked (`onRevoke`) */
  const revokeHeard = new Set();
  /** Each listener hears `d` revoked, one's failure said and the next heard still. @param {KeptDevice} d */
  const heard = (d) => {
    for (const fn of [...revokeHeard])
      try {
        fn(d.id);
      } catch (/** @type {any} */ e) {
        log("warn", `[devices] what ${d.name} held open could not be ended: ${String(e?.message || e).slice(0, 160)}`);
      }
  };
  /** @type {Set<(id: string, grants: Grants, before: Grants) => void>} what hears an agents' device's grants set (`onGrant`) */
  const grantHeard = new Set();
  /** @type {{ id: string, code: string, scope: Scope, expiresAt: number, pressless?: true }[]} the codes open now, in memory alone */
  let codes = [];
  /** @type {{ at: number, from: string }[]} the wrong codes in the window */
  let guesses = [];
  const sweep = () => {
    const t = now();
    codes = codes.filter((c) => c.expiresAt > t);
    guesses = guesses.filter((g) => g.at > t - GUESS_WINDOW_MS);
  };
  /** When claims from `from` may come again, or 0 where they may now. @param {string} from */
  const heldUntil = (from) => {
    sweep();
    const mine = guesses.filter((g) => g.from === from);
    const over = guesses.length >= GUESSES_IN_ALL ? guesses : mine.length >= GUESSES_PER_SOURCE ? mine : null;
    return over ? over[0].at + GUESS_WINDOW_MS : 0;
  };

  return {
    /**
     * A new pairing code, for a device of `scope` — full, else view: an agents' device is minted, never claimed. The
     * oldest open code goes where OPEN_CODES are open already. `pressless`: the device it pairs presses nothing while the
     * desktop app holds a key (KeptDevice).
     * @param {{ scope?: unknown, pressless?: boolean }} [o]
     * @returns {OpenCode & { code: string }}
     */
    startPairing({ scope = "full", pressless = false } = {}) {
      sweep();
      let code = "";
      do code = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
      while (codes.some((c) => c.code === code));
      /** @type {{ id: string, code: string, scope: Scope, expiresAt: number, pressless?: true }} */
      const open = { id: randomUUID(), code, scope: scope === "full" ? "full" : "view", expiresAt: now() + CODE_TTL_MS, ...(pressless ? { pressless: /** @type {true} */ (true) } : {}) };
      codes = [...codes, open].slice(-OPEN_CODES);
      return { id: open.id, scope: open.scope, expiresAt: open.expiresAt, code: `${code.slice(0, 4)}-${code.slice(4)}`, leftMs: CODE_TTL_MS };
    },
    /** The codes open now, oldest first (never the codes: a page shows its own). @returns {OpenCode[]} */
    pending: () => {
      sweep();
      const t = now();
      return codes.map((c) => ({ id: c.id, scope: c.scope, expiresAt: c.expiresAt, leftMs: c.expiresAt - t }));
    },
    /**
     * Stop an open code by its id — the page that showed it closed it — or, with none, every one. Whether any went.
     * @param {string} [id]
     */
    cancelPairing(id) {
      const before = codes.length;
      codes = id === undefined ? [] : codes.filter((c) => c.id !== id);
      return codes.length < before;
    },
    /**
     * Close the open code typed, unclaimed: it went where others may have read it (plain http). Whether one went.
     * @param {unknown} typed
     */
    spoil(typed) {
      const want = normalCode(typed);
      const before = codes.length;
      if (want.length === 8) codes = codes.filter((c) => !same(c.code, want));
      return codes.length < before;
    },
    /**
     * A code claimed: the new device and its token, handed out this once — or why not, and when to try again.
     * @param {unknown} typed  the code as typed
     * @param {{ name?: unknown, kind?: unknown, from?: string, machine?: unknown }} [o]  `from`: the claimer's address, which
     *   its wrong codes count against; `machine`: the id of the Filament whose app claims it, kept where it is one
     * @returns {{ ok: true, token: string, device: Device } | { ok: false, why: string, retryAt?: number, unsaved?: true }}
     *   `unsaved`: the device could not be kept, so none was paired; the code stays open for another try
     */
    claim(typed, { name = "", kind = "browser", from = "", machine } = {}) {
      const held = heldUntil(from);
      if (held) return { ok: false, why: "Too many wrong codes: pairing waits a few minutes.", retryAt: held };
      const want = normalCode(typed);
      const hit = want.length === 8 ? codes.find((c) => same(c.code, want)) : undefined;
      if (!hit) {
        guesses.push({ at: now(), from });
        // Twenty wrong anywhere: the codes open now go, so a guess made over many addresses is never in time.
        if (guesses.length >= GUESSES_IN_ALL) codes = [];
        return { ok: false, why: "That code is not one this Filament has open: it may have run out (five minutes) or been used. Start a new pairing on that machine." };
      }
      codes = codes.filter((c) => c !== hit);
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      /** @type {KeptDevice} */
      const d = { id: randomUUID(), name: cleanName(name) || "A device", scope: hit.scope, kind: String(kind || "browser").slice(0, 16), hash: hashOf(token), grants: grantsOf(null), createdAt: now(), lastSeenAt: null, lastSeenFrom: null, revokedAt: null, pairing: hit.id, ...(machineIdOf(machine) ? { machine: machineIdOf(machine) } : {}), ...(hit.pressless ? { pressless: hit.pressless } : {}) };
      devices = [...devices, d];
      const why = save();
      if (why) {
        devices = devices.filter((x) => x !== d);
        codes = [...codes, hit];
        return { ok: false, why: `Filament could not keep this device (${why}): nothing was paired. Try the code again.`, unsaved: true };
      }
      return { ok: true, token, device: told(d) };
    },
    /**
     * A device for a full device's machine's agents, linked to it (`of`) and named for it, its token handed out this
     * once, its grants off. A second mint replaces the first: that one goes from the list, its token stops and what it
     * holds ends (`onRevoke`, by its id), and its grants carry over but Full control, which is asked for each time (a
     * Forget there leaves the first standing here when this machine does not answer). One revoked meanwhile passes
     * nothing on — a mint undoes no revoke. `unsaved`: the device could not be kept, so none was made and the first stands.
     * @param {string} of  the full device's id
     * @param {{ from?: unknown }} [o]  `from`: the machine's own name, as it names itself — the device is named for it
     * @returns {{ ok: true, token: string, device: Device } | { ok: false, why: string, unsaved?: true }}
     */
    mintAgents(of, { from } = {}) {
      const full = devices.find((x) => x.id === of && x.scope === "full" && x.revokedAt == null);
      if (!full) return { ok: false, why: "a full device paired with this Filament mints its machine's agents a device here; this is none" };
      const before = devices.find((x) => x.of === of && x.revokedAt == null);
      const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
      const own = cleanName(from);
      /** @type {KeptDevice} */
      const d = { id: randomUUID(), name: cleanName(`Filament agents on ${own || full.name}`), scope: "agent", kind: "agents", hash: hashOf(token), grants: grantsOf({ ...before?.grants, full: false }), createdAt: now(), lastSeenAt: null, lastSeenFrom: null, revokedAt: null, of, ...(own ? { from: own } : {}), ...(full.pressless ? { pressless: full.pressless } : {}) };
      const was = devices;
      devices = [...devices.filter((x) => x !== before), d];
      const why = save();
      if (why) {
        devices = was;
        return { ok: false, why: `Filament could not keep the agents' device (${why}): none was made. Try again.`, unsaved: true };
      }
      if (before) heard(before);
      return { ok: true, token, device: told(d) };
    },
    /**
     * An agents' device's grants, the ones named set and the rest as they were — or null where `id` is no agents'
     * device standing: a full device drives as you do, a view device reads, neither holds one, and a revoked one's are
     * used by no token and carried by no mint (the f-grant hunt's). Full control stays only with `agents`: asked for
     * without it, it stays off, and `agents` off takes it. `unsaved`: why the file could not say so — a grant switched
     * off would be on again after a restart unless a later save keeps it.
     * @param {string} id @param {Partial<Grants>} patch
     * @returns {(Device & { unsaved?: string }) | null}
     */
    grant(id, patch) {
      const d = devices.find((x) => x.id === id && x.scope === "agent" && x.revokedAt == null);
      if (!d) return null;
      const before = { ...d.grants };
      for (const k of GRANTS) if (typeof patch?.[k] === "boolean") d.grants[k] = patch[k];
      if (!d.grants.agents) d.grants.full = false;
      const unsaved = save();
      for (const fn of [...grantHeard])
        try {
          fn(d.id, { ...d.grants }, before);
        } catch (/** @type {any} */ e) {
          log("warn", `[devices] ${d.name}'s grants were set, and what it held was not told: ${String(e?.message || e).slice(0, 160)}`);
        }
      return { ...told(d), ...(unsaved ? { unsaved } : {}) };
    },
    /**
     * The device a token belongs to, unrevoked and not lapsed (`lapsed`), or null; its last-seen moves, written once a
     * minute at the most.
     * @param {unknown} token @param {string} [from]
     * @returns {Device | null}
     */
    verify(token, from = "") {
      const d = holderOf(token);
      if (!d || lapsedNow(d)) return null;
      d.lastSeenAt = now();
      if (from) d.lastSeenFrom = from;
      if (d.lastSeenAt - (written.get(d.id) || 0) >= SEEN_WRITE_MS) save();
      return told(d);
    },
    /**
     * The person's device a token belongs to that went unused UNUSED_DAYS, which `verify` takes no more — its refusal
     * says so (LAPSED_WORDS) — or null. It stays listed and unrevoked: paired again, or revoked by the person.
     * @param {unknown} token @returns {Device | null}
     */
    lapsed(token) {
      const d = holderOf(token);
      return d && lapsedNow(d) ? told(d) : null;
    },
    /** Every device, the revoked ones too, newest first. @returns {Device[]} */
    list: () => devices.map(told).sort((a, b) => b.createdAt - a.createdAt),
    /** @param {string} id @returns {Device | null} */
    get: (id) => {
      const d = devices.find((x) => x.id === id);
      return d ? told(d) : null;
    },
    /** @param {string} id @param {unknown} name @returns {Device | null} */
    rename(id, name) {
      const d = devices.find((x) => x.id === id);
      if (!d) return null;
      d.name = cleanName(name) || d.name;
      save();
      return told(d);
    },
    /**
     * A device's token stops working at once, and what it holds open ends (`onRevoke`); the device stays listed as
     * revoked. A full device's machine's agents' device goes with it: they came in by it. `unsaved`: why the file could
     * not say so — the token works again after a restart unless a later save keeps it.
     * @param {string} id @returns {(Device & { unsaved?: string }) | null}
     */
    revoke(id) {
      const d = devices.find((x) => x.id === id);
      if (!d) return null;
      let unsaved = "";
      if (d.revokedAt == null) {
        const gone = devices.filter((x) => x === d || (x.of === d.id && x.revokedAt == null));
        const at = now();
        for (const x of gone) x.revokedAt = at;
        unsaved = save();
        for (const x of gone) heard(x);
      }
      return { ...told(d), ...(unsaved ? { unsaved } : {}) };
    },
    /**
     * Hear each device revoked — by this machine, or signing itself out, an agents' device with its full device or
     * replaced by a second mint — with its id, once: the terminals, run sockets and events streams it holds end then
     * (the security review of 882809c20). → what stops hearing it.
     * @param {(id: string) => void} fn @returns {() => void}
     */
    onRevoke(fn) {
      revokeHeard.add(fn);
      return () => void revokeHeard.delete(fn);
    },
    /**
     * Hear each agents' device's grants set (`grant`), with its id, its grants now and as they were: what it holds open
     * ends as the grant it was let in by is switched off — `agents`, or `models` for a model call (guards.js
     * `endsWithDevice`) —, and what it runs as Full control goes off (`grantEnds`). → what stops hearing it.
     * @param {(id: string, grants: Grants, before: Grants) => void} fn @returns {() => void}
     */
    onGrant(fn) {
      grantHeard.add(fn);
      return () => void grantHeard.delete(fn);
    },
    /**
     * A revoked device taken off the list for good, and its machine's agents' device revoked with it: they came in by it.
     * @param {string} id @returns {boolean}
     */
    forget(id) {
      const d = devices.find((x) => x.id === id);
      if (!d || d.revokedAt == null) return false;
      devices = devices.filter((x) => x !== d && !(x.of === d.id && x.revokedAt != null));
      save();
      return true;
    },
    /** Whether any device is paired and unrevoked. */
    any: () => devices.some((d) => d.revokedAt == null),
  };
}

/** @typedef {ReturnType<typeof createDevices>} DeviceStore */

// @ts-check
// This computer's key to its own Filament (the "same computer = owner" gap, its phase 0): today any program here reaches
// the admin API as `local` with no secret. Each start mints a key into `<dataDir>/owner.key`, readable by the person's
// account alone, before the command line can find Filament (listening.json); the command line, the desktop app's own
// calls and Filament's calls to itself send it in OWNER_HEADER, and the app's windows carry a browser session minted
// with it (`session`, OWNER_SESSION_HEADER), which the app's main process adds to their calls to Filament's own origin
// alone — no cookie, which would reach every port of this computer's address. It counts on loopback alone, through no
// proxy (http/guards.js `ownerOf`), and is taken out of the request as it is read, so no route, record or log holds it
// — never an environment, an argument or an answer either. For now it changes nothing: this computer's calls without it are
// answered all the same, counted by the program that sent them (`tokenless`), which Settings › Remote access and
// `filament doctor` say, so whatever would be refused once the key is needed is found first.
import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The file in Filament's data folder the key is kept in, while Filament runs. */
export const OWNER_FILE = "owner.key";
/** The header this computer's programs send the key in. */
export const OWNER_HEADER = "x-filament-owner";
/**
 * The header the desktop app's windows carry their browser session in (`session`): added by the app's main process to
 * their calls to Filament's own origin alone (desktop/lib/policy.js `ownerSessionGoes`), never readable by their pages.
 */
export const OWNER_SESSION_HEADER = "x-filament-owner-session";
/** What a key starts with; a browser session's start. */
const KEY_PREFIX = "fot_";
const SESSION_PREFIX = "fos_";
/** The browser sessions kept at once: the newest are kept, one per start of the app's windows. */
const SESSIONS_KEPT = 16;
/** The programs counted at once: past them, the one seen longest ago goes. */
const PROGRAMS_KEPT = 50;

/** Constant-time compare, false for an empty side. @param {string} a @param {string} b */
const same = (a, b) => {
  const A = Buffer.from(a);
  const B = Buffer.from(b);
  return A.length > 0 && A.length === B.length && timingSafeEqual(A, B);
};

/** The key a data folder's Filament holds now, as its file says; "" for none. @param {string} dataDir */
export function ownerKeyOf(dataDir) {
  try {
    const k = readFileSync(join(dataDir, OWNER_FILE), "utf8").trim();
    return k.startsWith(KEY_PREFIX) ? k : "";
  } catch {
    return "";
  }
}
/** This computer's own addresses, as a URL writes them: a key goes to no other. */
const LOOPBACK = /^(?:127(?:\.\d{1,3}){3}|localhost|\[::1\])$/i;
/** A host written without brackets, lower-cased. @param {unknown} h */
const bare = (h) => String(h ?? "").replace(/^\[|\]$/g, "").toLowerCase();
/** A listener's host that takes every address of this computer's. */
const EVERY_ADDRESS = new Set(["", "0.0.0.0", "::", "*"]);
/**
 * Where the data folder's Filament listens now, as its listening.json says — written by that Filament after its key,
 * taken away as it stops —; null where none says it, or its process is gone or another account's (its pid reused).
 * A file a Filament that stopped without a word left holds that start's key, which no start takes again.
 * @param {string} dataDir @returns {{ port: number, host: string } | null}
 */
const listeningAt = (dataDir) => {
  try {
    const row = JSON.parse(readFileSync(join(dataDir, "listening.json"), "utf8"));
    if (!Number.isInteger(row?.port) || !Number.isInteger(row?.pid)) return null;
    process.kill(row.pid, 0);
    return { port: row.port, host: bare(row.host) };
  } catch {
    return null;
  }
};
/**
 * The header a call to `url` carries the data folder's key in, read now: only where `url` is this computer's own
 * address, the one that folder's Filament listens on, at its port (`listeningAt`) — never to whatever answers at a port
 * it does not hold, a config's port it moved from, another account's listener, or another address's listener at its
 * port (`localhost` and [::1] where it listens on 127.0.0.1 alone, the hunt on s0a) —; none where no key reads.
 * @param {string} dataDir @param {string} url @returns {Record<string, string>}
 */
export const ownerHeaders = (dataDir, url) => {
  /** @type {URL} */
  let u;
  try {
    u = new URL(url);
  } catch {
    return {};
  }
  const at = listeningAt(dataDir);
  if (u.protocol !== "http:" || !LOOPBACK.test(u.hostname) || !at || Number(u.port || 80) !== at.port) return {};
  if (!EVERY_ADDRESS.has(at.host) && bare(u.hostname) !== at.host) return {};
  const k = ownerKeyOf(dataDir);
  return k ? { [OWNER_HEADER]: k } : {};
};

/** The keys of the Filaments listening in this process, by their port: a call reaches the one at its port. @type {Map<number, Owner>} */
const atPort = new Map();
/** The owner's key of the Filament listening at `port` in this process; null for none. @param {unknown} port */
export const ownerAt = (port) => atPort.get(Number(port)) ?? null;

/**
 * One program counted: what it called itself (its User-Agent, cut short), how many of its calls came without the key,
 * and when the last did. @typedef {{ agent: string, count: number, lastAt: number }} Program
 */
/**
 * @typedef {ReturnType<typeof createOwner>} Owner
 */
/**
 * A Filament's key, minted as it listens (`listen`) and taken away as it stops (`close`).
 * @param {{ dataDir: string, log?: (level: string, msg: string) => void, now?: () => number }} o
 */
export function createOwner({ dataDir, log = () => {}, now = Date.now }) {
  const file = join(dataDir, OWNER_FILE);
  let key = "";
  let port = 0;
  /** The browser sessions minted, oldest first. @type {string[]} */
  const sessions = [];
  /** The programs that came without the key, by what they called themselves. @type {Map<string, Program>} */
  const programs = new Map();
  let count = 0;
  let toldProxy = false;
  /** The key written beside its file and then in its place, readable by this account alone. */
  const write = () => {
    const tmp = `${file}.${process.pid}.tmp`;
    mkdirSync(dataDir, { recursive: true });
    try {
      writeFileSync(tmp, `${key}\n`, { mode: 0o600 });
      try {
        chmodSync(tmp, 0o600);
      } catch {}
      renameSync(tmp, file);
    } catch (e) {
      try {
        unlinkSync(tmp);
      } catch {}
      throw e;
    }
  };
  const owner = {
    /**
     * A new key, kept in its file and known at `port` in this process: before listening.json is written, so the
     * command line that finds Filament finds its key. A file that cannot be written is said, and one an earlier start
     * left taken away where it can be: the calls without it are answered all the same. @param {number} p
     */
    listen(p) {
      key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
      sessions.length = 0;
      if (port && atPort.get(port) === owner) atPort.delete(port);
      port = Number(p);
      atPort.set(port, owner);
      try {
        write();
      } catch (/** @type {any} */ e) {
        try {
          rmSync(file, { force: true });
        } catch {}
        log("warn", `the owner key could not be written to ${OWNER_FILE} (${e?.code || e?.message || e}): the command line's calls are counted as without it`);
      }
    },
    /** Known no more, and its file taken away where it is still this start's. */
    close() {
      if (port && atPort.get(port) === owner) atPort.delete(port);
      port = 0;
      if (key && ownerKeyOf(dataDir) === key) rmSync(file, { force: true });
      key = "";
      sessions.length = 0;
    },
    /** Whether `sent` is the key. @param {unknown} sent */
    holds: (sent) => !!key && same(String(sent ?? ""), key),
    /** The key, for Filament's calls to itself (services/loopback.js) alone; "" before it listens. */
    key: () => key,
    /** A browser session for the app's windows, minted for a call that held the key (admin/owner.js). */
    session() {
      const s = `${SESSION_PREFIX}${randomBytes(32).toString("base64url")}`;
      sessions.push(s);
      while (sessions.length > SESSIONS_KEPT) sessions.shift();
      return s;
    },
    /** Whether `sent` is a browser session this start minted. @param {unknown} sent */
    sessionHolds: (sent) => {
      const s = String(sent ?? "");
      return s.startsWith(SESSION_PREFIX) && sessions.some((x) => same(s, x));
    },
    /** Said once: a call carried the key from beyond this computer's own address, or through a proxy, where it counts for nothing. */
    proxied() {
      if (toldProxy) return;
      toldProxy = true;
      log("warn", "a call carried this computer's owner key through a proxy, or from beyond this computer's own address: the key counts over loopback alone, so it was not taken");
    },
    /**
     * A call of this computer's without the key, counted by what it calls itself; its first is said in the log.
     * @param {unknown} userAgent
     */
    tokenless(userAgent) {
      const agent = String(userAgent ?? "").trim().slice(0, 120) || "(no user agent)";
      count++;
      const had = programs.get(agent);
      programs.delete(agent);
      programs.set(agent, { agent, count: (had?.count ?? 0) + 1, lastAt: now() });
      while (programs.size > PROGRAMS_KEPT) programs.delete(/** @type {string} */ (programs.keys().next().value));
      if (!had) log("info", `a program on this computer reached the admin API without the owner key (${agent}): answered all the same; it would need the key once this computer's calls need one`);
    },
    /** The calls without the key since this start, and the programs that made them, newest first. */
    said: () => ({ count, programs: [...programs.values()].reverse().map((p) => ({ ...p })) }),
  };
  return owner;
}

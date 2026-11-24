// @ts-check
// This machine as another Filament knows it (the owner's remote Filament of 11-06, Part 1): an id made once, and a name
// the person may change, kept in <dataDir>/machine.json. A remote that adds this machine keeps its id, so a new address
// for the same machine (a LAN address, then its tailnet name) is still the same machine, and another one at an address
// it knew is said to be another. Not memory.json's deviceId: that one belongs to the memory folder, goes with it to a
// fresh install or a restore, and is absent while memory is off.
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { chmodSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";

/** The wire Filaments speak to each other: a remote reads it from /.well-known/filament before it pairs. */
export const MACHINE_PROTOCOL = 1;
/**
 * The oldest wire this Filament still speaks, said beside it (`protocolLowest`): a machine on an older one is told to
 * update. Both are raised only by a change to the wire that an older Filament would misread, never for a feature, which
 * goes by what a machine says it has (GET /remote/me's `desk` flags).
 */
export const MACHINE_PROTOCOL_LOWEST = 1;

/** A wire as a machine said it: a whole number from 1, else 1 — every Filament spoke 1 before it said which. @param {unknown} n */
const wireOf = (n) => (Number.isInteger(n) && Number(n) >= 1 ? Number(n) : 1);

/**
 * Which side must update for two Filaments to speak, from what the other said of itself (its /.well-known/filament):
 * "there" where its wire is older than the oldest this one speaks, "here" where this one's is older than the oldest it
 * speaks, null where they speak. @param {any} said @param {{ protocol?: number, lowest?: number }} [here]
 * @returns {"there" | "here" | null}
 */
export function protocolGap(said, { protocol = MACHINE_PROTOCOL, lowest = MACHINE_PROTOCOL_LOWEST } = {}) {
  if (wireOf(said?.protocol) < lowest) return "there";
  if (protocol < wireOf(said?.protocolLowest)) return "here";
  return null;
}

/**
 * Who must update, in words: the other machine by its name, or this one (`self`: "this app", "this Filament").
 * @param {"there" | "here"} gap @param {{ name: string, version?: string | null }} there @param {string} [self]
 */
export function gapWords(gap, { name, version }, self = "this app") {
  const runs = version ? `runs Filament ${version}` : "runs a Filament";
  return gap === "there" ? `${name} ${runs}, too old for ${self}: update Filament on ${name}.` : `${name} ${runs}, too new for ${self}: update ${self}.`;
}
/** The longest a machine's name may be: it is shown on a rail of machines. */
export const NAME_MAX = 64;

/** @typedef {{ id: string, name: string }} Machine */

/**
 * This Filament's own name under `localhost` for a browser on this computer (`pageHost`): a label made once, kept in
 * machine.json. A browser paired by `filament open` or the tray's Open in browser holds its cookie there, never on
 * 127.0.0.1, whose cookies a browser sends to every port of it — a server an agent runs among them, which any page the
 * person opens there reaches. Any server on this computer answers the name at its own port too, so the name is kept from
 * agents (said to this computer's owner alone, the pairing rows; never in `get`; machine.json its account's alone).
 */
const PAGE_LABEL = /^filament-[0-9a-f]{12}$/;
/**
 * The label of a page name (`pageHost`), as a browser here's link carries it (`&name=`, src/ui/pair.js `pageMove`): ""
 * for none or any other. @param {unknown} pageHost
 */
export const pageLabelOf = (pageHost) => {
  const label = String(pageHost ?? "").toLowerCase().replace(/\.localhost$/, "");
  return PAGE_LABEL.test(label) && String(pageHost).toLowerCase() === `${label}.localhost` ? label : "";
};

/**
 * A name as kept: control characters and runs of spaces gone, and the invisible format characters — bidi controls that
 * turn the words around them, zero-width marks — taken out, cut to NAME_MAX. Its brackets are parentheses: another
 * machine's name is said inside Filament's notices, where one would open or close a notice (the swarm's review of 11-10).
 * @param {unknown} s
 */
export const cleanName = (s) =>
  String(s ?? "")
    .replace(/\p{Cf}/gu, "")
    .replace(/\p{Cc}/gu, " ")
    .replace(/[[［]/g, "(")
    .replace(/[\]］]/g, ")")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX)
    .trim();

/**
 * The name the person knows this computer by: a Mac's Computer Name (System Settings › General › About), which its
 * hostname need not be — a Mac whose network's DNS names its address answers that address (the owner's MacBook of
 * 11-09, "192.168.0.77") —; elsewhere, or where none is read, the hostname.
 * @param {{ platform?: string, run?: (cmd: string, args: string[]) => string, host?: () => string }} [o]
 */
export function computerName({ platform = process.platform, run = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8", timeout: 3000, stdio: ["ignore", "pipe", "ignore"], windowsHide: true }), host = hostname } = {}) {
  if (platform === "darwin")
    try {
      const own = cleanName(run("/usr/sbin/scutil", ["--get", "ComputerName"]));
      if (own) return own;
    } catch {}
  return host();
}

/**
 * @param {{ dataDir?: string | null, host?: () => string, log?: (level: string, msg: string) => void, now?: () => number }} [o]
 *   `dataDir` null keeps it in memory alone (tests); `host` names the machine where the person has not.
 */
export function createMachine({ dataDir = null, host = computerName, log = () => {}, now = () => Date.now() } = {}) {
  const file = dataDir ? join(dataDir, "machine.json") : null;
  const hostName = () => cleanName(host()) || "This machine";
  /** @type {Machine | null} */
  let kept = null;
  /** The name kept is one the person gave (`rename`), not the machine's own as it was read. */
  let named = false;
  /** A kept name that is an address the machine was named by, never the person: read as the machine's own again. */
  let stale = false;
  /** This Filament's page name's label (`PAGE_LABEL`): "" until read or made. */
  let page = "";
  if (file)
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      if (typeof j?.id !== "string" || !j.id.trim()) throw new Error("it names no id");
      named = j.named === true;
      const name = cleanName(j.name);
      stale = !!name && !named && isIP(name) !== 0 && isIP(hostName()) === 0;
      kept = { id: j.id.trim(), name: (!stale && name) || hostName() };
      page = typeof j.page === "string" && PAGE_LABEL.test(j.page) ? j.page : "";
      // This account's alone as it is read too (the hunt on x38): one a copy, a restore or another program left readable
      // to others gives away the page name a browser here is paired at.
      if (process.platform !== "win32")
        try {
          chmodSync(file, 0o600);
        } catch (/** @type {any} */ e) {
          log("warn", `[machine] could not make ${file} this account's alone: ${e?.message || e}`);
        }
    } catch (/** @type {any} */ e) {
      if (e?.code !== "ENOENT") {
        // Set aside, never overwritten: the id another machine paired with may still be read out of it by hand.
        const aside = `${file}.unreadable-${now()}`;
        try {
          renameSync(file, aside);
        } catch {}
        log("warn", `[machine] could not read ${file} (${e?.message || e}), set aside as ${aside}: this machine has a new id, and a machine paired with the old one asks to pair again`);
      }
    }
  const save = () => {
    if (!file || !kept) return;
    try {
      // Written beside the file, then put in its place: a write cut short leaves the id as it was, never torn.
      const tmp = `${file}.tmp`;
      // This account's alone: it keeps the page name (`PAGE_LABEL`).
      writeFileSync(tmp, JSON.stringify({ version: 1, id: kept.id, name: kept.name, ...(named ? { named: true } : {}), page }, null, 1), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (/** @type {any} */ e) {
      log("warn", `[machine] could not keep this machine's id and name: ${e.message}`);
    }
  };
  const made = !kept;
  if (!kept) kept = { id: randomUUID(), name: hostName() };
  const paged = !page;
  if (!page) page = `filament-${randomBytes(6).toString("hex")}`;
  // A stale name kept anew too: the desktop app reads it from the file (desktop/main.js `ownName`).
  if (made || stale || paged) save();
  const self = /** @type {Machine} */ (kept);
  return {
    /** This machine's id and name. @returns {Machine} */
    get: () => ({ id: self.id, name: self.name }),
    /** This Filament's own name under localhost for a browser on this computer (`PAGE_LABEL`, `pageLabelOf`). */
    pageHost: () => `${page}.localhost`,
    /** A new name; an empty one is the machine's own (its Computer Name, or its hostname). @param {unknown} name @returns {Machine} */
    rename(name) {
      const given = cleanName(name);
      named = !!given;
      self.name = given || hostName();
      save();
      return { id: self.id, name: self.name };
    },
  };
}

/** @typedef {ReturnType<typeof createMachine>} MachineStore */

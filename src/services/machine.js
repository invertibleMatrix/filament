// @ts-check
// This machine as another Filament knows it (the owner's remote Filament of 11-06, Part 1): an id made once, and a name
// the person may change, kept in <dataDir>/machine.json. A remote that adds this machine keeps its id, so a new address
// for the same machine (a LAN address, then its tailnet name) is still the same machine, and another one at an address
// it knew is said to be another. Not memory.json's deviceId: that one belongs to the memory folder, goes with it to a
// fresh install or a restore, and is absent while memory is off.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { hostname } from "node:os";
import { join } from "node:path";

/** The wire Filaments speak to each other: a remote reads it from /.well-known/filament before it pairs. */
export const MACHINE_PROTOCOL = 1;
/** The longest a machine's name may be: it is shown on a rail of machines. */
export const NAME_MAX = 64;

/** @typedef {{ id: string, name: string }} Machine */

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
  if (file)
    try {
      const j = JSON.parse(readFileSync(file, "utf8"));
      if (typeof j?.id !== "string" || !j.id.trim()) throw new Error("it names no id");
      named = j.named === true;
      const name = cleanName(j.name);
      stale = !!name && !named && isIP(name) !== 0 && isIP(hostName()) === 0;
      kept = { id: j.id.trim(), name: (!stale && name) || hostName() };
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
      writeFileSync(tmp, JSON.stringify({ version: 1, id: kept.id, name: kept.name, ...(named ? { named: true } : {}) }, null, 1));
      renameSync(tmp, file);
    } catch (/** @type {any} */ e) {
      log("warn", `[machine] could not keep this machine's id and name: ${e.message}`);
    }
  };
  const made = !kept;
  if (!kept) kept = { id: randomUUID(), name: hostName() };
  // A stale name kept anew too: the desktop app reads it from the file (desktop/main.js `ownName`).
  if (made || stale) save();
  const self = /** @type {Machine} */ (kept);
  return {
    /** This machine's id and name. @returns {Machine} */
    get: () => ({ id: self.id, name: self.name }),
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

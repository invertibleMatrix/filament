#!/usr/bin/env node
// `npm run reset`: the clean slate (HarnessV3-AtHome AH-C4). It keeps how Filament is reached and what it reaches — the
// server's host, port, inbound keys and admin token, the upstreams and the routes, secret.key (so their keys still
// open), the saved model lists, the token calibration and the installed memory engine — and wipes everything else:
// every other setting returns to its default, and memory goes — wherever memory.folder points, with the backups
// Filament wrote of it — as do the runs, the usage, every generation of the logs, the agents' session state, and the
// browser profiles of the desktop app (desktop) and of the app window `npm run app` opens (app-profile), their sign-ins
// and the desktop app's window places with them. What it wipes, the old config.json included, moves into
// <dataDir>/reset-backups/<stamp>/ — the data folder's entries under data/, so copying them back restores it.
// --no-backup deletes instead, --backup-dir puts the copy elsewhere, and the newest few copies are kept
// (--keep-backups, 3 by default).
//
// The server must be down for the wipe (the archive is an open SQLite file). The script stops the Filament that serves
// this data folder through POST /api/shutdown and waits; whatever else answers on that port is left alone. If the tray
// supervises Filament it restarts it within seconds: the new config.json is written the moment the server is down,
// before anything moves, the wipe moves rather than deletes in place (a move is instant), and a restart that wins the
// race is stopped again and the move retried. It never kills a process. The desktop app holds its own folder (desktop)
// while it runs and starts Filament again as soon as it stops, and the app window holds its profile while it is open: a
// reset while either runs on this data folder ends before it stops Filament or writes anything, and says to quit it.
//
//   node scripts/reset.mjs [--yes] [--no-backup] [--backup-dir <dir>] [--keep-backups <n>] [--data-dir <dir>]
import { renameSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { normalizeConfig, sparseConfig, resolveDataDir } from "../src/services/config/store.js";
import { loadKey, sealConfig, isSealed, open } from "../src/services/config/secrets.js";

/** @param {string} message @param {number} [code] @returns {never} */
const fail = (message, code = 2) => {
  console.error(message);
  process.exit(code);
};
const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(`--${name}`);
  if (at < 0) return fallback;
  const next = process.argv[at + 1];
  return next != null && !next.startsWith("--") ? next : true;
};
for (const needs of ["data-dir", "backup-dir"]) if (arg(needs) === true) fail(`--${needs} needs a path after it`);

/** Paths compare without case where the file system ignores it. @param {string} p */
const norm = (p) => (process.platform === "win32" || process.platform === "darwin" ? p.toLowerCase() : p);
/** Whether `p` is `dir` or lies inside it. @param {string} p @param {string} dir */
const inside = (p, dir) => {
  const a = norm(p);
  const b = norm(dir);
  return a === b || a.startsWith(b.endsWith(sep) ? b : b + sep);
};
/** A folder no reset takes whole: a drive's root, the home folder or one of its parents. @param {string} p */
const tooBroad = (p) => dirname(p) === p || inside(homedir(), p);

const dataDir = resolve(resolveDataDir(typeof arg("data-dir") === "string" ? String(arg("data-dir")) : null));
const configFile = join(dataDir, "config.json");
if (!existsSync(configFile)) fail(`no Filament at ${dataDir} (config.json is not there) — pass --data-dir if it lives elsewhere`);
if (tooBroad(dataDir)) fail(`refusing: ${dataDir} is a drive's root, the home folder or one of its parents — a reset empties its data folder`);
/** @param {string} text @returns {any} */
const parseConfig = (text) => {
  try {
    return JSON.parse(text);
  } catch (/** @type {any} */ e) {
    return fail(`${configFile} is not valid JSON (${e.message}): a reset keeps its upstreams and routes, so fix the file first`);
  }
};
const raw = parseConfig(readFileSync(configFile, "utf8"));
// The kept keys are written sealed with secret.key: one that cannot be read stops the reset before anything is touched.
try {
  loadKey(dataDir, { create: false });
} catch (/** @type {any} */ e) {
  fail(e.message);
}

// What the data folder keeps; every other entry in it is wiped.
const KEEP = ["config.json", "secret.key", "models-cache.json", "token-calib.json", "memory-engine", "reset-backups"];
const KEPT_WORDS = [
  "the server's host, port, inbound keys and admin token",
  "the upstreams and the routes",
  "secret.key",
  "the saved model lists (models-cache.json)",
  "the token calibration (token-calib.json)",
  "the installed memory engine (memory-engine/)",
];
/** The browser profiles in the data folder, by the folder's name: what the listing says each one holds, and what holds
 *  it while it is in use. */
const PROFILES = {
  desktop: {
    words: "the desktop app's own folder (desktop/: its browser sign-ins and cookies, its window places, its notifications setting)",
    says: "the desktop app's own folder",
    held: "the app holds it while it runs on this data folder, and starts Filament again as soon as it stops — quit it (its tray's Quit)",
  },
  "app-profile": {
    words: "the app window's browser profile (app-profile/: its sign-ins and cookies)",
    says: "the browser profile of the app window `npm run app` opens",
    held: "the window holds it while it is open — close it",
  },
};
/** How the listing names a data folder's entry. @param {string} name */
const entryWords = (name) => PROFILES[/** @type {keyof typeof PROFILES} */ (norm(name))]?.words ?? name;

const memoryFolder = resolve(String(raw.memory?.folder || "").trim() || join(dataDir, "memory"));
if (inside(dataDir, memoryFolder) || tooBroad(memoryFolder))
  fail(`refusing: memory.folder (${memoryFolder}) is the data folder, a drive's root, the home folder or a parent of one of them — a reset takes memory's folder whole`);
if (KEEP.some((k) => norm(join(dataDir, k)) === norm(memoryFolder))) fail(`refusing: memory.folder (${memoryFolder}) is a folder a reset keeps`);
const backupsFolder = String(raw.memory?.backups?.folder || "").trim() ? resolve(String(raw.memory.backups.folder).trim()) : null;

/** What a reset wipes, as the folders hold it now: where each thing is, where its copy goes in the backup, how the
 *  listing names it. */
const wipeList = () => {
  /** @type {{ path: string, into: string, words: string }[]} */
  const out = [];
  /** @param {string} path @param {string} into @param {string} words */
  const add = (path, into, words) => {
    if (!out.some((w) => inside(path, w.path))) out.push({ path, into, words });
  };
  for (const name of readdirSync(dataDir)) if (!KEEP.some((k) => norm(k) === norm(name))) add(join(dataDir, name), join("data", name), entryWords(name));
  // Memory kept elsewhere goes whole, what earlier builds left in it included: the folder is memory's own, as its
  // manifest says. Of a backup destination only the backups Filament wrote go, by their names — that folder may be shared.
  if (existsSync(join(memoryFolder, "memory.json")) || existsSync(join(memoryFolder, "archive.db")))
    add(memoryFolder, "memory-folder", `${memoryFolder} (memory.folder)`);
  if (backupsFolder && existsSync(backupsFolder))
    for (const name of readdirSync(backupsFolder))
      if (/^filament-memory-/.test(name)) add(join(backupsFolder, name), join("memory-backups", name), `${join(backupsFolder, name)} (a memory backup)`);
  return out;
};
const wipe = wipeList();

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = arg("no-backup") ? null : resolve(String(arg("backup-dir") || join(dataDir, "reset-backups", stamp)));
const swallowed = backupDir && wipe.find((w) => inside(backupDir, w.path));
if (swallowed) fail(`refusing: --backup-dir (${backupDir}) lies inside ${swallowed.path}, which the reset wipes`);

// Where the running server answers: its configured host, or this machine for a listener on every interface. An IPv6
// host is written in brackets in an address, whether config.json writes it with them or without.
const listener = normalizeConfig({ server: raw.server }).server;
const host = String(listener.host || "").trim().replace(/^\[(.*)\]$/, "$1");
const base = `http://${!host || host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host.includes(":") ? `[${host}]` : host}:${listener.port}`;
/** The admin token, for a listener that is not loopback (the admin API answers loopback alone without it). */
const adminHeaders = (() => {
  try {
    const t = raw.server?.adminToken;
    if (!t) return {};
    const key = isSealed(t) ? loadKey(dataDir, { create: false }) : null;
    const plain = isSealed(t) ? (key ? open(t, key) : "") : String(t);
    return plain ? { "x-filament-admin": plain } : {};
  } catch {
    return {};
  }
})();
/** What answers at `base`: nothing, or a server and the data folder its /api/state names. */
const probe = async () => {
  try {
    const r = await fetch(`${base}/api/state`, { headers: adminHeaders, signal: AbortSignal.timeout(1500) });
    const st = await r.json().catch(() => null);
    return { up: true, status: r.status, dataDir: typeof st?.dataDir === "string" ? resolve(st.dataDir) : null };
  } catch {
    return { up: false, status: 0, dataDir: null };
  }
};
let toldOther = false;
/** Stop the Filament that serves this data folder. Whatever else answers on the port — a Filament serving another
 *  folder, or something that names none — is left running. */
const stopServer = async () => {
  const s = await probe();
  if (!s.up) return;
  if (!s.dataDir || norm(s.dataDir) !== norm(dataDir)) {
    if (!toldOther) console.log(`left running: what answers at ${base} ${s.dataDir ? `serves ${s.dataDir}` : `names no data folder (HTTP ${s.status})`}, not this one`);
    toldOther = true;
    return;
  }
  try {
    await fetch(`${base}/api/shutdown`, { method: "POST", headers: adminHeaders, signal: AbortSignal.timeout(5000) });
  } catch {}
  for (let i = 0; i < 60; i++) {
    // in-flight turns can hold the exit for up to 20 s
    if (!(await probe()).up) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  fail(`Filament at ${base} did not stop within 30 s — finish or stop the running turns, then run this again`, 1);
};

console.log(`Filament reset — data folder ${dataDir}`);
console.log(`wipes : ${wipe.map((w) => w.words).join(", ") || "no files"}; every other setting returns to its default`);
console.log(`keeps : ${KEPT_WORDS.join("; ")}`);
if (!arg("yes")) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((r) => rl.question(`type "reset" to wipe the above (anything else aborts): `, r));
  rl.close();
  if (String(answer).trim().toLowerCase() !== "reset") {
    console.log("aborted — nothing was touched");
    process.exit(0);
  }
}

// The desktop app keeps files of its own folder (its Electron profile) open for as long as it runs on this data folder,
// and starts Filament again as soon as it stops; the app window keeps its browser profile open the same way while it is
// open. With either running the wipe cannot finish, and one that stopped half way would leave the new config.json over
// the rest. Whether they run is found before anything changes — each folder is taken aside and put straight back, and
// Windows keeps a folder with an open file where it is.
for (const [name, profile] of Object.entries(PROFILES)) {
  const folder = join(dataDir, name);
  if (!existsSync(folder)) continue;
  const aside = `${folder}.reset-${process.pid}`;
  try {
    renameSync(folder, aside);
  } catch (/** @type {any} */ e) {
    fail(`${folder}, ${profile.says}, is in use (${e?.code || e?.message}): ${profile.held}, then run this again. Nothing was touched`, 1);
  }
  try {
    renameSync(aside, folder);
  } catch (/** @type {any} */ e) {
    fail(`${folder} was taken aside as ${aside} and could not be put back (${e?.code || e?.message}): rename it back, then run this again. Nothing else was touched`, 1);
  }
}

await stopServer();
// The settings first, from the file as it stands now that the server cannot write it: what is kept is taken as stored —
// a secret is never opened here, so one this secret.key cannot open is carried as it is — and written the way Filament
// writes the file (what differs from the defaults, every secret sealed).
const before = readFileSync(configFile);
const stored = parseConfig(before.toString("utf8"));
const server = stored.server && typeof stored.server === "object" ? stored.server : {};
const kept = normalizeConfig({
  server: Object.fromEntries(["host", "port", "inboundKeys", "adminToken"].filter((k) => server[k] !== undefined).map((k) => [k, server[k]])),
  upstreams: Array.isArray(stored.upstreams) ? stored.upstreams : [],
  routes: Array.isArray(stored.routes) ? stored.routes : [],
});
if (backupDir) {
  mkdirSync(join(backupDir, "data"), { recursive: true });
  writeFileSync(join(backupDir, "data", "config.json"), before);
}
const tmp = `${configFile}.reset-${process.pid}.tmp`;
writeFileSync(tmp, JSON.stringify(sealConfig(sparseConfig(kept), loadKey(dataDir)), null, 2) + "\n");
renameSync(tmp, configFile);

/** Move one wiped thing into the backup — a busy file means a restart won the race, and the caller stops the server
 *  again. A move across drives (memory kept on another volume) is EXDEV: copy, then delete. Without a backup it is
 *  deleted. @param {{ path: string, into: string }} item */
const moveAway = (item) => {
  if (!existsSync(item.path)) return false;
  if (backupDir) {
    // What a restarted server wrote again lands beside the first copy, never over it.
    let into = join(backupDir, item.into);
    for (let n = 2; existsSync(into); n++) into = join(backupDir, `${item.into}~${n}`);
    mkdirSync(dirname(into), { recursive: true });
    try {
      renameSync(item.path, into);
    } catch (/** @type {any} */ e) {
      if (!/EXDEV|cross-device/i.test(String(e?.code || e?.message || ""))) throw e;
      cpSync(item.path, into, { recursive: true, force: true });
      rmSync(item.path, { recursive: true, force: true });
    }
  } else rmSync(item.path, { recursive: true, force: true });
  return true;
};

// The list is taken again: what the server wrote as it stopped goes too.
/** @type {string[]} */
const wiped = [];
for (let attempt = 1; ; attempt++) {
  try {
    for (const item of wipeList()) if (moveAway(item)) wiped.push(item.words);
    break;
  } catch (/** @type {any} */ e) {
    if (attempt === 6) {
      console.error(`could not move ${wipeList().map((w) => w.words).join(", ")}: ${e.message}`);
      fail("(the tray restarts Filament within seconds of it stopping — exit the tray, run this again, and it will finish)", 1);
    }
    console.log(`the server came back mid-move (${e.message}) — stopping it again, attempt ${attempt + 1}`);
    await new Promise((r) => setTimeout(r, 1000));
    await stopServer();
  }
}

// Reset copies pile up; the newest few are enough, this one among them.
const keepArg = arg("keep-backups");
const keep = keepArg == null || keepArg === true ? 3 : Math.max(0, Number(keepArg) || 0);
const backupsRoot = join(dataDir, "reset-backups");
try {
  const older = readdirSync(backupsRoot).filter((name) => !backupDir || norm(join(backupsRoot, name)) !== norm(backupDir)).sort();
  const room = Math.max(0, keep - (backupDir && norm(dirname(backupDir)) === norm(backupsRoot) ? 1 : 0));
  for (const name of older.slice(0, Math.max(0, older.length - room))) rmSync(join(backupsRoot, name), { recursive: true, force: true });
} catch {}

console.log(wiped.length ? `wiped: ${[...new Set(wiped)].join(", ")}` : "no files to wipe");
console.log("every other setting is back at its default");
if (backupDir) console.log(`a copy of everything wiped, the old config.json included, is at ${backupDir}`);
console.log(`kept: ${KEPT_WORDS.join("; ")}`);
console.log("Filament restarts on its own when the tray is running; otherwise start it as usual (the first start makes a new, empty memory).");

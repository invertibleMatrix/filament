// @ts-check
// Copies (the remote plan's cp-root, after the review of 11-10 by Fable 5.2): where another machine's agents work on this
// one in a copy of their project, sent from there, instead of in a folder of the person's. One folder of Filament's own,
// `~/Filament copies` (FILAMENT_COPIES_DIR in its place), outside the data folder; in it a folder per sending machine,
// "From <its name>", kept by the app's device that minted its agents' one — what this Filament issued, which a second
// mint keeps; never by the id its claim states, which any machine states (`machineOf`) —; in that a folder per
// project, and in that one per copy. That machine's agents work in their own machine's folder without Full control
// (http/admin/remote.js `agentFolderRefusal`), and in no other machine's. Two repositories of one folder name have a
// project folder each (`storeName`, by the repository's root commit). Each copy is busy while a launch holds it and
// idle after, taken again by the next launch of its project — once its state is kept for the chat that worked in it
// (`keepState`: `KEPT_MAX` a machine, a week; the review of 11-11) —; idle a week, it goes. A machine keeps at most
// `MAX_COPIES` copies and `MAX_BYTES` here: the oldest idle ones go first, and a make with none idle is refused in words.
// The person clears a machine's copies from its card in Settings › Remote access; the chats that machine's agents worked
// in there go with them (`onCleared`). What a machine sends (cp-send: each project's mirror, its sends coming in) is kept
// apart, in `.mirrors` in the copies folder (`storeOf`), out of every machine's agents' reach: Filament's own git reads
// it. It counts in the machine's room, goes with its copies when cleared, and a project's goes once it has no copy and
// nothing came for a week. Kept in `<data folder>/copies.json`.
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { lstat, readdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { keptWords } from "../core/text.js";
import { cleanName } from "./machine.js";

/** The copies folder's name in the home folder. */
export const COPIES = "Filament copies";
/** How long a copy stays idle before it goes, and what is kept of one taken again or let go for room (`keepState`) after its chat last used it. */
export const IDLE_MS = 7 * 24 * 3600_000;
/** How long a launch holds a copy unless it lets go or holds it again. */
export const LEASE_MS = 6 * 3600_000;
/** How long a copy stays its chat's after a turn there ends, for a follow-up to find it as it was left. */
export const GRACE_MS = 30 * 60_000;
/** The most copies one machine keeps here. */
export const MAX_COPIES = 12;
/** The most states of copies taken again or let go for room (`keepState`) one machine has kept here. */
export const KEPT_MAX = 24;
/** The most one machine's copies take here, in bytes, as last measured. */
export const MAX_BYTES = 20 * 1024 ** 3;
/** The most entries a measure walks: past it, the size it found so far is the size. */
const MEASURE_MAX = 500_000;
/** The folder in the copies folder where what each machine sends is kept, a folder per machine in it. */
export const STORES = ".mirrors";
/** The most projects one machine keeps a store of here. */
export const STORES_MAX = 50;
/** How stale a store's last use may be on disk: each send asks for its store, and the list is written no oftener. */
const STORE_SAVE_MS = 10 * 60_000;

/**
 * The copies folder: FILAMENT_COPIES_DIR where set, else `~/Filament copies` — that too where FILAMENT_COPIES_DIR
 * names a drive's root, a home folder or what holds one, which a Clear would empty (the review of cp-root).
 * @param {NodeJS.ProcessEnv} [env] @param {string} [home]
 */
export const copiesRootOf = (env = process.env, home = homedir()) => {
  const own = resolve(join(home, COPIES));
  const set = String(env.FILAMENT_COPIES_DIR || "").trim();
  if (!set) return own;
  const r = resolve(set);
  const k = keyOf(r);
  const h = keyOf(home);
  const homes = dirname(h);
  return k === keyOf(parse(r).root) || within(h, k) || (homes !== parse(homes).root && dirname(k) === homes) ? own : r;
};

/**
 * A name as a folder's on every system: no separator, no character Windows refuses, no `~` (a short name's, which
 * the fence refuses: remote.js `aliasedPath`), no dot or space at its end, none of Windows' device names; "" where
 * nothing is left. @param {unknown} name
 */
export const folderName = (name) => {
  const n = String(name ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f<>:"/\\|?*~]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .replace(/[. ]+$/, "");
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(n) ? `${n}-` : n;
};

/**
 * A folder's path to compare by: resolved through the filesystem as far as it exists, in one case on Windows.
 * @param {string} p
 */
const keyOf = (p) => {
  let at = resolve(p);
  const rest = [];
  for (;;) {
    try {
      at = join(realpathSync.native(at), ...rest.reverse());
      break;
    } catch {
      const up = dirname(at);
      if (up === at) break;
      rest.push(at.slice(up.length).replace(/^[\\/]+/, ""));
      at = up;
    }
  }
  const r = at === parse(at).root ? at : at.replace(/[\\/]+$/, "");
  return process.platform === "win32" ? r.toLowerCase() : r;
};
/** A repository as a copy or a store keeps it: 40 hex digits (remote-agents.js `repoKeyOf`), nothing for anything else. @param {unknown} repo */
const repoOf = (repo) => (typeof repo === "string" && /^[0-9a-f]{40}$/.test(repo) ? { repo } : {});
/** Whether a value is a commit's name, 40 hex digits. @param {unknown} s */
const shaOf = (s) => typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
/** What stayed out of a capture, as a list kept: each its path and why, 200 at most. @param {unknown} left @returns {{ path: string, why: string }[]} */
const leftOf = (left) => (Array.isArray(left) ? left : []).slice(0, 200).map((l) => ({ path: String(l?.path ?? ""), why: String(l?.why ?? "") }));
/** Whether `inner` is `outer` or lies inside it (both keys). @param {string} inner @param {string} outer */
const within = (inner, outer) => inner === outer || inner.startsWith(outer.endsWith(sep) ? outer : outer + sep);
/** What hears copies let go compares a chat's folder with their `keys` by these. */
export { keyOf as folderKeyOf, within as inFolder };

/**
 * One copy: whose machine (`machine`, its key), which of its agents' devices took it last and every one that took it
 * (`by`: a second mint replaces the device, and the chats the first made there are its still), its project's name, its
 * folder, when it was made and last used, until when a launch holds it (0: idle), and its size as last measured.
 * @typedef {{ id: string, machine: string, device: string, by: string[], project: string, folder: string, madeAt: number, usedAt: number, busyUntil: number, bytes: number, chat: string, ran?: boolean, working?: boolean, turn?: boolean, repo?: string, sent?: string, owned?: true }} Copy
 *   `chat`: the chat a launch started in it (`bind`), whose turns hold it (`lease`); "" until one is; `ran`: a turn of
 *   that chat's has held it; `turn`: one runs in it now (`lease` to `grace`), and what it holds is half written;
 *   `project`: its store's name (`storeName`); `repo`: the repository it is a copy of, as its
 *   machine tells it apart (none on a copy made before one was sent); `sent`: the capture of it its machine last read
 *   whole or said it holds (`sent`); `owned`: placed for the person's own chat, which their machine's full device starts
 *   in it (POST /transfers/place `for: "person"`, `ownedAt`): while that chat is there — or, none started yet, while its
 *   placement holds it (`own`) — never taken again by a launch nor let go for room; it goes `idleMs` after its chat last
 *   used it, or with a Clear
 * @typedef {{ copy: string, chat: string, machine: string, project: string, repo?: string, name: string, base: string, commit: string, files: number, left: { path: string, why: string }[], at: number, read?: boolean }} Kept
 *   a copy's state as its chat left it, kept in its project's mirror before a newer launch took the copy or it went
 *   for room (the review of 11-11: what its sub-agent changed there, never brought back, went with the checkout):
 *   `name`, what it is kept under there ("": the copy was the commit it was checked out at, `base`, and nothing is
 *   kept but that); `commit`, the capture; `files` and `left`, what the capture counted and what stayed out of it;
 *   `at`, when its chat last used the copy, which `idleMs` count from; `read`: its machine read it whole, or holds it
 * @typedef {{ usedAt: number, bytes: number, repo?: string }} Store  a project's store of a machine's: when something last
 *   came for it, its size as last measured, and the repository it is of (none on one kept from before one was sent)
 * @typedef {{ folder: string, name: string, store?: string, stores?: Record<string, Store> }} MachineFolder
 *   `store`: the folder in `STORES` its projects' stores are kept in, `stores` each by its name there (`storeName`)
 * @typedef {{ machine: string, devices: string[], folders: string[], keys: string[], chats: string[], why: "cleared" | "idle" | "room" | "again" }} Cleared
 *   `keys`: each folder as the filesystem named it before it went (`folderKey`), for what compares a chat's folder by
 *   it; `chats`: the person's chats bound to owned copies among them, which go with them as their agents' chats do;
 *   `why` "again": folders a let-go left, told again and removed at a sweep
 * @typedef {{ folder: string, machine: string, devices: string[], chat?: string }} Leftover  `chat`: the person's chat an
 *   owned copy's folder was bound to, deleted with it (`Cleared` `chats`)
 * @typedef {ReturnType<typeof createCopies>} Copies
 */

/**
 * @param {{ dataDir?: string | null, root?: string, devices: { get: (id: string) => any, list: () => any[] }, now?: () => number,
 *   log?: (level: string, line: string) => void, maxCopies?: number, maxBytes?: number, idleMs?: number, removeFolder?: (folder: string) => Promise<void> }} o
 *   `devices`: this machine's paired devices (services/devices.js), which say whose machine an agents' device is;
 *   `removeFolder`: how a folder let go is removed (a test's in its place)
 */
export function createCopies({ dataDir = null, root = copiesRootOf(), devices, now = () => Date.now(), log = () => {}, maxCopies = MAX_COPIES, maxBytes = MAX_BYTES, idleMs = IDLE_MS, removeFolder = (f) => rm(f, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) }) {
  const file = dataDir ? join(dataDir, "copies.json") : null;
  /** @type {Record<string, MachineFolder>} */
  let machines = {};
  /** @type {Copy[]} */
  let copies = [];
  /** What is kept of copies taken again or let go for room (`keepState`). @type {Kept[]} */
  let keptStates = [];
  /**
   * Folders let go and not yet removed, each with whose machine and devices it was: kept from the let-go's start, so a
   * Filament stopped before its removal tells and removes them at its next sweep, as one a file held open (on Windows)
   * kept on disk. None is given to a new copy, and the fence lets no one in (`gone`). @type {Leftover[]}
   */
  let leftovers = [];
  /** The folders of the let-gos under way here, which a sweep leaves to them. @type {Set<string>} */
  const going = new Set();
  /** Why the list could not be read, other than its words (a file held open, a folder in its place); "" once read. */
  let unread = "";
  /**
   * The key of the machine whose agents' devices took a copy (`by`, each one this Filament issued): the app's device
   * that minted them; "" where none of them is a device here any more. @param {Copy} c
   */
  const ownerOf = (c) => {
    for (const id of [...c.by, c.device]) {
      const d = devices.get(id);
      if (d?.scope === "agent") return String(d.of || d.id);
    }
    return "";
  };
  /** The list read from its file: one that is no list is set aside, never written over; one that cannot be read is left as it is, and nothing is written over it until it reads. */
  const load = () => {
    if (!file) return;
    /** @type {any} */
    let j;
    try {
      j = JSON.parse(readFileSync(file, "utf8"));
      unread = "";
    } catch (/** @type {any} */ e) {
      if (e?.code === "ENOENT") return void (unread = "");
      if (!(e instanceof SyntaxError)) {
        unread = String(e?.code || e?.message || e);
        return log("warn", `[copies] could not read ${file} (${e?.message || e}): no copy is made, and nothing written over it, until it reads`);
      }
      // Its words are no list: set aside for a person to look at, the folders it named left on disk, and the names of
      // the machines' folders it held not given again (`machineFolder` skips a name on disk).
      const aside = `${file}.unreadable-${now()}`;
      try {
        renameSync(file, aside);
      } catch (/** @type {any} */ r) {
        unread = String(r?.code || r?.message || r);
        return log("warn", `[copies] ${file} is no list, and could not be set aside (${r?.message || r}): no copy is made until it is`);
      }
      return log("warn", `[copies] could not read ${file} (${e.message}), set aside as ${aside}: the copies it named stay on disk in ${root}`);
    }
    // What lies outside the copies folder now (FILAMENT_COPIES_DIR changed) is no machine's here: left on disk, said.
    const inRoot = (/** @type {unknown} */ f) => typeof f === "string" && !!f && keyOf(f) !== keyOf(root) && within(keyOf(f), keyOf(root));
    const out = (/** @type {string} */ f) => log("warn", `[copies] ${f} is not in ${root}: left on disk`);
    machines = {};
    for (const [k, v] of Object.entries(j?.machines && typeof j.machines === "object" ? j.machines : {}))
      if (inRoot(v?.folder)) {
        /** @type {Record<string, Store>} */
        const stores = {};
        for (const [p, s] of Object.entries(v.stores && typeof v.stores === "object" ? v.stores : {})) if (folderName(p) === p) stores[p] = { usedAt: Number(/** @type {any} */ (s)?.usedAt) || 0, bytes: Number(/** @type {any} */ (s)?.bytes) || 0, ...repoOf(/** @type {any} */ (s)?.repo) };
        machines[k] = { folder: v.folder, name: String(v.name || ""), ...(inRoot(v.store) ? { store: v.store, stores } : {}) };
      } else if (typeof v?.folder === "string") out(v.folder);
    // Held for work a restart ended — a turn, a launch's checkout —: its chat's for the while after a turn alone, as the
    // turn's end would have left it; a question's hold still waits (the swarm's review of 11-10).
    const held = (/** @type {any} */ c) => (c.working === true ? Math.min(Number(c.busyUntil) || 0, now() + GRACE_MS) : Number(c.busyUntil) || 0);
    copies = (Array.isArray(j?.copies) ? j.copies : [])
      .filter((/** @type {any} */ c) => c && typeof c.id === "string" && typeof c.folder === "string" && typeof c.machine === "string" && (inRoot(c.folder) || void out(c.folder)))
      .map((/** @type {any} */ c) => ({ id: c.id, machine: c.machine, device: String(c.device || ""), by: (Array.isArray(c.by) ? c.by : [c.device]).map(String).filter(Boolean), project: String(c.project || ""), folder: c.folder, madeAt: Number(c.madeAt) || 0, usedAt: Number(c.usedAt) || 0, busyUntil: held(c), bytes: Number(c.bytes) || 0, chat: String(c.chat || ""), ran: c.ran === true, working: false, turn: false, ...repoOf(c.repo), ...(shaOf(c.sent) ? { sent: c.sent } : {}), ...(c.owned === true ? { owned: /** @type {true} */ (true) } : {}) }));
    keptStates = (Array.isArray(j?.kept) ? j.kept : [])
      .filter((/** @type {any} */ k) => k && typeof k.copy === "string" && typeof k.chat === "string" && typeof k.machine === "string" && machines[k.machine] && shaOf(k.base) && shaOf(k.commit))
      .map((/** @type {any} */ k) => ({ copy: k.copy, chat: k.chat, machine: k.machine, project: String(k.project || ""), ...repoOf(k.repo), name: String(k.name || ""), base: k.base, commit: k.commit, files: Number(k.files) || 0, left: leftOf(k.left), at: Number(k.at) || 0, ...(k.read === true ? { read: true } : {}) }));
    leftovers = (Array.isArray(j?.leftovers) ? j.leftovers : [])
      .filter((/** @type {any} */ l) => inRoot(l?.folder) || void (typeof l?.folder === "string" && out(l.folder)))
      .map((/** @type {any} */ l) => ({ folder: l.folder, machine: String(l.machine || ""), devices: (Array.isArray(l.devices) ? l.devices : []).map(String).filter(Boolean), ...(typeof l.chat === "string" && l.chat ? { chat: l.chat } : {}) }));
    // A list kept before copies were by the device this Filament issued names each machine by the id its claim stated
    // (the security re-read of 11-11). Its folder and copies are found again by the devices that took them: they go to
    // the app's device that minted those, where the copies under that id are one machine's — kept so at the next
    // write. What no device here took, or two machines' devices did, stays under the stated id, which opens it to no
    // device: it goes when idle, as any copy.
    for (const k of Object.keys(machines)) {
      if (devices.get(k)) continue;
      const under = copies.filter((c) => c.machine === k);
      const owners = new Set(under.map(ownerOf));
      const [to] = owners;
      if (owners.size !== 1 || !to || machines[to]) continue;
      machines[to] = machines[k];
      delete machines[k];
      for (const x of [...under, ...leftovers.filter((l) => l.machine === k)]) x.machine = to;
    }
  };
  load();
  const save = () => {
    if (!file) return;
    if (unread) return log("warn", `[copies] the copies' list was not kept: ${file} could not be read (${unread}), and is not written over`);
    try {
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, machines, copies, kept: keptStates, leftovers }, null, 1), { mode: 0o600 });
      renameSync(tmp, file);
    } catch (/** @type {any} */ e) {
      log("warn", `[copies] could not keep the copies' list: ${e?.message || e}`);
    }
  };
  /** @type {Set<(c: Cleared) => unknown>} */
  const clearHeard = new Set();
  /** Why no copy is made in this copies folder, in words; "" where one is: never in or around the data folder, which the fence keeps them out of. */
  const rootRefusal = (() => {
    if (!dataDir) return "";
    const [r, d] = [keyOf(root), keyOf(dataDir)];
    return within(r, d) || within(d, r) ? `the copies folder ${root} is ${within(r, d) ? "in" : "around"} Filament's data folder, where another machine's agents never work: FILAMENT_COPIES_DIR names another` : "";
  })();
  if (rootRefusal) log("warn", `[copies] ${rootRefusal}`);

  /**
   * The machine an agents' device is of: its key — the id of the app's device that minted it, which this Filament
   * issued and a second mint keeps, else its own —, the id that device's claim stated (`stated`: for a folder's name
   * alone; a machine states it as it likes, and nothing is kept or opened by it — the security re-read of 11-11: two
   * machines that stated one id shared their copies), and its name; null for any other device. @param {string} deviceId
   */
  const machineOf = (deviceId) => {
    const d = devices.get(String(deviceId || ""));
    if (!d || d.scope !== "agent") return null;
    const full = d.of ? devices.get(d.of) : null;
    return { key: String(d.of || d.id), stated: String(full?.machine || ""), name: cleanName(d.from) || cleanName(full?.name) || "another machine" };
  };
  /** Every agents' device of a machine, revoked ones too. @param {string} key */
  const devicesOf = (key) => devices.list().filter((d) => d.scope === "agent" && machineOf(d.id)?.key === key).map((d) => String(d.id));

  /**
   * A machine's folder: kept from the first time, else named now "From <name>", the start of the id it states (else of
   * its key) beside a name another machine's folder has. @param {{ key: string, name: string, stated?: string }} m
   */
  const machineFolder = (m) => {
    const kept = machines[m.key];
    if (kept) return kept.folder;
    const base = `From ${folderName(m.name) || "another machine"}`;
    const taken = new Set([...Object.values(machines).flatMap((x) => [x.folder, x.store || ""]), ...leftovers.map((l) => l.folder)].filter(Boolean).map(keyOf));
    // Never a name another machine's folder or store has, one a let-go removes, nor one on disk: what a Clear could not
    // remove, or a list set aside, is no machine's to open.
    const free = (/** @type {string} */ f) => [f, storeAt(f)].every((x) => !taken.has(keyOf(x)) && !existsSync(x));
    const folder = [base, `${base} (${folderName(m.stated || m.key).slice(0, 8)})`, `${base} (${randomUUID().slice(0, 8)})`].map((n) => join(root, n)).find(free) || join(root, `${base} (${randomUUID()})`);
    machines[m.key] = { folder, name: m.name, store: storeAt(folder), stores: {} };
    save();
    return folder;
  };
  /** The store a machine's folder goes with: its name, in `STORES`. @param {string} folder */
  const storeAt = (folder) => join(root, STORES, basename(folder));
  /** A machine's store folder, kept with its record (one kept from before has none yet). @param {{ key: string, name: string }} m */
  const storeFolder = (m) => {
    const kept = machines[m.key] ?? (machineFolder(m), machines[m.key]);
    if (!kept.store) {
      kept.store = storeAt(kept.folder);
      kept.stores = {};
      save();
    }
    return kept.store;
  };
  /** What a machine's stores take, as last measured. @param {string} key */
  const storeBytes = (key) => Object.values(machines[key]?.stores ?? {}).reduce((n, s) => n + s.bytes, 0);
  /**
   * The name a project's store, and its copies' folder, go by in a machine's folders. Two repositories of one folder
   * name are two projects (the review of 11-11: they shared a mirror, and one's idle copy was the other's next), so a
   * store is found by its repository (`repo`: what its machine tells it by, remote-agents.js `repoKeyOf`), and the
   * folder's name is only what a person reads here: the store kept for that repository, whatever name it came under
   * first; else the folder's name, where no other repository has it — a store kept from before repositories were sent
   * is the first of its name to send's —; else that name with the repository's first digits. With no `repo` (a machine
   * whose Filament sends none yet), the folder's name, as it was. Names are compared in one case: one folder on a
   * disk that keeps none.
   * @param {string} key  the machine's @param {string} project @param {string} repo
   */
  const storeName = (key, project, repo) => {
    const base = folderName(project) || "project";
    if (!repo) return base;
    const stores = machines[key]?.stores ?? {};
    const names = Object.keys(stores);
    const kept = names.find((n) => stores[n].repo === repo);
    if (kept) return kept;
    const tries = [base, ...[8, 16, 40].map((d) => folderName(`${base.slice(0, 57 - d)} (${repo.slice(0, d)})`))];
    for (const t of tries) {
      const n = names.find((x) => x.toLowerCase() === t.toLowerCase()) ?? t;
      if (!stores[n]?.repo && !copies.some((c) => c.machine === key && c.repo && c.repo !== repo && c.project.toLowerCase() === n.toLowerCase())) return n;
    }
    return tries[tries.length - 1];
  };

  /** Whether the chat a copy is bound to still has work going in it, past its turns (`setWorking`). @type {((chat: string) => boolean) | null} */
  let working = null;
  /** Whether a chat is still there, not deleted (`setChatThere`). @type {((chat: string) => boolean) | null} */
  let chatThere = null;
  /** Whether a copy's chat was deleted: what is not known is there. @param {Copy} c */
  const chatGone = (c) => {
    try {
      return !!c.chat && !!chatThere && !chatThere(c.chat);
    } catch {
      return false;
    }
  };
  /**
   * Whether a copy is the person's own chat's now (`owned`): its chat still there, or none started in it yet while its
   * placement holds it. One whose chat never came, or was deleted, is taken again and let go for room as any idle copy
   * (the review of s2a: it held its place for a week). @param {Copy} c
   */
  const own = (c) => !!c.owned && (c.chat ? !chatGone(c) : c.busyUntil > now());
  /** Whether a command another machine's agents run here still runs in a folder (`holdWhile`): exec.js's. @type {((folder: string) => boolean)[]} */
  const runsIn = [];
  /** Whether a copy is held by a launch now, or its chat's work still runs there: a sub-agent, a background command. @param {Copy} c */
  const busy = (c) => {
    if (c.busyUntil > now()) return true;
    try {
      if (runsIn.some((f) => f(c.folder))) return true;
      return !!c.chat && !!working && working(c.chat);
    } catch {
      return false;
    }
  };
  /** A machine's copies, oldest used first. @param {string} key */
  const copiesOf = (key) => copies.filter((c) => c.machine === key).sort((a, b) => a.usedAt - b.usedAt);

  /** The let-gos under way: what makes room for a make goes on after it. @type {Set<Promise<string[]>>} */
  const underWay = new Set();

  /**
   * Leftovers removed: first what works in them told and waited for (`onCleared`: the chats there stopped and deleted,
   * the commands there stopped), each folder compared as the filesystem names it while it is still there (`keys`); then
   * each removed from the disk where it lies in the copies folder as the filesystem resolves it (never the folder
   * itself, nor one a link takes out of it), without holding the server. One that fails stays a leftover, for the next
   * sweep. → the folders that stay on disk.
   * @param {Leftover[]} gone  one machine's @param {Cleared["why"]} why
   * @returns {Promise<string[]>}
   */
  const settle = (gone, why) => {
    if (!gone.length) return Promise.resolve(/** @type {string[]} */ ([]));
    const folders = gone.map((l) => l.folder);
    for (const f of folders) going.add(f);
    const cleared = { machine: gone[0]?.machine || "", devices: [...new Set(gone.flatMap((l) => l.devices))], folders, keys: folders.map(keyOf), chats: [...new Set(gone.flatMap((l) => (l.chat ? [l.chat] : [])))], why };
    const run = Promise.allSettled([...clearHeard].map(async (fn) => fn(cleared))).then(async (told) => {
      for (const t of told) if (t.status === "rejected") log("warn", `[copies] what works in ${folders.length} cleared folders was not all stopped: ${String(t.reason?.message || t.reason).slice(0, 160)}`);
      const rootKey = keyOf(root);
      /** @type {string[]} */
      const failed = [];
      /** @type {Set<string>} */
      const done = new Set();
      for (const f of folders) {
        const k = keyOf(f);
        if (k === rootKey || !within(k, rootKey)) {
          log("warn", `[copies] ${f} is not in ${root}: left on disk`);
          done.add(f);
          continue;
        }
        try {
          await removeFolder(f);
          done.add(f);
        } catch (/** @type {any} */ e) {
          failed.push(f);
          log("warn", `[copies] ${f} could not be removed yet (${e?.message || e}): it is tried again within the hour`);
        }
      }
      leftovers = leftovers.filter((l) => !done.has(l.folder));
      save();
      return failed;
    });
    const tracked = run.finally(() => {
      underWay.delete(tracked);
      for (const f of folders) going.delete(f);
    });
    underWay.add(tracked);
    return tracked;
  };

  /**
   * Copies let go: dropped from the list and kept as leftovers in one write, so no launch takes one and a stop before
   * their folders go leaves them named; then settled (`settle`). → the folders that stay on disk.
   * @param {string} key @param {Copy[]} gone @param {Cleared["why"]} why @param {string[]} [more]  other folders of the machine's, its mirrors
   * @returns {Promise<string[]>}
   */
  const letGo = (key, gone, why, more = []) => {
    const folders = [...gone.map((c) => c.folder), ...more];
    const ids = new Set(gone.map((c) => c.id));
    const told = [...new Set([...devicesOf(key), ...gone.flatMap((c) => c.by)])];
    // The person's chat bound to an owned copy goes with it, as their agents' chats go with theirs.
    const chatOf = new Map(gone.filter((c) => c.owned && c.chat).map((c) => [c.folder, c.chat]));
    copies = copies.filter((c) => !ids.has(c.id));
    const fresh = folders.map((folder) => ({ folder, machine: key, devices: told, ...(chatOf.has(folder) ? { chat: /** @type {string} */ (chatOf.get(folder)) } : {}) }));
    leftovers = [...leftovers.filter((l) => !folders.includes(l.folder)), ...fresh];
    save();
    return settle(fresh, why);
  };

  /**
   * The idle copies of a machine's that would go for one more copy of its (`copy`), or for `more` bytes of what it
   * sends, oldest first, while it would hold `maxCopies`, or more than `maxBytes` as measured with its stores — only
   * those named in `spare` where one is given: an idle copy may hold what its sub-agent changed, never brought back,
   * and goes only once that is kept (`keepState`). → them, what would stay, how many idle ones were passed over, and how
   * many of the machine's copies are the person's own chats' (`owned`), which never go for room.
   * `not`: idle ones passed over as a busy one is.
   * @param {{ key: string, name: string }} m @param {{ copy?: boolean, more?: number, spare?: ReadonlySet<string> | null, not?: readonly string[] }} [o]
   */
  const roomOf = (m, { copy = true, more = 0, spare = null, not = [] } = {}) => {
    const mine = copiesOf(m.key);
    /** @type {Copy[]} */
    const gone = [];
    let count = mine.length;
    let size = mine.reduce((n, c) => n + c.bytes, 0) + storeBytes(m.key) + more;
    let held = 0;
    const owns = mine.filter(own).length;
    for (const c of mine) {
      if ((!copy || count < maxCopies) && size <= maxBytes) break;
      if (busy(c) || own(c) || not.includes(c.id)) continue;
      if (spare && !spare.has(c.id)) {
        held++;
        continue;
      }
      gone.push(c);
      count--;
      size -= c.bytes;
    }
    return { gone, count, size, held, owns };
  };
  /**
   * Room for one more copy of a machine's (`copy`), or for `more` bytes of what it sends: its oldest idle copies go
   * (`roomOf`); where letting every one that may go would not make it, none goes, and why, in words.
   * @param {{ key: string, name: string }} m @param {{ copy?: boolean, more?: number, spare?: ReadonlySet<string> | null }} [o] @returns {string}
   */
  const room = (m, { copy = true, more = 0, spare = null } = {}) => {
    const { gone, count, size, held, owns } = roomOf(m, { copy, more, spare });
    const aside = held ? `, ${held} of them idle with a change that could not be kept aside` : "";
    // Copies of your own chats among them (Run on): said as yours, never as their agents' in use.
    const yours = owns ? `, ${owns} of them your own chats'` : "";
    if (copy && count >= maxCopies)
      return owns
        ? `${m.name} has ${count} copies on this machine${yours}${aside}, the most it keeps: no more is made until one goes, or they are cleared in Settings › Remote access`
        : `${m.name}'s agents have ${count} copies${held ? "" : " in use"} on this machine, the most it keeps for them${aside}: no more is made until one is let go`;
    if (size > maxBytes) return `${m.name}'s copies${held || owns ? "" : " in use"}${more ? " and this send" : ""} take ${gib(size)} on this machine, past the ${gib(maxBytes)} kept for them${yours}${aside}: clear them in Settings › Remote access`;
    if (gone.length) void letGo(m.key, gone, "room");
    return "";
  };
  /**
   * A machine's idle copies of a project a launch may take again, the one idle longest first: never one the person's own
   * chat is in (`owned`). @param {{ key: string }} m @param {string} name  its store's @param {string} repo
   */
  const idleOf = (m, name, repo) => copiesOf(m.key).filter((c) => !own(c) && (repo ? c.repo === repo : c.project === name && !c.repo) && !busy(c));

  /** A copy's new folder in its project's folder: the next number not there. @param {string} projectFolder */
  const nextFolder = (projectFolder) => {
    /** @type {Set<string>} */
    let there = new Set();
    try {
      there = new Set(readdirSync(projectFolder));
    } catch {}
    // …nor one a let-go is about to remove, though its folder is gone already.
    for (const c of [...copies, ...leftovers]) if (dirname(c.folder) === projectFolder) there.add(c.folder.slice(projectFolder.length + 1));
    let n = 1;
    while (there.has(String(n))) n++;
    return join(projectFolder, String(n));
  };

  return {
    /** The copies folder. */
    root,
    /** How long a change that stayed in a copy here is kept after its chat last used it: in the copy while it is idle, then as what was kept of it (`keepState`). */
    keeps: idleMs,
    /**
     * The folder an agents' device's machine's copies are in, once one was made for it; "" before, and for any other
     * device: its fence opens no folder it was not given (two machines of one name). @param {string} deviceId
     */
    folderOf(deviceId) {
      const m = machineOf(deviceId);
      return (m && machines[m.key]?.folder) || "";
    },
    /**
     * Where a project of a machine's is kept as that machine sent it (cp-send: its mirror, its sends coming in): in
     * `STORES`, outside the machine's own folder that its agents work in, so none of them writes what Filament's git
     * reads there. `make`: made, and kept another week; else only named. One a let-go removes is refused until it is
     * gone (`busy`); a machine keeps `STORES_MAX` at most. `repo`: the repository it is of, which it is found by
     * (`storeName`) and kept with. → the folder, or why not, in words.
     * @param {string} deviceId @param {string} project @param {{ make?: boolean, repo?: string }} [o]
     * @returns {{ ok: true, folder: string } | { ok: false, why: string, busy?: true }}
     */
    storeOf(deviceId, project, { make = true, repo = "" } = {}) {
      const m = machineOf(deviceId);
      if (!m) return { ok: false, why: "copies are kept for another machine's agents alone" };
      if (rootRefusal) return { ok: false, why: rootRefusal };
      if (unread) return { ok: false, why: `the copies' list could not be read (${unread}): nothing is kept until it reads` };
      const stores = storeFolder(m);
      const name = storeName(m.key, project, repo);
      const folder = join(stores, name);
      const k = keyOf(folder);
      if (leftovers.some((l) => within(k, keyOf(l.folder)))) return { ok: false, busy: true, why: `what ${m.name} sent of ${name} is being removed here: send again in a moment` };
      if (!make) return { ok: true, folder };
      const kept = machines[m.key];
      const had = kept.stores?.[name];
      if (!had && Object.keys(kept.stores ?? {}).length >= STORES_MAX) return { ok: false, why: `${m.name} sends ${STORES_MAX} projects here, the most this machine keeps: clear its copies in Settings › Remote access` };
      try {
        mkdirSync(folder, { recursive: true });
      } catch (/** @type {any} */ e) {
        return { ok: false, why: `${folder} could not be made: ${e?.message || e}` };
      }
      // Kept on disk when new, else once in a while: each send asks here. One kept from before repositories were sent
      // is this repository's from now on.
      if (!had || now() - had.usedAt > STORE_SAVE_MS || (repo && !had.repo)) {
        kept.stores = { ...kept.stores, [name]: { usedAt: now(), bytes: had?.bytes ?? 0, ...repoOf(had?.repo || repo) } };
        save();
      }
      return { ok: true, folder };
    },
    /** A project's store measured on its disk, after what came in. @param {string} deviceId @param {string} project @param {string} [repo] @returns {Promise<number>} */
    async measureStore(deviceId, project, repo = "") {
      const m = machineOf(deviceId);
      const name = m ? storeName(m.key, project, repo) : "";
      const kept = m ? machines[m.key] : null;
      if (!kept?.store || !kept.stores?.[name]) return 0;
      const bytes = await sizeOf(join(kept.store, name));
      const s = machines[/** @type {{ key: string }} */ (m).key]?.stores?.[name];
      if (s) {
        s.bytes = bytes;
        save();
      }
      return bytes;
    },
    /**
     * Room for `bytes` more of what a device's machine sends here, made by letting its oldest idle copies go: "" where
     * there is, else why not, in words. `spare`: the idle copies that may go (`needs`, their state kept); any, where
     * none is given. @param {string} deviceId @param {number} bytes @param {{ spare?: ReadonlySet<string> | null }} [o]
     */
    roomFor(deviceId, bytes, { spare = null } = {}) {
      const m = machineOf(deviceId);
      return m ? room(m, { copy: false, more: Math.max(0, bytes), spare }) : "copies are kept for another machine's agents alone";
    },
    /**
     * The idle copies of a device's machine that would go for one more copy (`copy`) or `more` bytes, asked before
     * any goes: what each holds is kept first (services/transfers.js `keepFirst`), and those kept are named as `spare`
     * to what makes the room. `not`: the ones whose state could not be kept, in whose place the next oldest is named.
     * @param {string} deviceId @param {{ copy?: boolean, more?: number, not?: readonly string[] }} [o] @returns {Copy[]}
     */
    needs(deviceId, { copy = true, more = 0, not = [] } = {}) {
      const m = machineOf(deviceId);
      return m && !unread && !rootRefusal ? roomOf(m, { copy, more: Math.max(0, more), not }).gone.map((c) => ({ ...c })) : [];
    },
    /**
     * The idle copy a launch of a project would take again (`take`), the one idle longest, none taken yet: its state is
     * kept first. `not`: the ones passed over. @param {string} deviceId @param {string} project @param {{ repo?: string, not?: readonly string[] }} [o]
     * @returns {Copy | null}
     */
    idle(deviceId, project, { repo = "", not = [] } = {}) {
      const m = machineOf(deviceId);
      if (!m || unread || rootRefusal) return null;
      const c = idleOf(m, storeName(m.key, project, repo), repo).find((x) => !not.includes(x.id));
      return c ? { ...c } : null;
    },
    /**
     * A copy of a project held for a launch: an idle one of that project's taken again, else one made — room made by
     * letting the machine's oldest idle copies go. `repo`: the repository it is a copy of — an idle one is taken again
     * for its own repository alone, one made before repositories were sent for a launch that sends none. → the copy,
     * its folder made; or why not, in words. `again`: that idle copy and no other (its state kept first, `idle`),
     * refused where it is idle no more; `spare`: the idle copies that may go for room (`needs`), any where none is given.
     * `owned`: the copy is the person's own chat's from then on (`Copy` `owned`), an idle one taken again with it.
     * @param {string} deviceId @param {string} project @param {{ leaseMs?: number, fresh?: boolean, repo?: string, again?: string, spare?: ReadonlySet<string> | null, owned?: boolean }} [o]  `fresh`: never an idle one
     * @returns {{ ok: true, copy: Copy, reused: boolean } | { ok: false, why: string }}
     */
    take(deviceId, project, { leaseMs = LEASE_MS, fresh = false, repo = "", again = "", spare = null, owned = false } = {}) {
      const m = machineOf(deviceId);
      if (!m) return { ok: false, why: "copies are kept for another machine's agents alone" };
      if (rootRefusal) return { ok: false, why: rootRefusal };
      if (unread) return { ok: false, why: `the copies' list could not be read (${unread}): no copy is made until it reads` };
      const name = storeName(m.key, project, repo);
      // The one idle longest: a chat that let its copy go a while ago is the least likely to come back to it.
      const idle = fresh ? null : idleOf(m, name, repo).find((c) => !again || c.id === again);
      if (again && !idle) return { ok: false, why: "that copy is in use again" };
      if (idle) {
        idle.busyUntil = now() + leaseMs;
        idle.working = true;
        idle.usedAt = now();
        idle.chat = "";
        idle.ran = false;
        idle.turn = false;
        delete idle.sent;
        if (owned) idle.owned = true;
        else delete idle.owned;
        idle.device = String(deviceId);
        if (!idle.by.includes(idle.device)) idle.by = [...idle.by, idle.device].slice(-8);
        save();
        return { ok: true, copy: { ...idle }, reused: true };
      }
      const no = room(m, { spare });
      if (no) return { ok: false, why: no };
      const projectFolder = join(machineFolder(m), name);
      const folder = nextFolder(projectFolder);
      try {
        mkdirSync(folder, { recursive: true });
      } catch (/** @type {any} */ e) {
        return { ok: false, why: `${folder} could not be made: ${e?.message || e}` };
      }
      /** @type {Copy} */
      const c = { id: randomUUID(), machine: m.key, device: String(deviceId), by: [String(deviceId)], project: name, folder, madeAt: now(), usedAt: now(), busyUntil: now() + leaseMs, bytes: 0, chat: "", ran: false, working: true, ...repoOf(repo), ...(owned ? { owned: /** @type {true} */ (true) } : {}) };
      copies.push(c);
      save();
      return { ok: true, copy: { ...c }, reused: false };
    },
    /** A copy held a while longer. @param {string} id @param {number} [leaseMs] */
    hold(id, leaseMs = LEASE_MS) {
      const c = copies.find((x) => x.id === id);
      if (!c) return false;
      c.busyUntil = now() + leaseMs;
      c.working = true;
      c.usedAt = now();
      save();
      return true;
    },
    /**
     * The chat a launch started in a copy, kept on it: its turns hold it (`lease`). Only the first that runs a turn
     * there: a copy taken for one launch is that launch's chat's, and a chat of it that never ran one gives way to the
     * next (the launch's machine never heard the answer that named it, and starts another), and so does one deleted
     * (`setChatThere`). → whether it is that chat's now. @param {string} id @param {string} chat
     */
    bind(id, chat) {
      const c = copies.find((x) => x.id === id);
      if (!c || !chat) return false;
      const gone = c.chat !== String(chat) && chatGone(c);
      if (!c.chat || (!c.ran && c.chat !== String(chat)) || gone) {
        c.chat = String(chat);
        if (gone) c.ran = false;
        save();
      }
      return c.chat === String(chat);
    },
    /**
     * A turn of `chat` starts in its copy: held for `LEASE_MS`. Refused in words where the copy is gone, or was taken by
     * another launch once its chat let it go (`grace`); "" where it holds.
     * @param {string} id @param {string} chat @returns {string}
     */
    lease(id, chat) {
      const c = copies.find((x) => x.id === id);
      if (!c) return "its copy here was cleared, or left idle until it went: a new launch takes a fresh one";
      if (c.chat !== String(chat))
        return c.owned ? "its copy here went to another chat started there: Run on sends a fresh copy" : "its copy here went to a newer launch of its project once this chat let it go: a new launch takes a fresh one";
      c.busyUntil = now() + LEASE_MS;
      c.working = true;
      c.usedAt = now();
      c.ran = true;
      c.turn = true;
      save();
      return "";
    },
    /**
     * A turn in a copy ended: it stays its chat's for `GRACE_MS`, for a follow-up, then is idle; a turn that paused on a
     * question keeps it until that question lapses (`until`; Infinity: no lapse said, a lease's while), and a while after.
     * @param {string} id @param {number} [until]
     */
    grace(id, until = 0) {
      const c = copies.find((x) => x.id === id);
      if (!c) return false;
      const waits = until === Infinity ? now() + LEASE_MS : until > 0 ? until + GRACE_MS : 0;
      c.busyUntil = Math.max(now() + GRACE_MS, waits);
      c.working = false;
      c.turn = false;
      c.usedAt = now();
      save();
      return true;
    },
    /**
     * A copy kept its chat's at least `ms` more, never held less than it was: its change asked for, whose bring back is
     * tried again for about the while after a turn (the swarm's review of 11-10). @param {string} id @param {number} [ms]
     */
    keep(id, ms = GRACE_MS) {
      const c = copies.find((x) => x.id === id);
      if (!c) return false;
      c.busyUntil = Math.max(c.busyUntil, now() + ms);
      c.usedAt = now();
      save();
      return true;
    },
    /**
     * A copy let go: idle, for the next launch of its project. `disown`: one placed for the person's chat whose checkout
     * failed is no one's own any more, and goes as an idle copy does. @param {string} id @param {{ disown?: boolean }} [o]
     */
    release(id, { disown = false } = {}) {
      const c = copies.find((x) => x.id === id);
      if (!c) return false;
      c.busyUntil = 0;
      c.working = false;
      c.turn = false;
      c.usedAt = now();
      if (disown) delete c.owned;
      save();
      return true;
    },
    /** A copy by its id. @param {string} id @returns {Copy | null} */
    get: (id) => {
      const c = copies.find((x) => x.id === id);
      return c ? { ...c } : null;
    },
    /**
     * What the project of a chat in a copy is called here: the project it is a copy of, and the machine it came from
     * ("widgets (from Laptop)"), never its copy's number folder. @param {Copy} c
     */
    projectName(c) {
      return `${c.project} (from ${machineOf(c.device)?.name || machines[c.machine]?.name || "another machine"})`;
    },
    /** The copy a folder is or lies in, of that device's machine alone. @param {string} deviceId @param {string} folder @returns {Copy | null} */
    copyAt(deviceId, folder) {
      const m = machineOf(deviceId);
      if (!m || !folder) return null;
      const k = keyOf(folder);
      const c = copies.find((x) => x.machine === m.key && within(k, keyOf(x.folder)));
      return c ? { ...c } : null;
    },
    /**
     * The copy placed for the person's own chat (`owned`) that a folder is or lies in, for the full device that machine's
     * agents' devices were minted by — the copies' machine key (`machineOf`) — alone: the app on that machine starts its
     * chat there as the person. Null for any other device, and for a copy no one owns.
     * @param {string} deviceId  a full device's @param {string} folder @returns {Copy | null}
     */
    ownedAt(deviceId, folder) {
      const d = devices.get(String(deviceId || ""));
      if (!d || d.scope !== "full" || d.revokedAt != null || !folder) return null;
      const k = keyOf(folder);
      const c = copies.find((x) => x.owned && x.machine === String(d.id) && within(k, keyOf(x.folder)));
      return c ? { ...c } : null;
    },
    /**
     * A copy's state as its chat left it is kept in its project's mirror (services/transfers.js `keepFirst`), before a
     * newer launch takes the copy or it goes for room: said here, so its chat's ask for what it changed is answered from
     * it once the copy is another's or gone (`keptOf`), for `idleMs` after that chat last used the copy. A machine has
     * `KEPT_MAX` kept: past it the oldest its machine read back goes, and with none read back this one is refused, in
     * words — nothing never read gives way to a newer one. A copy no chat was started in keeps nothing.
     * @param {string} id @param {{ name: string, base: string, commit: string, files?: number, left?: { path: string, why: string }[] }} k
     * @returns {string}  "" once said, else why not
     */
    keepState(id, k) {
      const c = copies.find((x) => x.id === id);
      if (!c || !c.chat) return "";
      if (!shaOf(k?.base) || !shaOf(k?.commit)) return "a copy's state is kept by its commits, 40 hex digits each";
      const others = keptStates.filter((x) => !(x.copy === c.id && x.chat === c.chat));
      const theirs = others.filter((x) => x.machine === c.machine).sort((a, b) => a.at - b.at);
      /** @type {Kept | undefined} */
      let out;
      if (theirs.length >= KEPT_MAX) {
        out = theirs.find((x) => x.read);
        if (!out) return `${machines[c.machine]?.name || "that machine"}'s agents left ${theirs.length} changes in copies on this machine that were never read back, the most it keeps of them: each goes ${keptWords(idleMs)} after its chat last worked there`;
      }
      keptStates = [...others.filter((x) => x !== out), { copy: c.id, chat: c.chat, machine: c.machine, project: c.project, ...repoOf(c.repo), name: String(k.name || ""), base: k.base, commit: k.commit, files: Number(k.files) || 0, left: leftOf(k.left), at: c.usedAt, ...(c.sent === k.commit || !k.name ? { read: true } : {}) }];
      save();
      return "";
    },
    /**
     * What is kept of a copy as `chat` left it (`keepState`), for the device's machine alone; null where nothing is, or
     * it went `idleMs` after that chat last used the copy. @param {string} deviceId @param {string} copy @param {string} chat
     * @returns {Kept | null}
     */
    keptOf(deviceId, copy, chat) {
      const m = machineOf(deviceId);
      const k = m && chat ? keptStates.find((x) => x.machine === m.key && x.copy === copy && x.chat === String(chat)) : null;
      return k && now() - k.at <= idleMs ? { ...k, left: k.left.map((l) => ({ ...l })) } : null;
    },
    /** What is kept of a copy as `chat` left it was read whole by its machine, or is held there: the first to give way at `KEPT_MAX`. @param {string} deviceId @param {string} copy @param {string} chat */
    keptRead(deviceId, copy, chat) {
      const m = machineOf(deviceId);
      const k = m ? keptStates.find((x) => x.machine === m.key && x.copy === copy && x.chat === String(chat)) : null;
      if (!k || k.read) return;
      k.read = true;
      save();
    },
    /** What a project's mirror keeps of copies for a device's machine, by name (`keepState`): every other kept there may go. @param {string} deviceId @param {string} project  its store's name, a copy's `project` @returns {string[]} */
    keptNames(deviceId, project) {
      const m = machineOf(deviceId);
      return m ? keptStates.filter((x) => x.machine === m.key && x.project === project && x.name).map((x) => x.name) : [];
    },
    /** The capture of a copy its machine read whole, or said it holds: kept of it later (`keepState`), it is one read back. @param {string} id @param {string} commit */
    sent(id, commit) {
      const c = copies.find((x) => x.id === id);
      if (!c || !shaOf(commit) || c.sent === commit) return;
      c.sent = commit;
      save();
    },
    /** A copy's size measured on its disk, links not followed. @param {string} id @returns {Promise<number>} */
    async measure(id) {
      const c = copies.find((x) => x.id === id);
      if (!c) return 0;
      const bytes = await sizeOf(c.folder);
      const now_ = copies.find((x) => x.id === id);
      if (now_) {
        now_.bytes = bytes;
        save();
      }
      return bytes;
    },
    /**
     * What a device's machine keeps here: how many copies, their size as measured with what it sent (its stores), its
     * folder, and the person's chats bound to its owned copies (`chats`), which a Clear deletes with them; null for a
     * device whose machine keeps none. @param {string} deviceId
     * @returns {{ count: number, bytes: number, folder: string, chats: string[] } | null}
     */
    usage(deviceId) {
      const m = machineOf(deviceId);
      if (!m) return null;
      const mine = copiesOf(m.key);
      if (!mine.length && !machines[m.key]) return null;
      return { count: mine.length, bytes: mine.reduce((n, c) => n + c.bytes, 0) + storeBytes(m.key), folder: machineFolder(m), chats: mine.filter((c) => own(c) && c.chat).map((c) => c.chat) };
    },
    /** Every copy. @returns {Copy[]} */
    list: () => copies.map((c) => ({ ...c })),
    /**
     * A device's machine's copies cleared, busy ones too, and its folder with them (its mirrors); what works in them
     * stopped first. → how many went, their size as measured, and the folders that stay on disk until a sweep removes
     * them (`failed`). @param {string} deviceId
     * @returns {Promise<{ cleared: number, bytes: number, failed: string[] }>}
     */
    async clear(deviceId) {
      const m = machineOf(deviceId);
      if (!m) return { cleared: 0, bytes: 0, failed: [] };
      const mine = copiesOf(m.key);
      const kept = machines[m.key];
      const bytes = mine.reduce((n, c) => n + c.bytes, 0) + storeBytes(m.key);
      if (kept) delete machines[m.key];
      keptStates = keptStates.filter((x) => x.machine !== m.key);
      const failed = await letGo(m.key, mine, "cleared", kept ? [kept.folder, ...(kept.store && existsSync(kept.store) ? [kept.store] : [])] : []);
      return { cleared: mine.length, bytes, failed };
    },
    /**
     * Copies idle past `idleMs` let go, each machine's together, with what was kept of copies whose chat last used them
     * that long ago, and the stores of projects that have no copy left, nothing kept of one, and for which nothing came
     * in that long; and the leftovers no let-go here holds told again and removed — a list that
     * could not be read is read again first. → how many copies went. @returns {Promise<number>}
     */
    async sweep() {
      if (unread) load();
      if (unread) return 0;
      const again = leftovers.filter((l) => !going.has(l.folder) && !copies.some((c) => c.folder === l.folder) && !Object.values(machines).some((x) => x.folder === l.folder || x.store === l.folder));
      const old = copies.filter((c) => !busy(c) && now() - c.usedAt > idleMs);
      const fresh = keptStates.filter((k) => now() - k.at <= idleMs);
      if (fresh.length !== keptStates.length) {
        keptStates = fresh;
        save();
      }
      const goneIds = new Set(old.map((c) => c.id));
      /** @type {Map<string, string[]>} */
      const stale = new Map();
      for (const [key, x] of Object.entries(machines))
        for (const [name, s] of Object.entries(x.stores ?? {}))
          if (x.store && now() - s.usedAt > idleMs && !copies.some((c) => c.machine === key && (c.project === name || (!!s.repo && c.repo === s.repo)) && !goneIds.has(c.id)) && !keptStates.some((k) => k.machine === key && k.project === name)) {
            stale.set(key, [...(stale.get(key) ?? []), join(x.store, name)]);
            delete /** @type {Record<string, Store>} */ (x.stores)[name];
          }
      await Promise.all([
        ...[...new Set([...old.map((c) => c.machine), ...stale.keys()])].map((key) => letGo(key, old.filter((c) => c.machine === key), "idle", stale.get(key) ?? [])),
        ...[...new Set(again.map((l) => l.machine))].map((key) => settle(again.filter((l) => l.machine === key), "again")),
      ]);
      return old.length;
    },
    /** The folders let go and not yet removed: the fence lets no one into them, and no new copy is given one. */
    gone: () => leftovers.map((l) => l.folder),
    /**
     * What the fence takes of an agents' device's copies (http/admin/remote.js `agentFolderRefusal`): its machine's
     * folder, the copies folder, the folders let go, and the copies placed for the person's own chats (`copiesOwned`),
     * which their agents never start, run or read in (the review of s2a). @param {string} deviceId
     */
    fenceOf(deviceId) {
      const m = machineOf(deviceId);
      return { copies: (m && machines[m.key]?.folder) || "", copiesRoot: root, copiesGone: leftovers.map((l) => l.folder), copiesOwned: copies.filter((c) => c.owned).map((c) => c.folder) };
    },
    /** → once every let-go under way has ended, its folders removed or left for the sweep. */
    settled: async () => {
      while (underWay.size) await Promise.allSettled([...underWay]);
    },
    /**
     * Hear copies let go, before their folders are removed: the chats and commands in them stopped, waited for.
     * → what stops hearing it. @param {(c: Cleared) => unknown} fn
     */
    onCleared(fn) {
      clearHeard.add(fn);
      return () => void clearHeard.delete(fn);
    },
    /**
     * What tells whether a chat still has work going — its turn, its sub-agents, its background commands — which holds
     * its copy as a launch does: never taken by a newer launch nor let go for room under it. Set once the sessions are.
     * @param {((chat: string) => boolean) | null} fn
     */
    setWorking(fn) {
      working = fn;
    },
    /**
     * What tells whether a chat is still there: one deleted lets go of the copy it was bound to — the person's copy is
     * no one's own then (`own`), and a chat started there next is bound to it. Set once the archive is.
     * @param {((chat: string) => boolean) | null} fn
     */
    setChatThere(fn) {
      chatThere = fn;
    },
    /**
     * A single command another machine's agents run in a copy holds it too while it runs (exec.js), bound to no chat: no
     * newer launch takes the copy and checks out over it (the swarm's review of 11-10). @param {(folder: string) => boolean} fn
     */
    holdWhile(fn) {
      runsIn.push(fn);
    },
  };
}

/** Bytes said in GB, or MB below one. @param {number} n */
export const gib = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.max(0, Math.round(n / 1024 ** 2))} MB`);

/** A folder's size, links not followed, up to `MEASURE_MAX` entries. @param {string} folder */
async function sizeOf(folder) {
  let total = 0;
  let seen = 0;
  const stack = [folder];
  while (stack.length && seen < MEASURE_MAX) {
    const at = /** @type {string} */ (stack.pop());
    let names;
    try {
      names = await readdir(at, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of names) {
      if (++seen > MEASURE_MAX) break;
      const p = join(at, d.name);
      if (d.isDirectory()) stack.push(p);
      else if (d.isFile())
        try {
          total += (await lstat(p)).size;
        } catch {}
    }
  }
  return total;
}

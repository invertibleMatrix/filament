// @ts-check
// The machines one window drives (the owner's remote Filament of 11-06, Part 3): its machines popover's list, kept in
// `<dataDir>\desktop\machines.json` beside the app's settings — Filament's config is not the app's to write — and This
// computer always first, never kept: its Filament is the one the app runs or attached to. Each other machine is its
// Filament's id (its /.well-known/filament), the name it is shown by, the routes it is reached by in the order they are
// tried, and the partition its view keeps its cookie in — one machine's cookie is never another's. A route is a direct
// address — https (tailscale serve's), or plain http to this machine alone (an SSH tunnel's localhost) — or the network
// listener's https with its certificate's pinned fingerprint (services/lan-tls.js), which `pinsFor` gives the view's
// own certificate check, or an SSH tunnel this computer holds (ssh-route.js): its end here, http://127.0.0.1:<port>,
// with the SSH alias and Filament's port on that machine. A kind this app does not know is kept as written and passed
// over. Before a view loads a route — before any cookie goes there — `pickRoute` asks who answers at it, cookie-less, an
// SSH route's tunnel brought up first (`hold`), and takes it only where the machine's own id answers (and, on the
// network, over the pinned certificate alone). `machineWatch` says each machine online, reconnecting or offline; `slotOfInput`
// maps Ctrl+1..9 (⌘ on a Mac) to the machines' slots. A machine may be kept disconnected (`off`, the owner's of 11-08):
// listed, its ways and its sign-in kept, but nothing asked of it — no look, no page, no notification — until it is
// connected again (`setMachineOff`). A machine may use this app's browser (`browser`, b-remote): the agent's pages for
// the person's chats there open in this app (lib/machine-browser.js), off until switched on (`setMachineBrowser`).
// Plain Node (NA-D13).
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pinnedFetch } from "../../src/cli/pinned.js";
import { onThisMachine } from "../../src/cli/remotes.js";
import { bodyText } from "../../src/services/machines/client.js";
import { printOf } from "../../src/core/x509.js";
import { aliasOf, localOf } from "./ssh-route.js";

/** The file in the app's own folder (`<dataDir>\desktop`) the machines are kept in. */
export const MACHINES_FILE = "machines.json";
/** This computer's slot: never kept, always first. */
export const LOCAL_ID = "local";
/** What the machines popover calls this computer. */
export const LOCAL_NAME = "This computer";
/** The most machines a window holds, This computer among them. */
export const MAX_MACHINES = 32;
/** How long a machine that stopped answering is reconnecting before it is offline. */
export const RECONNECT_MS = 30_000;
/** How long one route is given to say who answers there. */
export const ASK_MS = 5000;

/**
 * @typedef {{ kind: "url", url: string }} UrlRoute  an address reached as it is: an SSH tunnel's localhost, tailscale serve's https
 * @typedef {{ kind: "lan", url: string, fingerprint: string }} LanRoute  the network listener's https, its certificate pinned
 * @typedef {import("./ssh-route.js").SshRoute} SshRoute  a tunnel this computer holds: its end here, the alias, Filament's port there
 * @typedef {UrlRoute | LanRoute | SshRoute | { kind: string, [k: string]: unknown }} Route  any other kind: a newer app's, kept and passed over
 * @typedef {{ id: string, name: string, routes: Route[], partition: string, addedAt: number | null, local?: true, off?: true, browser?: true }} Machine
 *   `off`: kept disconnected; `browser`: it may use this app's browser
 */

/**
 * A Filament's id as kept: /.well-known/filament's (services/machine.js, a UUID), in lower case — a partition's folder on
 * disk is one whatever the case, so two ids that differ in case alone would share a cookie (the review of p3-machines).
 * "" where it is none. @param {unknown} id
 */
export const idOf = (id) => {
  const s = typeof id === "string" ? id.toLowerCase() : "";
  return /^[a-z0-9_-]{1,64}$/.test(s) && s !== LOCAL_ID ? s : "";
};
/**
 * The partition a machine's view keeps its cookie in: its own, kept across starts. `gen`: a partition anew, which a
 * machine paired again with a certificate it was never paired with moves to — Chromium keeps each certificate's verdict
 * for its partition's life, a refusal and an old yes alike, and no call of Electron's forgets it (measured on Electron
 * 45, the drive of p3-add). A `.` is in no id: one machine's partitions are never another's.
 * @param {string} id @param {number} [gen]
 */
export const partitionOf = (id, gen = 0) => (gen > 0 ? `persist:machine-${id}.${gen}` : `persist:machine-${id}`);
/** Which of a machine's partitions this is, or -1 where it is none of that machine's. @param {string} id @param {unknown} p */
export const partitionGen = (id, p) => {
  const m = /^persist:machine-([a-z0-9_-]{1,64})(?:\.([1-9]\d{0,5}))?$/.exec(String(p ?? ""));
  return m && m[1] === id ? Number(m[2] || 0) : -1;
};
/** The partition kept for a machine, or its first where none of its is. @param {string} id @param {unknown} p */
const keptPartition = (id, p) => (partitionGen(id, p) >= 0 ? String(p) : partitionOf(id));

/**
 * An address a route may hold, as its origin: https, or plain http to this machine alone — an SSH tunnel's localhost.
 * Plain http to another machine is anyone's on the way, and whoever holds that address answers the id it likes (the
 * review of p3-machines), as the command line refuses it (cli/remotes.js). No credentials. @param {unknown} u
 * @returns {string | null}
 */
function urlOf(u) {
  try {
    const x = new URL(String(u));
    if (x.username || x.password) return null;
    if (x.protocol === "https:" || (x.protocol === "http:" && onThisMachine(x.href))) return x.origin;
    return null;
  } catch {
    return null;
  }
}

/**
 * A route as kept, or null where it is none: a direct one needs its address, a network one its https address and its
 * certificate's whole fingerprint, an SSH one its end on this computer's loopback, an alias no option is read in, and
 * Filament's port there; another kind is kept as written, for the app that knows it.
 * @param {any} r @returns {Route | null}
 */
export function routeOf(r) {
  if (!r || typeof r !== "object" || typeof r.kind !== "string" || !r.kind) return null;
  if (r.kind === "url") {
    const url = urlOf(r.url);
    return url ? { kind: "url", url } : null;
  }
  if (r.kind === "lan") {
    const url = urlOf(r.url);
    const fingerprint = printOf(r.fingerprint);
    return url?.startsWith("https:") && fingerprint.length === 95 ? { kind: "lan", url, fingerprint } : null;
  }
  if (r.kind === "ssh") {
    const local = localOf(r);
    const alias = aliasOf(r.alias);
    const port = Number(r.port);
    return local && alias && Number.isInteger(port) && port >= 1 && port <= 65535 ? { kind: "ssh", url: `http://127.0.0.1:${local}`, alias, port } : null;
  }
  return { ...r };
}

/** A machine as kept, or null. @param {any} m @returns {Machine | null} */
function keptOf(m) {
  const id = m && typeof m === "object" ? idOf(m.id) : "";
  if (!id) return null;
  const routes = (Array.isArray(m.routes) ? m.routes : []).map(routeOf).filter((r) => r !== null);
  const name = String(m.name ?? "").trim().slice(0, 64) || id;
  return { id, name, routes: /** @type {Route[]} */ (routes), partition: keptPartition(id, m.partition), addedAt: Number.isFinite(m.addedAt) ? Number(m.addedAt) : null, ...(m.off === true ? { off: /** @type {const} */ (true) } : {}), ...(m.browser === true ? { browser: /** @type {const} */ (true) } : {}) };
}

/**
 * The file's entries as written, or `null` where a file is there and does not read as a list of machines — a hand
 * edit's stray comma, a newer app's shape: never taken for none, so a write sets it aside first (`keep`).
 * @param {string} file @returns {any[] | null}
 */
function entriesOf(file) {
  if (!existsSync(file)) return [];
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(v?.machines) ? v.machines : null;
  } catch {
    return null;
  }
}

/**
 * This computer's slot: its Filament at `origin`, in the app's own session (no partition).
 * @param {string} origin
 * @returns {Machine}
 */
export const localMachine = (origin) => ({ id: LOCAL_ID, name: LOCAL_NAME, routes: [{ kind: "url", url: origin }], partition: "", addedAt: null, local: true });

/**
 * The machines kept, as the file says them — one that does not read is none, a machine named twice is its first, This
 * computer's id is no kept machine's.
 * @param {string} file
 * @returns {Machine[]}
 */
export function readKept(file) {
  /** @type {Machine[]} */
  const out = [];
  for (const m of entriesOf(file) || []) {
    const k = keptOf(m);
    if (k && !out.some((x) => x.id === k.id)) out.push(k);
  }
  return out;
}

/**
 * The window's machines: This computer first, at `origin`, then the machines kept, in the order they were added.
 * @param {string} file @param {string} origin
 * @returns {Machine[]}
 */
export const readMachines = (file, origin) => [localMachine(origin), ...readKept(file)];

/**
 * @typedef {{ now?: number, log?: (line: string) => void }} KeepOpts  `log`: where a file set aside is said
 */

/**
 * Keep the list whole, through a temporary file. A file there that does not read is set aside first — beside it, named
 * for when — never written over (the review of p3-machines); what each machine's entry holds beyond what this app reads
 * is kept with it.
 * @param {string} file @param {readonly Machine[]} list @param {KeepOpts} [o]
 */
function keep(file, list, { now = Date.now(), log = () => {} } = {}) {
  const had = entriesOf(file);
  if (had === null) {
    const aside = `${file}.unread-${now}`;
    renameSync(file, aside);
    log(`machines: ${file} did not read; set aside as ${aside}`);
  }
  /** @type {Map<string, any>} */
  const raw = new Map();
  for (const e of had || []) {
    const id = e && typeof e === "object" ? idOf(e.id) : "";
    if (id && !raw.has(id)) raw.set(id, e);
  }
  const machines = list
    .filter((m) => !m.local)
    .map((m) => {
      const e = { ...raw.get(m.id), id: m.id, name: m.name, routes: m.routes, partition: keptPartition(m.id, m.partition), addedAt: m.addedAt };
      // Connected: no mark left of the time it was not; nor of a browser switched off.
      if (m.off) e.off = true;
      else delete e.off;
      if (m.browser) e.browser = true;
      else delete e.browser;
      return e;
    });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify({ machines }, null, 2));
  renameSync(`${file}.tmp`, file);
}

/**
 * Add a machine, or — its id kept already — take its name and put its routes first, those it had after them: a machine
 * paired again by another address keeps the ways it was reached; `partition`, one of its own it moved to (`partitionOf`),
 * else the one it had. One paired again is connected, and may use this app's browser as it might. Throws in words for
 * one that is none.
 * @param {string} file @param {{ id: string, name?: string, routes: Route[], partition?: string }} m @param {KeepOpts} [o]
 * @returns {Machine}
 */
export function addMachine(file, m, o = {}) {
  const id = idOf(m?.id);
  if (!id) throw new Error(`a machine is named by its Filament's id, letters, digits, - and _: not ${JSON.stringify(m?.id)}`);
  const routes = (m.routes || []).map(routeOf).filter((r) => r !== null);
  if (!routes.length) throw new Error("a machine needs a way to reach it: an https address, plain http on this machine (an SSH tunnel), or the network's https with its certificate's fingerprint");
  const all = readKept(file);
  const had = all.find((x) => x.id === id);
  const same = (/** @type {Route} */ a, /** @type {Route} */ b) => a.kind === b.kind && a.url === b.url;
  const merged = [...routes, ...(had?.routes || []).filter((r) => !routes.some((n) => same(n, /** @type {Route} */ (r))))];
  const got = /** @type {Machine} */ (keptOf({ id, name: m.name || had?.name || id, routes: merged, partition: m.partition || had?.partition, addedAt: had?.addedAt ?? o.now ?? Date.now(), browser: had?.browser }));
  if (!had && all.length >= MAX_MACHINES - 1) throw new Error(`this window holds ${MAX_MACHINES} machines at most: remove one first`);
  keep(file, had ? all.map((x) => (x.id === id ? got : x)) : [...all, got], o);
  return got;
}

/** Remove a machine; whether one went. Its partition's cookie is the shell's to clear. @param {string} file @param {string} id @param {KeepOpts} [o] */
export function removeMachine(file, id, o = {}) {
  const all = readKept(file);
  const left = all.filter((x) => x.id !== idOf(id));
  if (left.length === all.length) return false;
  keep(file, left, o);
  return true;
}

/**
 * A machine disconnected (`off`) or connected again, kept so — its ways, its partition, its sign-in there as they
 * were; the machine as it is now, or null where none has that id (This computer's is never off).
 * @param {string} file @param {string} id @param {boolean} off @param {KeepOpts} [o]
 */
export function setMachineOff(file, id, off, o = {}) {
  const all = readKept(file);
  const had = all.find((x) => x.id === idOf(id));
  if (!had) return null;
  const { off: _was, ...rest } = had;
  /** @type {Machine} */
  const got = off ? { ...rest, off: true } : rest;
  keep(file, all.map((x) => (x.id === had.id ? got : x)), o);
  return got;
}

/**
 * A machine let use this app's browser, or not, kept so; the machine as it is now, or null where none has that id.
 * @param {string} file @param {string} id @param {boolean} on @param {KeepOpts} [o]
 */
export function setMachineBrowser(file, id, on, o = {}) {
  const all = readKept(file);
  const had = all.find((x) => x.id === idOf(id));
  if (!had) return null;
  const { browser: _was, ...rest } = had;
  /** @type {Machine} */
  const got = on ? { ...rest, browser: true } : rest;
  keep(file, all.map((x) => (x.id === had.id ? got : x)), o);
  return got;
}

/**
 * Call a machine another name; the machine as it is now, or null where none has that id.
 * @param {string} file @param {string} id @param {string} name @param {KeepOpts} [o]
 */
export function renameMachine(file, id, name, o = {}) {
  const all = readKept(file);
  const had = all.find((x) => x.id === idOf(id));
  const n = String(name ?? "").trim().slice(0, 64);
  if (!had || !n) return null;
  const got = { ...had, name: n };
  keep(file, all.map((x) => (x.id === had.id ? got : x)), o);
  return got;
}

/** A host as a URL names it, unbracketed and in lower case. @param {string} h */
const bare = (h) => String(h || "").replace(/^\[|\]$/g, "").toLowerCase();

/**
 * The fingerprints a machine's network routes pin for a host — the view's own connection is checked against them (its
 * session's certificate check), as `pickRoute`'s was: a machine's cookie goes over the certificate it was paired with
 * alone (the review of p3-machines). None where the host is no network route's.
 * @param {Machine} machine @param {string} hostname
 * @returns {string[]}
 */
export function pinsFor(machine, hostname) {
  const h = bare(hostname);
  return machine.routes.filter((r) => r.kind === "lan" && bare(new URL(String(r.url)).hostname) === h).map((r) => String(/** @type {LanRoute} */ (r).fingerprint));
}

/**
 * The most of a route's answer that is read, in bytes: who answers there, its id, name and version, is a few hundred,
 * where whatever answers at an address that means harm would send on without end.
 */
const ANSWER_MAX = 1024 * 1024;

/**
 * What a route says of who answers there, cookie-less: its /.well-known/filament — over the pinned certificate alone on
 * the network, where another certificate ends the connection before a byte is sent. Injected in tests.
 * @typedef {(route: Route, path: string, o: { timeoutMs: number }) => Promise<{ status: number, json: any }>} Ask
 * @type {Ask}
 */
export const askRoute = async (route, path, { timeoutMs }) => {
  const f = route.kind === "lan" ? pinnedFetch(String(route.fingerprint)) : fetch;
  const r = await f(`${route.url}${path}`, { signal: AbortSignal.timeout(timeoutMs), credentials: "omit", redirect: "manual" });
  // Past ANSWER_MAX it is read no further, and the route is passed over in words.
  const text = await bodyText(r, ANSWER_MAX, "it", `GET ${path}`);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: r.status, json };
};

/** Why a route was passed over, in words. @param {any} e @param {Route} route @param {number} timeoutMs */
function failWords(e, route, timeoutMs) {
  for (let x = e, n = 0; x && n < 5; x = x.cause, n++) {
    if (x.code === "FILAMENT_PIN") return `${route.url} answered with another certificate than the one paired: nothing was sent`;
    if (x.code === "ECONNREFUSED") return `nothing listens at ${route.url}`;
    if (x.name === "TimeoutError") return `no answer from ${route.url} in ${Math.round(timeoutMs / 1000)} s`;
    if (x.code === "ENOTFOUND" || x.code === "EAI_AGAIN") return `${new URL(String(route.url)).hostname} is not found`;
  }
  return `${route.url} could not be asked: ${e?.message || e}`;
}

/**
 * Why no Filament answered through an SSH tunnel that is up: too slow, or none there — or its SSH server forwards no
 * port. @param {any} e @param {SshRoute} ssh @param {number} timeoutMs
 */
function tunnelWords(e, ssh, timeoutMs) {
  for (let x = e, n = 0; x && n < 5; x = x.cause, n++)
    if (x.name === "TimeoutError") return `no answer from Filament on ${ssh.alias} through the tunnel in ${Math.round(timeoutMs / 1000)} s`;
  return `no Filament answers on ${ssh.alias} at port ${ssh.port} through the tunnel: is it running there, and does its SSH server let a port be forwarded (AllowTcpForwarding)?`;
}

/**
 * The route a machine's view loads: its routes in order, each asked who answers there (`ask`), the first where the
 * machine's own id answers — another machine at an address, or no Filament, is passed over, and said why. An SSH
 * route's tunnel is brought up first (`hold`: null, or why not); with none to hold it, it is asked as it is. A kind this
 * app does not know is passed over. Null `route` where none answers, with each route's why — `wrong` where another
 * machine answered there.
 * @param {Machine} machine @param {{ ask?: Ask, timeoutMs?: number, hold?: (route: Route) => Promise<string | null> }} [o]
 * @returns {Promise<{ route: Route | null, name: string | null, version: string | null, tried: Tried[] }>}
 */
export async function pickRoute(machine, { ask = askRoute, timeoutMs = ASK_MS, hold } = {}) {
  /** @type {Tried[]} */
  const tried = [];
  for (const route of machine.routes) {
    const url = String(route.url ?? "");
    if (route.kind !== "url" && route.kind !== "lan" && route.kind !== "ssh") {
      tried.push({ url, why: `this app does not know a ${route.kind} route: update it` });
      continue;
    }
    const ssh = route.kind === "ssh" ? /** @type {SshRoute} */ (route) : null;
    if (ssh && hold) {
      const why = await hold(ssh);
      if (why) {
        tried.push({ url, why });
        continue;
      }
    }
    try {
      const { status, json } = await ask(route, "/.well-known/filament", { timeoutMs });
      if (status !== 200 || typeof json?.id !== "string") tried.push({ url, why: `what answers at ${url} is no Filament (HTTP ${status})` });
      else if (!machine.local && String(json.id).toLowerCase() !== machine.id) tried.push({ url, why: `${url} is ${String(json.name || json.id)} (${json.id}), not ${machine.name}: nothing was sent there`, wrong: true });
      else return { route, name: typeof json.name === "string" ? json.name : null, version: typeof json.version === "string" ? json.version : null, tried };
    } catch (/** @type {any} */ e) {
      tried.push({ url, why: ssh ? tunnelWords(e, ssh, timeoutMs) : failWords(e, route, timeoutMs) });
    }
  }
  return { route: null, name: null, version: null, tried };
}

/**
 * @typedef {{ url: string, why: string, wrong?: true }} Tried  a route passed over, and why; `wrong`: another machine answered there
 * @typedef {"online" | "reconnecting" | "offline" | "disconnected"} MachineStatus  `disconnected`: kept off, never asked
 * @typedef {{ status: MachineStatus, silentSince: number | null, why: string | null }} Watched
 */

/**
 * A machine as one look found it: `online` while it answers; once it stops, `reconnecting` for `RECONNECT_MS` — the
 * view keeps its page and the next looks try again — then `offline`, with the last why. A machine that has never
 * answered since the app started counts from its first look. `wrong`: an address answered as another machine — no
 * waiting on that one: offline at once.
 * @param {Watched | null} prev @param {{ answered: boolean, why?: string | null, wrong?: boolean }} look @param {number} now
 * @returns {Watched}
 */
export function machineWatch(prev, { answered, why = null, wrong = false }, now) {
  if (answered) return { status: "online", silentSince: null, why: null };
  const since = prev?.silentSince ?? now;
  return { status: wrong || now - since >= RECONNECT_MS ? "offline" : "reconnecting", silentSince: since, why: why ?? prev?.why ?? null };
}

/**
 * The machines' slot a key press names: Ctrl+1..9 — ⌘ on a Mac — with no other modifier, its number; null for any other.
 * Read from Electron's `before-input-event` input by the key's place (`code`): on a French keyboard Ctrl+1's `key`
 * is "&" (the review of p3-machines).
 * @param {{ type?: string, key?: string, code?: string, control?: boolean, meta?: boolean, alt?: boolean, shift?: boolean }} input @param {string} [platform]
 * @returns {number | null}
 */
export function slotOfInput(input, platform = process.platform) {
  if (input?.type !== undefined && input.type !== "keyDown") return null;
  const mod = platform === "darwin" ? input?.meta && !input?.control : input?.control && !input?.meta;
  if (!mod || input?.alt || input?.shift) return null;
  const by = /^(?:Digit|Numpad)([1-9])$/.exec(String(input?.code ?? ""));
  if (by) return Number(by[1]);
  return input?.code === undefined && /^[1-9]$/.test(String(input?.key)) ? Number(input.key) : null;
}

/** The machine in a slot (1..9), or null where the window holds none there. @param {readonly Machine[]} machines @param {number} n */
export const machineInSlot = (machines, n) => (Number.isInteger(n) && n >= 1 && n <= 9 ? machines[n - 1] ?? null : null);

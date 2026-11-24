// @ts-check
// The Filaments on other machines this data folder is paired with as a device (the owner's remote Filament of 11-06,
// Part 1), which the command line drives and this Filament's own agents reach (index.js). Each is connected once —
// `filament connect <link>`, the link `filament pair` or Settings › Remote access shows on that machine, its code in the
// fragment — and kept in <dataDir>/remotes.json (0600): its address, its machine's id and name, what it lets this device
// do, and the device token its claim handed out, which nothing says. The token is sealed there with the data folder's
// secret.key, as config.json's secrets are, unless `server.encryptSecrets` is off; one kept plain, from before, is sealed
// the first time it is read. `--machine <name>` (or `--url`, or FILAMENT_MACHINE) sends any command there: the machine
// at the address is asked who it is first (/.well-known/filament, which answers anyone), so the token goes to the
// machine it was paired with alone. Over the network it is https alone, the machine's certificate pinned by its
// fingerprint (Part 2, pinned.js) — the link carries it — and plain http is for this machine itself (an SSH tunnel) or a
// proxy here. Moved from cli/remotes.js, which says it still.
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { ANSWER_MAX, CliError, EXIT, bodyText, clientAt, redirectRefusal, redirected, refusalWords } from "./client.js";
import { certificateAt, pinnedFetch } from "./pinned.js";
import { usePinBook } from "./key-pins.js";
import { cleanName, gapWords, protocolGap } from "../machine.js";
import { isSealed, loadKey, open, seal } from "../config/secrets.js";
import { printOf } from "../../core/x509.js";

/** The file, in the data folder of the machine this command line runs on. */
export const REMOTES_FILE = "remotes.json";
/** The most /.well-known/filament's answer may be, in bytes: an id, a name and a version, read from anyone at an address. */
const WHO_MAX = 64 * 1024;

/**
 * A reply's JSON, no more than ANSWER_MAX of it read — past that, the CliError that says so —; null where it is none,
 * or its body broke off. @param {Response} r @param {string} who  the machine, for the words
 */
async function jsonOf(r, who) {
  try {
    return JSON.parse(await bodyText(r, ANSWER_MAX, who));
  } catch (e) {
    if (e instanceof CliError) throw e;
    return null;
  }
}

/**
 * A Filament on another machine, as kept: its token is this device's, never said — open here, sealed in the file;
 * `fingerprint`, the certificate its https address is pinned to; `routes`, its other ways, tried in their order where
 * `url` does not answer as it (`waysOf`) — the agents' device the desktop app keeps for a machine it reaches more than
 * one way: its tailnet's, its home network's, an SSH tunnel's end here.
 * @typedef {{ url: string, fingerprint?: string }} Way
 * @typedef {{ name: string, url: string, token: string, fingerprint?: string, routes?: Way[], machine: { id: string, name: string }, device: { id: string, name: string, scope: string }, connectedAt: number }} Remote
 */
/** A machine as it is handed out: what is kept of it, its token aside. @typedef {Omit<Remote, "token">} Machine */

/** A machine with its token left out. @param {Remote} r @returns {Machine} */
export const withoutToken = ({ token: _token, ...machine }) => machine;

/** The most other ways one machine is kept with. */
export const ROUTES_MOST = 8;
/**
 * A way to a machine as kept: an https address — its certificate pinned where a fingerprint is given — or plain http to
 * this machine alone (an SSH tunnel's end); null where it is none. @param {any} w @returns {Way | null}
 */
const wayKept = (w) => {
  try {
    const u = new URL(String(w?.url ?? ""));
    if (u.protocol !== "https:" && !(u.protocol === "http:" && onThisMachine(u.href))) return null;
    const pin = u.protocol === "https:" && w.fingerprint ? printOf(w.fingerprint) : "";
    if (w.fingerprint && u.protocol === "https:" && pin.length !== 95) return null;
    return { url: u.origin, ...(pin ? { fingerprint: pin } : {}) };
  } catch {
    return null;
  }
};
/** A machine's other ways as kept: each once, none at `url`, `ROUTES_MOST` at most. @param {unknown} list @param {string} url @returns {Way[]} */
const waysKept = (list, url) => {
  /** @type {Way[]} */
  const out = [];
  for (const w of Array.isArray(list) ? list : []) {
    const k = wayKept(w);
    if (k && k.url !== url && !out.some((x) => x.url === k.url)) out.push(k);
    if (out.length >= ROUTES_MOST) break;
  }
  return out;
};
/** A row with its other ways as kept, none where it has none. @template {{ url: string, routes?: unknown }} R @param {R} r @returns {R} */
const withWays = (r) => {
  const { routes: _was, ...rest } = r;
  const routes = waysKept(r.routes, r.url);
  return /** @type {R} */ (routes.length ? { ...rest, routes } : rest);
};
/** Whether a way is plain http to this machine: an SSH tunnel's end, or a forward of the person's, there while it is held. @param {Way} w */
const heldHere = (w) => w.url.startsWith("http:");
/**
 * A machine's ways in the order they are tried: its address, then its others, one on this computer last — a tunnel's
 * port, its tunnel ended, is any program's here to listen at (the review of s4d). @param {Remote} r @returns {Way[]}
 */
export const waysOf = (r) => {
  const all = [{ url: r.url, ...(r.fingerprint ? { fingerprint: r.fingerprint } : {}) }, ...(r.routes || [])];
  return [...all.filter((w) => !heldHere(w)), ...all.filter(heldHere)];
};

/** How long a machine's first way is asked alone before its others are asked too (`firstWay`). */
export const WAY_HEAD_MS = 1500;
/**
 * The first of a machine's ways `check` takes: the first of them (`waysOf`) asked alone, its others at once where it
 * failed as a way does (`tryAnother`) or did not answer in `headMs`, the first that answers then taken and the rest let
 * go (`check`'s signal) — a machine that is off is said so in one wait, not one for each of its ways. A failure that is
 * the machine's whichever way, a wire this Filament does not speak, ends it at once. None taken: each one's failure, in
 * their order.
 * @template T @param {Way[]} ways @param {(way: Way, signal: AbortSignal) => Promise<T>} check @param {number} [headMs]
 * @returns {Promise<{ way: Way, value: T } | { failed: CliError[] }>}
 */
function firstWay(ways, check, headMs = WAY_HEAD_MS) {
  const stop = new AbortController();
  return new Promise((resolve, reject) => {
    /** @type {CliError[]} */
    const failed = [];
    let asked = 0;
    let out = 0;
    let done = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let head;
    /** @param {() => void} then */
    const end = (then) => {
      if (done) return;
      done = true;
      clearTimeout(head);
      stop.abort();
      then();
    };
    const rest = () => {
      clearTimeout(head);
      while (asked < ways.length) ask(asked);
    };
    /** @param {number} i */
    const ask = (i) => {
      asked++;
      check(ways[i], stop.signal).then(
        (value) => end(() => resolve({ way: ways[i], value })),
        (e) => {
          if (done) return;
          if (!tryAnother(e)) return end(() => reject(e));
          failed[i] = e;
          if (++out === ways.length) return end(() => resolve({ failed }));
          if (i === 0) rest();
        },
      );
    };
    ask(0);
    if (ways.length > 1) head = setTimeout(rest, headMs);
  });
}

/**
 * Whether the data folder seals its secrets on disk: its config's `server.encryptSecrets`, read, never written — on where
 * there is no config, as a new one has it. @param {string} dataDir
 */
function sealsSecrets(dataDir) {
  try {
    return JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"))?.server?.encryptSecrets !== false;
  } catch {
    return true;
  }
}

/**
 * The names a machine gave, as kept: the machine's and its device's, each one short line with nothing invisible in it
 * (machine.js `cleanName`) — they are said on cards, in notices and log lines —; the machine's id where its name is none.
 * @template {{ name: string, machine: { id: string, name: string }, device: { name: string } }} R @param {R} r @returns {R}
 */
const namesCleaned = (r) => {
  const name = cleanName(r.machine.name) || cleanName(r.machine.id) || r.machine.id;
  return { ...r, name: cleanName(r.name) || name, machine: { ...r.machine, name }, device: { ...r.device, name: cleanName(r.device?.name) } };
};

/**
 * The machines connected, their tokens open, their names as cleaned (`namesCleaned`); a file that does not read is
 * none. A token this data folder's secret.key cannot open (sealed with another, or none is left) stays as it is sealed:
 * kept so, and sent nowhere (`connectRemote`). One kept plain is sealed now, the file written again, where secrets are
 * sealed — only where it is still as it was read: a machine another process kept meanwhile stays, sealed the next read.
 * @param {string} dataDir @returns {Remote[]}
 */
export function readRemotes(dataDir) {
  /** @type {Remote[]} */
  let rows;
  let text = "";
  try {
    text = readFileSync(join(dataDir, REMOTES_FILE), "utf8");
    const j = JSON.parse(text);
    rows = (Array.isArray(j?.remotes) ? j.remotes : []).filter((/** @type {any} */ r) => r && typeof r.url === "string" && typeof r.token === "string" && typeof r.machine?.id === "string").map((/** @type {any} */ r) => withWays(namesCleaned(r)));
  } catch {
    return [];
  }
  /** @type {Buffer | null} */
  let key = null;
  try {
    if (rows.some((r) => isSealed(r.token))) key = loadKey(dataDir, { create: false });
  } catch {}
  const opened = rows.map((r) => {
    if (!isSealed(r.token) || !key) return r;
    try {
      return { ...r, token: open(r.token, key) };
    } catch {
      return r;
    }
  });
  if (rows.some((r) => r.token && !isSealed(r.token)) && sealsSecrets(dataDir))
    try {
      writeRemotes(dataDir, opened, text);
    } catch {}
  return opened;
}

/**
 * Keep the machines whole, readable by this user alone, each token sealed with the data folder's secret.key — made where
 * it has none — unless secrets are not sealed there. One still sealed, that the key could not open, is kept as it is.
 * `was`: the file's text as a read found it — written only where it is so still, as it is about to be replaced.
 * @param {string} dataDir @param {Remote[]} remotes @param {string} [was]
 */
function writeRemotes(dataDir, remotes, was) {
  mkdirSync(dataDir, { recursive: true });
  const key = sealsSecrets(dataDir) ? loadKey(dataDir) : null;
  const rows = key ? remotes.map((r) => ({ ...r, token: seal(r.token, key) })) : remotes;
  const file = join(dataDir, REMOTES_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ remotes: rows }, null, 2)}\n`, { mode: 0o600 });
  if (was !== undefined) {
    let now = null;
    try {
      now = readFileSync(file, "utf8");
    } catch {}
    if (now !== was) {
      rmSync(tmp, { force: true });
      return;
    }
  }
  renameSync(tmp, file);
  try {
    chmodSync(file, 0o600);
  } catch {}
}

/** A machine as the list says it: no token. @param {Remote} r */
export const shownRemote = (r) => ({ name: r.name, url: r.url, machine: r.machine.id, device: r.device.name, scope: r.device.scope, connectedAt: r.connectedAt });

/**
 * The address, the code and the certificate's fingerprint a pairing's link gives — in its fragment
 * (`#code=XXXX-XXXX&fp=<64 hex digits>`) — or the code typed beside a bare address, which wins. An address with no
 * scheme is http.
 * @param {string} link @param {string} [typed]
 * @returns {{ url: string, code: string, fingerprint: string }}
 */
export function pairingOf(link, typed = "") {
  const text = String(link || "").trim();
  /** @type {URL} */
  let u;
  try {
    // One with no scheme is https for another machine — its network listener's — and plain http for this one, as the
    // desktop's Add sheet reads it (add-machine.js `addressOf`; the hunt of p1-cli: http, then refused before any pin).
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !onThisMachine(u.href)) u = new URL(`https://${text}`);
  } catch {
    throw new CliError(`not an address: ${text || "(none)"} — give the link Filament's Settings › Remote access shows on the other machine`, EXIT.usage);
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) throw new CliError(`not a Filament's address: ${text}`, EXIT.usage);
  const frag = new URLSearchParams(u.hash.slice(1));
  const code = String(typed || frag.get("code") || "").trim();
  const fp = printOf(String(frag.get("fp") || ""));
  return { url: u.origin, code, fingerprint: fp.length === 95 ? fp : "" };
}

/**
 * An address on this machine itself: loopback, where plain http is read by no one else (an SSH tunnel, a proxy here).
 * The desktop's rail asks the same of a machine's route (desktop/lib/machines.js). @param {string} url
 */
export const onThisMachine = (url) => {
  const h = new URL(url).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  // 127.0.0.0/8 as an address alone: a name that starts so (127.x.example) is anyone's (the review of p3-add).
  return h === "localhost" || h === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);
};
/** Whether a request failed on the certificate — none an authority signed, another name, run out — not the way there. @param {any} e */
export const certRefused = (e) => {
  for (let x = e, n = 0; x && n < 5; x = x.cause, n++) if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|ALTNAME/.test(String(x.code || ""))) return true;
  return false;
};

/** What plain http to another machine is refused with: a code or a token sent there is anyone's on the network. @param {string} url */
export const plainWords = (url) =>
  `${url} is plain http to another machine, where anyone on the network reads what is sent: give the https link Settings › Remote access shows there (Reach this machine on my network), or reach it through an SSH tunnel or tailscale serve`;

/**
 * Who answers at `url`: its /.well-known/filament, asked before anything is sent there — a redirect followed nowhere,
 * no more than WHO_MAX of it read, past which it says so —, the name it gives as kept (machine.js `cleanName`), its id
 * where that is none. One on a wire this Filament does not speak (machine.js `protocolGap`) is refused, saying which
 * side to update — its refusal's body `{ gap, name, version }`, for an app to say it in its own words —, unless `wire`
 * is false: a sign-out, which stops a token there, goes on any wire (the review of s4c). `expect`: the machine's id
 * looked for — another is refused as no Filament there before its wire is weighed (`other`, who it is), a way passed
 * over, not that machine's gap (the review of s4d); `signal`: the ask let go of.
 * @param {string} url @param {{ fetchImpl?: typeof fetch, timeoutMs?: number, wire?: boolean, expect?: string, signal?: AbortSignal }} [o]
 * @returns {Promise<{ id: string, name: string, version: string }>}
 */
export async function machineAt(url, { fetchImpl = fetch, timeoutMs = 5000, wire = true, expect = "", signal } = {}) {
  /** @type {any} */
  let j;
  try {
    const ends = signal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), signal]) : AbortSignal.timeout(timeoutMs);
    const r = await fetchImpl(`${url}/.well-known/filament`, { redirect: "manual", signal: ends });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    j = JSON.parse(await bodyText(r, WHO_MAX, url));
  } catch (/** @type {any} */ e) {
    // Something answered, too much of who it is (bodyText's refusal): said as that, not as no one there.
    if (e instanceof CliError)
      throw new CliError(`${url} answered who it is (/.well-known/filament) with more than ${WHO_MAX / 1024} KB, where a Filament says its id, name and version in far less: it is read no further`, EXIT.failed);
    // Something answered, with another certificate than the one pinned: said as that, not as no one there. Each carries
    // what failed (`cause`), for a caller that says it in words of its own (providers/filament.js `reach`).
    for (let x = e, n = 0; x && n < 5; x = x.cause, n++)
      if (x.code === "FILAMENT_PIN") throw Object.assign(new CliError(`${x.message}. If that machine's certificate was made anew, connect again with the link its Settings › Remote access shows.`, EXIT.noFilament), { cause: x });
    throw Object.assign(new CliError(`No Filament answers at ${url}: is the machine on, Filament running there, and its address one this machine reaches? (${e?.message || e})`, EXIT.noFilament), { cause: e });
  }
  if (typeof j?.id !== "string" || !j.id) throw new CliError(`What answers at ${url} is no Filament (it did not say who it is)`, EXIT.noFilament);
  const who = { id: j.id, name: cleanName(j.name) || cleanName(j.id) || j.id, version: String(j.version || "") };
  if (expect && who.id !== expect) throw Object.assign(new CliError(`The Filament at ${url} is ${who.name} (${who.id})`, EXIT.noFilament), { other: who });
  // A Filament on a wire this one does not speak is sent nothing: which side to update, said (services/machine.js).
  const gap = wire ? protocolGap(j) : null;
  if (gap)
    throw new CliError(
      `${gapWords(gap, who, "this Filament")} ${gap === "there" ? `On ${who.name}: filament update, or the Filament app's Check for updates there.` : "Here: filament update, or the Filament app's Check for updates."} Nothing was sent.`,
      EXIT.failed,
      { gap, name: who.name, version: who.version },
    );
  return who;
}

/**
 * Connect this command line to the Filament on another machine: its code claimed — this device named `name`, else
 * this machine's — and the token kept. One machine is kept once: connecting again replaces it. An https address is
 * pinned to the certificate the link names (or `fingerprint`, given beside it); with none, a certificate an authority
 * signed (tailscale serve's) is checked as any site's, and another — the network listener's own — sends nothing: its
 * fingerprint is said, for the person to compare with the one that machine shows. Plain http goes to this machine alone.
 * @param {string} dataDir @param {string} link
 * @param {{ code?: string, name?: string, fingerprint?: string, fetchImpl?: typeof fetch, certificate?: (url: string) => Promise<string> }} [o]
 * @returns {Promise<Remote>}
 */
export async function connectTo(dataDir, link, { code: typed = "", name = "", fingerprint: given = "", fetchImpl, certificate = certificateAt } = {}) {
  const { url, code, fingerprint: linked } = pairingOf(link, typed);
  // The keys behind the certificates pinned are learned in this data folder (key-pins.js).
  usePinBook(dataDir);
  if (!code) throw new CliError(`no code: open Settings › Remote access on that machine (or run \`filament pair\` there) and give its link, or the address and the code`, EXIT.usage);
  if (url.startsWith("http:") && !onThisMachine(url)) throw new CliError(plainWords(url), EXIT.usage);
  const pin = url.startsWith("https:") ? printOf(given || linked) : "";
  let vouched = true;
  if (url.startsWith("https:") && pin.length !== 95) {
    if (given) throw new CliError(`--fingerprint is a certificate's SHA-256 fingerprint, 64 hex digits (AB:CD:…), not ${given}`, EXIT.usage);
    // A certificate an authority signed (tailscale serve's) is checked as any https site's is, and needs no pin; the
    // network listener's own one, which no authority signed, is pinned (the review of p2-lan).
    try {
      await (fetchImpl ?? fetch)(`${url}/.well-known/filament`, { signal: AbortSignal.timeout(5000) });
    } catch (/** @type {any} */ e) {
      if (!certRefused(e)) throw new CliError(`No Filament answers at ${url}: is the machine on, Filament running there, and its address one this machine reaches? (${e?.message || e})`, EXIT.noFilament);
      vouched = false;
    }
  }
  if (url.startsWith("https:") && pin.length !== 95 && !vouched) {
    let seen = "";
    try {
      seen = await certificate(url);
    } catch (/** @type {any} */ e) {
      throw new CliError(`No Filament answers at ${url}: is the machine on, and Reach this machine on my network turned on there? (${e?.message || e})`, EXIT.noFilament);
    }
    throw new CliError(`The certificate at ${url} has the fingerprint ${seen}. If Settings › Remote access on that machine shows the same, connect again with --fingerprint ${seen} — or give the link it shows, which carries it. Another means something else answered. Nothing was sent.`, EXIT.usage);
  }
  const f = fetchImpl ?? (pin ? pinnedFetch(pin) : fetch);
  const who = await machineAt(url, { fetchImpl: f });
  const r = await f(`${url}/api/remote/claim`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, name: name || `${hostname()} (command line)` }),
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (redirected(r)) throw redirectRefusal(r, who.name);
  /** @type {any} */
  const j = await jsonOf(r, who.name);
  if (!r.ok) throw new CliError(refusalWords(j, r.status), EXIT.failed, j);
  if (typeof j?.token !== "string" || !j.token) throw new CliError(`${who.name} handed out no token: its Filament may be older than this command line`, EXIT.failed);
  const had = readRemotes(dataDir).find((x) => x.machine.id === who.id && !agentsOf(x));
  // A machine says its id unasked: one kept at another address, or behind another pin, is the one connected only where
  // something shows the two are one machine (`notKept`) — else the kept one stays, and the device just claimed lets go.
  const other = had && (had.url !== url || (had.fingerprint ?? "") !== pin) ? await notKept(had, { url, token: j.token, device: String(j.device?.id || ""), f, fetchImpl }) : "";
  if (had && other) {
    await f(`${url}/api/remote/sign-out`, { method: "POST", headers: { "x-filament-ui": "1", "content-type": "application/json", authorization: `Bearer ${j.token}` }, body: "{}", redirect: "manual", signal: AbortSignal.timeout(5000) }).catch(() => null);
    throw new CliError(`${who.name} at ${url} says it is ${had.name} (${who.id}), kept here at ${had.url}, ${other}, and ${had.name} is kept as it was. If ${url} is the one you meant, disconnect the other first (filament disconnect ${had.name}), then connect again.`, EXIT.failed);
  }
  // Connected to it already: that device signs out there, as Disconnect does — one device of this command line a machine
  // (the hunt of p1-cli: the old token stayed good until revoked there). One the machine no longer answers for is let be.
  if (had) await signOut(dataDir, had.machine.id, fetchImpl).catch(() => false);
  /** @type {Remote} */
  const row = namesCleaned({ name: who.name, url, token: j.token, ...(pin ? { fingerprint: pin } : {}), machine: { id: who.id, name: who.name }, device: { id: String(j.device?.id || ""), name: String(j.device?.name || name), scope: j.device?.scope === "view" ? "view" : "full" }, connectedAt: Date.now() });
  writeRemotes(dataDir, [...readRemotes(dataDir).filter((x) => !(x.machine.id === who.id && !agentsOf(x))), row]);
  return row;
}

/**
 * A machine's devices as it lists them to a device that manages it (GET /remote/devices): null where it lists none —
 * the device refused, no list in its answer, nothing answering. `token` is that device's, handed out at `url`.
 * @param {string} url @param {string} token @param {typeof fetch} f @returns {Promise<any[] | null>}
 */
async function devicesAt(url, token, f) {
  try {
    const r = await f(`${url}/api/remote/devices`, { headers: { "x-filament-ui": "1", authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(5000) });
    const j = r.ok ? await jsonOf(r, url) : null;
    return Array.isArray(j?.devices) ? j.devices : null;
  } catch {
    return null;
  }
}

/**
 * Why the machine at `url`, which says a kept machine's id and just handed out a device, is not taken for that machine
 * (`had`), in the refusal's words; "" where something shows the two are one. A token goes to the address that handed it
 * out, and to no other (the security re-read of 11-11: the token just claimed went to the kept address, for whoever
 * answers there now to use at the machine that issued it). Where the kept address, behind its own pin, still answers as
 * itself, it is asked with the kept token for its devices, and its word alone decides: one machine where it lists the
 * device just claimed — another than the kept one, not revoked —, two where it does not; one that lists nothing to the
 * kept device (signed out there, or a device that only reads) shows neither. Where it does not answer as itself — off,
 * moved, another machine there, another certificate, or plain http to another machine, where nothing is asked —, the
 * new address is asked with the token it handed out, and is the kept machine, moved, where it lists the device kept
 * for it: a machine says its id unasked, so saying it while the kept one is off takes no machine's place.
 * @param {Remote} had @param {{ url: string, token: string, device: string, f: typeof fetch, fetchImpl?: typeof fetch }} claimed
 *   `f`: the fetch the claim went by, pinned as the link said
 */
async function notKept(had, { url, token, device, f, fetchImpl }) {
  const plain = had.url.startsWith("http:") && !onThisMachine(had.url);
  const there = fetchImpl ?? (had.fingerprint ? pinnedFetch(had.fingerprint) : fetch);
  const answers = !plain && (await machineAt(had.url, { fetchImpl: there }).then((m) => m.id === had.machine.id, () => false));
  if (answers) {
    // A token still sealed (another secret.key's) is no token to send.
    const listed = isSealed(had.token) ? null : await devicesAt(had.url, had.token, there);
    if (!listed) return "and the machine there did not say whether it knows the device just claimed (it lists its devices to this command line's device there no longer, or never did): they may be two machines that say one id";
    return device && device !== had.device.id && listed.some((d) => d?.id === device && d.revokedAt == null) ? "" : "and the machine there does not know the device just claimed: two machines say one id";
  }
  const listed = had.device.id ? await devicesAt(url, token, f) : null;
  if (listed?.some((d) => d?.id === had.device.id)) return "";
  return `${plain ? "which is plain http to another machine and is asked nothing" : "which no longer answers as the machine kept here"}, and ${url} does not know the device kept for it: it may be another machine that says its id`;
}

/**
 * Whether a kept machine's device is this Filament's agents' one (f-ui's `keepRemote`) rather than the person's: a
 * machine is kept once for each — the person's `filament connect`, and the agents' device the desktop app minted there —
 * and a command line names the person's alone, the agents' work theirs. @param {Remote} r
 */
const agentsOf = (r) => r.device?.scope === "agent";

/**
 * Keep a machine with a token it handed out, no code claimed (the remote-agents plan's f-ui): the desktop app asks the
 * machine, with its own sign-in there, to mint this Filament's agents a device, and the token is kept here, sealed, as a
 * claim's is. Its address is https — pinned to `fingerprint` where one is given — or plain http to this machine alone.
 * Kept beside the person's own device for that machine (`filament connect`'s), never in its place: a device of the same
 * kind kept before is let go here, and stays listed there until it is revoked. No `token`: the device kept already for
 * that machine, by its id, takes the address and pin given and keeps its own token — a machine reached anew, nothing
 * minted there. `routes`: its other ways, tried where `url` does not answer (`waysOf`); one that is none is left out.
 * @param {string} dataDir
 * @param {{ url: string, fingerprint?: string, routes?: Way[], machine: { id: string, name?: string }, device: { id: string, name?: string, scope?: string }, token?: string }} given
 * @returns {Remote}
 */
export function keepRemote(dataDir, given) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(String(given?.url ?? ""));
  } catch {
    throw new CliError(`not an address: ${given?.url || "(none)"}`, EXIT.usage);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && onThisMachine(u.href))) throw new CliError(plainWords(u.origin), EXIT.usage);
  const pin = u.protocol === "https:" && given.fingerprint ? printOf(given.fingerprint) : "";
  if (given.fingerprint && u.protocol === "https:" && pin.length !== 95) throw new CliError(`a certificate's SHA-256 fingerprint is 64 hex digits (AB:CD:…), not ${given.fingerprint}`, EXIT.usage);
  const id = String(given.machine?.id ?? "");
  if (!id) throw new CliError("a machine is kept by its id, as its /.well-known/filament says it", EXIT.usage);
  const all = readRemotes(dataDir);
  const deviceId = String(given.device?.id ?? "");
  const scope = String(given.device?.scope || "full");
  const had = given.token === undefined ? all.find((x) => x.machine.id === id && x.device.id === deviceId && x.device.scope === scope) : null;
  const token = had ? had.token : given.token;
  if (typeof token !== "string" || !token) throw new CliError(`${cleanName(given.machine.name) || id} handed out no token to keep`, EXIT.usage);
  const name = String(given.machine.name || id);
  const routes = waysKept(given.routes, u.origin);
  /** @type {Remote} */
  const row = namesCleaned({ name, url: u.origin, token, ...(pin ? { fingerprint: pin } : {}), ...(routes.length ? { routes } : {}), machine: { id, name }, device: { id: deviceId, name: String(given.device?.name ?? ""), scope }, connectedAt: had ? had.connectedAt : Date.now() });
  writeRemotes(dataDir, [...all.filter((x) => !(x.machine.id === id && agentsOf(x) === agentsOf(row))), row]);
  return row;
}

/**
 * A machine's name as it is matched: its apostrophes and quotes each one ('s typed for a Mac's ’s), in any case, its
 * spaces one. @param {string} s
 */
const nameKey = (s) =>
  cleanName(s)
    .replace(/[‘’ʼ`´′]/g, "'")
    .replace(/[“”″]/g, '"')
    .toLowerCase();

/**
 * Keep the machine `r` is under the name it answered with now (a Mac's Computer Name, read where its hostname was its
 * address once: the owner's of 11-10), each device kept for it, their tokens as they are. A file another process wrote
 * meanwhile is left as it is: the next answer names it again. @param {string} dataDir @param {Remote} r @param {string} name
 * @returns {Remote}
 */
function renamedKept(dataDir, r, name) {
  const fresh = cleanName(name);
  if (!fresh || fresh === r.name) return r;
  try {
    // The file's text first, then its machines: read the other way, a machine another process kept between the two
    // reads was in the text compared and not in the rows written, and was gone.
    const was = readFileSync(join(dataDir, REMOTES_FILE), "utf8");
    const all = readRemotes(dataDir);
    writeRemotes(dataDir, all.map((x) => (x.machine.id === r.machine.id ? namesCleaned({ ...x, name: fresh, machine: { ...x.machine, name: fresh } }) : x)), was);
  } catch {} // not written: this call still says the name it heard
  return namesCleaned({ ...r, name: fresh, machine: { ...r.machine, name: fresh } });
}

/**
 * Keep the machine `r` is reached at `way` now, one of its other ways (`waysOf`): its address next time, the one it had
 * first among its others — the next call goes where it answered, and back where that one does not. A file another
 * process wrote meanwhile is left as it is. @param {string} dataDir @param {Remote} r @param {Way} way @returns {Remote}
 */
function movedKept(dataDir, r, way) {
  /** @param {Remote} x @returns {Remote} */
  const moved = (x) => {
    const { fingerprint: _pin, routes: _ways, ...rest } = x;
    const routes = waysKept([{ url: x.url, ...(x.fingerprint ? { fingerprint: x.fingerprint } : {}) }, ...(x.routes || [])], way.url);
    return { ...rest, url: way.url, ...(way.fingerprint ? { fingerprint: way.fingerprint } : {}), ...(routes.length ? { routes } : {}) };
  };
  /** @param {Remote} x */
  const same = (x) => x.machine.id === r.machine.id && x.device.id === r.device.id && agentsOf(x) === agentsOf(r);
  try {
    const was = readFileSync(join(dataDir, REMOTES_FILE), "utf8");
    const all = readRemotes(dataDir);
    // Its row as the file has it now, ways kept there meanwhile among them; one kept at another address or pin since
    // this call read it — the desktop app's, paired again or reached anew — stands as it is (the review of s4d).
    if (all.some((x) => same(x) && x.url === r.url && (x.fingerprint ?? "") === (r.fingerprint ?? ""))) writeRemotes(dataDir, all.map((x) => (same(x) ? moved(x) : x)), was);
  } catch {} // not written: this call still goes where it answered
  return moved(r);
}

/**
 * Why none of a machine's ways took it: the first one's failure, its other ways named where it has any; for the agents'
 * device, a way on this computer said as what it may be — an SSH tunnel the desktop app holds (desktop/lib/machine-agents.js).
 * @param {CliError | null | undefined} first @param {Remote} r @returns {CliError}
 */
const noWay = (first, r) => {
  const e = first ?? new CliError(`${r.name}: no way to it answers`, EXIT.noFilament);
  const others = r.routes?.length ? ` Nor did its other ways answer as it (${r.routes.map((x) => x.url).join(", ")}).` : "";
  const here = agentsOf(r) ? waysOf(r).find(heldHere) : undefined;
  const held = here ? ` ${here.url} is on this computer: an SSH tunnel's end there stands while the Filament app that holds it runs with ${r.name} connected in its window.` : "";
  if (!others && !held) return e;
  return Object.assign(new CliError(`${e.message}${others}${held}`, e.code, e.body), { cause: /** @type {any} */ (e).cause });
};
/** Whether a failure to reach a machine at one way leaves its others to try: none answered there, or not as it. @param {any} e */
const tryAnother = (e) => e instanceof CliError && e.code === EXIT.noFilament;

/**
 * The machine a command names — by its name (any case, either apostrophe), its machine's id, or its address — or a
 * CliError (exit 2) that lists those kept. A name two machines call themselves names neither: its CliError (`several`)
 * says each by its id and its address, which do name one. `agents`: the agents' device kept for it, not the person's.
 * @param {string} dataDir @param {string} which @param {{ agents?: boolean }} [o]
 * @returns {Remote}
 */
export function remoteNamed(dataDir, which, { agents = false } = {}) {
  const all = readRemotes(dataDir).filter((r) => agentsOf(r) === agents);
  const w = String(which).trim();
  const typed = nameKey(w);
  const byUrl = (() => {
    try {
      return pairingOf(w).url;
    } catch {
      return null;
    }
  })();
  const named = all.filter((r) => nameKey(r.name) === typed || r.machine.id === w || (byUrl && r.url === byUrl));
  // An address one machine has as its own names it, though another kept it among its ways (the review of s4d).
  const hits = named.length || !byUrl ? named : all.filter((r) => !!r.routes?.some((x) => x.url === byUrl));
  if (hits.length === 1) return hits[0];
  if (hits.length) {
    const each = hits.map((r) => `${r.name} (${r.machine.id}, ${r.url})`);
    throw Object.assign(new CliError(`"${w}" names ${hits.length} machines: ${each.slice(0, -1).join(", ")} and ${each.at(-1)} — name the one you mean by its id or its address`, EXIT.usage), { several: true });
  }
  const kept = all.length ? `connected: ${all.map((r) => `${r.name} (${r.url})`).join(", ")}` : "none is connected: `filament connect <link>` connects one";
  throw new CliError(`no machine "${w}" — ${kept}`, EXIT.usage);
}

/**
 * A client of a connected machine's Filament, once the machine at its address says it is the one connected and it
 * still knows this device; else a CliError in words that say which. Where none answers at its address, or not as it,
 * or not at once, its other ways are asked too (`firstWay`), and the one that answers as it first is its address from
 * then on (`movedKept`); a client stays bound to the address it was made at, so a stream it holds does not move — its
 * next call does. `anyWire`: whatever wire it speaks (`machineAt`'s `wire`), for a sign-out alone.
 * @param {string} dataDir @param {string} which @param {{ fetchImpl?: typeof fetch, signal?: AbortSignal, timeoutMs?: number, agents?: boolean, anyWire?: boolean }} [o]
 */
export async function connectRemote(dataDir, which, { fetchImpl: given, signal, timeoutMs = 5000, agents = false, anyWire = false } = {}) {
  let row = remoteNamed(dataDir, which, { agents });
  usePinBook(dataDir);
  // One connected over plain http to another machine, before Filament took https alone: its token goes there no more.
  if (row.url.startsWith("http:") && !onThisMachine(row.url)) throw new CliError(`${row.name}: ${plainWords(row.url)}; then connect again (filament connect <link>).`, EXIT.failed);
  // A token still sealed: this data folder's secret.key does not open it, and the sealed text is no token to send.
  if (isSealed(row.token)) throw new CliError(`${row.name}: its token was sealed with another secret.key than this data folder's, and cannot be read: put that secret.key back, or connect again (filament connect <link>).`, EXIT.failed);
  const paired = row;
  // None there, another certificate, or another machine: its next way. A wire this Filament does not speak is the
  // machine's, whichever way.
  const found = await firstWay(waysOf(row), async (way, stop) => {
    const fetchImpl = given ?? (way.fingerprint ? pinnedFetch(way.fingerprint) : fetch);
    try {
      const who = await machineAt(way.url, { fetchImpl, timeoutMs, wire: !anyWire, expect: paired.machine.id, signal: signal ? AbortSignal.any([stop, signal]) : stop });
      return { who, fetchImpl };
    } catch (/** @type {any} */ e) {
      if (!e?.other) throw e;
      throw new CliError(`The Filament at ${way.url} is ${e.other.name} (${e.other.id}), not ${paired.name} that this command line paired with: its token is not sent there. Connect again (filament connect <link>) if that machine was set up anew.`, EXIT.noFilament);
    }
  });
  if ("failed" in found) throw noWay(found.failed[0], row);
  const { way } = found;
  const { who, fetchImpl } = found.value;
  row = renamedKept(dataDir, row, who.name);
  const auth = { authorization: `Bearer ${row.token}` };
  /** @type {any} */
  let state;
  try {
    const r = await fetchImpl(`${way.url}/api/state`, { headers: { "x-filament-ui": "1", ...auth }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
    if (redirected(r)) throw redirectRefusal(r, row.name);
    if (r.status === 403) {
      // An agents' device whose grant is switched off there is known all the same: its refusal says so (`grant`).
      /** @type {any} */
      const j = await jsonOf(r, row.name);
      if (j?.grant) throw new CliError(`${row.name} lets this device in no further: ${refusalWords(j, r.status)}`, EXIT.failed, j);
      // One that went unused there past its days, and how many it says (services/devices.js UNUSED_DAYS): nothing was
      // revoked, it pairs again.
      const unused = Number.isInteger(j?.days) && j.days > 0 ? `for ${j.days} days` : "too long";
      if (j?.lapsed === true) throw new CliError(`${row.name} takes this device no more: it went unused there ${unused}, so its pairing ran out. Connect again with the link its Settings › Remote access shows (filament connect <link>).`, EXIT.failed);
      throw new CliError(`${row.name} no longer knows this device — revoked there, or signed out: connect again with the link its Settings › Remote access shows (filament connect <link>).`, EXIT.failed);
    }
    if (!r.ok) throw new CliError(`${row.name} answered HTTP ${r.status}`, EXIT.failed);
    state = JSON.parse(await bodyText(r, ANSWER_MAX, row.name, "GET /state"));
  } catch (/** @type {any} */ e) {
    if (e instanceof CliError) throw e;
    throw new CliError(`${row.name} at ${way.url} did not answer: ${e?.message || e}`, EXIT.noFilament);
  }
  if (way.url !== row.url) row = movedKept(dataDir, row, way);
  return clientAt(way.url, state, fetchImpl, signal, { headers: auth, remote: withoutToken(row) });
}

/**
 * The way to a kept machine's models (the remote-agents plan's m-upstream): its address, a fetch pinned to its
 * certificate (`connectMs` its connection's time; null where none is pinned — one an authority signed, a tailnet's —,
 * and the caller's own fetch goes, following no redirect), and the headers its model endpoints take this device by: its
 * token as a Bearer, which nothing else here says. Read anew at each call, so a machine connected again is reached at its
 * new address with its new token. Over https, or plain http through an SSH tunnel on this computer: there its main
 * listener takes a model call that sends a device's token through the same door (front-door.js `mainDoor`) — its grant,
 * a revoke, the calls one device may have. Where no pin says who answers, the machine at the address says it first, as
 * `connectRemote` asks it; where one does, it says its wire all the same — one this Filament does not speak is sent no
 * token, its refusal saying which side to update —, a pass kept `WIRE_KEPT_MS` (`wirePassed`), let go where a call
 * through it fails. Where none answers at its address, or not as it, or not at once, its other ways are asked as
 * `connectRemote` asks them. Else a CliError whose
 * words say why: none kept so, plain http on the network, its token sealed with another secret.key, another machine at
 * its address, none answering there, a wire this Filament does not speak.
 * @param {string} dataDir @param {string} which @param {{ agents?: boolean, connectMs?: number }} [o]
 * @returns {Promise<{ machine: Machine, url: string, fetch: typeof fetch | null, headers: Record<string, string> }>}
 */
export async function modelsWayOf(dataDir, which, { agents = false, connectMs = 0 } = {}) {
  let row = remoteNamed(dataDir, which, { agents });
  usePinBook(dataDir);
  if (!row.url.startsWith("https:") && !onThisMachine(row.url)) throw new CliError(`${row.name}: ${plainWords(row.url)}; then connect again.`, EXIT.failed);
  if (isSealed(row.token)) throw new CliError(`${row.name}: its token was sealed with another secret.key than this data folder's, and cannot be read: put that secret.key back, or connect again.`, EXIT.failed);
  /** @param {Way} way */
  const keyOf = (way) => `${dataDir}\n${row.machine.id}\n${way.url}\n${way.fingerprint || ""}`;
  const ways = waysOf(row);
  // Its first way's wire passed of late, pinned: taken, nothing asked.
  let way = ways[0];
  if (!way.fingerprint || Date.now() - (wirePassed.get(keyOf(way)) ?? 0) >= WIRE_KEPT_MS) {
    const paired = row;
    const found = await firstWay(ways, async (w, stop) => {
      const pinned = w.fingerprint ? pinnedFetch(w.fingerprint, { connectMs }) : null;
      /** @type {typeof fetch} */
      const unfollowed = (url, init = {}) => fetch(url, { ...init, redirect: "manual" });
      // A pinned fetch gives up on the connection itself at `connectMs`, said as that (ETIMEDOUT): its answer is given past it.
      const timeoutMs = connectMs > 0 ? connectMs + (pinned ? 2_000 : 0) : undefined;
      try {
        await machineAt(w.url, { fetchImpl: pinned ?? unfollowed, ...(timeoutMs ? { timeoutMs } : {}), expect: paired.machine.id, signal: stop });
      } catch (/** @type {any} */ e) {
        if (!e?.other) throw e;
        throw new CliError(`The Filament at ${w.url} is ${e.other.name} (${e.other.id}), not ${paired.name}: its token is not sent there.`, EXIT.noFilament);
      }
      if (pinned) wirePassed.set(keyOf(w), Date.now());
    });
    if ("failed" in found) throw noWay(found.failed[0], row);
    way = found.way;
  }
  if (way.url !== row.url) row = movedKept(dataDir, row, way);
  const pinned = way.fingerprint ? pinnedFetch(way.fingerprint, { connectMs }) : null;
  const key = keyOf(way);
  // A call through it that does not reach the machine lets its wire's pass go: the next asks anew, its other ways with
  // it — a machine taken away from home is not waited on at its home address for a minute (the review of s4d).
  /** @type {typeof fetch | null} */
  const through = pinned && ((url, init) => pinned(url, init).catch((e) => Promise.reject((wirePassed.delete(key), e))));
  return { machine: withoutToken(row), url: way.url, fetch: through, headers: { authorization: `Bearer ${row.token}` } };
}

/**
 * How long a pinned machine's wire, once it passed (`modelsWayOf`), goes unasked: its model calls pay no look each.
 * A machine updated meanwhile onto another wire is said so by its first call past it.
 */
export const WIRE_KEPT_MS = 60_000;
/** The pinned machines whose wire passed, by data folder, id, address and pin: when. @type {Map<string, number>} */
const wirePassed = new Map();

/**
 * This device signs out of a connected machine: its token stops there. Throws where the machine does not answer as the
 * one connected, or no longer knows the device. @param {string} dataDir @param {string} which @param {typeof fetch} [fetchImpl]
 */
async function signOut(dataDir, which, fetchImpl) {
  // On any wire: its token stops there even where the two Filaments speak nothing else (the review of s4c).
  const client = await connectRemote(dataDir, which, { fetchImpl, anyWire: true });
  await client.post("/remote/sign-out", {});
  return true;
}

/**
 * Disconnect from a machine: this device signs out there — its token stops — and the machine is forgotten here. A
 * machine that does not answer is forgotten all the same, and said: the device stays listed there until it is revoked.
 * An agents' device is asked nothing: it signs nothing out there, itself included (admin/remote.js AGENT_ROUTES) — the
 * device that minted it revokes it there.
 * @param {string} dataDir @param {string} which @param {{ fetchImpl?: typeof fetch, agents?: boolean }} [o]
 * @returns {Promise<{ remote: Remote, signedOut: boolean, why: string | null }>}
 */
export async function disconnect(dataDir, which, { fetchImpl, agents = false } = {}) {
  const row = remoteNamed(dataDir, which, { agents });
  let signedOut = false;
  /** @type {string | null} */
  let why = null;
  if (row.device.scope === "agent") why = `an agents' device does not sign itself out: it stays listed on ${row.name} until it is revoked in its Settings › Remote access`;
  else
    try {
      signedOut = await signOut(dataDir, which, fetchImpl);
    } catch (/** @type {any} */ e) {
      why = String(e?.message || e);
    }
  writeRemotes(dataDir, readRemotes(dataDir).filter((x) => !(x.machine.id === row.machine.id && agentsOf(x) === agents)));
  return { remote: row, signedOut, why };
}

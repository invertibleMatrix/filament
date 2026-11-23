// @ts-check
// Another machine's chats' browser in this app (b-remote, the owner's design of 11-08): with "Let <machine> use this
// app's browser" on (Settings › Remote access › Machines, kept in the app's own machines.json, lib/machines.js),
// the agent's pages for the person's chats on that machine are real pages of this app — the agent there drives them over
// a link this app holds to that machine's browser host (src/http/admin/browser.js `HOST_PATH`), and the person sees them
// drawn natively over the Browser pane of that machine's harness in the window (main.js, lib/rail.js). The link is made
// here, in Electron main: over a way where the machine's own id answers (`pickRoute`), its certificate pinned on the
// network, with this window's sign-in there — the cookie its partition holds, a full device's (lib/rail.js's pairing put
// it there) — never through an SSH tunnel, where the machine takes this computer for itself and no device is there. It
// is made again a little later each time it drops, and stops as the switch goes off, the machine goes from the window or
// is disconnected, or the machine refuses it (401, 403: revoked, signed out, a view-only device), said on its row. Each
// machine's pages are their own (`partitionFor`): signed in to nothing of the person's, never the app's own profile nor
// this computer's agent browser's. Their localhost is that machine's (b-tunnel): their profile sends it to a proxy of
// this app's own, which carries it over the link (lib/tunnel.js), so the agent there opens its own dev server as
// localhost — and they reach nothing of this computer's own (`machineGuards`): not its loopback, by any name that
// resolves to it, nor its Filament wherever this computer's link says it is reached; nor that machine's Filament, as it
// says where it is reached (the `own` op), which it refuses besides. They close as the link drops, the proxy with them;
// that machine opens its chats' next pages on a host that answers. Plain Node (NA-D13).
import { isIP } from "node:net";
import { filamentsOwn } from "../../src/core/browser.js";
import { loopbackOf } from "../../src/http/admin/tunnel.js";
import { LINK_PATH, placeRect } from "./browser-host.js";
import { pickRoute } from "./machines.js";
import { dialSocket } from "./pinned-socket.js";
import { createProxy } from "./tunnel.js";

/** The waits between tries to make a machine's link again; the last holds. */
export const MACHINE_RETRY_MS = Object.freeze([1000, 3000, 10_000, 30_000]);

/** A machine's pages' profile in this app: its own, apart from this computer's agent browser's and the app's. @param {string} id */
export const partitionFor = (id) => `persist:filament-browser-${id}`;

/** An address bare: no brackets, no trailing dot, IPv4 as IPv6 writes it made plain. @param {string} h */
function bare(h) {
  let b = String(h).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  const v4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(b);
  if (v4) {
    const [a, c] = [parseInt(v4[1], 16), parseInt(v4[2], 16)];
    b = `${a >> 8}.${a & 255}.${c >> 8}.${c & 255}`;
  }
  return b.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "");
}

/** A web address's host, bare, and its port; null for an address that is no web page's. @param {unknown} url */
function placeOf(url) {
  try {
    const u = new URL(String(url));
    if (!/^(https?|wss?):$/.test(u.protocol)) return null;
    return { host: bare(u.hostname), port: Number(u.port || (/^(https|wss):$/.test(u.protocol) ? 443 : 80)) };
  } catch {
    return null;
  }
}

/**
 * Whether a web address's host is written as Chromium sends loopback to the profile's proxy (lib/tunnel.js
 * `PROXY_BYPASS`, its implicit rules): `localhost` and the names under it, 127.x written plain, `[::1]`. Another way
 * to write loopback goes straight out, to this computer's own — IPv4 as IPv6 writes it (`[::ffff:127.0.0.1]`) does —
 * or may: one Chromium is not known to send to the proxy (a trailing dot) is refused all the same.
 * @param {unknown} url
 */
function carried(url) {
  try {
    const h = new URL(String(url)).hostname.toLowerCase();
    return h === "localhost" || /^[a-z0-9_.-]*[a-z0-9_-]\.localhost$/.test(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === "[::1]";
  } catch {
    return false;
  }
}

/** Whether an address is link-local (169.254.x, fe80::/10), which the profile's proxy rules send to the proxy too. @param {string} host */
const linkLocal = (host) => /^169\.254\.\d{1,3}\.\d{1,3}$/.test(host) || /^fe[89ab][0-9a-f]:/.test(host);

/** Whether an address is this computer's own wherever it is used: its loopback, 0.0.0.0, ::. @param {string} ip */
export const ownAddress = (ip) => {
  const h = bare(ip);
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === "::1" || h === "0.0.0.0" || h === "::";
};

/**
 * Whether an address names this computer itself — `localhost` and the names under it, 127.x, ::1, 0.0.0.0, ::, each as
 * IPv6 writes IPv4 too —, at any port.
 * @param {unknown} url
 */
export function onLoopback(url) {
  const p = placeOf(url);
  return !!p && (!!loopbackOf(p.host) || ownAddress(p.host));
}

/** @param {unknown} url */
const said = (url) => String(url).slice(0, 200);

/** What another machine's agent is told of a page that tried for localhost while no link carries it there. @param {unknown} url */
export const loopbackWords = (url) =>
  `The page tried to go to ${said(url)}: this chat's browser runs in the Filament app on the developer's own computer, and its localhost is the machine the chat runs on only while the app's link to it holds — it does not now, and the browser opens nothing of the developer's computer's own.`;

/** ...of a page that tried for 0.0.0.0 or ::, which land on the computer the browser runs on. @param {unknown} url */
const unspecifiedWords = (url) =>
  `The page tried to go to ${said(url)}: 0.0.0.0 and :: reach the computer the browser runs on — the developer's, where this chat's browser is — never the machine the chat runs on. That machine's own servers are reached as localhost (or 127.0.0.1).`;

/** ...of a page whose host's name resolves to the developer's computer's loopback. @param {unknown} url @param {string} host @param {string} address */
const namedWords = (url, host, address) =>
  `The page tried to go to ${said(url)}: ${host} resolves to ${address}, the loopback of the developer's own computer, where this chat's browser runs, and the browser opens nothing of that computer's own. The machine the chat runs on is reached as localhost (or 127.0.0.1).`;

/** ...of a page whose host's name did not resolve as it was checked. @param {unknown} url @param {string} host */
const unresolvedWords = (url, host) => `The page tried to go to ${said(url)}: ${host} did not resolve, so it was not opened. Try again in a moment if the name is right.`;

/** ...of a page that tried for loopback written another way than the link carries it. @param {unknown} url */
const spellingWords = (url) =>
  `The page tried to go to ${said(url)}: the machine the chat runs on is reached as localhost (or a name under it), 127.x or [::1] alone; loopback written another way may reach the developer's own computer, where this chat's browser runs, so it is not opened. Open it as http://localhost:<port>.`;

/** ...of a page that tried for a link-local address while the link carries that machine's localhost. @param {unknown} url */
const linkLocalWords = (url) =>
  `The page tried to go to ${said(url)}: a link-local address (169.254.x, fe80::) is no one's while this chat's browser carries the machine's localhost, so it is not opened.`;

/** ...of a page that tried for the developer's computer's own Filament. @param {unknown} url */
const hereWords = (url) =>
  `The page tried to go to ${said(url)}, the Filament of the developer's own computer, where this chat's browser runs: its API acts for the developer, so the browser never opens it.`;

/**
 * @typedef {{ ports: number[], names: string[], origins: string[] }} Places  where a Filament is reached: every port it
 *   listens on, its names and addresses, the addresses serving it (core/browser.js `filamentsOwn`'s)
 */

/**
 * Whether a machine's page goes to what it never opens of this computer (browser-host.js `own`): 0.0.0.0 and ::; its
 * localhost while no link carries that machine's (`tunneled` false) — with one, localhost is that machine's, written
 * as the profile sends it to the proxy (`carried`), and loopback written any other way, or a link-local address, is
 * refused —; this computer's own Filament where it is reached (`here`) by any other name.
 * @param {string} url @param {Places} here @param {boolean} tunneled @returns {string | false}
 */
export function machineOwn(url, here, tunneled) {
  const p = placeOf(url);
  if (!p) return false;
  if (p.host === "0.0.0.0" || p.host === "::") return unspecifiedWords(url);
  if (loopbackOf(p.host) || ownAddress(p.host)) return !tunneled ? loopbackWords(url) : carried(url) ? false : spellingWords(url);
  if (tunneled && linkLocal(p.host)) return linkLocalWords(url);
  return filamentsOwn(String(url).replace(/^ws/i, "http"), here.ports, here.names, here.origins) ? hereWords(url) : false;
}

/**
 * The guards of a machine's pages in this app (browser-host.js `createPages`' `own`, `named` and `landed`), over
 * `here`, where this computer's Filament is reached now, and `tunneled`, whether its pages' localhost goes to that
 * machine now:
 *   `own`     the addresses `machineOwn` refuses;
 *   `named`   a host's name, resolved before its request goes: one that resolves to this computer's loopback (lvh.me,
 *             localtest.me, this computer's own name on some systems) is refused — it would go straight to this
 *             computer, never through the proxy, which takes loopback's names and addresses alone —, as is one that
 *             resolves to where this computer's Filament is reached, at its port;
 *   `landed`  a request that reached this computer's loopback or Filament past them (the name resolved anew between):
 *             its tab closes, said. One the proxy carried landed on the proxy's own address, and is that machine's.
 * @param {{ here: () => Places, tunneled: () => boolean }} o
 */
export function machineGuards({ here, tunneled }) {
  /** Whether an address at a port is where this computer's Filament is reached. @param {string} address @param {number} port */
  const hereAt = (address, port) => {
    const h = here();
    return h.ports.includes(port) && h.names.some((n) => !!n && bare(n) === bare(address));
  };
  return {
    /** @param {string} url */
    own: (url) => machineOwn(url, here(), tunneled()),
    /** @param {string} url @param {(host: string) => Promise<string[] | null>} resolve  null: the name's lookup failed */
    named: async (url, resolve) => {
      const p = placeOf(url);
      if (!p || !p.host || isIP(p.host) || loopbackOf(p.host)) return "";
      const list = await resolve(p.host);
      // A lookup that failed lets nothing by: the request's own lookup after it may answer loopback (a rebinding name).
      if (!list) return unresolvedWords(url, p.host);
      const loop = list.find(ownAddress);
      if (loop) return namedWords(url, p.host, loop);
      return list.some((a) => hereAt(a, p.port)) ? hereWords(url) : "";
    },
    /** @param {string} url @param {string} ip */
    landed: (url, ip) => {
      const p = placeOf(url);
      if (!p || !ip || (carried(url) && tunneled())) return "";
      if (ownAddress(ip)) return namedWords(url, p.host, ip);
      return hereAt(ip, p.port) ? hereWords(url) : "";
    },
  };
}

/**
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {ReturnType<typeof import("./browser-host.js").createPages>} Pages  a machine's pages
 * @typedef {ReturnType<typeof createProxy>} Proxy  the proxy a machine's pages' localhost goes to
 * @typedef {{ send: (text: string) => void, sendBinary?: (data: Buffer) => void, close: () => void }} Socket
 * @typedef {"off" | "connecting" | "connected" | "refused"} BrowserLink
 * @typedef {{ id: string, browser: boolean, browserLink: BrowserLink, browserWords: string | null, said?: string, failed?: true }} BrowserRow
 *   a machine as its row shows its switch: on or off, its link, and what stands in the way or what is so; `said`, an
 *   outcome to tell once — `failed` where it went wrong
 */

/**
 * A chat's page this app holds for another machine, put over that machine's Browser pane in the window, as This
 * computer's pane puts its own — while that machine's view shows (`active`): a page left over a view gone from sight
 * would stand over another machine's. True once it is there; a tab that machine's pages hold not is refused, the
 * window's pages of it parked, and the pane shows that machine's cast of it.
 * @param {{ pane: { id: string, bounds: { x: number, y: number, width: number, height: number } } | null, active: string | null,
 *   pagesOf: (id: string) => Pages | null, win: any, zoom: number, ask: any }} o
 *   `pane`: the machine's view the ask came from, and where it lies in the window (lib/rail.js `machinePane`); `zoom`:
 *   its page's; `ask`: the bridge's `{ tab, rect, lock }`, the rectangle in the page's CSS pixels
 */
export function placeOnMachine({ pane, active, pagesOf, win, zoom, ask }) {
  const pages = pane ? pagesOf(pane.id) : null;
  if (!pane || !pages || !win || win.isDestroyed()) return false;
  if (active !== pane.id) {
    pages.parkAll(win);
    return false;
  }
  const rect = placeRect(ask?.rect, zoom, { width: pane.bounds.width, height: pane.bounds.height });
  if (rect && typeof ask?.tab === "string" && pages.place(ask.tab, win, { ...rect, x: rect.x + pane.bounds.x, y: rect.y + pane.bounds.y }, { lock: ask?.lock === true })) return true;
  pages.parkAll(win);
  return false;
}

/**
 * @param {{ machines: () => Machine[], cookieOf: (partition: string, origin: string) => Promise<string>, keep: (id: string, on: boolean) => Machine | null,
 *   pagesFor: (m: Machine, send: (msg: any) => void) => Pages, pick?: typeof pickRoute, dial?: typeof dialSocket, log?: (line: string) => void,
 *   wait?: (fn: () => void, ms: number) => any, clear?: (t: any) => void, proxyFor?: (m: Machine, send: (b: Buffer) => void) => Proxy, changed?: (row: BrowserRow) => void }} o
 *   `machines`: the machines the window keeps, read now; `cookieOf`: the Cookie header the machine's partition sends that
 *   origin; `keep`: the switch kept (machines.js `setMachineBrowser`); `pagesFor`: a machine's pages, its words to its
 *   Filament sent by `send`; `proxyFor`: the proxy its pages' localhost goes to, over the link (lib/tunnel.js);
 *   `changed`: a machine's row each time its link's state moves — up, down, refused, its words — for Settings › Remote
 *   access to say it as it is (the owner's of 11-09: a row said Connecting… from its press on, the link up a moment after)
 */
export function createMachineBrowsers({ machines, cookieOf, keep, pagesFor, pick = pickRoute, dial = dialSocket, log = () => {}, wait = setTimeout, clear = clearTimeout, proxyFor = (m, send) => createProxy({ name: () => m.name, send, log }), changed = () => {} }) {
  /**
   * Each machine whose browser this app holds: the machine as last read, its pages, its socket and whether it is up, its
   * tries, its retry's timer, whether it stopped (for good: refused, or let go), what was said of it last, and its turn —
   * a socket of an earlier turn is heard no more; the proxy its pages' localhost goes to while the link is up, and its
   * pages' profile sent there (`ready`), which the machine's words wait on.
   * @typedef {{ machine: Machine, pages: Pages, sock: Socket | null, up: boolean, tries: number, timer: any, stopped: boolean, refused: boolean, words: string | null, turn: number,
   *   proxy: Proxy | null, ready: Promise<unknown> }} Held
   * @type {Map<string, Held>}
   */
  const held = new Map();
  /** The ways a machine is reached and its sign-in's partition: a machine paired again dials anew where it was refused. @param {Machine} m */
  const wayOf = (m) => JSON.stringify([m.partition, m.routes]);
  /** @param {Held} k @param {any} msg */
  const send = (k, msg) => {
    if (k.sock && k.up) k.sock.send(JSON.stringify(msg));
  };
  /** A machine's proxy closed, its streams with it, and its pages' localhost sent nowhere. @param {Held} k @param {string} why */
  const unproxy = (k, why) => {
    const p = k.proxy;
    if (!p) return;
    k.proxy = null;
    k.ready = Promise.resolve();
    p.stop(why);
    void Promise.resolve()
      .then(() => k.pages.proxy(null))
      .catch(() => {});
  };
  /** Stopped for good, said on its row: the switch on again, or the machine paired again, dials anew. @param {Held} k @param {string} words */
  const refuse = (k, words) => {
    k.stopped = true;
    k.refused = true;
    k.words = words;
    log(`machines: ${k.machine.name}'s link for this app's browser stopped: ${words}`);
    tell(k);
  };
  /** Tried again a little later each time. @param {Held} k @param {string} why */
  const later = (k, why) => {
    if (k.stopped || k.timer) return;
    if (why && why !== k.words) log(`machines: ${k.machine.name}'s link for this app's browser: ${why}; trying again`);
    k.words = why || k.words;
    k.timer = wait(() => void connect(k), MACHINE_RETRY_MS[Math.min(k.tries++, MACHINE_RETRY_MS.length - 1)]);
    tell(k);
  };
  /** What each machine's row last said through `changed`: said again only once it moves. @type {Map<string, string>} */
  const told = new Map();
  /** A held machine's row said, where it moved. @param {Held} k */
  const tell = (k) => {
    if (held.get(k.machine.id) !== k) return;
    const row = rowOf(k.machine.id);
    const key = JSON.stringify(row);
    if (told.get(k.machine.id) === key) return;
    told.set(k.machine.id, key);
    try {
      changed(row);
    } catch {}
  };
  /** @param {Held} k */
  async function connect(k) {
    k.timer = null;
    if (k.stopped) return;
    const m = k.machine;
    const turn = ++k.turn;
    const still = () => !k.stopped && k.turn === turn && held.get(m.id) === k;
    const ways = m.routes.filter((r) => String(r.url ?? "").startsWith("https:"));
    if (!ways.length) return refuse(k, `This app reaches ${m.name} through an SSH tunnel alone, where it is no paired device: turn on Reach this machine on my network or Share on my tailnet there, and add it again by the link it shows.`);
    const picked = await pick({ ...m, routes: ways }).catch((/** @type {any} */ e) => ({ route: null, tried: [{ why: String(e?.message || e) }] }));
    if (!still()) return;
    const route = picked.route;
    // One that answers on a wire this app does not speak says which side to update (machines.js `gapWords`).
    if (!route) return later(k, /** @type {any} */ (picked).update ? String(picked.tried.at(-1)?.why).replace(/\.$/, "") : `${m.name} does not answer: ${picked.tried.at(-1)?.why ?? "no way to it answers"}`);
    const origin = new URL(String(route.url)).origin;
    const cookie = await cookieOf(m.partition, origin).catch(() => "");
    if (!still()) return;
    if (!cookie) return refuse(k, `This app holds no sign-in on ${m.name}: pair it again with Add a machine and a code from its Settings › Remote access.`);
    let ended = false;
    try {
      /** @type {Socket | null} */
      let made = null;
      const sock = dial({
        url: `${origin.replace(/^https:/, "wss:")}${LINK_PATH}`,
        headers: { cookie },
        pin: route.kind === "lan" ? String(/** @type {any} */ (route).fingerprint || "") : "",
        onOpen: () => {
          if (!still()) return;
          k.up = true;
          k.tries = 0;
          k.words = null;
          log(`machines: ${m.name}'s chats' browser is this app's`);
          tell(k);
          // Its pages' localhost goes to that machine: a proxy of this app's over this link, the profile sent to it
          // before the machine's first word is done.
          const proxy = proxyFor(m, (b) => made?.sendBinary?.(b));
          k.proxy = proxy;
          k.ready = proxy
            .start()
            .then((port) => (still() && k.proxy === proxy ? k.pages.proxy({ port, ...proxy.auth }) : undefined))
            .catch((/** @type {any} */ e) => log(`machines: ${m.name}'s pages reach no localhost of it: ${String(e?.message || e)}`));
        },
        onBinary: (data) => {
          if (still()) k.proxy?.take(data);
        },
        onMessage: (text) => {
          if (!still()) return;
          /** @type {any} */
          let msg;
          try {
            msg = JSON.parse(text);
          } catch {
            return;
          }
          if (!msg || typeof msg !== "object" || typeof msg.n !== "number") return;
          k.ready
            .then(() => k.pages.handle(msg))
            .then(
              (result) => still() && send(k, { n: msg.n, ok: true, result: result ?? null }),
              (/** @type {any} */ e) => still() && send(k, { n: msg.n, ok: false, error: String(e?.message || e) }),
            );
        },
        onClose: ({ status, why }) => {
          ended = true;
          if (!still()) return;
          k.sock = null;
          const was = k.up;
          k.up = false;
          unproxy(k, why);
          // Its pages go with the link: that machine forgets them as it hears it, and opens its chats' next pages anew.
          if (was) {
            k.pages.closeAll();
            log(`machines: ${m.name}'s link for this app's browser went (${why})`);
          }
          if (status === 401) return refuse(k, `${m.name} does not know this app's sign-in any more — revoked there, or signed out: pair it again with Add a machine and a code from its Settings › Remote access.`);
          if (status === 403) return refuse(k, `${m.name} refused this app's browser: ${why}`);
          later(k, was ? "" : status ? `${m.name} answered ${status}: ${why}` : why);
        },
      });
      made = sock;
      if (!ended && still()) k.sock = sock;
    } catch (/** @type {any} */ e) {
      later(k, String(e?.message || e));
    }
  }
  /** @param {Machine} m */
  const start = (m) => {
    /** @type {Held} */
    const k = { machine: m, pages: /** @type {any} */ (null), sock: null, up: false, tries: 0, timer: null, stopped: false, refused: false, words: null, turn: 0, proxy: null, ready: Promise.resolve() };
    k.pages = pagesFor(m, (msg) => send(k, msg));
    held.set(m.id, k);
    void connect(k);
  };
  /** A machine's browser let go: its link closed, its pages and their windows gone. @param {string} id */
  const end = (id) => {
    const k = held.get(id);
    if (!k) return;
    held.delete(id);
    told.delete(id);
    k.stopped = true;
    k.turn++;
    if (k.timer) clear(k.timer);
    k.timer = null;
    const s = k.sock;
    k.sock = null;
    k.up = false;
    unproxy(k, "this app let the machine's browser go");
    try {
      s?.close();
    } catch {}
    k.pages.destroy();
  };
  /** The machines read again: each switched on, kept and connected holds its link; any other's goes. */
  const sync = () => {
    /** @type {Map<string, Machine>} */
    const want = new Map(machines().filter((m) => !m.local && m.browser && !m.off).map((m) => [m.id, m]));
    for (const id of [...held.keys()]) if (!want.has(id)) end(id);
    for (const m of want.values()) {
      const k = held.get(m.id);
      if (!k) start(m);
      else {
        const anew = k.refused && wayOf(k.machine) !== wayOf(m);
        k.machine = m;
        if (anew) {
          end(m.id);
          start(m);
        }
      }
    }
  };
  /** A machine's row as its switch shows it. @param {string} id @returns {BrowserRow} */
  const rowOf = (id) => {
    const m = machines().find((x) => !x.local && x.id === String(id).toLowerCase()) ?? null;
    const k = m ? held.get(m.id) : undefined;
    if (!m?.browser) return { id: String(id), browser: false, browserLink: "off", browserWords: null };
    if (m.off) return { id: m.id, browser: true, browserLink: "off", browserWords: `${m.name} is disconnected in this window: its chats' pages open in this app again once it is connected.` };
    if (k?.up) return { id: m.id, browser: true, browserLink: "connected", browserWords: `Connected: the agent's pages for your chats on ${m.name} open in this app.` };
    if (k?.refused) return { id: m.id, browser: true, browserLink: "refused", browserWords: k.words };
    return { id: m.id, browser: true, browserLink: "connecting", browserWords: k?.words ? `Connecting to ${m.name}: ${/[.!?…]$/.test(k.words) ? k.words : `${k.words}.`}` : `Connecting to ${m.name}…` };
  };
  return {
    sync,
    rowOf,
    /**
     * A machine let use this app's browser, or not — kept, then the link made or let go; → its row after. Switched on
     * again, a link that was refused dials anew. @param {string} id @param {boolean} on @returns {BrowserRow}
     */
    set(id, on) {
      const m = keep(String(id), on === true);
      if (!m) return { id: String(id), browser: false, browserLink: "off", browserWords: "This window keeps no such machine now: open Settings › Remote access again.", said: "No such machine in this window", failed: true };
      if (on && held.get(m.id)?.refused) end(m.id);
      sync();
      log(`machines: ${m.name} ${on ? "may" : "may no longer"} use this app's browser`);
      return { ...rowOf(m.id), said: on ? `The agent's pages for your chats on ${m.name} open in this app` : `The agent's pages for your chats on ${m.name} no longer open in this app` };
    },
    /** A machine's pages in this app, while it holds its browser; null for none. @param {string} id @returns {Pages | null} */
    pagesOf: (id) => held.get(String(id))?.pages ?? null,
    /** A machine's proxy, while its link is up; null for none. @param {string} id @returns {Proxy | null} */
    proxyOf: (id) => held.get(String(id))?.proxy ?? null,
    /** Every machine's pages this app holds now. @returns {Pages[]} */
    all: () => [...held.values()].map((k) => k.pages),
    /** The app quits: every link closed, every machine's pages gone. */
    destroy() {
      for (const id of [...held.keys()]) end(id);
    },
  };
}

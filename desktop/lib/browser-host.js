// @ts-check
// The agent's browser, the app's half (HarnessV4_Browser_Plan BR3; BR-D1, BR-D2, BR-D9, BR-D12): the Chromium pages
// Filament's chats work in, each a WebContentsView the app holds — parked in a window no one sees, its pages painting and
// their timers running, and put over the harness's Browser pane while the person looks. Filament drives them through the
// link (`createLink`): a socket to its `/api/browser/host` with its own inbound key, read from the data folder the app
// shares with it, connected again whenever it drops. What reaches a page is the protocol's commands Filament's driver
// sends, those alone (`CDP_METHODS`), and the page's picture as the app paints it (`capture`); what comes back is the
// page's events the driver reads (`CDP_EVENTS`), its popups
// as tabs of the chat that opened them, and words for what the browser refused. One profile for every chat
// (`persist:filament-browser`): sign-ins kept, kept apart from Filament's own pages — another machine's chats' pages in
// this app have a profile of that machine's (lib/machine-browser.js), whose localhost is that machine's, through a
// proxy of the app's own (`proxy`, lib/tunnel.js). It takes no downloads, asks for no
// camera, microphone, place or notification, and opens no file chooser (the driver refuses it in words). Each page
// keeps its own size, whoever watches (HarnessV4_BrowserSize_Plan BS1): parked at it, and over the pane drawn at it,
// scaled to fit and centred — the pane's shape never reaches the page. A page watched from a pane with no app of its
// own (another machine's harness, a browser's tab: the owner's remote Filament of 11-06, Part 4) is cast to Filament
// while it is (`cast`): Chrome's screencast where a pane draws it at its own size, else its picture taken a few times
// a second and sent where it changed (drawn at another scale or parked, the screencast shows no whole page), each a
// JPEG — the newest alone.
// Electron's classes come in from main.js: this file imports no Electron, so the tests run it on stand-ins.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadKey, openConfig } from "../../src/services/config/secrets.js";
import { CDP_EVENTS, CDP_METHODS, PAGE_SIZE, filamentsOwn, pageSize } from "../../src/core/browser.js";
import { proxyConfig } from "./tunnel.js";

/** The browser's one profile, apart from Filament's own pages' (BR-D9). */
export const PARTITION = "persist:filament-browser";
/** The parking window's size, a laptop's window: a page bigger than it parks and paints whole all the same (BS0). */
export const PARK_SIZE = Object.freeze({ width: 1280, height: 800 });
/**
 * How long a picture the app refuses is asked for again: a page just opened paints its first frame after a moment
 * (BS0: "Current display surface not available for capture" for about 0.3–3 s), and a refusal past it is said.
 */
export const CAPTURE_TRY_MS = 5000;
const CAPTURE_STEP_MS = 200;
/** How long Chrome's own screenshot is waited for at one try: a window that paints no frame never answers it. */
export const SHOT_MS = 2000;
/**
 * How long a host's addresses, as the profile resolved them, are taken as they are (`named`): a page's burst of requests
 * asks once, and a name that answers anew after it is asked anew — the profile's own cache keeps what its records say.
 */
export const NAMES_MS = 1000;
/** A cast's screencast frames are this far apart at the least (ten a second): its next is asked for no sooner. */
export const CAST_MS = 100;
/**
 * Where Chrome's screencast cannot show the page whole — drawn over a pane at another scale, parked — the page is
 * taken as its picture is (`pictureOf`) this often while it is cast, and sent where it changed.
 */
export const CAST_SHOT_MS = 200;
/** A cast frame's JPEG quality. */
export const CAST_QUALITY = 60;
/** A cast frame's long side at the most, in pixels: a page bigger than it is sent shrunk. */
export const CAST_LONG = 1600;
/**
 * How long the developer's hand keeps a page once their pointer has left it and no key is typed into it (BS3, BS-D10,
 * BS-D11): then it goes back to the agent.
 */
export const HAND_MS = 5000;
const HAND_TICK_MS = 200;
/**
 * The veil (BS3, BS-D9): a see-through page laid over an agent's page while it drives, so the developer's mouse reaches
 * the page only through its Take over. Nothing shows until the pointer comes over it: then a light veil and a faded
 * pill in the middle, firm under the pointer. Its press goes to the app (`veil-preload.cjs`), nothing else.
 */
export const VEIL_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Filament</title><style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;cursor:default;font:500 13px/1 system-ui,-apple-system,"Segoe UI",sans-serif;user-select:none}
#veil{position:fixed;inset:0;background:rgba(0,0,0,0);transition:background .16s ease}
body:hover #veil{background:rgba(0,0,0,.16)}
#take{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:9px 18px;border:0;border-radius:999px;background:rgba(28,28,30,.78);color:#fff;font:inherit;letter-spacing:.01em;box-shadow:0 2px 12px rgba(0,0,0,.28);opacity:0;transition:opacity .16s ease;cursor:pointer}
body:hover #take{opacity:.6}
#take:hover,#take:focus-visible{opacity:1}
</style></head><body><div id="veil"></div><button id="take" type="button" title="The agent is using this page. Take over to use it yourself: it goes back to the agent 5 s after your mouse leaves it">Take over</button>
<script>document.getElementById("take").addEventListener("click",()=>{if(window.filamentVeil)window.filamentVeil.take()});</script></body></html>`;
/** Filament's socket for the app. */
export const LINK_PATH = "/api/browser/host";
/** The waits between tries to connect again; the last holds. */
export const RETRY_MS = Object.freeze([500, 1000, 2000, 5000]);

/**
 * The protocol's commands Filament's driver sends (src/app/browser/driver.js), any other refused, and the page's events
 * it reads, the rest kept in the app: one list each, shared with Chrome on Filament's machine (src/core/browser.js).
 */
export { CDP_METHODS, CDP_EVENTS };

/**
 * Filament's inbound key, read from the data folder as Filament reads it — and nothing written: a folder with no config
 * yet, or no key, gives "" (Filament makes both at its first start, and the link tries again).
 * @param {string} dataDir
 */
export function inboundKeyOf(dataDir) {
  try {
    const raw = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8"));
    const keys = openConfig(raw, loadKey(dataDir, { create: false })).config?.server?.inboundKeys;
    return Array.isArray(keys) ? String(keys.find((k) => typeof k === "string" && k) || "") : "";
  } catch {
    return "";
  }
}

/** Whether a page of the agent's browser may go to an address: the web's, or a blank page. @param {unknown} url */
export const mayGo = (url) => /^https?:\/\//i.test(String(url ?? "")) || String(url ?? "") === "about:blank";

/** What a tab's agent is told of a page that tried for Filament's own address. @param {unknown} url */
const ownWords = (url) => `The page tried to go to ${String(url).slice(0, 200)}, Filament's own address; the browser never opens it.`;

/**
 * Whether a word to the pane's bridge is heard: from the harness's own window, its page Filament's own — a page that
 * left Filament (none can: the window is pinned to it) or another window is not heard.
 * @param {boolean} fromHarness  the word came from the harness window's page @param {string | undefined} from  the
 * asking frame's address @param {string} origin  Filament's
 */
export function paneHears(fromHarness, from, origin) {
  if (!fromHarness) return false;
  try {
    return new URL(String(from || "")).origin === origin;
  } catch {
    return false;
  }
}

/** The console's own page on Filament's origin: the dashboard window's (main.js `PAGES`), and the harness's Open Filament console. */
const CONSOLE_PATHS = new Set(["/", "/ui/", "/ui/index.html"]);
/**
 * Whether a page is Filament's own console, which the press key's bridge (dashboard-preload.cjs) is for: on Filament's
 * origin, at the console's path — no other page there, nor another machine's. @param {unknown} from  the page's address
 * @param {string} origin  Filament's
 */
export function consolePage(from, origin) {
  try {
    const u = new URL(String(from || ""));
    return u.origin === origin && CONSOLE_PATHS.has(u.pathname);
  } catch {
    return false;
  }
}

/**
 * Where the pane's rectangle stands in the window, in the window's units: the page's CSS pixels times its zoom, inside
 * the window's content — or null for one that is no rectangle, or too small to show a page.
 * @param {unknown} rect  `{ x, y, width, height }` as the pane measured it @param {number} zoom  the harness page's
 * @param {{ width: number, height: number }} content  the window's content size
 * @returns {{ x: number, y: number, width: number, height: number } | null}
 */
export function placeRect(rect, zoom, content) {
  const r = /** @type {any} */ (rect);
  if (!r || typeof r !== "object") return null;
  const n = [r.x, r.y, r.width, r.height].map(Number);
  if (n.some((v) => !Number.isFinite(v))) return null;
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const x = Math.max(0, Math.round(n[0] * z));
  const y = Math.max(0, Math.round(n[1] * z));
  const width = Math.min(Math.round(n[2] * z), Math.max(0, content.width - x));
  const height = Math.min(Math.round(n[3] * z), Math.max(0, content.height - y));
  return width >= 8 && height >= 8 ? { x, y, width, height } : null;
}

/**
 * The link to Filament: a socket to its `/api/browser/host`, the inbound key in its header (a page cannot set one, and
 * the app's main process sends no Origin) and this computer's owner key beside it (`owner`, src/services/owner.js),
 * connected again whenever it drops — a little later each time, until it
 * holds. What Filament says goes to `onMessage`; `onDown` hears the link go, which its pages go with (Filament forgets
 * them as it hears it, `lost`). A Filament older than the browser answers the socket with a refusal: the link keeps
 * trying, quietly, and connects once that Filament is the newer one.
 * @param {{ url: () => string, key: () => string, owner?: () => Record<string, string>, onMessage: (m: any) => void, onDown?: () => void, log?: (line: string) => void,
 *   WebSocket?: any, wait?: (fn: () => void, ms: number) => any, clear?: (t: any) => void }} o
 */
export function createLink({ url, key, owner = () => ({}), onMessage, onDown = () => {}, log = () => {}, WebSocket = globalThis.WebSocket, wait = setTimeout, clear = clearTimeout }) {
  /** @type {any} */
  let ws = null;
  let stopped = true;
  let up = false;
  let tries = 0;
  /** @type {any} */
  let timer = null;
  /** What was said of the last try that failed: said again only when it changes. */
  let said = "";
  /** @param {string} why */
  const later = (why) => {
    if (stopped || timer) return;
    if (why && why !== said) log(`the browser's link to Filament: ${why}; trying again`);
    said = why || said;
    timer = wait(connect, RETRY_MS[Math.min(tries++, RETRY_MS.length - 1)]);
  };
  function connect() {
    timer = null;
    if (stopped) return;
    const k = key();
    if (!k) return later("no inbound key in Filament's data folder yet");
    /** @type {any} */
    let s;
    try {
      s = new WebSocket(url(), { headers: { authorization: `Bearer ${k}`, ...owner() } });
    } catch (/** @type {any} */ e) {
      return later(`could not connect (${String(e?.message || e)})`);
    }
    ws = s;
    s.onopen = () => {
      if (ws !== s) return;
      tries = 0;
      up = true;
      said = "";
      log("the browser's link to Filament is up");
    };
    s.onmessage = (/** @type {{ data: unknown }} */ ev) => {
      /** @type {any} */
      let m;
      try {
        m = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (m && typeof m === "object") onMessage(m);
    };
    s.onerror = () => {};
    s.onclose = () => {
      if (ws !== s) return;
      ws = null;
      const was = up;
      up = false;
      if (was) {
        log("the browser's link to Filament went");
        onDown();
      }
      later(was ? "" : "Filament did not take the link (a Filament older than the browser, or not up yet)");
    };
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (timer) clear(timer);
      timer = null;
      const s = ws;
      ws = null;
      if (up) {
        up = false;
        onDown();
      }
      try {
        s?.close();
      } catch {}
    },
    /** @param {any} m */
    send(m) {
      if (ws && up) ws.send(JSON.stringify(m));
    },
    get up() {
      return up;
    },
  };
}

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/**
 * A page's scale in a pane's rectangle: the largest that shows it whole — under 1 in a narrow column, over 1 in a
 * window bigger than the page (BS case 18).
 * @param {{ width: number, height: number }} size @param {Rect} rect
 */
export const scaleIn = (size, rect) => Math.min(rect.width / size.width, rect.height / size.height);

/**
 * Where a page of that size is drawn in a pane's rectangle: at its scale there, centred, the pane's grey around it.
 * @param {{ width: number, height: number }} size @param {Rect} rect @returns {Rect}
 */
export function drawnIn(size, rect) {
  const s = scaleIn(size, rect);
  const width = Math.max(1, Math.round(size.width * s));
  const height = Math.max(1, Math.round(size.height * s));
  return { x: rect.x + Math.floor((rect.width - width) / 2), y: rect.y + Math.floor((rect.height - height) / 2), width, height };
}

/**
 * The pages: a tab per id Filament names, its WebContentsView parked until the person's pane shows it.
 * @param {{ electron: { WebContentsView: any, BrowserWindow: any, session: any, nativeImage?: any }, send: (m: any) => void, log?: (line: string) => void,
 *   newId?: () => string, menu?: ((wc: any, params: any) => void) | null, wait?: (ms: number) => Promise<void>, clock?: () => number,
 *   pointer?: () => { x: number, y: number } | null, tellPane?: (win: any, m: any) => void, veilPreload?: string,
 *   every?: (fn: () => void, ms: number) => any, stopEvery?: (t: any) => void, own?: (url: string) => boolean | string,
 *   keys?: (win: any, e: any, input: any) => void, partition?: string,
 *   named?: ((url: string, resolve: (host: string) => Promise<string[] | null>) => string | Promise<string>) | null,
 *   landed?: ((url: string, ip: string) => string) | null }} o
 *   `send`: a word to Filament; `menu`: the page's right-click; `wait`, `clock`: the capture's tries; `pointer`: where the
 *   pointer is on the screen; `tellPane`: a word to a window's Browser pane, of the developer's hand (BS3); `veilPreload`:
 *   the veil's bridge; `every`, `stopEvery`: the hand's watch — the tests' stand-ins; `own`: whether an address is
 *   Filament's own (core/browser.js `filamentsOwn`), or another no page of the profile reaches — words in place of true
 *   say to the tab's agent why; `keys`: a key pressed in a page or its veil, with the window it stands in — the machines'
 *   Ctrl+1..9 (lib/rail.js); `partition`: the profile, `PARTITION` — another machine's pages have one of their own
 *   (lib/machine-browser.js); `named`: words for a request whose host's name the profile resolves to an address no page
 *   reaches, asked before it goes (another machine's pages: a name for this computer's loopback); `landed`: words for a
 *   request that reached an address it never should — its tab closes, the words its agent's
 */
export function createPages({ electron, send, log = () => {}, newId = () => `t-${randomUUID().slice(0, 8)}`, menu = null, wait = (ms) => new Promise((r) => setTimeout(r, ms)), clock = Date.now, pointer = () => null, tellPane = () => {}, veilPreload = "", every = setInterval, stopEvery = clearInterval, own = () => false, keys = () => {}, partition = PARTITION, named = null, landed = null }) {
  const { WebContentsView, BrowserWindow, session, nativeImage = null } = electron;
  /**
   * @typedef {{ id: string, view: any, wc: any, host: any, size: { width: number, height: number }, fit: boolean, scale: number,
   *   rect: Rect | null, drawn: Rect | null, held: string, cast: Cast | null, castSeq: number }} Page
   *   `size`: the page's own, in CSS pixels; `fit`: it takes the pane's size instead, as before BS1 (Fit the pane,
   *   BS-D5); `scale`: the view's pixels per page pixel now; `rect`: the pane's rectangle it is drawn in, while it is,
   *   and `drawn` where in it; `held`: the size and scale the page's protocol was last told; `cast`: its cast to
   *   Filament, while a page watches it, and `castSeq` its frames' number so far
   * @typedef {{ way: "screencast" | "shots", key: string, last: string, said: boolean, sentAt: number }} Cast
   *   `way`: Chrome's screencast (a page over a pane at its own size) or its picture taken every `CAST_SHOT_MS`;
   *   `key`: the way and the frame's size it was started at; `last`: the last picture's JPEG sent, `said` whether a
   *   picture not taken was logged; `sentAt`: when its last frame went
   */
  /** Each window's veil, laid over its page while an agent drives it (BS3). @type {Map<any, any>} */
  const veils = new Map();
  /**
   * The developer's hand on a page, taken from its veil: the window, the tab, since when the pointer is off the page
   * (null while it is over it), the seconds last said to the pane, and the watch.
   * @type {{ win: any, tab: string, awayFrom: number | null, said: number, timer: any } | null}
   */
  let hand = null;
  /** @type {Map<string, Page>} */
  const tabs = new Map();
  /** Where Filament says it is reached now (its `own`): every port it listens on, its names, the addresses serving it. */
  let places = { ports: /** @type {number[]} */ ([]), names: /** @type {string[]} */ ([]), origins: /** @type {string[]} */ ([]) };
  /**
   * What a tab's agent is told of an address no page reaches — Filament's own, as the app reads it or where Filament says
   * it is reached, or another `own` names —; "" for one a page may go to. @param {string} url
   */
  const ownSaid = (url) => {
    const o = own(url);
    if (o) return typeof o === "string" ? o : ownWords(url);
    return filamentsOwn(url, places.ports, places.names, places.origins) ? ownWords(url) : "";
  };
  /** @type {any} */
  let park = null;
  /** @type {any} */
  let ses = null;
  /** The proxy the profile sends its loopback to while there is one (lib/tunnel.js): its port and its sign-in. @type {{ port: number, user: string, password: string } | null} */
  let proxied = null;
  /** The newest `proxy` call's number: one overtaken sets nothing. */
  let proxyTurn = 0;
  /** Each host's addresses as the profile resolved them lately, for `named`. @type {Map<string, { at: number, list: Promise<string[] | null> }>} */
  const names = new Map();
  /**
   * A host's addresses as the profile resolves them, kept `NAMES_MS`; null for a name whose lookup failed — kept as
   * long, as it lets nothing by.
   * @param {string} host
   */
  const addressesOf = (host) => {
    const had = names.get(host);
    if (had && clock() - had.at < NAMES_MS) return had.list;
    const list = Promise.resolve(ses?.resolveHost?.(host)).then(
      (/** @type {any} */ r) => (Array.isArray(r?.endpoints) ? r.endpoints.map((/** @type {any} */ e) => String(e?.address || "")) : []),
      () => null,
    );
    if (names.size >= 500) names.clear();
    names.set(host, { at: clock(), list });
    return list;
  };
  /** @param {any} wc */
  const tabOf = (wc) => [...tabs].find(([, t]) => t.wc === wc)?.[0] || null;
  /** A download refused, said to its tab's agent. @param {any} e @param {any} item @param {any} wc */
  const onDownload = (e, item, wc) => {
    e.preventDefault();
    const tab = tabOf(wc);
    const name = String(item?.getFilename?.() || item?.getURL?.() || "a file").slice(0, 200);
    if (tab) send({ op: "note", tab, words: `The page started a download (${name}); the browser takes no downloads, so it was not kept.` });
  };
  const profile = () => {
    if (ses) return ses;
    ses = session.fromPartition(partition);
    // No camera, microphone, place, notification, MIDI or the like: a page asks, and is told no (BR-D12).
    ses.setPermissionRequestHandler((/** @type {any} */ _wc, /** @type {string} */ _p, /** @type {(ok: boolean) => void} */ grant) => grant(false));
    ses.setPermissionCheckHandler(() => false);
    // Filament's own address is reached by nothing of the profile — a page's link, a redirect, a frame, a script's fetch,
    // the driver's navigation —: its API trusts this machine, so a page there could read its keys and change its
    // settings (the bug hunt of 10-30, DESK-1). Nor, where `named` is given, a name it says no page reaches, resolved
    // before the request goes. A page's own load refused is said to its tab's agent.
    ses.webRequest.onBeforeRequest((/** @type {any} */ d, /** @type {(r: { cancel: boolean }) => void} */ answer) => {
      const url = String(d?.url || "");
      /** @param {string} said */
      const tell = (said) => {
        const tab = said && d?.resourceType === "mainFrame" && d.webContents ? tabOf(d.webContents) : null;
        if (tab) send({ op: "note", tab, words: said });
        answer({ cancel: !!said });
      };
      const said = ownSaid(url);
      if (said || !named) return tell(said);
      new Promise((r) => r(named(url, addressesOf))).then(
        (w) => tell(String(w || "")),
        () => tell(""),
      );
    });
    // What reached an address it never should, past the name's check (a name that resolved anew between it and the
    // request): its tab closes, its agent told why.
    if (landed)
      ses.webRequest.onResponseStarted((/** @type {any} */ d) => {
        const words = landed(String(d?.url || ""), String(d?.ip || ""));
        if (!words) return;
        const tab = d?.webContents ? tabOf(d.webContents) : null;
        if (tab) gone(tab, words);
        else log(`browser: ${words}`);
      });
    // Taken off as the pages go (`destroy`): a machine's pages made again on its profile (its switch off and on) leave
    // no listener of theirs behind.
    ses.on("will-download", onDownload);
    return ses;
  };
  const parking = () => {
    if (park && !park.isDestroyed()) return park;
    park = new BrowserWindow({ show: false, ...PARK_SIZE, paintWhenInitiallyHidden: true, skipTaskbar: true, title: "Filament's browser", webPreferences: { backgroundThrottling: false } });
    return park;
  };
  /**
   * The page's own size held, whatever its view's (BS0, BS-D1): Chromium's device-metrics override at the size, drawn
   * at the view's scale, so the page lays itself out at its size in any pane — the app's own command, never one of the
   * driver's (`CDP_METHODS`). A page that fits the pane has none: it takes its view's size. Told again only when it
   * changes; a page whose protocol is not attached yet is told as it attaches (`open`).
   * @param {Page} t @param {number} scale
   */
  const hold = (t, scale) => {
    t.scale = t.fit ? 1 : scale;
    const key = t.fit ? "fit" : `${t.size.width}x${t.size.height}@${t.scale}`;
    if (t.held === key || !t.wc.debugger.isAttached()) return;
    t.held = key;
    const told = t.fit
      ? t.wc.debugger.sendCommand("Emulation.clearDeviceMetricsOverride", {})
      : t.wc.debugger.sendCommand("Emulation.setDeviceMetricsOverride", { width: t.size.width, height: t.size.height, deviceScaleFactor: 0, mobile: false, scale: t.scale });
    void Promise.resolve(told).catch((/** @type {any} */ e) => {
      t.held = "";
      log(`browser: a page did not take its size (${String(e?.message || e)})`);
    });
  };
  /**
   * A page leaves the window it is shown in — parked, closed, or shown in another —: that window's veil goes with it
   * (BS case 16), never left over nothing with its Take over under the pointer. @param {Page} t
   */
  const leave = (t) => {
    if (t.host && t.host !== park && !t.host.isDestroyed?.()) unveil(t.host);
  };
  /** @param {Page} t */
  const parkOne = (t) => {
    const p = parking();
    leave(t);
    p.contentView.addChildView(t.view);
    t.host = p;
    t.rect = null;
    t.drawn = null;
    t.view.setBounds({ x: 0, y: 0, ...t.size });
    hold(t, 1);
    if (t.cast) castOn(t);
  };
  /** A page over a pane, drawn at its size in the pane's rectangle — or, fitting the pane, at the pane's. @param {Page} t @param {Rect} rect */
  const drawOver = (t, rect) => {
    t.rect = rect;
    t.drawn = t.fit ? rect : drawnIn(t.size, rect);
    t.view.setBounds(t.drawn);
    hold(t, scaleIn(t.size, rect));
    if (t.cast) castOn(t);
  };

  // ---- the cast (the owner's remote Filament of 11-06, Part 4): the page, live, for a pane with no app of its own ----
  /** The space a point on a page's picture is in: its own size — a page that fits the pane, the pane's. @param {Page} t */
  const spaceOf = (t) => (t.fit && t.drawn ? { width: t.drawn.width, height: t.drawn.height } : t.size);
  /** A frame's size: the page's own, its long side kept to `CAST_LONG`. @param {Page} t */
  const castSize = (t) => {
    const s = spaceOf(t);
    const k = Math.min(1, CAST_LONG / Math.max(s.width, s.height));
    return { width: Math.max(1, Math.round(s.width * k)), height: Math.max(1, Math.round(s.height * k)) };
  };
  /** A frame to Filament, numbered for its page, the page's own size beside it. @param {Page} t @param {string} data */
  const sendFrame = (t, data) => {
    const c = t.cast;
    if (!c || !data || tabs.get(t.id) !== t) return;
    c.sentAt = clock();
    const s = spaceOf(t);
    send({ op: "frame", tab: t.id, seq: ++t.castSeq, data, width: s.width, height: s.height, way: c.way });
  };
  /** A picture of the app's as a frame: a JPEG at the frame's size. @param {Page} t @param {any} img */
  const jpegOf = (t, img) => img.resize({ ...castSize(t), quality: "good" }).toJPEG(CAST_QUALITY).toString("base64");
  /**
   * The page as it is now, as a frame of its own (`pictureOf`, as a capture takes it): a page that paints nothing new
   * casts nothing by itself. Not sent where a frame of the cast went first — it would be older than that one.
   * @param {Page} t
   */
  const firstFrame = async (t) => {
    const c = t.cast;
    try {
      const img = await pictureOf(t, clock() + SHOT_MS);
      if (c && t.cast === c && !c.sentAt && img && !img.isEmpty()) sendFrame(t, jpegOf(t, img));
    } catch (/** @type {any} */ e) {
      log(`browser: a cast page's first frame was not taken (${String(e?.message || e)})`);
    }
  };
  /**
   * A frame of Chrome's screencast: sent, and the next asked for (its ack) no sooner than `CAST_MS` after — Chrome
   * holds its next until then, and makes the newest: those between are never made.
   * @param {Page} t @param {any} p  `{ data, sessionId, metadata }`
   */
  const screencastFrame = (t, p) => {
    const ack = () => void Promise.resolve(t.wc.debugger.isAttached() && t.wc.debugger.sendCommand("Page.screencastFrameAck", { sessionId: p?.sessionId })).catch(() => {});
    const c = t.cast;
    if (!c || c.way !== "screencast") return ack();
    sendFrame(t, String(p?.data || ""));
    void wait(CAST_MS).then(ack);
  };
  /**
   * The page taken as its picture is (`pictureOf`) every `CAST_SHOT_MS` while it is cast, each sent where it changed:
   * where Chrome's screencast cannot show it whole — a page drawn over a pane at another scale, whose screencast frame
   * is the view's own size of the page at scale 1, its corner stretched over the frame (the drive's check 34); a parked
   * page, which paints nothing for it — and where the screencast does not start.
   * @param {Page} t @param {Cast} c
   */
  const shots = (t, c) => {
    c.way = "shots";
    const next = async () => {
      if (t.cast !== c || tabs.get(t.id) !== t) return;
      try {
        const img = await pictureOf(t, clock() + SHOT_MS);
        if (t.cast === c && img && !img.isEmpty()) {
          const data = jpegOf(t, img);
          if (data !== c.last) {
            c.last = data;
            sendFrame(t, data);
          }
        }
      } catch (/** @type {any} */ e) {
        // Said once a cast: a page that has not painted yet is asked again at the next.
        if (!c.said) log(`browser: a cast page's picture was not taken (${String(e?.message || e)})`);
        c.said = true;
      }
      if (t.cast === c) void wait(CAST_SHOT_MS).then(next);
    };
    void next();
  };
  /** A page's cast stopped: its screencast ended, its pictures' next one never taken. @param {Page} t */
  const castOff = (t) => {
    const c = t.cast;
    if (!c) return;
    t.cast = null;
    if (c.way === "screencast") void Promise.resolve(t.wc.debugger.isAttached() && t.wc.debugger.sendCommand("Page.stopScreencast", {})).catch(() => {});
  };
  /**
   * A page cast to Filament by the way its place allows — Chrome's screencast over a pane that draws it at its own size
   * (scale 1, or fitting the pane), the page as it is now sent at once; its picture every `CAST_SHOT_MS` anywhere else,
   * and where the screencast does not start. Started again as its place, its scale or its size moves; as it is, left so.
   * @param {Page} t
   */
  const castOn = (t) => {
    const way = t.rect && (t.fit || t.scale === 1) ? "screencast" : "shots";
    const size = castSize(t);
    const key = `${way}|${size.width}x${size.height}`;
    if (t.cast?.key === key) return;
    castOff(t);
    /** @type {Cast} */
    const c = { way, key, last: "", said: false, sentAt: 0 };
    t.cast = c;
    if (way === "shots") return shots(t, c);
    const started = t.wc.debugger.isAttached()
      ? t.wc.debugger.sendCommand("Page.startScreencast", { format: "jpeg", quality: CAST_QUALITY, maxWidth: size.width, maxHeight: size.height, everyNthFrame: 1 })
      : Promise.reject(new Error("its protocol is not attached"));
    void Promise.resolve(started).catch((/** @type {any} */ e) => {
      if (t.cast !== c) return;
      log(`browser: a page's screencast did not start (${String(e?.message || e)}); its picture is cast instead`);
      shots(t, c);
    });
    void firstFrame(t);
  };

  /** A window's veil, made once: a see-through page of the app's own, its press heard over `veilPreload`. @param {any} win */
  const veilOf = (win) => {
    const had = veils.get(win);
    if (had && !had.webContents.isDestroyed()) return had;
    const v = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, partition: "filament-veil", ...(veilPreload ? { preload: veilPreload } : {}) } });
    v.setBackgroundColor?.("#00000000");
    v.webContents.on("will-navigate", (/** @type {any} */ e) => e.preventDefault());
    v.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
    v.webContents.on("before-input-event", (/** @type {any} */ e, /** @type {any} */ input) => keys(win, e, input));
    void Promise.resolve(v.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(VEIL_PAGE)}`)).catch((/** @type {any} */ e) => log(`browser: the veil did not load (${String(e?.message || e)})`));
    veils.set(win, v);
    return v;
  };
  /** The windows whose veil lies over their page now. @type {Set<any>} */
  const veiled = new Set();
  /** The veil over a page's drawn place, on top of it. @param {any} win @param {Rect} at */
  const veil = (win, at) => {
    const v = veilOf(win);
    win.contentView.addChildView(v);
    v.setBounds(at);
    veiled.add(win);
  };
  /** @param {any} win */
  const unveil = (win) => {
    veiled.delete(win);
    const v = veils.get(win);
    if (!v) return;
    try {
      win.contentView.removeChildView(v);
    } catch {}
  };

  /** The developer's hand ends: by the 5 s (`over`, said to the pane), their Give back, or its page gone. @param {"over" | "off" | "gone"} why */
  const endHand = (why) => {
    const was = hand;
    if (!was) return;
    hand = null;
    stopEvery(was.timer);
    if (why !== "off" && !was.win.isDestroyed?.()) tellPane(was.win, { state: "over", tab: was.tab, why });
  };
  /** Whether the pointer is over a page's drawn place on the screen. @param {any} win @param {Page} t */
  const pointerOver = (win, t) => {
    const p = pointer();
    const c = win.getContentBounds?.();
    if (!p || !c || !t.drawn || t.host !== win) return false;
    const x = p.x - c.x - t.drawn.x;
    const y = p.y - c.y - t.drawn.y;
    return x >= 0 && y >= 0 && x < t.drawn.width && y < t.drawn.height;
  };
  /** The hand's watch: the pointer over the page holds it; off it, the seconds go down to the give-back. */
  const watchHand = () => {
    if (!hand) return;
    const t = tabs.get(hand.tab);
    if (!t || hand.win.isDestroyed?.()) return endHand("gone");
    if (pointerOver(hand.win, t)) {
      if (hand.awayFrom !== null) {
        hand.awayFrom = null;
        hand.said = 0;
        tellPane(hand.win, { state: "held", tab: hand.tab });
      }
      return;
    }
    if (hand.awayFrom === null) hand.awayFrom = clock();
    const left = HAND_MS - (clock() - hand.awayFrom);
    if (left <= 0) return endHand("over");
    const s = Math.ceil(left / 1000);
    if (s !== hand.said) {
      hand.said = s;
      tellPane(hand.win, { state: "away", tab: hand.tab, left: s });
    }
  };
  /** A key typed into the page in the developer's hand starts the 5 s again (BS-D11). @param {string} tab @param {any} input */
  const handKey = (tab, input) => {
    if (!hand || hand.tab !== tab || hand.awayFrom === null) return;
    if (!["rawKeyDown", "keyDown", "char"].includes(String(input?.type || ""))) return;
    hand.awayFrom = clock();
    hand.said = 0;
    watchHand();
  };

  /** @param {string} tab @param {any} wc */
  const guard = (tab, wc) => {
    /** @param {any} e @param {string} url */
    const stay = (e, url) => {
      const said = ownSaid(url);
      if (mayGo(url) && !said) return;
      e.preventDefault();
      send({ op: "note", tab, words: said || `The page tried to go to ${String(url).slice(0, 200)}; the browser opens web pages alone.` });
    };
    wc.on("will-navigate", stay);
    wc.on("will-redirect", stay);
    // A popup is a tab of the chat that opened it (BR-D12): the window is the app's to open, as a tab.
    wc.setWindowOpenHandler((/** @type {{ url: string }} */ { url }) => {
      const said = ownSaid(url);
      if (said) send({ op: "note", tab, words: said });
      else if (mayGo(url) && url !== "about:blank") void popup(tab, url);
      return { action: "deny" };
    });
    wc.on("render-process-gone", (/** @type {any} */ _e, /** @type {any} */ d) => gone(tab, `its page's process ended (${String(d?.reason || "gone")})`));
    if (menu) wc.on("context-menu", (/** @type {any} */ _e, /** @type {any} */ params) => menu(wc, params));
    // The proxy the profile sends its loopback to asks for its sign-in: given to it alone, the proxy's own. Any other
    // sign-in a page meets is the browser's default, refused.
    wc.on("login", (/** @type {any} */ e, /** @type {any} */ _d, /** @type {any} */ info, /** @type {(u: string, p: string) => void} */ answer) => {
      const p = proxied;
      if (!p || !info?.isProxy || String(info.host) !== "127.0.0.1" || Number(info.port) !== p.port) return;
      e.preventDefault();
      answer(p.user, p.password);
    });
  };
  /** @param {string} tab @param {string} why */
  const gone = (tab, why) => {
    if (!tabs.has(tab)) return;
    drop(tab);
    send({ op: "gone", tab, why });
  };

  /**
   * A new page: parked at its size (a laptop's, unless Filament names another), a blank page loaded, then its protocol
   * attached (it answers nothing before its first load) and told its size, and that it has the focus (a parked window
   * has none, and some pages wait for it).
   * @param {string} tab @param {{ width: number, height: number }} [size]
   */
  async function open(tab, size = PAGE_SIZE) {
    if (tabs.has(tab)) return null;
    const view = new WebContentsView({ webPreferences: { session: profile(), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: true } });
    const wc = view.webContents;
    /** @type {Page} */
    const t = { id: tab, view, wc, host: null, size: { width: size.width, height: size.height }, fit: false, scale: 1, rect: null, drawn: null, held: "", cast: null, castSeq: 0 };
    tabs.set(tab, t);
    parkOne(t);
    guard(tab, wc);
    // The developer's keys in the page hold it in their hand (BS-D11); the window's own keys are the window's.
    wc.on("input-event", (/** @type {any} */ _e, /** @type {any} */ input) => handKey(tab, input));
    wc.on("before-input-event", (/** @type {any} */ e, /** @type {any} */ input) => keys(t.host, e, input));
    try {
      await wc.loadURL("about:blank");
      wc.debugger.attach("1.3");
    } catch (/** @type {any} */ e) {
      drop(tab);
      throw new Error(`the app could not open a page (${String(e?.message || e)})`);
    }
    wc.debugger.on("message", (/** @type {any} */ _e, /** @type {string} */ method, /** @type {any} */ params) => {
      // The screencast's frames are the app's own to send, as frames: no event of the driver's.
      if (method === "Page.screencastFrame") return void screencastFrame(t, params);
      if (CDP_EVENTS.has(method) && tabs.get(tab) === t) send({ op: "event", tab, method, params });
    });
    wc.debugger.on("detach", (/** @type {any} */ _e, /** @type {string} */ why) => {
      if (tabs.get(tab) === t) gone(tab, `its page's protocol ended (${why})`);
    });
    await wc.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    hold(t, t.rect ? scaleIn(t.size, t.rect) : 1);
    return null;
  }
  /** @param {string} from @param {string} url */
  async function popup(from, url) {
    const tab = newId();
    // A popup takes the size of the page that opened it (BS case 22).
    const size = tabs.get(from)?.size || PAGE_SIZE;
    try {
      // Opened blank: Filament loads its address once the chat keeps it as a tab — one past the chat's tabs is closed
      // before anything of it reaches its site.
      await open(tab, size);
      send({ op: "popup", tab, from, url, width: size.width, height: size.height });
    } catch (/** @type {any} */ e) {
      log(`browser: a page's popup was not opened (${String(e?.message || e)})`);
    }
  }
  /** @param {string} tab */
  function drop(tab) {
    const t = tabs.get(tab);
    if (!t) return;
    castOff(t);
    tabs.delete(tab);
    leave(t);
    try {
      t.host?.contentView?.removeChildView(t.view);
    } catch {}
    try {
      if (t.wc.debugger.isAttached()) t.wc.debugger.detach();
    } catch {}
    try {
      if (!t.wc.isDestroyed()) t.wc.close();
    } catch {}
  }

  /**
   * A picture of the page at its own size. A parked page, held at scale 1, is Electron's capture as it is: it never
   * paints a frame for Chrome's own screenshot. A page drawn over a pane at another scale is painted by the override at
   * that scale into a surface of the page's size, so Electron's capture holds it shrunk into the corner — 41% of the
   * picture in a pane drawing it at 0.41 — or, drawn larger, cut off (the owner's look of 10-24; BS0 weighed only the
   * size): there Chrome's own screenshot, which draws the page at its size, is taken, its window showing. Where that
   * does not answer, a page drawn smaller is cut from Electron's capture by the scale; one drawn larger has no such cut.
   * @param {Page} t @param {number} end  when the capture's tries end
   */
  const pictureOf = async (t, end) => {
    const s = t.scale;
    if (!t.rect || t.fit || s === 1 || !nativeImage || !t.wc.debugger.isAttached()) return t.wc.capturePage();
    try {
      const ms = Math.max(1, Math.min(SHOT_MS, end - clock()));
      const shot = await Promise.race([
        t.wc.debugger.sendCommand("Page.captureScreenshot", { format: "png" }),
        wait(ms).then(() => { throw new Error(`Chrome's screenshot did not answer in ${ms / 1000} s`); }),
      ]);
      const img = nativeImage.createFromBuffer(Buffer.from(String(shot?.data || ""), "base64"));
      if (!img.isEmpty()) return img;
      throw new Error("Chrome's screenshot came back empty");
    } catch (/** @type {any} */ e) {
      if (s > 1) throw e;
      const img = await t.wc.capturePage();
      if (!img || img.isEmpty()) return img;
      const { width, height } = img.getSize();
      return img.crop({ x: 0, y: 0, width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) });
    }
  };

  /**
   * The page as the app paints it, JPEG at the size the driver asks (its CSS size, the long side kept to what a model
   * reads best), at the page's own size however the pane draws it (`pictureOf`). A capture refused or empty is asked
   * for again for `CAPTURE_TRY_MS` (a page just opened has not painted yet), then said with the app's own words.
   * @param {string} tab @param {number} width @param {number} height
   */
  async function capture(tab, width, height) {
    const t = tabs.get(tab);
    if (!t) throw new Error(`the app has no tab ${tab} now`);
    const end = clock() + CAPTURE_TRY_MS;
    for (;;) {
      /** @type {string} */
      let why;
      try {
        const img = await pictureOf(t, end);
        if (img && !img.isEmpty()) {
          const w = Math.max(1, Math.min(4096, Math.round(Number(width) || 0) || img.getSize().width));
          const h = Math.max(1, Math.min(4096, Math.round(Number(height) || 0) || img.getSize().height));
          return { data: img.resize({ width: w, height: h, quality: "good" }).toJPEG(70).toString("base64"), mediaType: "image/jpeg" };
        }
        why = "the page painted nothing to take a picture of";
      } catch (/** @type {any} */ e) {
        why = String(e?.message || e);
      }
      if (tabs.get(tab) !== t) throw new Error(`the app has no tab ${tab} now`);
      if (clock() >= end) throw new Error(`the app took no picture of the page in ${CAPTURE_TRY_MS / 1000} s: ${why}`);
      await wait(CAPTURE_STEP_MS);
    }
  }

  /**
   * A tab's size set (BS2's `resize`, the pane's size chip): its own, or the pane's (`fit`); drawn again where it
   * shows, parked at it where not. Its size as it holds it now.
   * @param {Page} t @param {any} m  `{ width, height }`, or `{ fit: true }`
   */
  function resize(t, m) {
    t.fit = m?.fit === true;
    if (!t.fit) t.size = pageSize(m?.width, m?.height);
    if (t.rect) drawOver(t, t.rect);
    else parkOne(t);
    return { width: t.size.width, height: t.size.height, fit: t.fit };
  }

  /**
   * One of Filament's words: `open` (at a size), `cdp`, `capture`, `size`, `cast` (`on`, or off), `close`, `clear`,
   * `own` (where Filament is reached now) — its answer, or a throw whose words Filament says.
   * @param {any} m
   */
  async function handle(m) {
    const tab = String(m?.tab || "");
    switch (m?.op) {
      case "open":
        return open(tab, pageSize(m.width, m.height));
      case "cdp": {
        const method = String(m.method || "");
        if (!CDP_METHODS.has(method)) throw new Error(`${method || "that"} is no command the agent's browser takes`);
        const t = tabs.get(tab);
        if (!t) throw new Error(`the app has no tab ${tab} now`);
        const params = m.params && typeof m.params === "object" ? m.params : {};
        // The agent's mouse at the page's own point: the protocol reads a mouse's point in the view's pixels, and the
        // view draws the page at its scale (BS0) — times the scale, it lands where the agent aimed. Its quads, its layout
        // and its keys are the page's own, as they are.
        const scaled = method === "Input.dispatchMouseEvent" && t.scale !== 1 ? { ...params, x: Number(params.x) * t.scale, y: Number(params.y) * t.scale } : params;
        return t.wc.debugger.sendCommand(method, scaled);
      }
      case "capture":
        return capture(tab, m.width, m.height);
      case "size": {
        const t = tabs.get(tab);
        if (!t) throw new Error(`the app has no tab ${tab} now`);
        return resize(t, m);
      }
      case "cast": {
        const t = tabs.get(tab);
        if (!t) throw new Error(`the app has no tab ${tab} now`);
        if (m.on === true) castOn(t);
        else castOff(t);
        return { casting: !!t.cast, way: t.cast?.way ?? null };
      }
      case "close":
        drop(tab);
        return null;
      case "clear": {
        const s = profile();
        await s.clearStorageData();
        await s.clearCache();
        await s.clearAuthCache?.();
        return null;
      }
      case "own": {
        // Where Filament is reached now (src/app/browser/host.js): no page of the profile reaches any of it.
        const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []);
        places = {
          ports: list(m.ports).map(Number).filter((p) => Number.isInteger(p) && p > 0),
          names: list(m.names).filter((n) => typeof n === "string"),
          origins: list(m.origins).filter((o) => typeof o === "string"),
        };
        return null;
      }
      default:
        throw new Error(`${String(m?.op || "that")} is nothing the app's browser does`);
    }
  }

  return {
    handle,
    /** The link went: Filament forgot the tabs, and so does the app. */
    closeAll() {
      for (const tab of [...tabs.keys()]) drop(tab);
    },
    /**
     * The profile's loopback sent to a proxy (lib/tunnel.js), `{ port, user, password }` — or, with null, to none. The
     * connections the profile holds are closed either way: none made the other way is used again.
     * @param {{ port: number, user: string, password: string } | null} conf
     */
    async proxy(conf) {
      // Its localhost is the proxy's once the profile sends it there, and no page's from the moment it no longer will.
      const turn = ++proxyTurn;
      if (!conf) proxied = null;
      const s = profile();
      await s.setProxy(conf ? proxyConfig(conf.port) : { mode: "direct" });
      // `setProxy` answers as the setting is written; the network takes it up as its proxy is reloaded.
      await s.forceReloadProxyConfig?.();
      await s.closeAllConnections?.();
      if (conf && turn === proxyTurn) proxied = conf;
    },
    /** Whether the profile's loopback goes to a proxy now. */
    proxying: () => !!proxied,
    /** Where Filament is reached now, as its link last said (`own`): no page of another machine's reaches it either. */
    places: () => places,
    /**
     * A tab's page over the pane of a window (the harness's), in `rect` in the window's units: drawn at its own size,
     * scaled to fit and centred (BS1); the window's other pages parked. `lock`: an agent drives it — the veil over it,
     * the developer's mouse reaching it through Take over alone (BS3), unless it is in their hand now. False for a tab
     * the app does not have.
     * @param {string} tab @param {any} win @param {Rect} rect @param {{ lock?: boolean }} [o]
     */
    place(tab, win, rect, o = {}) {
      const t = tabs.get(tab);
      if (!t || !win || win.isDestroyed()) return false;
      for (const x of tabs.values()) if (x !== t && x.host === win) parkOne(x);
      if (t.host !== win) {
        leave(t);
        win.contentView.addChildView(t.view);
        t.host = win;
      }
      drawOver(t, rect);
      if (hand && hand.win === win && hand.tab !== tab) endHand("gone");
      if (o.lock && !(hand && hand.win === win) && t.drawn) veil(win, t.drawn);
      else unveil(win);
      return true;
    },
    /**
     * The veil's Take over pressed: the page is the developer's, by hand — the veil off, the pane told (it takes the
     * chat's browser over at Filament), and the watch on: 5 s with the pointer off the page and no key, and it goes back
     * (BS-D10). False for a press that is no veil's of a page placed now.
     * @param {any} sender  the pressing page's webContents
     */
    veilPressed(sender) {
      const win = [...veils].find(([, v]) => v.webContents === sender)?.[0];
      const tab = win ? [...tabs].find(([, t]) => t.host === win && t.drawn)?.[0] : null;
      if (!win || !tab) return false;
      if (hand) endHand("off");
      unveil(win);
      hand = { win, tab, awayFrom: null, said: 0, timer: every(watchHand, HAND_TICK_MS) };
      tellPane(win, { state: "take", tab });
      return true;
    },
    /** A window closes: its pages parked, its veil let go, a hand on its page ended. @param {any} win */
    forgetWindow(win) {
      for (const t of tabs.values()) if (t.host === win) parkOne(t);
      if (hand && hand.win === win) endHand("gone");
      const v = veils.get(win);
      veils.delete(win);
      veiled.delete(win);
      try {
        if (v && !v.webContents.isDestroyed()) v.webContents.close();
      } catch {}
    },
    /** The hold ended at the pane — Give back pressed, or the browser given back another way: the watch stops. @param {any} win */
    handOff(win) {
      if (hand && hand.win === win) endHand("off");
    },
    /** The developer's hand now, for the tests and the log. */
    handOf: () => (hand ? { tab: hand.tab, away: hand.awayFrom !== null } : null),
    /** A tab's size as it holds it now, for the tests and the log. @param {string} tab */
    sizeOf: (tab) => {
      const t = tabs.get(tab);
      return t ? { width: t.size.width, height: t.size.height, fit: t.fit, scale: t.scale } : null;
    },
    /** How a tab is cast now — by Chrome's screencast or its pictures — or null, for the tests and the log. @param {string} tab */
    castOf: (tab) => {
      const c = tabs.get(tab)?.cast;
      return c ? { way: c.way } : null;
    },
    /** Every page a window shows, parked again (its pane hid, the window closes). @param {any} win */
    parkAll(win) {
      for (const t of tabs.values()) if (t.host === win) parkOne(t);
    },
    /**
     * The pages a window shows put back on top of its views, its veil over them: another machine's view was laid over
     * them as it came to the front (lib/rail.js `raise`), and these are that machine's pages, drawn over its pane.
     * @param {any} win
     */
    lift(win) {
      if (!win || win.isDestroyed()) return;
      for (const t of tabs.values()) if (t.host === win && t.drawn) win.contentView.addChildView(t.view);
      const v = veils.get(win);
      if (v && veiled.has(win)) win.contentView.addChildView(v);
    },
    /** The tabs the app holds, by id (for the tests and the log). */
    ids: () => [...tabs.keys()],
    /** The app quits: every page, the veils and the parking window go. */
    destroy() {
      endHand("off");
      for (const tab of [...tabs.keys()]) drop(tab);
      for (const v of veils.values()) {
        try {
          if (!v.webContents.isDestroyed()) v.webContents.close();
        } catch {}
      }
      veils.clear();
      veiled.clear();
      if (park && !park.isDestroyed()) park.destroy();
      park = null;
      ses?.removeListener?.("will-download", onDownload);
    },
  };
}

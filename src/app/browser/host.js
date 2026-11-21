// @ts-check
// What holds the agent's browser (HarnessV4_Browser_Plan BR-D2): a set of hosts, each holding pages the same way
// (`PageHost`) — the ops below, and the same events — and each by its key:
//   `here`         this machine's desktop app, over the link it dials into `/api/browser/host` (http/admin/browser.js),
//                  one app at a time, the newest wins;
//   `device:<id>`  a viewer's app: the desktop app of a paired full device that views this machine, one link per
//                  device, the newest wins (`attachViewer`, for the device's own socket);
//   `headless`     Chrome on this machine, run headless (headless-host.js, b-headless).
// A chat's new page opens on the app of whoever drives the chat while it is linked, else on this machine's app, else in
// Chrome where one was found (`choose`); every op on a tab after goes to the host that holds it (`call`'s `host`). Each
// host's word reaches the listeners tagged with its key, so a host that goes fails its own pages alone. An app that links
// in is told to the registry (`onLink`), which closes in Chrome the pages of the chats that app drives; Chrome stops once
// it holds no page while this machine's app is linked, as no chat's new page goes to it then.
// To an app, a request goes out numbered and comes back by its number; its events come by tab. A command the page does
// not answer in `ANSWER_MS` fails, said by name (a page that hangs the protocol, not a model's work: nothing of a
// model's waits on it); a host that goes fails what was waiting on it, in words.
//   Filament → app   { n, op: "open" | "cdp" | "capture" | "size" | "cast" | "close" | "clear", tab?, method?, params?,
//                   width?, height?, fit?, on? }  — `open` and `size` carry the page's own size (HarnessV4_BrowserSize_Plan
//                   BS1); `cast` starts (`on`) or stops a tab's frames, for a page that watches it with no app of its own
//                   ·  { n, op: "own", ports, names, origins }  — where Filament is reached now (core/browser.js
//                   `filamentsOwn`'s), which no page reaches: sent before a call where it changed, and as its doors move
//   app → Filament   { n, ok, result?, error? }  ·  { op: "hello", version? }  ·  { op: "event", tab, method, params }
//                   ·  { op: "popup", tab, from, url, width?, height? }  ·  { op: "gone", tab, why? }
//                   ·  { op: "note", tab, words }  ·  { op: "frame", tab, seq, data, width, height, way } — a cast's
//                   frame: the page as the app paints it, a JPEG in base64, the page's own size its points are in

export const ANSWER_MS = 60_000;
/** What a call says when neither an app nor Chrome holds the browser now. */
export const NO_HOST =
  "The browser is the Filament desktop app's, or Chrome on this machine, and neither is here now: no app is connected, and no Chrome or Chromium was found. The developer opens the desktop app (it connects by itself), or on a server installs Chromium (sudo apt install chromium) or sets FILAMENT_CHROME to Chrome's path and starts Filament again; or you do the work another way.";
/** What fails on an app's browser that went. */
const APP_GONE = "the app's browser went (the app quit or lost Filament)";
/** This machine's desktop app, among the hosts. */
export const HERE = "here";
/** Chrome on this machine, among the hosts. */
export const HEADLESS = "headless";
/** A viewer's app among the hosts: the desktop app of the paired full device `id`. @param {string} id */
export const deviceHost = (id) => `device:${id}`;

/**
 * @typedef {{ send: (msg: any) => void, close: () => void }} Link  the socket, as the host link writes and ends it
 * @typedef {(e: { op: string, host?: string, tab?: string, method?: string, params?: any, from?: string, url?: string, width?: number, height?: number, why?: string, words?: string, seq?: number, data?: string, way?: string }) => void} Listener
 *   what the pages' holder says unasked: a page's `event`, a `popup` it made a tab (at its opener's size), a tab
 *   `gone`, a `note` of what it refused a page, a cast's `frame`; and `lost` as its pages all go — from the host set,
 *   each with the key of the host it came from (`host`)
 * @typedef {{ readonly available: boolean, call: (op: string, payload?: Record<string, any>, o?: { signal?: AbortSignal | null, ms?: number }) => Promise<any>, on: (fn: Listener) => () => void }} PageHost
 *   what holds pages: whether it can now, one op and its answer (`ms` at the most, or `signal`'s stop), and its word
 *   unasked — an app over its link, and Chrome on this machine (headless-host.js), alike
 */

/**
 * The browser's hosts: this machine's app, the viewers' apps, and `chrome` where it is given and found one.
 * @param {{ log?: (level: string, line: string) => void, chrome?: (PageHost & { stop: (why?: string) => void, readonly pages?: number }) | null,
 *   places?: (() => { ports: number[], names: string[], origins: string[] }) | null }} [o]
 *   `chrome`: Chrome on this machine (headless-host.js `createHeadlessHost`); its `pages`, the tabs it holds. `places`:
 *   where Filament is reached now, told to each app that holds pages, whose pages reach none of it
 */
export function createBrowserHost({ log = () => {}, chrome = null, places = null } = {}) {
  const here = createAppLink({ log, name: "the desktop app's browser" });
  /** The viewers' apps, by their hosts' keys. @type {Map<string, ReturnType<typeof createAppLink>>} */
  const viewers = new Map();
  /** The places each linked app was last told, as JSON; none for an app not told yet. @type {WeakMap<object, string>} */
  const told = new WeakMap();
  /**
   * An app told where Filament is reached, where that changed since it was last told.
   * @param {ReturnType<typeof createAppLink>} app
   */
  const tellPlaces = (app) => {
    if (!places || !app.available) return;
    const now = places();
    const k = JSON.stringify(now);
    if (told.get(app) === k) return;
    told.set(app, k);
    // An app that knows no `own` refuses it: its own check, Filament's main port, holds there.
    void app.call("own", now).catch(() => {});
  };
  /** @type {Set<Listener>} */
  const listeners = new Set();
  /** @type {Set<(key: string) => void>} */
  const linkers = new Set();
  /** @param {any} e */
  const tell = (e) => {
    for (const fn of [...listeners]) {
      try {
        fn(e);
      } catch {}
    }
  };
  /** A host by its key; null for one not here. @param {string} key @returns {PageHost | null} */
  const hostOf = (key) => (key === HERE ? here : key === HEADLESS ? chrome : viewers.get(key) || null);
  /** Whether a host can hold pages now. @param {string | null | undefined} key */
  const linked = (key) => !!key && !!hostOf(key)?.available;
  /** Chrome stops once it holds no page while this machine's app is linked: no chat's new page goes to it then. */
  const idle = () => {
    if (chrome && here.available && !Number(chrome.pages)) chrome.stop("the desktop app connected: its browser holds the pages");
  };
  /** An app linked in: the registry hears it first, then Chrome may stop. @param {string} key */
  const linkedIn = (key) => {
    for (const fn of [...linkers]) {
      try {
        fn(key);
      } catch {}
    }
    idle();
  };
  here.on((e) => tell({ ...e, host: HERE }));
  chrome?.on((e) => {
    tell({ ...e, host: HEADLESS });
    if (e.op === "gone") idle();
  });
  /**
   * The host a chat's new page opens on: its driver's app while linked, else this machine's app, else Chrome where
   * found; null for none.
   * @param {string | null | undefined} driver  the key of the app of whoever drives the chat: HERE, or a device's
   */
  const choose = (driver) => {
    if (driver && driver !== HEADLESS && linked(driver)) return driver;
    if (here.available) return HERE;
    if (chrome?.available) return HEADLESS;
    return null;
  };
  return {
    /** Whether any host can hold pages now. */
    get available() {
      return here.available || [...viewers.values()].some((v) => v.available) || !!chrome?.available;
    },
    /** This machine's app's version. */
    get version() {
      return here.version;
    },
    choose,
    linked,
    /** A host's app's version: "" for Chrome, and for one not here. @param {string | null | undefined} key */
    versionOf: (key) => (key === HERE ? here.version : (key && viewers.get(key)?.version) || ""),
    /**
     * This machine's app connected: the registry hears it (`onLink`), and Chrome stops where it holds no page then.
     * @param {Link} l
     */
    attach(l) {
      const take = here.attach(l);
      told.delete(here);
      tellPlaces(here);
      linkedIn(HERE);
      return take;
    },
    /**
     * A viewer's app connected — the desktop app of the paired full device `deviceId`, over its own socket: it takes the
     * place of that device's link before it, and holds the pages of the chats that device drives.
     * @param {string} deviceId @param {Link} l
     */
    attachViewer(deviceId, l) {
      const key = deviceHost(deviceId);
      let v = viewers.get(key);
      if (!v) {
        const made = createAppLink({ log, name: `the browser of device ${deviceId}'s app` });
        made.on((e) => tell({ ...e, host: key }));
        viewers.set(key, made);
        v = made;
      }
      const take = v.attach(l);
      told.delete(v);
      tellPlaces(v);
      linkedIn(key);
      return take;
    },
    /** An app's socket closed: this machine's, or a viewer's. @param {Link} l */
    detach(l) {
      if (here.holds(l)) return here.detach(l);
      for (const [key, v] of viewers) {
        if (!v.holds(l)) continue;
        v.detach(l);
        viewers.delete(key);
        return;
      }
    },
    /**
     * One request to a host, its answer: the one `host` names, else the one a chat driven from here opens on.
     * @param {string} op @param {Record<string, any>} [payload]
     * @param {{ signal?: AbortSignal | null, ms?: number, host?: string | null }} [o]
     */
    call(op, payload = {}, { signal = null, ms = ANSWER_MS, host = choose(HERE) } = {}) {
      const h = host ? hostOf(host) : null;
      if (!h) return Promise.reject(new Error(!host || host === HERE || host === HEADLESS ? NO_HOST : APP_GONE));
      if (h !== chrome) tellPlaces(/** @type {ReturnType<typeof createAppLink>} */ (h));
      const p = h.call(op, payload, { signal, ms });
      if (host === HEADLESS && op === "close") p.then(idle, idle);
      return p;
    },
    /** Filament's doors moved: each linked app is told where it is reached now. */
    placesMoved() {
      tellPlaces(here);
      for (const v of viewers.values()) tellPlaces(v);
    },
    /** @param {Listener} fn @returns {() => void} */
    on(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    /** Told the key of each app that links in. @param {(key: string) => void} fn @returns {() => void} */
    onLink(fn) {
      linkers.add(fn);
      return () => void linkers.delete(fn);
    },
    /** Filament stops: Chrome with it. */
    stop() {
      chrome?.stop();
    },
  };
}

/**
 * An app's link: one app at a time, the newest wins.
 * @param {{ log: (level: string, line: string) => void, name: string }} o  `name`: the app's browser, as the log says it
 */
function createAppLink({ log, name }) {
  /** @type {Link | null} */
  let link = null;
  let version = "";
  let n = 0;
  /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, timer: any, what: string }>} */
  const pending = new Map();
  /** @type {Set<Listener>} */
  const listeners = new Set();
  /** @param {any} e */
  const tell = (e) => {
    for (const fn of [...listeners]) {
      try {
        fn(e);
      } catch {}
    }
  };
  /** Everything waiting on a link that went fails, said so. @param {string} why */
  const failAll = (why) => {
    for (const [k, p] of pending) {
      clearTimeout(p.timer);
      p.reject(new Error(why));
      pending.delete(k);
    }
  };

  return {
    get available() {
      return !!link;
    },
    get version() {
      return version;
    },
    /** Whether `l` is the link held now. @param {Link} l */
    holds: (l) => !!link && link === l,
    /**
     * A host connected: it takes the place of one before it, whose waiting requests fail.
     * @param {Link} l
     * @returns {(msg: any) => void}  what the socket hands each message it reads
     */
    attach(l) {
      if (link && link !== l) {
        const old = link;
        link = null;
        failAll("the app's browser connected again: what was under way there ended");
        tell({ op: "lost", why: "replaced" });
        try {
          old.close();
        } catch {}
      }
      link = l;
      log("info", `browser: ${name} connected`);
      return (msg) => {
        if (link !== l || !msg || typeof msg !== "object") return;
        if (typeof msg.n === "number") {
          const p = pending.get(msg.n);
          if (!p) return;
          pending.delete(msg.n);
          clearTimeout(p.timer);
          if (msg.ok) p.resolve(msg.result ?? null);
          else p.reject(new Error(String(msg.error || `${p.what} failed in the app`)));
          return;
        }
        if (msg.op === "hello") {
          version = String(msg.version || "");
          return;
        }
        // What the app refused a page (a download, an address that is no web page's) is said at the chat's next call; a
        // cast's frame goes to the pages that watch its chat's browser.
        if (msg.op === "event" || msg.op === "popup" || msg.op === "gone" || msg.op === "note" || msg.op === "frame") tell(msg);
      };
    },
    /** The host's socket closed. @param {Link} l */
    detach(l) {
      if (link !== l) return;
      link = null;
      failAll(APP_GONE);
      tell({ op: "lost", why: "gone" });
      log("info", `browser: ${name} went`);
    },
    /**
     * One request to the host, its answer.
     * @param {string} op @param {Record<string, any>} [payload] @param {{ signal?: AbortSignal | null, ms?: number }} [o]
     */
    call(op, payload = {}, { signal = null, ms = ANSWER_MS } = {}) {
      if (!link) return Promise.reject(new Error(NO_HOST));
      const k = ++n;
      const what = op === "cdp" ? String(payload.method || "a command") : op;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(k);
          reject(new Error(`the browser did not answer ${what} in ${Math.round(ms / 1000)} s`));
        }, ms);
        pending.set(k, { resolve, reject, timer, what });
        signal?.addEventListener(
          "abort",
          () => {
            if (!pending.has(k)) return;
            pending.delete(k);
            clearTimeout(timer);
            reject(new Error("stopped"));
          },
          { once: true },
        );
        try {
          /** @type {Link} */ (link).send({ n: k, op, ...payload });
        } catch (e) {
          pending.delete(k);
          clearTimeout(timer);
          reject(new Error(`the app's browser could not be reached: ${/** @type {any} */ (e)?.message || e}`));
        }
      });
    },
    /** @param {Listener} fn @returns {() => void} */
    on(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
  };
}

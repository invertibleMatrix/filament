// @ts-check
// The agent's browser where no desktop app holds it (b-headless): Chrome or Chromium on this machine, run headless with
// its protocol on a pipe (`--remote-debugging-pipe`: fd 3 into Chrome, fd 4 out of it, each message JSON ended by a
// NUL; no TCP port for anything else on the machine to reach). It serves the ops the app serves over its link
// (host.js): `open`, `cdp` (the driver's commands alone, core/browser.js `CDP_METHODS`, the app's own list), `capture`,
// `size`, `cast`, `close` and `clear`, and tells the same events. Chrome is found where `FILAMENT_CHROME` names it,
// else where it installs itself on this OS, else on the PATH; it starts at the first page and stops with Filament, one
// start at a time. It runs on a profile of its own — in the data folder, or a snap's own folder for a snap's Chromium —
// emptied as it starts: sign-ins last while it runs, and clearing the browser's data stops it. As the app's profile
// does, it grants no permission, takes no downloads, fails a certificate no one vouches for with no way on, ends a
// page's redirect to an address that is no web page's, and never reaches Filament's own address at any port it listens
// on — every http(s) request of every page waits on Filament first (the protocol's Fetch, browser-wide), and a page's
// own load refused is said to its tab's agent. A WebSocket is not held: Fetch sees none, and Chrome's blocked addresses
// (Network.setBlockedURLs) stop none either; Filament's sockets refuse it themselves — the run socket's and the
// terminal's an Origin that is not their own address, the browser host's any page's. Each tab is a window of its own,
// so none is hidden behind another; a page's popup is a tab of the chat that opened it, held before anything of it
// loads, as the app holds one. A cast is the tab's picture, a JPEG taken every `CAST_MS` and sent where it changed: no
// pane draws the page here. A page fits no pane either: `size` with `fit` keeps the page at its own size.
import { spawn as nodeSpawn } from "node:child_process";
import { accessSync, closeSync, constants, mkdirSync, openSync, readSync, realpathSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, resolve, win32 } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CDP_EVENTS, CDP_METHODS, PAGE_SIZE, pageSize } from "../../core/browser.js";
import { ANSWER_MS } from "./host.js";

/** Where the person names the Chrome to run: its whole path. */
export const CHROME_ENV = "FILAMENT_CHROME";
/** The names Chrome and Chromium go by on the PATH. */
export const CHROME_NAMES = Object.freeze(["google-chrome", "chromium", "chromium-browser"]);
/** The profile's folder in the data folder. */
const PROFILE = "headless-chrome";
/** How long Chrome is given to answer as it starts. */
export const START_MS = 20_000;
/** How long a Chrome asked to end (SIGTERM) is given before it is made to (SIGKILL). */
export const KILL_MS = 3000;
/** How long a search that found no Chrome holds: the next look after it finds one installed meanwhile. */
export const FIND_AGAIN_MS = 30_000;
/** A popup that loads no page — a window opened blank — is closed after this. */
const POPUP_MS = 3000;
/** How often a cast tab's picture is taken. */
export const CAST_MS = 250;
const CAST_QUALITY = 60;
/** A cast frame's long side at the most, in pixels. */
const CAST_LONG = 1600;
const SHOT_QUALITY = 70;
/** How much of what Chrome printed is kept, for the words of a start that failed. */
const ERR_KEPT = 2000;
/**
 * Chrome's switches: headless on its pipe, none of a person's Chrome's own work (sync, extensions, updates, first-run
 * pages), no prompt a page could raise, and no tab slowed for being out of sight.
 */
export const CHROME_ARGS = Object.freeze([
  "--headless=new",
  "--remote-debugging-pipe",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-extensions",
  "--disable-component-extensions-with-background-pages",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-sync",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--deny-permission-prompts",
  "--password-store=basic",
  "--use-mock-keychain",
  "--mute-audio",
]);

/** The headless browser's profile in a data folder. @param {string} dataDir */
export const profileOf = (dataDir) => join(dataDir, PROFILE);

/**
 * Whether a Chrome is a snap's (Ubuntu's Chromium, `apt install chromium` there): its path, or the file it links to,
 * under /snap/, or a script that runs one from there (Ubuntu's chromium-browser).
 * @param {string} path
 */
export function snapChrome(path) {
  if (path.startsWith("/snap/")) return true;
  try {
    if (realpathSync(path).startsWith("/snap/")) return true;
    const fd = openSync(path, "r");
    try {
      const head = Buffer.alloc(4096);
      const text = head.subarray(0, readSync(fd, head, 0, head.length, 0)).toString("latin1");
      return text.startsWith("#!") && text.includes("/snap/bin/");
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

/**
 * The profile the Chrome at `path` runs on: in the data folder — or, for a snap's, which may write in no hidden folder
 * of the home (the data folder is one, ~/.config/filament), in the snap's own folder there, one for each data folder.
 * @param {string} dataDir @param {string} path @param {string} [home]
 */
export function profileFor(dataDir, path, home = homedir()) {
  if (!snapChrome(path)) return profileOf(dataDir);
  const mark = createHash("sha256").update(resolve(dataDir)).digest("hex").slice(0, 8);
  return join(home, "snap", "chromium", "common", `filament-${PROFILE}-${mark}`);
}

/** Whether a file is there and may be run. @param {string} p @param {string} [platform] */
export function runnable(p, platform = process.platform) {
  try {
    if (!statSync(p).isFile()) return false;
    if (platform !== "win32") accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Where Chrome, Chromium or Edge (a Chromium too) install themselves on an OS, the likeliest first.
 * @param {string} platform @param {Record<string, string | undefined>} env
 */
function installPaths(platform, env) {
  if (platform === "win32") {
    const bases = [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA].filter((b) => !!b);
    return [
      ...bases.map((b) => win32.join(String(b), "Google", "Chrome", "Application", "chrome.exe")),
      ...(env.LOCALAPPDATA ? [win32.join(env.LOCALAPPDATA, "Chromium", "Application", "chrome.exe")] : []),
      ...bases.map((b) => win32.join(String(b), "Microsoft", "Edge", "Application", "msedge.exe")),
    ];
  }
  if (platform === "darwin") {
    const apps = ["Google Chrome.app/Contents/MacOS/Google Chrome", "Chromium.app/Contents/MacOS/Chromium", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"];
    return [...apps.map((a) => `/Applications/${a}`), ...(env.HOME ? apps.map((a) => posix.join(String(env.HOME), "Applications", a)) : [])];
  }
  return ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium", "/opt/google/chrome/chrome"];
}

/**
 * The Chrome to run: the path `FILAMENT_CHROME` names, else where Chrome, Chromium or Edge install themselves on this
 * OS, else google-chrome, chromium or chromium-browser on the PATH — or "" where there is none.
 * @param {{ env?: Record<string, string | undefined>, platform?: string, exists?: (p: string) => boolean }} [o]
 *   `exists`: whether a file is there to run (the tests' stand-in)
 */
export function findChrome({ env = process.env, platform = process.platform, exists = (p) => runnable(p, platform) } = {}) {
  const named = String(env[CHROME_ENV] || "").trim();
  if (named && exists(named)) return named;
  for (const p of installPaths(platform, env)) if (exists(p)) return p;
  const path = platform === "win32" ? win32 : posix;
  const dirs = String(env.PATH ?? env.Path ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  for (const name of CHROME_NAMES)
    for (const dir of dirs) {
      const p = path.join(dir, platform === "win32" ? `${name}.exe` : name);
      if (exists(p)) return p;
    }
  return "";
}

/** What a tab's agent is told of a page that tried for Filament's own address. @param {string} url */
const ownWords = (url) => `The page tried to go to ${url.slice(0, 200)}, Filament's own address; the browser never opens it.`;
/** What it is told of a page that tried for an address that is no web page's, as the app tells it. @param {string} url */
const notWebWords = (url) => `The page tried to go to ${url.slice(0, 200)}; the browser opens web pages alone.`;
/** A web page's address, as the app's browser goes to (desktop/lib/browser-host.js `mayGo`). @param {string} url */
const webPage = (url) => /^https?:\/\//i.test(url) || url === "about:blank";
/** @param {unknown} e */
const said = (e) => String(/** @type {any} */ (e)?.message || e);
/** What a start a stop ended says. */
const STOPPED = "Chrome on this machine was stopped as it started";

/**
 * @typedef {{ width: number, height: number }} Size
 * @typedef {{ last: string, timer: any, said: boolean }} Cast  a tab's cast: the last picture sent, the next's timer,
 *   and whether a picture not taken was logged
 * @typedef {{ id: string, target: string, session: string, size: Size, cast: Cast | null, seq: number }} Page  a tab:
 *   its id as Filament names it, Chrome's target and the protocol's session on it, its own size, and its cast
 * @typedef {{ proc: any, send: (method: string, params?: any, session?: string) => Promise<any>, gone: boolean, first: string[],
 *   pending: Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }> }} Browser  Chrome running: its
 *   process, a command to it, whether it ended, the windows it started with (closed once a tab of Filament's is open),
 *   and the commands it has not answered
 */

/**
 * Chrome on this machine as a host of the agent's pages (host.js `PageHost`).
 * @param {{ dataDir: string, own?: (url: string) => boolean, log?: (level: string, line: string) => void, find?: () => string,
 *   spawn?: (command: string, args: string[], o: any) => any, newId?: () => string, clock?: () => number, home?: string }} o
 *   `own`: whether an address is Filament's own (core/browser.js `filamentsOwn`); `find`: the Chrome to run, "" for
 *   none (`findChrome`); `spawn`: how it is started, `home`: where a snap's Chrome keeps its profile — the tests' stand-ins
 */
export function createHeadlessHost({ dataDir, own = () => false, log = () => {}, find = () => findChrome(), spawn = nodeSpawn, newId = () => `t-${randomUUID().slice(0, 8)}`, clock = Date.now, home = homedir() }) {
  let found = { path: "", at: -Infinity };
  /** @type {Browser | null} */
  let chrome = null;
  /** The start the calls wait on, while one is under way and not stopped. @type {Promise<Browser> | null} */
  let starting = null;
  /** The last start: stopped by a stop, and its Chrome once it runs, which a stop ends. @type {{ stopped: boolean, b: Browser | null } | null} */
  let run = null;
  /** The last start's end, whichever way it went: the next start waits for it, so one starts at a time. @type {Promise<unknown>} */
  let lastStart = Promise.resolve();
  /** The last Chrome's end, waited for before the next starts on the same profile. @type {Promise<void>} */
  let ended = Promise.resolve();
  /** @type {Map<string, Page>} */
  const tabs = new Map();
  /** Popups held before their load, by their target: the tab that opened each, and the close of one that loads none. */
  const holds = /** @type {Map<string, { from: string, timer: any }>} */ (new Map());
  /** @type {Set<(e: any) => void>} */
  const listeners = new Set();
  /** @param {any} e */
  const tell = (e) => {
    for (const fn of [...listeners]) {
      try {
        fn(e);
      } catch {}
    }
  };

  /** The Chrome to run, looked for again only `FIND_AGAIN_MS` after a search that found none. */
  const chromePath = () => {
    if (found.path || clock() - found.at < FIND_AGAIN_MS) return found.path;
    found = { path: String(find() || ""), at: clock() };
    if (found.path) log("info", `browser: Chrome on this machine holds the agent's pages while no desktop app does (${found.path})`);
    return found.path;
  };
  /** @param {string} target */
  const pageOfTarget = (target) => [...tabs.values()].find((t) => t.target === target) || null;
  /** @param {string} session */
  const pageOfSession = (session) => [...tabs.values()].find((t) => t.session === session) || null;
  /** @param {string} tab */
  const pageOf = (tab) => {
    const t = tabs.get(tab);
    if (!t || !chrome) throw new Error(`Chrome on this machine has no tab ${tab} now`);
    return { t, b: chrome };
  };

  /** @param {Page} t */
  const castOff = (t) => {
    if (t.cast) clearTimeout(t.cast.timer);
    t.cast = null;
  };
  /** A tab gone from Chrome by itself (closed, crashed): forgotten, and said. @param {Page} t @param {string} why */
  const gone = (t, why) => {
    if (tabs.get(t.id) !== t) return;
    castOff(t);
    tabs.delete(t.id);
    tell({ op: "gone", tab: t.id, why });
  };
  /**
   * Chrome gone, by its own end or a stop: what waited on it fails, said, its tabs and holds forgotten — and a word to
   * the registry that they went, where there were any.
   * @param {Browser} b @param {string} why
   */
  const letGo = (b, why) => {
    if (!b.gone) {
      b.gone = true;
      for (const p of b.pending.values()) p.reject(new Error(why));
      b.pending.clear();
    }
    if (chrome !== b) return;
    chrome = null;
    const had = tabs.size > 0;
    for (const t of tabs.values()) castOff(t);
    tabs.clear();
    for (const h of holds.values()) clearTimeout(h.timer);
    holds.clear();
    if (had) tell({ op: "lost", why: "gone" });
  };
  /** The Chromes being ended, each once. @type {WeakSet<any>} */
  const ending = new WeakSet();
  /** A Chrome ended: asked to (SIGTERM), and made to (SIGKILL) where it has not gone in `KILL_MS`. @param {any} proc */
  const endChrome = (proc) => {
    if (ending.has(proc) || proc.exitCode !== null || proc.signalCode !== null) return;
    ending.add(proc);
    const timer = setTimeout(() => {
      if (proc.exitCode !== null || proc.signalCode !== null) return;
      try {
        proc.kill("SIGKILL");
      } catch {}
    }, KILL_MS);
    timer.unref?.();
    proc.once("exit", () => clearTimeout(timer));
    try {
      proc.kill();
    } catch {}
  };

  /**
   * A request of a page's, held by Fetch until Filament says: Filament's own address refused (a page's own load there
   * said to its tab's agent), a popup's own load ended before it goes out — its address a tab of the chat's —, any other
   * let through. A page's load is held again as its answer comes: one that sends it on to an address that is no web
   * page's (mailto:, an app's own scheme) is ended there, said, so no program outside the browser is handed it.
   * @param {Browser} b @param {any} p  `Fetch.requestPaused`'s params
   */
  const paused = (b, p) => {
    const url = String(p?.request?.url || "");
    const requestId = p?.requestId;
    const fail = (/** @type {string} */ errorReason) => void b.send("Fetch.failRequest", { requestId, errorReason }).catch(() => {});
    const doc = p?.resourceType === "Document";
    if (p?.responseStatusCode !== undefined || p?.responseErrorReason !== undefined) {
      const status = Number(p.responseStatusCode);
      const location = status >= 300 && status < 400 ? (Array.isArray(p.responseHeaders) ? p.responseHeaders : []).find((/** @type {any} */ h) => String(h?.name).toLowerCase() === "location")?.value : "";
      const to = location && URL.canParse(String(location), url) ? new URL(String(location), url).href : "";
      if (to && !webPage(to)) {
        fail("BlockedByClient");
        const t = pageOfTarget(String(p.frameId));
        if (t) tell({ op: "note", tab: t.id, words: notWebWords(to) });
        return;
      }
      return void b.send("Fetch.continueRequest", { requestId }).catch(() => {});
    }
    const hold = doc ? holds.get(String(p.frameId)) : undefined;
    if (hold) {
      holds.delete(String(p.frameId));
      clearTimeout(hold.timer);
      fail("Aborted");
      void b.send("Target.closeTarget", { targetId: String(p.frameId) }).catch(() => {});
      if (own(url)) tell({ op: "note", tab: hold.from, words: ownWords(url) });
      else if (/^https?:\/\//i.test(url) && tabs.has(hold.from)) void popup(hold.from, url);
      return;
    }
    if (own(url)) {
      fail("BlockedByClient");
      const t = doc ? pageOfTarget(String(p.frameId)) : null;
      if (t) tell({ op: "note", tab: t.id, words: ownWords(url) });
      return;
    }
    void b.send("Fetch.continueRequest", { requestId }).catch(() => {});
  };

  /**
   * What Chrome says unasked: the browser's own word (a request held, a target made or ended, a download), or a page's
   * — the driver's events, and its end.
   * @param {Browser} b @param {any} m
   */
  const heard = (b, m) => {
    const p = m.params || {};
    if (m.method === "Security.certificateError") return void b.send("Security.handleCertificateError", { eventId: p.eventId, action: "cancel" }, String(m.sessionId || "")).catch(() => {});
    if (m.sessionId) {
      const t = pageOfSession(String(m.sessionId));
      if (!t) return;
      if (CDP_EVENTS.has(m.method)) tell({ op: "event", tab: t.id, method: m.method, params: p });
      else if (m.method === "Inspector.targetCrashed") gone(t, "its page's process ended (crashed)");
      // A link, a script or a form that asks for an address that is no web page's: no request of it reaches Fetch, and
      // headless Chrome opens no app for it on a profile that allowed none — said to the tab's agent, as the app says it.
      else if (m.method === "Page.frameRequestedNavigation" && !webPage(String(p.url || ""))) tell({ op: "note", tab: t.id, words: notWebWords(String(p.url || "")) });
      return;
    }
    switch (m.method) {
      case "Fetch.requestPaused":
        return paused(b, p);
      case "Target.targetCreated": {
        // A page a tab of Filament's opened: held until its own load, which is ended there; one that loads none goes.
        const info = p.targetInfo || {};
        const from = info.type === "page" && info.openerId ? pageOfTarget(String(info.openerId)) : null;
        if (!from) return;
        const targetId = String(info.targetId);
        const timer = setTimeout(() => {
          if (!holds.delete(targetId)) return;
          void b.send("Target.closeTarget", { targetId }).catch(() => {});
        }, POPUP_MS);
        timer.unref?.();
        holds.set(targetId, { from: from.id, timer });
        return;
      }
      case "Target.targetDestroyed": {
        const t = pageOfTarget(String(p.targetId));
        if (t) gone(t, "its page closed");
        return;
      }
      case "Target.targetCrashed": {
        const t = pageOfTarget(String(p.targetId));
        if (t) gone(t, `its page's process ended (${String(p.status || "crashed")})`);
        return;
      }
      case "Target.detachedFromTarget": {
        const t = pageOfSession(String(p.sessionId));
        if (t) gone(t, "its page's protocol ended");
        return;
      }
      case "Browser.downloadWillBegin": {
        const t = pageOfTarget(String(p.frameId));
        const name = String(p.suggestedFilename || p.url || "a file").slice(0, 200);
        if (t) tell({ op: "note", tab: t.id, words: `The page started a download (${name}); the browser takes no downloads, so it was not kept.` });
      }
    }
  };

  /**
   * Chrome started on its pipe, on a profile emptied first, and told what its pages may not do — or why not, in words.
   * A stop on the way (`r`) ends the start there, and its Chrome with it.
   * @param {string} path @param {{ stopped: boolean, b: Browser | null }} r @param {Promise<unknown>} before  the start before it
   * @returns {Promise<Browser>}
   */
  async function launch(path, r, before) {
    // One start at a time, and the Chrome before it gone — a stop asks it to end, and makes it past `KILL_MS` — before
    // this one takes its profile.
    await before;
    const went = await Promise.race([ended.then(() => true), new Promise((done) => setTimeout(() => done(false), KILL_MS * 3).unref())]);
    if (!went) log("warn", "browser: the Chrome before did not end; its profile is emptied all the same");
    if (r.stopped) throw new Error(STOPPED);
    const profile = profileFor(dataDir, path, home);
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch (e) {
      log("warn", `browser: Chrome's profile was not emptied (${said(e)})`);
    }
    mkdirSync(profile, { recursive: true });
    // Chrome refuses to run as root with its sandbox on: a server's root runs it with the sandbox off.
    const args = [...CHROME_ARGS, `--user-data-dir=${profile}`, `--window-size=${PAGE_SIZE.width},${PAGE_SIZE.height}`, ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []), "about:blank"];
    /** @type {any} */
    let proc;
    try {
      proc = spawn(path, args, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], windowsHide: true });
    } catch (e) {
      found = { path: "", at: -Infinity };
      throw new Error(`Chrome on this machine (${path}) did not start: ${said(e)}`);
    }
    const input = /** @type {import("node:stream").Writable} */ (proc.stdio[3]);
    const output = /** @type {import("node:stream").Readable} */ (proc.stdio[4]);
    let printed = "";
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (/** @type {string} */ d) => void (printed = (printed + d).slice(-ERR_KEPT)));
    let n = 0;
    /** @type {Browser} */
    const b = {
      proc,
      gone: false,
      first: [],
      pending: new Map(),
      send: (method, params = {}, session = "") =>
        new Promise((resolve, reject) => {
          if (b.gone) return reject(new Error("Chrome on this machine stopped"));
          const id = ++n;
          b.pending.set(id, { resolve, reject });
          try {
            input.write(`${JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })}\0`);
          } catch (e) {
            b.pending.delete(id);
            reject(new Error(`Chrome on this machine could not be reached: ${said(e)}`));
          }
        }),
    };
    r.b = b;
    ended = new Promise((resolve) => proc.once("exit", () => resolve(undefined)));
    proc.once("exit", (/** @type {number | null} */ code, /** @type {string | null} */ signal) => {
      if (chrome === b) log("warn", `browser: Chrome on this machine ended (${signal || `exit ${code}`})`);
      letGo(b, `Chrome on this machine ended (${signal || `exit ${code}`})`);
    });
    proc.once("error", (/** @type {any} */ e) => letGo(b, `Chrome on this machine did not run: ${said(e)}`));
    input.on("error", () => {});
    output.on("error", () => {});
    /** One message of Chrome's: a command's answer, or its word unasked. @param {string} text */
    const took = (text) => {
      /** @type {any} */
      let m;
      try {
        m = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof m?.id === "number") {
        const p = b.pending.get(m.id);
        if (!p) return;
        b.pending.delete(m.id);
        if (m.error) p.reject(new Error(String(m.error.message || "Chrome refused the command")));
        else p.resolve(m.result ?? {});
      } else if (m && typeof m.method === "string") heard(b, m);
    };
    output.setEncoding("utf8");
    // What came since the last NUL, in its pieces, joined once its NUL arrives: each piece is read once, so a long
    // message — a page's tree, a picture — costs its length, however many pieces it comes in.
    /** @type {string[]} */
    let parts = [];
    output.on("data", (/** @type {string} */ d) => {
      let from = 0;
      for (let i = d.indexOf("\0"); i >= 0; i = d.indexOf("\0", from)) {
        parts.push(d.slice(from, i));
        from = i + 1;
        const text = parts.join("");
        parts = [];
        took(text);
      }
      if (from < d.length) parts.push(d.slice(from));
    });
    try {
      /** @type {any} */
      let timer;
      await Promise.race([
        b.send("Browser.getVersion"),
        new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`it did not answer in ${START_MS / 1000} s`)), START_MS))),
      ]).finally(() => clearTimeout(timer));
      // Every http(s) request of every page waits on Filament first, and a page's load again as its answer comes
      // (`paused`); a WebSocket does not.
      await b.send("Fetch.enable", { patterns: [{ urlPattern: "*" }, { urlPattern: "*", resourceType: "Document", requestStage: "Response" }] });
      await b.send("Browser.setDownloadBehavior", { behavior: "deny", eventsEnabled: true });
      // Every permission this Chrome knows refused, for every site: the protocol's grant of none denies all the others.
      await b.send("Browser.grantPermissions", { permissions: [] });
      await b.send("Target.setDiscoverTargets", { discover: true });
      const targets = await b.send("Target.getTargets").catch(() => null);
      b.first = (targets?.targetInfos || []).filter((/** @type {any} */ x) => x.type === "page").map((/** @type {any} */ x) => String(x.targetId));
    } catch (e) {
      letGo(b, "Chrome on this machine did not start");
      endChrome(proc);
      if (r.stopped) throw new Error(STOPPED);
      // Looked for again at the next read: a Chrome that went is found gone, one still there is tried again.
      found = { path: "", at: -Infinity };
      const tail = printed.trim().split("\n").slice(-3).join(" ").slice(-400);
      throw new Error(`Chrome on this machine (${path}) did not start: ${said(e)}${tail ? ` — it said: ${tail}` : ""}`);
    }
    if (r.stopped || b.gone) {
      endChrome(proc);
      throw new Error(STOPPED);
    }
    chrome = b;
    log("info", `browser: Chrome on this machine started (${path})`);
    return b;
  }

  /** Chrome, running: started at the first page that needs it, one start at a time. */
  function ready() {
    if (chrome && !chrome.gone) return Promise.resolve(chrome);
    if (!starting) {
      const path = chromePath();
      if (!path) return Promise.reject(new Error(`no Chrome or Chromium was found on this machine (${CHROME_ENV} names one)`));
      /** @type {{ stopped: boolean, b: Browser | null }} */
      const r = { stopped: false, b: null };
      run = r;
      const s = launch(path, r, lastStart).finally(() => {
        if (starting === s) starting = null;
      });
      lastStart = s.catch(() => {});
      starting = s;
    }
    return starting;
  }

  /** The size a page lays itself out at, at one device pixel per CSS pixel. @param {Size} s */
  const metricsOf = (s) => ({ width: s.width, height: s.height, deviceScaleFactor: 1, mobile: false });

  /**
   * A new tab: a window of its own at its size, blank, its protocol attached and told its size and that it has the
   * focus (a window no one looks at has none, and some pages wait for it). Chrome's own first window goes once one of
   * Filament's is open.
   * @param {string} tab @param {Size} size
   */
  async function open(tab, size) {
    if (tabs.has(tab)) return null;
    const b = await ready();
    const made = await b.send("Target.createTarget", { url: "about:blank", newWindow: true, width: size.width, height: size.height });
    /** @type {Page} */
    const t = { id: tab, target: String(made?.targetId || ""), session: "", size: { ...size }, cast: null, seq: 0 };
    tabs.set(tab, t);
    try {
      const at = await b.send("Target.attachToTarget", { targetId: t.target, flatten: true });
      t.session = String(at?.sessionId || "");
      // A certificate no one vouches for fails the load, as in the app: Chrome asks Filament, which cancels it (`heard`),
      // so its warning, with its way on, never shows.
      await b.send("Security.enable", {}, t.session);
      await b.send("Security.setOverrideCertificateErrors", { override: true }, t.session);
      // A navigation the page asks for is heard (`heard`), whatever the driver turns on.
      await b.send("Page.enable", {}, t.session);
      await b.send("Emulation.setDeviceMetricsOverride", metricsOf(t.size), t.session);
      await b.send("Emulation.setFocusEmulationEnabled", { enabled: true }, t.session).catch(() => {});
    } catch (e) {
      if (tabs.get(tab) === t) tabs.delete(tab);
      void b.send("Target.closeTarget", { targetId: t.target }).catch(() => {});
      throw new Error(`Chrome on this machine could not open a page (${said(e)})`);
    }
    for (const targetId of b.first.splice(0)) void b.send("Target.closeTarget", { targetId }).catch(() => {});
    return null;
  }

  /** A popup of a tab's, as a tab of the chat at its opener's size: opened blank, its address loaded once the chat keeps it. @param {string} from @param {string} url */
  async function popup(from, url) {
    const tab = newId();
    const size = tabs.get(from)?.size || PAGE_SIZE;
    try {
      await open(tab, size);
      tell({ op: "popup", tab, from, url, width: size.width, height: size.height });
    } catch (e) {
      log("warn", `browser: a page's popup was not opened (${said(e)})`);
    }
  }

  /**
   * The page as it shows now, a JPEG, its width `width` (the page's own where none is asked), the height in keeping.
   * @param {Page} t @param {Browser} b @param {unknown} width @param {number} quality
   */
  async function picture(t, b, width, quality) {
    const m = await b.send("Page.getLayoutMetrics", {}, t.session);
    const vp = m?.cssVisualViewport || m?.cssLayoutViewport || {};
    const w = Math.max(1, Number(vp.clientWidth) || t.size.width);
    const h = Math.max(1, Number(vp.clientHeight) || t.size.height);
    const scale = Math.min(4, Math.max(0.05, (Number(width) || w) / w));
    const r = await b.send("Page.captureScreenshot", { format: "jpeg", quality, clip: { x: Number(vp.pageX) || 0, y: Number(vp.pageY) || 0, width: w, height: h, scale } }, t.session);
    if (!r?.data) throw new Error("Chrome took no picture of the page");
    return String(r.data);
  }

  /** A tab cast: its picture now, then every `CAST_MS`, each sent where it changed. @param {Page} t */
  function castOn(t) {
    if (t.cast) return;
    /** @type {Cast} */
    const c = { last: "", timer: null, said: false };
    t.cast = c;
    const next = async () => {
      if (t.cast !== c || tabs.get(t.id) !== t || !chrome) return;
      try {
        const k = Math.min(1, CAST_LONG / Math.max(t.size.width, t.size.height));
        const data = await picture(t, chrome, Math.round(t.size.width * k), CAST_QUALITY);
        if (t.cast === c && data !== c.last) {
          c.last = data;
          tell({ op: "frame", tab: t.id, seq: ++t.seq, data, width: t.size.width, height: t.size.height, way: "shots" });
        }
      } catch (e) {
        // Said once a cast: a page that has not painted yet is asked again at the next.
        if (!c.said) log("warn", `browser: a cast page's picture was not taken (${said(e)})`);
        c.said = true;
      }
      if (t.cast === c) c.timer = setTimeout(next, CAST_MS);
    };
    void next();
  }

  /**
   * The browser's data cleared: Chrome stops, its tabs said gone (`lost`), and its profile — cookies, sign-ins, every
   * origin's storage, partitioned or not, the cache — is emptied as it starts again at the agents' next call.
   */
  function clear() {
    stop("the browser's data was cleared");
    return null;
  }

  /** One of the host's ops, its answer. @param {string} op @param {Record<string, any>} m */
  async function handle(op, m) {
    const tab = String(m.tab || "");
    switch (op) {
      case "open":
        return open(tab, pageSize(m.width, m.height));
      case "cdp": {
        const method = String(m.method || "");
        if (!CDP_METHODS.has(method)) throw new Error(`${method || "that"} is no command the agent's browser takes`);
        const { t, b } = pageOf(tab);
        return b.send(method, m.params && typeof m.params === "object" ? m.params : {}, t.session);
      }
      case "capture": {
        const { t, b } = pageOf(tab);
        return { data: await picture(t, b, m.width, SHOT_QUALITY), mediaType: "image/jpeg" };
      }
      case "size": {
        const { t, b } = pageOf(tab);
        if (m.fit !== true) {
          t.size = pageSize(m.width, m.height);
          await b.send("Emulation.setDeviceMetricsOverride", metricsOf(t.size), t.session);
        }
        return { width: t.size.width, height: t.size.height, fit: false };
      }
      case "cast": {
        const { t } = pageOf(tab);
        if (m.on === true) castOn(t);
        else castOff(t);
        return { casting: !!t.cast, way: t.cast ? "shots" : null };
      }
      case "close": {
        const t = tabs.get(tab);
        if (!t) return null;
        castOff(t);
        tabs.delete(tab);
        if (chrome) void chrome.send("Target.closeTarget", { targetId: t.target }).catch(() => {});
        return null;
      }
      case "clear":
        return clear();
      default:
        throw new Error(`${op || "that"} is nothing Chrome on this machine does`);
    }
  }

  /**
   * Chrome stopped — Filament stops, or it holds no page while the desktop app is linked (host.js): what waited on it
   * fails in `why`'s words, and its tabs go, said (`lost`).
   * @param {string} [why]
   */
  function stop(why = "Chrome on this machine was stopped") {
    starting = null;
    const r = run;
    if (r && !r.stopped) {
      r.stopped = true;
      // A start under way ends here: what it waits on fails, and its Chrome, if it runs yet, is ended.
      if (r.b && r.b !== chrome) {
        letGo(r.b, STOPPED);
        endChrome(r.b.proc);
      }
    }
    const b = chrome;
    if (!b) return;
    letGo(b, why);
    endChrome(b.proc);
  }

  return {
    /** Chrome found on this machine, or running: the pages are there to open. */
    get available() {
      return !!chrome || !!chromePath();
    },
    /** The tabs it holds now: none once Chrome stopped. */
    get pages() {
      return tabs.size;
    },
    /**
     * One op, its answer — `ms` at the most (Chrome's start within it), or `signal`'s stop.
     * @param {string} op @param {Record<string, any>} [payload] @param {{ signal?: AbortSignal | null, ms?: number }} [o]
     */
    call(op, payload = {}, { signal = null, ms = ANSWER_MS } = {}) {
      const what = op === "cdp" ? String(payload.method || "a command") : op;
      return new Promise((resolve, reject) => {
        let done = false;
        const end = () => {
          done = true;
          clearTimeout(timer);
          signal?.removeEventListener("abort", stopped);
        };
        const timer = setTimeout(() => {
          if (done) return;
          end();
          reject(new Error(`the browser did not answer ${what} in ${Math.round(ms / 1000)} s`));
        }, ms);
        const stopped = () => {
          if (done) return;
          end();
          reject(new Error("stopped"));
        };
        signal?.addEventListener("abort", stopped, { once: true });
        handle(op, payload).then(
          (v) => {
            if (done) return;
            end();
            resolve(v);
          },
          (e) => {
            if (done) return;
            end();
            reject(e instanceof Error ? e : new Error(said(e)));
          },
        );
      });
    },
    /** @param {(e: any) => void} fn @returns {() => void} */
    on(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    stop,
  };
}

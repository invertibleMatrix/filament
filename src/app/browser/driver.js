// @ts-check
// One tab of the agent's browser, driven over Chrome's protocol (HarnessV4_Browser_Plan BR1): the app holds the page
// (desktop/lib/browser-host.js) and relays each command; this is what the commands mean. A navigation waits for the
// page's load, `LOAD_WAIT_MS` at the most — past that the page is read as it stands, and said so —, an act waits a
// moment for what it set going (a navigation it started, else a short settle); the snapshot is the accessibility
// tree's (core/browser.js), its handles kept from one snapshot of the page to the next; a click lands at the element's
// centre, scrolled into sight, as a person's would (a trusted click); typing is the protocol's text input. What the
// page says meanwhile — its console, its requests, a dialog it opened — is kept here, a ring each, for the next result.
import { EVAL_MAX, LOAD_WAIT_MS, TEXT_MAX, WAIT_MAX_MS, keyEvents, snapshotOf } from "../../core/browser.js";

/** The newest console lines and requests a tab keeps. */
const RING = 200;
/** After an act: how long a navigation it started is looked for, and the settle when none came. */
const ACT_LOOK_MS = 350;
const SETTLE_MS = 250;
/** A screenshot's long side, at the most (the size a model reads best). */
const SHOT_MAX = 1568;

/** @param {number} ms @param {AbortSignal | null} [signal] */
const sleep = (ms, signal = null) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), resolve(undefined)), { once: true });
  });

/** A remote object's words, as the console shows it. @param {any} o */
const remoteWords = (o) => {
  if (!o) return "";
  if (o.value !== undefined) return typeof o.value === "string" ? o.value : JSON.stringify(o.value);
  return String(o.description ?? o.unserializableValue ?? o.type ?? "");
};

/**
 * @typedef {(method: string, params?: any) => Promise<any>} Cdp  one command to the tab's page, its result
 * @typedef {(size: { width: number, height: number }) => Promise<{ data: string, mediaType?: string }>} Capture  the
 *   page as the app paints it, at that size: Chrome's own screenshot waits for a frame a page parked in a window no
 *   one sees never paints (the NA6 probe, 2026-10-22), and Electron's capture answers there
 * @typedef {{ level: string, text: string, at: number }} ConsoleLine
 * @typedef {{ id: string, method: string, url: string, type: string, status: number | null, failed: string | null, at: number }} NetRow
 */

/**
 * An address as the browser says it to anyone: an artifact's of this machine's with its page's pass taken out
 * (`/~<pass>`, http/artifacts.js) — what a model reads never carries one; it opens again under a pass of its own. Its
 * name ending in a dot too (`x.art.localhost.`), which the front door answers as it would without.
 * @param {string} u
 */
export const saidUrl = (u) => (/^http:\/\/[^/?#]+\.art\.localhost\.*(?::\d+)?\/~/i.test(u) ? u.replace(/^(http:\/\/[^/?#]+)\/~[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?=[/?#]|$)/, "$1") : u);

/**
 * @param {{ cdp: Cdp, now?: () => number, capture?: Capture | null }} o  `capture`: the app's picture of the page; without
 *   it, Chrome's screenshot
 */
export function createDriver({ cdp, now = Date.now, capture = null }) {
  let url = "about:blank";
  let title = "";
  /** The page's size as it said it last (its window's inner size), or null before it said one. @type {{ width: number, height: number } | null} */
  let size = null;
  /** The main frame's loading state, from the page's events. */
  let loading = false;
  let loads = 0;
  let navigations = 0;
  /** The handles: a DOM node's handle, kept while the page stays; this snapshot's handle → node. */
  let refs = new Map();
  const next = { n: 0 };
  /** @type {Map<string, number>} */
  let handles = new Map();
  /** @type {ConsoleLine[]} */
  const consoleRing = [];
  /** @type {Map<string, NetRow>} */
  const net = new Map();
  /** What the page did that the next result says: a dialog answered, a file chooser refused. @type {string[]} */
  const said = [];
  /** The main frame's id, once known. @type {string} */
  let mainFrame = "";
  /** @type {Set<() => void>} */
  const waiters = new Set();
  const wake = () => {
    for (const w of [...waiters]) w();
  };
  /** @param {ConsoleLine} l */
  const keepLine = (l) => {
    consoleRing.push(l);
    if (consoleRing.length > RING) consoleRing.splice(0, consoleRing.length - RING);
  };

  /**
   * An event of the tab's page, as the app relays it.
   * @param {string} method @param {any} params
   */
  function feed(method, params) {
    const p = params || {};
    switch (method) {
      case "Page.frameNavigated":
        if (!p.frame?.parentId) {
          url = saidUrl(String(p.frame?.url || url));
          navigations++;
          // A new document: the old one's handles name nothing on it.
          refs = new Map();
          handles = new Map();
        }
        break;
      case "Page.navigatedWithinDocument":
        url = saidUrl(String(p.url || url));
        break;
      case "Page.frameStartedLoading":
        if (p.frameId && p.frameId === mainFrame) loading = true;
        break;
      case "Page.frameStoppedLoading":
        if (p.frameId && p.frameId === mainFrame) loading = false;
        break;
      case "Page.loadEventFired":
        loading = false;
        loads++;
        break;
      case "Page.javascriptDialogOpening": {
        // An alert is accepted; a confirm, a prompt and a "leave this page?" are dismissed — said in the next result.
        const accept = p.type === "alert";
        said.push(`The page showed ${p.type === "alert" ? "an alert" : p.type === "beforeunload" ? `a "leave this page?" question` : `a ${p.type}`}${p.message ? `: "${String(p.message).slice(0, 300)}"` : ""} — ${accept ? "accepted" : "dismissed"}.`);
        void cdp("Page.handleJavaScriptDialog", { accept }).catch(() => {});
        break;
      }
      case "Page.fileChooserOpened":
        said.push("The page asked for a file to upload: uploads are not the browser's yet, so nothing was chosen.");
        break;
      case "Runtime.consoleAPICalled":
        keepLine({ level: String(p.type || "log"), text: (p.args || []).map(remoteWords).join(" ").slice(0, 2000), at: now() });
        break;
      case "Runtime.exceptionThrown": {
        const d = p.exceptionDetails || {};
        keepLine({ level: "error", text: `Uncaught ${remoteWords(d.exception) || d.text || "exception"}${d.url ? ` (${saidUrl(String(d.url))}:${(d.lineNumber ?? 0) + 1})` : ""}`.slice(0, 2000), at: now() });
        break;
      }
      case "Log.entryAdded": {
        const e = p.entry || {};
        keepLine({ level: String(e.level || "info"), text: `${String(e.text || "").slice(0, 2000)}${e.url ? ` (${saidUrl(String(e.url))})` : ""}`, at: now() });
        break;
      }
      case "Network.requestWillBeSent": {
        const id = String(p.requestId);
        net.set(id, { id, method: String(p.request?.method || "GET"), url: saidUrl(String(p.request?.url || "")), type: String(p.type || ""), status: null, failed: null, at: now() });
        if (net.size > RING) net.delete(/** @type {string} */ (net.keys().next().value));
        break;
      }
      case "Network.responseReceived": {
        const r = net.get(String(p.requestId));
        if (r) r.status = Number(p.response?.status) || null;
        break;
      }
      case "Network.loadingFailed": {
        const r = net.get(String(p.requestId));
        if (r) r.failed = String(p.errorText || "failed") + (p.canceled ? " (cancelled)" : "");
        break;
      }
    }
    wake();
  }
  /** Wait until `done()` holds, the page's events waking the check, `ms` at the most. @param {() => boolean} done @param {number} ms @param {AbortSignal | null} signal */
  const until = (done, ms, signal) =>
    new Promise((resolve) => {
      if (done()) return resolve(true);
      const finish = (/** @type {boolean} */ v) => {
        clearTimeout(t);
        waiters.delete(check);
        resolve(v);
      };
      const check = () => void (done() && finish(true));
      const t = setTimeout(() => finish(done()), ms);
      waiters.add(check);
      signal?.addEventListener("abort", () => finish(false), { once: true });
    });

  /** The page's domains on: once, as the tab opens. */
  async function enable() {
    await cdp("Page.enable");
    await cdp("Runtime.enable");
    await cdp("Network.enable", { maxPostDataSize: 0 }).catch(() => {});
    await cdp("Log.enable").catch(() => {});
    await cdp("Page.setInterceptFileChooserDialog", { enabled: true }).catch(() => {});
    const tree = await cdp("Page.getFrameTree").catch(() => null);
    mainFrame = String(tree?.frameTree?.frame?.id || "");
    url = saidUrl(String(tree?.frameTree?.frame?.url || url));
  }

  /** The page's address and title, as they are now — and its size, the snapshot's first line names (BS2). */
  async function where() {
    const r = await cdp("Runtime.evaluate", { expression: "[location.href, document.title, innerWidth, innerHeight]", returnByValue: true }).catch(() => null);
    const v = r?.result?.value;
    if (Array.isArray(v)) {
      url = saidUrl(String(v[0] || url));
      title = String(v[1] || "");
      const w = Number(v[2]);
      const h = Number(v[3]);
      size = w > 0 && h > 0 ? { width: Math.round(w), height: Math.round(h) } : size;
    }
    return { url, title };
  }

  /**
   * A navigation's end: the page's load, or `LOAD_WAIT_MS` — then it is read as it stands.
   * @param {number} loadsBefore @param {AbortSignal | null} signal
   * @returns {Promise<string>}  a line when the page did not finish
   */
  async function loaded(loadsBefore, signal) {
    const ok = await until(() => loads > loadsBefore && !loading, LOAD_WAIT_MS, signal);
    await sleep(SETTLE_MS, signal);
    return ok ? "" : `(still loading after ${Math.round(LOAD_WAIT_MS / 1000)} s: read as it stands)`;
  }

  /** @param {string} to @param {AbortSignal | null} [signal] */
  async function navigate(to, signal = null) {
    const before = loads;
    const r = await cdp("Page.navigate", { url: to });
    if (r?.errorText) throw new Error(`the page did not open: ${r.errorText}`);
    // A navigation within the page (a hash) fires no load.
    if (!r?.loaderId) {
      await sleep(SETTLE_MS, signal);
      return "";
    }
    return loaded(before, signal);
  }

  /** @param {-1 | 1} step @param {AbortSignal | null} [signal] */
  async function go(step, signal = null) {
    const h = await cdp("Page.getNavigationHistory");
    const entry = h?.entries?.[Number(h.currentIndex) + step];
    if (!entry) throw new Error(step < 0 ? "there is no page before this one" : "there is no page after this one");
    const before = loads;
    await cdp("Page.navigateToHistoryEntry", { entryId: entry.id });
    return loaded(before, signal);
  }

  /** @param {AbortSignal | null} [signal] */
  async function reload(signal = null) {
    const before = loads;
    await cdp("Page.reload", {});
    return loaded(before, signal);
  }

  /** The page as a snapshot. */
  async function snapshot() {
    await cdp("Accessibility.enable").catch(() => {});
    const tree = await cdp("Accessibility.getFullAXTree", {});
    await where();
    const s = snapshotOf(tree?.nodes || [], { refs, next, url, title, size });
    handles = s.handles;
    return s.text;
  }

  /** A handle's DOM node, or why not. @param {string} ref */
  const nodeOf = (ref) => {
    const id = handles.get(String(ref));
    if (id == null) throw new Error(`no element ${ref} on the page now: take a snapshot, and use a handle it shows`);
    return id;
  };

  /** An element's centre in the page's viewport, scrolled into sight first. @param {string} ref */
  async function centre(ref) {
    const backendNodeId = nodeOf(ref);
    await cdp("DOM.scrollIntoViewIfNeeded", { backendNodeId }).catch(() => {});
    const q = await cdp("DOM.getContentQuads", { backendNodeId }).catch(() => null);
    const quad = q?.quads?.[0];
    if (!quad || quad.length < 8) throw new Error(`${ref} is not on screen: it may be hidden — take a snapshot`);
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    return { x: xs.reduce((a, b) => a + b, 0) / 4, y: ys.reduce((a, b) => a + b, 0) / 4 };
  }

  /**
   * After an act: a navigation it set going is waited for to its load; else a short settle.
   * @param {number} navsBefore @param {number} loadsBefore @param {AbortSignal | null} signal
   */
  async function settle(navsBefore, loadsBefore, signal) {
    const went = await until(() => navigations > navsBefore || loading, ACT_LOOK_MS, signal);
    if (went) return loaded(loadsBefore, signal);
    await sleep(SETTLE_MS, signal);
    return "";
  }

  /** @param {string} ref @param {{ double?: boolean, button?: string }} [o] @param {AbortSignal | null} [signal] */
  async function click(ref, { double = false, button = "left" } = {}, signal = null) {
    const { x, y } = await centre(ref);
    const navs = navigations;
    const ld = loads;
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    for (let c = 1; c <= (double ? 2 : 1); c++) {
      await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: c });
      await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: c });
    }
    return settle(navs, ld, signal);
  }

  /** @param {string} ref */
  async function hover(ref) {
    const { x, y } = await centre(ref);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await sleep(SETTLE_MS);
    return "";
  }

  /** A handle's element as a remote object. @param {string} ref */
  async function objectOf(ref) {
    const r = await cdp("DOM.resolveNode", { backendNodeId: nodeOf(ref) });
    const objectId = r?.object?.objectId;
    if (!objectId) throw new Error(`${ref} is gone from the page: take a snapshot`);
    return objectId;
  }

  /**
   * Text typed into a field (`ref`), or where the page's focus is; `clear` empties the field first, `submit` presses
   * Enter after.
   * @param {string | null} ref @param {string} text @param {{ clear?: boolean, submit?: boolean }} [o] @param {AbortSignal | null} [signal]
   */
  async function type(ref, text, { clear = false, submit = false } = {}, signal = null) {
    if (ref) {
      await cdp("DOM.focus", { backendNodeId: nodeOf(ref) }).catch(async () => {
        await click(ref, {}, signal);
      });
      if (clear) {
        const objectId = await objectOf(ref);
        await cdp("Runtime.callFunctionOn", {
          objectId,
          functionDeclaration: "function () { if ('value' in this) { this.value = ''; this.dispatchEvent(new Event('input', { bubbles: true })); } else if (this.isContentEditable) { this.textContent = ''; } }",
        });
      }
    }
    if (text) await cdp("Input.insertText", { text });
    if (!submit) {
      await sleep(SETTLE_MS, signal);
      return "";
    }
    return press("Enter", signal);
  }

  /** @param {string} combo @param {AbortSignal | null} [signal] */
  async function press(combo, signal = null) {
    const k = keyEvents(combo);
    if (!k.ok) throw new Error(k.error);
    const navs = navigations;
    const ld = loads;
    for (const e of k.events) await cdp("Input.dispatchKeyEvent", e);
    return settle(navs, ld, signal);
  }

  /** An option of a select chosen, by its value or its words. @param {string} ref @param {string} value */
  async function select(ref, value) {
    const objectId = await objectOf(ref);
    const r = await cdp("Runtime.callFunctionOn", {
      objectId,
      arguments: [{ value: String(value) }],
      returnByValue: true,
      functionDeclaration:
        "function (want) { if (!(this instanceof HTMLSelectElement)) return { error: 'not a list to choose from (a select)' }; const w = String(want).trim().toLowerCase(); const o = [...this.options].find((x) => x.value === want) || [...this.options].find((x) => x.text.trim().toLowerCase() === w) || [...this.options].find((x) => x.text.trim().toLowerCase().includes(w)); if (!o) return { error: 'no option ' + JSON.stringify(want) + '; the options: ' + [...this.options].map((x) => x.text.trim()).slice(0, 30).join(' | ') }; this.value = o.value; this.dispatchEvent(new Event('input', { bubbles: true })); this.dispatchEvent(new Event('change', { bubbles: true })); return { chose: o.text.trim() }; }",
    });
    const v = r?.result?.value;
    if (v?.error) throw new Error(`${ref}: ${v.error}`);
    await sleep(SETTLE_MS);
    return `chose "${v?.chose ?? value}"`;
  }

  /** @param {{ ref?: string, direction?: string, amount?: number }} o */
  async function scroll({ ref, direction = "down", amount = 0 }) {
    if (ref) {
      await cdp("DOM.scrollIntoViewIfNeeded", { backendNodeId: nodeOf(ref) });
      await sleep(SETTLE_MS);
      return "";
    }
    const m = await cdp("Page.getLayoutMetrics");
    const vp = m?.cssVisualViewport || m?.layoutViewport || {};
    const w = Number(vp.clientWidth) || 1280;
    const hgt = Number(vp.clientHeight) || 800;
    const by = Math.abs(Number(amount)) || Math.round(hgt * 0.8);
    const d = String(direction);
    await cdp("Input.dispatchMouseEvent", { type: "mouseWheel", x: w / 2, y: hgt / 2, deltaX: d === "left" ? -by : d === "right" ? by : 0, deltaY: d === "up" ? -by : d === "down" ? by : 0 });
    await sleep(SETTLE_MS);
    return "";
  }

  /**
   * What the page shows now, as a picture the model sees: JPEG, at the page's own size (CSS pixels), its long side
   * `SHOT_MAX` at the most — `page`, the page's size, where the picture is smaller (BS case 23).
   * @returns {Promise<{ data: string, mediaType: string, width: number, height: number, page: { width: number, height: number } }>}
   */
  async function screenshot() {
    const m = await cdp("Page.getLayoutMetrics");
    const vp = m?.cssVisualViewport || m?.cssLayoutViewport || m?.layoutViewport || {};
    const width = Math.max(1, Math.round(Number(vp.clientWidth) || 1280));
    const height = Math.max(1, Math.round(Number(vp.clientHeight) || 800));
    const ratio = await cdp("Runtime.evaluate", { expression: "window.devicePixelRatio", returnByValue: true }).then((r) => Number(r?.result?.value) || 1, () => 1);
    const fit = Math.min(1, SHOT_MAX / Math.max(width, height));
    const shown = { width: Math.round(width * fit), height: Math.round(height * fit) };
    const page = { width, height };
    if (capture) {
      const c = await capture(shown);
      if (!c?.data) throw new Error("the browser took no picture");
      return { data: String(c.data), mediaType: String(c.mediaType || "image/jpeg"), ...shown, page };
    }
    const r = await cdp("Page.captureScreenshot", { format: "jpeg", quality: 70, clip: { x: Number(vp.pageX) || 0, y: Number(vp.pageY) || 0, width, height, scale: fit / ratio } });
    if (!r?.data) throw new Error("the browser took no picture");
    return { data: String(r.data), mediaType: "image/jpeg", ...shown, page };
  }

  /** The page's words. */
  async function text() {
    const r = await cdp("Runtime.evaluate", { expression: "document.body ? document.body.innerText : ''", returnByValue: true });
    await where();
    const all = String(r?.result?.value ?? "");
    const shown = all.length > TEXT_MAX ? `${all.slice(0, TEXT_MAX)}\n…[${all.length - TEXT_MAX} more characters not shown]` : all;
    return `Page: ${title || "(no title)"} — ${url}\n${shown.trim() || "(the page shows no words)"}`;
  }

  /** The console's newest lines; `errors` only the errors and warnings. @param {{ errors?: boolean, clear?: boolean }} [o] */
  function consoleLines({ errors = false, clear = false } = {}) {
    const ls = consoleRing.filter((l) => !errors || l.level === "error" || l.level === "warning" || l.level === "warn" || l.level === "assert");
    const shown = ls.slice(-50);
    if (clear) consoleRing.length = 0;
    if (!shown.length) return errors ? "No errors or warnings in the page's console." : "The page's console is empty.";
    return `The page's console, ${shown.length === ls.length ? `${ls.length} line${ls.length === 1 ? "" : "s"}` : `the newest ${shown.length} of ${ls.length}`}:\n${shown.map((l) => `[${l.level}] ${l.text}`).join("\n")}`;
  }

  /** The page's newest requests; `failed` only those that failed or answered 400 or more. @param {{ failed?: boolean }} [o] */
  function networkLines({ failed = false } = {}) {
    const rows = [...net.values()].filter((r) => !failed || r.failed || (r.status != null && r.status >= 400));
    const shown = rows.slice(-50);
    if (!shown.length) return failed ? "No failed requests." : "No requests seen yet.";
    return `The page's requests, ${shown.length === rows.length ? `${rows.length}` : `the newest ${shown.length} of ${rows.length}`}:\n${shown.map((r) => `${r.method} ${r.failed ? `failed: ${r.failed}` : r.status ?? "…"} ${r.type ? `${r.type.toLowerCase()} ` : ""}${r.url.slice(0, 300)}`).join("\n")}`;
  }

  /** JavaScript run in the page, its value as JSON. @param {string} expression */
  async function evaluate(expression) {
    const r = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r?.exceptionDetails) throw new Error(`the page threw: ${remoteWords(r.exceptionDetails.exception) || r.exceptionDetails.text || "an exception"}`);
    const v = r?.result;
    const words = v?.value !== undefined ? JSON.stringify(v.value) : String(v?.description ?? v?.type ?? "undefined");
    return words.length > EVAL_MAX ? `${words.slice(0, EVAL_MAX)}…[${words.length - EVAL_MAX} more characters]` : words;
  }

  /**
   * A wait: until `text` shows on the page (or is gone, `gone`), or `ms`; `WAIT_MAX_MS` at the most.
   * @param {{ text?: string, gone?: boolean, ms?: number }} o @param {AbortSignal | null} [signal]
   */
  async function wait({ text: want = "", gone = false, ms = 0 }, signal = null) {
    const limit = Math.min(WAIT_MAX_MS, Math.max(0, Number(ms) || (want ? 10_000 : 1000)));
    if (!want) {
      await sleep(limit, signal);
      return `waited ${limit} ms`;
    }
    const end = now() + limit;
    for (;;) {
      const r = await cdp("Runtime.evaluate", { expression: `document.body ? document.body.innerText.includes(${JSON.stringify(String(want))}) : false`, returnByValue: true }).catch(() => null);
      const there = r?.result?.value === true;
      if (there !== gone) return `"${want}" ${gone ? "is gone" : "is on the page"}`;
      if (now() >= end || signal?.aborted) return `"${want}" ${gone ? "still on the page" : "not on the page"} after ${limit} ms`;
      await sleep(250, signal);
    }
  }

  return {
    feed,
    enable,
    where,
    navigate,
    back: (/** @type {AbortSignal | null} */ s = null) => go(-1, s),
    forward: (/** @type {AbortSignal | null} */ s = null) => go(1, s),
    reload,
    snapshot,
    click,
    hover,
    type,
    press,
    select,
    scroll,
    screenshot,
    text,
    consoleLines,
    networkLines,
    evaluate,
    wait,
    /** What the page did since the last result, said once. */
    takeSaid: () => said.splice(0),
    get url() {
      return url;
    },
    get title() {
      return title;
    },
    /** The page's size as it said it last, or null. */
    get size() {
      return size;
    },
  };
}

// @ts-check
// The agent's browser (HarnessV4_Browser_Plan BR1), its pure part: the `browser` tool's actions and which of them act
// on a page (BR-D6), a page's site, the addresses it may open, a key as the protocol's key events, and the snapshot —
// the page's accessibility tree as the lines a model reads, each button, link and field with a handle (`e12`) that
// stays the same for the same element from one snapshot to the next (BR-D4). The driver (app/browser/driver.js) reads
// the tree over Chrome's protocol; nothing here does any I/O.

export const BROWSER = "browser";
/** Every action, in the order the tool's words list them. */
export const ACTIONS = Object.freeze(["navigate", "back", "forward", "reload", "snapshot", "click", "type", "press", "select", "hover", "scroll", "screenshot", "text", "console", "network", "evaluate", "wait", "tabs", "resize", "batch"]);
/** The actions that act on a page — a form sent, a purchase made — and ask once per site in Edit mode (BR-D6). */
export const ACTING = Object.freeze(["click", "type", "press", "select", "evaluate"]);
/** What a batch may hold: every action but another batch, and tabs (which moves the batch to another page). */
export const BATCHABLE = Object.freeze(ACTIONS.filter((a) => a !== "batch" && a !== "tabs"));
export const TABS_MAX = 8;
export const BATCH_MAX = 20;
/** The page's words, at the most, in a `text` result; a snapshot's lines. */
export const TEXT_MAX = 24_000;
export const SNAPSHOT_MAX = 16_000;
/** How long a navigation is waited for before its page is read as it stands, and a `wait` at the most. */
export const LOAD_WAIT_MS = 30_000;
export const WAIT_MAX_MS = 30_000;
/** What `evaluate` brings back, at the most. */
export const EVAL_MAX = 8_000;
/**
 * A page's own size, in CSS pixels (HarnessV4_BrowserSize_Plan BS-D1, D2): what it lays itself out at whoever watches —
 * the pane draws it scaled — a laptop's screen until the agent or the developer sets another.
 */
export const PAGE_SIZE = Object.freeze({ width: 1280, height: 800 });
/** The sizes a page may take: 320–2560 wide, 320–1600 tall. */
export const SIZE_LIMITS = Object.freeze({ minWidth: 320, maxWidth: 2560, minHeight: 320, maxHeight: 1600 });
/**
 * The protocol's commands Filament's driver sends (app/browser/driver.js): any other is refused by whatever holds the
 * pages — the desktop app (desktop/lib/browser-host.js) and Chrome on this machine (app/browser/headless-host.js).
 */
export const CDP_METHODS = Object.freeze(
  new Set([
    "Accessibility.enable",
    "Accessibility.getFullAXTree",
    "DOM.focus",
    "DOM.getContentQuads",
    "DOM.resolveNode",
    "DOM.scrollIntoViewIfNeeded",
    "Input.dispatchKeyEvent",
    "Input.dispatchMouseEvent",
    "Input.insertText",
    "Log.enable",
    "Network.enable",
    "Page.captureScreenshot",
    "Page.enable",
    "Page.getFrameTree",
    "Page.getLayoutMetrics",
    "Page.getNavigationHistory",
    "Page.handleJavaScriptDialog",
    "Page.navigate",
    "Page.navigateToHistoryEntry",
    "Page.reload",
    "Page.setInterceptFileChooserDialog",
    "Runtime.callFunctionOn",
    "Runtime.enable",
    "Runtime.evaluate",
  ]),
);

/** The page's events the driver reads; the rest stay with what holds the pages. */
export const CDP_EVENTS = Object.freeze(
  new Set([
    "Log.entryAdded",
    "Network.loadingFailed",
    "Network.requestWillBeSent",
    "Network.responseReceived",
    "Page.fileChooserOpened",
    "Page.frameNavigated",
    "Page.frameStartedLoading",
    "Page.frameStoppedLoading",
    "Page.javascriptDialogOpening",
    "Page.loadEventFired",
    "Page.navigatedWithinDocument",
    "Runtime.consoleAPICalled",
    "Runtime.exceptionThrown",
  ]),
);

/** The sizes by name, as `resize` and the pane's size chip offer them (BS2). */
export const SIZES = Object.freeze({
  desktop: Object.freeze({ width: 1440, height: 900 }),
  laptop: Object.freeze({ width: 1280, height: 800 }),
  tablet: Object.freeze({ width: 820, height: 1180 }),
  phone: Object.freeze({ width: 390, height: 844 }),
});
/** A size in words, as the agent and the pane read it: "1280 × 800". @param {{ width: number, height: number }} s */
export const sizeWords = (s) => `${s.width} × ${s.height}`;
/** The name of a size, where it is one of `SIZES`. @param {{ width: number, height: number }} s */
export const sizeName = (s) => Object.keys(SIZES).find((k) => SIZES[/** @type {keyof typeof SIZES} */ (k)].width === s.width && SIZES[/** @type {keyof typeof SIZES} */ (k)].height === s.height) || "";

/**
 * The size a `resize` asks for — by name, or by width and height inside the limits — or why it is none, in words.
 * @param {any} input @returns {{ ok: true, width: number, height: number, name: string } | { ok: false, error: string }}
 */
export function sizeWanted(input) {
  const named = input?.size == null || input.size === "" ? "" : String(input.size).toLowerCase();
  if (named) {
    const s = /** @type {Record<string, { width: number, height: number }>} */ (SIZES)[named];
    return s ? { ok: true, ...s, name: named } : { ok: false, error: `${String(input.size).slice(0, 40)} is no size the browser names: ${Object.keys(SIZES).join(", ")} — or width and height` };
  }
  const w = Number(input?.width);
  const h = Number(input?.height);
  if (input?.width == null || input?.height == null || !Number.isFinite(w) || !Number.isFinite(h)) return { ok: false, error: `resize needs size (${Object.keys(SIZES).join(", ")}) or width and height, in CSS pixels` };
  const L = SIZE_LIMITS;
  const width = Math.round(w);
  const height = Math.round(h);
  if (width < L.minWidth || width > L.maxWidth || height < L.minHeight || height > L.maxHeight) return { ok: false, error: `${width} × ${height} is no size the browser takes: ${L.minWidth}–${L.maxWidth} wide, ${L.minHeight}–${L.maxHeight} tall` };
  return { ok: true, width, height, name: sizeName({ width, height }) };
}

/**
 * A size as a page holds it: whole pixels inside the limits; where either side is no number, the default.
 * @param {unknown} width @param {unknown} height @returns {{ width: number, height: number }}
 */
export function pageSize(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { ...PAGE_SIZE };
  const L = SIZE_LIMITS;
  return { width: Math.min(L.maxWidth, Math.max(L.minWidth, w)), height: Math.min(L.maxHeight, Math.max(L.minHeight, h)) };
}

/** @param {any} input */
export const actionOf = (input) => String(input?.action || "");
/** Whether one step acts on its page. @param {any} step */
export const acts = (step) => ACTING.includes(actionOf(step));
/** The steps of a call that act: the call itself, or a batch's acting steps. @param {any} input */
export const actingSteps = (input) => (actionOf(input) === "batch" ? (Array.isArray(input?.steps) ? input.steps.filter(acts) : []) : acts(input) ? [input] : []);

/**
 * A page's site: its host name, lower-cased, without its port — `localhost:5173` and `localhost:3000` are one site,
 * as a person reads them — or the trailing dot a browser reaches the same site by (`shop.test.`). Not a web address
 * (about:blank, a file), none.
 * @param {string} url
 */
export function siteOf(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname.toLowerCase().replace(/\.+$/, "") : "";
  } catch {
    return "";
  }
}

/**
 * An address as the session's rules read it: its host without the trailing dot a browser reaches the same site by
 * (`https://evil.test./x` is `https://evil.test/x`), so a rule naming the site holds however the address spells it.
 * Anything else as it is.
 * @param {string} url
 */
export const ruleUrl = (url) => String(url).replace(/^(https?:\/\/(?:[^@/?#]*@)?[^/?#:@]*?)\.+(?=[:/?#]|$)/i, "$1");

/**
 * An address as the agent or the person wrote it, made whole: a bare host gets `https://` (`localhost` and an
 * address of this machine's network `http://`), anything else stays as written.
 * @param {string} raw
 */
export function wholeUrl(raw) {
  const s = String(raw || "").trim();
  // A scheme is `name://`, or one of the few that take none; `localhost:5173` is a host and its port.
  if (!s || /^[a-z][a-z0-9+.-]*:\/\//i.test(s) || /^(about|javascript|data|file|mailto|blob|chrome|view-source):/i.test(s)) return s;
  const host = s.split(/[/?#]/)[0].replace(/:\d+$/, "").toLowerCase();
  const local = host === "localhost" || host.endsWith(".localhost") || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === "[::1]";
  return `${local ? "http" : "https"}://${s}`;
}

/**
 * Whether an address is Filament's own: its harness and its API, which trust this machine and a page of their own
 * address, so a page the browser opened there could read Filament's keys and change its settings. An http address at
 * one of the ports Filament listens on — its own, and its doors' — on a name of this machine — `localhost` and the names
 * under it, 127.x, ::1, 0.0.0.0, each as IPv6 writes IPv4 too (::ffff:7f00:1) — or on one of `names`, the hosts
 * Filament is served as and this machine's addresses; or an address at one of `origins`, where another program serves
 * Filament (Tailscale's serve). An artifact's address (`<name>.art.localhost`, core/artifacts.js) is not: the
 * artifacts' fence keeps everything of Filament's from it.
 * @param {string} url @param {number | readonly number[]} port  the port Filament listens on, or every one
 * @param {readonly string[]} [names] @param {readonly string[]} [origins]
 */
export function filamentsOwn(url, port, names = [], origins = []) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  if (origins.includes(u.origin)) return true;
  const at = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  if (!(typeof port === "number" ? [port] : port).some((p) => Number(p) === at)) return false;
  const bare = (/** @type {string} */ h) => String(h).toLowerCase().replace(/^\[|\]$/g, "").replace(/\.+$/, "");
  let h = bare(u.hostname);
  const v4 = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (v4) {
    const [a, b] = [parseInt(v4[1], 16), parseInt(v4[2], 16)];
    h = `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
  }
  if (h === "art.localhost" || h.endsWith(".art.localhost")) return false;
  if (h === "localhost" || h.endsWith(".localhost") || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === "0.0.0.0") return true;
  if (h === "::1" || h === "::") return true;
  return names.some((n) => !!n && bare(n) === h);
}

/**
 * Why the browser will not open an address, or null: http(s) and about:blank only — no file, script, data or the
 * browser's own pages —, and never Filament's own (`own`, `filamentsOwn` at the port it listens on). Private addresses
 * are allowed (BR-D8).
 * @param {string} url @param {(url: string) => boolean} [own]
 */
export function urlProblem(url, own = () => false) {
  const s = String(url || "").trim();
  if (!s) return "an address is needed (url)";
  if (s === "about:blank") return null;
  /** @type {URL} */
  let u;
  try {
    u = new URL(s);
  } catch {
    return `"${s.slice(0, 200)}" is no address`;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return `the browser opens http and https addresses only, not ${u.protocol}`;
  if (own(u.href)) return `${u.host} is Filament's own address: the browser never opens it — its pages and its API act for the developer`;
  return null;
}

/** The protocol's modifier bits. */
const MODIFIER = Object.freeze({ alt: 1, control: 2, ctrl: 2, meta: 4, cmd: 4, command: 4, shift: 8 });
/** Named keys: their `key`, `code` and Windows key code. */
const NAMED = Object.freeze({
  enter: ["Enter", "Enter", 13, "\r"],
  tab: ["Tab", "Tab", 9, ""],
  escape: ["Escape", "Escape", 27, ""],
  esc: ["Escape", "Escape", 27, ""],
  backspace: ["Backspace", "Backspace", 8, ""],
  delete: ["Delete", "Delete", 46, ""],
  space: [" ", "Space", 32, " "],
  arrowup: ["ArrowUp", "ArrowUp", 38, ""],
  arrowdown: ["ArrowDown", "ArrowDown", 40, ""],
  arrowleft: ["ArrowLeft", "ArrowLeft", 37, ""],
  arrowright: ["ArrowRight", "ArrowRight", 39, ""],
  up: ["ArrowUp", "ArrowUp", 38, ""],
  down: ["ArrowDown", "ArrowDown", 40, ""],
  left: ["ArrowLeft", "ArrowLeft", 37, ""],
  right: ["ArrowRight", "ArrowRight", 39, ""],
  home: ["Home", "Home", 36, ""],
  end: ["End", "End", 35, ""],
  pageup: ["PageUp", "PageUp", 33, ""],
  pagedown: ["PageDown", "PageDown", 34, ""],
});

/**
 * A key as the agent writes it — `Enter`, `Control+A`, `Shift+Tab`, `a`, `F5` — as the protocol's key events, down
 * then up; or an error in words.
 * @param {string} combo
 * @returns {{ ok: true, events: any[] } | { ok: false, error: string }}
 */
export function keyEvents(combo) {
  const parts = String(combo || "").split("+").map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return { ok: false, error: "a key is needed (key), as Enter, Tab, Escape, Control+A" };
  const keyWord = /** @type {string} */ (parts.pop());
  let modifiers = 0;
  for (const m of parts) {
    const bit = /** @type {Record<string, number>} */ (MODIFIER)[m.toLowerCase()];
    if (!bit) return { ok: false, error: `${m} is no modifier: Control, Shift, Alt or Meta` };
    modifiers |= bit;
  }
  /** @type {[string, string, number, string] | null} */
  let k = /** @type {any} */ (NAMED)[keyWord.toLowerCase()] || null;
  const f = /^f([1-9]|1[0-2])$/i.exec(keyWord);
  if (!k && f) k = [`F${f[1]}`, `F${f[1]}`, 111 + Number(f[1]), ""];
  if (!k && keyWord.length === 1) {
    const c = keyWord;
    const up = c.toUpperCase();
    const letter = /[a-z]/i.test(c);
    const digit = /[0-9]/.test(c);
    k = [c, letter ? `Key${up}` : digit ? `Digit${c}` : "", letter || digit ? up.charCodeAt(0) : 0, c];
  }
  if (!k) return { ok: false, error: `${keyWord} is no key Filament knows: a letter, a digit, F1–F12, Enter, Tab, Escape, Backspace, Delete, Space, the arrows, Home, End, PageUp, PageDown` };
  const [key, code, vk, text] = k;
  // A key with Control, Alt or Meta held types nothing; a plain one types its character.
  const types = !!text && !(modifiers & 7);
  const base = { key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers };
  return { ok: true, events: [{ type: types ? "keyDown" : "rawKeyDown", ...base, ...(types ? { text, unmodifiedText: text } : {}) }, { type: "keyUp", ...base }] };
}

/** The roles a snapshot gives a handle: what can be pressed, typed in or chosen. */
const HANDLED = new Set([
  "button", "link", "textbox", "searchbox", "combobox", "listbox", "option", "checkbox", "radio", "switch", "slider",
  "spinbutton", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "treeitem", "textfield", "popupbutton", "togglebutton",
]);
/** The roles a snapshot names without a handle: what tells where things are. */
const NAMED_ROLES = new Set(["heading", "img", "image", "dialog", "alertdialog", "alert", "status", "navigation", "main", "banner", "contentinfo", "search", "form", "region", "complementary", "table", "row", "cell", "columnheader", "rowheader", "list", "tablist", "menu", "menubar", "tree", "progressbar", "iframe"]);
/** Landmarks and groups whose children are drawn under them. */
const GROUPS = new Set(["navigation", "main", "banner", "contentinfo", "search", "form", "region", "complementary", "dialog", "alertdialog", "list", "table", "row", "tablist", "menu", "menubar", "tree"]);
/** The text roles, read as the page's words. */
const TEXT_ROLES = new Set(["StaticText", "statictext", "text"]);

/** @param {any} p */
const valueOf = (p) => (p && typeof p === "object" && "value" in p ? p.value : p);
/** A name as one short line. @param {unknown} s @param {number} [max] */
const line = (s, max = 160) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/**
 * The page as a snapshot: its accessibility tree (`Accessibility.getFullAXTree`'s nodes) as lines — a handled element
 * `- button "Sign in" [e3]` with its state (`checked`, `disabled`, `expanded`, its value), a named one
 * `- heading "Welcome" (h1)`, the page's words `text: …` — indented under the landmarks and groups that hold them.
 * `refs` maps a DOM node (its `backendDOMNodeId`) to its handle and is kept by the caller from one snapshot of the
 * page to the next, so the same element keeps its handle; `handles` gets each handle's node for this snapshot. Longer
 * than `max`, the page's words go first, then the cut is said.
 * Its first line names the page, its address and — where the page said it — its size (BS2).
 * @param {readonly any[]} nodes
 * @param {{ refs: Map<number, string>, next: { n: number }, url?: string, title?: string, max?: number, size?: { width: number, height: number } | null }} o
 * @returns {{ text: string, handles: Map<string, number>, count: number, frames: number }}
 */
export function snapshotOf(nodes, { refs, next, url = "", title = "", max = SNAPSHOT_MAX, size = null }) {
  const byId = new Map(nodes.map((n) => [String(n.nodeId), n]));
  const root = nodes.find((n) => n.parentId == null) || nodes[0];
  /** @type {{ depth: number, text: string, words: boolean }[]} */
  const lines = [];
  /** @type {Map<string, number>} */
  const handles = new Map();
  let frames = 0;
  const seen = new Set();
  /** @param {any} n @param {number} depth */
  const visit = (n, depth) => {
    if (!n || seen.has(n.nodeId)) return;
    seen.add(n.nodeId);
    const role = String(valueOf(n.role) || "");
    const name = line(valueOf(n.name));
    const props = new Map((n.properties || []).map((/** @type {any} */ p) => [String(p.name), valueOf(p.value)]));
    let down = depth;
    if (!n.ignored) {
      if (role === "Iframe" || role === "iframe") frames++;
      if (TEXT_ROLES.has(role)) {
        if (name) {
          const last = lines.at(-1);
          // The words of one run of text read as one line.
          if (last?.words && last.depth === depth && last.text.length < 300) last.text = `${last.text} ${name}`;
          else lines.push({ depth, text: `text: ${name}`, words: true });
        }
      } else if (HANDLED.has(role.toLowerCase()) && n.backendDOMNodeId != null) {
        const id = Number(n.backendDOMNodeId);
        let ref = refs.get(id);
        if (!ref) {
          ref = `e${++next.n}`;
          refs.set(id, ref);
        }
        handles.set(ref, id);
        const states = [];
        for (const s of ["disabled", "required", "invalid", "readonly", "expanded", "selected", "pressed", "focused"]) {
          const v = props.get(s);
          if (v === true || v === "true") states.push(s);
        }
        const checked = props.get("checked");
        if (checked === true || checked === "true") states.push("checked");
        else if (checked === "mixed") states.push("partly checked");
        const value = valueOf(n.value);
        const shown = value != null && value !== "" && role !== "link" && String(value) !== name ? ` value="${line(value, 120)}"` : "";
        lines.push({ depth, text: `- ${role.toLowerCase()}${name ? ` "${name}"` : ""} [${ref}]${shown}${states.length ? ` ${states.join(" ")}` : ""}`, words: false });
        // A field's own text nodes say its value again: its inside is not read.
        if (role === "textbox" || role === "searchbox" || role === "combobox" || role === "textfield") return;
      } else if (NAMED_ROLES.has(role.toLowerCase()) && (name || GROUPS.has(role.toLowerCase()))) {
        const level = props.get("level");
        const lower = role.toLowerCase();
        lines.push({ depth, text: `- ${lower === "image" ? "img" : lower}${name ? ` "${name}"` : ""}${lower === "heading" && level ? ` (h${level})` : ""}`, words: false });
        if (GROUPS.has(lower)) down = depth + 1;
      }
    }
    for (const c of n.childIds || []) visit(byId.get(String(c)), down);
  };
  visit(root, 0);
  const head = `Page: ${line(title, 200) || "(no title)"} — ${url || "about:blank"}${size ? ` · ${sizeWords(size)}` : ""}`;
  const draw = (/** @type {typeof lines} */ ls) => ls.map((l) => `${"  ".repeat(Math.min(l.depth, 6))}${l.text}`).join("\n");
  let body = draw(lines);
  let cut = "";
  if (body.length > max) {
    // The page's words give way first: the handles are what the agent acts by.
    const kept = lines.filter((l) => !l.words);
    body = draw(kept);
    cut = `\n…[the page's words left out to fit; text reads them]`;
    if (body.length > max) {
      const at = body.lastIndexOf("\n", max);
      const shown = body.slice(0, at > 0 ? at : max);
      const left = body.slice(shown.length).split("\n").filter(Boolean).length;
      body = shown;
      cut = `\n…[${left} more line${left === 1 ? "" : "s"} not shown: scroll, or text, reads further]`;
    }
  }
  const framesLine = frames ? `\n(${frames} frame${frames === 1 ? "" : "s"} of the page not read: another site's frame is not in this snapshot)` : "";
  return { text: `${head}\n${body || "(nothing on the page the browser can name)"}${cut}${framesLine}`, handles, count: handles.size, frames };
}

/**
 * The words a call of the tool is shown by on its card and in the record: its action and what it acts on.
 * @param {any} input
 */
export function browserArgWords(input) {
  const a = actionOf(input);
  const q = (/** @type {unknown} */ s, n = 40) => `"${line(s, n)}"`;
  switch (a) {
    case "navigate":
      return `navigate ${line(input?.url, 80)}`;
    case "click":
    case "hover":
      return `${a} ${input?.ref || "?"}`;
    case "type":
      return `type ${q(input?.text)} into ${input?.ref || "?"}${input?.submit ? " and send" : ""}`;
    case "press":
      return `press ${line(input?.key, 30)}`;
    case "select":
      return `select ${q(input?.value)} in ${input?.ref || "?"}`;
    case "scroll":
      return `scroll ${input?.ref ? `to ${input.ref}` : input?.direction || "down"}`;
    case "evaluate":
      return `evaluate ${q(input?.expression, 60)}`;
    case "wait":
      return input?.text ? `wait for ${q(input.text)}` : `wait ${Number(input?.ms) || 1000} ms`;
    case "tabs":
      return `tabs ${input?.op || "list"}${input?.url ? ` ${line(input.url, 60)}` : input?.tab ? ` ${input.tab}` : ""}`;
    case "resize":
      return `resize ${input?.size ? line(input.size, 20) : `${Number(input?.width) || "?"} × ${Number(input?.height) || "?"}`}`;
    case "batch": {
      const n = Array.isArray(input?.steps) ? input.steps.length : 0;
      return `batch of ${n} step${n === 1 ? "" : "s"}`;
    }
    default:
      return a || "?";
  }
}

/**
 * What is wrong with a call's input, in words, or null.
 * @param {any} input @param {{ inBatch?: boolean, own?: (url: string) => boolean }} [o]  `own`: whether an address is
 *   Filament's own, which no navigation opens
 */
export function inputProblem(input, { inBatch = false, own = () => false } = {}) {
  const a = actionOf(input);
  if (!a) return `an action is needed: one of ${ACTIONS.join(", ")}`;
  if (!ACTIONS.includes(a)) return `${a} is no action of the browser's: one of ${ACTIONS.join(", ")}`;
  if (inBatch && !BATCHABLE.includes(a)) return `a batch holds no ${a}`;
  const ref = (/** @type {string} */ why) => (/^e\d+$/.test(String(input?.ref || "")) ? null : `${a} needs ref, an element's handle from the snapshot (e12)${why}`);
  switch (a) {
    case "navigate":
      return urlProblem(wholeUrl(input?.url), own);
    case "click":
    case "hover":
    case "select":
      return ref("") || (a === "select" && (input?.value == null || input.value === "") ? "select needs value: the option's value or its words" : null);
    case "type":
      return typeof input?.text !== "string" ? "type needs text" : input?.ref == null ? null : ref("");
    case "press":
      return keyEvents(input?.key).ok ? null : /** @type {any} */ (keyEvents(input?.key)).error;
    case "evaluate":
      return typeof input?.expression === "string" && input.expression.trim() ? null : "evaluate needs expression: JavaScript to run in the page";
    case "batch": {
      const steps = input?.steps;
      if (!Array.isArray(steps) || !steps.length) return "batch needs steps: the actions to do in order";
      if (steps.length > BATCH_MAX) return `a batch holds ${BATCH_MAX} steps at the most`;
      for (let i = 0; i < steps.length; i++) {
        const p = inputProblem(steps[i], { inBatch: true, own });
        if (p) return `step ${i + 1}: ${p}`;
      }
      return null;
    }
    case "tabs": {
      const op = String(input?.op || "list");
      if (!["list", "new", "select", "close"].includes(op)) return "tabs' op is list, new, select or close";
      if ((op === "select" || op === "close") && !input?.tab) return `tabs ${op} needs tab: its id from tabs list`;
      if (op === "new" && input?.url) return urlProblem(wholeUrl(input.url), own);
      return null;
    }
    case "resize": {
      const s = sizeWanted(input);
      return s.ok ? null : s.error;
    }
    default:
      return null;
  }
}

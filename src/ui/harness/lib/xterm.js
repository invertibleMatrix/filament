// @ts-check
// A server terminal shown in an element (§5.9.9, HarnessV3-ACP AC3-7): the vendored xterm (MIT, vendor/xterm, which
// harness.html loads as classic scripts — never a CDN, never node_modules) fitted to its box and dressed in the page's
// --color-terminal-* tokens, on the terminal's stream over a WebSocket. What it printed while nobody watched comes
// first, then its live output; keys and the box's size go back. Copy and Paste read as a desktop terminal's. The
// Terminal pane and the sign-in sheet show their terminals through it. Nothing here runs at import: the page's
// globals are read when a terminal is shown.
import { api, pressBridge } from "../../lib/api.js";
import { holdWhileShown } from "../../lib/put-away.js";

/** The least a shell is given, as the server holds it (services/terminal.js `resize`). */
const LEAST_COLS = 20;
const LEAST_ROWS = 4;
/** How long the view's size holds still before the shell takes it. */
export const SIZE_SETTLE_MS = 150;

/** The xterm theme, read from the page's --color-terminal-* tokens so the terminal follows the theme. */
function termTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (/** @type {string} */ n) => (cs.getPropertyValue(n) || "").trim();
  const bright = (/** @type {string} */ n) => v(n) || v(n.replace("bright-", ""));
  return {
    background: v("--color-terminal-bg") || "#000",
    foreground: v("--color-terminal-fg") || "#d4d4d4",
    cursor: v("--color-terminal-cursor") || "#f8f8f8",
    cursorAccent: v("--color-terminal-cursor-accent") || "#161616",
    selectionBackground: v("--color-terminal-selection") || "rgba(64,153,255,.28)",
    black: v("--color-terminal-black"), red: v("--color-terminal-red"), green: v("--color-terminal-green"),
    yellow: v("--color-terminal-yellow"), blue: v("--color-terminal-blue"), magenta: v("--color-terminal-magenta"),
    cyan: v("--color-terminal-cyan"), white: v("--color-terminal-white"),
    brightBlack: bright("--color-terminal-bright-black"), brightRed: bright("--color-terminal-bright-red"),
    brightGreen: bright("--color-terminal-bright-green"), brightYellow: bright("--color-terminal-bright-yellow"),
    brightBlue: bright("--color-terminal-bright-blue"), brightMagenta: bright("--color-terminal-bright-magenta"),
    brightCyan: bright("--color-terminal-bright-cyan"), brightWhite: bright("--color-terminal-bright-white"),
  };
}

/**
 * A view of one server terminal: `focus` hands it the keyboard (the person's own hand, never a redraw); `dispose` lets
 * go of the view alone — the terminal keeps running on the server. `onExit` hears its process end, once, with its
 * exit code where the server said one; a stream that closes counts as an end.
 * @typedef {{ focus: () => void, ended: () => boolean, dispose: () => void }} TerminalView
 */

/**
 * Show the server's terminal `id` in `el`.
 * The stream is a press, as the terminal's rows are (http/admin/terminal.js; r-doors, 11-12), and a WebSocket carries
 * no header for the app's key: in the app's window the page's press asks a ticket first, and the view is there once
 * its stream can show it — the keyboard asked for meanwhile is handed over then, and a view let go or put away
 * meanwhile opens nothing. A browser — a paired device's, or one with no app beside it — opens at once, as the gate
 * let it in. No ticket given, the stream opens bare: Filament refuses it, and the view says the stream closed.
 * @param {HTMLElement} el @param {string} id
 * @param {{ onExit?: (code: number | null) => void }} [o]
 * @returns {TerminalView}
 */
export function showTerminal(el, id, o = {}) {
  if (!pressBridge()) return streamIn(el, id, o);
  /** @type {TerminalView | null} */
  let view = null;
  let gone = false;
  let focused = false;
  const letGo = holdWhileShown(() => void (gone = true));
  /** @param {string} ticket */
  const shown = (ticket) => {
    letGo();
    if (gone) return;
    view = streamIn(el, id, o, ticket);
    if (focused) view.focus();
  };
  api(`/terminal/${encodeURIComponent(id)}/ticket`, { method: "POST" }).then((r) => shown(String(r?.ticket || "")), () => shown(""));
  return {
    focus: () => (view ? view.focus() : void (focused = true)),
    ended: () => (view ? view.ended() : gone),
    dispose: () => {
      gone = true;
      view?.dispose();
    },
  };
}

/**
 * The view itself, on the terminal's stream; `ticket`, what the app's window was given to open it with.
 * @param {HTMLElement} el @param {string} id
 * @param {{ onExit?: (code: number | null) => void }} [o] @param {string} [ticket]
 * @returns {TerminalView}
 */
function streamIn(el, id, o = {}, ticket = "") {
  /** @type {any} */
  const page = window;
  const term = new page.Terminal({
    fontFamily: getComputedStyle(document.documentElement).getPropertyValue("--mono") || "Consolas, monospace",
    fontSize: 13,
    theme: termTheme(),
    cursorBlink: true,
    scrollback: 4000,
  });
  // The fit addon's UMD wrapper exposes a namespace: window.FitAddon.FitAddon is the constructor.
  const Fit = page.FitAddon?.FitAddon || page.FitAddon;
  const fit = new Fit();
  term.loadAddon(fit);
  term.open(el);
  // Copy and paste in the pane's own words: Ctrl+C copies only with a selection, else the program keeps ^C.
  term.attachCustomKeyEventHandler((/** @type {KeyboardEvent} */ ev) => {
    if (ev.type !== "keydown") return true;
    if (ev.ctrlKey && ev.key.toLowerCase() === "c" && term.hasSelection()) {
      if (navigator.clipboard) navigator.clipboard.writeText(term.getSelection()).catch(() => {});
      return false;
    }
    if (ev.ctrlKey && ev.key.toLowerCase() === "v") {
      navigator.clipboard?.readText?.().then((t) => t && send({ t: "i", d: t })).catch(() => {});
      return false;
    }
    return true;
  });
  // Loopback admin serves the stream; a deployment with server.adminToken passes ?token= through page config.
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/terminal/${encodeURIComponent(id)}/stream${ticket ? `?ticket=${encodeURIComponent(ticket)}` : ""}`);
  // Put away, the page lets the connection go (ui/lib/put-away.js); brought back, it loads afresh and attaches again.
  // That close is the page's own, not the process's end: nothing is said of an exit (HarnessV4_Tasks U4).
  let putAway = false;
  const letGo = holdWhileShown(() => {
    putAway = true;
    ws.close();
  });
  let ended = false;
  /** @param {any} msg */
  const send = (msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  /** The view's size, to the shell, each once: a shell drawing for another size writes its prompt over lines there. */
  let said = "";
  const sendSize = () => {
    const size = `${term.cols}x${term.rows}`;
    if (ws.readyState !== 1 || size === said) return;
    said = size;
    send({ t: "r", c: term.cols, r: term.rows });
  };
  // The shell takes the size the view comes to rest at: a pane sliding open or dragged gave it one each frame, and a
  // Windows shell wraps its screen again at each, its cursor a line from where the view shows it — typing then landed
  // over earlier lines (the owner's of 11-08). Heard from the start: a fit before the stream opened was lost.
  let settling = /** @type {ReturnType<typeof setTimeout> | null} */ (null);
  const sizeSettled = () => {
    if (settling) clearTimeout(settling);
    settling = setTimeout(() => {
      settling = null;
      sendSize();
    }, SIZE_SETTLE_MS);
  };
  // A resize to the size it has measures the cell where the terminal was opened in a hidden box (xterm's own, which
  // the fit addon needs): else the fit as it shows does nothing, and the terminal stays 80 × 24 in a bigger box. A box
  // smaller than any shell's (a pane sliding open from nothing, a tab not shown) is no size to take: it waits for the
  // next. Till a fit, the view's size is xterm's 80 × 24, nobody's: the shell is told none.
  let fitted = false;
  const refit = () => {
    try {
      term.resize(term.cols, term.rows);
      const d = fit.proposeDimensions();
      if (!(d && d.cols >= LEAST_COLS && d.rows >= LEAST_ROWS)) return;
      fit.fit();
      fitted = true;
      sizeSettled();
    } catch {}
  };
  term.onData((/** @type {string} */ d) => send({ t: "i", d }));
  // The keyboard back in this view, the shell takes its size again: another view of the terminal may have given it
  // its own since.
  term.textarea?.addEventListener("focus", () => {
    if (!fitted) return;
    said = "";
    sizeSettled();
  });
  /** @param {number | null} code */
  const exited = (code) => {
    if (ended) return;
    ended = true;
    term.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
    try { ws.close(); } catch {}
    o.onExit?.(code);
  };
  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data));
      if (msg.t === "o" || msg.t === "b") term.write(msg.d || "");
      // The Windows console behind it, said first (services/terminal.js `attach`): the view grows as it does.
      else if (msg.t === "w") term.options.windowsPty = { backend: msg.backend, buildNumber: msg.buildNumber };
      else if (msg.t === "x") exited(typeof msg.code === "number" ? msg.code : null);
    } catch {}
  };
  // Open, the shell takes this view's size, whatever it had; a tab not shown says its own once it shows.
  ws.onopen = () => refit();
  ws.onclose = () => {
    letGo();
    if (!putAway) exited(null);
  };
  const ro = new ResizeObserver(() => refit());
  ro.observe(el);
  return {
    focus: () => term.focus(),
    ended: () => ended,
    dispose: () => {
      ended = true;
      if (settling) clearTimeout(settling);
      try { ws.close(); } catch {}
      ro.disconnect();
      term.dispose();
    },
  };
}

// @ts-check
// The Terminal pane (§5.9.9, backend B4): real PTY sessions in the side pane, one xterm per session, inner tabs
// with "New terminal" and a per-tab kill, "[Process exited]" when the process ends, and the scrollback a detached
// tab missed replayed on attach (the service's backlog); each shown through lib/xterm.js. A program's terminal (an
// agent's sign-in, HarnessV3-ACP AC3-7) is named by its title. Closing the pane hides a terminal; it keeps running
// (the status panel lists it with Stop); a tab's x, or the server's cap, ends it. Each terminal the server holds has
// a tab: one another window or a program started comes in as the pane is drawn, or within LIST_MS of the run's pulse.
import { h } from "../../lib/dom.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { button } from "../lib/ui.js";
import { showTerminal } from "../lib/xterm.js";

/** How often the run's pulse reads the server's terminals again, for one started elsewhere since. */
export const LIST_MS = 5000;

// The pane host rebuilds its body on every tab switch; the pane's state (the xterms, the sockets) is a singleton so
// a switch away and back never kills a shell. The same nodes are re-adopted by the fresh body.
const strip = h("div", { class: "term-strip" });
const stage = h("div", { class: "term-stage" });
/** What the pane says with no terminal open. */
const EMPTY_WORDS = "No terminal yet — + opens a PowerShell in the chat's folder.";
/** What it says on a view-only device's page (the owner's remote Filament of 11-06, p4-view-ui), which offers no +. */
export const VIEW_ONLY_WORDS = "A view-only device opens no terminal: it reads this Filament's chats.";
const emptyBox = h("div", { class: "pane-empty" }, EMPTY_WORDS);
/** @type {Map<string, { id: string, row: any, view: import("../lib/xterm.js").TerminalView | null, el: HTMLElement, exited: boolean }>} */
const sessions = new Map();
/** @type {string[]} */
const order = [];
let active = "";
/** The terminals whose tabs went: a read of the server's that left before one's stop landed brings none back. @type {Set<string>} */
const dropped = new Set();
/** When the server's terminals were last read. */
let listedAt = 0;
/** @type {(n: number) => void} */
let badge = () => {};
let toast = (/** @type {string} */ _m, /** @type {string} */ _k) => {};
let folderOf = () => "";
/** The page is a view-only device's (`setTerminalsViewOnly`): it opens no terminal and reads none of the server's. */
let viewOnly = false;

function paint() {
  strip.replaceChildren(...order.map(tabEl), ...(viewOnly ? [] : [newBtn()]));
  for (const [id, s] of sessions) s.el.classList.toggle("hidden", id !== active);
  emptyBox.textContent = viewOnly ? VIEW_ONLY_WORDS : EMPTY_WORDS;
  emptyBox.classList.toggle("hidden", !!active);
  badge(order.length);
  // No focus here: a pane redraw mid-run must not steal the keyboard from the composer. A tab click or a new
  // terminal — the developer's own hand — focuses the xterm.
}

/** @param {string} id */
function tabEl(id) {
  const s = sessions.get(id);
  const name = s?.row?.title || String(s?.row?.cwd || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "terminal";
  const t = h("button", {
    class: `term-tab${id === active ? " on" : ""}`, type: "button",
    title: `${s?.row?.cwd || ""}${s?.exited ? " — [Process exited]" : ""} — click to show, × to stop`,
    onclick: () => { active = id; paint(); sessions.get(active)?.view?.focus(); },
  }, `${s?.exited ? "⚠ " : ""}${name}`);
  t.append(h("button", {
    class: "term-tab-x", type: "button", title: "Stop this terminal", html: ICONS.x || "×",
    onclick: (/** @type {any} */ e) => { e.stopPropagation(); kill(id); },
  }));
  return t;
}

const newBtn = () => button({
  variant: "ghost", size: "icon-xs", icon: "plus", class: "term-new",
  title: "New terminal — a PowerShell in the chat's project folder",
  onClick: async () => {
    const cwd = folderOf();
    if (!cwd) { toast("Choose the project folder first: the terminal works there", "err"); return; }
    try {
      const r = await api("/terminal", { method: "POST", body: { cwd, cols: 80, rows: 24 } });
      await mount(r.terminal, { focus: true });
    } catch (e) {
      toast(String(/** @type {any} */ (e)?.message || e), "err");
    }
  },
});

/** Attach a session: its view and its tab. Detach (a pane switch) keeps both alive.
 * @param {any} row @param {{ focus?: boolean, show?: boolean }} [o]  `focus`: the xterm takes the keyboard — the
 *   developer's own hand (a new terminal), never a redraw; `show`: its tab is the one shown — false for one that comes
 *   while another shows, which takes a tab and not the stage */
async function mount(row, { focus = false, show = true } = {}) {
  if (sessions.has(row.id)) { active = row.id; paint(); if (focus) sessions.get(active)?.view?.focus(); return; }
  const el = h("div", { class: "term-session hidden" });
  /** @type {{ id: string, row: any, view: import("../lib/xterm.js").TerminalView | null, el: HTMLElement, exited: boolean }} */
  const s = { id: row.id, row, view: null, el, exited: false };
  sessions.set(row.id, s);
  order.push(row.id);
  if (show) active = row.id;
  stage.append(el);
  s.view = showTerminal(el, row.id, { onExit: () => { s.exited = true; paint(); } });
  paint();
  if (focus) s.view.focus();
}

/**
 * The server's terminals, each without a tab given one: those that outlived this body, and those another window or a
 * program started since. A tab whose terminal went stays gone; with a tab shown, the shown one stays.
 * @param {any[]} rows
 */
function adopt(rows) {
  const show = !active;
  for (const row of rows) if (!sessions.has(row.id) && !dropped.has(row.id)) void mount(row, { show });
}

/** The server's terminals read, and each without a tab given one. */
function look() {
  listedAt = Date.now();
  api("/terminal").then((r) => adopt(r.terminals || [])).catch(() => {});
}

/**
 * A tab's ×: its terminal stopped, and its tab gone. A stop that failed keeps the tab, and says so — its process may
 * run on — unless the server no longer holds the terminal.
 * @param {string} id
 */
async function kill(id) {
  try {
    await api(`/terminal/${encodeURIComponent(id)}/kill`, { method: "POST" });
  } catch (e) {
    const held = await api("/terminal").then((r) => (r.terminals || []).some((/** @type {any} */ t) => t.id === id), () => true);
    if (held) {
      toast(`The terminal was not stopped: ${String(/** @type {any} */ (e)?.message || e)}`, "err");
      return;
    }
  }
  drop(id);
}

/** @param {string} id */
function drop(id) {
  const s = sessions.get(id);
  if (!s) return;
  dropped.add(id);
  s.view?.dispose();
  s.el.remove();
  sessions.delete(id);
  const i = order.indexOf(id);
  if (i >= 0) order.splice(i, 1);
  if (active === id) active = order[Math.max(0, i - 1)] || "";
  paint();
}

/**
 * @param {HTMLElement} body
 * @param {{ chat?: any, setBadge?: (n: number) => void, onToast?: (m: string, k?: string) => void, getFolder?: () => string, head?: HTMLElement }} ctx
 *   `head`: the tile's place for the pane's own controls (proposal_ux §3.5) — the shells' tabs and + go there
 */
export function renderTerminal(body, ctx) {
  badge = ctx.setBadge || (() => {});
  toast = ctx.onToast || toast;
  folderOf = ctx.getFolder || folderOf;
  if (ctx.head) ctx.head.replaceChildren(strip);
  body.append(h("div", { class: "pane-scroll term-pane" }, ctx.head ? null : strip, emptyBox, stage));
  paint();
  // Terminals that outlived this body (the pane was closed, the page reloaded), or that another window or a program
  // started, come in as tabs; their streams attach and the service replays what they printed while nobody watched.
  if (!viewOnly) look();
}

/**
 * The host's pulse: the pane stays as it stands — its terminals stream by themselves — and the server's terminals are
 * read again once LIST_MS has passed since the last read; a body that holds no terminal pane is drawn afresh.
 * @param {HTMLElement} body @param {Parameters<typeof renderTerminal>[1]} ctx
 */
export function refreshTerminal(body, ctx) {
  if (!body.contains(stage)) {
    body.replaceChildren();
    renderTerminal(body, ctx);
    return;
  }
  if (!viewOnly && Date.now() - listedAt >= LIST_MS) look();
}

/**
 * The page is a view-only device's, or not (app.js `paintViewOnly`, from /api/state; p4-view-ui): the pane says a
 * view-only device opens no terminal, offers no +, and reads none of the server's — each refused it. Drawn at once,
 * where the pane already shows.
 * @param {boolean} on
 */
export function setTerminalsViewOnly(on) {
  if (viewOnly === on) return;
  viewOnly = on;
  paint();
}

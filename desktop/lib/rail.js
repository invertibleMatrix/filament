// @ts-check
// The machines of one harness window (the owner's remote Filament of 11-06, Part 3; a switcher in the top bar in the
// rail's place since the owner's of 11-08, from the Mac over LAN: the rail took a column and another machine's page a
// title row of its own). This computer's harness stays the window's own page, as it always was; once another machine
// is kept (lib/machines.js), each harness page in the window shows a chip left of Changes — the machine it is, its
// state, how many chats wait on you on the others (src/ui/harness/lib/machine-chip.js) — and a press opens the app's
// own popover under it (rail.html): each machine, the one pressed shown, and Add a machine. Each other machine is a view
// of its own over the whole window, where This computer's page stands: sandboxed, isolated, in its machine's partition,
// so its cookie is its alone, its connection checked against the certificate that machine was paired with
// (`certVerdict`); of the app's bridges it has machine-preload.cjs alone — its own chip's state, its press, the room the
// window's controls take over it (`lentFrame`), and its Browser pane's place for the pages this app holds for that
// machine (`machinePane`, b-remote) — never another machine's name or any other bridge. The app's page — the
// popover, the Add sheet — is a view over the window while one shows, see-through around the popover, so it stays while
// this computer's Filament restarts. `createRail` runs it over Electron's pieces, handed in; it imports no Electron.
import { X509Certificate } from "node:crypto";
import { samePrint } from "../../src/core/x509.js";
import { esc, markTile } from "./card.js";
import { BAR_H, overlayColors } from "./frame.js";
import { COLOR_HEX, ICON_WORDS, LOCAL_ID, LOCAL_NAME, MACHINE_COLORS, MACHINE_ICONS, MAX_MACHINES, colorOf, iconOf, idOf, machineInSlot, machineWatch, partitionGen, partitionOf, pickRoute, pinsFor, slotOfInput } from "./machines.js";
import { glyphOf } from "../../src/ui/harness/lib/icons.js";
import { CLAIM_FROM, checkMachine, claimOutcome, claimScript, deviceNameHere } from "./add-machine.js";
import { cleanName } from "../../src/services/machine.js";
import { aliasOf } from "./ssh-route.js";
import { tailnetFilaments } from "./tailnet-peers.js";

/** How often each other machine is asked whether it answers, while one is kept. */
export const LOOK_EVERY_MS = 10_000;
/** This computer's page with no region that drags, put in while a view lies over it (createRail's `undrag`). */
export const UNDRAG_CSS = "*, *::before, *::after { -webkit-app-region: no-drag !important; }";
/**
 * Its column beside its list with none, while another machine's chat is shown over that column alone (`showChat`): the
 * list's top row still drags the window, and the chat's own header does over the rest. The column is the shell's
 * (src/ui/harness/shell.js `contentCol`), the place the page gives.
 */
export const UNDRAG_COLUMN_CSS = ".content-col, .content-col *, .content-col *::before, .content-col *::after { -webkit-app-region: no-drag !important; }";
/** The chats one view shows in place before it is made anew: a page moved from chat to chat for long keeps nodes it drew (the leak hunt of 11-19). */
export const GUEST_MOVES = 24;
/** An address of a machine's harness: `#/`, one part after the mark, no space. */
const HARNESS_HASH = /^#\/[^\s#]*$/;

/**
 * What This computer's page asks to show in place (harness-preload.cjs `showChat`), read as the app takes it: the
 * machine by its id, an address of its harness, the column's rectangle in the window's units (browser-host.js
 * `placeRect`'s rule: the page's pixels times its zoom, inside the window), the look, light or dark, and whether the
 * keys go to it (`focus`, true alone). Null for anything else. @param {any} p @param {number} zoom
 * @param {{ width: number, height: number }} content
 * @param {(rect: unknown, zoom: number, content: { width: number, height: number }) => Rect | null} place
 * @returns {{ id: string, hash: string, rect: Rect | null, theme: "light" | "dark", focus: boolean } | null}
 */
export function showAsk(p, zoom, content, place) {
  const id = String(p?.machine ?? "");
  const hash = String(p?.route ?? "");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(id) || id === LOCAL_ID || !HARNESS_HASH.test(hash) || hash.length > 2000) return null;
  return { id, hash, rect: place(p?.rect, zoom, content), theme: p?.theme === "light" ? "light" : "dark", focus: p?.focus === true };
}

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {import("./machines.js").Machine} Machine
 * @typedef {import("./machines.js").Watched} Watched
 * @typedef {import("./machines.js").Tried} Tried
 */

/**
 * Where each part stands in the window's content. Another machine showing: its view over the whole window, as This
 * computer's page stands — the window's title bar its top row, as it is that page's. The app's page (the popover, the
 * Add sheet: `over`) over the whole window too, the rest standing as it was under it.
 * @param {{ width: number, height: number }} content @param {{ remote: boolean, over?: boolean }} o
 * @returns {{ over: Rect | null, view: Rect | null }}
 */
export function switchLayout(content, { remote, over = false }) {
  const all = { x: 0, y: 0, width: Math.max(0, Math.round(content.width)), height: Math.max(0, Math.round(content.height)) };
  return { over: over ? all : null, view: remote ? { ...all } : null };
}

/** The room a Mac's close, minimize and zoom take at the top row's left, until This computer's page says its own. */
export const MAC_LEFT = 78;
/** The room Windows' (and Linux Electron's) minimize, maximize and close take at its right, until the page says its own. */
export const WIN_RIGHT = 138;

/**
 * The room the window's controls take over the top row, lent to another machine's page — no Window Controls Overlay
 * reaches a view of the window's own, so its page cannot read it (src/ui/harness/lib/app-frame.js `startLentFrame`) —:
 * as This computer's page last said it (`area`, in the window's units), else the system's own; in that page's pixels at
 * its `zoom`. None in full screen, where no controls stand over it. `at`: the page's place in a window `width` wide,
 * where it stands beside This computer's list (a chat shown in place, `showChat`): what of that room lies over it.
 * @param {{ platform?: string, full?: boolean, area?: { left: number, right: number } | null, zoom?: number, at?: Rect | null, width?: number }} o
 * @returns {{ left: number, right: number } | null}
 */
export function lentFrame({ platform = process.platform, full = false, area = null, zoom = 1, at = null, width = 0 }) {
  if (full) return null;
  const a = area ?? (platform === "darwin" ? { left: MAC_LEFT, right: 0 } : { left: 0, right: WIN_RIGHT });
  const z = zoom > 0 ? zoom : 1;
  const px = (/** @type {number} */ n) => Number((Math.max(0, Number(n) || 0) / z).toFixed(3));
  if (!at) return { left: px(a.left), right: px(a.right) };
  return { left: px((Number(a.left) || 0) - at.x), right: px((Number(a.right) || 0) - Math.max(0, width - (at.x + at.width))) };
}

/**
 * The View menu's zoom, as Electron's roles have it — the focused page's, by their keys — and the rail told after each:
 * nothing else says a page's zoom moved, so a zoom by the keys left This computer's page sized for the zoom it had,
 * under the rail or apart from it, until the window next moved (the hunt of p3-add).
 * @param {{ page: () => any, zoomed: () => void }} o  `page`: the page the keys are for; `zoomed`: the rail told
 */
export const zoomRows = ({ page, zoomed }) => {
  const by = (/** @type {number | null} */ step) => () => {
    const p = page();
    if (!p || p.isDestroyed?.()) return;
    p.setZoomLevel(step === null ? 0 : p.getZoomLevel() + step);
    zoomed();
  };
  return [
    { label: "Actual Size", accelerator: "CommandOrControl+0", click: by(null) },
    { label: "Zoom In", accelerator: "CommandOrControl+Plus", click: by(0.5) },
    { label: "Zoom Out", accelerator: "CommandOrControl+-", click: by(-0.5) },
  ];
};

/**
 * @typedef {{ id: string, name: string, status: import("./machines.js").MachineStatus, why: string | null, active: boolean, slot: number | null, local: boolean, waiting: number, color: string, icon: string }} RailRow
 * @typedef {{ label: string, click?: () => void, type?: "radio", checked?: boolean, swatch?: string, submenu?: MenuRow[] } | { type: "separator" }} MenuRow
 *   a row of a machine's own menu, as Electron's menu takes it; `swatch`: a colour's dot beside it (#rrggbb), which the app draws
 */

/**
 * The machines as the switcher has them: each in its order, its state, the one showing, the key that shows it
 * (Ctrl+1..9), how many of its chats wait on you, and its colour and icon. A machine not asked yet is reconnecting.
 * @param {readonly Machine[]} machines
 * @param {(id: string) => Watched | null} watched  each machine's state; This computer's is the app's own
 * @param {string} active
 * @param {(id: string) => number} [waiting]  its chats that wait on you, as the app's watch last saw them
 * @returns {RailRow[]}
 */
export function railRows(machines, watched, active, waiting = () => 0) {
  return machines.map((m, i) => {
    const w = watched(m.id);
    const n = Math.max(0, Math.floor(Number(waiting(m.id)) || 0));
    return { id: m.id, name: m.name, status: w?.status ?? "reconnecting", why: w?.why ?? null, active: m.id === active, slot: i < 9 ? i + 1 : null, local: !!m.local, waiting: n, color: colorOf(m), icon: iconOf(m) };
  });
}

const STATUS_WORDS = { online: "connected", reconnecting: "reconnecting", offline: "offline", disconnected: "disconnected" };
/** What a disconnected machine's row says it takes: a pick connects it again (`select`). */
const PICK_TO_CONNECT = "pick it to connect again";
/** A disconnected machine's state: never asked, so never reconnecting nor offline. @type {Watched} */
const OFF_WATCHED = Object.freeze({ status: /** @type {const} */ ("disconnected"), silentSince: null, why: null });
const PLUS_SVG = `<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 4.5v11M4.5 10h11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
const TICK_SVG = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const MORE_SVG = `<svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true"><circle cx="5" cy="10" r="1.4" fill="currentColor"/><circle cx="10" cy="10" r="1.4" fill="currentColor"/><circle cx="15" cy="10" r="1.4" fill="currentColor"/></svg>`;
/** A count as a badge says it. @param {number} n */
export const countWords = (n) => (n > 99 ? "99+" : String(n));

/**
 * The app's page's state: the popover's rows — each machine a menu item with its state's dot, its icon in its colour,
 * its name, why where it is not connected — a disconnected one, that a pick connects it —, its count of chats that wait
 * on you, a tick on the one showing and its key; its own More beside it (its Colour and Icon; another machine's
 * Disconnect or Connect, and Remove too) — and Add a machine; where the chip pressed stands (`at`, in the page's pixels); and whether
 * the Add sheet is open. Everything a machine names is escaped: a name is the person's, a why may hold what a network
 * answered.
 * @param {readonly RailRow[]} rows
 * @param {{ dark: boolean, colors?: { color: string, symbolColor: string } | null, mod?: string, bar?: number, adding?: boolean, at?: Rect | null }} o  `colors`: the title bar's, as This computer's page said them
 * @returns {{ list: string, at: Rect | null, dark: boolean, bg: string, fg: string, bar: number, adding: boolean }}
 */
export function railState(rows, { dark, colors = null, mod = "Ctrl+", bar = 0, adding = false, at = null }) {
  const list =
    rows
      .map((r) => {
        const words = STATUS_WORDS[r.status];
        const off = r.status === "disconnected";
        const why = r.status === "online" ? "" : off ? `${words} — ${PICK_TO_CONNECT}` : r.why ? `${words} — ${r.why}` : words;
        const tip = `${r.name} — ${words}${r.slot ? ` · ${mod}${r.slot}` : ""}${off ? `\n${PICK_TO_CONNECT[0].toUpperCase()}${PICK_TO_CONNECT.slice(1)}.` : r.why && r.status !== "online" ? `\n${r.why}` : ""}`;
        const label = `${r.name}, ${words}${r.waiting ? `, ${r.waiting} waiting on you` : ""}`;
        return (
          `<div class="row s-${r.status}${r.active ? " on" : ""}" role="none">` +
          `<button type="button" class="pick" role="menuitemradio" aria-checked="${r.active}" data-machine="${esc(r.id)}" title="${esc(tip)}" aria-label="${esc(label)}">` +
          `<i class="dot"></i><span class="mi c-${esc(r.color)}">${glyphOf(r.icon)}</span><span class="nm"><b>${esc(r.name)}</b>${why ? `<small>${esc(why)}</small>` : ""}</span>` +
          (r.waiting ? `<span class="ct">${countWords(r.waiting)}</span>` : "") +
          `<span class="tick">${r.active ? TICK_SVG : ""}</span>${r.slot ? `<kbd>${esc(`${mod}${r.slot}`)}</kbd>` : "<kbd></kbd>"}</button>` +
          `<button type="button" class="more" data-more="${esc(r.id)}" title="${esc(`${r.name}: Colour, Icon${r.local ? "" : `, ${off ? "Connect" : "Disconnect"}, Remove…`}`)}" aria-label="${esc(`More for ${r.name}`)}">${MORE_SVG}</button>` +
          `</div>`
        );
      })
      .join("") + `<div class="sep" role="separator"></div><button type="button" class="pick add" role="menuitem" data-add="">${PLUS_SVG}<span class="nm"><b>Add a machine…</b></span></button>`;
  const bg = colors?.color || (dark ? "#202020" : "#f3f3f3");
  const fg = colors?.symbolColor || (dark ? "#ffffff" : "#1a1a1a");
  return { list, at, dark, bg, fg, bar, adding };
}

/**
 * What a harness page of the window hears for its chip: shown once another machine is kept, the machine the page is —
 * its name, its state, its colour and icon —, how many chats wait on you on the others, whether its popover is open,
 * and — another machine's page — the room the window's controls take over its top row (`lentFrame`). Nothing of any
 * other machine but that count.
 * @param {readonly RailRow[]} rows @param {string} id  the page's machine
 * @param {{ open?: boolean, frame?: { left: number, right: number } | null }} [o]
 */
export function pageState(rows, id, { open = false, frame = null } = {}) {
  const me = rows.find((r) => r.id === id);
  const waiting = rows.reduce((n, r) => n + (r.id === id ? 0 : r.waiting), 0);
  return { shown: rows.length > 1, name: me?.name ?? "", status: me?.status ?? "reconnecting", color: me?.color ?? "", icon: me?.icon ?? "", waiting, open: !!open, frame };
}

/**
 * Another machine's view, as Electron makes it: sandboxed, isolated, no Node, no preload — the app's bridge
 * (harness-preload.cjs) is This computer's page's alone — in that machine's partition.
 * @param {Machine} machine
 * @returns {{ contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, partition: string }}
 */
export function remotePrefs(machine) {
  if (machine.local || !machine.partition.startsWith("persist:machine-")) throw new Error(`${machine.id} is no other machine`);
  return { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true, partition: machine.partition };
}

/**
 * A machine's partition's word on a certificate (Electron's `setCertificateVerifyProc`): on a host its network routes
 * pin, the pinned certificate alone (0) and any other refused (-2) — its cookie goes nowhere else; any other host
 * Chromium's own check (-3), as any site's (tailscale serve's certificate an authority signed).
 * @param {Machine} machine @param {{ hostname: string, certificate?: { data?: string } }} request
 * @returns {0 | -2 | -3}
 */
export function certVerdict(machine, request) {
  const pins = pinsFor(machine, request.hostname);
  if (!pins.length) return -3;
  let print = "";
  try {
    print = new X509Certificate(String(request.certificate?.data || "")).fingerprint256;
  } catch {
    return -2;
  }
  return pins.some((p) => samePrint(p, print)) ? 0 : -2;
}

/** A route's origin, or null. @param {any} route */
export function originOfRoute(route) {
  try {
    return new URL(String(route?.url)).origin;
  } catch {
    return null;
  }
}

/**
 * The address a machine's view opens at a route: its harness — through an SSH tunnel with the alias it is reached by
 * (`?ssh=`), which the harness opens a folder of it in your editor by (src/ui/harness/lib/api.js `sshAlias`).
 * @param {any} route
 */
export const harnessAt = (route) => {
  const alias = route?.kind === "ssh" ? aliasOf(route.alias) : "";
  return `${originOfRoute(route)}/ui/harness.html${alias ? `?ssh=${encodeURIComponent(alias)}` : ""}`;
};

/**
 * A page loaded in a view, and waited for itself. Electron's loadURL takes an earlier navigation this one cuts off — the
 * app's own page on its way after the machine's page failed — for this one's failure (the drive of p3-add: a pairing
 * after its certificate was made anew); then this one is waited for by its own load's events.
 * @param {any} wc @param {string} url
 * @returns {Promise<void>}
 */
export const loadOwn = (wc, url) =>
  Promise.resolve(wc.loadURL(url)).then(
    () => undefined,
    (/** @type {any} */ e) => {
      const said = String(e?.message || e);
      if (!/\(-3\)|ERR_ABORTED/.test(said) || said.includes(`'${url}'`)) throw e;
      if (!wc.isLoading?.() && wc.getURL?.() === url) return undefined;
      return new Promise((ok, no) => {
        const done = () => {
          wc.removeListener?.("did-finish-load", fin);
          wc.removeListener?.("did-fail-load", fail);
        };
        const fin = () => {
          if (wc.getURL?.() !== url) return;
          done();
          ok(undefined);
        };
        const fail = (/** @type {any} */ _e, /** @type {number} */ code, /** @type {string} */ desc, /** @type {string} */ u, /** @type {boolean} */ main) => {
          if (!main || u !== url || code === -3) return;
          done();
          no(new Error(`${desc || "ERR_FAILED"} (${code}) loading '${url}'`));
        };
        wc.on("did-finish-load", fin);
        wc.on("did-fail-load", fail);
      });
    },
  );

/**
 * A machine's view while none of its routes answers as it: the app's own page — its name, each route's why, and that it
 * is tried again — a `data:` address, nothing of anyone's in it. Its top row drags the window, as a harness's does, and
 * its one script is Switch machine's press: the app's popover under it, where the view's bridge is
 * (machine-preload.cjs) — a machine that cannot be reached never leaves the window without the way to another.
 * @param {string} name @param {readonly { url: string, why: string }[]} tried @param {{ dark: boolean, every?: number, bar?: number }} o
 */
export function unreachablePage(name, tried, { dark, every = LOOK_EVERY_MS, bar = BAR_H }) {
  const c = dark ? { bg: "#1e1e1e", text: "rgba(255,255,255,0.93)", quiet: "rgba(235,235,245,0.6)", line: "rgba(255,255,255,0.22)" } : { bg: "#ffffff", text: "rgba(0,0,0,0.88)", quiet: "rgba(60,60,67,0.66)", line: "rgba(0,0,0,0.2)" };
  const rows = tried.map((t) => `<li>${esc(t.why)}</li>`).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(name)}</title><style>
html,body{margin:0;height:100%;background:${c.bg};color:${c.text};font:13px/1.45 "Segoe UI Variable Text","Segoe UI",system-ui,sans-serif;-webkit-font-smoothing:antialiased;cursor:default}
.bar{position:fixed;left:0;right:0;top:0;height:${Math.max(0, Math.round(bar))}px;-webkit-app-region:drag}
.main{box-sizing:border-box;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 24px 64px;text-align:center}
.tile{background:linear-gradient(180deg,#38bdf8,#0284c7);display:grid;place-items:center;margin-bottom:6px}
.title{font-size:17px;font-weight:650}.line,li{color:${c.quiet}}ul{margin:4px 0 0;padding-left:18px;max-width:560px;text-align:left}
button{margin-top:8px;font:inherit;font-weight:600;padding:6px 14px;border-radius:8px;cursor:pointer;color:inherit;background:transparent;border:1px solid ${c.line}}
</style></head><body><div class="bar"></div><div class="main" role="status" aria-live="polite">${markTile(44)}<div class="title">${esc(name)} cannot be reached</div><div class="line">Filament tries again every ${Math.round(every / 1000)} s, and opens it here as soon as it answers.</div>${rows ? `<ul>${rows}</ul>` : ""}<button type="button" id="switch" hidden>Switch machine</button></div><script>${SWITCH_SCRIPT}</script></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}
/** The unreachable page's one script: Switch machine shown where the view's bridge is, its press the app's popover under it. */
const SWITCH_SCRIPT = `(()=>{const m=window.filamentMachines,b=document.getElementById("switch");if(!m||!b)return;b.hidden=false;b.onclick=()=>{const r=b.getBoundingClientRect();m.open({x:r.left,y:r.top,width:r.width,height:r.height})}})()`;

/**
 * @typedef {{ view: any, at: string | null, page?: string, shown: string, opening: boolean, popups: Set<any>, wanted?: { hash: string, asked: number } | null,
 *   only?: string, chat?: string, moves?: number }} RemoteView
 *   `at`: the origin its page is Filament's at, null while it shows the app's own page; `page`: the harness's address
 *   it was sent to there, its hash left out; `shown`: the app's page shown, as last drawn; `popups`: the windows its
 *   pages opened, in its partition — closed with it; `wanted`: the address of its harness it opens at next, asked for
 *   while its page was the app's own (`openOn`), and when — past `WANTED_MS` it is let go; `only`: the query its page
 *   shows a chat alone by (`only=chat&theme=…`, `showChat`), "" for its whole page; `chat`: the chat it shows so, as its
 *   address last said; `moves`: the chats it was moved to so since its page was made
 */

/**
 * How long an address asked of a machine's page while that machine does not answer is kept for it: one that answers
 * within it opens there; later, the person has moved on, and its page opens where it would.
 */
export const WANTED_MS = 60_000;

/**
 * The machines of one harness window, over Electron's pieces handed in: `View` (WebContentsView), `sessionOf` (a
 * partition's session), the app's page and its preload (`railPage`, `railPreload`: the popover and the Add sheet),
 * `machinePreload` (another machine's view's one bridge), `machines()` (read now, This computer first), `localWatched()`
 * (the app's word on its own Filament), `look()` (dark, and the title bar's colours as This computer's page said them),
 * `guard(contents, { originOf, prefs })` (the app's own guard over a page: what it may open, keep, ask), `grants(session,
 * originOf)` (its permission handlers). Each other machine's view is made the first time it is shown, its route picked
 * (`pickRoute`) and its harness opened there, or the app's page saying why not; then each is asked every
 * `LOOK_EVERY_MS` while one is kept: one that answers again is opened, and a page whose address stopped answering moves
 * to one that answers.
 * @param {{ win: any, View: any, sessionOf: (partition: string) => any, railPage: string, railPreload: string, machinePreload?: string,
 *   machines: () => Machine[], localWatched: () => Watched, look: () => { dark: boolean, colors: { color: string, symbolColor: string } | null },
 *   guard: (contents: any, o: { originOf: () => string | null, prefs: object, onChild: (child: any) => void }) => void, grants: (ses: any, originOf: () => string | null) => void,
 *   pick?: typeof pickRoute, log?: (line: string) => void, now?: () => number, every?: typeof setInterval, stopEvery?: typeof clearInterval, platform?: string,
 *   keep?: { add: (m: { id: string, name: string, routes: import("./machines.js").Route[], partition?: string }) => Machine, remove: (id: string) => boolean, off?: (id: string, off: boolean) => Machine | null, rename?: (id: string, name: string) => Machine | null,
 *     look?: (id: string, look: { color?: string | null, icon?: string | null }) => unknown },
 *   check?: typeof checkMachine, deviceName?: () => string, claimMs?: number, menu?: (rows: MenuRow[]) => void, confirm?: (q: { title: string, detail: string, yes: string }) => Promise<boolean>,
 *   ownId?: () => string | null | Promise<string | null>, peers?: () => Promise<import("./tailnet-peers.js").TailnetLook>,
 *   waiting?: (id: string) => number, tint?: (colors: { color: string, symbolColor: string } | null) => void,
 *   browserOf?: (id: string) => { lift: (win: any) => void, parkAll: (win: any) => void } | null, onGuest?: (g: { id: string, hash: string | null }) => void }} o
 *   `keep`: the machines kept, added, removed, disconnected and connected again, and their colour and icon chosen
 *   (lib/machines.js over the app's file); `menu`: a machine's own menu, at the pointer; `confirm`: the app's question before a machine goes; `ownId`: this computer's own Filament's id, which
 *   is never added as another machine; `peers`: the tailnet's machines that answer as a Filament; `waiting`: each
 *   machine's chats that wait on you, as the app's watch last saw them; `tint`: the window's controls dressed in the
 *   colours of the machine's page that shows — null, This computer's; `browserOf`: a machine's chats' pages this app
 *   holds (lib/machine-browser.js), drawn over its view's Browser pane — put back on top as its view comes to the front,
 *   parked as it goes from sight; `onGuest`: the chat shown in place moved — its address there as its page went to it,
 *   null as it stopped showing there (`showChat`)
 */
export function createRail({ win, View, sessionOf, railPage, railPreload, machinePreload = "", machines, localWatched, look, guard, grants, pick = pickRoute, log = () => {}, now = Date.now, every = setInterval, stopEvery = clearInterval, platform = process.platform, keep = { add: () => { throw new Error("no machines file"); }, remove: () => false, off: () => null }, check = checkMachine, deviceName = deviceNameHere, claimMs = 20_000, menu = () => {}, confirm = async () => false, ownId = () => null, peers = () => tailnetFilaments(), waiting = () => 0, tint = () => {}, browserOf = () => null, onGuest = () => {} }) {
  const wc = win.webContents;
  /** @type {Machine[]} */
  let list = [];
  let active = LOCAL_ID;
  /** The app's page over the window: the popover, the Add sheet. @type {any} */
  let rail = null;
  /** @type {Map<string, RemoteView>} */
  const views = new Map();
  /** @type {Map<string, Watched>} */
  const watched = new Map();
  /** Partitions whose session has the machine's certificate check and permissions. */
  const armed = new Set();
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let looking = false;
  let gone = false;
  let bar = 0;
  /** The Add sheet open over the window. */
  let adding = false;
  /** The popover open: under the chip pressed (`at`, in the window's units), on the page of `from`. @type {{ at: Rect, from: string } | null} */
  let popping = null;
  /** The room the window's controls take over the top row, as This computer's page last said it (window units). @type {{ left: number, right: number } | null} */
  let area = null;
  /** The colours each other machine's page asked its title bar to wear (`hearsPage`'s titleBar). @type {Map<string, { color: string, symbolColor: string }>} */
  const tints = new Map();
  /** What each page last heard, by its machine: one is told again only what moved. @type {Map<string, string>} */
  const told = new Map();
  /** Each machine a pairing has in hand, as it will be kept: its view's certificate check reads it meanwhile. @type {Map<string, Machine>} */
  const pairing = new Map();
  /** How many pairings each machine has had: an ask from before the last one is stale. @type {Map<string, number>} */
  const pairings = new Map();
  /** The name each machine answered by that the machines file could not keep: not tried again until it answers by another. @type {Map<string, string>} */
  const unkept = new Map();
  /**
   * Another machine's chat shown in place (the remote desk of 11-22): its view over This computer's column beside its
   * list, at `rect` in the window's units — null while something of This computer's page lies over that column, its
   * view then out of sight —, while This computer shows. @type {{ id: string, rect: Rect | null } | null}
   */
  let guest = null;
  const zoomOf =(/** @type {any} */ c = wc) => {
    try {
      return Number(c.getZoomFactor?.()) || 1;
    } catch {
      return 1;
    }
  };

  const shown = () => list.length > 1;
  const machineOf = (/** @type {string} */ id) => pairing.get(id) || list.find((m) => m.id === id) || null;
  const statusOf = (/** @type {string} */ id) => (id === LOCAL_ID ? localWatched() : machineOf(id)?.off ? OFF_WATCHED : (watched.get(id) ?? null));
  const alive = (/** @type {any} */ v) => !!v && !v.webContents.isDestroyed();
  const rowsNow = () => railRows(list, statusOf, active, waiting);
  /** The page a machine is in the window: This computer's, or its view's while that lives. @param {string} id */
  const pageOf = (id) => (id === LOCAL_ID ? wc : views.get(id) && alive(views.get(id)?.view) ? views.get(id)?.view.webContents : null);
  /** The chat shown in place, while it is in sight: This computer showing, its place given, its view alive. */
  const guestShown = () => (!!guest && active === LOCAL_ID && !!guest.rect && alive(views.get(guest.id)?.view) ? guest : null);
  /** The machine whose page is before the person: the one showing, else the chat shown in place's, else This computer. */
  const showing = () => (active !== LOCAL_ID ? active : (guestShown()?.id ?? LOCAL_ID));
  /** A view's page's address with the chat alone's query where it shows one. @param {RemoteView} v */
  const pageUrl = (v) => (v.only ? `${v.page}${String(v.page).includes("?") ? "&" : "?"}${v.only}` : String(v.page));
  /** An address's hash. @param {string} url */
  const hashOf = (url) => {
    try {
      return new URL(String(url)).hash;
    } catch {
      return "";
    }
  };
  /** The chat shown in place gone from it: This computer's page told. */
  const unguest = () => {
    if (!guest) return;
    const id = guest.id;
    guest = null;
    onGuest({ id, hash: null });
  };

  /** Each harness page told its chip's state — only what moved —; `again`: that one told whatever it heard before. @param {string | null} [again] */
  const tell = (again = null) => {
    const rows = rowsNow();
    const placed = guestShown();
    for (const id of [LOCAL_ID, ...views.keys()]) {
      const page = pageOf(id);
      if (!page || page.isDestroyed?.()) continue;
      // A chat shown in place is lent what of the controls' room lies over its column alone.
      const at = placed && placed.id === id ? placed.rect : null;
      const frame = id === LOCAL_ID ? null : lentFrame({ platform, full: !!win.isFullScreen?.(), area, zoom: zoomOf(page), at, width: at ? win.getContentSize()[0] : 0 });
      const s = pageState(rows, id, { open: popping?.from === id, frame });
      const said = JSON.stringify(s);
      if (said === told.get(id) && again !== id) continue;
      told.set(id, said);
      try {
        page.send("filament:machines", s);
      } catch {}
    }
  };
  const paint = () => {
    tell();
    if (!alive(rail)) return;
    const { dark, colors } = look();
    const z = zoomOf(rail.webContents);
    const at = popping ? { x: popping.at.x / z, y: popping.at.y / z, width: popping.at.width / z, height: popping.at.height / z } : null;
    rail.webContents.send("filament:rail-state", railState(rowsNow(), { dark, colors, mod: platform === "darwin" ? "⌘" : "Ctrl+", bar, adding, at }));
  };

  /** A key that names a slot, from any page of the window: that machine shown. @param {any} e @param {any} input */
  const keys = (e, input) => {
    if (!shown()) return;
    const m = machineInSlot(list, slotOfInput(input, platform) ?? 0);
    if (!m) return;
    e.preventDefault();
    select(m.id);
  };
  wc.on("before-input-event", keys);

  const railOf = () => {
    if (alive(rail)) return rail;
    rail = new View({ webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, preload: railPreload } });
    // See-through: the popover lies over the page it was opened from, which stays seen around it.
    rail.setBackgroundColor?.("#00000000");
    rail.webContents.on("will-navigate", (/** @type {any} */ e) => e.preventDefault());
    rail.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
    rail.webContents.on("before-input-event", keys);
    rail.webContents.on("did-finish-load", paint);
    void Promise.resolve(rail.webContents.loadURL(railPage)).catch((/** @type {any} */ e) => log(`rail: its page did not load (${String(e?.message || e)})`));
    win.contentView.addChildView(rail);
    return rail;
  };

  /**
   * A machine's partition, set up once: its certificate check and its permissions. Chromium keeps each verdict the
   * check gives for the partition's life, so a certificate the machine was never paired with is met in a partition anew
   * (`add`, machines.js `partitionOf`).
   * @param {Machine} m
   */
  const arm = (m) => {
    if (armed.has(m.partition)) return;
    armed.add(m.partition);
    const ses = sessionOf(m.partition);
    // The machine as kept now: paired again, its new fingerprint is the one checked.
    ses.setCertificateVerifyProc((/** @type {any} */ request, /** @type {(n: number) => void} */ done) => done(certVerdict(machineOf(m.id) ?? m, request)));
    grants(ses, () => views.get(m.id)?.at ?? null);
  };
  /**
   * This window's sign-in at an address, carried from a machine's partition into the one it moves to: the claim made
   * there signs it out first, so pairing again leaves no second sign-in standing (claimScript `again`).
   * @param {string} from @param {string} to @param {string} url
   */
  const carryCookies = async (from, to, url) => {
    try {
      const got = /** @type {any[]} */ ((await sessionOf(from).cookies?.get({ url })) || []);
      for (const k of got)
        await sessionOf(to).cookies.set({ url, name: k.name, value: k.value, path: k.path || "/", secure: !!k.secure, httpOnly: !!k.httpOnly, ...(k.sameSite ? { sameSite: k.sameSite } : {}), ...(k.expirationDate ? { expirationDate: k.expirationDate } : {}) });
    } catch (/** @type {any} */ e) {
      log(`rail: this window's sign-in not carried to ${to} (${String(e?.message || e)})`);
    }
  };

  /**
   * The windows a machine's pages opened, closed: they are that machine's, its cookie in them — they go with its view,
   * and as its page leaves the address they were opened at (the review of p3-shell; the hunt of p3-add: one stood on at
   * an address another machine had taken).
   * @param {RemoteView} v
   */
  const closePopups = (v) => {
    for (const p of v.popups) {
      try {
        if (!p.isDestroyed()) p.destroy();
      } catch {}
    }
    v.popups.clear();
  };
  /** @param {Machine} m @param {RemoteView} v @param {readonly Tried[]} tried */
  const showUnreachable = (m, v, tried) => {
    const page = unreachablePage(m.name, tried, { dark: look().dark, bar: win.isFullScreen?.() ? 0 : BAR_H });
    v.at = null;
    closePopups(v);
    if (page === v.shown) return;
    v.shown = page;
    void Promise.resolve(v.view.webContents.loadURL(page)).catch(() => {});
  };
  /** @param {RemoteView} v @param {import("./machines.js").Route} route */
  const openAt = (v, route) => {
    const at = originOfRoute(route);
    if (v.at !== null && v.at !== at) closePopups(v);
    v.at = at;
    v.shown = "";
    log(`rail: a machine's harness opens at ${v.at}`);
    // A chat shown alone opens at its chat again, whatever its page went through meanwhile.
    const wanted = v.wanted && now() - v.wanted.asked <= WANTED_MS ? v.wanted.hash : v.only ? v.chat || "" : "";
    v.wanted = null;
    v.page = harnessAt(route);
    void Promise.resolve(v.view.webContents.loadURL(`${pageUrl(v)}${wanted}`)).catch(() => {});
  };
  /**
   * A machine asked: its state, and its view moved where it now answers. `opening`: the ask that opens its view the
   * first time — the looks meanwhile leave the view to it.
   * @param {Machine} m @param {{ opening?: boolean }} [o]
   */
  const ask = async (m, { opening = false } = {}) => {
    // A pairing started meanwhile has the view: an ask from before it neither moves it nor says its state (the review
    // of p3-add: an opening ask's answer loaded the harness over the claim's page).
    const epoch = pairings.get(m.id) || 0;
    const r = await pick(m).catch((/** @type {any} */ e) => ({ route: null, tried: [{ url: "", why: String(e?.message || e) }] }));
    if (pairing.has(m.id) || (pairings.get(m.id) || 0) !== epoch) return;
    const tried = /** @type {Tried[]} */ (r.tried);
    watched.set(m.id, machineWatch(watched.get(m.id) ?? null, { answered: !!r.route, why: tried.at(-1)?.why ?? null, wrong: !r.route && tried.some((t) => t.wrong) }, now()));
    // The name it answers by now — renamed there, or its own name read anew (the owner's MacBook of 11-09, kept as
    // "192.168.0.77" as it paired) — is the window's too; its menu, its chip and the popover read it from the list.
    // Cleaned as a pairing cleans it (remotes.js `machineAt`), so the name kept is the one compared next time. One the
    // machines file could not keep is not tried again on each look, and holds no page from opening.
    const said = r.route && typeof r.name === "string" ? cleanName(r.name) : "";
    if (said && said !== m.name && unkept.get(m.id) !== said) {
      let got = null;
      try {
        got = keep.rename?.(m.id, said) ?? null;
      } catch (/** @type {any} */ e) {
        unkept.set(m.id, said);
        log(`rail: machine ${m.id} keeps its name here: its new one could not be kept (${String(e?.message || e)})`);
      }
      if (got) {
        unkept.delete(m.id);
        log(`rail: machine ${m.id} renamed as it answers`);
        sync();
      }
    }
    const v = views.get(m.id);
    const still = () => views.get(m.id) === v && !!v && alive(v.view) && !gone;
    if (!v || !still() || (v.opening && !opening)) return;
    const was = v.at;
    if (!r.route) {
      // Another machine answers at its page's address (a tunnel's port another program took): the page goes at once,
      // and its cookie with it — never sent on to whoever holds that address now (the review of p3-shell).
      if (was === null || tried.some((t) => t.wrong && originOfRoute(t) === was)) showUnreachable(m, v, tried);
      return;
    }
    const at = originOfRoute(r.route);
    if (was === null || tried.some((t) => originOfRoute(t) === was)) return openAt(v, r.route);
    if (was === at) return;
    // Its address comes after the one that answered first: asked itself, and the page moves only where it no longer
    // answers as the machine — an earlier route back is no reason to load it anew; its own gone, no reason to stay.
    const own = m.routes.find((x) => originOfRoute(x) === was);
    const answers = own ? await pick({ ...m, routes: [own] }).then((x) => !!x.route, () => false) : false;
    if (!answers && still() && v.at === was && !pairing.has(m.id) && (pairings.get(m.id) || 0) === epoch) openAt(v, r.route);
  };

  /** @param {Machine} m @returns {RemoteView} */
  const viewOf = (m) => {
    const had = views.get(m.id);
    if (had && alive(had.view)) return had;
    arm(m);
    const prefs = remotePrefs(m);
    // Its one bridge, its page's alone: the windows its pages open are made with `prefs`, none of it.
    const view = new View({ webPreferences: machinePreload ? { ...prefs, preload: machinePreload } : prefs });
    view.setBackgroundColor?.(look().dark ? "#1e1e1e" : "#ffffff");
    /** @type {RemoteView} */
    const v = { view, at: null, shown: "", opening: false, popups: new Set(), only: "", chat: "", moves: 0 };
    guard(view.webContents, {
      originOf: () => v.at,
      prefs,
      onChild: (/** @type {any} */ child) => {
        v.popups.add(child);
        child.on?.("closed", () => v.popups.delete(child));
      },
    });
    view.webContents.on("before-input-event", keys);
    // Its chat shown alone moved — a chat of its own opened there, its history gone back —: This computer's list follows
    // it. Its page's own address alone, at its Filament.
    const moved = (/** @type {string} */ url) => {
      if (!v.only || views.get(m.id) !== v || v.at === null) return;
      let origin = "";
      try {
        origin = new URL(String(url)).origin;
      } catch {}
      if (origin !== v.at) return;
      v.chat = hashOf(url);
      if (guest?.id === m.id) onGuest({ id: m.id, hash: v.chat });
    };
    view.webContents.on("did-navigate-in-page", (/** @type {any} */ _e, /** @type {string} */ url, /** @type {boolean} */ main) => void (main !== false && moved(url)));
    view.webContents.on("did-navigate", (/** @type {any} */ _e, /** @type {string} */ url) => moved(url));
    // Its Filament's page that did not load — the machine went, its certificate is another: the app's page says so. Not
    // while a pairing has the view: the claim's own load says how it went, and the app's page would cut it off.
    view.webContents.on("did-fail-load", (/** @type {any} */ _e, /** @type {number} */ code, /** @type {string} */ desc, /** @type {string} */ url, /** @type {boolean} */ main) => {
      if (!main || code === -3 || v.at === null || pairing.has(m.id)) return;
      const was = v.at;
      log(`rail: ${was} did not load (${desc || code})`);
      showUnreachable(machineOf(m.id) ?? m, v, [{ url: String(url || was), why: `${was} did not load (${desc || `error ${code}`})` }]);
    });
    view.setVisible(false);
    win.contentView.addChildView(view);
    views.set(m.id, v);
    return v;
  };
  /** @param {string} id */
  const drop = (id) => {
    const v = views.get(id);
    if (guest?.id === id) unguest();
    views.delete(id);
    watched.delete(id);
    told.delete(id);
    tints.delete(id);
    browserOf(id)?.parkAll(win);
    if (!v) return;
    try {
      win.contentView.removeChildView(v.view);
    } catch {}
    try {
      if (alive(v.view)) v.view.webContents.close();
    } catch {}
    closePopups(v);
  };

  /**
   * The view showing on top of the window's pages — the agent's browser page placed after them included —, that
   * machine's chats' pages this app holds over its view (`browserOf`), and the app's page over everything while the
   * popover or the Add sheet shows.
   */
  const raise = () => {
    if (gone || win.isDestroyed()) return;
    const id = showing();
    const v = views.get(id);
    if (id !== LOCAL_ID && v && alive(v.view)) {
      win.contentView.addChildView(v.view);
      browserOf(id)?.lift(win);
    }
    if (alive(rail) && (adding || popping)) win.contentView.addChildView(rail);
  };
  /**
   * The window takes a press on a view over its own page as a drag wherever that page's top row drags: a Mac's (Electron
   * #28057; the owner's of 11-08: another machine's Chat, Agents and Plan not pressed, its title only at its left edge,
   * where This computer's page has a button of its own), and Windows' and Linux's, whose hit test asks each view's drag
   * regions in the order the views were added, This computer's page first, whatever lies over it (Electron 45
   * native_window.cc `NonClientHitTest`; the owner's of 11-09: the Mac's Settings gear and machine chip took no press in
   * Windows' window). While anything lies over This computer's page, its drag regions are off — the view over it drags by
   * its own; while a chat shown in place lies over its column alone, that column's are (`UNDRAG_COLUMN_CSS`). The key of
   * the CSS that does it, while it is in, and which CSS. @type {Promise<string | null> | null}
   */
  let undragged = null;
  /** The CSS in, or on its way. */
  let undragCss = "";
  /** What lies over This computer's page: everything (another machine showing, the app's page), its column, or nothing. @type {"" | "all" | "column"} */
  let covered = "";
  const undrag = () => {
    const want = covered === "all" ? UNDRAG_CSS : covered === "column" ? UNDRAG_COLUMN_CSS : "";
    if (want === undragCss && (!!undragged || !want)) return;
    if (undragged) {
      const was = undragged;
      undragged = null;
      void was.then((k) => k && wc.removeInsertedCSS(k)).catch(() => {});
    }
    undragCss = want;
    if (want) undragged = Promise.resolve(wc.insertCSS(want)).catch(() => null);
  };
  // Its page loaded anew has none of it: put in again while covered. One put in as the new page came, before its
  // dom-ready, is in that page: taken out, or it would stay once nothing covers it (a key the page holds not is nothing).
  wc.on("dom-ready", () => {
    const was = undragged;
    undragged = null;
    undragCss = "";
    void was?.then((k) => k && wc.removeInsertedCSS(k)).catch(() => {});
    undrag();
  });
  // This computer's page loaded anew knows of no chat it showed in place: that chat goes from over its column.
  wc.on("did-navigate", () => {
    if (!guest || gone) return;
    guest = null;
    layout();
    tell();
  });
  const layout = () => {
    if (gone || win.isDestroyed()) return;
    if (!shown()) {
      active = LOCAL_ID;
      popping = null;
    }
    const [width, height] = win.getContentSize();
    // The title bar Filament draws on every system (lib/frame.js), none in full screen: the Add sheet's top row drags.
    bar = !win.isFullScreen() ? BAR_H : 0;
    const at = switchLayout({ width, height }, { remote: active !== LOCAL_ID, over: adding || !!popping });
    const placed = guestShown();
    covered = at.over || at.view ? "all" : placed ? "column" : "";
    undrag();
    if (at.over) {
      const r = railOf();
      r.setBounds(at.over);
      r.setVisible(true);
    } else if (alive(rail)) rail.setVisible(false);
    for (const [id, v] of views) {
      const bounds = id === active && at.view ? at.view : placed?.id === id ? placed.rect : null;
      if (bounds) v.view.setBounds(bounds);
      v.view.setVisible(!!bounds);
      // Its chats' pages drawn over its Browser pane go from sight with it.
      if (!bounds) browserOf(id)?.parkAll(win);
    }
    raise();
    dress();
  };
  /** The colours the window's controls were last dressed in: the page showing's — none kept for This computer's (`tintFrom`). */
  let dressed = "";
  const dress = () => {
    const c = tints.get(showing()) ?? null;
    const key = c ? `${c.color} ${c.symbolColor}` : "";
    if (key === dressed) return;
    dressed = key;
    tint(c);
  };
  /** The keys to the page before the person: the app's page while it shows, the machine showing's, else the chat shown in place's. */
  const focus = () => {
    if ((adding || popping) && alive(rail)) return rail.webContents.focus();
    const id = showing();
    const v = views.get(id);
    (id !== LOCAL_ID && v && alive(v.view) ? v.view.webContents : wc).focus();
  };

  /**
   * The machines read again: one gone from the list goes from the window, its view closed — and one disconnected, its
   * page and the windows it opened closed, so nothing of it notifies here; This computer shown where either showed.
   */
  const sync = () => {
    list = machines();
    const away = (/** @type {string} */ id) => !machineOf(id) || !!machineOf(id)?.off;
    for (const id of [...views.keys()]) if (away(id)) drop(id);
    if (away(active)) active = LOCAL_ID;
  };
  const lookAll = async () => {
    if (looking || gone) return;
    looking = true;
    try {
      sync();
      // Each machine's state painted as it answers: one slow to — an SSH host that is down — holds no other's back. One
      // disconnected is asked nothing.
      await Promise.all(list.filter((m) => !m.local && !m.off).map((m) => ask(m).then(() => void (!gone && paint()))));
    } finally {
      looking = false;
    }
    if (gone) return;
    layout();
    paint();
  };
  /** The machines read again, and drawn as they are: asked every `LOOK_EVERY_MS` while another one is kept. */
  const refresh = () => {
    if (gone) return;
    sync();
    if (shown() && !timer) {
      timer = every(() => void lookAll(), LOOK_EVERY_MS);
      void lookAll();
    } else if (!shown() && timer) {
      stopEvery(timer);
      timer = null;
    }
    layout();
    paint();
  };
  /**
   * A machine shown in the window: This computer's page, or that machine's view — made and opened the first time.
   * False for a machine the window does not hold.
   * @param {string} id
   */
  function select(id) {
    if (gone) return false;
    let m = machineOf(id);
    if (!m || !shown()) return false;
    // One disconnected, picked — in the popover, by its key, from the tray, or its menu's Connect —: connected again.
    if (m.off) {
      if (!keep.off?.(id, false)) return false;
      log(`rail: machine ${id} connected again`);
      sync();
      m = machineOf(id);
      if (!m || m.off) return false;
    }
    // A machine shown by its key while the popover is open: the popover goes with the page it was opened over.
    if (popping) {
      popping = null;
      if (id === active) {
        layout();
        paint();
      }
    }
    if (id !== active) {
      active = id;
      log(`rail: ${m.local ? "this computer" : `machine ${m.id}`} shown`);
      if (!m.local) {
        const v = viewOf(m);
        // Its chat shown in place, shown whole now: its whole page, at that chat.
        if (guest?.id === id) unguest();
        whole(v);
        if (v.at === null && !v.opening) {
          v.opening = true;
          void ask(m, { opening: true }).finally(() => {
            v.opening = false;
            paint();
          });
        }
      }
      layout();
      paint();
    }
    focus();
    return true;
  }

  /**
   * A view that shows a chat alone shows its whole page again, at the address it shows — the one its page last went to,
   * loaded anew, its query gone —; `hash`: at that address instead. @param {RemoteView} v @param {string} [hash]
   */
  function whole(v, hash) {
    if (!v.only) return false;
    const at = hash ?? (v.chat || hashOf(v.view.webContents.getURL?.() || ""));
    v.only = "";
    v.chat = "";
    v.moves = 0;
    if (v.at === null || !v.page || !alive(v.view)) return false;
    v.wanted = null;
    void Promise.resolve(v.view.webContents.loadURL(`${v.page}${at}`)).catch(() => {});
    return true;
  }

  /**
   * Another machine's chat shown in place, over This computer's column at `rect` (window units; null: out of sight until
   * placed): its view's page made to show it alone (`?only=chat&theme=`), moved to it within that page — a fragment's
   * move, no load — while it shows one already in that look, loaded anew otherwise, and made anew after `GUEST_MOVES`
   * such moves. One not opened yet is asked and opened at it; `keys`: the keys its, while it is in sight. False for
   * This computer, a machine the window does not keep or keeps disconnected or shows whole, or an address that is none
   * of a harness's own. Another machine shown whole meanwhile, it waits out of sight until This computer shows again.
   * @param {string} id @param {string} hash @param {Rect | null} rect @param {"light" | "dark"} theme @param {boolean} [keys]
   */
  function showChat(id, hash, rect, theme, keys = false) {
    if (gone || !HARNESS_HASH.test(String(hash)) || active === id || adding) return false;
    const m = machineOf(id);
    if (!m || m.local || m.off || !shown()) return false;
    const only = `only=chat&theme=${theme === "light" ? "light" : "dark"}`;
    let v = viewOf(m);
    // Moved through many chats: made anew, where it is reached, so what the old page kept goes with it.
    if (v.only === only && (v.moves || 0) >= GUEST_MOVES && v.at !== null && v.page) {
      const { at, page } = v;
      const was = watched.get(id);
      // Shown in place again at once: nothing to tell This computer's page.
      if (guest?.id === id) guest = null;
      drop(id);
      if (was) watched.set(id, was);
      v = viewOf(m);
      Object.assign(v, { at, page });
      log(`rail: machine ${id}'s page made anew after ${GUEST_MOVES} chats shown in place`);
    }
    if (guest && guest.id !== id) unguest();
    guest = { id, rect: rect ?? null };
    const same = v.only === only;
    v.only = only;
    v.moves = same ? (v.moves || 0) + 1 : 0;
    v.chat = hash;
    if (v.at !== null && v.page && alive(v.view)) {
      v.wanted = null;
      void Promise.resolve(v.view.webContents.loadURL(`${pageUrl(v)}${hash}`)).catch(() => {});
    } else {
      v.wanted = { hash, asked: now() };
      if (!v.opening) {
        v.opening = true;
        void ask(m, { opening: true }).finally(() => {
          v.opening = false;
          paint();
        });
      }
    }
    layout();
    paint();
    if (keys && guestShown()) focus();
    return true;
  }

  /** The Add sheet, over the whole window — another machine kept or not yet —, the popover gone. @param {boolean} on */
  const sheet = (on) => {
    if (gone || (adding === on && !popping)) return;
    adding = on;
    popping = null;
    layout();
    paint();
    focus();
  };

  /**
   * The popover opened under the chip a page pressed — the page showing, never one behind it —, at `rect` in that page's
   * pixels; its keys and presses the app's page's until a pick, Escape or a press outside closes it.
   * @param {string} from  the page's machine @param {any} rect
   */
  function openPop(from, rect) {
    if (gone || !shown() || adding || (from !== active && from !== guestShown()?.id)) return false;
    const page = pageOf(from);
    if (!page) return false;
    const z = zoomOf(page);
    const n = (/** @type {any} */ v) => Math.max(0, Number(v) || 0) * z;
    // The chat shown in place's chip stands where its view does.
    const off = from !== active ? guestShown()?.rect : null;
    popping = { at: { x: n(rect?.x) + (off?.x ?? 0), y: n(rect?.y) + (off?.y ?? 0), width: n(rect?.width), height: n(rect?.height) }, from };
    layout();
    paint();
    focus();
    return true;
  }
  /** @param {{ refocus?: boolean }} [o]  `refocus`: the page under it given the keys back — not as the window is left */
  const closePop = ({ refocus = true } = {}) => {
    if (gone || !popping) return;
    popping = null;
    layout();
    paint();
    if (refocus) focus();
  };

  /**
   * One step of the Add sheet: `check` says who answers at the address and how it is reached — or the certificate's
   * fingerprint for the person to compare, or why not —; `pair` checks again and claims the code from a page of that
   * machine in its own view, so the cookie lands in its partition; paired, it is kept, shown and the sheet closes. A
   * machine kept already is paired again: its new way there first, the ways it had after, its old sign-in there ended
   * first. `expect`: the id Continue showed — Pair goes to that machine alone. What the claim could not keep is refused
   * before it: an id that is none, a full window, this computer's own Filament (the review of p3-add). Through an SSH
   * tunnel no code is claimed (`keepSsh`).
   * @param {{ op?: string, link?: string, code?: string, fingerprint?: string, expect?: string }} input
   * @returns {Promise<any>}
   */
  async function add(input) {
    if (gone) return { ok: false, words: "The window closed." };
    const c = await check({ link: String(input?.link || ""), code: String(input?.code || ""), fingerprint: String(input?.fingerprint || "") });
    if (gone) return { ok: false, words: "The window closed." };
    if (!c.ok) return c;
    const id = idOf(c.machine.id);
    if (!id) return { ok: false, words: `What answers at ${c.url} gives no id a machine is kept by: nothing was sent.` };
    const me = await Promise.resolve(ownId()).catch(() => null);
    if (me === id) return { ok: false, words: `${c.url} is this computer's own Filament, in this window already as ${LOCAL_NAME}.` };
    const had = list.find((m) => m.id === id) || null;
    if (!had && list.length >= MAX_MACHINES) return { ok: false, words: `This window holds ${MAX_MACHINES} machines at most: remove one first (its ⋯ in the machines menu).` };
    const said = { ok: true, id, url: c.url, name: c.machine.name, fingerprint: c.fingerprint, kept: !!had, code: !!c.code, ...(c.ssh ? { ssh: c.ssh } : {}) };
    if (input?.op !== "pair") return said;
    if (input.expect && String(input.expect).toLowerCase() !== id) return { ok: false, words: `Another machine answers at ${c.url} now — ${c.machine.name} —, not the one shown: nothing was sent. Continue again to see who answers.` };
    if (c.ssh) return keepSsh(c, id, had);
    if (!c.code) return { ok: false, words: `Type the code Settings › Remote access shows on ${c.machine.name}.` };
    if (pairing.has(id)) return { ok: false, words: `A pairing with ${c.machine.name} is on its way.` };
    const same = (/** @type {any} */ r) => r.kind === c.route.kind && r.url === c.route.url;
    // A certificate it was never paired with, at a host it was reached at, is met in a partition anew: the one it had
    // may hold a refusal of it — its page met it there before this pairing — and holds the old certificate's yes, both
    // kept for that partition's life, by certificate and host (machines.js partitionOf). This window's sign-in there
    // comes along, so the claim signs it out first.
    const host = new URL(c.url).hostname;
    const reached = !!had?.routes.some((r) => originOfRoute(r) !== null && new URL(String(r.url)).hostname === host);
    const anew = !!had && !!c.fingerprint && reached && !pinsFor(had, host).some((fp) => samePrint(fp, c.fingerprint));
    const partition = had ? (anew ? partitionOf(id, partitionGen(id, had.partition) + 1) : had.partition) : partitionOf(id);
    /** @type {Machine} */
    const m = { id, name: c.machine.name, routes: [c.route, ...(had?.routes || []).filter((r) => !same(r))], partition, addedAt: had?.addedAt ?? null };
    pairing.set(id, m);
    pairings.set(id, (pairings.get(id) || 0) + 1);
    if (anew && had) {
      drop(id);
      await carryCookies(had.partition, partition, c.url);
    }
    const v = viewOf(m);
    v.opening = true;
    v.at = c.url;
    v.shown = "";
    /** @type {{ ok: true } | { ok: false, words: string }} */
    let out;
    /** @type {ReturnType<typeof setTimeout>[]} */
    const timers = [];
    try {
      const wc2 = v.view.webContents;
      // A page of the machine — its own address, no script of its own —, then its own fetch home: a claim with its Origin.
      const within = (/** @type {Promise<any>} */ p, /** @type {string} */ what) =>
        Promise.race([p, new Promise((_, no) => timers.push(setTimeout(() => no(new Error(`${what} took longer than ${Math.round(claimMs / 1000)} s`)), claimMs)))]);
      await within(loadOwn(wc2, `${c.url}${CLAIM_FROM}`), `${c.url} `);
      out = claimOutcome(await within(Promise.resolve(wc2.executeJavaScript(claimScript(c.code, deviceName(), { again: !!had, machine: me }), true)), "The claim"), m);
    } catch (/** @type {any} */ e) {
      out = { ok: false, words: `Not paired: ${c.url} did not answer as ${c.machine.name} (${String(e?.message || e)}).` };
    } finally {
      for (const t of timers) clearTimeout(t);
    }
    pairing.delete(id);
    v.opening = false;
    if (gone) return { ok: false, words: "The window closed." };
    /**
     * Nothing kept: a new machine's view goes, and so does a partition anew with what it holds; one kept already opens
     * again where it is reached, in the partition it had.
     */
    const undo = () => {
      if (!had) return drop(id);
      if (anew) {
        drop(id);
        void Promise.resolve(sessionOf(partition).clearStorageData?.()).catch(() => {});
        armed.delete(partition);
      }
      const back = viewOf(had);
      back.at = null;
      void ask(had, { opening: true });
      layout();
    };
    if (!out.ok) {
      undo();
      log(`rail: pairing with ${id} refused (${out.words})`);
      return out;
    }
    try {
      keep.add({ id, name: c.machine.name, routes: [c.route], partition });
    } catch (/** @type {any} */ e) {
      undo();
      return { ok: false, words: `Paired, but not kept: ${String(e?.message || e)}` };
    }
    log(`rail: machine ${id} paired at ${c.url}${anew ? `, in ${partition}` : ""}`);
    sync();
    // The partition it left, and the old certificate's yes in it, cleared.
    if (anew && had) {
      void Promise.resolve(sessionOf(had.partition).clearStorageData?.()).catch(() => {});
      armed.delete(had.partition);
    }
    watched.set(id, machineWatch(watched.get(id) ?? null, { answered: true }, now()));
    openAt(v, c.route);
    adding = false;
    refresh();
    if (active === id) layout();
    else select(id);
    return { ok: true, name: c.machine.name };
  }

  /**
   * A machine reached through an SSH tunnel, kept: no code is claimed — ssh's own sign-in let this computer in, and its
   * Filament reads the tunnel's end as a caller on its own loopback. Its way first, the ways it had after, in the
   * partition it had; an ask from before it is stale.
   * @param {any} c  what `check` said @param {string} id @param {Machine | null} had
   */
  function keepSsh(c, id, had) {
    if (pairing.has(id)) return { ok: false, words: `A pairing with ${c.machine.name} is on its way.` };
    /** @type {Machine} */
    let m;
    try {
      m = keep.add({ id, name: c.machine.name, routes: [c.route], partition: had?.partition || partitionOf(id) });
    } catch (/** @type {any} */ e) {
      return { ok: false, words: `Not kept: ${String(e?.message || e)}` };
    }
    log(`rail: machine ${id} kept, reached through ssh ${c.ssh} at ${c.url}`);
    pairings.set(id, (pairings.get(id) || 0) + 1);
    sync();
    watched.set(id, machineWatch(watched.get(id) ?? null, { answered: true }, now()));
    openAt(viewOf(m), c.route);
    adding = false;
    refresh();
    if (active === id) layout();
    else select(id);
    return { ok: true, name: c.machine.name };
  }

  /**
   * A machine disconnected (the owner's of 11-08): kept, its ways and its sign-in too, but asked nothing — no look, the
   * app's watch none either (main.js) — and its page and the windows it opened closed, so nothing of it notifies here;
   * This computer shown where it showed, the popover gone with its page. A pick connects it again (`select`).
   * @param {string} id
   */
  const disconnect = (id) => {
    const m = list.find((x) => x.id === id);
    if (!m || m.local || m.off || gone || !keep.off?.(id, true)) return;
    log(`rail: machine ${id} disconnected`);
    const was = active === id;
    if (was) popping = null;
    refresh();
    if (was) focus();
  };

  /**
   * A machine's own menu (its ⋯ in the popover, or a right-click on it): its Colour and its Icon, This computer's too
   * (the remote desk of 11-22); another machine's Disconnect — or Connect, where it is — and Remove from this window —
   * asked first —, its view and the windows its pages opened closed, and its partition's cookie and storage cleared, so
   * pairing it again starts anew.
   * @param {string} id
   */
  function machineMenu(id) {
    const m = list.find((x) => x.id === id);
    if (!m || gone) return;
    /** Its colour or its icon kept, and every chip, row and the popover drawn again. @param {{ color?: string, icon?: string }} look */
    const dress = (look) => {
      if (gone || !keep.look?.(id, look)) return;
      log(`rail: machine ${id} wears ${look.color ? `colour ${look.color}` : `icon ${look.icon}`}`);
      refresh();
    };
    /** @type {MenuRow[]} */
    const looks = [
      { label: "Colour", submenu: MACHINE_COLORS.map((c) => ({ label: `${c[0].toUpperCase()}${c.slice(1)}`, type: /** @type {const} */ ("radio"), checked: colorOf(m) === c, swatch: COLOR_HEX[/** @type {keyof typeof COLOR_HEX} */ (c)], click: () => dress({ color: c }) })) },
      { label: "Icon", submenu: MACHINE_ICONS.map((i) => ({ label: ICON_WORDS[/** @type {keyof typeof ICON_WORDS} */ (i)], type: /** @type {const} */ ("radio"), checked: iconOf(m) === i, click: () => dress({ icon: i }) })) },
    ];
    if (m.local) return menu(looks);
    menu([
      ...looks,
      { type: "separator" },
      m.off ? { label: `Connect ${m.name}`, click: () => void select(id) } : { label: `Disconnect ${m.name}`, click: () => disconnect(id) },
      { type: "separator" },
      {
        label: `Remove ${m.name} from this window…`,
        click: () =>
          void confirm({ title: `Remove ${m.name}?`, detail: `This window stops driving ${m.name}, and forgets its sign-in here. Filament on ${m.name} keeps this device listed until it is revoked there (Settings › Remote access).`, yes: "Remove" }).then((yes) => {
            if (!yes || gone) return;
            keep.remove(id);
            log(`rail: machine ${id} removed`);
            // Its view and windows closed first, then what they kept cleared: no page of it left to write again.
            refresh();
            void Promise.resolve(sessionOf(m.partition).clearStorageData?.()).catch(() => {});
            armed.delete(m.partition);
          }),
      },
    ]);
  }

  // The window moved under the popover: the chip it hangs from moved too, so it goes. Full screen in or out: the room
  // the controls take, lent to another machine's page, moved.
  const relayout = () => {
    const was = !!popping;
    popping = null;
    layout();
    paint();
    if (was) focus();
  };
  for (const ev of ["resize", "maximize", "unmaximize", "enter-full-screen", "leave-full-screen"]) win.on(ev, relayout);
  // A machine paired from the command line meanwhile shows as the window is come back to; the window left, the popover goes.
  win.on("focus", refresh);
  win.on("blur", () => closePop({ refocus: false }));
  win.on("closed", () => destroy());

  function destroy() {
    if (gone) return;
    gone = true;
    if (timer) stopEvery(timer);
    timer = null;
    for (const id of [...views.keys()]) drop(id);
    try {
      if (alive(rail)) rail.webContents.close();
    } catch {}
    rail = null;
  }

  refresh();
  return {
    refresh,
    select,
    raise,
    paint,
    destroy,
    add,
    machineMenu,
    /** The Add sheet opened over the window, or closed. */
    openAdd: () => sheet(true),
    closeAdd: () => sheet(false),
    /** The popover under a page's chip (`openPop`), and closed: a pick, Escape, a press outside it. */
    openPop,
    closePop: () => closePop(),
    /** A machine picked in the popover: the popover closed, that machine shown. @param {string} id */
    pick: (id) => {
      closePop();
      return select(id);
    },
    /**
     * A machine shown at an address of its harness (pk-list: a project there picked in this computer's new-chat menu,
     * `#/new/<folder>`): its page sent there where it was sent to Filament's — loaded or still loading, the newest
     * address wins (the review of pk-list) —, else opened at it once that machine answers, within `WANTED_MS`. False for
     * This computer, a machine the window does not keep, or an address that is none of a harness's own (`#/…`, one part
     * after the mark, no space).
     * @param {string} id @param {string} hash
     */
    openOn: (id, hash) => {
      if (gone || !HARNESS_HASH.test(String(hash))) return false;
      const m = machineOf(id);
      if (!m || m.local) return false;
      const v = viewOf(m);
      // Its chat shown in place goes from there: its whole page shows, at the address asked.
      if (guest?.id === id) unguest();
      if (v.at !== null && v.page && alive(v.view)) {
        v.wanted = null;
        if (!whole(v, hash)) void Promise.resolve(v.view.webContents.loadURL(`${v.page}${hash}`)).catch(() => {});
      } else {
        v.only = "";
        v.chat = "";
        v.wanted = { hash, asked: now() };
      }
      return select(id);
    },
    showChat,
    /**
     * The chat shown in place moved with This computer's column, or out of sight while something of that page lies over
     * it (null), or back; `keys`: the keys its again, while it is in sight. @param {Rect | null} rect  window units
     * @param {boolean} [keys]
     */
    placeChat: (rect, keys = false) => {
      if (gone || !guest) return;
      const was = JSON.stringify(guest.rect);
      guest.rect = rect ?? null;
      if (JSON.stringify(guest.rect) !== was) {
        layout();
        tell();
      }
      if (keys && guestShown()) focus();
    },
    /** The chat shown in place gone from it — its view kept, out of sight, for the next —, the keys This computer's page's. */
    hideChat: () => {
      if (gone || !guest) return;
      guest = null;
      layout();
      tell();
      wc.focus();
    },
    /** The machine whose chat shows in place, while it is in sight; else null. */
    guest: () => guestShown()?.id ?? null,
    /** The machine whose page is before the person: the one showing, else the chat shown in place's, else This computer. */
    showing,
    /**
     * The machines of this computer's tailnet that answer as a Filament (tailnet-peers.js), for the Add sheet: each
     * marked `kept` where a machine of this window is reached at its address — not by the id it says, which another machine
     * may say too. @returns {Promise<{ found: any[], words: string }>}
     */
    tailnet: async () => {
      const got = await peers();
      const at = new Set(list.flatMap((m) => m.routes.map((r) => originOfRoute(r))));
      return { words: got.words, found: got.found.map((f) => ({ ...f, kept: at.has(originOfRoute(f)) })) };
    },
    /** Which machine shows: `local` for this computer's page. */
    active: () => active,
    /**
     * A key pressed in another page of the window — the agent's browser placed in it, its veil (main.js) —: Ctrl+1..9
     * shows that slot's machine from there too (the hunt of p3-add). @param {any} e @param {any} input
     */
    keys,
    /** A page zoomed (the View menu's keys, `zoomRows`): the room lent to another machine's page sized for the zoom it has now. */
    zoomed: () => void (!gone && tell()),
    /** Whether a word to the app's page's bridge comes from its own page. @param {any} sender @param {string | undefined} frameUrl */
    hears: (sender, frameUrl) => alive(rail) && sender === rail.webContents && frameUrl === railPage,
    /**
     * Which machine's harness page a word to a chip's bridge comes from — This computer's (`local`), or another machine's
     * view, its main frame —; null for any other page. @param {any} sender @param {any} [frame]  its frame, the main one alone
     */
    hearsPage: (sender, frame) => {
      if (frame && frame.parent) return null;
      if (sender === wc) return LOCAL_ID;
      for (const [id, v] of views) if (alive(v.view) && v.view.webContents === sender) return id;
      return null;
    },
    /**
     * Which other machine's Browser pane a word to the browser's bridge comes from (machine-preload.cjs
     * `filamentBrowser`): its view's main frame, at that machine's own Filament's address alone — and where the view lies
     * in the window. Null for any other page, and This computer's (main.js `paneOf`).
     * @param {any} sender @param {any} frame  its frame
     * @returns {{ id: string, bounds: Rect } | null}
     */
    machinePane: (sender, frame) => {
      if (!frame || frame.parent) return null;
      for (const [id, v] of views) {
        if (!alive(v.view) || v.view.webContents !== sender || !v.at) continue;
        try {
          if (new URL(String(frame.url)).origin !== v.at) return null;
        } catch {
          return null;
        }
        return { id, bounds: v.view.getBounds() };
      }
      return null;
    },
    /** A machine's view's page, while it lives; This computer's own page for `local`. @param {string} id */
    pageOf,
    /** A page's chip asks for its state, its page loaded anew: told it, whatever it heard before. @param {string} id */
    told: (id) => void (!gone && tell(id)),
    /**
     * The room the window's controls take over This computer's page's top row, as it read it (its Window Controls
     * Overlay, in its pixels): lent to the other machines' pages. @param {any} r
     */
    frameArea: (r) => {
      if (gone) return;
      const z = zoomOf();
      const n = (/** @type {any} */ v) => Math.max(0, Math.min(2000, Number(v) || 0)) * z;
      area = { left: n(r?.left), right: n(r?.right) };
      tell();
    },
    /**
     * The colours another machine's page asks its title bar to wear: the window's controls wear them while it shows.
     * This computer's are the app's own (main.js `filament:title-bar`): it has no view here. @param {string} id @param {any} c
     */
    tintFrom: (id, c) => {
      const colors = overlayColors(c);
      if (gone || !colors || !views.has(id)) return;
      tints.set(id, colors);
      dress();
    },
  };
}

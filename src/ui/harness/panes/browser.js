// @ts-check
// The Browser pane (HarnessV4_Browser_Plan BR4; BR-D10, D11): the chat's browser beside it — the page the agent works
// on, live, which the person watches, takes over and gives back. In the desktop app the page itself sits over the
// pane's stage: the app holds it (desktop/lib/browser-host.js) and puts it there through the window's bridge
// (`filamentBrowser`, harness-preload.cjs) while the stage shows, uncovered — a menu, a dialog, a sheet or a tooltip of
// the harness's own over it parks the page, and its last picture stands in until nothing covers it; a full-frame screen
// over the panes (Library, Settings, a Space) parks it until the chat is back. With no app of its own — another
// machine's harness, a browser's tab (the owner's remote Filament of 11-06, Part 4) — the page comes live, as the app
// casts it, on the page's run socket (lib/run-socket.js `cast`), a frame older than one drawn dropped; and while the
// person has taken the browser over, their clicks, keys and pastes on it reach the page; the cast is watched only while
// the stage is before the person. In an app whose bridge refuses a tab — it holds it not: Chrome on the machine holds
// it, or another app; another machine's harness in the app, whose chats' pages the app holds only where that machine
// may use its browser (b-remote) — the pane shows it so too. Where no cast is on (an app or a Filament without one), the page is a picture, read
// again every 2 s. A view-only device's page shows none of it (`setBrowserViewOnly`), as the server refuses it. Above it: back, forward, reload and the address (the person's word goes
// to the chat's browser even while the agent works), the page's size (HarnessV4_BrowserSize_Plan BS2: the shown tab's,
// and a menu to set it — the agent is told), the chat's tabs, what the agent does now, Take over / Give back, and ⋯
// with the sites the agent may act on (each forgotten with a press) and Clear the browser's data. The page keeps its
// own size: the app draws it scaled into the stage, centred (BS1). A press opens a page, a tab or a menu: it starts no
// agent and no turn. Built with an injected `api` and `bridge`, so it runs on the fake DOM.
import { h } from "../../lib/dom.js";
import { api as adminApi } from "../lib/api.js";
import { icon } from "../lib/icons.js";
import { button, confirmDialog, dialog, menu, tooltip } from "../lib/ui.js";
import { runSocket } from "../lib/run-socket.js";
import { atWork } from "../state.js";

/** The sizes the chip offers, as the browser names them (src/core/browser.js `SIZES`; a test keeps the two the same). */
export const PAGE_SIZES = Object.freeze([
  Object.freeze({ name: "desktop", label: "Desktop", width: 1440, height: 900 }),
  Object.freeze({ name: "laptop", label: "Laptop", width: 1280, height: 800 }),
  Object.freeze({ name: "tablet", label: "Tablet", width: 820, height: 1180 }),
  Object.freeze({ name: "phone", label: "Phone", width: 390, height: 844 }),
]);
/** A size in the chip's words. @param {{ width: number, height: number }} s */
const sizeWords = (s) => `${s.width} × ${s.height}`;

/**
 * The size chip's words for a tab: its size, or that it fits the pane. @param {any} tab  the chat's browser's tab
 */
export const sizeChipWords = (tab) => (tab?.fit ? "Fits the pane" : sizeWords(tab?.size?.width ? tab.size : { width: 1280, height: 800 }));

/** How often the pane reads the chat's browser while it shows. */
export const LOOK_MS = 1500;
/** How often the page's picture is read again where it stands in for the page. */
export const SHOT_MS = 2000;
/** How often the page's place is checked: the pane moved, something came over it. */
export const PLACE_MS = 250;
/** The person's mouse moves on a cast page go this far apart at the least: the newest of those between, then. */
export const MOVE_MS = 50;
/** A refusal of the person's input is said this far apart at the most: a drag refused is one toast. */
const REFUSED_MS = 5000;
/**
 * A press this soon after the last, this near it, with the same button, counts on from it — a double and a triple
 * click (Chrome's `clickCount`): a pointer event's `detail` says 0, so the pane counts them itself.
 */
export const CLICK_MS = 500;
export const CLICK_PX = 4;
/** What a wheel turned in lines scrolls, a line (`deltaMode` 1): Chrome's input takes pixels alone. */
export const LINE_PX = 16;
/** What a view-only device's pane says in place of the page: the server shows it none of the chat's browser. */
export const VIEW_ONLY_BROWSER_WORDS = "A view-only device does not see the chat's browser: it shows on this Filament's computer and on devices that may use it.";
/** What of the harness's own may come over the pane: while one does, the page parks and its picture stands in. */
export const COVERS = ".zc-menu, .zc-popover, .zc-dialog-overlay, .zc-sheet, .zc-tooltip, .zc-toast, .toast.show, [role='menu'], [role='dialog'], [role='listbox'], [role='tooltip']";

/**
 * How recently an agent's browser call ran for its page to count as driven while the chat's agent is at work: the veil
 * lies over it (HarnessV4_BrowserSize_Plan BS3) — an agent at work that has not used the browser for longer leaves the
 * page to the developer's mouse, as one that never used it does (case 15).
 */
export const DRIVE_MS = 120_000;

/**
 * The bridge the desktop app gives the harness's window, or null in a browser tab. `onHand` and `handOff` (BS3) are
 * an app's from BS3 on.
 * @param {any} [w]
 * @returns {{ place: (tab: string, rect: { x: number, y: number, width: number, height: number }, o?: { lock?: boolean }) => Promise<boolean>, park: () => void,
 *   onHand?: (fn: (m: any) => void) => () => void, handOff?: () => void } | null}
 */
export const bridgeOf = (w = globalThis.window) => (w?.filamentBrowser && typeof w.filamentBrowser.place === "function" && typeof w.filamentBrowser.park === "function" ? w.filamentBrowser : null);

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/** The page is a view-only device's (`setBrowserViewOnly`): its panes show none of the chat's browser and ask nothing. */
let viewOnly = false;
/** The panes drawn now, each told as the page turns view-only. @type {Set<() => void>} */
const viewOnlyPanes = new Set();
/**
 * The page is a view-only device's, or no longer (app.js `paintViewOnly`, from /api/state): its Browser panes say they
 * show nothing, and read none of the chat's browser — no state, no picture, no cast —, which the server refuses it.
 * @param {boolean} on
 */
export function setBrowserViewOnly(on) {
  if (viewOnly === !!on) return;
  viewOnly = !!on;
  for (const paint of [...viewOnlyPanes]) paint();
}

/**
 * The pane that last put its page over the window, by the window's bridge. A pane let go parks the window's pages only
 * while it is still that one: a pane drawn anew — another chat's, or the same one moved on top and back to the side
 * (HarnessV4_DesignPass_Plan UX10) — places its page first, and the old pane's late stop must not hide it.
 * @type {WeakMap<object, object>}
 */
const placers = new WeakMap();

/** Whether any of the rectangles lies over the stage's. @param {Rect} stage @param {Rect[]} over */
export const covers = (stage, over) =>
  over.some((r) => r.width > 0 && r.height > 0 && r.x < stage.x + stage.width && r.x + r.width > stage.x && r.y < stage.y + stage.height && r.y + r.height > stage.y);

/**
 * Whether an agent drives the page the pane shows now (BS3): the chat's agent at work, and an agent's browser call
 * working on that tab or run on it within `DRIVE_MS`; never while the developer holds the browser, nor on a tab no
 * agent's call has worked on lately — the developer's own, while an agent works on another.
 * @param {any} st  the chat's browser @param {boolean} working  the chat's agent is at work (state.js `atWork`) @param {number} now
 */
export const drives = (st, working, now) => {
  const t = (st?.tabs || []).find((/** @type {any} */ x) => x.shown);
  return !!st?.available && !st.taken && working && !!t && (!!t.busy || (Number(t.droveAt) > 0 && now - Number(t.droveAt) <= DRIVE_MS));
};

/**
 * The pane's line under its bar: what the agent does, who has the browser, or why nothing shows. `hand`: the app's
 * word of the developer's hand on the page (BS3) — `left`, the seconds before it goes back, while the pointer is off it.
 * `live`: the page comes cast, with no app of the pane's own.
 * @param {any} st  the chat's browser as `GET /sessions/:id/browser` gives it
 * @param {{ inApp: boolean, hand?: { left: number | null } | null, live?: boolean }} o
 */
export function lineOf(st, { inApp, hand = null, live = false }) {
  if (!st) return "Reading the chat's browser…";
  if (!st.available) return inApp ? "Connecting to Filament — the browser shows once it answers." : "No browser here yet: open the Filament desktop app, or install Chrome or Chromium on the machine Filament runs on, and the agent's pages show here.";
  if (st.taken && st.hand) return hand?.left ? `You have the browser — it goes back to the agent in ${hand.left} s` : "You have the browser — it goes back to the agent 5 s after your mouse leaves the page";
  if (st.taken) return live && !inApp ? "You have the browser: click and type on the page. The agent waits until you give it back." : "You have the browser: the agent waits until you give it back.";
  // A sub-agent at work says whose the call is (HarnessV4_AgentTools_Plan AT-D2).
  if (st.busy?.words) return `${st.busy.by || "The agent"}: ${st.busy.words}`;
  if (!(st.tabs || []).length) return "No page yet. The agent opens one when it needs it, or type an address.";
  if (inApp) return "";
  return live ? "The page, live. Take over to use it yourself." : "A picture of the page, read every 2 s: the page itself is in the Filament desktop app.";
}

/** A pointer's or a key's modifiers, as Chrome's input numbers them. @param {any} e */
const modifiersOf = (e) => (e.altKey ? 1 : 0) | (e.ctrlKey ? 2 : 0) | (e.metaKey ? 4 : 0) | (e.shiftKey ? 8 : 0);
/** A mouse's button, as Chrome's input names it. */
const BUTTONS = ["left", "middle", "right", "back", "forward"];
/** The text a key types, where it types one. @param {any} e */
const keyText = (e) => (e.key === "Enter" ? "\r" : String(e.key || "").length === 1 && !e.ctrlKey && !e.metaKey ? String(e.key) : "");

/**
 * Where a point of the pane's lies on a cast page, in the page's own points: the picture is drawn whole in its box
 * (object-fit: contain), centred. `inside`: on the page itself; outside it, the nearest point of its edge.
 * @param {{ x: number, y: number }} at  the pointer's, in the window @param {Rect} box  the picture's
 * @param {{ width: number, height: number }} page  the page's own size
 * @returns {{ x: number, y: number, inside: boolean } | null}
 */
export function pagePoint(at, box, page) {
  const s = Math.min(box.width / page.width, box.height / page.height);
  if (!(s > 0) || !Number.isFinite(s)) return null;
  const x = (at.x - box.x - (box.width - page.width * s) / 2) / s;
  const y = (at.y - box.y - (box.height - page.height * s) / 2) / s;
  const inside = x >= 0 && y >= 0 && x < page.width && y < page.height;
  return { x: Math.round(Math.min(page.width, Math.max(0, x))), y: Math.round(Math.min(page.height, Math.max(0, y))), inside };
}

/**
 * @param {HTMLElement} body
 * @param {{ chat?: any, head?: HTMLElement, onToast?: (m: string, k?: string) => void,
 *   api?: (path: string, init?: any) => Promise<any>, bridge?: ReturnType<typeof bridgeOf>, doc?: Document,
 *   working?: () => boolean, now?: () => number, cast?: (chain: string, tap: import("../lib/run-socket.js").CastTap) => { stop: () => void, input: (ev: Record<string, unknown>) => void } }} ctx
 *   `api`, `bridge`, `doc`: the admin API, the app's bridge and the document; `working`: whether the chat's agent is at
 *   work (state.js `atWork` by default); `now`: the clock; `cast`: the chat's browser watched live (the page's run
 *   socket by default) — the tests' stand-ins
 */
export function renderBrowser(body, ctx) {
  const call = ctx.api || adminApi;
  const bridge = ctx.bridge === undefined ? bridgeOf() : ctx.bridge;
  const castOf = ctx.cast || ((/** @type {string} */ c, /** @type {any} */ tap) => runSocket.cast(c, tap));
  const doc = ctx.doc || document;
  const toast = ctx.onToast || (() => {});
  const chain = String(ctx.chat?.chainId || "");
  const working = ctx.working || (() => atWork(chain, ctx.chat));
  const clock = ctx.now || Date.now;
  if (!chain) {
    body.append(h("div", { class: "pane-empty" }, "The browser is a chat's: open a chat whose browser is on (Settings › Instructions › Drive a browser)."));
    return;
  }
  const path = `/sessions/${encodeURIComponent(chain)}/browser`;
  /** @type {any} */
  let st = null;
  let alive = true;
  /**
   * The developer's hand on the page, as the app last said it (BS3): null, or held — `left`, the seconds before it
   * goes back while the pointer is off the page; `asked`, Filament not answered the take yet.
   * @type {{ left: number | null, asked: boolean } | null}
   */
  let hand = null;
  /** The app's bridge refused the tab shown: the app holds it not, and the pane shows it as one with no app does. */
  let refused = false;
  /** The page itself is drawn over the stage by the app: a bridge, which took the tab. */
  const native = () => !!bridge && !refused;

  /** @param {Parameters<typeof icon>[0]} name @param {string} title @param {(e: any) => void} onClick */
  const iconBtn = (name, title, onClick) => {
    const b = h("button", { class: "ghost icon brw-btn", type: "button", "aria-label": title, html: icon(name) });
    b.addEventListener("click", onClick);
    tooltip(b, { title });
    return b;
  };
  const back = iconBtn("arrowLeft", "Back", () => void act({ act: "back" }));
  const fwd = iconBtn("arrowRight", "Forward", () => void act({ act: "forward" }));
  const reload = iconBtn("refreshCw", "Reload", () => void act({ act: "reload" }));
  const address = /** @type {HTMLInputElement} */ (h("input", { class: "zc-input brw-address", type: "text", spellcheck: "false", "aria-label": "Address", placeholder: "An address: localhost:5173, example.com" }));
  address.addEventListener("keydown", (/** @type {any} */ e) => {
    if (e.key !== "Enter") return;
    e.preventDefault?.();
    const url = address.value.trim();
    if (url) void act({ act: "navigate", url });
  });
  const take = button({ size: "sm", variant: "outline", label: "Take over", class: "brw-take", onClick: () => void act({ act: st?.taken ? "give" : "take" }) });
  const sizeChip = button({ size: "sm", variant: "ghost", label: "1280 × 800", class: "brw-size", onClick: (e) => sizeMenu(/** @type {any} */ (e.currentTarget)) });
  tooltip(sizeChip, { title: "The page's own size: it lays itself out at it whatever the pane's shape, and the agent sees it so. Choose another — the agent is told" });
  const more = iconBtn("ellipsis", "The sites it may act on, and the browser's data", (e) => moreMenu(e.currentTarget));
  const strip = h("div", { class: "brw-tabs" });
  const line = h("div", { class: "brw-line", role: "status" });
  const picture = /** @type {HTMLImageElement} */ (h("img", { class: "brw-picture hidden", alt: "The page in the chat's browser", draggable: "false" }));
  picture.addEventListener("load", () => picture.classList.remove("hidden"));
  picture.addEventListener("error", () => picture.classList.add("hidden"));
  const stage = h("div", { class: "brw-stage" }, picture);
  const bar = h("div", { class: "brw-bar" }, back, fwd, reload, address, sizeChip, take, more);
  const pane = h("div", { class: "brw-pane" }, bar, strip, line, stage);
  const viewWords = h("div", { class: "pane-empty brw-view-only hidden" }, VIEW_ONLY_BROWSER_WORDS);
  body.append(pane, viewWords);

  /** The person's act on the chat's browser, then the pane as it stands after it. @param {Record<string, unknown>} p */
  async function act(p) {
    try {
      const r = await call(path, { method: "POST", body: p });
      if (r?.state) paint(r.state);
    } catch (/** @type {any} */ e) {
      toast(`The browser: ${String(e?.body?.error || e?.message || e)}`, "err");
    }
  }
  /**
   * The size chip's menu: the four sizes, Custom…, and Fit the pane — the shown tab's, the agent told of each (BS-D3,
   * BS-D5). @param {HTMLElement} anchor
   */
  function sizeMenu(anchor) {
    const t = shownTab();
    if (!t) return;
    const own = t.size?.width ? t.size : { width: 1280, height: 800 };
    const named = PAGE_SIZES.find((s) => s.width === own.width && s.height === own.height) || null;
    menu(
      [
        { type: "label", label: "The page's size" },
        ...PAGE_SIZES.map((s) => ({ type: "check", label: s.label, note: sizeWords(s), checked: !t.fit && named === s, onClick: () => void act({ act: "size", size: s.name }) })),
        { type: "check", label: "Custom…", note: !t.fit && !named ? sizeWords(own) : "", checked: !t.fit && !named, onClick: () => customSize(own) },
        { type: "separator" },
        { type: "check", label: "Fit the pane", desc: "The page takes the pane's size and lays itself out again as the pane moves", checked: !!t.fit, onClick: () => void act({ act: "size", fit: true }) },
      ],
      { anchor, align: "end" },
    );
  }
  /** A size of the developer's own, in two fields. @param {{ width: number, height: number }} own */
  function customSize(own) {
    const field = (/** @type {string} */ label, /** @type {number} */ v, /** @type {number} */ max) => /** @type {HTMLInputElement} */ (h("input", { class: "zc-input brw-size-in", type: "number", min: "320", max: String(max), step: "1", value: String(v), "aria-label": label }));
    const w = field("Width", own.width, 2560);
    const ht = field("Height", own.height, 1600);
    const set = () => {
      d.close(true);
      void act({ act: "size", width: Number(w.value), height: Number(ht.value) });
    };
    for (const f of [w, ht]) f.addEventListener("keydown", (/** @type {any} */ e) => void (e.key === "Enter" && (e.preventDefault?.(), set())));
    const d = dialog({
      title: "The page's size",
      description: "In CSS pixels: 320–2560 wide, 320–1600 tall. The page lays itself out at it; the agent is told.",
      body: h("div", { class: "brw-size-form" }, h("label", {}, "Width", w), h("span", { class: "brw-size-x", "aria-hidden": "true" }, "×"), h("label", {}, "Height", ht)),
      actions: [
        { label: "Cancel", variant: "outline", onClick: () => d.close(true) },
        { label: "Set", onClick: set },
      ],
    });
  }
  /** @param {HTMLElement} anchor */
  function moreMenu(anchor) {
    const sites = /** @type {string[]} */ (st?.sites || []);
    // A team's lead's yes holds for that team's workers alone: said with the team, and forgotten as yours is.
    const teamSites = /** @type {{ site: string, team: string }[]} */ (st?.teamSites || []);
    const url = shownUrl();
    menu(
      [
        { type: "label", label: "It may act on" },
        ...(sites.length || teamSites.length
          ? [
              ...sites.map((site) => ({ icon: "globe", label: site, desc: "Forget: it asks again before it acts there", onClick: () => void act({ act: "forbid", site }) })),
              ...teamSites.map((t) => ({ icon: "globe", label: t.site, desc: `Its lead's yes, for the ${t.team} team's workers. Forget: they ask again before they act there`, onClick: () => void act({ act: "forbid", site: t.site }) })),
            ]
          : [{ label: "No site yet — it asks before it first acts on one", disabled: true }]),
        { type: "separator" },
        // Without an opener: the site the agent browsed gets no hold on the harness's tab (reverse tabnabbing).
        ...(url && /^https?:/i.test(url) ? [{ icon: "appWindow", label: "Open this page in your browser", onClick: () => void window.open(url, "_blank", "noopener") }] : []),
        {
          icon: "x",
          label: "Clear the browser's data…",
          variant: "destructive",
          onClick: async () => {
            const yes = await confirmDialog({ title: "Clear the browser's data?", description: "Every chat's browser loses its sign-ins, cookies and what sites kept. The pages open stay open.", confirmLabel: "Clear", destructive: true });
            if (yes) void act({ act: "clear" });
          },
        },
      ],
      { anchor, align: "end" },
    );
  }

  /** The tabs as the strip last drew them: it is drawn again only when they change, so a press or a hover on it holds. */
  let stripKey = "";
  const shownTab = () => (st?.tabs || []).find((/** @type {any} */ t) => t.shown) || null;
  const shownUrl = () => String(shownTab()?.url || "");
  /** The pane as the chat's browser stands. @param {any} next */
  function paint(next) {
    st = next;
    const tabs = /** @type {any[]} */ (st?.tabs || []);
    const on = !!st?.available;
    for (const b of [back, fwd, reload]) b.toggleAttribute("disabled", !on || !tabs.length);
    address.toggleAttribute("disabled", !on);
    if (doc.activeElement !== address) address.value = shownUrl() === "about:blank" ? "" : shownUrl();
    const label = take.querySelector(".zc-btn-label");
    if (label) label.textContent = st?.taken ? "Give back" : "Take over";
    take.title = st?.taken ? "Give the browser back: the agent may use it again" : "Take over: the agent's calls wait until you give it back";
    take.classList.toggle("is-on", !!st?.taken);
    const sizeLabel = sizeChip.querySelector(".zc-btn-label");
    if (sizeLabel) sizeLabel.textContent = sizeChipWords(shownTab());
    sizeChip.toggleAttribute("disabled", !on || !tabs.length);
    const key = JSON.stringify([on, tabs.map((t) => [t.id, !!t.shown, t.title || "", t.url || "", t.by || ""])]);
    if (key !== stripKey) {
      stripKey = key;
      strip.replaceChildren(
      ...tabs.map((t) =>
        h(
          "button",
          { class: `brw-tab${t.shown ? " on" : ""}`, type: "button", title: `${t.by ? `${t.by}'s tab: ` : ""}${t.title || t.url}${t.shown ? "" : " — click to show it"}`, onclick: () => void (t.shown ? null : act({ act: "select", tab: t.id })) },
          // A sub-agent's tab says whose it is (AT-D2): showing it moves no agent's work (AT-D3).
          t.by ? h("span", { class: "brw-tab-by" }, String(t.by).slice(0, 24)) : null,
          h("span", { class: "brw-tab-name" }, String(t.title || t.url || "New tab").slice(0, 40)),
          h("span", { class: "brw-tab-x", role: "button", "aria-label": "Close this tab", html: icon("x"), onclick: (/** @type {any} */ e) => (e.stopPropagation?.(), void act({ act: "close", tab: t.id })) }),
        ),
      ),
        ...(on ? [h("button", { class: "ghost icon brw-new", type: "button", "aria-label": "New tab", html: icon("plus"), onclick: () => void act({ act: "new" }) })] : []),
      );
    }
    // Given back another way than by the 5 s (Give back, the bar's take over it): the app stops its watch of the pointer.
    if (hand && !hand.asked && !(st?.taken && st?.hand)) {
      hand = null;
      bridge?.handOff?.();
    }
    paintLine();
    if (!native()) shot();
    place();
  }
  /** The line under the bar, with the hand's seconds where the app said them. */
  function paintLine() {
    line.textContent = lineOf(st, { inApp: native(), hand, live: live.on });
    line.classList.toggle("hidden", !line.textContent);
    // The page the person's: a touch on it is a press and a drag there, never the pane's own scroll or zoom.
    stage.classList.toggle("brw-yours", yours());
  }

  // ---- the page live, with no app of the pane's own: the app's cast on the run socket, and the person's input back ----
  /** The cast, while the pane watches the chat's browser by it. @type {ReturnType<typeof castOf> | null} */
  let watching = null;
  /** Where the cast stands, as the server last said it. */
  let live = { on: false, tab: /** @type {string | null} */ (null) };
  /** The frame drawn now: its tab, number and the page's own size. @type {{ tab: string, seq: number, width: number, height: number } | null} */
  let drawn = null;
  let refusedAt = 0;
  /** The chat's browser watched live — again at the next read where its socket went. */
  function watchLive() {
    if (native() || watching || !alive || viewOnly) return;
    /** @type {ReturnType<typeof castOf> | null} */
    let mine = null;
    const gone = () => {
      if (watching === mine) watching = null;
      live = { on: false, tab: null };
      if (alive) {
        paintLine();
        shot();
      }
    };
    try {
      mine = castOf(chain, {
        state: (s) => {
          if (!alive || watching !== mine) return;
          live = { on: !!s?.on, tab: s?.tab ?? null };
          paintLine();
          // Off — no app, or one that casts nothing —: the page's picture, read every 2 s, stands in.
          if (!live.on) shot();
        },
        frame: (f) => {
          if (!alive || watching !== mine || !f?.data) return;
          // A frame older than the one drawn is dropped: the page shows as it is now.
          if (drawn && drawn.tab === f.tab && Number(f.seq) <= drawn.seq) return;
          const was = yours();
          drawn = { tab: String(f.tab), seq: Number(f.seq) || 0, width: Number(f.width) || 0, height: Number(f.height) || 0 };
          picture.src = `data:image/jpeg;base64,${f.data}`;
          picture.classList.remove("hidden");
          if (yours() !== was) paintLine();
        },
        refused: (why) => {
          if (!alive || clock() - refusedAt < REFUSED_MS) return;
          refusedAt = clock();
          toast(`The browser: ${why}`, "err");
        },
        drop: gone,
      });
      watching = mine;
    } catch {
      gone();
    }
  }
  /**
   * The cast no longer watched — the stage not before the person, the page view-only —: the server stops it once no page
   * watches, and the next read watches again.
   */
  function unwatch() {
    const w = watching;
    watching = null;
    w?.stop();
    if (live.on) {
      live = { on: false, tab: null };
      paintLine();
    }
  }
  /**
   * Whether the person's input on the picture goes to the page: it is cast, the frame drawn is the tab cast now, and
   * the browser theirs — a click on a picture of the tab before never lands on the one after it.
   */
  const yours = () => !!watching && live.on && !!drawn?.width && !!drawn.height && drawn.tab === live.tab && !!st?.taken;
  /** The person's input to the page. @param {Record<string, unknown>} ev */
  const input = (ev) => watching?.input(ev);
  /** Where the pointer is on the page, in its own points. @param {any} e */
  const pointOn = (e) => {
    if (!drawn) return null;
    const r = picture.getBoundingClientRect();
    return pagePoint({ x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 }, { x: r.left ?? r.x ?? 0, y: r.top ?? r.y ?? 0, width: r.width || 0, height: r.height || 0 }, drawn);
  };
  /** The last press: when, where in the window, its button and its count (`CLICK_MS`). */
  let press = { at: -Infinity, x: 0, y: 0, button: -1, count: 1 };
  /**
   * The button held on the page, and where it last was there: a pointer cancelled lets it go there.
   * @type {{ e: any, p: { x: number, y: number } } | null}
   */
  let held = null;
  /** @param {any} e @param {string} type @param {{ x: number, y: number }} p */
  const mouse = (e, type, p) => ({ kind: "mouse", type, x: p.x, y: p.y, button: type === "mouseMoved" ? ((Number(e.buttons) & 1) ? "left" : "none") : BUTTONS[Number(e.button)] || "left", buttons: Number(e.buttons) || 0, clickCount: type === "mouseMoved" ? 0 : press.count, modifiers: modifiersOf(e) });
  // A move goes at most every MOVE_MS, the newest of those between; a press or a release drops the one waiting.
  let movedAt = 0;
  /** @type {Record<string, unknown> | null} */
  let nextMove = null;
  /** @type {any} */
  let moveTimer = null;
  const flushMove = () => {
    moveTimer = null;
    const ev = nextMove;
    nextMove = null;
    if (!ev || !yours()) return;
    movedAt = clock();
    input(ev);
  };
  // The person's input on a cast page: with no app, and in one whose bridge refused the tab — each asks `yours()`.
  {
    if (!bridge) stage.setAttribute("tabindex", "0");
    stage.addEventListener("pointerdown", (/** @type {any} */ e) => {
      if (!yours()) return;
      const p = pointOn(e);
      if (!p?.inside) return;
      e.preventDefault?.();
      stage.focus?.();
      stage.setPointerCapture?.(e.pointerId);
      nextMove = null;
      const now = clock();
      const x = Number(e.clientX) || 0;
      const y = Number(e.clientY) || 0;
      const again = now - press.at < CLICK_MS && Math.hypot(x - press.x, y - press.y) < CLICK_PX && Number(e.button) === press.button;
      press = { at: now, x, y, button: Number(e.button), count: again ? Math.min(3, press.count + 1) : 1 };
      held = { e, p };
      input(mouse(e, "mousePressed", p));
    });
    stage.addEventListener("pointerup", (/** @type {any} */ e) => {
      held = null;
      if (!yours()) return;
      const p = pointOn(e);
      if (!p) return;
      nextMove = null;
      input(mouse(e, "mouseReleased", p));
    });
    // A touch the browser took for its own (a swipe on a phone, the pointer lost): the button goes up where it last was
    // on the page — else the page holds it down.
    stage.addEventListener("pointercancel", () => {
      const was = held;
      held = null;
      if (!was || !yours()) return;
      nextMove = null;
      input(mouse(was.e, "mouseReleased", was.p));
    });
    stage.addEventListener("pointermove", (/** @type {any} */ e) => {
      if (!yours()) return;
      const p = pointOn(e);
      if (!p || (!p.inside && !e.buttons)) return;
      if (held) held = { e: held.e, p };
      nextMove = mouse(e, "mouseMoved", p);
      if (moveTimer) return;
      const wait = MOVE_MS - (clock() - movedAt);
      if (wait <= 0) flushMove();
      else moveTimer = setTimeout(flushMove, wait);
    });
    stage.addEventListener(
      "wheel",
      (/** @type {any} */ e) => {
        if (!yours()) return;
        const p = pointOn(e);
        if (!p?.inside) return;
        e.preventDefault?.();
        // Chrome's input takes pixels: a wheel that counts lines (a mouse's on Firefox) or pages turns into them.
        const by = Number(e.deltaMode) === 1 ? LINE_PX : Number(e.deltaMode) === 2 ? drawn?.height || 800 : 1;
        input({ kind: "mouse", type: "mouseWheel", x: p.x, y: p.y, deltaX: (Number(e.deltaX) || 0) * by, deltaY: (Number(e.deltaY) || 0) * by, modifiers: modifiersOf(e) });
      },
      { passive: false },
    );
    // The page's own right-click, not the pane's.
    stage.addEventListener("contextmenu", (/** @type {any} */ e) => void (yours() && e.preventDefault?.()));
    stage.addEventListener("keydown", (/** @type {any} */ e) => {
      if (!yours()) return;
      // A paste is the pane's browser's to read: its keys go no further, and its text comes as the paste does.
      if ((e.ctrlKey || e.metaKey) && String(e.key).toLowerCase() === "v") return;
      e.preventDefault?.();
      e.stopPropagation?.();
      const text = keyText(e);
      input({ kind: "key", type: text ? "keyDown" : "rawKeyDown", key: e.key, code: e.code, windowsVirtualKeyCode: Number(e.keyCode) || 0, modifiers: modifiersOf(e), ...(text ? { text } : {}) });
    });
    stage.addEventListener("keyup", (/** @type {any} */ e) => {
      if (!yours()) return;
      e.preventDefault?.();
      e.stopPropagation?.();
      input({ kind: "key", type: "keyUp", key: e.key, code: e.code, windowsVirtualKeyCode: Number(e.keyCode) || 0, modifiers: modifiersOf(e) });
    });
    stage.addEventListener("paste", (/** @type {any} */ e) => {
      if (!yours()) return;
      const text = String(e.clipboardData?.getData?.("text/plain") || "");
      e.preventDefault?.();
      if (text) input({ kind: "text", text });
    });
  }

  // ---- the developer's hand on the page (BS3): the app's word, relayed to Filament ----
  /**
   * The app's word: taken from the veil (Filament told), held or away with its seconds (the line), over (given back).
   * A pane drawn again while the page is in the developer's hand hears the rest of it the same.
   * @param {any} m  `{ state: "take" | "held" | "away" | "over", tab, left? }`
   */
  const heardHand = (m) => {
    if (!alive || !m) return;
    const byHand = !!(st?.taken && st?.hand);
    if (m.state === "take") {
      // `asked`: a read of the browser already on its way says it is not taken yet — it clears nothing until Filament answers.
      const mine = { left: /** @type {number | null} */ (null), asked: true };
      hand = mine;
      void act({ act: "take", hand: true }).finally(() => void (mine.asked = false));
    } else if (m.state === "held" || m.state === "away") {
      if (!hand && !byHand) return;
      hand = { left: m.state === "away" ? Number(m.left) || null : null, asked: !!hand?.asked };
      paintLine();
    } else if (m.state === "over") {
      hand = null;
      if (byHand) void act({ act: "give" });
      else paintLine();
    }
  };
  const unhear = bridge?.onHand?.(heardHand) || null;

  // ---- reading the chat's browser while the pane shows ----
  async function look() {
    if (!stage.isConnected) return stop();
    // A view-only device's page reads none of it: the server refuses each read.
    if (viewOnly) return;
    // Cast while the stage is before the person alone: a pane under a full-frame screen, or in a tab behind, streams
    // nothing.
    if (seen()) watchLive();
    else unwatch();
    try {
      paint(await call(path));
    } catch {}
  }
  // ---- the page itself over the stage (the app), or its picture (a browser tab, or covered) ----
  let placedKey = "";
  let placed = false;
  let shotAt = 0;
  /** This pane, among the window's placers. */
  const me = {};
  /**
   * Whether the stage is before the person at all: the window shown, nothing above the stage hidden, and no full-frame
   * screen over the panes — Library, Settings, a Space leave them laid out beneath, hidden and inert (shell.js
   * `setScreen`), their rectangle as it was. The page is the app's own view over the whole window, which nothing of the
   * harness's hides: what the stage does not show, the page must not either.
   */
  const seen = () => doc.visibilityState !== "hidden" && stage.checkVisibility?.({ visibilityProperty: true }) !== false && !stage.closest("[inert]");
  /** The stage's rectangle, and whether anything of the harness's own lies over it. */
  const where = () => {
    const r = stage.getBoundingClientRect();
    const rect = { x: r.left ?? r.x ?? 0, y: r.top ?? r.y ?? 0, width: r.width || 0, height: r.height || 0 };
    const over = Array.from(doc.querySelectorAll(COVERS)).filter((el) => !stage.contains(el)).map((el) => {
      const o = el.getBoundingClientRect();
      return { x: o.left ?? o.x ?? 0, y: o.top ?? o.y ?? 0, width: o.width || 0, height: o.height || 0 };
    });
    // A first-run tip's shade darkens the whole window but its hole (coach/coach.js), and the page cannot be darkened:
    // it parks, and its picture stands in, darkened with the rest.
    return { rect, covered: !!doc.querySelector(".coach-dim") || covers(rect, over) };
  };
  /**
   * The page off the stage. A place still on its way to the app counts: the app puts the page there all the same, and
   * the park sent after it reaches the app after it — else a screen opened meanwhile had the page over it until the
   * next check.
   */
  function park() {
    if (!bridge || (!placed && !placedKey)) return;
    placed = false;
    placedKey = "";
    // Another pane placed its page since: the window's pages are its to park.
    if (placers.get(bridge) !== me) return;
    placers.delete(bridge);
    bridge.park();
  }
  function place() {
    if (!bridge) return;
    if (!stage.isConnected) return stop();
    if (viewOnly) return park();
    const tab = String(shownTab()?.id || "");
    const { rect, covered } = where();
    const visible = seen() && rect.width >= 8 && rect.height >= 8;
    if (!st?.available || !tab || !visible || covered) {
      park();
      if (covered && st?.available && tab) shot();
      else picture.classList.add("hidden");
      return;
    }
    // While an agent drives the page, the app's veil lies over it: the developer's mouse reaches it through Take over.
    const lock = drives(st, working(), clock());
    const key = `${tab}|${Math.round(rect.x)}|${Math.round(rect.y)}|${Math.round(rect.width)}|${Math.round(rect.height)}|${lock ? "locked" : ""}`;
    if (key === placedKey) return;
    placedKey = key;
    // The window's placer from the moment it asks: a pane drawn anew that asks after it is the one to park its pages.
    placers.set(bridge, me);
    void bridge.place(tab, rect, { lock }).then(
      (ok) => {
        if (placedKey !== key) return;
        placed = !!ok;
        refuse(!placed);
        picture.classList.toggle("hidden", placed);
        if (!placed) shot();
      },
      () => {},
    );
  }
  /**
   * The app took the tab shown, or refused it — it holds it not —: refused, the page as it is cast stands in, live, and
   * the person's input reaches it once they take the browser over; taken, the app's own page, the cast let go.
   * @param {boolean} no
   */
  function refuse(no) {
    if (refused === no) return;
    refused = no;
    if (no) stage.setAttribute("tabindex", "0");
    else stage.removeAttribute("tabindex");
    if (no && seen()) watchLive();
    else if (!no) unwatch();
    paintLine();
  }
  /** The page's picture, read again at most every `SHOT_MS` — where no cast shows the page live, the last resort. */
  function shot() {
    if (viewOnly) return;
    if (!st?.available || !shownTab()) return void picture.classList.add("hidden");
    // Not before the person (no app's: the app's own place decides): no picture is read.
    if (live.on || (!bridge && !seen())) return;
    const now = Date.now();
    if (now - shotAt < SHOT_MS) return;
    shotAt = now;
    picture.src = `/api${path}/shot?at=${now}`;
  }

  // Out of sight the reads wait: a page kept hidden (a tab behind, a window minimized, another machine's page the
  // desktop app keeps out of view) asked for the chat's browser every 1.5 s, and kept the tab it shows from ever
  // closing unused. Shown again, `onShown` reads it at once.
  const looks = setInterval(() => {
    if (!stage.isConnected) return stop();
    if (doc.visibilityState !== "hidden") void look();
  }, LOOK_MS);
  const places = bridge ? setInterval(place, PLACE_MS) : setInterval(() => (stage.isConnected ? shot() : stop()), SHOT_MS);
  /** @type {any} */
  const Watch = /** @type {any} */ (globalThis).MutationObserver;
  const watch = bridge && Watch ? new Watch(() => place()) : null;
  watch?.observe(doc.body, { childList: true });
  // A full-frame screen comes over the panes, or goes, as they turn inert: the page parks, or comes back, at once —
  // not a check later, drawn over the screen meanwhile.
  const screens = bridge && Watch ? new Watch(() => place()) : null;
  screens?.observe(doc.body, { subtree: true, attributeFilter: ["inert"] });
  /** @type {any} */
  const Sizes = /** @type {any} */ (globalThis).ResizeObserver;
  const sizes = bridge && Sizes ? new Sizes(() => place()) : null;
  sizes?.observe(stage);
  // A tab put behind stops the cast at once, and one brought back watches again at once — not a read later.
  const onShown = () => void (doc.visibilityState === "hidden" ? unwatch() : look());
  doc.addEventListener?.("visibilitychange", onShown);
  /** The pane as the page's device stands: a view-only device's says it shows nothing, and stops what it read. */
  function paintViewOnly() {
    if (!alive) return;
    pane.classList.toggle("hidden", viewOnly);
    viewWords.classList.toggle("hidden", !viewOnly);
    if (!viewOnly) return void look();
    unwatch();
    drawn = null;
    picture.removeAttribute("src");
    picture.classList.add("hidden");
    park();
  }
  viewOnlyPanes.add(paintViewOnly);
  if (viewOnly) paintViewOnly();
  function stop() {
    if (!alive) return;
    alive = false;
    viewOnlyPanes.delete(paintViewOnly);
    doc.removeEventListener?.("visibilitychange", onShown);
    clearInterval(looks);
    clearInterval(places);
    watch?.disconnect();
    screens?.disconnect();
    sizes?.disconnect();
    unhear?.();
    if (moveTimer) clearTimeout(moveTimer);
    const w = watching;
    watching = null;
    w?.stop();
    park();
  }
  // The run's pulse refreshes the pane in place (`refreshBrowser`): a draw anew would park the page and put it back.
  /** @type {any} */ (body).brwLook = () => void look();
  void look();
}

/**
 * The run's pulse: the pane reads the chat's browser again, in place — the page stays where it is.
 * @param {HTMLElement} body
 */
export function refreshBrowser(body) {
  /** @type {any} */ (body).brwLook?.();
}

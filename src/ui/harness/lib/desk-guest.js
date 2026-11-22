// @ts-check
// A chat of another machine's shown in place (the remote desk of 11-22): This computer's left bar stays, and the column
// beside it — the header, the chat and the panes — shows that machine's own page of the chat alone (lib/chat-only.js),
// a view of the desktop app's laid over the column (desktop/lib/rail.js `showChat`). The page measures the column and
// tells the app as it moves; while something of its own the person acts in lies over it — a menu, a popover, a dialog,
// a sheet, the command center, a full-frame screen, a first-run tip's shade — the view goes from sight, as the Browser
// pane's page does (panes/browser.js), and comes back as it goes. A machine whose Filament shows no chat alone (its desk
// flags without `chat-only`), or a page with no such bridge, opens the chat on that machine's whole page (`openWhole`).
import { parseRoute } from "./router.js";

/**
 * What of This computer's page lying over the column takes the chat shown there from sight: what the person acts in.
 * Not a tooltip, nor a toast: those stand under it a moment, rather than the chat going for them.
 */
export const GUEST_COVERS = ".zc-menu, .zc-popover, .zc-dialog-overlay, .zc-sheet, [role='menu'], [role='dialog'], [role='listbox']";
/** How often the column is measured again, besides each change seen: what moves it unseen (a font, a zoom) waits no longer. */
export const PLACE_MS = 500;

/** The chat an address of a harness names, or null. @param {string | null | undefined} hash */
export const chainOfHash = (hash) => {
  const r = /** @type {any} */ (parseRoute(String(hash || "")));
  return r.kind === "task" && r.id ? String(r.id) : null;
};

/** @typedef {{ x: number, y: number, width: number, height: number }} Rect */

/** @param {any} r @returns {Rect} */
const rectOf = (r) => ({ x: Number(r?.left ?? r?.x) || 0, y: Number(r?.top ?? r?.y) || 0, width: Number(r?.width) || 0, height: Number(r?.height) || 0 });

/** Whether any of the rectangles lies over the column's. @param {Rect} col @param {Rect[]} over */
const lies = (col, over) => over.some((r) => r.width > 0 && r.height > 0 && r.x < col.x + col.width && r.x + r.width > col.x && r.y < col.y + col.height && r.y + r.height > col.y);

/**
 * @param {{ bridge: any, stage: HTMLElement, openWhole: (machine: string, route: string) => void,
 *   onMoved: (at: { machine: string, chain: string | null } | null) => void, onShown?: (s: "in" | "out" | null) => void,
 *   say?: (words: string) => void, doc?: any, win?: any, every?: (fn: () => void, ms: number) => any, stopEvery?: (t: any) => void }} o
 *   `bridge`: the app's (harness-preload.cjs `filamentMachines`); `stage`: the column (shell.js `contentCol`);
 *   `openWhole`: a chat opened on its machine's whole page (the app's `openOn`); `onMoved`: the chat shown in place, as
 *   it opens, moves there or goes — the list marks it; `onShown`: whether it is in sight over the column, out of sight a
 *   moment, or gone (shell.js `setGuest`); `say`: a line for the person
 */
export function createDeskGuest(o) {
  const doc = o.doc || /** @type {any} */ (globalThis).document;
  const win = o.win || globalThis;
  const every = o.every || setInterval;
  const stopEvery = o.stopEvery || clearInterval;
  const bridge = o.bridge && typeof o.bridge.showChat === "function" && typeof o.bridge.placeChat === "function" && typeof o.bridge.hideChat === "function" ? o.bridge : null;
  /** The chat shown in place: its machine and its address there. @type {{ machine: string, route: string } | null} */
  let at = null;
  /** Where it was last placed, as told: "out" while out of sight. */
  let placedKey = "";
  /** The look it was shown in. */
  let theme = "dark";
  /** Each open asked, so an answer that comes after a later one's opens nothing. */
  let asks = 0;
  /** Opens asked and not answered yet: one let go meanwhile is let go in the app too, whatever it shows by then. */
  let pending = 0;
  /** The keys are the chat's once it is in sight: it opened out of sight, or a key it handed this page opened something here. */
  let keysOwed = false;
  /** In sight, out of sight, or none, as last told. @type {"in" | "out" | null} */
  let shownAs = null;
  /** The machines whose whole page opened for want of a chat alone, said once each. @type {Set<string>} */
  const said = new Set();
  /** @type {any} */
  let timer = null;
  /** @type {any[]} */
  let watchers = [];

  const themeNow = () => (doc?.documentElement?.classList?.contains("theme-zai-light") ? "light" : "dark");
  /** The column's rectangle, and whether it is out of sight: covered, under a screen, or too small to show a page. */
  const where = () => {
    const rect = rectOf(o.stage.getBoundingClientRect());
    const screen = !!o.stage.querySelector?.(".main-frame.screen-on") || !!doc?.querySelector?.(".coach-dim");
    // What stands in the column itself — a permission's choices over this computer's composer — is under the chat already.
    const over = Array.from(doc?.querySelectorAll?.(GUEST_COVERS) || [])
      .filter((/** @type {any} */ el) => !o.stage.contains?.(el))
      .map((/** @type {any} */ el) => rectOf(el.getBoundingClientRect()));
    return { rect, out: screen || rect.width < 8 || rect.height < 8 || lies(rect, over) };
  };
  /** @param {{ rect: Rect, out: boolean }} w */
  const keyOf = (w) => (w.out ? "out" : [w.rect.x, w.rect.y, w.rect.width, w.rect.height].map(Math.round).join("|"));
  /** @param {"in" | "out" | null} s */
  const shown = (s) => {
    if (s === shownAs) return;
    shownAs = s;
    o.onShown?.(s);
  };
  /**
   * Whether the keys go back to the chat in sight: this page has them, and they are owed it, or they rest on what of
   * this page lies under it — a field focused unseen there, where what is typed would go into a chat out of sight.
   */
  const keysBack = () => {
    if (typeof doc?.hasFocus !== "function" || !doc.hasFocus()) return false;
    const el = doc.activeElement;
    return keysOwed || (!!el && el !== doc.body && !!o.stage.contains?.(el));
  };

  /** The column measured again, and the app told where it is — only when that moved, or the keys are the chat's again. */
  function place() {
    if (!at || !bridge) return;
    // The look moved: shown again in it, where it is.
    if (themeNow() !== theme) return void again();
    const w = where();
    const key = keyOf(w);
    const keys = !w.out && keysBack();
    if (key === placedKey && !keys) return;
    placedKey = key;
    if (!w.out) keysOwed = false;
    shown(w.out ? "out" : "in");
    bridge.placeChat(w.out ? null : w.rect, keys);
  }
  /** The chat shown again where it is, in the page's look now; the keys left where they are. */
  async function again() {
    if (!at || !bridge) return;
    theme = themeNow();
    const w = where();
    placedKey = keyOf(w);
    shown(w.out ? "out" : "in");
    await Promise.resolve(bridge.showChat({ machine: at.machine, route: at.route, rect: w.out ? null : w.rect, theme })).catch(() => false);
  }
  /**
   * Words said once this page has lost the keys and has them again — the person back at it —, not now, when that
   * machine's whole page is about to lie over it, nor at a focus the app gave this page a moment before.
   * @param {string} words
   */
  const owe = (words) => {
    if (typeof win?.addEventListener !== "function") return void o.say?.(words);
    const back = () => {
      win.removeEventListener("focus", back);
      o.say?.(words);
    };
    const went = () => {
      win.removeEventListener("blur", went);
      win.addEventListener("focus", back);
    };
    win.addEventListener("blur", went);
  };

  function watch() {
    if (timer) return;
    timer = every(place, PLACE_MS);
    const g = /** @type {any} */ (globalThis);
    if (g.ResizeObserver) {
      const r = new g.ResizeObserver(() => place());
      r.observe(o.stage);
      watchers.push(r);
    }
    if (g.MutationObserver) {
      // A menu, a dialog or a sheet comes as a child of the body; a screen as the frame's class; the look as the page's.
      const m = new g.MutationObserver(() => place());
      if (doc?.body) m.observe(doc.body, { childList: true });
      const frame = o.stage.querySelector?.(".main-frame");
      if (frame) m.observe(frame, { attributes: true, attributeFilter: ["class"] });
      if (doc?.documentElement) m.observe(doc.documentElement, { attributes: true, attributeFilter: ["class"] });
      watchers.push(m);
    }
  }
  function unwatch() {
    if (timer) stopEvery(timer);
    timer = null;
    for (const w of watchers) w.disconnect?.();
    watchers = [];
  }
  /** Gone from the column, as the app said or as this page let it go. */
  function forget() {
    at = null;
    placedKey = "";
    keysOwed = false;
    unwatch();
    shown(null);
    o.onMoved(null);
  }

  // Its page went to another chat of its machine's, or stopped showing there (its whole page shown, its machine gone).
  bridge?.onGuest?.((/** @type {{ id: string, hash: string | null }} */ g) => {
    if (!at || g?.id !== at.machine) return;
    if (g.hash === null) return forget();
    at.route = g.hash;
    o.onMoved({ machine: at.machine, chain: chainOfHash(g.hash) });
  });

  /**
   * A chat of another machine's opened from This computer's list: shown in place where its machine's Filament shows a
   * chat alone and the app can lay it over the column, else opened on its whole page — said once, where only an older
   * Filament there stands in the way. → whether it shows in place.
   * @param {{ id: string, name: string, flags?: readonly string[] }} m @param {string} route
   */
  async function open(m, route) {
    const n = ++asks;
    if (!bridge || !(m.flags || []).includes("chat-only")) {
      if (bridge && !said.has(m.id)) {
        said.add(m.id);
        owe(`${m.name}'s Filament shows its chats beside this list once it is updated: its whole page opened`);
      }
      close();
      o.openWhole(m.id, route);
      return false;
    }
    theme = themeNow();
    const w = where();
    pending++;
    // The keys go to it as it shows; out of sight, as it comes in sight.
    const ok = await Promise.resolve(bridge.showChat({ machine: m.id, route, rect: w.out ? null : w.rect, theme, focus: true }))
      .catch(() => false)
      .finally(() => void pending--);
    if (n !== asks) return false;
    if (!ok) {
      close();
      o.openWhole(m.id, route);
      return false;
    }
    at = { machine: m.id, route };
    placedKey = keyOf(w);
    keysOwed = w.out;
    watch();
    shown(w.out ? "out" : "in");
    o.onMoved({ machine: m.id, chain: chainOfHash(route) });
    // What moved while it was asked — a screen that left for it — told now, not at the next look.
    place();
    return true;
  }

  /**
   * The chat shown in place let go: the column This computer's own again. An open still asked is let go with it — the
   * app hears this after it, so what that open shows goes.
   */
  function close() {
    asks++;
    if (at || pending) bridge?.hideChat();
    if (at) forget();
  }

  return {
    open,
    close,
    place,
    /**
     * A key the chat in place handed this page (`DESK_KEYS`) was run here, the app having given this page the keys for
     * it: they go back to the chat now where nothing of this page's came over it, else as what came goes.
     */
    handed: () => {
      if (!at || !bridge) return;
      keysOwed = true;
      place();
    },
    /** The chat shown in place: its machine and its chat there, or null. */
    showing: () => (at ? { machine: at.machine, chain: chainOfHash(at.route) } : null),
  };
}

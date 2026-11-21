// @ts-check
// The first-run tips (the owner's FTUE of 11-09: "small ftue bubbles floating around these elements, explaining about
// basic navigations in the filament"): a bubble beside one control at a time, an arrow to it and a ring around it, its
// words from the tips' file (src/ui/harness/coach/coach.json, which the owner edits by hand; GET /api/coach reads it at
// each ask). A tip shows when its moment comes: the file and the tip are on, it is not seen, the tip it follows
// (`after`) is, its condition (`when`, one the page names: `subagent`) holds, and its control is on screen with
// nothing over it — read twice running, so a screen that only flashes by shows none. The tips of a group show in a row,
// counted among those still to see ("1 of 3"), Next scrolling the next one's control into sight (Product's review of
// 11-09); Got it, Next, a click on the control or Esc says it seen, and Skip tips says every tip seen — which the data
// folder keeps (POST /api/coach/seen). A control covered (a sheet, the tour), scrolled away or gone (another chat
// opened), or a moment passed, only hides its tip. The page is dimmed behind a tip, the bubble and its control alone
// lit (the owner's of 11-09: "dim the background only keep the bubble tip and the target in focus"), and never stands
// in the way: every click goes through, and a click elsewhere, typing or Esc turns from the tip — seen once it was up
// long enough to read, and the rest of its row put aside until its controls next come to the page. No tip shows over a
// menu, a popover or a sheet, nor comes up under the person's typing. Nothing here takes the focus from the page.
import { h } from "../../lib/dom.js";

/** How often the page is looked at for a tip's moment, ms. */
export const COACH_POLL_MS = 500;
/** The bubble's distance from its control, and the window's edge it keeps off, px. */
const GAP = 12;
const EDGE = 8;
/** The bubble's size before it is measured, px. */
const SIZE = Object.freeze({ width: 280, height: 132 });
/** How dark the page goes behind a tip where the file's answer names none (http/admin/coach.js `COACH_DIM`). */
const SHADE = 0.7;
/** What the page opens over itself, whose time it is while one shows: a menu, a popover, a sheet or a dialog. */
const FLOATING = '[role="menu"], .zc-popover, [aria-modal="true"]';
/** What hears Esc before a tip does: those, and a list the message box opens. */
const HEARS_ESC = '[role="menu"], [role="listbox"], [aria-modal="true"]';
/** A tip just shown hears no click elsewhere nor typing this long, ms: a double click on Next, a click on its way. */
export const COACH_SETTLE_MS = 400;
/** Turned from after this long on screen, a tip was read, ms: seen; before, it waits with its row (the review of 11-09). */
export const COACH_READ_MS = 2000;
/** How long the shade's hole glides from one tip's control to the next, ms (coach.css `.coach-dim.is-moving`). */
const GLIDE_MS = 260;

/**
 * A tip as the tips' file gives it (http/admin/coach.js `readCoach`); `dim`, its own shade, null for the file's.
 * @typedef {{ id: string, enabled: boolean, group: string, target: string, when: string, after: string, place: string,
 *   title: string, text: string, dim?: number | null }} Tip
 */

/** @param {number} v @param {number} lo @param {number} hi */
const within = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * Where a bubble stands beside its control's box: on the side asked, else the opposite where that has no room — else
 * the side asked, kept inside the window; `arrow` is how far along the bubble's edge its arrow points at the control —
 * its middle, or a tall one's head.
 * @param {{ top: number, left: number, width: number, height: number }} r  the control's box
 * @param {{ width: number, height: number }} b  the bubble's size
 * @param {string} side  top, bottom, left or right
 * @param {{ width: number, height: number }} view  the window
 * @returns {{ side: string, top: number, left: number, arrow: number }}
 */
export function placeBubble(r, b, side, view) {
  /** @type {Record<string, boolean>} */
  const fits = {
    top: r.top - GAP - b.height >= EDGE,
    bottom: r.top + r.height + GAP + b.height <= view.height - EDGE,
    left: r.left - GAP - b.width >= EDGE,
    right: r.left + r.width + GAP + b.width <= view.width - EDGE,
  };
  /** @type {Record<string, string>} */
  const opposite = { top: "bottom", bottom: "top", left: "right", right: "left" };
  const asked = side in opposite ? side : "bottom";
  const s = fits[asked] ? asked : fits[opposite[asked]] ? opposite[asked] : asked;
  const cx = r.left + r.width / 2;
  // Beside a tall control (a card), at its head: its middle may stand under the message box.
  const cy = r.top + Math.min(r.height / 2, 28);
  if (s === "top" || s === "bottom") {
    const left = within(cx - b.width / 2, EDGE, view.width - b.width - EDGE);
    const top = within(s === "bottom" ? r.top + r.height + GAP : r.top - GAP - b.height, EDGE, Math.max(EDGE, view.height - b.height - EDGE));
    return { side: s, top: Math.round(top), left: Math.round(left), arrow: Math.round(within(cx - left, 16, b.width - 16)) };
  }
  const top = within(cy - b.height / 2, EDGE, Math.max(EDGE, view.height - b.height - EDGE));
  const left = within(s === "right" ? r.left + r.width + GAP : r.left - GAP - b.width, EDGE, Math.max(EDGE, view.width - b.width - EDGE));
  return { side: s, top: Math.round(top), left: Math.round(left), arrow: Math.round(within(cy - top, 16, b.height - 16)) };
}

/**
 * The tips, for the page: `start` reads the file and begins looking (→ its answer, for the replay's tour), `reload`
 * reads it again (the events feed back after a restart), `when` names a condition a tip's `when` asks, `reset` shows
 * every tip again (the command center's Show tips again), `look` looks now.
 * @param {{ api: (path: string, o?: any) => Promise<any>, onToast?: (msg: string, kind?: string) => void, skipWords?: () => string }} o
 *   `skipWords`: what the toast after Skip tips says
 * @param {{ doc?: any, h?: typeof h, every?: (fn: () => void, ms: number) => any, stopEvery?: (t: any) => void,
 *   later?: (fn: () => void, ms: number) => void, hitAt?: (x: number, y: number) => any, view?: () => { width: number, height: number },
 *   frame?: (fn: () => void) => void, win?: any, now?: () => number }} [io]  the tests' seams
 */
export function createCoach(o, io = {}) {
  const now = io.now || Date.now;
  const doc = io.doc || globalThis.document;
  const win = io.win || globalThis;
  const mk = io.h || h;
  const every = io.every || ((fn, ms) => setInterval(fn, ms));
  const stopEvery = io.stopEvery || ((t) => clearInterval(t));
  const later = io.later || ((fn, ms) => void setTimeout(fn, ms));
  const frame = io.frame || ((fn) => (globalThis.requestAnimationFrame ? globalThis.requestAnimationFrame(() => fn()) : later(fn, 16)));
  const hitAt = io.hitAt || ((x, y) => doc.elementFromPoint?.(x, y) ?? null);
  const view = io.view || (() => ({ width: doc.documentElement?.clientWidth || globalThis.innerWidth || 0, height: doc.documentElement?.clientHeight || globalThis.innerHeight || 0 }));

  /** @type {Tip[]} */
  let tips = [];
  /** Whether the file has them on. */
  let on = false;
  /** @type {Set<string>} */
  const seen = new Set();
  /** @type {Record<string, () => boolean>} */
  const conds = {};
  /** The looking's timer while any tip is still to see. @type {any} */
  let timer = null;
  /** The tip found at the last look, shown at the next if it is still the one. */
  let ready = "";
  /** The tip Next led to: shown at the first look that finds it, its control scrolled into sight. */
  let eager = "";
  /** A group's row of tips, counted as its first showed: those still to see whose control the page had. @type {Map<string, string[]>} */
  const runs = new Map();
  /** The words last told in a toast about the file, so a reload says them once. */
  let told = "";
  /** The tip on screen, and since when. @type {{ tip: Tip, el: any, bubble: any, ring: any, at: number } | null} */
  let cur = null;
  let placing = false;
  /** How dark the page goes behind a tip, as the file says. */
  let shade = SHADE;
  /** The page's shade, its hole at the tip's control: Next hands it on to the next tip, its hole moving there. @type {any} */
  let dim = null;
  /**
   * The tips of a row the person turned from, each with its row (its group, or itself): a row shows once none of its
   * controls is on the page and they come back. @type {Map<string, string>}
   */
  const resting = new Map();

  /** A control by its selector; one the browser cannot read is none. @param {string} sel */
  const find = (sel) => {
    try {
      return doc.querySelector(sel);
    } catch {
      return null;
    }
  };
  /** Whether a condition holds: one the page never named holds never. @param {string} name */
  const holds = (name) => {
    try {
      return !name || conds[name]?.() === true;
    } catch {
      return false;
    }
  };
  /**
   * Whether the tip a tip follows is behind it: seen, or switched off in the file — a tip the owner turned off holds
   * none back (the review of 11-09). @param {string} id
   */
  const passed = (id) => !id || seen.has(id) || !tips.some((t) => t.id === id && t.enabled);
  /** Whether a tip waits to be seen: on, not seen, after its own, its condition holding. @param {Tip} t */
  const due = (t) => on && t.enabled && !seen.has(t.id) && passed(t.after) && holds(t.when);
  /** Whether anything is still to see, conditions or not. */
  const anyLeft = () => on && tips.some((t) => t.enabled && !seen.has(t.id));
  /** Whether a selector finds anything showing: laid out, and not hidden by its visibility. @param {string} sel */
  const shows = (sel) => {
    try {
      return [...doc.querySelectorAll(sel)].some((m) => m.getClientRects?.().length > 0 && m.checkVisibility?.({ visibilityProperty: true }) !== false);
    } catch {
      return false;
    }
  };

  /**
   * Whether a control is on screen with nothing over it: drawn, and the page's topmost element near its top middle is
   * it, inside it, or a tip's own.
   * @param {any} el
   */
  function inSight(el) {
    if (!el?.isConnected || !el.getClientRects?.().length) return false;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return false;
    const v = view();
    const x = r.left + r.width / 2;
    const y = r.top + Math.min(r.height / 2, 16);
    if (x < 0 || y < 0 || x >= v.width || y >= v.height) return false;
    const hit = hitAt(x, y);
    return !!hit && (hit === el || el.contains(hit) || !!cur?.bubble.contains(hit));
  }

  /** Steps said seen, here at once and in the data folder. @param {string[]} ids */
  function markSeen(ids) {
    const fresh = ids.filter((id) => !seen.has(id));
    for (const id of fresh) seen.add(id);
    if (fresh.length) void o.api("/coach/seen", { method: "POST", body: { ids: fresh } }).catch(() => {});
  }

  /** The tip's bubble and ring gone, and the shade with them — unless the next tip takes it on (`keep`). */
  function hide(keep = false) {
    if (cur) {
      cur.bubble.remove();
      cur.ring.remove();
      cur = null;
    }
    if (keep) return;
    dim?.remove();
    dim = null;
  }

  /** The bubble, the ring and the shade's hole where the control stands now. */
  function place() {
    if (!cur) return;
    const r = cur.el.getBoundingClientRect();
    const m = cur.bubble.getBoundingClientRect();
    const p = placeBubble(r, { width: m.width || SIZE.width, height: m.height || SIZE.height }, cur.tip.place, view());
    cur.bubble.setAttribute("data-side", p.side);
    cur.bubble.style.top = `${p.top}px`;
    cur.bubble.style.left = `${p.left}px`;
    cur.bubble.style.setProperty("--coach-arrow", `${p.arrow}px`);
    const hole = { top: r.top - 4, left: r.left - 4, width: r.width + 8, height: r.height + 8 };
    for (const el of [cur.ring, dim]) if (el) for (const [k, v] of Object.entries(hole)) el.style[k] = `${Math.round(v)}px`;
  }
  /** A scroll or a resize: placed again at the next frame, once. */
  const replace = () => {
    if (!cur || placing) return;
    placing = true;
    frame(() => {
      placing = false;
      place();
    });
  };

  /** The tips of a tip's group in its row, and where it stands. @param {Tip} tip */
  function rowOf(tip) {
    if (!tip.group) return { ids: [tip.id], at: 0 };
    let ids = runs.get(tip.group);
    if (!ids || !ids.includes(tip.id)) {
      ids = tips.filter((t) => t.group === tip.group && due(t) && !!find(t.target)).map((t) => t.id);
      if (!ids.includes(tip.id)) ids = [tip.id];
      runs.set(tip.group, ids);
    }
    return { ids, at: ids.indexOf(tip.id) };
  }

  /** @param {Tip} tip @param {any} el */
  function show(tip, el) {
    const row = rowOf(tip);
    const nextId = row.ids.slice(row.at + 1).find((id) => !seen.has(id)) || "";
    const go = mk("button", { class: "coach-next", type: "button", onclick: () => done(tip, nextId) }, nextId ? "Next" : "Got it");
    const bubble = mk("div", { class: "coach", role: "dialog", "aria-label": tip.title || "Tip", "data-tip": tip.id, "data-side": tip.place },
      mk("span", { class: "coach-arrow", "aria-hidden": "true" }),
      tip.title ? mk("div", { class: "coach-title" }, tip.title) : null,
      tip.text ? mk("p", { class: "coach-text" }, tip.text) : null,
      mk("div", { class: "coach-foot" },
        row.ids.length > 1 ? mk("span", { class: "coach-count" }, `${row.at + 1} of ${row.ids.length}`) : null,
        mk("button", { class: "coach-skip", type: "button", onclick: () => skipAll() }, "Skip tips"),
        go));
    const ring = mk("div", { class: "coach-ring", "aria-hidden": "true" });
    const level = typeof tip.dim === "number" ? tip.dim : shade;
    if (level > 0) dim ||= mk("div", { class: "coach-dim", "aria-hidden": "true" });
    else {
      dim?.remove();
      dim = null;
    }
    dim?.style.setProperty("--coach-dim", String(level));
    // Handed on by Next, the shade's hole glides to the new control — only then: in a scroll it keeps to the ring.
    if (dim?.isConnected) {
      const d = dim;
      d.classList.add("is-moving");
      later(() => d.classList.remove("is-moving"), GLIDE_MS);
    }
    doc.body.append(ring, bubble);
    cur = { tip, el, bubble, ring, at: now() };
    place();
    // A shade new to the page goes in already placed: its hole moves only from one tip's control to the next.
    if (dim) {
      if (!dim.isConnected) doc.body.append(dim);
    }
  }

  /**
   * A tip seen: its bubble goes; `nextId`, its row's next tip, follows — its control scrolled into sight first, shown at
   * once where it is in sight then, the shade's hole moving to it, else at the next look that finds it. A tip seen any
   * other way ends its row: the next it meets is counted afresh.
   * @param {Tip} tip @param {string} [nextId]
   */
  function done(tip, nextId = "") {
    markSeen([tip.id]);
    hide(!!nextId);
    if (!nextId) {
      runs.delete(tip.group);
      return;
    }
    const next = tips.find((t) => t.id === nextId);
    const el = next ? find(next.target) : null;
    // Out of sight, or only its head showing low in the window, where the message box stands over the page.
    if (el && (!inSight(el) || el.getBoundingClientRect().top > view().height / 2)) el.scrollIntoView?.({ block: "center", behavior: "instant" });
    if (next && el && due(next) && inSight(el)) return void show(next, el);
    hide();
    eager = nextId;
    later(look, 350);
  }

  /**
   * The person turned from the tip — a click elsewhere or typing; or Esc, which says it `read`. Never in its first
   * moments (`COACH_SETTLE_MS`: a double click on Next, a click on its way). On screen `COACH_READ_MS` or more, or by
   * Esc, it is seen and the rest of its row put aside; sooner, it is put aside with them, unseen — typing on as it came
   * up never says it read (the review of 11-09). A row put aside shows once its controls left the page and came back
   * (the next new chat's board): never one tip after another under the person's work.
   * @param {boolean} [read]
   */
  function away(read = false) {
    if (!cur) return;
    const up = now() - cur.at;
    if (!read && up < COACH_SETTLE_MS) return;
    const tip = cur.tip;
    const row = rowOf(tip);
    const seenNow = read || up >= COACH_READ_MS;
    for (const id of row.ids.slice(seenNow ? row.at + 1 : row.at)) if (!seen.has(id)) resting.set(id, tip.group || tip.id);
    if (seenNow) return void done(tip);
    hide();
    runs.delete(tip.group);
  }

  function skipAll() {
    markSeen(tips.filter((t) => t.enabled).map((t) => t.id));
    hide();
    runs.clear();
    stopLooking();
    const words = o.skipWords?.();
    if (words) o.onToast?.(words);
  }

  /** Look at the page: the tip on screen kept or hidden; else the first one whose moment came. */
  function look() {
    if (doc.visibilityState === "hidden") return;
    // A row put aside comes back once none of its controls is on the page (the board gone with the first send).
    const gone = (/** @type {string} */ id) => {
      const t = tips.find((x) => x.id === id);
      return !t || !find(t.target)?.getClientRects?.().length;
    };
    for (const row of new Set(resting.values())) {
      const ids = [...resting].filter(([, r]) => r === row).map(([id]) => id);
      if (ids.every(gone)) for (const id of ids) resting.delete(id);
    }
    // A menu, a popover or a sheet open is the person's: the tip on screen waits, and none comes up over it.
    if (shows(FLOATING)) {
      ready = "";
      return void hide();
    }
    if (cur) {
      const tip = cur.tip;
      const el = due(tip) ? find(tip.target) : null;
      // Only the person says a tip seen (the review of 11-09): one whose control left — another chat opened, the Plan
      // tab hidden, the card greyed — or whose moment passed only hides, and its row ends; covered or scrolled away,
      // it waits with its row.
      if (!el || !el.getClientRects?.().length) {
        hide();
        runs.delete(tip.group);
      } else {
        if (el !== cur.el) cur.el = el;
        if (inSight(el)) return void place();
        hide();
      }
    }
    const next = tips.find((t) => due(t) && !resting.has(t.id) && inSight(find(t.target)));
    if (!next) {
      ready = "";
      if (!anyLeft()) stopLooking();
      return;
    }
    if (next.id !== ready && next.id !== eager) {
      ready = next.id;
      return;
    }
    ready = "";
    eager = "";
    show(next, find(next.target));
  }

  /** Whether a press lands in the lit band the shade leaves around the control, the ring's box. @param {any} e */
  const inHole = (e) => {
    const r = cur?.ring.getBoundingClientRect?.();
    return !!r && typeof e.clientX === "number" && e.clientX >= r.left && e.clientX < r.left + r.width && e.clientY >= r.top && e.clientY < r.top + r.height;
  };
  /**
   * A click on the tip's control says it seen; one elsewhere — not its bubble, nor the band lit around its control —
   * turns from it, and goes on. @param {any} e
   */
  const pressed = (e) => {
    if (!cur || !e?.target) return;
    if (cur.el.contains(e.target)) return void done(cur.tip);
    if (cur.bubble.contains(e.target) || inHole(e)) return;
    away();
  };
  /** A key that writes in a box outside the bubble — not a shortcut. @param {any} e */
  const typing = (e) => {
    const t = e?.target;
    if (!t || e.ctrlKey || e.metaKey || e.altKey || cur?.bubble.contains(t)) return false;
    const writes = String(e.key || "").length === 1 || ["Enter", "Backspace", "Delete"].includes(e.key);
    return writes && (t.isContentEditable === true || /^(INPUT|TEXTAREA)$/.test(String(t.tagName || "")));
  };
  /**
   * Esc turns from the tip before anything else hears it — the message box counts two in a row as Rewind —, unless a
   * menu, a list or a sheet is open, whose Esc it is (one the page keeps hidden until asked for is none), or the keys
   * compose a word (an input method's Esc). Typing turns from it too, the key going on to its box; with no tip on
   * screen, a key keeps the next from coming up under the typing. @param {any} e
   */
  const keyed = (e) => {
    if (!cur) {
      ready = "";
      return;
    }
    if (e?.key !== "Escape") return void (typing(e) && away());
    if (e.isComposing || shows(HEARS_ESC)) return;
    e.preventDefault?.();
    e.stopImmediatePropagation?.();
    away(true);
  };

  function startLooking() {
    if (timer) return;
    timer = every(look, COACH_POLL_MS);
    doc.addEventListener("pointerdown", pressed, true);
    win.addEventListener?.("keydown", keyed, true);
    win.addEventListener?.("scroll", replace, true);
    win.addEventListener?.("resize", replace);
  }
  function stopLooking() {
    if (!timer) return;
    stopEvery(timer);
    timer = null;
    doc.removeEventListener("pointerdown", pressed, true);
    win.removeEventListener?.("keydown", keyed, true);
    win.removeEventListener?.("scroll", replace, true);
    win.removeEventListener?.("resize", replace);
  }

  /** The file read, and the looking begun or ended by it. → the route's answer, or null where it did not answer. */
  async function load() {
    /** @type {any} */
    let a;
    try {
      a = await o.api("/coach");
    } catch {
      return null;
    }
    tips = Array.isArray(a?.steps) ? a.steps : [];
    on = a?.enabled !== false && !a?.error;
    shade = typeof a?.dim === "number" ? a.dim : SHADE;
    seen.clear();
    for (const id of Array.isArray(a?.seen) ? a.seen : []) seen.add(String(id));
    runs.clear();
    // The rows put aside stay so through a reconnect (the events feed back after sleep); a replay shows them all again.
    if (a?.replayed) resting.clear();
    // The owner's edit gone wrong is said once, where the owner tries it out.
    const words = a?.error || (Array.isArray(a?.problems) ? a.problems.join("; ") : "");
    if (words && words !== told) o.onToast?.(`Tips: ${words}`, a?.error ? "err" : undefined);
    told = words;
    if (cur && !tips.some((t) => t.id === cur?.tip.id && due(t))) hide();
    if (anyLeft()) startLooking();
    else stopLooking();
    return a;
  }

  return {
    start: load,
    reload: load,
    /** @param {string} name @param {() => boolean} fn */
    when: (name, fn) => {
      conds[name] = fn;
    },
    /** Every tip to see again: the data folder forgets them, and the file is read anew. */
    reset: async () => {
      await o.api("/coach/reset", { method: "POST", body: {} });
      hide();
      resting.clear();
      return load();
    },
    look,
    /** The tip on screen, by its id; "" for none. */
    shown: () => cur?.tip.id || "",
    stop: () => {
      hide();
      stopLooking();
    },
  };
}

// @ts-check
// A Design (HarnessV4_Artifacts_Plan E18 step 7, AF-D11, AFC-135..AFC-141): the agent's screens side by side on a
// canvas, each at its size — a phone's, a tablet's, a desktop's — named above with its title and size, the whole fit to
// the view as it opens. The canvas zooms at the pointer (Ctrl or ⌘ with the wheel, a trackpad's pinch, + − 0 1, the
// bar's buttons), from 10% to 400%, and moves by a drag, the wheel or the arrows. A screen clicked fills the view and
// takes clicks and keys, to try as a prototype; Esc, or a click beside it, goes back to the canvas as it was.
// Each screen is its own frame of no origin (`sandbox` without same-origin): its HTML with Filament's look, the shared
// style and the screen's own script (AFC-137), which reach nothing of the canvas, of Filament or of the network. Its
// theme follows the page's; what fails in it is told to the harness, naming the screen (AFC-138).
import { setHtml } from "../lib/dom.js";
import { FILL_MARK, LEAVE_MARK, fullScreen, mark, pageContent, part, still, tell } from "./type-page.js";

/** The sizes a screen is drawn at: its width and its height when it names none (core's SCREEN_SIZES). */
export const SCREEN_SIZES = Object.freeze({ phone: [390, 844], tablet: [820, 1180], desktop: [1440, 900] });
/** The size a screen is when it names none (core's SCREEN_SIZE). */
export const SCREEN_SIZE = "desktop";
/** What a screen's frame may do (AFC-137): run its script, and open a site in a browser tab — no origin of its own. */
export const SCREEN_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox";
/** The least and the most zoom; the room between screens, and round them as they fit. */
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;
const GAP = 80;
const ROOM = 40;
/** The room a screen's name takes above it, on the screen. */
const LABEL = 28;
/** The look's mark a frame's name carries (core's LOOK_MARK). */
const LOOK_NAME = "filament-look";

/** A whole document, as against what goes inside its body. */
const WHOLE_PAGE = /<!doctype\b|<html[\s>]/i;
/** `<`, for the tags screenPage must not spell out. */
const LT = "\x3c";
/** Text as HTML text. @param {string} s */
const htmlText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * @typedef {{ title: string, size: string, height?: number, html: string }} Screen
 * @typedef {{ look: string, script: string }} Kit  Filament's look and the script each screen runs first
 */

/** A screen's width and height, in CSS pixels. @param {Screen} s @returns {[number, number]} */
export function screenBox(s) {
  const [w, h] = SCREEN_SIZES[/** @type {keyof typeof SCREEN_SIZES} */ (s.size)] || SCREEN_SIZES[SCREEN_SIZE];
  return [w, Number.isInteger(s.height) ? /** @type {number} */ (s.height) : h];
}

/** A screen's name and size, as its label says it: "Home · phone, 390 × 844". @param {Screen} s */
export const screenLabel = (s) => `${s.title} · ${s.size}, ${screenBox(s).join(" × ")}`;

/**
 * A screen's page (AFC-137): its HTML whole — what goes inside a body wrapped in a document — with Filament's look, its
 * script and the style the screens share first: after a doctype, ahead of every style of its own, so its own win. A
 * script tag and a comment's start are spelled with LT here: this module is written inside a download's own script
 * (AFC-141), where the HTML around it would read them.
 * @param {Screen} s @param {Kit} kit @param {string} style
 */
export function screenPage(s, kit, style) {
  const first = `<style>${kit.look}</style>${LT}script>${kit.script}${LT}/script>${style ? `<style>${style}</style>` : ""}`;
  if (!WHOLE_PAGE.test(s.html)) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${htmlText(s.title)}</title>${first}</head>`
      + `<body>${s.html}</body></html>`;
  }
  const doctype = /^\s*(?:\x3c!--[\s\S]*?-->\s*)*<!doctype[^>]*>/i.exec(s.html);
  return doctype ? `${doctype[0]}${first}${s.html.slice(doctype[0].length)}` : `${first}${s.html}`;
}

/**
 * The view that fits a box in a space (AFC-135): the zoom, at most 100%, and where the box's corner stands.
 * @param {number} w @param {number} h  the box @param {number} vw @param {number} vh  the space
 * @param {number} [above]  room kept over the box, on the screen
 */
export function fitView(w, h, vw, vh, above = 0) {
  const z = Math.max(ZOOM_MIN, Math.min(1, (vw - 2 * ROOM) / w, (vh - 2 * ROOM - above) / h));
  return { z, x: (vw - w * z) / 2, y: Math.max(ROOM + above, (vh - h * z + above) / 2) };
}

/**
 * A zoom kept to its bounds, at a point that stays where it is.
 * @param {{ x: number, y: number, z: number }} view @param {number} z  the zoom asked for @param {number} px @param {number} py
 */
export function zoomAt(view, z, px, py) {
  const nz = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  return { z: nz, x: px - ((px - view.x) * nz) / view.z, y: py - ((py - view.y) * nz) / view.z };
}

function startDesign() {
  const quiet = still();
  const data = pageContent();
  const content = data.content && typeof data.content === "object" ? data.content : {};
  /** @type {Screen[]} */
  const screens = Array.isArray(content.screens) ? content.screens : [];
  const style = typeof content.style === "string" ? content.style : "";
  /** @type {Kit} */
  const kit = { look: String(data.kit?.look || ""), script: String(data.kit?.script || "") };

  const canvas = part("main", "canvas");
  const world = part("div", "world");
  canvas.append(world);
  document.body.append(canvas);
  if (quiet) document.body.classList.add("is-still");

  /** Each screen's place on the canvas: its figure, its frame, and where it stands. @type {{ s: Screen, fig: HTMLElement, frame: HTMLIFrameElement, x: number, w: number, h: number }[]} */
  const placed = [];
  let x0 = 0;
  const root = document.documentElement;
  const lookName = () => `${LOOK_NAME}:${root.getAttribute("data-theme") === "dark" ? "dark" : "light"}:${quiet ? "off" : root.getAttribute("data-motion") || "full"}${quiet ? ":still" : ""}`;
  for (const s of screens) {
    const [w, h] = screenBox(s);
    const fig = part("figure", "screen");
    fig.style.left = `${x0}px`;
    fig.style.width = `${w}px`;
    fig.style.height = `${h}px`;
    const label = part("figcaption", "screen-label", screenLabel(s));
    label.title = screenLabel(s);
    const frame = /** @type {HTMLIFrameElement} */ (part("iframe", "screen-frame"));
    frame.setAttribute("sandbox", SCREEN_SANDBOX);
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("tabindex", "-1");
    frame.title = `Screen: ${s.title}`;
    // Named before it loads: its script reads the theme from its name as it starts (AF-D33).
    frame.name = lookName();
    frame.srcdoc = screenPage(s, kit, style);
    fig.append(label, frame);
    world.append(fig);
    placed.push({ s, fig, frame, x: x0, w, h });
    x0 += w + GAP;
  }
  if (!screens.length) canvas.append(part("p", "canvas-empty", "This design has no screens."));
  const worldW = Math.max(1, x0 - GAP);
  const worldH = Math.max(1, ...placed.map((p) => p.h));

  let view = { x: 0, y: 0, z: 1 };
  let fitted = true;
  /** The screen that takes clicks and keys, and the view it was opened from. @type {{ at: number, from: { x: number, y: number, z: number } } | null} */
  let on = null;
  const zoomWords = part("span", "design-zoom");
  const set = (/** @type {{ x: number, y: number, z: number }} */ next, keepFit = false) => {
    view = next;
    fitted = keepFit;
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
    world.style.setProperty("--inv", String(1 / view.z));
    zoomWords.textContent = `${Math.round(view.z * 100)}%`;
  };
  const fit = () => {
    const r = canvas.getBoundingClientRect();
    set(fitView(worldW, worldH, r.width, r.height - (quiet ? 0 : barRoom()), LABEL), true);
  };
  /** @param {number} z */
  const zoomTo = (z) => {
    const r = canvas.getBoundingClientRect();
    set(zoomAt(view, z, r.width / 2, (r.height - barRoom()) / 2));
  };
  /** The room the bar takes at the canvas's foot. */
  const barRoom = () => (quiet ? 0 : 64);

  /** A screen fills the view and takes clicks and keys (AFC-137). @param {number} i */
  const open = (i) => {
    const p = placed[i];
    if (!p) return;
    const from = on ? on.from : view;
    close(false);
    on = { at: i, from };
    const r = canvas.getBoundingClientRect();
    const f = fitView(p.w, p.h, r.width, r.height - barRoom(), LABEL);
    set({ z: f.z, x: f.x - p.x * f.z, y: f.y });
    p.fig.classList.add("on");
    p.frame.setAttribute("tabindex", "0");
    p.frame.focus();
    document.body.classList.add("is-trying");
    hint.textContent = "Esc, or a click beside it, goes back";
  };
  /** Back to the canvas as it was (AFC-137). @param {boolean} [back] */
  const close = (back = true) => {
    if (!on) return;
    const p = placed[on.at];
    p.fig.classList.remove("on");
    p.frame.setAttribute("tabindex", "-1");
    if (back) set(on.from);
    on = null;
    document.body.classList.remove("is-trying");
    hint.textContent = HINT;
    canvas.focus();
  };

  /** Every screen in view, an open one closed. */
  const fitAll = () => {
    close(false);
    fit();
  };

  const HINT = "Click a screen to try it";
  const hint = part("span", "design-hint", HINT);
  if (!quiet) {
    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("aria-label", `${data.title}: ${screens.length} screen${screens.length === 1 ? "" : "s"}; + and − zoom, 0 fits, 1 is 100%, the arrows move`);
    /** @param {string} icon @param {string} label @param {() => void} fn @param {string} [text] */
    const button = (icon, label, fn, text) => {
      const b = /** @type {HTMLButtonElement} */ (part("button", text ? "design-btn design-btn-text" : "design-btn"));
      b.type = "button";
      if (text) b.textContent = text;
      else setHtml(b, icon);
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", fn);
      return b;
    };
    const fill = button(FILL_MARK, "Full screen (F)", () => screen.set(!screen.on()));
    const screen = fullScreen((full) => {
      setHtml(fill, full ? LEAVE_MARK : FILL_MARK);
      fill.title = `${full ? "Leave full screen" : "Full screen"} (F)`;
      fill.setAttribute("aria-label", fill.title);
      if (fitted) requestAnimationFrame(fit);
    });
    const bar = part("div", "design-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Canvas");
    bar.append(
      hint,
      button(mark('<path d="M5 12h14"/>'), "Zoom out (−)", () => zoomTo(view.z / 1.25)),
      zoomWords,
      button(mark('<path d="M12 5v14M5 12h14"/>'), "Zoom in (+)", () => zoomTo(view.z * 1.25)),
      button("", "Fit every screen (0)", () => fitAll(), "Fit"),
      button("", "Actual size (1)", () => zoomTo(1), "100%"),
      fill,
    );
    document.body.append(bar);

    // The wheel moves the canvas; with Ctrl or ⌘ — and a trackpad's pinch, which comes as one — it zooms at the
    // pointer.
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        if (e.ctrlKey || e.metaKey) {
          const step = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY));
          set(zoomAt(view, view.z * Math.exp(-step * 0.01), e.clientX - r.left, e.clientY - r.top));
        } else set({ ...view, x: view.x - e.deltaX, y: view.y - e.deltaY });
      },
      { passive: false },
    );
    // A drag moves the canvas; a click on a screen opens it, and one beside an open screen goes back.
    /** @type {{ id: number, x: number, y: number, from: { x: number, y: number, z: number }, moved: boolean, pressed: Element | null } | null} */
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      // The screen it began on: once the canvas holds the pointer, every event after names the canvas.
      const pressed = e.target instanceof Element ? e.target.closest(".screen") : null;
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, from: view, moved: false, pressed };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      document.body.classList.add("is-dragging");
      set({ ...drag.from, x: drag.from.x + dx, y: drag.from.y + dy });
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const { moved, pressed } = drag;
      drag = null;
      document.body.classList.remove("is-dragging");
      if (moved) return;
      const i = placed.findIndex((p) => p.fig === pressed);
      if (i >= 0 && i !== on?.at) open(i);
      else if (i < 0) close();
    });
    canvas.addEventListener("pointercancel", () => {
      drag = null;
      document.body.classList.remove("is-dragging");
    });
    addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      if (k === "Escape" && on) close();
      else if (k === "+" || k === "=") zoomTo(view.z * 1.25);
      else if (k === "-" || k === "_") zoomTo(view.z / 1.25);
      else if (k === "0") fitAll();
      else if (k === "1") zoomTo(1);
      else if (k === "f" || k === "F") screen.set(!screen.on());
      else if (k === "ArrowLeft") set({ ...view, x: view.x + 60 });
      else if (k === "ArrowRight") set({ ...view, x: view.x - 60 });
      else if (k === "ArrowUp") set({ ...view, y: view.y + 60 });
      else if (k === "ArrowDown") set({ ...view, y: view.y - 60 });
      else return;
      e.preventDefault();
    });
    // A screen says what failed in it, and its Esc; the harness hears what failed, naming the screen (AFC-138).
    addEventListener("message", (e) => {
      const m = e.data;
      const p = placed.find((x) => x.frame.contentWindow === e.source);
      if (!p || !m || m.filament !== "artifact") return;
      if (m.kind === "escape") close();
      else if (m.kind === "fail") tell(m.what === "error" ? { ...m, message: `In the screen “${p.s.title}”: ${String(m.message ?? "")}` } : m);
    });
  }

  // The theme and the Motion each screen follows (AFC-140): by its name as it loads, and a word to it after.
  new MutationObserver(() => {
    const name = lookName();
    const [, theme, motion] = name.split(":");
    for (const p of placed) {
      p.frame.name = name;
      p.frame.contentWindow?.postMessage({ filament: "look", theme, motion }, "*");
    }
  }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-motion"] });

  new ResizeObserver(() => {
    if (on) open(on.at);
    else if (fitted) fit();
  }).observe(canvas);
  fit();
}

startDesign();

// @ts-check
// A deck (HarnessV4_Artifacts_Plan E18 step 6, AF-D11, AFC-111..AFC-113): the agent's Markdown as slides, 16:9, each
// drawn at one size and scaled to the page — the side pane's, the full view's, a browser's or the whole screen — and a
// slide whose type does not fit made smaller until it does, never cut. The arrow keys, Space, PageUp, PageDown, Home
// and End move; O shows every slide, where a click goes to one; F fills the screen — inside the harness by asking it,
// as only Filament's own pages may (AFC-114); P prints, a slide a page, as seen. The slide shown is kept in the
// address (`#3`) and in this tab, so a new version opens where you were. A card's still preview shows the first slide
// alone. Inside the harness the deck follows the text being edited beside it, at the slide the caret is in (AFC-115).
import { setHtml } from "../lib/dom.js";
import { FILL_MARK, LEAVE_MARK, fullScreen, hear, mark, onTheme, part, still } from "./type-page.js";
import { copyButtons, drawDiagrams, headingLinks, markdownHtml, markdownOf } from "./markdown-page.js";
import { slideAt, splitSlides } from "./deck.js";

/** A slide's size as it is drawn, before it is scaled to the page. */
const SLIDE_W = 1280;
const SLIDE_H = 720;
/** The smallest a slide's type is made to fit it (AFC-111), and each step down. */
const FIT_MIN = 0.5;
const FIT_STEP = 0.05;
/** The most room left round a slide, outside a full screen. */
const GAP_MAX = 24;
/** How long the bar stays after the pointer last moved, on a full screen. */
const IDLE_MS = 2000;
/** Where this tab keeps the slide shown, for a new version that opens the deck again. */
const KEPT = "filament-slide";

const ICONS = {
  prev: mark('<path d="m15 18-6-6 6-6"/>'),
  next: mark('<path d="m9 18 6-6-6-6"/>'),
  all: mark('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  print: mark('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
};

/** The slide this tab showed last, or its address names; 0 where none. */
function slideKept() {
  const named = Number(/^#(\d+)$/.exec(location.hash)?.[1]);
  if (named > 0) return named - 1;
  try {
    return Math.max(0, Number(sessionStorage.getItem(KEPT)) || 0);
  } catch {
    return 0;
  }
}

/** Make a slide's type smaller until all of it fits (AFC-111). @param {HTMLElement} slide */
function fit(slide) {
  const body = /** @type {HTMLElement} */ (slide.querySelector(".slide-body"));
  let f = 1;
  body.style.setProperty("--fit", "1");
  while (f > FIT_MIN && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) {
    f = Math.round((f - FIT_STEP) * 100) / 100;
    body.style.setProperty("--fit", String(f));
  }
}

function startDeck() {
  const quiet = still();
  const deck = part("main", "deck");
  const stage = part("div", "stage");
  deck.append(stage);
  const count = part("span", "deck-count");
  /** @param {string} icon @param {string} label @param {string} key @param {() => void} fn */
  const button = (icon, label, key, fn) => {
    const b = /** @type {HTMLButtonElement} */ (part("button", "deck-btn"));
    b.type = "button";
    setHtml(b, icon);
    b.title = `${label} (${key})`;
    b.setAttribute("aria-label", label);
    b.addEventListener("click", fn);
    return b;
  };
  const prevBtn = button(ICONS.prev, "Previous slide", "←", () => go(at - 1));
  const nextBtn = button(ICONS.next, "Next slide", "→", () => go(at + 1));
  const allBtn = button(ICONS.all, "Every slide", "O", () => overview(!showingAll));
  const fillBtn = button(FILL_MARK, "Full screen", "F", () => screen.set(!full));
  const printBtn = button(ICONS.print, "Print, or save as PDF", "P", () => print());
  const bar = part("div", "deck-bar");
  bar.setAttribute("role", "toolbar");
  bar.setAttribute("aria-label", "Slides");
  bar.append(prevBtn, count, nextBtn, part("span", "grow"), allBtn, fillBtn, printBtn);
  const all = part("div", "deck-all");
  all.hidden = true;
  all.setAttribute("role", "dialog");
  all.setAttribute("aria-label", "Every slide");
  document.body.append(deck, bar, all);
  if (quiet) document.body.classList.add("is-still");

  /** @type {ReturnType<typeof splitSlides>} */
  let slides = [];
  /** @type {HTMLElement[]} */
  let shown = [];
  let at = quiet ? 0 : slideKept();
  let showingAll = false;
  let full = false;

  /** Scale the stage to the deck, centered: a little room round it, but on a full screen and in a still preview. */
  const place = () => {
    const r = deck.getBoundingClientRect();
    const gap = full || quiet ? 0 : Math.min(GAP_MAX, r.width * 0.03);
    const s = Math.min((r.width - 2 * gap) / SLIDE_W, (r.height - 2 * gap) / SLIDE_H) || 0;
    stage.style.transform = `translate(${(r.width - SLIDE_W * s) / 2}px, ${(r.height - SLIDE_H * s) / 2}px) scale(${s})`;
  };
  new ResizeObserver(place).observe(deck);

  /** Each slide's thumbnail in the overview, scaled to its width. */
  const placeAll = () => {
    const first = /** @type {HTMLElement | null} */ (all.querySelector(".thumb-slide"));
    if (first) all.style.setProperty("--thumb", String(first.clientWidth / SLIDE_W));
  };
  new ResizeObserver(placeAll).observe(all);

  const show = () => {
    shown.forEach((s, i) => {
      const on = i === at;
      s.classList.toggle("on", on);
      s.setAttribute("aria-hidden", String(!on));
      s.inert = !on;
    });
    count.textContent = shown.length ? `${at + 1} / ${shown.length}` : "";
    prevBtn.disabled = at <= 0;
    nextBtn.disabled = at >= shown.length - 1;
    for (const t of Array.from(all.querySelectorAll(".thumb"))) t.classList.toggle("on", t.getAttribute("data-n") === String(at));
    if (quiet) return;
    history.replaceState(null, "", `#${at + 1}`);
    try {
      sessionStorage.setItem(KEPT, String(at));
    } catch {
      // A tab that keeps nothing opens a new version at the first slide.
    }
  };
  /** @param {number} i */
  const go = (i) => {
    if (!shown.length) return;
    at = Math.max(0, Math.min(shown.length - 1, i));
    show();
  };

  /** Every slide at once (AFC-112): a click on one goes there. @param {boolean} open */
  const overview = (open) => {
    showingAll = open && !quiet;
    all.hidden = !showingAll;
    document.body.classList.toggle("is-all", showingAll);
    if (!showingAll) return;
    all.replaceChildren(...shown.map((s, i) => {
      const t = /** @type {HTMLButtonElement} */ (part("button", "thumb"));
      t.type = "button";
      t.setAttribute("data-n", String(i));
      t.setAttribute("aria-label", `Slide ${i + 1}`);
      const box = part("div", "thumb-slide");
      const copy = /** @type {HTMLElement} */ (s.cloneNode(true));
      copy.classList.add("on");
      copy.removeAttribute("aria-hidden");
      copy.inert = true;
      box.append(copy);
      t.append(box, part("span", "thumb-n", String(i + 1)));
      t.addEventListener("click", () => {
        go(i);
        overview(false);
      });
      return t;
    }));
    placeAll();
    show();
    /** @type {HTMLElement | null} */ (all.querySelector(".thumb.on"))?.focus();
  };

  let idle = 0;
  const awake = () => {
    document.body.classList.remove("is-idle");
    clearTimeout(idle);
    if (full) idle = window.setTimeout(() => document.body.classList.add("is-idle"), IDLE_MS);
  };
  // The page fills the screen, or leaves it: inside the harness by asking it (AFC-112, AFC-114).
  const screen = fullScreen((on) => {
    full = on;
    document.body.classList.toggle("is-full", on);
    setHtml(fillBtn, on ? LEAVE_MARK : FILL_MARK);
    fillBtn.setAttribute("aria-label", on ? "Leave full screen" : "Full screen");
    fillBtn.title = `${on ? "Leave full screen" : "Full screen"} (F)`;
    place();
    awake();
  });
  addEventListener("pointermove", awake);
  deck.addEventListener("click", (e) => {
    // On a full screen a click moves on, as a presenter's does; a link or a button keeps its own.
    if (full && !(e.target instanceof Element && e.target.closest("a, button"))) go(at + 1);
  });
  headingLinks(stage, (id) => {
    const i = shown.findIndex((s) => s.querySelector(`[id="${CSS.escape(id)}"]`));
    if (i >= 0) go(i);
  });

  addEventListener("keydown", (e) => {
    if (quiet || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    // A button keeps its own Enter and Space.
    if ((k === "Enter" || k === " ") && e.target instanceof HTMLButtonElement) return;
    if (k === "Escape" && showingAll) overview(false);
    else if (k === "Enter" && showingAll) overview(false);
    else if (["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"].includes(k)) go(at + 1);
    else if (["ArrowLeft", "ArrowUp", "PageUp", "Backspace"].includes(k)) go(at - 1);
    else if (k === "Home") go(0);
    else if (k === "End") go(shown.length - 1);
    else if (k === "o" || k === "O") overview(!showingAll);
    else if (k === "f" || k === "F") screen.set(!full);
    else if (k === "p" || k === "P") print();
    else return;
    e.preventDefault();
  });

  /** Draw the deck from its Markdown, at the slide shown. @param {string} markdown */
  const draw = (markdown) => {
    slides = splitSlides(markdown);
    shown = slides.map((s, i) => {
      const slide = part("section", s.title ? "slide title" : "slide");
      slide.setAttribute("role", "group");
      slide.setAttribute("aria-roledescription", "slide");
      slide.setAttribute("aria-label", `${i + 1} of ${slides.length}`);
      slide.dataset.n = String(i + 1);
      const body = part("div", "slide-body");
      setHtml(body, markdownHtml(s.text));
      copyButtons(body);
      slide.append(body);
      return slide;
    });
    if (!shown.length) {
      const empty = part("section", "slide title on");
      empty.append(part("div", "slide-body slide-empty", "This deck is empty."));
      stage.replaceChildren(empty);
    } else stage.replaceChildren(...shown);
    at = Math.max(0, Math.min(Math.max(0, shown.length - 1), at));
    shown.forEach(fit);
    show();
    if (showingAll) overview(true);
    void drawDiagrams(stage).then(() => {
      shown.forEach(fit);
      if (showingAll) overview(true);
    });
  };

  let markdown = markdownOf();
  draw(markdown);
  place();
  onTheme(() => draw(markdown));
  hear("draft", (m) => {
    if (typeof m.markdown !== "string") return;
    markdown = m.markdown;
    draw(markdown);
    if (Number.isInteger(m.at)) go(slideAt(slides, m.at));
  });
}

startDeck();

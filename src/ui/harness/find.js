// @ts-check
// Find in task (AgentPlanUX §5.11; Ctrl+F). A small bar under the header's right end — never over the header's own
// buttons, and the status capsule steps down while it is open; matches are marked, Previous and Next move between
// them, Esc closes and clears. The scope toggle searches the messages or the file changes (the Edit/Write cards and
// the Changes group) — the same DOM, a narrower root.
import { h } from "../lib/dom.js";
import { ICONS } from "./lib/icons.js";
import { pills } from "./lib/ui.js";

const MAX_MARKS = 200;

/**
 * @param {HTMLElement} frame
 * @param {{ root: () => HTMLElement | null, prepare?: () => Promise<number>, reveal?: (needle: string) => void, letGo?: () => void }} cb
 *   `prepare` brings onto the page what it had not drawn of the transcript (the work of turns far from the screen) and
 *   says how much it brought; `reveal` draws, before each search, what is drawn only as it opens and holds the words
 *   (lower case) — a closed sub-agent card's calls —, and `letGo` lets that go again as the bar closes
 * @returns {{ open: () => void, close: () => void }}
 */
export function createFind(frame, cb) {
  const input = h("input", { class: "find-input", type: "text", placeholder: "Find in messages", "aria-label": "Find in messages" });
  const count = h("span", { class: "find-count", "aria-live": "polite" }, "");
  let marks = /** @type {HTMLElement[]} */ ([]);
  let at = 0;
  /** Whether the search stopped at MAX_MARKS with more matches still in the transcript. */
  let capped = false;
  let scope = "messages";
  const scopePills = pills([
    { id: "messages", label: "Messages" },
    { id: "changes", label: "File changes" },
  ], { active: scope, onChange: (id) => { scope = id; const words = id === "changes" ? "Find in file changes" : "Find in messages"; input.placeholder = words; input.setAttribute("aria-label", words); search(); } });

  const bar = h("div", { class: "find-bar hidden", role: "search" },
    h("div", { class: "find-row" },
      h("label", { class: "find-field" },
        h("span", { class: "find-ic", "aria-hidden": "true", html: ICONS.search }),
        input,
        count),
      h("span", { class: "find-steps" },
        h("button", { class: "ghost icon", type: "button", title: "Previous (Shift+Enter)", "aria-label": "Previous match", html: ICONS.chevronUp, onclick: () => step(-1) }),
        h("button", { class: "ghost icon", type: "button", title: "Next (Enter)", "aria-label": "Next match", html: ICONS.chevronDown, onclick: () => step(1) })),
      h("button", { class: "ghost icon find-x", type: "button", title: "Close (Esc)", "aria-label": "Close", html: ICONS.x, onclick: () => close() })),
    scopePills.el);
  frame.append(bar);

  // Unmarking leaves the text in pieces; the parent is re-joined, or the next search could not match across the seam
  // ("pars" found, then "parser" missing where the first search had cut it).
  const clear = () => {
    const parents = new Set();
    for (const m of marks) { if (m.parentNode) parents.add(m.parentNode); m.replaceWith(document.createTextNode(m.textContent || "")); }
    for (const p of parents) p.normalize();
    marks = [];
    count.textContent = "";
  };

  /** The nodes the scope covers: every text node of the transcript, or only those inside the change cards. */
  const roots = () => {
    const root = cb.root();
    if (!root) return [];
    if (scope === "messages") return [root];
    // Edit/Write stubs and the Changes group (their kind word), plus the round's file-change card — the card the
    // timeline renders is `.file-card` (its rows `.file-row`), not the older names this once matched.
    const rows = Array.from(root.querySelectorAll(".tool-row")).filter((r) => /^(Edited|Wrote|Editing|Writing|Changes|Vetoed|Declined)$/.test(r.querySelector(":scope > summary .tool-kind")?.textContent?.trim() || ""));
    return [...rows, ...Array.from(root.querySelectorAll(".file-card"))];
  };

  const search = () => {
    clear();
    const q = input.value.trim();
    if (!q || q.length < 2) return;
    const needle = q.toLowerCase();
    cb.reveal?.(needle);
    const hits = [];
    capped = false;
    // The text nodes are listed before any is marked: a mark splits its node and puts the match in a node of its own,
    // which a walker still running would reach next and mark again, inside the first — every search stacked 200
    // marks on its first match. A set, because the changes scope's roots can nest.
    /** @type {Set<Text>} */
    const nodes = new Set();
    for (const root of roots()) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.add(/** @type {Text} */ (n));
    }
    for (const node of nodes) {
      if (capped) break;
      const hay = (node.textContent || "").toLowerCase();
      const positions = [];
      let i = hay.indexOf(needle);
      while (i >= 0) { positions.push(i); i = hay.indexOf(needle, i + needle.length); }
      // Past the cap the count says so ("200+") rather than passing the cap off as the total; the hits kept are the
      // first ones in document order, so a node cut by the cap keeps its leading hits.
      const room = MAX_MARKS - hits.length;
      if (positions.length > room) { capped = true; positions.length = room; }
      // Marks are made back-to-front (a mark splits the node, so earlier offsets must not move) but collected
      // separately, so `hits` stays in document order within the node — Next walks forward through a paragraph.
      const nodeMarks = [];
      for (let k = positions.length - 1; k >= 0; k--) {
        if (!node.parentElement) break;
        const mark = document.createElement("mark");
        mark.className = "find-hit";
        const range = document.createRange();
        range.setStart(node, positions[k]);
        range.setEnd(node, positions[k] + q.length);
        try { range.surroundContents(mark); nodeMarks.push(mark); } catch { /* a range the DOM refuses to wrap */ }
      }
      hits.push(...nodeMarks.reverse());
    }
    marks = hits;
    at = 0;
    show();
  };

  const show = () => {
    marks.forEach((m, i) => m.classList.toggle("active", i === at));
    count.textContent = marks.length ? `${at + 1} of ${marks.length}${capped ? "+" : ""}` : "No matches";
    // A match inside a closed fold opens it, as the browser's own find does: scrolling to a hidden mark shows nothing.
    // A fold just opened has no box yet and then animates open (300ms), so the scroll is taken again on the next
    // frame and once it has grown; until one lands, the transcript's follow-the-tail keeps it at the bottom.
    const fold = (/** @type {Element | undefined} */ el) => /** @type {HTMLDetailsElement | null} */ (el?.closest("details:not([open])") || null);
    let opened = false;
    for (let d = fold(marks[at]); d; d = fold(d)) { d.open = true; opened = true; }
    const target = marks[at];
    const go = () => { if (target?.isConnected && target === marks[at]) target.scrollIntoView({ block: "center" }); };
    go();
    if (opened) { requestAnimationFrame(go); setTimeout(go, 360); }
  };

  /** @param {number} dir */
  const step = (dir) => { if (!marks.length) return; at = (at + dir + marks.length) % marks.length; show(); };

  input.addEventListener("input", search);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });

  const close = () => { clear(); cb.letGo?.(); bar.classList.add("hidden"); };

  return {
    // The segmented control measured nothing while the bar was hidden: its indicator is placed once it shows.
    open() {
      bar.classList.remove("hidden");
      scopePills.repaint();
      input.focus();
      input.select();
      // The search covers what is drawn: what the page had not read of the drawn turns is read now, and a search
      // typed meanwhile runs again over it.
      cb.prepare?.().then((brought) => { if (brought && !bar.classList.contains("hidden")) search(); }, () => {});
    },
    close,
  };
}

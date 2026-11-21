// @ts-check
// A deck's slides from its Markdown (HarnessV4_Artifacts_Plan E18 step 6, AFC-111): pure, so the page, a test and the
// edit beside the page (the slide the caret is in, AFC-115) read them alike.

/**
 * @typedef {{ text: string, start: number, title: boolean }} Slide  a slide's Markdown; where it starts in the deck's
 *   (a caret's offset finds it by); whether it is a title slide — it starts with a `#` heading, and stands centered
 */

/** A fence's opening or closing line. */
const FENCE = /^\s*(```|~~~)/;
/** The line between two slides: `---` alone. */
const BETWEEN = /^\s*---+\s*$/;
/** A heading that starts a slide in a deck written without `---`. */
const STARTS = /^#{1,2}\s/;
/** A line of the settings some decks open with (`marp: true`), which draw nothing. */
const SETTING = /^\s*[\w-]+\s*:/;

/**
 * The deck's lines, each with where it starts and whether it lies inside a fence — no fence's line splits a slide.
 * @param {string} markdown @returns {{ line: string, at: number, fenced: boolean }[]}
 */
function linesOf(markdown) {
  /** @type {{ line: string, at: number, fenced: boolean }[]} */
  const out = [];
  let at = 0;
  let fence = "";
  for (const line of markdown.split("\n")) {
    const f = FENCE.exec(line)?.[1] || "";
    const fenced = !!fence || !!f;
    if (f && !fence) fence = f;
    else if (f && f === fence) fence = "";
    out.push({ line, at, fenced });
    at += line.length + 1;
  }
  return out;
}

/**
 * A deck's slides (AFC-111): the parts between lines of `---` alone; in a deck with none, each `#` or `##` heading
 * starts one. Settings at the top between two `---` lines (`marp: true`) are no slide; an empty part is none.
 * @param {string} markdown @returns {Slide[]}
 */
export function splitSlides(markdown) {
  const lines = linesOf(String(markdown ?? "").replace(/\r\n?/g, "\n"));
  let from = 0;
  const first = lines.findIndex((l) => l.line.trim());
  if (first >= 0 && BETWEEN.test(lines[first].line)) {
    const close = lines.findIndex((l, i) => i > first && BETWEEN.test(l.line));
    if (close > first + 1 && lines.slice(first + 1, close).every((l) => !l.line.trim() || SETTING.test(l.line))) from = close + 1;
  }
  const rest = lines.slice(from);
  const between = rest.some((l) => !l.fenced && BETWEEN.test(l.line));
  /** @type {{ line: string, at: number }[][]} */
  const parts = [[]];
  for (const l of rest) {
    if (between && !l.fenced && BETWEEN.test(l.line)) {
      parts.push([]);
      continue;
    }
    if (!between && !l.fenced && STARTS.test(l.line) && parts[parts.length - 1].some((x) => x.line.trim())) parts.push([]);
    parts[parts.length - 1].push(l);
  }
  return parts
    .filter((p) => p.some((l) => l.line.trim()))
    .map((p) => {
      const text = p.map((l) => l.line).join("\n").trim();
      const lead = p.find((l) => l.line.trim());
      return { text, start: /** @type {{ at: number }} */ (lead).at, title: /^#\s/.test(text) };
    });
}

/**
 * The slide a caret is in (AFC-115): the last that starts at or before it; the first where none does.
 * @param {Slide[]} slides @param {number} at  the caret's offset in the deck's Markdown
 */
export function slideAt(slides, at) {
  let n = 0;
  slides.forEach((s, i) => {
    if (s.start <= at) n = i;
  });
  return n;
}

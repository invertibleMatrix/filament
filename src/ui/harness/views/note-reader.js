// @ts-check
// A note's reader (the owner's plan mode of 11-06): what the task graph keeps behind a task or behind the graph — a
// plan of hundreds of lines, a review, a text file — read whole in a wide sheet over the page, outside the Plan view's
// redrawn tree, so the view's every draw (a worker's progress, a graph's new rev) neither closes it nor moves its
// scroll. A note or a Markdown file is drawn as a document, its headings an outline down its side that scrolls to
// each; any other text stands as it is.
import { h } from "../../lib/dom.js";
import { mdDoc } from "../../lib/md.js";
import { sheet as openSheet } from "../lib/ui.js";

/** @typedef {(tag: string, attrs?: Record<string, any>, ...kids: any[]) => any} Mk */

/** The outline's most entries: a plan's sections, not every heading of a long document. */
export const OUTLINE_MOST = 60;

/** A heading's id as mdDoc gives it, from its words. @param {string} t */
const slug = (t) =>
  t
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "section";

/**
 * A document's outline: its headings of the first three levels, outside fenced code, each with the id mdDoc gives it
 * under `prefix` — counted over every level, as mdDoc counts them, so a heading's id is the one drawn. Their words
 * plain: no code marks, no stars.
 * @param {string} text @param {string} prefix @returns {{ level: number, text: string, id: string }[]}
 */
export function outlineOf(text, prefix) {
  /** @type {Map<string, number>} */
  const used = new Map();
  /** @type {{ level: number, text: string, id: string }[]} */
  const out = [];
  let fenced = false;
  for (const line of String(text || "").replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!m) continue;
    const words = m[2].trim();
    const base = `${prefix}-${slug(words.replace(/^\d+(\.\d+)*\.?\s+/, ""))}`;
    const n = used.get(base) || 0;
    used.set(base, n + 1);
    if (m[1].length <= 3) out.push({ level: m[1].length, text: words.replace(/[`*_~]/g, ""), id: n ? `${base}-${n + 1}` : base });
  }
  return out;
}

/** Whether a kept thing reads as a document: a note, or a Markdown file. @param {"note" | "file"} kind @param {string} name */
export const isDoc = (kind, name) => kind === "note" || /\.(md|markdown)$/i.test(name);

let readers = 0;

/**
 * The reader's insides, drawn for its words: the outline beside the document where it has two headings or more, the
 * document alone else — or the text as it stands, where it is no document. `go` scrolls to a heading by its id.
 * @param {Mk} mk @param {string} text @param {boolean} doc @param {string} prefix @param {(id: string) => void} go
 */
export function readerBody(mk, text, doc, prefix, go) {
  if (!doc) return mk("pre", { class: "tg-rd-pre" }, text);
  const all = outlineOf(text, prefix);
  const heads = all.slice(0, OUTLINE_MOST);
  const page = mk("div", { class: "tg-rd-doc skl-md", html: mdDoc(text, prefix) });
  if (heads.length < 2) return mk("div", { class: "tg-rd" }, page);
  return mk("div", { class: "tg-rd has-outline" },
    mk("nav", { class: "tg-rd-outline", "aria-label": "Outline" },
      ...heads.map((x) => mk("button", { class: `tg-rd-go is-h${x.level}`, type: "button", title: x.text, onclick: () => go(x.id) }, x.text)),
      all.length > heads.length ? mk("p", { class: "tg-rd-more" }, `and ${all.length - heads.length} more headings`) : null),
    page);
}

/**
 * A kept note or text file read whole in the reader: its name, what it is and whose, then its words once they land.
 * Esc, the close button and a click beside it close it.
 * @param {{ name: string, kind: "note" | "file", sub: string, load: () => Promise<string>, mk?: Mk,
 *   sheet?: (o: any) => { el: any, scroller: any, close: () => void } }} o
 * @returns {{ close: () => void, landed: Promise<void> }}
 */
export function openReader(o) {
  const mk = o.mk || /** @type {Mk} */ (h);
  const prefix = `note${++readers}`;
  const body = mk("div", { class: "tg-rd-body" }, mk("p", { class: "tg-kept-wait" }, "Reading…"));
  const head = mk("div", { class: "tg-rd-head" },
    mk("span", { class: "tg-rd-title" }, o.name),
    mk("span", { class: "tg-rd-sub" }, o.sub));
  const s = (o.sheet || openSheet)({ label: o.name, head, body, class: "tg-reader" });
  /** @param {string} id */
  const go = (id) => s.scroller?.querySelector?.(`#${id}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  const landed = o.load().then(
    (text) => { body.replaceChildren(readerBody(mk, text, isDoc(o.kind, o.name), prefix, go)); },
    (/** @type {any} */ e) => { body.replaceChildren(mk("p", { class: "tg-card-text" }, `Not read: ${String(e?.message || e)}`)); },
  );
  return { close: s.close, landed };
}

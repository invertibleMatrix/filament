// @ts-check
// A skill's library (HarnessV4_Skills_Plan step 2): the books a skill made in Filament carries — a PDF, a Markdown or
// text file, or a folder (its PDFs each a book, its Markdown and text files together one) — each split by chapter or
// heading into `references/<book>/<nn>-<title>.md`, a page line before each PDF page's text, the original kept in
// `sources/`; `references/INDEX.md` a line per part, its first words for a summary (no model reads anything here); and
// a full-text index of the parts (SQLite FTS5, `.library/index.sqlite` in the skill's own folder, rebuilt from the
// parts where it is missing) that the skill tool's `find` ranks by the words asked. What it cannot do, it says: a
// scanned PDF has no text (no OCR), and a PDF without chapter headings is split every PAGES_PER_PART pages.
// A skill's folder comes from anywhere — a plugin, a repository, a folder a person copied in —, and its manifest with
// it: a book is listed only where its names are those the library makes (`notAsMade`, at the read), and a delete, a
// write or a part's read lands in the skill's own `references` or `sources`, links followed (`under`), or is not done.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PDFTOTEXT, pdfPages } from "../adapters/tools/pdf.js";
import { resolveInside } from "../adapters/tools/fs-fence.js";
import { ftsExpression } from "../services/memory/archive.js";
import { cut } from "../core/text.js";

/** The kinds of file a book is. */
const BOOK_EXT = Object.freeze({ ".pdf": "pdf", ".md": "md", ".markdown": "md", ".txt": "txt" });
/** A PDF with no chapter headings is split this many pages a part. */
export const PAGES_PER_PART = 20;
/** A part past this many characters is split again at a paragraph. */
const PART_CHARS = 60_000;
/** The most books a skill carries; the most PDFs and text files a folder gives, and how deep it is looked through. */
const BOOKS_MAX = 200;
const FOLDER_PDFS_MAX = 50;
const FOLDER_TEXTS_MAX = 2_000;
const FOLDER_DEPTH = 4;
/** The most a file sent from the page holds (base64 in a 64 MB body). */
export const UPLOAD_BYTES_MAX = 45 * 1024 * 1024;
/** A page with fewer characters than this has no text: blank, or a scan. */
const PAGE_TEXT_MIN = 3;
/** The most hits a find gives, and the most characters a passage holds. */
export const FIND_PARTS = 8;
const PASSAGE_CHARS = 700;
/** The words of a part INDEX.md quotes. */
const SUMMARY_WORDS = 24;

/**
 * One part of a book: its file (relative to the skill's folder), its chapter's title, the pages it holds (a PDF's),
 * its size.
 * @typedef {{ file: string, title: string, pages: [number, number] | null, chars: number }} BookPart
 */
/**
 * A book of a skill's library: its id (its folder under `references/`), its title, the name it came by (a file's, or a
 * folder's whose Markdown and text files are its chapters), its original under `sources/`, what kind it is, its pages
 * and its files, how it was split, its parts, and its pages with no text (a scan's, a figure's).
 * @typedef {{ id: string, title: string, name: string, source: string, kind: "pdf" | "md" | "txt" | "folder",
 *   pages: number | null, files: number, split: "chapters" | "headings" | "pages" | "whole" | "files", parts: BookPart[],
 *   noText: number[], at: number }} Book
 */

/** A file or a folder of the library's taken away; one a program holds stays (the next change tries again). @param {string} path */
const removeTree = (path) => {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {}
};
/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });
/** A file name made safe: lower case, a dash for the rest. @param {string} raw @param {number} max */
const slugOf = (raw, max) =>
  String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/, "") || "part";
/** A path as the skill's folder names it, with forward slashes. @param {string} dir @param {string} abs */
const relOf = (dir, abs) => relative(dir, abs).split(sep).join("/");
/** Lines as stored: no trailing spaces, at most one blank line in a row. @param {string} text */
const tidy = (text) =>
  String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
/** "pages 41–58", or "page 7". @param {[number, number] | null} p */
export const pagesWords = (p) => (!p ? "" : p[0] === p[1] ? `page ${p[0]}` : `pages ${p[0]}–${p[1]}`);

/** The library's own folder in a skill's, its manifest and its index. @param {string} dir */
const libDir = (dir) => join(dir, ".library");
const manifestOf = (/** @type {string} */ dir) => join(libDir(dir), "books.json");
const indexOf = (/** @type {string} */ dir) => join(libDir(dir), "index.sqlite");

/** A name as the library makes one (`slugOf`): lower-case letters and digits, one dash between runs of them. */
const PLAIN = "[a-z0-9]+(?:-[a-z0-9]+)*";
/** The most characters of a book's id: `add` makes one of 40 at most. */
const BOOK_ID_MAX = 64;
const BOOK_ID = new RegExp(`^${PLAIN}$`);
/** A book's original under `sources/`: a plain name, with its kind's ending where it is a file. */
const SOURCE = new RegExp(`^sources/${PLAIN}(?:\\.(?:${Object.keys(BOOK_EXT).map((e) => e.slice(1)).join("|")}))?$`);
/** A part's file in its book's folder: its number and its title, a plain name. */
const PART_NAME = new RegExp(`^${PLAIN}\\.md$`);

/**
 * Whether a string is a book's id: the one rule for it. An id is the name of the book's folder under `references/`, as
 * `add` makes it — one plain name, never a path: no separator, no dot, no drive, and nothing Windows opens under
 * another name (a capital, a trailing dot or space, a stream, a short name).
 * @param {unknown} id @returns {id is string}
 */
const isBookId = (id) => typeof id === "string" && id.length <= BOOK_ID_MAX && BOOK_ID.test(id);

/**
 * What of a manifest's book is not as `add` writes it, among its names that become a path — its id
 * (`references/<id>`), its original (`sources/<name>`), each part's file (`references/<its id>/<name>.md`) —, or ""
 * where all of them are.
 * @param {any} b @returns {"" | "id" | "original" | "part's file"}
 */
function notAsMade(b) {
  if (!isBookId(b.id)) return "id";
  if (typeof b.source !== "string" || !SOURCE.test(b.source)) return "original";
  const folder = `references/${b.id}/`;
  const made = (/** @type {any} */ p) => typeof p?.file === "string" && p.file.startsWith(folder) && PART_NAME.test(p.file.slice(folder.length));
  return b.parts.every(made) ? "" : "part's file";
}

/** The books a read left out, by folder and id: a manifest is read at every look, and each is said once. @type {Set<string>} */
const leftOut = new Set();
const LEFT_OUT_MAX = 1000;
/** Where a read says what it left out: the log of the library this Filament made (`createSkillLibrary`). @type {(level: string, msg: string) => void} */
let leftOutLog = () => {};

/**
 * The books a skill's folder carries, as its manifest lists them: those whose names are the library's own
 * (`notAsMade`), so no code past this read holds a book whose id, original or part is a path. One left out is said
 * once in the log, with its skill and its id's first 64 characters.
 * @param {string} dir @param {string} [name]  the skill's where the caller has it, else its folder's
 * @returns {Book[]}
 */
export function booksIn(dir, name = basename(dir)) {
  /** @type {any[]} */
  let listed;
  try {
    const doc = JSON.parse(readFileSync(manifestOf(dir), "utf8"));
    listed = Array.isArray(doc?.books) ? doc.books.filter((/** @type {any} */ b) => b && typeof b.id === "string" && Array.isArray(b.parts)) : [];
  } catch {
    return [];
  }
  return listed.filter((b) => {
    const what = notAsMade(b);
    if (!what) return true;
    const shown = JSON.stringify(b.id.slice(0, BOOK_ID_MAX));
    const key = `${resolve(dir).toLowerCase()}\n${what}\n${shown}`;
    if (!leftOut.has(key) && leftOut.size < LEFT_OUT_MAX) {
      leftOut.add(key);
      leftOutLog("warn", `skills: ${name}'s .library/books.json lists a book whose ${what} is no name Filament's library makes (its id: ${shown}). It is left out, and nothing is read or removed by its names: add the book again on the skill's page to have it.`);
    }
    return false;
  });
}

/**
 * Where a path of the library's lands in a skill's folder, or null where it would not land in `sub` — the skill's own
 * `references` or `sources`: the fence at each delete, write and part's read (what a manifest's names may be is
 * `notAsMade`'s, at the read). Below that folder by its words and as the filesystem resolves it from the skill's own
 * folder (fs-fence.js `resolveInside`), so a link in the skill's folder leads nothing of the library's out of it.
 * @param {string} dir  the skill's folder @param {"references" | "sources"} sub @param {string} rel  from the skill's folder
 * @returns {string | null}
 */
function under(dir, sub, rel) {
  try {
    const abs = resolveInside(dir, rel);
    const below = relative(resolve(dir, sub), abs);
    return below && below !== ".." && !below.startsWith(`..${sep}`) && !isAbsolute(below) ? abs : null;
  } catch {
    return null;
  }
}
/** Why the library changes nothing where `under` gives null. @param {string} name  the skill's */
const linkedOut = (name) => `a link in ${name}'s folder leads its references or its sources out of it, and Filament's library writes and removes nothing through one: make them plain folders of the skill first`;

/** Whether a skill's folder carries a library. @param {string} dir */
export const hasLibrary = (dir) => booksIn(dir).length > 0;

/** @param {string} path @param {string} text */
const writeAtomic = (path, text) => {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const tmp = `${path}.${randomBytes(4).toString("hex")}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
};

// ---- splitting ---------------------------------------------------------------------------------------------------

/** A chapter's label at a line's start: "Chapter 3", "PART II", "Appendix B". */
const CHAPTER_RE = /^(chapter|part|appendix|lesson|unit)\s+([0-9]{1,3}|[ivxlc]{1,7}|[a-z])\b[.:)]?\s*(.{0,80})$/i;
/** The most characters of a chapter's name a title keeps. */
const CHAPTER_NAME_MAX = 60;
/** A contents line: dots that lead to a page number. */
const CONTENTS_LINE = /\.{3,}\s*\d{1,4}\s*$/;

/** A heading set apart mid-page is short; a line of prose, which pdftotext joins into one, is long. */
const HEADING_LINE_MAX = 60;
/** The back of a book, each a part of its own where it heads a line near the end. */
const BACK_MATTER = /^(bibliography|references|index|glossary)$/i;
/** How far into a book its back matter may start, as a share of its pages. */
const BACK_MATTER_FROM = 0.85;

/** A page's lines as pdftotext gave them, a chapter's `line` an index into them. @param {string} text */
const pageLines = (text) => String(text || "").replace(/\r\n?/g, "\n").split("\n");
/** A chapter's name cut to CHAPTER_NAME_MAX at a word. @param {string} whole */
const chapterName = (whole) => (whole.length > CHAPTER_NAME_MAX ? `${whole.slice(0, CHAPTER_NAME_MAX).replace(/\s+\S*$/, "")}…` : whole);
/** A heading's line at k, or the page's start where only blank lines come before it. @param {string[]} lines @param {number} k */
const startAt = (lines, k) => (lines.slice(0, k).some((l) => l.trim()) ? k : 0);

/**
 * Chapters by their label — "Chapter 3", "Part II", "Appendix B" — in a page's first lines, or on a short line of its
 * own further down (a book laid out again as pages starts a chapter mid-page). A running header that repeats a
 * chapter's label on each of its pages starts no new one; a contents page (three labels or more) is passed over.
 * @param {string[]} pages @returns {{ at: number, line: number, title: string }[]}
 */
function labeledChapters(pages) {
  /** @type {{ at: number, line: number, title: string }[]} */
  const out = [];
  let last = "";
  pages.forEach((text, i) => {
    const lines = pageLines(text);
    if (lines.filter((l) => CHAPTER_RE.test(l.trim())).length >= 3) return;
    let seen = 0;
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k].trim();
      if (!l) continue;
      seen++;
      const m = CHAPTER_RE.exec(l);
      // A sentence that starts with the word ("Part 2 of the setup…") is no chapter's head.
      if (!m || CONTENTS_LINE.test(l) || /^[a-z]/.test(m[3]) || (seen > 3 && (l.length > HEADING_LINE_MAX || /[.;,:]$/.test(l)))) continue;
      const label = `${m[1].toLowerCase()} ${m[2].toLowerCase()}`;
      if (label === last) continue;
      last = label;
      const word = m[1][0].toUpperCase() + m[1].slice(1).toLowerCase();
      // The chapter's name: the rest of its line, else the line under it where that is short and not a sentence; a
      // running header's page number after it is not its name. pdftotext joins a paragraph's lines into one, so a
      // heading set in the text's own size runs on into it: past CHAPTER_NAME_MAX it is cut at a word.
      const next = lines.slice(k + 1).find((x) => x.trim())?.trim() || "";
      const whole = (m[3].trim() || (next.length <= 80 && !/[.;]$/.test(next) && !CHAPTER_RE.test(next) ? next : "")).replace(/\s+\d{1,4}$/, "");
      const name = chapterName(whole);
      out.push({ at: i, line: seen <= 3 ? 0 : startAt(lines, k), title: `${word} ${/^\d+$/.test(m[2]) ? m[2] : m[2].toUpperCase()}${name ? ` — ${name}` : ""}` });
    }
  });
  return out;
}

/**
 * Chapters by their number alone — "2 Images, Files and File Types" — taken only in order (1, then 2 or 3, …) and only
 * where its first section, "2.1", follows within a few pages: a numbered list or a table's row is neither. pdftotext
 * often runs the first section's heading into the chapter's ("1 Introduction 1.1 Images and Pictures"); the name stops
 * there. A page with three numbered heads or more is a contents page.
 * @param {string[]} pages @returns {{ at: number, line: number, title: string }[]}
 */
function numberedChapters(pages) {
  /** @type {{ at: number, line: number, title: string }[]} */
  const out = [];
  let want = 1;
  for (let i = 0; i < pages.length; i++) {
    const lines = pageLines(pages[i]);
    if (lines.filter((l) => /^\d{1,2}\s+[A-Z]/.test(l.trim())).length >= 3) continue;
    for (let k = 0; k < lines.length; k++) {
      const m = /^(\d{1,2})\s+([A-Z].*)$/.exec(lines[k].trim());
      const n = m ? Number(m[1]) : 0;
      if (!m || (n !== want && n !== want + 1)) continue;
      const section = new RegExp(`(^|\\s)${n}\\.1\\s+[A-Z]`);
      const cut = m[2].search(section);
      const whole = (cut >= 0 ? m[2].slice(0, cut) : m[2]).trim();
      if (whole.length < 2 || whole.length > 80 || /[.;,:]$/.test(whole) || /[a-z]\.\s/.test(whole) || /\s\d{1,4}$/.test(whole) || CONTENTS_LINE.test(whole)) continue;
      // Its first section soon after: on its line, or heading one of the next lines of this page and the two after.
      const after = [...lines.slice(k + 1), ...pageLines(pages[i + 1]), ...pageLines(pages[i + 2])].map((x) => x.trim()).filter(Boolean).slice(0, 60);
      if (cut < 0 && !after.some((x) => new RegExp(`^${n}\\.1\\s+[A-Z]`).test(x))) continue;
      out.push({ at: i, line: startAt(lines, k), title: `Chapter ${n} — ${chapterName(whole)}` });
      want = n + 1;
    }
  }
  return out;
}

/**
 * The chapters of a PDF: those its labels head ("Chapter 3", "Appendix B"), else — where fewer than two say
 * "Chapter" — those its numbers head, with its parts and appendices; then its bibliography, index or glossary near
 * the end. Each says the page it starts on and the line on that page. Fewer than two chapters found: none.
 * @param {string[]} pages @returns {{ at: number, line: number, title: string }[]}
 */
export function pdfChapters(pages) {
  const labeled = labeledChapters(pages);
  const numbered = labeled.filter((c) => c.title.startsWith("Chapter ")).length >= 2 ? [] : numberedChapters(pages);
  const found = [...(numbered.length >= 2 ? labeled.filter((c) => !c.title.startsWith("Chapter ")) : labeled), ...(numbered.length >= 2 ? numbered : [])].sort((a, b) => a.at - b.at || a.line - b.line);
  if (found.length < 2) return [];
  const lastAt = found[found.length - 1];
  const seen = new Set();
  for (let i = Math.max(lastAt.at, Math.floor(pages.length * BACK_MATTER_FROM)); i < pages.length; i++) {
    const lines = pageLines(pages[i]);
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k].trim();
      if (!BACK_MATTER.test(l) || (i === lastAt.at && k <= lastAt.line) || seen.has(l.toLowerCase())) continue;
      seen.add(l.toLowerCase());
      found.push({ at: i, line: startAt(lines, k), title: l[0].toUpperCase() + l.slice(1).toLowerCase() });
    }
  }
  return found;
}

/**
 * A PDF's pages as parts: by its chapters where it has them (what comes before the first, "Front matter"), else every
 * PAGES_PER_PART pages. Each page's text follows a `[page N]` line; a chapter that starts mid-page takes that page
 * from its heading on, and the part before it the lines above.
 * @param {string[]} pages
 * @returns {{ split: "chapters" | "pages", parts: { title: string, pages: [number, number], body: string }[] }}
 */
export function splitPdf(pages) {
  const body = (/** @type {number} */ from, /** @type {number} */ to) =>
    pages
      .slice(from, to)
      .map((t, k) => `[page ${from + k + 1}]\n${tidy(t)}`)
      .join("\n\n");
  const chapters = pdfChapters(pages);
  if (chapters.length) {
    /** From page a.at's line a.line up to, not into, page b.at's line b.line. @param {{ at: number, line: number }} a @param {{ at: number, line: number }} b */
    const span = (a, b) => {
      const out = [];
      for (let i = a.at; i < pages.length && (i < b.at || (i === b.at && b.line > 0)); i++) {
        const from = i === a.at ? a.line : 0;
        const to = i === b.at ? b.line : undefined;
        out.push(`[page ${i + 1}]\n${tidy(from || to !== undefined ? pageLines(pages[i]).slice(from, to).join("\n") : pages[i])}`);
      }
      return out.join("\n\n");
    };
    /** The last page of a span that ends before b, counted from 1. @param {{ at: number, line: number }} b */
    const lastPage = (b) => (b.line > 0 ? b.at + 1 : b.at);
    const parts = [];
    const front = span({ at: 0, line: 0 }, chapters[0]);
    if (front.replace(/^\[page \d+\]$/gm, "").trim().length >= PAGE_TEXT_MIN)
      parts.push({ title: "Front matter", pages: /** @type {[number, number]} */ ([1, lastPage(chapters[0])]), body: front });
    chapters.forEach((c, k) => {
      const end = chapters[k + 1] || { at: pages.length, line: 0 };
      parts.push({ title: c.title, pages: /** @type {[number, number]} */ ([c.at + 1, Math.max(c.at + 1, lastPage(end))]), body: span(c, end) });
    });
    return { split: "chapters", parts };
  }
  const parts = [];
  for (let from = 0; from < pages.length; from += PAGES_PER_PART) {
    const to = Math.min(pages.length, from + PAGES_PER_PART);
    parts.push({ title: `Pages ${from + 1}–${to}`, pages: /** @type {[number, number]} */ ([from + 1, to]), body: body(from, to) });
  }
  return { split: "pages", parts };
}

/**
 * A text's parts by its headings: Markdown's `#` where it has two or more, else `##`, else a line that is a chapter's
 * label alone ("Chapter 3", "CHAPTER III — The Atlas"); none of them, the whole. Headings inside a code fence are text.
 * @param {string} text
 * @returns {{ split: "headings" | "chapters" | "whole", parts: { title: string, pages: null, body: string }[] }}
 */
export function splitText(text) {
  const lines = String(text || "").replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  /** @type {boolean[]} */
  const fenced = [];
  let inFence = false;
  for (const l of lines) {
    if (/^\s*(```|~~~)/.test(l)) {
      fenced.push(true);
      inFence = !inFence;
      continue;
    }
    fenced.push(inFence);
  }
  /** @param {(l: string) => string | null} headOf @returns {number[]} */
  const starts = (headOf) => lines.map((l, i) => (fenced[i] ? -1 : headOf(l) != null ? i : -1)).filter((i) => i >= 0);
  const h1 = (/** @type {string} */ l) => (/^#\s+\S/.test(l) ? l.replace(/^#\s+/, "").replace(/\s+#+\s*$/, "").trim() : null);
  const h2 = (/** @type {string} */ l) => (/^##\s+\S/.test(l) ? l.replace(/^##\s+/, "").replace(/\s+#+\s*$/, "").trim() : null);
  const chapter = (/** @type {string} */ l) => (CHAPTER_RE.test(l.trim()) && l.trim().length <= 90 ? l.trim() : null);
  /** @type {[(l: string) => string | null, "headings" | "chapters"][]} */
  const ways = [[h1, "headings"], [h2, "headings"], [chapter, "chapters"]];
  for (const [headOf, split] of ways) {
    const at = starts(headOf);
    if (at.length < 2) continue;
    const parts = [];
    const before = tidy(lines.slice(0, at[0]).join("\n"));
    if (before) parts.push({ title: "Before the first heading", pages: null, body: before });
    at.forEach((i, k) => {
      const end = k + 1 < at.length ? at[k + 1] : lines.length;
      parts.push({ title: String(headOf(lines[i])), pages: null, body: tidy(lines.slice(i, end).join("\n")) });
    });
    return { split, parts };
  }
  return { split: "whole", parts: [{ title: "The whole text", pages: null, body: tidy(lines.join("\n")) }] };
}

/**
 * A part past PART_CHARS split again at a paragraph's end, each piece "(2 of 3)" after the first; a PDF piece's pages
 * are those its page lines name.
 * @template {{ title: string, pages: [number, number] | null, body: string }} P
 * @param {P[]} parts @returns {P[]}
 */
export function bySize(parts) {
  /** @type {P[]} */
  const out = [];
  for (const p of parts) {
    if (p.body.length <= PART_CHARS) {
      out.push(p);
      continue;
    }
    /** @type {string[]} */
    const pieces = [];
    let rest = p.body;
    while (rest.length > PART_CHARS) {
      let cut = rest.lastIndexOf("\n\n", PART_CHARS);
      if (cut < PART_CHARS / 2) cut = rest.lastIndexOf("\n", PART_CHARS);
      if (cut < PART_CHARS / 2) cut = PART_CHARS;
      pieces.push(rest.slice(0, cut).trim());
      rest = rest.slice(cut).trim();
    }
    if (rest) pieces.push(rest);
    // A piece's pages: from the page line it starts with, else the page the piece before ended on, to its last.
    let page = p.pages ? p.pages[0] : 0;
    pieces.forEach((body, k) => {
      const marks = [...body.matchAll(/^\[page (\d+)\]$/gm)].map((m) => Number(m[1]));
      const from = marks.length && /^\[page \d+\]/.test(body) ? marks[0] : page;
      const to = marks.length ? Math.max(from, marks[marks.length - 1]) : from;
      page = to;
      out.push({ ...p, title: `${p.title} (${k + 1} of ${pieces.length})`, pages: p.pages ? /** @type {[number, number]} */ ([from, to]) : null, body });
    });
  }
  return out;
}

/** The first words of a part's own text: no heading, no page line. @param {string} body */
export function firstWords(body) {
  const words = String(body || "")
    .split("\n")
    .filter((l) => l.trim() && !/^\[page \d+\]$/.test(l.trim()) && !/^#{1,6}\s/.test(l))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean);
  const head = words.slice(0, SUMMARY_WORDS).join(" ");
  return words.length > SUMMARY_WORDS ? `${head}…` : head;
}

// ---- the table of contents and the index -------------------------------------------------------------------------

const SPLIT_WORDS = Object.freeze({ chapters: "by chapters", headings: "by headings", pages: `every ${PAGES_PER_PART} pages (it has no chapter headings)`, whole: "whole (it has no headings)", files: "by its files, and a long one by its headings" });

/** Page numbers as ranges: "3, 7–9". @param {number[]} pages */
export function pageRanges(pages) {
  /** @type {string[]} */
  const out = [];
  const list = [...new Set(pages)].sort((a, b) => a - b);
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1] === list[j] + 1) j++;
    out.push(j > i ? `${list[i]}–${list[j]}` : String(list[i]));
    i = j;
  }
  return out.join(", ");
}

/**
 * A part's text as it stands in the skill's folder; null where it is not there, or a link leads it out of the folder.
 * @param {string} dir @param {BookPart} p
 */
function partText(dir, p) {
  const at = under(dir, "references", p.file);
  if (!at) return null;
  try {
    return readFileSync(at, "utf8");
  } catch {
    return null;
  }
}

/**
 * `references/INDEX.md`: a section per book, a line per part — its file, its chapter, its pages, its first words.
 * @param {string} name  the skill's @param {string} dir @param {Book[]} books
 */
function writeIndexMd(name, dir, books) {
  const file = join(dir, "references", "INDEX.md");
  if (!books.length) {
    removeTree(file);
    return;
  }
  const out = [
    `# ${name}'s library`,
    "",
    "Each line is one part of a book: its file, its chapter, its pages, how it starts. The skill tool's find ranks the parts by your words; read a part with read, from the line find names.",
  ];
  for (const b of books) {
    const noText = b.noText?.length ? ` · no text on page${b.noText.length === 1 ? "" : "s"} ${pageRanges(b.noText)} (blank, or scans: not searchable)` : "";
    out.push("", `## ${b.title}`, "", `${b.source}${b.pages ? ` · ${b.pages} pages` : ""}${b.kind === "folder" ? ` · ${b.files} files` : ""} · split ${SPLIT_WORDS[b.split]}${noText}`, "");
    for (const p of b.parts) {
      const words = firstWords((partText(dir, p) ?? "").split("\n").slice(3).join("\n"));
      out.push(`- ${p.file} — ${p.title}${p.pages ? ` · ${pagesWords(p.pages)}` : ""}${words ? ` — ${words}` : ""}`);
    }
  }
  writeAtomic(file, `${out.join("\n")}\n`);
}

/** @param {string} dir @returns {DatabaseSync} */
const openIndex = (dir) => {
  mkdirSync(libDir(dir), { recursive: true });
  const db = new DatabaseSync(indexOf(dir));
  db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS parts USING fts5(book UNINDEXED, file UNINDEXED, title, body, tokenize='porter unicode61')");
  return db;
};

/** The index rebuilt from the parts on disk. @param {string} dir @param {Book[]} books */
function reindex(dir, books) {
  const db = openIndex(dir);
  try {
    db.exec("BEGIN");
    db.exec("DELETE FROM parts");
    const put = db.prepare("INSERT INTO parts (book, file, title, body) VALUES (?, ?, ?, ?)");
    for (const b of books)
      for (const p of b.parts) {
        const body = partText(dir, p);
        if (body == null) continue;
        put.run(b.id, p.file, `${b.title} ${p.title}`, body);
      }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    db.close();
  }
}

/** The words a find looks for, lower case, at most twelve. @param {unknown} words */
const wordsOf = (words) =>
  [...new Set(String(words ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1))].slice(0, 12);

/**
 * The passage of a part that holds the most of the words: the best line and those around it, the page it is on (the
 * last page line before it) and its line number, for a read from there.
 * @param {string} body @param {string[]} words
 */
export function passageOf(body, words) {
  const lines = body.split("\n");
  // A word's stem as matched: its first five letters, so "atlases" finds "atlas" as the index's stemming does.
  const stems = words.map((w) => w.slice(0, Math.max(3, Math.min(5, w.length))));
  let best = -1;
  let score = 0;
  lines.forEach((l, i) => {
    const low = l.toLowerCase();
    const s = stems.filter((w) => low.includes(w)).length;
    if (s > score) {
      score = s;
      best = i;
    }
  });
  if (best < 0) best = lines.findIndex((l, i) => i > 2 && l.trim() && !/^\[page \d+\]$/.test(l.trim()));
  if (best < 0) best = 0;
  let page = null;
  for (let i = best; i >= 0; i--) {
    const m = /^\[page (\d+)\]$/.exec(lines[i].trim());
    if (m) {
      page = Number(m[1]);
      break;
    }
  }
  const from = Math.max(0, best - 2);
  const text = cut(lines.slice(from, best + 4).filter((l) => !/^\[page \d+\]$/.test(l.trim())).join("\n").trim(), PASSAGE_CHARS);
  return { line: best + 1, page, text };
}

/**
 * A find in a skill's library: its parts ranked by the words (any of them, the title weighed above the text), each hit
 * its book, its chapter, its file and the line to read from, its page, and the passage. Null where the folder carries
 * no library. The index is built from the parts where it is missing.
 * @param {string} dir  the skill's folder @param {unknown} words @param {{ limit?: number, under?: string }} [o]
 * @returns {{ hits: { book: string, title: string, file: string, line: number, page: number | null, pages: [number, number] | null, passage: string }[], books: number, parts: number } | null}
 */
export function findInLibrary(dir, words, { limit = FIND_PARTS, under = "" } = {}) {
  const books = booksIn(dir);
  if (!books.length) return null;
  const parts = books.reduce((n, b) => n + b.parts.length, 0);
  const asked = wordsOf(words);
  const expr = ftsExpression(asked.join(" "));
  if (!expr) return { hits: [], books: books.length, parts };
  if (!existsSync(indexOf(dir))) reindex(dir, books);
  const byFile = new Map(books.flatMap((b) => b.parts.map((p) => [p.file, { b, p }])));
  const db = openIndex(dir);
  /** @type {any[]} */
  let rows = [];
  try {
    rows = db.prepare("SELECT book, file, body FROM parts WHERE parts MATCH ? ORDER BY bm25(parts, 0, 0, 4.0, 1.0) LIMIT ?").all(expr, Math.max(1, Math.min(40, limit)) * 3);
  } finally {
    db.close();
  }
  const hits = [];
  for (const r of rows) {
    const at = byFile.get(String(r.file));
    if (!at || (under && !String(r.file).startsWith(under))) continue;
    const p = passageOf(String(r.body), asked);
    hits.push({ book: at.b.title, title: at.p.title, file: at.p.file, line: p.line, page: p.page, pages: at.p.pages, passage: p.text });
    if (hits.length >= limit) break;
  }
  return { hits, books: books.length, parts };
}

// ---- adding and removing -----------------------------------------------------------------------------------------

/**
 * What one book is made from: a file, or a folder's Markdown and text files (its chapters, a docs export's pages).
 * @typedef {{ kind: "file", file: string, name: string } | { kind: "folder", dir: string, name: string, files: string[] }} Given
 */

/** A PDF's pages through pdftotext, its refusal said plainly. @param {string} file @param {string | null} pdftotext */
async function pdfText(file, pdftotext) {
  if (!pdftotext) throw new Error("Filament reads a PDF with pdftotext, and this computer has none (Git for Windows ships it; elsewhere it comes with poppler)");
  const st = statSync(file);
  try {
    return await pdfPages(file, { pdftotext, size: st.size, mtimeMs: st.mtimeMs });
  } catch (e) {
    const said = String(/** @type {any} */ (e)?.message || e);
    if (/password/i.test(said)) throw new Error("it is locked with a password: add an unlocked copy");
    throw new Error(`pdftotext could not read it — ${said.slice(0, 160)}`);
  }
}

/**
 * The files of a folder given as books, in name order: its PDFs, each a book, and its Markdown and text files,
 * together one. Hidden folders and installed packages are left out.
 * @param {string} root @returns {{ pdfs: string[], texts: string[] }}
 */
export function booksUnder(root) {
  /** @type {string[]} */
  const pdfs = [];
  /** @type {string[]} */
  const texts = [];
  /** @param {string} d @param {number} depth */
  const walk = (d, depth) => {
    let entries = [];
    try {
      entries = readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const abs = join(d, e.name);
      const kind = /** @type {Record<string, string>} */ (BOOK_EXT)[extname(e.name).toLowerCase()];
      if (e.isFile() && kind === "pdf" && pdfs.length < FOLDER_PDFS_MAX) pdfs.push(abs);
      else if (e.isFile() && kind && kind !== "pdf" && texts.length < FOLDER_TEXTS_MAX) texts.push(abs);
      else if (e.isDirectory() && depth < FOLDER_DEPTH) walk(abs, depth + 1);
    }
  };
  walk(root, 0);
  return { pdfs, texts };
}

/**
 * @param {{ pdftotext?: string | null, now?: () => number, log?: (level: string, msg: string) => void }} [deps]
 */
export function createSkillLibrary({ pdftotext = PDFTOTEXT, now = Date.now, log = () => {} } = {}) {
  // A manifest is read by more than this library (the skill tool's own look, agent/skills.js `booksIn`): what any of
  // those reads leaves out is said in this log.
  leftOutLog = log;
  /** One change at a time per skill's folder: two imports never write its manifest at once. @type {Map<string, Promise<any>>} */
  const queues = new Map();
  /** @template T @param {string} dir @param {() => Promise<T>} fn @returns {Promise<T>} */
  const inTurn = (dir, fn) => {
    const key = resolve(dir).toLowerCase();
    const run = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn);
    queues.set(key, run);
    void run
      .finally(() => {
        if (queues.get(key) === run) queues.delete(key);
      })
      .catch(() => {});
    return run;
  };
  /** @param {string} dir @param {Book[]} books */
  const save = (dir, books) => writeAtomic(manifestOf(dir), JSON.stringify({ version: 1, books }, null, 2));

  /**
   * One book into the library: its text split, its parts written under `references/<id>/`, its original copied into
   * `sources/` — or why it was not taken.
   * @param {string} dir  the skill's folder @param {string} name  the skill's @param {Book[]} books @param {Given} given
   * @returns {Promise<{ book: Book } | { why: string }>}
   */
  async function addOne(dir, name, books, given) {
    if (books.some((b) => b.name.toLowerCase() === given.name.toLowerCase())) return { why: "it is in the books already: remove it first to add it again" };
    if (books.length >= BOOKS_MAX) return { why: `a skill carries at most ${BOOKS_MAX} books` };
    const ext = given.kind === "file" ? extname(given.name).toLowerCase() : "";
    const kind = given.kind === "folder" ? "folder" : /** @type {Record<string, "pdf" | "md" | "txt">} */ (BOOK_EXT)[ext];
    if (!kind) return { why: "Filament reads PDF, Markdown and text files only" };
    const title = given.kind === "file" ? basename(given.name, ext) : given.name;
    const taken = new Set(books.map((b) => b.id));
    let id = slugOf(title, 40);
    for (let n = 2; taken.has(id); n++) id = `${slugOf(title, 36)}-${n}`;
    // Its parts' folder through the fence (`under`), before anything of it is read or written.
    const folder = under(dir, "references", join("references", id));
    if (!folder) return { why: linkedOut(name) };
    /** @type {{ title: string, pages: [number, number] | null, body: string }[]} */
    let parts;
    /** @type {Book["split"]} */
    let split;
    /** @type {number[]} */
    let noText = [];
    let pages = null;
    if (given.kind === "folder") {
      // A folder's files, each split by its headings where it is long enough to have them; one with none, whole.
      parts = [];
      for (const f of given.files) {
        let text = "";
        try {
          text = readFileSync(f, "utf8");
        } catch {
          continue;
        }
        if (!text.trim()) continue;
        const rel = relOf(given.dir, f);
        const s = splitText(text);
        if (s.split === "whole") parts.push({ title: rel.replace(/\.(md|markdown|txt)$/i, ""), pages: null, body: s.parts[0].body });
        else for (const p of s.parts) parts.push({ title: `${rel.replace(/\.(md|markdown|txt)$/i, "")} › ${p.title}`, pages: null, body: p.body });
      }
      if (!parts.length) return { why: "its Markdown and text files are empty" };
      split = "files";
    } else if (kind === "pdf") {
      let all;
      try {
        all = await pdfText(given.file, pdftotext);
      } catch (e) {
        return { why: String(/** @type {any} */ (e)?.message || e) };
      }
      noText = all.map((t, i) => (t.trim().length < PAGE_TEXT_MIN ? i + 1 : 0)).filter(Boolean);
      if (!all.length || noText.length > all.length / 2) return { why: "no text: a scanned PDF needs OCR, which Filament does not do" };
      const s = splitPdf(all);
      parts = s.parts;
      split = s.split;
      pages = all.length;
    } else {
      let text = "";
      try {
        text = readFileSync(given.file, "utf8");
      } catch (e) {
        return { why: `it could not be read: ${String(/** @type {any} */ (e)?.message || e).slice(0, 160)}` };
      }
      if (!text.trim()) return { why: "it is empty" };
      const s = splitText(text);
      parts = s.parts;
      split = s.split;
    }
    parts = bySize(parts);
    // The original kept: a file as it came, a folder's text files under one folder of their own.
    const sources = join(dir, "sources");
    mkdirSync(sources, { recursive: true });
    let source = given.kind === "file" ? `${id}${ext}` : id;
    for (let n = 2; existsSync(join(sources, source)); n++) source = given.kind === "file" ? `${id}-${n}${ext}` : `${id}-${n}`;
    const kept = under(dir, "sources", join("sources", source));
    if (!kept) return { why: linkedOut(name) };
    if (given.kind === "file") copyFileSync(given.file, kept);
    else
      for (const f of given.files) {
        const to = join(kept, relative(given.dir, f));
        mkdirSync(resolve(to, ".."), { recursive: true });
        copyFileSync(f, to);
      }
    removeTree(folder);
    mkdirSync(folder, { recursive: true });
    const width = Math.max(2, String(parts.length).length);
    /** @type {BookPart[]} */
    const written = parts.map((p, k) => {
      const fileName = `${String(k + 1).padStart(width, "0")}-${slugOf(p.title, 48)}.md`;
      const head = `# ${p.title}\n\nFrom ${title} (sources/${source})${p.pages ? ` · ${pagesWords(p.pages)}` : ""}\n\n`;
      writeFileSync(join(folder, fileName), `${head}${p.body}\n`);
      return { file: relOf(dir, join(folder, fileName)), title: p.title, pages: p.pages, chars: p.body.length };
    });
    log("info", `skills: ${name}'s books took ${given.name}: ${written.length} part${written.length === 1 ? "" : "s"}, ${split}`);
    return {
      book: { id, title, name: given.name, source: `sources/${source}`, kind, pages, files: given.kind === "folder" ? given.files.length : 1, split, parts: written, noText, at: now() },
    };
  }

  /** After a change: INDEX.md and the index from the books. @param {string} dir @param {string} name @param {Book[]} books */
  const settle = (dir, name, books) => {
    save(dir, books);
    writeIndexMd(name, dir, books);
    reindex(dir, books);
    // The last book gone: its folders too, where nothing of the skill's own is left in them.
    if (!books.length)
      for (const sub of ["references", "sources"]) {
        const at = join(dir, sub);
        try {
          if (!readdirSync(at).length) rmSync(at, { recursive: true, force: true });
        } catch {
          /* not there */
        }
      }
  };

  const api = {
    /** Whether a PDF can be read here: pdftotext was found. */
    readsPdf: () => !!pdftotext,

    /** The books a skill's folder carries. @param {string} dir */
    books(dir) {
      return booksIn(dir);
    },

    /**
     * Books added: files uploaded (`{ name, data }`, base64), or paths on this computer — a file is a book; a folder's
     * PDFs are each one, and its Markdown and text files together one, named after it. → the books added, and those not
     * added with why.
     * @param {string} dir  the skill's folder @param {string} name  the skill's
     * @param {{ files?: unknown, paths?: unknown }} given
     */
    add(dir, name, { files, paths }) {
      return inTurn(dir, async () => {
        /** @type {Given[]} */
        const todo = [];
        /** @type {{ name: string, why: string }[]} */
        const skipped = [];
        const tmpDir = join(libDir(dir), `upload-${randomBytes(4).toString("hex")}`);
        for (const f of Array.isArray(files) ? files : []) {
          const shown = basename(String(f?.name || "")).slice(0, 160);
          if (!shown || typeof f?.data !== "string") {
            skipped.push({ name: shown || "a file", why: "it came with no name or no data" });
            continue;
          }
          if (!(/** @type {Record<string, string>} */ (BOOK_EXT)[extname(shown).toLowerCase()])) {
            skipped.push({ name: shown, why: "Filament reads PDF, Markdown and text files only" });
            continue;
          }
          const bytes = Buffer.from(f.data, "base64");
          if (bytes.length > UPLOAD_BYTES_MAX) {
            skipped.push({ name: shown, why: `over ${UPLOAD_BYTES_MAX / 1048576} MB: too big to send from the page — give its path instead` });
            continue;
          }
          mkdirSync(tmpDir, { recursive: true });
          const temp = join(tmpDir, `${todo.length}${extname(shown).toLowerCase()}`);
          writeFileSync(temp, bytes);
          todo.push({ kind: "file", file: temp, name: shown });
        }
        for (const raw of (Array.isArray(paths) ? paths : paths == null ? [] : [paths]).filter((p) => typeof p === "string" && p.trim())) {
          // Explorer's Copy as path wraps a path in quotes.
          const p = resolve(String(raw).trim().replace(/^"(.*)"$/, "$1"));
          let st = null;
          try {
            st = statSync(p);
          } catch {}
          if (!st) skipped.push({ name: p, why: "not a file or folder on this computer" });
          else if (st.isFile()) todo.push({ kind: "file", file: p, name: basename(p) });
          else if (st.isDirectory()) {
            const { pdfs, texts } = booksUnder(p);
            if (!pdfs.length && !texts.length) skipped.push({ name: p, why: "no PDF, Markdown or text file in it" });
            for (const f of pdfs) todo.push({ kind: "file", file: f, name: basename(f) });
            if (texts.length) todo.push({ kind: "folder", dir: p, name: basename(p) || p, files: texts });
          }
        }
        if (!todo.length && !skipped.length) throw refused(400, "say the books: files, or paths on this computer");
        const books = booksIn(dir, name);
        /** @type {Book[]} */
        const added = [];
        try {
          for (const t of todo) {
            const r = await addOne(dir, name, books, t);
            if ("why" in r) skipped.push({ name: t.name, why: r.why });
            else {
              books.push(r.book);
              added.push(r.book);
            }
          }
        } finally {
          removeTree(tmpDir);
        }
        if (added.length) settle(dir, name, books);
        return { added, skipped, books };
      });
    },

    /**
     * A book taken out: its parts and Filament's copy of it go, INDEX.md and the index are written again.
     * @param {string} dir @param {string} name @param {string} id
     */
    remove(dir, name, id) {
      return inTurn(dir, async () => {
        const books = booksIn(dir, name);
        const b = books.find((x) => x.id === id);
        if (!b) throw refused(404, `${name}'s books hold none called ${String(id).slice(0, 64)}.`);
        // Its parts' folder and its copy through the fence (`under`) before either goes: where a link leads one out of
        // the skill's folder, nothing is removed and the book stays listed.
        const parts = under(dir, "references", join("references", b.id));
        const copy = under(dir, "sources", b.source);
        if (!parts || !copy) throw refused(409, `${b.name} was not removed: ${linkedOut(name)}.`);
        const rest = books.filter((x) => x !== b);
        removeTree(parts);
        removeTree(copy);
        settle(dir, name, rest);
        return { removed: b.name, books: rest };
      });
    },

    /** A find in a skill's library (`findInLibrary`). @param {string} dir @param {unknown} words @param {{ limit?: number }} [o] */
    find(dir, words, o) {
      return findInLibrary(dir, words, o);
    },
  };
  return api;
}

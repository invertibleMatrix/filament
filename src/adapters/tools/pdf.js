// @ts-check
// A PDF's text for the `read` hand (HarnessV3-Tools TL-D26), page by page, through pdftotext: Filament parses no PDF
// itself. Git for Windows ships xpdf's pdftotext beside the Git Bash the `bash` tool runs (TL-D1); Linux and macOS have
// poppler's on the PATH when it is installed. Both take the same flags and end every page with a form feed.
import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { win32, posix } from "node:path";
import { findGitBash } from "./shell.js";
import { HandError } from "./fs-fence.js";

/** The most pages one read returns: about what a window takes of a dense document in one call. */
export const PDF_PAGES_MAX = 20;
/** A PDF's extraction may take this long before it is given up (a huge or broken file). */
export const PDF_TIMEOUT_MS = 60_000;
/** The most text one extraction may hand back; past it the PDF is read in page ranges with bash. */
const PDF_TEXT_MAX_BYTES = 32 * 1024 * 1024;
/** Extractions kept, the least recently read dropped first: paging through a PDF extracts it once. */
const CACHE_MAX = 4;

const isFileAt = (/** @type {string} */ p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};
/** A variable as the platform reads it: Windows names it in any case. */
const envOf = (/** @type {Record<string, string | undefined>} */ env, /** @type {string} */ name, /** @type {boolean} */ win) => {
  if (!win) return env[name];
  const k = Object.keys(env).find((x) => x.toUpperCase() === name);
  return k ? env[k] : undefined;
};

/**
 * The pdftotext `read` runs, or null where there is none: on Windows Git's own (`<Git>\mingw64\bin`, next to the Git
 * Bash found for the shell), else the first on the PATH.
 * @param {{ platform?: string, env?: Record<string, string | undefined>, isFile?: (path: string) => boolean }} [o]
 * @returns {string | null}
 */
export function resolvePdftotext({ platform = process.platform, env = process.env, isFile = isFileAt } = {}) {
  const win = platform === "win32";
  if (win) {
    const gitBash = findGitBash({ env, isFile });
    const git = gitBash ? win32.join(win32.dirname(win32.dirname(gitBash)), "mingw64", "bin", "pdftotext.exe") : null;
    if (git && isFile(git)) return git;
  }
  const path = win ? win32 : posix;
  const name = win ? "pdftotext.exe" : "pdftotext";
  for (const dir of String(envOf(env, "PATH", win) || "").split(win ? ";" : ":")) {
    const d = dir.trim().replace(/^"(.*)"$/, "$1");
    if (d && isFile(path.join(d, name))) return path.join(d, name);
  }
  return null;
}

/** The pdftotext this Filament's `read` runs. */
export const PDFTOTEXT = resolvePdftotext();

/** @type {Map<string, string[]>} */
const cache = new Map();

/**
 * Every page's text, in order: one extraction per version of the file (its size and modification time), cached.
 * Rejects with the reason in pdftotext's words, or the time limit's.
 * @param {string} file @param {{ pdftotext: string, size: number, mtimeMs: number, signal?: AbortSignal | null, timeoutMs?: number }} o
 * @returns {Promise<string[]>}
 */
export async function pdfPages(file, { pdftotext, size, mtimeMs, signal = null, timeoutMs = PDF_TIMEOUT_MS }) {
  const key = `${file}\0${size}\0${mtimeMs}`;
  const kept = cache.get(key);
  if (kept) {
    cache.delete(key);
    cache.set(key, kept);
    return kept;
  }
  const pages = await extractPages(file, { pdftotext, signal, timeoutMs });
  cache.set(key, pages);
  if (cache.size > CACHE_MAX) cache.delete(/** @type {string} */ (cache.keys().next().value));
  return pages;
}

/**
 * Every page's text, in order, extracted now: what `pdfPages` caches, for a caller that keeps its own (a PDF attached to
 * a message, kept by its bytes). Rejects with the reason in pdftotext's words, or the time limit's (`code` ETIMEDOUT).
 * @param {string} file @param {{ pdftotext: string, signal?: AbortSignal | null, timeoutMs?: number }} o
 * @returns {Promise<string[]>}
 */
export async function extractPages(file, { pdftotext, signal = null, timeoutMs = PDF_TIMEOUT_MS }) {
  const text = await new Promise((resolve, reject) => {
    execFile(
      pdftotext,
      ["-enc", "UTF-8", "-eol", "unix", file, "-"],
      { maxBuffer: PDF_TEXT_MAX_BYTES, timeout: timeoutMs, windowsHide: true, encoding: "buffer", ...(signal ? { signal } : {}) },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout.toString("utf8"));
        // Its last line is its verdict ("Couldn't find trailer dictionary", "Incorrect password"); the lines before
        // are how it got there. Said without its "Syntax Error:" or "Command Line Error:" label.
        const said = String(stderr || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean)
          .pop()
          ?.replace(/^[A-Za-z ]*Error: /, "");
        const e = /** @type {any} */ (err);
        if (signal?.aborted) return reject(new Error("stopped"));
        if (e.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return reject(new Error(`its text is past ${PDF_TEXT_MAX_BYTES / 1048576} MB`));
        if (e.killed) return reject(Object.assign(new Error(`pdftotext took longer than ${Math.round(timeoutMs / 1000)} s`), { code: "ETIMEDOUT" }));
        reject(new Error(said || e.message || "pdftotext failed"));
      },
    );
  });
  // Every page ends with a form feed, so the text after the last one is not a page (and a PDF of no pages is no text).
  const pages = String(text).split("\f");
  if (!pages[pages.length - 1].trim()) pages.pop();
  return pages;
}

/**
 * `pages` as the read asks it: "3", "3-7", or a number. Null when not given; a word for the model when malformed.
 * @param {unknown} pages @returns {{ from: number, to: number } | null}
 */
export function pageRange(pages) {
  if (pages == null || pages === "") return null;
  const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(String(pages));
  const from = m ? Number(m[1]) : 0;
  const to = m ? Number(m[2] ?? m[1]) : 0;
  if (!m || from < 1 || to < from) throw new HandError(`pages is a page or a range of them, like "3" or "3-7" — not "${String(pages)}"`);
  return { from, to };
}

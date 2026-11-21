// @ts-check
// The dashboard and its docs, served from disk through an mtime-keyed cache: a file is re-read only when it changed
// on disk. Paths are confined by the same rules the routes give them — no `..`, docs by bare Markdown name only.
//
// A page names its own files — its scripts, its styles, its icon — under a stamp of the UI's files as they stand
// (`/ui/b/<stamp>/…`), and what those import is named relative to them, so under the stamp too: a file asked under the
// stamp of now is kept by the browser for good (`immutable`), and a file that changes changes the stamp, so the next
// page asks for it anew (the slowness of 11-02: each open asked for its 329 module files and styles again, 11 MB, through
// the six connections the page's reads wait on). The page itself is checked each time: it names the stamp.
import { readFileSync, realpathSync, statSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { sendJson } from "../app/pipeline/respond.js";
import { pageFramePolicy } from "../core/artifacts.js";

const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "ui");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
/** @type {Map<string, { mtimeMs: number, buf: Buffer }>} the file's own path, as the disk names it → cached bytes */
const fileCache = new Map();

/**
 * A file's bytes, read before anything is answered (HarnessV4_Overnight_Plan OV-D31), or the answer instead: a name
 * that is not on disk, or one that is a folder, is not found; a file that is there and cannot be read says why. The
 * cache keeps each file once, under the path the disk gives it: on Windows another case of its name, or its stream
 * spelled out (`::$DATA`), reaches the same file, and each spelling of an address anyone may ask would hold a copy.
 * @param {string} file  on disk @param {string} pathname  as asked, for the words
 * @returns {{ buf: Buffer, real: string } | { status: number, error: string }}  `real`: the file as the disk names it
 */
function readCached(file, pathname) {
  try {
    const st = statSync(file);
    if (st.isDirectory()) return { status: 404, error: `not found: ${pathname} is a folder, not a page` };
    const key = realpathSync.native(file);
    const hit = fileCache.get(key);
    if (hit && hit.mtimeMs === st.mtimeMs) return { buf: hit.buf, real: key };
    const buf = readFileSync(file);
    fileCache.set(key, { mtimeMs: st.mtimeMs, buf });
    return { buf, real: key };
  } catch (/** @type {any} */ e) {
    if (e?.code === "ENOENT") return { status: 404, error: "not found" };
    return { status: 500, error: `${pathname} cannot be read: ${e?.code || e?.message || e}` };
  }
}

/** @param {import("node:http").ServerResponse} res */
export function serveDoc(res, pathname) {
  const name = pathname.slice("/docs/".length);
  if (!/^[A-Za-z0-9_-]+\.md$/.test(name)) return sendJson(res, 404, { error: "not found" });
  const read = readCached(join(dirname(UI_DIR), "..", "docs", name), pathname);
  if (!("buf" in read)) return sendJson(res, read.status, { error: read.error });
  res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-cache" });
  res.end(read.buf);
}

/** An address under a stamp: `/ui/b/<stamp>/…`. */
const STAMPED = /^\/ui\/b\/([0-9a-f]{12})(?=\/)/;
/** A stamped file of now: kept by the browser for good. */
const KEPT = "private, max-age=31536000, immutable";
/** The stamp the last page was served with: a file asked under it is kept. */
let stampNow = "";
/** @type {Map<string, Promise<string>>} a stamp on its way, by folder: the pages asked meanwhile share it */
const stamping = new Map();

/**
 * The UI's files as they stand, as twelve hex digits: each file's path, size and time, hashed. Read for each page from
 * the disk's own calls, so the event loop is not held for it (a walk of the folder's 400 files held it 20–36 ms).
 * @param {string} [dir]
 * @returns {Promise<string>}
 */
export function uiStamp(dir = UI_DIR) {
  const had = stamping.get(dir);
  if (had) return had;
  const made = (async () => {
    const names = await readdir(dir, { recursive: true });
    const facts = await Promise.all(
      names.map(async (n) => {
        const st = await stat(join(dir, n)).catch(() => null);
        return st?.isFile() ? `${n.replace(/\\/g, "/")}\0${st.size}\0${st.mtimeMs}` : "";
      }),
    );
    const hash = createHash("sha256");
    for (const f of facts.filter(Boolean).sort()) hash.update(`${f}\n`);
    return hash.digest("hex").slice(0, 12);
  })().finally(() => stamping.delete(dir));
  stamping.set(dir, made);
  return made;
}

/** A page with its own files named under `stamp`: each `<link>`'s and `<script>`'s `/ui/` address. @param {Buffer} buf @param {string} stamp */
const stampedPage = (buf, stamp) => buf.toString("utf8").replace(/(<(?:link|script)\b[^>]*?\b(?:href|src)=")\/ui\//g, `$1/ui/b/${stamp}/`);

/**
 * What a browser Filament does not know may have of the UI (the owner's remote Filament of 11-06): the files pages are
 * built of — they hold nothing of the person's — and the pairing page. Judged by the file the disk opened, so no
 * spelling of a page's address (`/ui//harness.html`, another case, a trailing dot or `::$DATA` on Windows) is another
 * file (the review of 35049d31f).
 */
const ANYONES = new Set([".js", ".mjs", ".css", ".svg", ".png", ".ico", ".woff2"]);
/** The pairing page as the disk names it, read once. */
let pairReal = "";
/** @param {string} real */
const isPairPage = (real) => {
  if (!pairReal)
    try {
      pairReal = realpathSync.native(join(UI_DIR, "pair.html"));
    } catch {
      return false;
    }
  return real.toLowerCase() === pairReal.toLowerCase();
};

/**
 * A file of the harness or the dashboard. A page carries the rule for frames (`pageFramePolicy`): every page has it,
 * so no spelling of the harness's address (`/ui//harness.html`, another case on Windows) is served without it. A page
 * names its files under the stamp of now; a file asked under it is kept for good, one under another stamp — a page
 * served before a file changed — is checked each time, as a file at its plain address is. For a `stranger` — a browser
 * Filament does not know — anything but the files pages are built of and the pairing page is a redirect to `stranger`.
 * @param {import("node:http").ServerResponse} res @param {string} pathname
 * @param {number} port  the port Filament listens on
 * @param {{ stranger?: string }} [o]  `stranger`: where such a browser is sent
 * @returns {Promise<void>}
 */
export async function serveStatic(res, pathname, port, { stranger = "" } = {}) {
  const stamped = STAMPED.exec(pathname);
  const plain = stamped ? `/ui${pathname.slice(stamped[0].length)}` : pathname;
  const rel = plain === "/" || plain === "/ui" ? "/index.html" : plain.replace(/^\/ui(?=\/|$)/, "");
  if (rel.includes("..")) return sendJson(res, 400, { error: "bad path" });
  const file = join(UI_DIR, rel);
  const read = readCached(file, pathname);
  if (!("buf" in read)) return sendJson(res, read.status, { error: read.error });
  const ext = extname(read.real).toLowerCase();
  if (stranger && !ANYONES.has(ext) && !isPairPage(read.real)) {
    res.writeHead(302, { location: stranger, "cache-control": "no-store" });
    return void res.end();
  }
  const page = ext === ".html";
  let body = read.buf;
  if (page) {
    try {
      stampNow = await uiStamp();
      body = Buffer.from(stampedPage(read.buf, stampNow), "utf8");
    } catch {
      // A folder that could not be read for its stamp: the page as it is, its files at their plain addresses.
    }
  }
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cache-control": !page && stamped && stamped[1] === stampNow ? KEPT : "no-cache",
    ...(page ? { "content-security-policy": pageFramePolicy(port) } : {}),
  });
  res.end(body);
}

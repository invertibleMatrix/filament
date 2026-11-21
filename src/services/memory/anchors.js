// @ts-check
// Anchors (HarnessV3-Memory M3-3, MD-4): a claim about code holds the files and folders it names, as they were when it
// was filed — the file's hash, size and mtime, the git HEAD, and the symbols the claim names that the file held. At
// recall one `stat` says whether the file moved; a re-hash runs only when its size or mtime did. A changed file is a
// label; a gone file, or a symbol gone from a changed one, holds the claim back (M3-D6).
//
// Pure of the archive: the brain stores the rows (`archive.anchors`) and decides what each state does.
import { statSync, readFileSync } from "node:fs";
import { stat as statAsync } from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { withinFolder } from "./values.js";

/** A file larger than this is anchored by its size and mtime only (M3-D5). */
export const HASH_LIMIT = 1024 * 1024;
/** At most this many anchors per claim: the first paths it names that exist. */
const MAX_ANCHORS = 5;
/** A file's mtime this much after the claim was said means it changed after (M3-D7); below it is the same moment. */
const SAME_MOMENT_MS = 2000;
const EXT =
  "js|mjs|cjs|jsx|ts|tsx|mts|cts|json|jsonc|md|mdx|py|pyi|rs|go|java|kt|rb|php|cs|c|h|cc|cpp|hpp|swift|toml|yaml|yml|lock|lockb|txt|css|scss|html|vue|svelte|sh|ps1|psm1|bat|cmd|sql|ini|cfg|conf|xml|gradle|proto";
// A path as a claim names it: absolute (a drive path, or a POSIX one), relative with a separator ("src/config.js",
// "src/services/memory/", "lib/"), or a bare file name with an extension ("package.json"). Never a piece of a link or
// of a longer token: what comes before it is no word, dot, colon or separator.
const NAMED_PATH = new RegExp(
  String.raw`(?<![\w.:/\\@-])(?:[A-Za-z]:[\\/][^\s"'\x60<>|*?,;()[\]]+|\/[\w@.-]+(?:\/[\w@.-]+)+\/?|(?:\.{1,2}[\\/])?[\w@.-]+(?:[\\/][\w@.-]+)+[\\/]?|[\w@.-]+[\\/](?![\w@.-])|[\w@-][\w@.-]*\.(?:${EXT}))(?![\w-])`,
  "g",
);
// A symbol as a claim names it: in backticks, called ("parse()"), in camelCase, PascalCase or snake_case, or the
// word after "exports", "function", "class" and the like.
const NAMED_SYMBOL =
  /`([A-Za-z_$][\w$]*)(?:\(\))?`|(?<![\w$./\\-])([a-z_$][\w$]*[A-Z][\w$]*|[A-Z][a-z0-9]+[A-Z][\w$]*|[A-Za-z$][\w$]*_[\w$]+|[A-Za-z_$][\w$]*(?=\(\)))(?![\w$./\\-])|\b(?:exports?|defines?|function|class|method|calls?|const|def|fn|struct|interface|type)\s+([A-Za-z_$][\w$]*)/g;
const NOT_SYMBOL = new Set(["the", "a", "an", "its", "it", "this", "that", "one", "two", "all", "both", "and", "or", "no", "default", "from", "with", "to", "of", "in", "for"]);

/**
 * The paths a claim names, as named (trailing punctuation set aside), at most a few.
 * @param {string} text @returns {string[]}
 */
export function namedPaths(text) {
  const out = [];
  for (const m of String(text || "").matchAll(NAMED_PATH)) {
    const p = m[0].replace(/[.,:;!?)\]]+$/, "");
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * The symbols a claim names: identifiers, never plain words.
 * @param {string} text @returns {string[]}
 */
export function namedSymbols(text) {
  const out = new Set();
  for (const m of String(text || "").matchAll(NAMED_SYMBOL)) {
    const s = m[1] || m[2] || m[3];
    if (s && s.length >= 3 && !NOT_SYMBOL.has(s.toLowerCase())) out.add(s);
  }
  return [...out];
}

/** Whether a file's text holds a symbol as a whole identifier. @param {string} body @param {string} symbol */
export const holdsSymbol = (body, symbol) => new RegExp(`(?<![\\w$])${symbol.replace(/[$]/g, "\\$")}(?![\\w$])`).test(body);

/** @param {string} p */
const statOf = (p) => {
  try {
    return statSync(p);
  } catch {
    return null;
  }
};
/** `statOf` off the event loop: the same stat, or null where there is none. @param {string} p */
const statAhead = (p) => statAsync(p).then((st) => st, () => null);
/**
 * How many stats a check run takes ahead at once (`warm`): enough to overlap a slow disk's waits, few enough to leave
 * the thread pool the file reads, hashes and zips the rest of Filament queues on it.
 */
const WARM_AT_ONCE = 8;
const sha1 = (/** @type {Buffer} */ b) => createHash("sha1").update(b).digest("hex");

/**
 * The git commit a folder's checkout is at, read from `.git` (no process spawned), or null.
 * @param {string} root
 */
export function gitHead(root) {
  try {
    let git = join(root, ".git");
    const st = statOf(git);
    if (!st) return null;
    if (st.isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(readFileSync(git, "utf8"));
      if (!m) return null;
      git = resolve(root, m[1].trim());
    }
    const head = readFileSync(join(git, "HEAD"), "utf8").trim();
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return /^[0-9a-f]{40}$/.test(head) ? head : null;
    const loose = statOf(join(git, ref)) ? readFileSync(join(git, ref), "utf8").trim() : null;
    if (loose) return loose;
    const packed = statOf(join(git, "packed-refs")) ? readFileSync(join(git, "packed-refs"), "utf8") : "";
    return new RegExp(`^([0-9a-f]{40}) ${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").exec(packed)?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} Anchor
 * @property {string} path  the absolute path checked
 * @property {string} name  the path as the claim named it
 * @property {"file" | "folder"} kind
 * @property {string | null} hash  the file's sha1 then; null for a folder, a file over HASH_LIMIT, or no baseline
 * @property {number | null} size  null when there is no baseline: the file had already changed when it was anchored
 * @property {number | null} mtime
 * @property {string | null} head
 * @property {string[]} symbols  the symbols the claim names that the file held
 * @property {AnchorState} state  as last observed
 */
/** @typedef {"ok" | "changed" | "gone" | "symbol"} AnchorState */

/**
 * A claim's anchors, against the files as they are now (M3-D5, M3-D7): each path it names that exists under its
 * project's folder. `saidAt` is when the claim was said: a file modified after that has no baseline (anchored as
 * changed), since what it held then is not known.
 * @param {string} text @param {string} root  the project's folder @param {{ saidAt?: number | null }} [o]
 * @returns {Anchor[]}
 */
export function anchorsFor(text, root, { saidAt = null } = {}) {
  if (!root) return [];
  const symbols = namedSymbols(text);
  const out = [];
  let head;
  for (const name of namedPaths(text)) {
    if (out.length >= MAX_ANCHORS) break;
    const path = isAbsolute(name) ? resolve(name) : resolve(root, name.replace(/[\\/]+/g, "/"));
    if (!withinFolder(path, root) || out.some((a) => a.path === path)) continue;
    const st = statOf(path);
    if (!st || !(st.isFile() || st.isDirectory())) continue;
    head ??= gitHead(root);
    if (st.isDirectory()) {
      out.push({ path, name, kind: /** @type {const} */ ("folder"), hash: null, size: null, mtime: null, head, symbols: [], state: /** @type {AnchorState} */ ("ok") });
      continue;
    }
    const after = saidAt != null && st.mtimeMs > saidAt + SAME_MOMENT_MS;
    const body = st.size <= HASH_LIMIT ? readFileSync(path) : null;
    const text = body ? body.toString("utf8") : "";
    out.push({
      path,
      name,
      kind: /** @type {const} */ ("file"),
      hash: body && !after ? sha1(body) : null,
      size: after ? null : st.size,
      mtime: after ? null : Math.round(st.mtimeMs),
      head,
      symbols: body ? symbols.filter((s) => holdsSymbol(text, s)) : [],
      state: /** @type {AnchorState} */ (after ? "changed" : "ok"),
    });
  }
  return out;
}

/**
 * Checks anchors against the files, one `stat` per path per check run and a re-hash only when the size or mtime moved;
 * a file's hash and text are kept by path, size and mtime, so a changed file is read once, not on every recall.
 */
export class AnchorCheck {
  /** @type {Map<string, { hash: string, text: string | null }>} */
  #reads = new Map();
  /**
   * A fresh run: stats are taken again (one per path per run). `warm(paths)` takes those it has not taken yet off the
   * event loop, a few at a time, so the checks that follow read them rather than each taking one on the loop: what a
   * check reads of a path is its first stat in the run either way.
   * @returns {AnchorCheckRun}
   */
  run() {
    /** @type {Map<string, import("node:fs").Stats | null>} */
    const stats = new Map();
    const stat = (/** @type {string} */ p) => {
      if (!stats.has(p)) stats.set(p, statOf(p));
      return stats.get(p) ?? null;
    };
    /** @param {readonly string[]} paths */
    const warm = async (paths) => {
      const left = [...new Set(paths)].filter((p) => !stats.has(p));
      let next = 0;
      const one = async () => {
        while (next < left.length) {
          const p = left[next++];
          const st = await statAhead(p);
          if (!stats.has(p)) stats.set(p, st);
        }
      };
      await Promise.all(Array.from({ length: Math.min(WARM_AT_ONCE, left.length) }, one));
    };
    /** @type {(a: Pick<Anchor, "path" | "kind" | "hash" | "size" | "mtime" | "symbols">) => { state: AnchorState, symbol?: string }} */
    const check = (a) => {
      const st = stat(a.path);
      if (a.kind === "folder") return { state: st?.isDirectory() ? "ok" : "gone" };
      if (!st?.isFile()) return { state: "gone" };
      const same = a.size != null && st.size === a.size && Math.round(st.mtimeMs) === a.mtime;
      if (same) return { state: "ok" };
      if (st.size > HASH_LIMIT) return { state: "changed" };
      const now = this.#read(a.path, st);
      if (!now) return { state: "gone" };
      if (a.hash && now.hash === a.hash) return { state: "ok" };
      const body = now.text ?? readFileSync(a.path, "utf8");
      const lost = (a.symbols || []).find((s) => !holdsSymbol(body, s));
      return lost ? { state: "symbol", symbol: lost } : { state: "changed" };
    };
    return Object.assign(check, { warm });
  }
  /** @param {string} path @param {import("node:fs").Stats} st */
  #read(path, st) {
    const key = `${path}\0${st.size}\0${Math.round(st.mtimeMs)}`;
    let r = this.#reads.get(key);
    if (r) {
      this.#reads.delete(key);
      this.#reads.set(key, r);
      return r;
    }
    let body;
    try {
      body = readFileSync(path);
    } catch {
      return null;
    }
    r = { hash: sha1(body), text: body.length <= 256 * 1024 ? body.toString("utf8") : null };
    this.#reads.set(key, r);
    if (this.#reads.size > 64) this.#reads.delete(/** @type {string} */ (this.#reads.keys().next().value));
    return r;
  }
}

/**
 * A check run (`AnchorCheck.run`): an anchor's state now, and `warm`, which takes ahead the stats of paths it will
 * check.
 * @typedef {((a: Pick<Anchor, "path" | "kind" | "hash" | "size" | "mtime" | "symbols">) => { state: AnchorState, symbol?: string }) & { warm: (paths: readonly string[]) => Promise<void> }} AnchorCheckRun
 */

/** The worst of some anchor states: a hold (gone, symbol) over a change over none. @param {{ state: AnchorState, symbol?: string }[]} states */
export function worstOf(states) {
  const rank = { ok: 0, changed: 1, gone: 2, symbol: 2 };
  return states.reduce((w, s) => (rank[s.state] > rank[w.state] ? s : w), /** @type {{ state: AnchorState, symbol?: string, name?: string }} */ ({ state: "ok" }));
}

// @ts-check
// The grep hand's search where there is no rg (HarnessV3-Tools TL-D8), run in a worker thread by hands.js: its reads
// are synchronous, and a pattern of the model's may backtrack without end — on the proxy's own thread either would hold
// every stream and request until it ended (the bug report's P9). A bounded walk in the same order rg sorts by — each
// folder's entries by name, depth first — that skips hidden entries and node_modules below the path it was given, and
// files that are binary or past 2 MB, or that the session's rules refuse a read of — never read. Each file found goes
// back as it is found, so what the walk found stands when the hand ends it at the search's time.
import { parentPort, workerData } from "node:worker_threads";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { keptOut } from "../../core/read-rules.js";

/**
 * The search as the hand hands it over: its pattern as compiled (`source`, `flags`), the glob the files' names or paths
 * match, the path searched, the output and the lines around a match, how many entries it wants, when it ends, and the
 * session's rules on reading (`readRules`).
 * @typedef {{ source: string, flags: string, glob: string | null, abs: string, mode: string, before: number, after: number, wanted: number, multiline: boolean, deadline: number, readRules?: { root: string, rules: import("../../core/read-rules.js").ReadRules } | null }} Walk
 */

/**
 * The walk: each file found to `hand`, as found. True when the time ran out first.
 * @param {Walk} w @param {(f: import("./hands.js").GrepFile) => void} hand
 */
function walk({ source, flags, glob, abs, mode, before, after, wanted, multiline, deadline, readRules = null }, hand) {
  const re = new RegExp(source, flags);
  const out = keptOut(readRules);
  const globRe = glob
    ? new RegExp(
        "^" +
          String(glob)
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\*\*/g, "\0")
            .replace(/\*/g, "[^/]*")
            .replace(/\?/g, ".")
            .replace(/\0/g, ".*") +
          "$",
      )
    : null;
  let files = 0;
  let entries = 0;
  const enough = () => (mode === "content" ? entries : files) >= wanted;
  let timedOut = false;
  const scanFile = (/** @type {string} */ p) => {
    if (out?.(p)) return;
    let text;
    try {
      if (statSync(p).size > 2 * 1024 * 1024) return;
      text = readFileSync(p, "utf8");
    } catch {
      return;
    }
    if (text.includes("\0")) return;
    const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
    if (text.endsWith("\n")) lines.pop();
    /** @type {[number, number][]} */
    const found = [];
    // files needs one match a file; count needs them all; content stops at the page and the one past it.
    const room = () => (mode === "files" ? !found.length : mode !== "content" || entries + found.length < wanted);
    if (multiline) {
      const starts = [0];
      for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
      const lineOf = (/** @type {number} */ off) => {
        let lo = 0;
        let hi = starts.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (starts[mid] <= off) lo = mid;
          else hi = mid - 1;
        }
        return lo + 1;
      };
      re.lastIndex = 0;
      let m;
      while (room() && (m = re.exec(text))) {
        found.push([lineOf(m.index), lineOf(Math.max(m.index, m.index + m[0].length - 1))]);
        if (!m[0].length) re.lastIndex++;
      }
    } else for (let i = 0; i < lines.length && room(); i++) if (re.test(lines[i])) found.push([i + 1, i + 1]);
    if (!found.length) return;
    /** @type {import("./hands.js").GrepFile} */
    const f = { path: p, lines: new Map(), entries: [], count: found.length };
    if (mode === "content") {
      f.entries = found;
      for (const [s, e] of found) for (let n = Math.max(1, s - before); n <= Math.min(lines.length, e + after); n++) f.lines.set(n, lines[n - 1]);
    }
    files++;
    entries += found.length;
    hand(f);
  };
  const visit = (/** @type {string} */ dir, /** @type {number} */ depth) => {
    if (depth > 12) return;
    let ents;
    try {
      ents = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of ents) {
      if (enough() || timedOut) return;
      if (Date.now() >= deadline) {
        timedOut = true;
        return;
      }
      if (ent.name.startsWith(".") || ent.name === "node_modules") continue;
      const p = join(dir, ent.name);
      if (ent.isDirectory()) visit(p, depth + 1);
      else if (ent.isFile()) {
        const rel = relative(abs, p).split(sep).join("/");
        if (!globRe || globRe.test(ent.name) || globRe.test(rel)) scanFile(p);
      }
    }
  };
  if (existsSync(abs) && statSync(abs).isFile()) scanFile(abs);
  else visit(abs, 0);
  return timedOut;
}

if (parentPort && workerData?.grepWalk) {
  const port = parentPort;
  const timedOut = walk(workerData.grepWalk, (file) => port.postMessage({ file }));
  port.postMessage({ end: true, timedOut });
}

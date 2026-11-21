// @ts-check
// The Changes tab's read, by place (the Designer's of 10-29, on the owner's words: "what agents are writing where into
// which worktree and what branches and what uncommitted files are there sitting"): each place's uncommitted files with
// their counts, and who wrote each — the agents whose own edit calls named it since the file's last commit. An agent
// that only read names nothing, so it is no writer.

/**
 * @typedef {{ path: string, oldPath: string | null, status: "M" | "A" | "D" | "R" | "U", added: number | null,
 *   removed: number | null, binary: boolean, untracked: boolean }} PlaceFile  an uncommitted file of a place: its
 *   letter, its lines added and removed against the last commit — none for an untracked one, which is new
 * @typedef {{ chain: string, agent: string, at: number }} Writer  an agent that wrote a file: its chat, "" for the
 *   chat's own agent or a helper's id, and when it last did
 * @typedef {{ chain: string, agent: string, own: string[], at: number }} Round  a writing round in the place, as the
 *   archive keeps it: the files its agent's own calls named, by their paths in the place
 * @typedef {PlaceFile & { by: Writer[] }} WrittenFile
 */

/** How many of a place's files are listed, and how many writing rounds are read for it. */
export const FILES_MAX = 500;
/** How far back a writing round is read: older ones are history, not what sits now. */
export const ROUNDS_BACK_MS = 14 * 24 * 3_600_000;

/**
 * A place's uncommitted files from `git status --porcelain=v2` (parsed) and `git diff-index --numstat -M HEAD`
 * (parsed): each with its letter and counts, an untracked one marked new; what git ignores left out.
 * @param {{ path: string, oldPath: string | null, index: string, worktree: string, kind: string }[]} status
 * @param {Map<string, { added: number, removed: number, binary: boolean }>} counts
 * @returns {PlaceFile[]}
 */
export function filesOf(status, counts) {
  /** @type {PlaceFile[]} */
  const out = [];
  for (const f of status) {
    if (f.kind === "ignored") continue;
    const untracked = f.kind === "untracked";
    const status = f.kind === "conflicted" ? "U" : untracked ? "A" : f.oldPath ? "R" : f.index === "D" || f.worktree === "D" ? "D" : f.index === "A" ? "A" : "M";
    const c = counts.get(f.path);
    out.push({ path: f.path, oldPath: f.oldPath || null, status, added: c ? c.added : null, removed: c ? c.removed : null, binary: !!c?.binary, untracked });
    if (out.length >= FILES_MAX) break;
  }
  return out;
}

/** A path as compared: case folded, for a folder whose files differ by case alone is rare and Windows ignores it. @param {string} p */
const fold = (p) => String(p).toLowerCase();

/**
 * Who wrote each file: the writing rounds (the newest first) whose own calls named it — or its old name — after its
 * last commit (`lastAt`, ms by path; none: no commit of it was read in the window), each agent once, the newest first.
 * @param {PlaceFile[]} files @param {Round[]} rounds @param {Map<string, number>} lastAt
 * @returns {WrittenFile[]}
 */
export function attribute(files, rounds, lastAt) {
  const named = rounds.map((r) => ({ ...r, set: new Set(r.own.map(fold)) }));
  return files.map((f) => {
    const since = lastAt.get(f.path) ?? 0;
    const names = [fold(f.path), ...(f.oldPath ? [fold(f.oldPath)] : [])];
    /** @type {Writer[]} */
    const by = [];
    for (const r of named) {
      if (r.at <= since || !names.some((n) => r.set.has(n))) continue;
      if (by.some((w) => w.chain === r.chain && w.agent === r.agent)) continue;
      by.push({ chain: r.chain, agent: r.agent, at: r.at });
    }
    return { ...f, by };
  });
}

/**
 * The files a commit-time read should ask about: those a round named in the window. @param {PlaceFile[]} files @param {Round[]} rounds
 */
export function namedFiles(files, rounds) {
  const all = new Set(rounds.flatMap((r) => r.own.map(fold)));
  return files.filter((f) => all.has(fold(f.path)) || (f.oldPath && all.has(fold(f.oldPath)))).map((f) => f.path);
}

/**
 * A place's writers: each agent that wrote one of its files, with how many and their lines, when it last wrote — the
 * newest first.
 * @param {WrittenFile[]} files
 * @returns {{ chain: string, agent: string, at: number, files: number, added: number, removed: number }[]}
 */
export function writersOf(files) {
  /** @type {Map<string, { chain: string, agent: string, at: number, files: number, added: number, removed: number }>} */
  const out = new Map();
  for (const f of files)
    for (const w of f.by) {
      const k = `${w.chain}\n${w.agent}`;
      const had = out.get(k) || { chain: w.chain, agent: w.agent, at: 0, files: 0, added: 0, removed: 0 };
      had.at = Math.max(had.at, w.at);
      had.files += 1;
      had.added += f.added || 0;
      had.removed += f.removed || 0;
      out.set(k, had);
    }
  return [...out.values()].sort((a, b) => b.at - a.at);
}

/**
 * `git log --format=@@%ct --name-only` → each path's newest commit time in ms (the log runs newest first).
 * @param {string} text @returns {Map<string, number>}
 */
export function commitTimes(text) {
  /** @type {Map<string, number>} */
  const out = new Map();
  let at = 0;
  for (const line of String(text || "").split(/\r?\n/)) {
    if (line.startsWith("@@")) at = Number(line.slice(2)) * 1000 || 0;
    else if (line && !out.has(line)) out.set(line, at);
  }
  return out;
}

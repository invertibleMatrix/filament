// @ts-check
// Pure helpers behind the side panes: the git status letter, the network attempts a record carries, the
// held-token series and its forecast, the prompt card's tag, the tab overview's age words, and the tabs a saved side
// pane opens with. No DOM, no fetch — testable from Node, and kept out of the pane files so a pane may import the
// primitives (which need a window) while its arithmetic stays pure.
import { parseArtifactTabId } from "../lib/artifacts.js";
/**
 * A changed file's kind letter and its colour class: last-turn rows (B2) carry a status word, git rows
 * (B5) carry the porcelain columns. An untracked file is an addition; a typechange or a conflict has no
 * colour of its own and takes modified's.
 * @param {any} f
 * @returns {{ letter: string, cls: string }}
 */
export function statusLetter(f) {
  const word = String(f?.status || "");
  const col = word ? "" : (f?.worktree && f.worktree !== " " ? f.worktree : f?.index) || "";
  const letter = word
    ? { added: "A", modified: "M", deleted: "D", renamed: "R", copied: "R", typechange: "M", unmerged: "U" }[word] || "M"
    : col === "?"
      ? "A"
      : (col && col !== "." ? col : "M");
  const cls = { A: "a", M: "m", D: "d", R: "r" }[letter] || "m";
  return { letter, cls };
}


/**
 * The upstream attempts a record tells about: the failover trail's failures in order, then the entry
 * that served (its attempt index, the total time, the error when the record is one) — none where nobody on the
 * route answered (`servedBy` null, HarnessV4_Tasks B10). A record without failover data is the one attempt it
 * names. Only what the record carries — a failed hop has no duration, and response headers are not recorded at all.
 * @param {any} rec
 * @returns {{ provider: string, attempt: number, http: number | null, ms: number | null, error: string | null, served: boolean }[]}
 */
export function attemptsOf(rec) {
  const trail = Array.isArray(rec?.failover?.trail) ? rec.failover.trail : [];
  const out = trail.map((t, i) => ({
    provider: String(t?.upstream || ""),
    attempt: i + 1,
    http: t?.status ?? null,
    ms: null,
    error: t?.reason ? String(t.reason).slice(0, 200) : null,
    served: false,
  }));
  const servedBy = rec?.failover?.servedBy === null ? null : rec?.upstream || rec?.failover?.servedBy;
  if (servedBy) {
    out.push({
      provider: String(servedBy),
      attempt: rec?.failover?.attempt || trail.length + 1,
      http: rec?.httpStatus ?? null,
      ms: rec?.totalMs ?? null,
      error: rec?.status === "error" ? String(rec?.error || "").slice(0, 200) : null,
      served: true,
    });
  }
  return out;
}

/** A record's held tokens: what the next request starts from (billed input plus both cache tokens). @param {any} rec */
export const heldOf = (rec) =>
  (rec?.tokens?.input || 0) + (rec?.tokens?.cacheRead || 0) + (rec?.tokens?.cacheWrite || 0);

/**
 * The session's held tokens per request, oldest first.
 * @param {any[]} records  @returns {number[]}
 */
export const heldSeries = (records) => (records || []).map((r) => heldOf(r));

/**
 * The forecast the plan asks for: a least-squares line over the tail of a series, read at the next
 * index. The answer is marked an estimate by the caller; a series too flat to fit (fewer than three
 * points) or a non-finite slope answers null and the line is left out.
 * @param {number[]} series  @param {{ tail?: number }} [opts]
 * @returns {number | null}
 */
export function forecastNext(series, opts = {}) {
  const tail = Math.max(2, opts.tail || 10);
  const ys = (series || []).slice(-tail).filter((y) => Number.isFinite(y));
  if (ys.length < 3) return null;
  const n = ys.length;
  const meanX = (n - 1) / 2;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  ys.forEach((y, x) => {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) * (x - meanX);
  });
  if (!sxx) return null;
  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const next = intercept + slope * n;
  return Number.isFinite(next) ? Math.max(0, next) : null;
}

/**
 * The prompt card's tag, from what the record itself carries (the one classifier's outputs: `source`,
 * `memoryFor`, `subagentOf`, `memory.position`). A compaction is a record the memory stage stamped; memory's calls name their purpose. Goal checks and title
 * generation make no records yet, so they name no tag.
 * @param {any} rec
 * @returns {string}
 */
export function promptTagOf(rec) {
  if (rec?.memory?.position === "compaction") return "Compaction";
  if (rec?.memoryFor) return rec.memoryFor.purpose ? `Memory · ${rec.memoryFor.purpose}` : "Memory";
  if (rec?.subagentOf) return "Sub-agent";
  return "Main session";
}

/**
 * The tab overview's age words: "just now", "{n}m ago", "{n}h ago", "{n}d ago".
 * @param {number} at  @param {number} [now]  @returns {string}
 */
export function ageOf(at, now = Date.now()) {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * A record list cut to the main session's own calls: a loop's ticks, its sub-agents' calls and memory's own calls
 * carry their own rows; the token table is the chain's client traffic.
 * @param {any} rec  @returns {boolean}
 */
export const isMainRecord = (rec) => !rec?.agentOf && !rec?.subagentOf && !rec?.memoryFor && !rec?.memory?.position;

/** A file tab's id is its cwd and path, so the same leaf in two projects is two tabs. @param {string} cwd @param {string} path */
export const fileTabId = (cwd, path) => `file:${JSON.stringify([cwd, path])}`;

/**
 * Where a file is read from (HarnessV4_Four_Plan FO-D26): in the chat's folder, by its path there; a whole path
 * outside it, in its own folder — the folder rule judges that folder as it judges a chat's. A drive's path compares
 * in one case, as Windows does.
 * @param {string} cwd  the chat's folder @param {string} path  as a card names it
 * @returns {{ path: string, cwd: string }}
 */
export function fileWhere(cwd, path) {
  const p = String(path || "").replace(/\\/g, "/");
  const whole = /^[a-zA-Z]:\//.test(p) || p.startsWith("/");
  if (!whole) return { cwd, path };
  const home = String(cwd || "").replace(/\\/g, "/").replace(/\/+$/, "");
  const fold = (/** @type {string} */ s) => (/^[a-zA-Z]:\//.test(s) ? s.toLowerCase() : s);
  if (home && fold(p).startsWith(`${fold(home)}/`)) return { cwd, path: p.slice(home.length + 1) };
  const i = p.lastIndexOf("/");
  const dir = p.slice(0, i);
  // A drive's top is "C:/": "C:" alone is the drive's current folder.
  return { cwd: /^[a-zA-Z]:$/.test(dir) ? `${dir}/` : dir || "/", path: p.slice(i + 1) };
}

/** A file tab's cwd and path, or null for a pane's id. @param {string} id @returns {{ path: string, cwd: string } | null} */
export function parseFileTabId(id) {
  if (!id.startsWith("file:")) return null;
  try {
    const [cwd, path] = JSON.parse(id.slice(5));
    return typeof path === "string" ? { cwd: String(cwd || ""), path } : null;
  } catch {
    return null;
  }
}

/** An agent's thread in a tile of its own (proposal_ux §4.7): its tab's id. @param {string} id  the agent's */
export const threadTabId = (id) => `thread:${id}`;
/** The agent a thread's tab names, or null for any other tab. @param {string} id @returns {string | null} */
export function parseThreadTabId(id) {
  const agent = String(id || "").startsWith("thread:") ? String(id).slice(7) : "";
  return agent && !/\s/.test(agent) ? agent : null;
}

/** A team's result beside the chat (team_v2_plan §10 O3, Open beside): its tab's id. @param {string} id  the team chat's */
export const resultTabId = (id) => `result:${id}`;
/** The team chat a result's tab names, or null for any other tab. @param {string} id @returns {string | null} */
export function parseResultTabId(id) {
  const team = String(id || "").startsWith("result:") ? String(id).slice(7) : "";
  return team && !/\s/.test(team) ? team : null;
}

/**
 * A tab id the panes can open: one of theirs, a file, an artifact (HarnessV4_Artifacts_Plan AFC-71), an agent's
 * thread (proposal_ux §4.7), or a team's result (team_v2_plan §10 O3).
 * @param {any} id @param {readonly { id: string }[]} panes
 */
export const tabCanOpen = (id, panes) => typeof id === "string" && (panes.some((p) => p.id === id) || !!parseFileTabId(id) || !!parseArtifactTabId(id) || !!parseThreadTabId(id) || !!parseResultTabId(id));

/**
 * The overview's recently closed tabs as they were saved, newest first and at most `max`, without the ones the side
 * pane cannot open again.
 * @param {any} saved @param {readonly { id: string }[]} panes @param {number} max
 * @returns {Map<string, { label: string, icon: string, at: number }>}
 */
export function closedTabsOf(saved, panes, max) {
  /** @type {Map<string, { label: string, icon: string, at: number }>} */
  const closed = new Map();
  for (const c of Array.isArray(saved) ? saved : []) {
    if (closed.size >= max) break;
    if (c && tabCanOpen(c.id, panes)) closed.set(c.id, { label: String(c.label || c.id), icon: String(c.icon || "x"), at: Number(c.at) || 0 });
  }
  return closed;
}

/**
 * A file's path split for the viewer's breadcrumb: [root, …folders, file].
 * @param {string} cwd  @param {string} path  @returns {string[]}
 */
export function crumbsOf(cwd, path) {
  const leaf = String(cwd || "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() || cwd || "project";
  const parts = String(path || "").split("/").filter(Boolean);
  return [leaf, ...parts];
}

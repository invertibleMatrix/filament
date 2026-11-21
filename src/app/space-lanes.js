// @ts-check
// The lanes as an agent of the project reads them (HarnessV4_AgentsSpace_Plan AS3, SA-D6), as the Space's page reads
// them: each place of the project's repository where one of its chats works — its folder is there, or its agents wrote
// there — and the main folder always; each with its branch and what it holds that its base lacks, its chats working or
// idle and since when, the files it changed, committed and not, as git says them (the page's files read); and the
// Overlaps, a file two places change. Twenty places at most a read, as the page's own. Filament's own reading, no model:
// what git and the archive say, in Filament's words. Whose files two lanes both change is git's to say (SG-D5): nothing
// here claims or holds a file.
import { fewAtOnce } from "../core/at-once.js";
import { momentWords, placeFacts, placeName } from "../core/space.js";

/** The most places one read reads, as the Space's files read (http/admin/spaces.js). */
export const LANES_MAX = 20;
/** The most changed files a lane's words name; the rest are counted. */
export const LANE_FILES = 12;

/**
 * A place's changed files as the Space's files read answers them (the page's `PlaceFiles`).
 * @typedef {{ path: string, ok: boolean, error: string | null, branch: string | null, base: string | null,
 *   ahead: number | null, commits: number, files: { path: string, committed: boolean, uncommitted: boolean }[], more: number }} PlaceFiles
 */

/**
 * A place's changed files as the owners panel reads them: each path once, committed on its branch and not yet on its
 * base, uncommitted, or both; with its branch, its base and how far ahead of it.
 * @param {import("../adapters/git/inspect.js").BranchPlace} b @param {string} path
 * @returns {PlaceFiles}
 */
export function placeFiles(b, path) {
  /** @type {Map<string, { path: string, committed: boolean, uncommitted: boolean }>} */
  const files = new Map();
  for (const f of b.files.committed?.files || []) files.set(f.path, { path: f.path, committed: true, uncommitted: false });
  for (const f of b.files.uncommitted?.files || []) {
    const was = files.get(f.path);
    files.set(f.path, { path: f.path, committed: !!was, uncommitted: true });
  }
  const more = (b.files.committed?.more || 0) + (b.files.uncommitted?.more || 0);
  const any = /** @type {any} */ (b);
  return { path, ok: b.ok, error: b.ok ? null : String(b.error || "git could not read it"), branch: b.branch, base: any.base ?? null, ahead: any.ahead ?? null, commits: b.commits.length + b.moreCommits, files: [...files.values()], more };
}

/**
 * A chat of a lane: `home`, its folder is there (else its agents wrote there); `working`, a turn of it runs now, a
 * sub-agent of it works or its coding agent's own agents do; `lastAt`, when it last moved; `routine`, a routine's run.
 * @typedef {{ id: string, name: string, home: boolean, working: boolean, lastAt: number | null, routine: boolean }} LaneChatRead
 */

/**
 * A lane as read: its place as git read it — or why not —, its chats, and what it changed (`files`: null where git did
 * not read it, `filesError` why).
 * @typedef {{ path: string, name: string, main: boolean, ok: boolean, missing: boolean, error: string | null,
 *   branch: string | null, base: string | null, facts: string | null, chats: LaneChatRead[],
 *   files: { path: string, committed: boolean, uncommitted: boolean }[] | null, more: number, filesError: string | null }} LaneRead
 */

/**
 * The project's lanes: `left`, the places past the twenty read; `shared`, each file two lanes or more change, with
 * their names.
 * @typedef {{ ok: true, folder: string, lanes: LaneRead[], left: number, shared: { path: string, lanes: string[] }[] }
 *   | { ok: false, error: string }} LanesRead
 */

/**
 * What the read reads. `folderOf`: a project's folder; `places`: the places of the repository a folder is in, read
 * whole (adapters/git/places.js), or why not; `chatsIn`: for each folder, the chats there as the asking chat's agent may
 * read them (memory `chatsIn`'s `readFor`); `filesOf`: a place's changed files, fenced as the page's files read;
 * `atWork`: the chats at work now; `lastAt`: when a chat last moved.
 * @typedef {{ folderOf: (project: string) => string | null,
 *   places: (folder: string) => Promise<{ ok: true, places: any[] } | { ok: false, error: string }>,
 *   chatsIn: (folders: string[], self: string | null) => Map<string, { id: string, name: string, home: boolean, routine?: string }[]>,
 *   filesOf: (path: string) => Promise<PlaceFiles>,
 *   atWork: () => Set<string>, lastAt: (chain: string) => number | null }} LanesDeps
 */

/** @param {LanesDeps} deps */
export function createSpaceLanes({ folderOf, places, chatsIn, filesOf, atWork, lastAt }) {
  return {
    /**
     * A project's lanes, read now for the agent of `self`, the asking chat: the main folder first, then those a chat
     * works in now, then the newest; a routine's run that ended after the person's own chats, as the page puts it.
     * @param {string} project @param {string | null} [self] @returns {Promise<LanesRead>}
     */
    async read(project, self = null) {
      const folder = folderOf(project);
      if (!folder) return { ok: false, error: "the project has no folder" };
      const read = await places(folder);
      if (!read.ok) return { ok: false, error: read.error };
      const homes = chatsIn(read.places.map((p) => p.path), self);
      const busy = atWork();
      const rank = (/** @type {LaneChatRead} */ c) => (c.working ? 0 : c.routine ? 2 : 1);
      const all = [];
      for (const p of read.places) {
        /** @type {LaneChatRead[]} */
        const chats = (homes.get(p.path) || [])
          .map((c) => ({ id: c.id, name: c.name || "an untitled chat", home: !!c.home, working: busy.has(c.id), lastAt: lastAt(c.id), routine: !!c.routine }))
          .sort((a, b) => rank(a) - rank(b) || (b.lastAt || 0) - (a.lastAt || 0));
        if (!p.main && !chats.length) continue;
        all.push({ p, chats });
      }
      const newest = (/** @type {typeof all[number]} */ x) => x.chats[0]?.lastAt || 0;
      const lead = (/** @type {typeof all[number]} */ x) => (x.chats[0] ? rank(x.chats[0]) : 3);
      all.sort((a, b) => Number(!!b.p.main) - Number(!!a.p.main) || lead(a) - lead(b) || newest(b) - newest(a));
      const shown = all.slice(0, LANES_MAX);
      const files = await fewAtOnce(shown, async ({ p }) => {
        if (p.missing || !p.ok) return null;
        try {
          return await filesOf(p.path);
        } catch (/** @type {any} */ e) {
          return { ok: false, error: String(e?.message || e) };
        }
      });
      /** @type {LaneRead[]} */
      const lanes = shown.map(({ p, chats }, i) => {
        const f = /** @type {any} */ (files[i]);
        return {
          path: p.path, name: placeName(p), main: !!p.main, ok: !!p.ok && !p.missing, missing: !!p.missing,
          error: p.missing ? "its folder is gone; git keeps its record" : p.ok ? null : String(p.error || "git could not read it"),
          branch: p.branch ?? null, base: p.base ?? null, facts: placeFacts(p), chats,
          files: f?.ok ? f.files : null, more: f?.ok ? Number(f.more) || 0 : 0, filesError: f && !f.ok ? String(f.error || "git could not read it") : null,
        };
      });
      /** @type {Map<string, string[]>} */
      const by = new Map();
      for (const l of lanes) for (const f of l.files || []) by.set(f.path, [...(by.get(f.path) || []), l.name]);
      const shared = [...by].filter(([, ls]) => ls.length > 1).map(([path, ls]) => ({ path, lanes: ls })).sort((a, b) => a.path.localeCompare(b.path));
      return { ok: true, folder, lanes, left: all.length - shown.length, shared };
    },
  };
}

/** @typedef {ReturnType<typeof createSpaceLanes>} SpaceLanes */

/** A file as a lane's words name it: its path, and committed, not committed, or both. @param {{ path: string, committed: boolean, uncommitted: boolean }} f */
const fileWords = (f) => `${f.path} (${f.committed && f.uncommitted ? "committed, and changed since" : f.committed ? "committed" : "not committed"})`;

/**
 * The lanes as the agent reads them: each place, its chats working or idle and since when — the asking chat named as
 * "you", any other with its id, by which a watcher's trigger names it; none for a routine's run, nor for a chat whose
 * words are its own alone (`apart`) —, what it changed, and the Overlaps last. A chat at work in two places is in both.
 * @param {LanesRead} read @param {{ self: string, now: number, apart?: (chain: string) => boolean }} o
 */
export function lanesWords(read, { self, now, apart }) {
  if (!read.ok) return `Not read: ${read.error}.`;
  const chat = (/** @type {LaneChatRead} */ c) =>
    `${c.name}${c.id === self ? " (you)" : c.routine || apart?.(c.id) ? "" : ` (chat:${c.id})`}${c.routine ? " (a routine's run)" : ""}${c.home ? "" : " (its agents wrote here)"} — ${c.working ? "working" : c.lastAt ? `idle since ${momentWords(c.lastAt)}` : "idle"}`;
  const lane = (/** @type {LaneRead} */ l) => {
    const head = `- ${l.main ? "the main folder" : l.name} · ${l.path}${l.branch && (l.main || l.branch !== l.name) ? `, on ${l.branch}` : ""}: ${l.error || l.facts || "read"}`;
    const files = l.files || [];
    // Those past the words' twelve, and those past what git lists of a place (`more`), counted.
    const unnamed = Math.max(0, files.length - LANE_FILES) + l.more;
    const changed = !l.ok ? []
      : l.filesError ? [`  changed: not read — ${l.filesError}`]
      : files.length ? [`  changed: ${files.slice(0, LANE_FILES).map(fileWords).join("; ")}${unnamed ? `; and ${unnamed} more` : ""}`]
      : ["  changed: nothing its base lacks"];
    return [head, `  chats: ${l.chats.length ? l.chats.map(chat).join("; ") : "none works here now"}`, ...changed];
  };
  const overlaps = read.shared.length
    ? [`Overlaps — files two lanes or more change: ${read.shared.slice(0, LANE_FILES).map((s) => `${s.path} (${s.lanes.join(", ")})`).join("; ")}${read.shared.length > LANE_FILES ? `; and ${read.shared.length - LANE_FILES} more` : ""}. Say so in the logbook before you change one of them.`]
    : ["No overlaps: no file is changed by two lanes."];
  return [
    `The lanes of this project, as of ${momentWords(now)}: ${read.lanes.length} lane${read.lanes.length === 1 ? "" : "s"} where its chats work, the main folder first.`,
    ...read.lanes.flatMap(lane),
    ...(read.left ? [`And ${read.left} more lane${read.left === 1 ? "" : "s"}, not read: one read reads ${LANES_MAX} at most.`] : []),
    ...overlaps,
  ].join("\n");
}

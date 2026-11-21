// @ts-check
// A change as a patch, for a reader beside the session (HarnessV4_Tasks E13-1, BW-5; E15 step 4, AG-81 and AG-82): a
// side agent asked to review what the main agent changed. Three sources have a name: what the turn running now has
// changed so far and what the last finished turn changed — its agents' own files, in every place they wrote in, read
// from the rounds a turn records (HarnessV4_Git_Plan step 1) — and everything uncommitted in the session's folder,
// read from git — the last two are what the Changes pane shows as Turn and as Branch's uncommitted files
// (ui/harness/panes/changes.js). The fourth is a range,
// `since:<ref>`: everything from a commit, tag or branch to the folder as it stands. Read only: nothing is staged,
// written or fetched.
import { changesSince, isRev, ownChangesOf } from "../../adapters/git/changes.js";
import { diffsOf, statusOf } from "../../adapters/git/inspect.js";
import { placeOf } from "../../adapters/git/snapshot.js";

/** The sources a view's `changes` takes by name. A range is the fourth: `since:<ref>` (`changeSource`). */
export const CHANGE_SOURCES = Object.freeze(/** @type {const} */ (["running", "turn", "uncommitted"]));
/** What a range opens with: `since:v1.2`. */
const SINCE = "since:";
/** A patch handed to a model stops here; the files past it are named. */
const PATCH_CHARS = 120_000;
/** The files whose patch is read, at most. */
const FILES_READ = 200;

/**
 * @typedef {object} ChangesView
 * @property {"running" | "turn" | "uncommitted" | "since"} source
 * @property {string} [ref]  a range's point, as it was named
 * @property {string} text  the patch, file after file; "" where there is none
 * @property {number} files  the files that changed
 * @property {number} shown  the files whose patch is in `text`
 * @property {number | null} turn  the turn whose changes they are (`running`, `turn`), else null
 * @property {string | null} note  why there is no patch, in words; null where there is one
 * @property {boolean} [refused]  a range's point is no commit of this repository: whoever named it is told `note`,
 *   and nothing is launched on it
 */

/**
 * A `changes` as a launch names it, checked before anything starts: one of the named sources, or a range whose point
 * is one word git could read as a commit (AG-81). Nothing named is no source.
 * @param {unknown} v
 * @returns {{ ok: true, source: string | null } | { ok: false, error: string }}
 */
export function changeSource(v) {
  const s = String(v ?? "").trim();
  if (!s) return { ok: true, source: null };
  if (CHANGE_SOURCES.includes(/** @type {any} */ (s))) return { ok: true, source: s };
  if (!s.startsWith(SINCE)) return { ok: false, error: `changes must be one of ${CHANGE_SOURCES.join(", ")}, or ${SINCE}<a commit, tag or branch>` };
  const ref = s.slice(SINCE.length);
  if (!ref) return { ok: false, error: `${SINCE} needs a commit, tag or branch after it, as in ${SINCE}v1.2` };
  return isRev(ref) ? { ok: true, source: s } : { ok: false, error: `\`${ref}\` is not a commit, tag or branch as git names one` };
}

/**
 * The patches that fit, in order: a file past the room is counted, not shown.
 * @param {{ path: string, patch: string }[]} files
 */
function fitted(files) {
  /** @type {string[]} */
  const parts = [];
  /** @type {string[]} */
  const named = [];
  let left = PATCH_CHARS;
  for (const f of files) {
    const p = String(f.patch || "").trimEnd();
    if (!p || p.length > left) {
      named.push(f.path);
      continue;
    }
    parts.push(p);
    left -= p.length;
  }
  if (named.length) parts.push(`(Filament: ${named.length} more changed file${named.length === 1 ? "" : "s"} not shown here — ${named.slice(0, 20).join(", ")}${named.length > 20 ? ", …" : ""}; read them where you need them.)`);
  return { text: parts.join("\n"), shown: files.length - named.length };
}

/** A file between two commits, as `fitted` takes it. @param {import("../../adapters/git/changes.js").FileChange} x */
const patchOf = (x) => ({ path: x.path, patch: x.binary ? `diff --git a/${x.path} b/${x.path}\nBinary file ${x.status}` : String(x.patch || "") });
/**
 * A turn's own file, as `fitted` takes it: one in a place other than the session's folder says which, ahead of its
 * patch, whose paths start at that place.
 * @param {import("../../adapters/git/changes.js").OwnFile} x @param {string | null} home  the folder's place
 */
const ownPatchOf = (x, home) => {
  const p = patchOf(x);
  return x.place === home ? p : { path: `${x.place}/${x.path}`, patch: `# in ${x.place}\n${p.patch}` };
};
/** @param {string[]} names */
const listed = (names) => `${names.slice(0, 20).join(", ")}${names.length > 20 ? ", …" : ""}`;

/**
 * @param {{ source: string, folder: string | null, turn: number, rounds: import("../../core/types.js").RoundChange[] | null, alone?: Set<string> | null }} o
 *   read only for a turn's source: `turn`, the turn the patch is of — the session's newest finished one (`turn`) or
 *   the one running now (`running`); 0 with none — `rounds`, what that turn's rounds recorded (null: none could
 *   be read), and `alone`, the places only the session works in, where what its commands changed is its own
 *   (HarnessV4_Git_Plan GW-D57)
 * @returns {Promise<ChangesView>}
 */
export async function changesView({ source, folder, turn, rounds, alone = null }) {
  const ref = String(source).startsWith(SINCE) ? String(source).slice(SINCE.length) : null;
  /** @type {ChangesView["source"]} */
  const src = ref != null ? "since" : source === "running" || source === "turn" ? source : "uncommitted";
  const ofTurn = src === "running" || src === "turn";
  /** @param {string} note @returns {ChangesView} */
  const none = (note) => ({ source: src, ...(ref != null ? { ref } : {}), text: "", files: 0, shown: 0, turn: ofTurn && turn ? turn : null, note });
  if (!folder) return none("the session names no folder to read changes from");
  if (ofTurn) {
    // A turn records each round that wrote as it ends: one that runs is read as far as its last such round.
    const now = src === "running";
    if (!turn) return none(now ? "no turn is running in the session now" : "the session has no finished turn yet");
    if (!rounds?.length)
      return none(now ? `turn ${turn}, running now, has recorded no change so far (it has written nothing in a round that ended, or snapshots are off)` : `turn ${turn} recorded no change (it wrote nothing, or snapshots are off)`);
    const out = await ownChangesOf(rounds, { patch: true, alone });
    if (!out.files.length && out.errors.length) return none(out.errors.map((e) => `${e.place}: ${e.error}`).join("; "));
    if (!out.files.length) return none(now ? `turn ${turn} has changed no files of its own so far` : `turn ${turn} changed no files of its own`);
    const home = (await placeOf(folder)).place;
    const f = fitted(out.files.map((x) => ownPatchOf(x, home)));
    // What its commands changed in a folder only it works in is shown as its, and named; what else changed while its
    // commands ran, and its files outside any repository, are named: never shown as its.
    const ran = out.files.filter((x) => x.via === "command");
    const also = [
      ...(ran.length ? [`(Filament: ${ran.length} of these changed through its commands, not its edit calls, in a folder only this session works in: ${listed(ran.map((x) => x.path))}.)`] : []),
      ...(out.during.length ? [`(Filament: ${out.during.length} more file${out.during.length === 1 ? "" : "s"} changed while its commands ran — by them or by someone else, Filament cannot tell: ${listed(out.during.map((d) => d.path))}.)`] : []),
      ...(out.outside.length ? [`(Filament: it also wrote outside any repository, so with no diff: ${listed(out.outside.map((o) => o.path))}.)`] : []),
    ];
    return { source: src, text: [f.text, ...also].join("\n"), files: out.files.length, shown: f.shown, turn, note: null };
  }
  // A new folder's files each by its own name: a patch is read of each.
  const st = await statusOf(folder, { eachFile: true });
  if (!st.ok || !st.repo) return none(String(st.error || "git could not read the folder"));
  // The status names each file from the repository's top, which a session's folder may sit below.
  const top = st.repo;
  const loose = (st.files || []).filter((f) => f.kind !== "ignored");
  if (ref != null) {
    const out = await changesSince(folder, ref, { patch: true });
    if (!out.ok) return { ...none(out.error), ...(out.unknown ? { refused: true } : {}) };
    // A file git does not track yet was made after any commit: it is part of the range, read as an addition.
    const fresh = loose.filter((f) => f.kind === "untracked");
    const patches = out.files.map(patchOf);
    const read = await diffsOf(top, fresh.slice(0, FILES_READ).map((f) => ({ path: f.path, untracked: true })));
    read.forEach((d, i) => patches.push({ path: fresh[i].path, patch: d.patch }));
    for (const f of fresh.slice(FILES_READ)) patches.push({ path: f.path, patch: "" });
    if (!patches.length) return none(`nothing has changed since \`${ref}\``);
    const fit = fitted(patches);
    return { source: src, ref, text: fit.text, files: patches.length, shown: fit.shown, turn: null, note: null };
  }
  if (!loose.length) return none("nothing is uncommitted in the session's folder");
  // Each file against HEAD, what is staged and what is not as one diff (HarnessV4_Git_Plan GW-D30), the files read
  // together (`diffsOf`); one the status names untracked is read from the working tree at once.
  const read = await diffsOf(top, loose.slice(0, FILES_READ).map((f) => ({ path: f.path, oldPath: f.oldPath, untracked: f.kind === "untracked" })));
  /** @type {{ path: string, patch: string }[]} */
  const patches = read.map((d, i) => ({ path: loose[i].path, patch: d.patch }));
  for (const f of loose.slice(FILES_READ)) patches.push({ path: f.path, patch: "" });
  const out = fitted(patches);
  return { source: src, text: out.text, files: loose.length, shown: out.shown, turn: null, note: null };
}

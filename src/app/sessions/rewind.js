// @ts-check
// Rewind in place (the owner's word of 10-27; the Designer's design): a chat goes back to before one of the person's
// messages — its files, its conversation, or both — as Claude Code's /rewind does, and nothing is lost. The turns stay
// in the archive, out of every request, folded into one line that opens as a fork (memory's `markRewound`, D11); the
// files as they stood are a snapshot, and Undo puts both back until the next message is sent.
//
// The files: each one the chat's agents changed from that turn on goes back to how it was just before the first of
// those turns changed it (the round's starting snapshot, turn-tree.js) — what Claude Code's checkpoints keep. A file
// that changed while a command ran in a place other chats work in too is no one's for sure: left as it is, and said so
// (changes.js `during`); one outside any repository has no snapshot to come back from. Before anything moves, each
// place is snapshotted under a ref and every file's old content is read: a write that fails then puts back what had
// moved, and the answer says nothing did.
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ownChangesOf } from "../../adapters/git/changes.js";
import { OWN_CONFIG, baseEnv, git, gitProgram, snapshotTree } from "../../adapters/git/snapshot.js";
import { execFileOffThread } from "../../adapters/git/spawn-pool.js";
import { linkInTheWay } from "../../adapters/git/worktree.js";

/** What a rewind takes back: the files and the conversation, the conversation alone, or the files alone. */
export const REWIND_WAYS = Object.freeze(/** @type {const} */ (["both", "conversation", "files"]));

/** The files one git call names at most, under Windows' command-line limit. */
const PATHS_PER_CALL = 100;

/**
 * @typedef {import("../../core/types.js").RoundChange} RoundChange
 * @typedef {{ mode: string, type: string, sha: string }} Entry  a path's entry in a commit
 * @typedef {"changed" | "deleted" | "restored" | "renamed"} RewindKind  changed back; deleted, new since; brought back,
 *   deleted since; renamed back
 * @typedef {{ place: string, path: string, oldPath: string | null, from: string | null, kind: RewindKind, also: boolean, paths: string[] }} RewindFile
 *   a file the rewind puts back: `from`, the snapshot it comes back from (null: the empty tree); `also`, someone else
 *   changed it too, between the turns' changes or since, and that goes with them; `paths`, what is written or removed
 * @typedef {{ files: RewindFile[], left: { place: string, path: string, turn: number | null }[], outside: string[],
 *   cannot: { place: string, path: string, why: string }[], errors: { place: string, error: string }[] }} FilesPlan
 * @typedef {{ place: string, path: string, eol?: "crlf" | "lf" | null }} Spot  a file a rewind wrote or removed, as git
 *   names it in its place; `eol`, the line endings it had before (`eolOf`)
 */

/**
 * The rounds a rewind to before turn `from` takes back: those of every turn from it on, a rewound one's too — its
 * files stayed where only its conversation went — but never the chat's moves (GW-D88).
 * @param {readonly RoundChange[]} rounds  the chain's, each with its `turn` @param {number} from
 */
export const roundsFrom = (rounds, from) => rounds.filter((r) => Number(r.turn) >= from && r.base !== "move");

/** @param {string} s */
const firstLine = (s) => String(s || "").split(/\r?\n/)[0].slice(0, 200);

/**
 * Each path's entry in a commit, where it has one (`commit` null: the empty tree, which has none).
 * @param {string} place @param {string | null} commit @param {readonly string[]} paths
 * @returns {Promise<{ ok: true, entries: Map<string, Entry> } | { ok: false, error: string }>}
 */
async function entriesAt(place, commit, paths) {
  /** @type {Map<string, Entry>} */
  const entries = new Map();
  if (!commit || !paths.length) return { ok: true, entries };
  for (let i = 0; i < paths.length; i += PATHS_PER_CALL) {
    const r = await git(["ls-tree", "-z", "--full-tree", commit, "--", ...paths.slice(i, i + PATHS_PER_CALL)], { cwd: place });
    if (r.code !== 0) return { ok: false, error: firstLine(r.err || r.error || `git ls-tree exited ${r.code}`) };
    for (const rec of r.out.split("\0")) {
      const m = /^(\d{6}) (\w+) ([0-9a-f]+)\t([\s\S]+)$/.exec(rec);
      if (m) entries.set(m[4], { mode: m[1], type: m[2], sha: m[3] });
    }
  }
  return { ok: true, entries };
}

/**
 * One `git cat-file` of a commit's file, its bytes whole, its process — the git `gitProgram` finds — started on a
 * thread of the spawn pool: a rewind reads two a file, and a few hundred starts on the server's thread would hold every
 * request.
 * @param {string} place @param {string[]} args
 * @returns {Promise<{ ok: true, data: Buffer } | { ok: false, error: string }>}
 */
async function catFile(place, args) {
  const program = await gitProgram();
  const { failure: e, stdout, stderr } = await execFileOffThread(
    program.file,
    [...OWN_CONFIG, "cat-file", ...args],
    { cwd: place, env: program.env(baseEnv()), encoding: /** @type {const} */ ("buffer"), maxBuffer: 512 * 1024 * 1024, windowsHide: true, timeout: 60_000 },
  );
  return e ? { ok: false, error: firstLine(stderr.toString("utf8") || e.message) } : { ok: true, data: stdout };
}

/** A file's line endings on disk: "crlf" where it has any CRLF, "lf" where it has none; null where it is not there. @param {string} abs */
export function eolOf(abs) {
  try {
    return readFileSync(abs).includes("\r\n") ? "crlf" : "lf";
  } catch {
    return null;
  }
}

/**
 * A file's content in a commit as it stood on disk. A snapshot stores a file as the repository's filters clean it, so
 * where they change only its line endings (`core.autocrlf`, `eol` attributes) the bytes it had are not kept: the file
 * gets back the endings it had (`eol`, read from disk), else those a checkout gives it. Any other filter (LFS) gives
 * what a checkout writes; none gives the bytes as stored.
 * @param {string} place @param {string} commit @param {Entry} entry @param {string} path @param {"crlf" | "lf" | null} eol
 * @returns {Promise<{ ok: true, data: Buffer } | { ok: false, error: string }>}
 */
async function contentAt(place, commit, entry, path, eol) {
  const [raw, out] = await Promise.all([catFile(place, ["blob", entry.sha]), catFile(place, ["--filters", `${commit}:${path}`])]);
  if (!raw.ok) return raw;
  if (!out.ok || raw.data.equals(out.data)) return raw;
  const endingsOnly = out.data.toString("latin1").replace(/\r\n/g, "\n") === raw.data.toString("latin1");
  return endingsOnly && eol === "lf" ? raw : out;
}

/** An entry a rewind writes as a file: a link or a submodule it leaves to the person. @param {Entry | null | undefined} e */
const plainFile = (e) => !e || (e.type === "blob" && (e.mode === "100644" || e.mode === "100755"));
/**
 * Why a file is left where a link on disk stands in the way of its write (worktree.js `linkInTheWay`): git reads
 * through some — a junction on Windows — and the write would land wherever it points.
 */
const LINKED = Object.freeze({ here: "a link, which Filament leaves to you", out: "a folder on its way is a link out of the project, which Filament leaves to you" });
/** @param {Entry | null | undefined} a @param {Entry | null | undefined} b */
const same = (a, b) => (!a && !b) || (!!a && !!b && a.sha === b.sha && a.mode === b.mode);

/**
 * What a rewind to before a turn does to the files, read now: from that turn's rounds on (`roundsFrom`), each agent's
 * own file back to before its first change there; what changed while commands ran, in a place others work in too,
 * left (`left`); what was written outside any repository, which no snapshot holds (`outside`); a link — in git's
 * entries, or on disk in the way of its write —, a submodule, or a place whose rounds started from its last commit
 * rather than a snapshot — Filament cannot tell how it was — listed as not put back (`cannot`). A file already as it
 * was is in none of them.
 * @param {readonly RoundChange[]} rounds  the rounds to take back, in the order taken
 * @param {{ alone?: Set<string> | null }} [o]  the places only this chat works in (GW-D57)
 * @returns {Promise<FilesPlan>}
 */
export async function planFiles(rounds, { alone = null } = {}) {
  const own = await ownChangesOf(/** @type {RoundChange[]} */ ([...rounds]), { alone });
  /** @type {FilesPlan} */
  const plan = {
    files: [],
    left: own.during.map((f) => ({ place: f.place, path: f.path, turn: f.turn ?? null })),
    outside: [...new Set(own.outside.map((o) => o.path))],
    cannot: [],
    errors: [...own.errors],
  };
  const fromHead = new Set(own.places.filter((p) => p.start === "head").map((p) => p.place));
  /** @type {Map<string, typeof own.files>} */
  const byPlace = new Map();
  for (const f of own.files) byPlace.set(f.place, [...(byPlace.get(f.place) || []), f]);
  for (const [place, files] of byPlace) {
    if (fromHead.has(place)) {
      for (const f of files) plan.cannot.push({ place, path: f.path, why: "no snapshot from before the turn: Filament cannot tell how it was" });
      continue;
    }
    const now = await snapshotTree(place, { name: "rewind-look", message: "Filament: the files as a rewind looks at them", keep: false });
    if (!now.ok || !now.at) {
      plan.errors.push({ place, error: now.error || "git could not read the folder as it stands" });
      continue;
    }
    const paths = [...new Set(files.flatMap((f) => [f.path, ...(f.oldPath ? [f.oldPath] : [])]))];
    const lastAfter = rounds.filter((r) => r.place === place && r.after).at(-1)?.after || null;
    const [nowE, lastE] = await Promise.all([entriesAt(place, now.at, paths), entriesAt(place, lastAfter, paths)]);
    if (!nowE.ok || !lastE.ok) {
      plan.errors.push({ place, error: (!nowE.ok && nowE.error) || (!lastE.ok && lastE.error) || "git could not list the files" });
      continue;
    }
    /** Each snapshot's entries, read once. @type {Map<string, Map<string, Entry>>} */
    const fromE = new Map();
    for (const f of files) {
      const key = f.from || "";
      if (!fromE.has(key)) {
        const r = await entriesAt(place, f.from, files.filter((x) => (x.from || "") === key).flatMap((x) => [x.path, ...(x.oldPath ? [x.oldPath] : [])]));
        if (!r.ok) {
          plan.errors.push({ place, error: r.error });
          fromE.set(key, new Map());
          continue;
        }
        fromE.set(key, r.entries);
      }
      const was = /** @type {Map<string, Entry>} */ (fromE.get(key));
      const renamed = !!f.oldPath && f.oldPath !== f.path;
      const spots = renamed ? [/** @type {string} */ (f.oldPath), f.path] : [f.path];
      if (spots.every((p) => same(was.get(p), nowE.entries.get(p)))) continue;
      if (spots.some((p) => !plainFile(was.get(p)) || !plainFile(nowE.entries.get(p)))) {
        plan.cannot.push({ place, path: f.path, why: "a link or a submodule, which Filament leaves to you" });
        continue;
      }
      const linked = spots.map((p) => linkInTheWay(place, join(place, p))).find(Boolean);
      if (linked) {
        plan.cannot.push({ place, path: f.path, why: LINKED[linked] });
        continue;
      }
      const kind = renamed && was.get(/** @type {string} */ (f.oldPath)) && !was.get(f.path) ? "renamed" : !was.get(f.path) ? "deleted" : !nowE.entries.get(f.path) ? "restored" : "changed";
      const since = !!lastAfter && spots.some((p) => !same(lastE.entries.get(p), nowE.entries.get(p)));
      plan.files.push({ place, path: f.path, oldPath: renamed ? f.oldPath : null, from: f.from, kind, also: !!f.also || since, paths: spots });
    }
  }
  return plan;
}

/**
 * The spots put as they are in each place's commit — read first, every one, then written or removed. One a link on
 * disk stands in the way of (`LINKED`) stops them all before anything moves: its write would land where the link
 * points. Where a write fails, what had moved is put back as `undo` holds it, and the answer says so. A spot's `eol` is
 * the line endings it gets back where the snapshot kept none (`contentAt`); left out, those it has on disk now.
 * @param {readonly (Spot & { commit: string | null })[]} spots
 * @param {Map<string, string> | null} undo  each place's commit as it stood before, to go back to on a failure
 * @returns {Promise<{ ok: true, moved: Spot[] } | { ok: false, error: string }>}  `moved`: each spot with the endings it had
 */
async function putAs(spots, undo) {
  /** @type {{ place: string, path: string, abs: string, data: Buffer | null, exec: boolean, eol: "crlf" | "lf" | null }[]} */
  const writes = [];
  for (const s of spots) {
    const abs = join(s.place, s.path);
    const linked = linkInTheWay(s.place, abs);
    if (linked) return { ok: false, error: `${s.path}: ${LINKED[linked]}` };
    const eol = s.eol !== undefined ? s.eol : eolOf(abs);
    const e = await entriesAt(s.place, s.commit, [s.path]);
    if (!e.ok) return { ok: false, error: `${s.path} could not be read as it was (${e.error})` };
    const entry = e.entries.get(s.path) || null;
    if (!entry) {
      writes.push({ place: s.place, path: s.path, abs, data: null, exec: false, eol: eolOf(abs) });
      continue;
    }
    const c = await contentAt(s.place, /** @type {string} */ (s.commit), entry, s.path, eol);
    if (!c.ok) return { ok: false, error: `${s.path} could not be read as it was (${c.error})` };
    writes.push({ place: s.place, path: s.path, abs, data: c.data, exec: entry.mode === "100755", eol: eolOf(abs) });
  }
  /** @type {typeof writes} */
  const done = [];
  for (const w of writes) {
    try {
      if (w.data == null) {
        if (existsSync(w.abs) && !lstatSync(w.abs).isDirectory()) rmSync(w.abs, { force: true });
      } else {
        mkdirSync(dirname(w.abs), { recursive: true });
        writeFileSync(w.abs, w.data);
        if (w.exec && process.platform !== "win32") chmodSync(w.abs, 0o755);
      }
      done.push(w);
    } catch (/** @type {any} */ e) {
      const why = `${w.path} could not be ${w.data == null ? "removed" : "written"} (${firstLine(e?.message || String(e))})`;
      if (!done.length) return { ok: false, error: `Nothing moved: ${why}` };
      if (!undo) return { ok: false, error: `${why}; ${done.length} file(s) had moved before it: ${done.map((d) => d.path).join(", ")}` };
      const back = await putAs(done.map((d) => ({ place: d.place, path: d.path, commit: undo.get(d.place) || null, eol: d.eol })), null);
      return { ok: false, error: back.ok ? `Nothing moved: ${why}, and the ${done.length} put back before it are as they were` : `${why}; ${done.length} file(s) had moved, and putting them back failed too: ${back.error}` };
    }
  }
  return { ok: true, moved: done.map((d) => ({ place: d.place, path: d.path, eol: d.eol })) };
}

/**
 * Put a plan's files back: each place snapshotted first under its own ref (`ref`, a name under the snapshots' prefix:
 * what Undo comes back to), then every file as it was.
 * @param {FilesPlan} plan @param {{ name: string }} o
 * @returns {Promise<{ ok: true, places: { place: string, pre: string }[], spots: Spot[] } | { ok: false, error: string }>}
 */
export async function putBack(plan, { name }) {
  /** @type {Map<string, string>} */
  const pre = new Map();
  for (const place of new Set(plan.files.map((f) => f.place))) {
    const s = await snapshotTree(place, { name, message: "Filament: the files as they stood before a rewind", keep: true });
    if (!s.ok || !s.at) return { ok: false, error: `Nothing moved: the folder ${place} could not be snapshotted first (${s.error || "unknown"})` };
    pre.set(place, s.at);
  }
  const spots = plan.files.flatMap((f) => f.paths.map((path) => ({ place: f.place, path, commit: f.from })));
  const r = await putAs(spots, pre);
  if (!r.ok) return r;
  return { ok: true, places: [...pre].map(([place, at]) => ({ place, pre: at })), spots: r.moved };
}

/**
 * Undo a rewind's files: each spot it wrote or removed as the snapshot taken before it holds it.
 * @param {readonly Spot[]} spots @param {readonly { place: string, pre: string }[]} places
 */
export function putForward(spots, places) {
  const pre = new Map(places.map((p) => [p.place, p.pre]));
  return putAs(spots.map((s) => ({ ...s, commit: pre.get(s.place) || null })), null);
}

/** The words for each kind, as the confirm and the note say them. @type {Record<RewindKind, string>} */
export const KIND_WORDS = Object.freeze({ changed: "changed back", deleted: "deleted — new since", restored: "brought back — deleted since", renamed: "renamed back" });

/**
 * The line that rides the chat's next message after a rewind that took one side back and left the other (the
 * Designer's design): the agent's view of the files, or of its own turns, is no longer what stands. Null for a rewind
 * of both, or of files where none moved.
 * @param {{ what: string, turn: number, to?: number | null, spots?: readonly Spot[], kept?: readonly string[] }} o
 * @returns {string | null}
 */
export function rewindNote({ what, turn, to = null, spots = [], kept = [] }) {
  const names = (/** @type {readonly string[]} */ list) => {
    const u = [...new Set(list)];
    return u.length > 12 ? `${u.slice(0, 12).join(", ")} and ${u.length - 12} more` : u.join(", ");
  };
  if (what === "files" && spots.length)
    return `[Filament: the person put the files back to how they were before their message of turn ${turn}; the conversation still holds those turns, but what they changed in these files is undone: ${names(spots.map((s) => s.path))}. Read a file again before you rely on what you knew of it.]`;
  if (what === "conversation") {
    const span = to != null && to !== turn ? `turns ${turn}–${to} are` : `turn ${turn} is`;
    return `[Filament: the person rewound the conversation to before their message of turn ${turn}: ${span} out of it. The files ${kept.length ? `those turns changed were kept as they are: ${names(kept)}` : "were kept as they are"}. Read a file again before you rely on it.]`;
  }
  return null;
}

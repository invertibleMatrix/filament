// @ts-check
// Where a sub-agent works (the owner's plan of 11-09 for big repos): none of its own (it only reads), the session's
// folder, a patch workspace (adapters/git/patch.js — no checkout: an overlay of the files it reads and writes, moved to a
// worktree once it needs one) or a worktree. One pure function, the first rule that matches wins; the registry reads the
// launch, the chat's setting and the project, and calls it once a launch.

/** The chat's setting `subagents.workspace`: Auto, Patch, Worktree, Session folder. */
export const WORKSPACES = Object.freeze(["auto", "patch", "worktree", "folder"]);
/** A card whose last `MOVED_LAUNCHES` launches in a repository each moved to a worktree within `MOVED_WITHIN` calls starts in one. */
export const MOVED_LAUNCHES = 3;
export const MOVED_WITHIN = 5;

/**
 * The chat's setting, read: `subagents.workspace` where it names one, else the older `subagents.worktree` — off is the
 * session's folder, on (or unsaid) is Auto.
 * @param {{ workspace?: unknown, worktree?: unknown } | null | undefined} sub
 * @returns {"auto" | "patch" | "worktree" | "folder"}
 */
export function workspaceSetting(sub) {
  const w = String(sub?.workspace ?? "");
  if (/** @type {readonly string[]} */ (WORKSPACES).includes(w)) return /** @type {any} */ (w);
  return sub?.worktree === false ? "folder" : "auto";
}

/**
 * @typedef {object} WorkspaceAsk
 * @property {"read" | "copy" | "edit"} may  what it may do, as its launch resolved it
 * @property {boolean} [inFolder]  the launch, or the developer, gave it the session's folder
 * @property {"auto" | "patch" | "worktree" | "folder"} setting  the chat's (`workspaceSetting`), or the launch's own
 * @property {"loop" | "acp"} engine  Filament's loop, or a coding agent
 * @property {boolean} [noRepo]  the folder is in no repository, or one with no commit yet
 * @property {boolean} [checked]  a worker or a graph task with a check, or a brief or card that names commands
 * @property {boolean} [attempt]  one of several attempts at one brief
 * @property {boolean} [hooks]  the session has hooks on write, edit or read
 * @property {boolean} [localMcp]  it has MCP servers that run on this computer, started in its folder at its first step
 * @property {readonly (number | null)[]} [moves]  its card's newest launches in this repository, newest last: how many
 *   calls each made before it moved to a worktree, null where it never did
 */

/**
 * Where it works, and by which rule (1–11, as the owner's plan numbers them) — the words say why, for the record.
 * @param {WorkspaceAsk} a
 * @returns {{ kind: "none" | "folder" | "patch" | "worktree", rule: number, why: string }}
 */
export function workspaceKind(a) {
  if (a.may === "read") return { kind: "none", rule: 1, why: "it only reads" };
  if (a.inFolder || (a.setting === "folder" && a.may === "edit")) return { kind: "folder", rule: 2, why: "it was given the session's folder" };
  if (a.noRepo) return { kind: "folder", rule: 3, why: "the folder has no repository with a commit to copy" };
  if (a.engine === "acp") return { kind: "worktree", rule: 5, why: "a coding agent runs its own tools in a checkout" };
  // A patch moves by renaming its folder aside, which servers started in it hold on Windows: it could never move.
  if (a.localMcp) return { kind: "worktree", rule: 5, why: "its MCP servers run on this computer, in its folder from its first step" };
  if (a.setting === "patch" || a.setting === "worktree") return { kind: a.setting, rule: 4, why: `the chat's setting says ${a.setting}` };
  if (a.may === "copy") return { kind: "worktree", rule: 6, why: "it runs in a copy that keeps nothing" };
  if (a.checked) return { kind: "worktree", rule: 7, why: "it runs commands: a check, or its brief's" };
  if (a.attempt) return { kind: "worktree", rule: 8, why: "one of several attempts" };
  if (a.hooks) return { kind: "worktree", rule: 9, why: "the session has hooks on its file tools" };
  const last = (a.moves || []).slice(-MOVED_LAUNCHES);
  if (last.length === MOVED_LAUNCHES && last.every((n) => n != null && n <= MOVED_WITHIN)) return { kind: "worktree", rule: 10, why: `its card's last ${MOVED_LAUNCHES} launches here each moved to a worktree within ${MOVED_WITHIN} calls` };
  return { kind: "patch", rule: 11, why: "a builder on Filament's loop" };
}

/**
 * @typedef {object} CopyAsk
 * @property {"auto" | "patch" | "worktree" | "folder"} setting  the chat's (`workspaceSetting`), or the launch's own
 * @property {"read" | "copy" | "edit"} may  what it may do, as its launch resolved it
 * @property {"slow" | "entries" | "lfs" | null} [big]  why its repository is big (adapters/git/sparse.js `bigRepo`), or null
 * @property {boolean} [cow]  the drive its copies are on clones files (adapters/git/cow.js `cowSupport`)
 * @property {readonly string[]} [caches]  the build caches git ignores at the repository's top and in the session's
 *   folder (cow.js `buildCaches`)
 */

/**
 * Of which kind the worktree a sub-agent gets is made (the owner's plan of 11-09 for big repos) — at its launch, or as
 * its patch moves to one — the first rule that matches winning:
 * - the chat's, or the launch's, Worktree is a full checkout: never a sparse copy or a clone behind the person's choice;
 * - a clone where the drive clones files and git ignores build caches here (a Unity project's Library, a target or
 *   build folder): cloned, the folder comes whole and its caches warm, at almost no disk cost — a build, a check or the
 *   app run from the copy starts from them, where a checkout starts cold. Without such caches a clone keeps nothing a
 *   checkout lacks. It beats sparse where both apply: the clone writes no file's bytes, so all a sparse copy would
 *   spare is each file's bookkeeping, while it leaves the caches cold and every folder outside its cone a widen away;
 * - sparse for a builder in a big repository: its cone alone (worktree.js `coneFor`, every file where the cone is too
 *   wide). Never for one that runs in a copy, which runs the project — its app, its tests — and keeps nothing;
 * - else a full checkout.
 * @param {CopyAsk} a
 * @returns {{ kind: "worktree" | "clone" | "sparse", why: string }}
 */
export function copyKind(a) {
  if (a.setting === "worktree") return { kind: "worktree", why: "the chat's setting says worktree: every file checked out" };
  if (a.cow && a.caches?.length) return { kind: "clone", why: `the drive clones files, and git ignores ${a.caches.join(", ")} here: cloned, it comes warm` };
  if (a.big && a.may === "edit") return { kind: "sparse", why: `a builder in a big repository (${a.big}): its cone alone` };
  return { kind: "worktree", why: "every file checked out" };
}

/** The most paths a brief's words name for a copy's cone: past them, its words are prose. */
export const BRIEF_PATHS = 64;
/** A glob's characters: a write's pattern starts where its first segment holds one. */
const GLOB = /[*?[{]/;
/** A path as written in a list, up to the folder ahead of its first pattern; "" where it starts with one. @param {string} p */
const ahead = (p) => {
  const segs = p.replace(/\\/g, "/").replace(/^(\.\/)+/, "").split("/");
  const at = segs.findIndex((s) => GLOB.test(s));
  return (at < 0 ? segs : segs.slice(0, at)).join("/").replace(/\/+$/, "");
};
/** A brief's words as path-like tokens: quoting, brackets and list punctuation part them. */
const TOKENS = /[^\s`'"()[\]{}<>,;|]+/g;

/**
 * The paths a launch names, for a sparse copy's cone (worktree.js `coneFor`, which keeps the ones its commit has): a
 * graph task's writes, a glob by the folder ahead of its pattern; its brief's files, an entry with blanks naming none;
 * and the words of its brief that read as paths — a slash in them, no address or flag —, `BRIEF_PATHS` at most, a
 * line's number after one left out. Each once, as written: relative to the session's folder, or absolute.
 * @param {{ writes?: readonly string[], files?: readonly string[], brief?: string }} a
 * @returns {string[]}
 */
export function launchPaths({ writes = [], files = [], brief = "" }) {
  /** @type {Set<string>} */
  const out = new Set();
  for (const w of [...writes, ...files]) {
    const s = String(w || "").trim();
    if (!s || /\s/.test(s)) continue;
    const p = ahead(s);
    if (p) out.add(p);
  }
  let named = 0;
  for (const t of String(brief || "").match(TOKENS) || []) {
    if (named >= BRIEF_PATHS) break;
    if (!/[/\\]/.test(t) || t.includes("://") || t.startsWith("-") || t.startsWith("//")) continue;
    const p = ahead(t.replace(/#L\d+(?:-L?\d+)?$/, "").replace(/[.:!?]+$/, "").replace(/:\d+(?::\d+)?$/, ""));
    if (!p || out.has(p)) continue;
    out.add(p);
    named++;
  }
  return [...out];
}

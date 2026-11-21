// @ts-check
// Spaces of your own (HarnessV4_SpacesPlugins_Plan A1, A2; SP-D1 to D3): a Space that belongs to no project of the
// person's — Work, Personal — made as a project whose folder Filament makes for it (`Documents\Filament Spaces\<name>`,
// or one they pick), so it has what a project has: its own memory, its own settings layer (its connections and the
// account each signs in as), its Space, its chats. Deleting or archiving a project never touches it. What its chats may
// read besides its folder — its own folder, its folder and these, the whole computer — is its layer's
// `loop.addedFolders`, so Settings › Permissions and its sheet never disagree. Deleting one deletes its chats, memory,
// board, routines and accounts; its folder stays, with the person's files. The Space's record of itself is the Space's
// own (services/spaces.js `own`); the project's row is memory's.
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join } from "node:path";
import { ownName, reachOf, reachWidens, spaceFolderName } from "../core/space.js";
import { normalizeCwd, projectIdOf } from "../core/project-id.js";
import { projectFolderOf } from "../services/project-folder.js";
import { folderVerdict, newFolderRefusal, outsideRootsWords } from "./agent/turn.js";
import { loopbackHost } from "../services/config/store.js";

/** The folder the Spaces' own folders are made in, under the person's Documents. */
export const SPACES_FOLDER = "Filament Spaces";
/** How many folders "its folder and these" lists at most: the layer's own limit. */
export const THESE_MAX = 16;
/** What a Space's chats may read besides its folder. */
export const REACHES = Object.freeze(/** @type {const} */ (["folder", "these", "computer"]));

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * Every drive of this computer, as the folders "the whole computer" lists (A2): on Windows each lettered drive that is
 * there, else the root.
 * @param {{ platform?: string, exists?: (p: string) => boolean }} [o]
 * @returns {string[]}
 */
export function computerFolders({ platform = process.platform, exists = existsSync } = {}) {
  if (platform !== "win32") return ["/"];
  /** @type {string[]} */
  const out = [];
  for (let c = 67; c <= 90; c++) {
    const d = `${String.fromCharCode(c)}:\\`;
    try {
      if (exists(d)) out.push(d);
    } catch {}
  }
  return out;
}

/**
 * The person's Documents folder, where the Spaces' folders go: Documents under their home where it is there, else
 * their home. @param {string} [home] @returns {string}
 */
export function documentsFolder(home = homedir()) {
  const d = join(home, "Documents");
  return existsSync(d) ? d : home;
}

/**
 * What narrows the folders a Space of your own may read, in the New Space sheet's words (A2): agentLoop.roots, or a
 * listener open beyond this machine with no roots — each added folder is judged as a working folder is. "" when
 * nothing does.
 * @param {any} cfg
 */
export function reachLimits(cfg) {
  const roots = (Array.isArray(cfg?.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);
  if (roots.length) return `Filament's settings let agents work only under ${roots.join(", ")} (agentLoop.roots): a folder outside them is never read, whatever this says.`;
  if (!loopbackHost(cfg?.server?.host)) return "Filament listens beyond this machine and agentLoop.roots lists no folder: its chats read only their own folder until roots are listed.";
  return "";
}

/** Whether a folder lies in a git repository (A2c): the git adapter's, said here as the Space's routes read it. */
export { inRepo } from "../adapters/git/places.js";

/**
 * @typedef {{ project: string, name: string, folder: string, at: number, reach: "folder" | "these" | "computer",
 *   folders: string[], shows: string[] }} OwnSpaceRow
 */

/**
 * @param {{
 *   spaces: import("../services/spaces.js").SpaceStore,
 *   memory: any,
 *   config: { get: () => any },
 *   routines?: { arm: () => void } | null,
 *   taskNotes?: { drop: (chainId: string) => unknown } | null,
 *   home?: string,
 *   drives?: () => string[],
 *   log?: (level: string, msg: string) => void,
 * }} deps
 */
export function createOwnSpaces({ spaces, memory, config, routines = null, taskNotes = null, home = homedir(), drives = () => computerFolders(), log = () => {} }) {
  /** The archive, or the refusal that says a Space of your own needs memory. */
  const archive = () => {
    if (!memory?.archive) throw refused(503, `A Space of your own keeps its chats and memory in memory's archive, which is off: ${memory?.archiveWhy?.() || "memory is not running"}.`);
    return memory.archive;
  };

  /** The folders its layer lists for its chats to read. @param {string} project @returns {string[]} */
  const foldersOf = (project) => {
    const list = archive().projectSettings(project)?.loop?.addedFolders;
    return Array.isArray(list) ? list.map(String) : [];
  };

  /** @param {string} project @returns {OwnSpaceRow} */
  function rowOf(project) {
    const own = spaces.get(project).own;
    if (!own) throw refused(404, "That is no Space of your own.");
    const folders = foldersOf(project);
    return { project, name: own.name, folder: own.folder, at: own.at, reach: reachOf(folders, drives()), folders, shows: own.shows || [] };
  }

  /**
   * What its chats may read (A2) — none past its folder, these, every drive —, checked: the folders its layer lists.
   * @param {unknown} reach @param {unknown} folders @returns {string[]}
   */
  function reachList(reach, folders) {
    const r = reach == null ? "folder" : String(reach);
    if (!REACHES.includes(/** @type {any} */ (r))) throw refused(400, `What a Space may read is one of ${REACHES.join(", ")}.`);
    /** @type {string[]} */
    let list = [];
    if (r === "computer") list = drives();
    else if (r === "these") {
      list = [...new Set((Array.isArray(folders) ? folders : []).map((f) => String(f ?? "").trim()).filter(Boolean))];
      if (!list.length) throw refused(400, "Its folder and these: name at least one folder.");
      if (list.length > THESE_MAX) throw refused(400, `Its folder and these: ${THESE_MAX} folders at most.`);
      const bad = list.find((f) => !isAbsolute(f));
      if (bad) throw refused(400, `${bad} is no full path: give each folder from its drive.`);
    }
    return list;
  }

  /**
   * What its chats may read, written to its layer (A2). @param {string} project @param {string[]} list  `reachList`'s
   */
  function writeReach(project, list) {
    const out = list.length
      ? memory.patchProjectSettings(project, { patch: { loop: { addedFolders: list } } })
      : foldersOf(project).length
        ? memory.patchProjectSettings(project, { unset: ["loop.addedFolders"] })
        : { errors: [] };
    if (out.errors?.length) throw refused(400, out.errors.join("; "));
  }

  /**
   * The folder a new Space's files go in: the one picked, made where it is not there yet; else its name's under
   * Documents\Filament Spaces, numbered where that name is taken by a folder with files in it. Refused where it is a
   * project already, or where the agents may not work there (agentLoop.roots; a listener open beyond this machine).
   * @param {string} name @param {unknown} picked @returns {string}
   */
  function folderFor(name, picked) {
    let folder = String(picked ?? "").trim();
    if (folder) {
      if (!isAbsolute(folder)) throw refused(400, `${folder} is no full path: give the folder from its drive.`);
    } else {
      const base = join(documentsFolder(home), SPACES_FOLDER, spaceFolderName(name));
      folder = base;
      for (let n = 2; existsSync(folder) && !emptyDir(folder); n++) folder = `${base} ${n}`;
    }
    const no = newFolderRefusal(config.get(), folder);
    if (no) throw refused(400, `${no}: pick a folder there, or add one to agentLoop.roots.`);
    try {
      mkdirSync(folder, { recursive: true });
    } catch (/** @type {any} */ e) {
      throw refused(400, `${folder} could not be made: ${e?.message || e}`);
    }
    const real = realpathSync.native(folder);
    if (!statSync(real).isDirectory()) throw refused(400, `${folder} is not a folder.`);
    const v = folderVerdict(config.get(), real);
    if (!v.ok) throw refused(400, v.why === "exposed" ? "Filament listens beyond this machine and agentLoop.roots lists no folder, so no chat may work in a new folder." : outsideRootsWords(folder));
    const known = archive().getProject(projectIdOf(real));
    if (known) throw refused(409, spaces.get(known.id).own ? `${real} is the Space “${spaces.get(known.id).own?.name}” already.` : `${real} is the project “${known.name || known.id}” already: pick another folder.`);
    // A folder inside a repository's worktree is that repository's project (GW-D46): never made a Space of its own — and
    // refused before any project is made for it (found by the Hunter on A6: the repository's project was made first).
    const main = projectFolderOf(real);
    if (normalizeCwd(main) !== normalizeCwd(real)) {
      const repo = archive().getProject(projectIdOf(main));
      throw refused(409, `${real} belongs to the project “${repo?.name || basename(main)}”: pick a folder outside it.`);
    }
    return real;
  }

  return {
    /** Every Space of your own, oldest first. @returns {OwnSpaceRow[]} */
    list() {
      if (!memory?.archive) return [];
      return spaces
        .owns()
        .filter((o) => !!memory.archive.getProject(o.project))
        .map((o) => rowOf(o.project));
    },

    /**
     * A new Space of your own: its folder made, its project, its Space with its name, what it may read.
     * @param {{ name?: unknown, folder?: unknown, reach?: unknown, folders?: unknown }} b @returns {OwnSpaceRow}
     */
    make(b) {
      archive();
      const ok = ownName(b?.name);
      if (!ok.ok) throw refused(400, ok.error);
      // What it may read is checked before anything is made: a refusal leaves no Space behind, and the same press after
      // the fix makes it (found by the Hunter on A6: the Space stood, and the retry was a 409).
      const reach = reachList(b?.reach, b?.folders);
      const folder = folderFor(ok.name, b?.folder);
      const p = memory.createProject(folder);
      if (!p || p.error) throw refused(400, p?.error || "its project could not be made");
      memory.renameProject(p.id, ok.name);
      spaces.makeOwn(p.id, { name: ok.name, folder });
      try {
        writeReach(p.id, reach);
      } catch (e) {
        // Checked already: only the layer's own write failing lands here. The Space stands, reading its folder alone.
        log("warn", `spaces: “${ok.name}” was made, and what it may read stays its own folder (${/** @type {any} */ (e)?.message || e})`);
      }
      log("info", `spaces: the Space “${ok.name}” made (${p.id}, ${folder})`);
      return rowOf(p.id);
    },

    /**
     * A Space of your own changed: its name, what it may read. @param {string} project
     * @param {{ name?: unknown, reach?: unknown, folders?: unknown }} b @returns {OwnSpaceRow}
     */
    change(project, b) {
      archive();
      const row = rowOf(project);
      if (b?.name !== undefined) {
        const own = spaces.makeOwn(project, { name: /** @type {string} */ (b.name) });
        memory.renameProject(project, own.name);
      }
      if (b?.reach !== undefined) writeReach(project, reachList(b.reach, b.folders));
      return rowOf(row.project);
    },

    /**
     * Whether a change would have its chats read a folder they do not read now (core/space.js `reachWidens`): the
     * folders the reach it names would list, against those its layer lists. A press, weighed by the admin row
     * (http/admin/spaces.js; s-rows, 11-12). A change that names no reach, and one `change` refuses, widen nothing.
     * @param {string} project @param {{ reach?: unknown, folders?: unknown }} b
     */
    widens(project, b) {
      if (b?.reach === undefined) return false;
      /** @type {string[]} */
      let list;
      try {
        list = reachList(b.reach, b.folders);
      } catch {
        return false;
      }
      return reachWidens(list, foldersOf(project), { foldCase: process.platform === "win32" });
    },

    /**
     * A Space of your own deleted (A5's words for it): its chats, memory, board, routines and accounts go; its folder
     * stays, with the person's files. @param {string} project @returns {Promise<{ project: string, name: string, folder: string }>}
     */
    async remove(project) {
      const a = archive();
      const row = rowOf(project);
      // As Delete project does (http/admin/memory.js): what its chats kept behind their task graphs goes with them.
      const chains = taskNotes ? (a.chainsForProject?.(project, { limit: 1_000_000 }) || []).map((/** @type {any} */ c) => String(c.id)) : [];
      await memory.deleteProject(project);
      for (const id of chains) taskNotes?.drop(id);
      // Its project is gone now: a Space the store could not drop is paused at the next start, never run (A5).
      try {
        spaces.drop(project);
      } catch (/** @type {any} */ e) {
        log("warn", `spaces: the Space “${row.name}” could not be removed (${e?.message || e}); its project is gone, and it is paused at the next start`);
      }
      routines?.arm();
      log("info", `spaces: the Space “${row.name}” deleted (${project}); its folder ${row.folder} stays`);
      return { project, name: row.name, folder: row.folder };
    },
  };
}

/** Whether a folder holds nothing. @param {string} dir */
function emptyDir(dir) {
  try {
    return readdirSync(dir).length === 0;
  } catch {
    return false;
  }
}

/** @typedef {ReturnType<typeof createOwnSpaces>} OwnSpaces */

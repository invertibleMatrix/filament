// @ts-check
// Everything (the owner's of 10-30): where a chat that works outside any project of the person's runs. A chat set to
// "Work outside a project" asked for a folder at its first send; it works in one folder of Filament's own instead,
// `<data folder>/Everything`, made the first time a chat needs it, and registered as a project named Everything, so its
// chats stand together under Projects, as a project's do.
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { normalizeCwd } from "../core/project-id.js";
import { projectFolderOf } from "../services/project-folder.js";
import { folderVerdict, newFolderRefusal, outsideRootsWords } from "./agent/turn.js";

/** The folder's name under the data folder, and its project's. */
export const EVERYTHING = "Everything";

/** @param {number} status @param {string} message */
const refused = (status, message) => Object.assign(new Error(message), { status });

/**
 * @typedef {{ ensure: () => { cwd: string, project: string, name: string },
 *   where: () => { cwd: string, made: boolean, refused: string | null, status: number | null } }} Everything
 */

/**
 * @param {{ dataDir: string, memory: any, config: { get: () => any } }} deps
 * @returns {Everything}
 */
export function createEverything({ dataDir, memory, config }) {
  /**
   * Why no chat may work in the folder once made, as `ensure` refuses it after making it, with its status: the folder
   * `folderVerdict` refuses, or one in a repository (`inRepository`) — null where one may.
   * @param {string} real  the folder as the disk has it
   * @returns {{ status: number, words: string } | null}
   */
  const madeRefusal = (real) => {
    const v = folderVerdict(config.get(), real);
    if (!v.ok) return { status: 400, words: v.why === "exposed" ? "Filament listens beyond this machine and agentLoop.roots lists no folder, so no chat may work in a folder of its own: pick a project folder" : outsideRootsWords(real) };
    return inRepository(real);
  };
  /**
   * The folder lies in a linked worktree of a repository, whose project it would be (GW-D46), in words — null where
   * it is its own. Read from git's files alone: a folder not made yet is judged where it will be.
   * @param {string} real
   * @returns {{ status: number, words: string } | null}
   */
  const inRepository = (real) =>
    normalizeCwd(projectFolderOf(real)) !== normalizeCwd(real) ? { status: 409, words: `${real} lies inside a repository, whose project it would be: pick a project folder for this chat` } : null;
  return {
    /**
     * The folder and its project, made where they are not there yet. Refused in words where no chat may work there
     * (agentLoop.roots; a listener open beyond this machine), or where the data folder lies in a repository, whose
     * project the folder would be.
     */
    ensure() {
      if (!memory?.archive) throw refused(503, "a chat outside a project needs memory's archive, which is off");
      const folder = join(dataDir, EVERYTHING);
      const no = newFolderRefusal(config.get(), folder);
      if (no) throw refused(400, `${no}: add it to agentLoop.roots, or pick a project folder for this chat`);
      try {
        mkdirSync(folder, { recursive: true });
      } catch (/** @type {any} */ e) {
        throw refused(500, `${folder} could not be made: ${e?.message || e}`);
      }
      const real = realpathSync.native(folder);
      const after = madeRefusal(real);
      if (after) throw refused(after.status, after.words);
      const p = memory.createProject(real);
      if (!p || p.error) throw refused(400, p?.error || "its project could not be made");
      if (p.name !== EVERYTHING) memory.renameProject(p.id, EVERYTHING);
      return { cwd: real, project: String(p.id), name: EVERYTHING };
    },
    /**
     * Where a chat outside a project would work, nothing made (the Start board weighs it before the first send): the
     * folder as the disk has it once made, else where the make will put it — in the data folder as the disk has it —,
     * and why no chat may work there in `ensure`'s words and status, null where one may: a folder made is judged as
     * `ensure` judges it after making it; one not made yet, for the roots and the repository it would lie in.
     */
    where() {
      const folder = join(dataDir, EVERYTHING);
      const no = newFolderRefusal(config.get(), folder);
      if (no) return { cwd: folder, made: false, refused: `${no}: add it to agentLoop.roots, or pick a project folder for this chat`, status: 400 };
      let real = "";
      try {
        real = realpathSync.native(folder);
      } catch {}
      let base = dataDir;
      if (!real) {
        try {
          base = realpathSync.native(dataDir);
        } catch {}
      }
      const cwd = real || join(base, EVERYTHING);
      const why = real ? madeRefusal(real) : inRepository(cwd);
      return { cwd, made: !!real, refused: why?.words ?? null, status: why?.status ?? null };
    },
  };
}

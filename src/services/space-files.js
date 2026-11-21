// @ts-check
// The files the person attaches to a Space's tasks (the owner's of 11-02: "i should be able to attach files and pictures
// in the task to store information that i want"): their bytes on disk, one folder a project, `<dir>/<project>/<id>`,
// each written whole — a temporary file, then a rename. The Space's file says which task holds which (core/space.js
// `SpaceFile`), so a deleted Space brought back has its files again; what no Space holds any more — its task removed,
// by the person or an agent, its Space gone past its 30 days — goes at the next sweep (server.js: at the start, then
// as the deleted Spaces are pruned).
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { imageTypeOf } from "../core/media.js";
import { SPACE_FILE_ID, spaceable } from "../core/space.js";

/** How old a file no Space holds must be before a sweep takes it: one being attached is written before its task holds it. */
export const SWEEP_AFTER_MS = 3_600_000;

/**
 * What a file is, by its first bytes: a picture of a type a page shows, a PDF, text — no zero byte in its first 8 KB
 * and UTF-8 throughout —, or any other file; and the type it is served as.
 * @param {Uint8Array} data @returns {{ kind: import("../core/space.js").SpaceFileKind, type: string }}
 */
export function fileKindOf(data) {
  const image = imageTypeOf(data);
  if (image) return { kind: "image", type: image };
  const b = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return { kind: "pdf", type: "application/pdf" };
  if (!b.subarray(0, 8192).includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(b);
      return { kind: "text", type: "text/plain; charset=utf-8" };
    } catch {}
  }
  return { kind: "file", type: "application/octet-stream" };
}

/**
 * @param {{ dir: string | null, now?: () => number, log?: (level: string, msg: string) => void }} o  `dir`: where it keeps
 *   them — `<dataDir>/space-files`; null keeps nothing, every attach refused
 */
export function createSpaceFiles({ dir, now = Date.now, log = () => {} }) {
  /** A project's folder; null where it is no project's id or nothing is kept. @param {string} project */
  const folderOf = (project) => (dir && spaceable(project) ? join(dir, project) : null);

  return {
    /** Whether it keeps anything. */
    on: !!dir,
    /**
     * A file's bytes kept for a project, under a new id. → the id; null where nothing is kept.
     * @param {string} project @param {Uint8Array} data @returns {string | null}
     */
    keep(project, data) {
      const folder = folderOf(project);
      if (!folder) return null;
      mkdirSync(folder, { recursive: true });
      const id = `f${randomBytes(8).toString("hex")}`;
      const path = join(folder, id);
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        writeFileSync(tmp, data);
        renameSync(tmp, path);
      } catch (e) {
        rmSync(tmp, { force: true });
        throw e;
      }
      return id;
    },
    /** Where a kept file is on disk; null where it is not kept. @param {string} project @param {string} id */
    pathOf(project, id) {
      const folder = folderOf(project);
      if (!folder || !SPACE_FILE_ID.test(id)) return null;
      const path = join(folder, id);
      return existsSync(path) ? path : null;
    },
    /** Files taken away. @param {string} project @param {readonly string[]} ids */
    forget(project, ids) {
      const folder = folderOf(project);
      if (!folder) return;
      for (const id of ids) if (SPACE_FILE_ID.test(id)) rmSync(join(folder, id), { force: true });
    },
    /**
     * The files no Space holds taken away, each older than `SWEEP_AFTER_MS`; a project's folder left empty goes too.
     * `held(project)`: the ids its Space holds — the one it has and those deleted that may come back.
     * @param {(project: string) => Set<string>} held @returns {number}  how many went
     */
    sweep(held) {
      if (!dir) return 0;
      let gone = 0;
      /** @type {string[]} */
      let projects = [];
      try {
        projects = readdirSync(dir).filter((p) => spaceable(p));
      } catch {
        return 0;
      }
      const since = now() - SWEEP_AFTER_MS;
      for (const project of projects) {
        const folder = join(dir, project);
        try {
          const keep = held(project);
          const names = readdirSync(folder);
          for (const name of names) {
            const path = join(folder, name);
            if (keep.has(name) || statSync(path).mtimeMs >= since) continue;
            rmSync(path, { force: true });
            gone++;
          }
          if (!readdirSync(folder).length) rmSync(folder, { recursive: true, force: true });
        } catch (/** @type {any} */ e) {
          log("warn", `space files: ${project}'s could not be swept (${e?.message || e}); they are tried again at the next sweep`);
        }
      }
      return gone;
    },
  };
}

/** @typedef {ReturnType<typeof createSpaceFiles>} SpaceFiles */

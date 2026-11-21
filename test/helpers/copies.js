// @ts-check
// What Filament keeps of an agent's or a check's copy of the project (HarnessV4_Worktrees_Plan W3), read as a test reads
// it: the record beside git's record of the copy, and the copies in a repository's home.
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Filament's record of a copy — who holds it, busy, parked or free, its links, why its work could not be kept on its
 * refs, how it was made — or null where it has none.
 * @param {string} dest  the copy's folder
 * @returns {{ owner: string, state: "busy" | "parked" | "free", agent: string, at: number, links: string[], unsaved?: { error: string, at: number }, kind?: "worktree" | "clone" | "sparse", cone?: string[], lfs?: "pointers" | "whole" } | null}
 */
export function copyMeta(dest) {
  try {
    const named = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"))?.[1];
    return named ? JSON.parse(readFileSync(join(resolve(dest, named), "filament.json"), "utf8")) : null;
  } catch {
    return null;
  }
}

/** The temp files left beside a copy's record: none, where each record was written whole. @param {string} dest */
export function copyTemps(dest) {
  try {
    const named = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(join(dest, ".git"), "utf8"))?.[1];
    return named ? readdirSync(resolve(dest, named)).filter((n) => n.startsWith("filament.json.")) : [];
  } catch {
    return [];
  }
}

/** A copy's state: busy, parked or free; null where Filament keeps no record of it. @param {string} dest */
export const copyState = (dest) => copyMeta(dest)?.state ?? null;

/**
 * The copies in a repository's home, each by its place's name with its state, in name order.
 * @param {string} dir  the repository's top folder
 * @returns {[string, string | null][]}
 */
export function copiesOf(dir) {
  const home = join(dir, ".git", "filament-worktrees");
  /** @type {string[]} */
  let names = [];
  try {
    names = readdirSync(home).filter((n) => !n.startsWith("."));
  } catch {}
  return names.sort().map((n) => [n, copyState(join(home, n))]);
}

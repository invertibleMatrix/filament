// @ts-check
// A worktree template's paths (HarnessV4_Four_Plan E19, FO-D31): each a file or a folder of a repository, named from
// its top folder with "/" between parts. One rule for the setting's check, the copy, and the page's picker.
import { isAbsolute, win32 } from "node:path";

/** The most paths one list holds. */
export const COPY_MAX = 64;

/**
 * A path as the list keeps it: "/" between parts, no "./" in front, no "/" at the end.
 * @param {unknown} p
 */
export const copyPath = (p) =>
  String(p ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");

/**
 * Why a path cannot be on the list, in words; null where it can (FOC-68): inside the repository only, never git's own
 * folder, never the repository whole.
 * @param {unknown} p
 */
export function copyPathProblem(p) {
  const s = copyPath(p);
  if (!s || s === ".") return "a path is needed";
  if (isAbsolute(s) || win32.isAbsolute(s) || /^[A-Za-z]:/.test(s)) return `${s}: a path from the repository's top folder, not a whole one`;
  const parts = s.split("/");
  if (parts.includes("..")) return `${s}: inside the repository only`;
  if (parts.some((x) => !x || x === ".")) return `${s}: not a path`;
  if (parts[0].toLowerCase() === ".git") return `${s}: git's own folder is never copied`;
  return null;
}

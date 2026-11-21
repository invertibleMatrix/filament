// @ts-check
// Where a call works (HarnessV4_Git_Plan GW-D64): the file or folder it names, read from its name and input in
// whatever vocabulary it speaks (`canonicalOf`) or from where its agent says it is, or the folder its command runs in.
// What place that is, git says (app/now-in.js). And what a file-writing call's start says it writes (`editsSaid`),
// once its engine has read its files.
import { isAbsolute, resolve } from "node:path";
import { canonicalOf, leadingFolders } from "./tool-vocab.js";

/** The files a call's start names as written (`edits`, services/runs.js), at most; and each one's characters. */
const EDITS_MOST = 50;
const EDIT_PATH_CHARS = 400;

/** The kinds whose path names the file or folder the call works in. */
const PATH_KINDS = new Set(["read", "write", "edit", "search", "list"]);
/** The kinds that run a command; a background shell's read or stop names none. */
const COMMAND_KINDS = new Set(["shell", "shell-background"]);

/**
 * A path as Git Bash or WSL spells one on a drive — `/h/x`, `/mnt/h/x` —: the path a host with drives knows it by
 * (`H:/x`), and the folder the spelling starts with (`/h`, `/mnt/h`), which is a folder of its own where one of that
 * name is there. Null for any other path. The one reader of that spelling: a command's folders are read by it here
 * (`asHost`), a coding agent's file paths in app/agent-run.js (`hostPath`).
 * @param {string} s
 * @returns {{ path: string, folder: string } | null}
 */
export function driveSpelled(s) {
  const m = /^(\/(?:mnt\/)?([a-z]))(\/.*)?$/i.exec(s);
  return m ? { path: `${m[2].toUpperCase()}:${m[3] || "/"}`, folder: m[1] } : null;
}

/**
 * A folder or file as the host spells it: Git Bash's and WSL's `/h/x` and `/mnt/h/x` as `H:/x` where the host's
 * paths have drives. Null where it cannot be told here: a variable's (`$DIR`, `%TEMP%`), the home folder's `~`, the
 * last folder's `-`, and on a host with drives a path from the shell's own root (`/tmp`).
 * @param {unknown} p @param {boolean} drives
 * @returns {string | null}
 */
function asHost(p, drives) {
  const s = typeof p === "string" ? p.trim() : "";
  if (!s || s === "-" || /^~|[$%`]/.test(s)) return null;
  const m = drives ? driveSpelled(s) : null;
  if (m) return m.path;
  return drives && /^[\\/](?![\\/])/.test(s) ? null : s;
}

/**
 * The file or folder a call works in, absolute; null where the call says none it can be placed by. A file tool's
 * path, a search's or a listing's folder (an agent's `locations` where its input names none); a command's folder: the
 * one its leading changes of folder take it to (`leadingFolders`), else the one its agent says it runs in (Codex's
 * `cwd`), else — for a call that starts in the chat's folder (`fresh`) — that folder. A relative path is read from the
 * folder the call runs in, where that is known.
 * @param {string} name @param {any} input
 * @param {{ root: string, locations?: any[], fresh?: boolean }} o
 *   `root`: the chat's folder; `fresh`: each of the call's commands and searches starts there (Filament's own hands) —
 *   false for a coding agent, whose shell may stand where an earlier command took it
 * @returns {string | null}
 */
export function callPlace(name, input, { root, locations = [], fresh = false }) {
  const canon = canonicalOf(name, input);
  const kind = canon?.kind || "";
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const drives = /^[a-z]:/i.test(String(root || ""));
  const said = asHost(raw.cwd, drives);
  /** The folder the call runs in, where known. */
  const base = said && isAbsolute(said) ? resolve(said) : fresh && root ? resolve(root) : null;
  /** @param {unknown} p @param {string | null} from */
  const at = (p, from) => {
    const h = asHost(p, drives);
    if (!h) return null;
    return isAbsolute(h) ? resolve(h) : from ? resolve(from, h) : null;
  };
  if (COMMAND_KINDS.has(kind)) {
    const command = canon?.fields.command;
    if (typeof command !== "string") return null;
    const folders = leadingFolders(command);
    if (folders === null) return null;
    let where = base;
    for (const f of folders) if (!(where = at(f, where))) return null;
    return where;
  }
  if (!PATH_KINDS.has(kind)) return null;
  const path = canon?.fields.path;
  if (typeof path === "string" && path) return at(path, base);
  const located = locations.find((l) => typeof l?.path === "string" && l.path)?.path;
  if (located) return at(located, base);
  return kind === "search" || kind === "list" ? base : null;
}

/**
 * What a file-writing call's start says it writes (`edits`): its files, each once — or `true`, that it writes with its
 * files unsaid: where it names none, where one could not be told (null), and past `EDITS_MOST` files or a path past
 * `EDIT_PATH_CHARS`, since a list cut short would say the rest is not the call's.
 * @param {readonly (string | null)[]} paths  each file the call names, absolute; null for one that could not be told
 * @returns {string[] | true}
 */
export function editsSaid(paths) {
  const files = [...new Set(paths)];
  return files.length && files.length <= EDITS_MOST && files.every((p) => typeof p === "string" && p && p.length <= EDIT_PATH_CHARS) ? /** @type {string[]} */ (files) : true;
}

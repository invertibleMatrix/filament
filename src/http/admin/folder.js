// @ts-check
// The folder fence the project-reading admin rows share (files, git, sessions, spaces, terminal): a `cwd` is allowed by the same judgement the
// agent loop makes — it exists, it lies under a listed `agentLoop.roots` entry as the filesystem resolves it, and
// with no roots listed the listener is private to this machine. Refused in words with the status the surface shows.
// A folder on a share or drive that does not answer — offline, or too slow — is refused at once, never looked at on the
// server's thread, where its look would hold every request as long as its system waits on the share.
import { folderVerdict, shareKeptOut } from "../../app/agent/turn.js";
import { folderHung, folderThere } from "../../adapters/git/folder-there.js";

/** The roots `agentLoop.roots` lists. @param {any} cfg @returns {string[]} */
const rootsOf = (cfg) => (Array.isArray(cfg?.agentLoop?.roots) ? cfg.agentLoop.roots : []).map(String).filter(Boolean);

/** What a folder that does not answer is refused with. @param {string} cwd */
const noAnswer = (cwd) => ({ ok: /** @type {const} */ (false), status: 503, error: `${cwd} does not answer: its drive or share is offline, or too slow to say. Read it again once it answers` });

/**
 * @param {any} cfg
 * @param {string | null | undefined} cwd
 * @returns {{ ok: true, root: string } | { ok: false, status: number, error: string }}
 */
export function allowedFolder(cfg, cwd) {
  if (cwd && !shareKeptOut(cfg, String(cwd)) && folderHung(String(cwd))) return noAnswer(String(cwd));
  const v = folderVerdict(cfg, String(cwd || ""));
  if (v.ok) return { ok: true, root: v.root };
  switch (v.why) {
    case "empty":
      return { ok: false, status: 400, error: "cwd is required: the project folder" };
    case "missing":
      return { ok: false, status: 404, error: `the folder does not exist on this machine: ${cwd}` };
    case "outside":
      return { ok: false, status: 403, error: `${cwd} is not under any folder listed in agentLoop.roots` };
    default:
      return { ok: false, status: 403, error: `agentLoop.roots is empty while Filament listens on ${cfg?.server?.host}: with an exposed listener only listed folders can be read` };
  }
}

/**
 * `allowedFolder`, its folder and the listed roots looked at off the server's thread first and waited for a moment at
 * most (inspect.js `folderThere`): a folder that has not answered by then is refused (503), and the fence's own look
 * finds it answered; a root that does not answer holds no folder meanwhile (turn.js `underRoots`). A share the folder
 * rules keep out is never asked: the fence refuses it unasked.
 * @param {any} cfg @param {string | null | undefined} cwd @param {{ ms?: number, statOf?: (path: string) => Promise<unknown> }} [there]
 * @returns {Promise<{ ok: true, root: string } | { ok: false, status: number, error: string }>}
 */
export async function allowedFolderSoon(cfg, cwd, there) {
  const c = String(cwd || "").trim();
  if (!c || shareKeptOut(cfg, c)) return allowedFolder(cfg, cwd);
  const [here] = await Promise.all([folderThere(c, there), ...rootsOf(cfg).map((r) => folderThere(r, there))]);
  if (here === null) return noAnswer(c);
  return allowedFolder(cfg, cwd);
}

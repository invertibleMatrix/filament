// @ts-check
// The folder fence the project-reading admin rows share (files, git, sessions, spaces, terminal): a `cwd` is allowed by the same judgement the
// agent loop makes — it exists, it lies under a listed `agentLoop.roots` entry as the filesystem resolves it, and
// with no roots listed the listener is private to this machine. Refused in words with the status the surface shows.
import { folderVerdict } from "../../app/agent/turn.js";

/**
 * @param {any} cfg
 * @param {string | null | undefined} cwd
 * @returns {{ ok: true, root: string } | { ok: false, status: number, error: string }}
 */
export function allowedFolder(cfg, cwd) {
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

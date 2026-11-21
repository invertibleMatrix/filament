// @ts-check
// A git mark that moved (http/admin/git.js, the slowness of 11-02): the server answers `/git/place`, `/git/where` and
// `/git/places` at once from their last reads and reads each again behind its answer; where what it reads differs, the
// events feed says `git-moved` — which read (`place`, whole; `apart` and `light`, the sidebar's; `places`, a
// repository's) and every spelling of the folder it was asked by. A reader that shows that folder asks again, and is
// answered at once.

/** One folder, however its slashes and case are spelled. @param {unknown} p */
const keyOf = (p) => String(p ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/**
 * Whether `msg` says a read of `what` moved for one of `folders`.
 * @param {any} msg @param {string | string[]} what @param {Iterable<string | null | undefined>} folders
 */
export function gitMovedFor(msg, what, folders) {
  if (msg?.type !== "git-moved" || !(Array.isArray(what) ? what : [what]).includes(msg.what)) return false;
  const said = new Set((Array.isArray(msg.folders) ? msg.folders : []).map(keyOf));
  for (const f of folders) if (f && said.has(keyOf(f))) return true;
  return false;
}

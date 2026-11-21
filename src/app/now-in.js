// @ts-check
// Where the main agent works now (HarnessV4_Git_Plan §11): the place each of its calls works in, said on its run as an
// event `place` when it moves (GW-D67). A place is a repository's or a worktree's top folder, as git names it; the
// chat's folder is said only once the agent has worked elsewhere. Live only: nothing is kept past the run.
import { folderOf, placeOf } from "../adapters/git/snapshot.js";
import { callPlace } from "../core/call-place.js";

/**
 * @typedef {{ id?: unknown, name: string, input?: any, locations?: any[] }} PlacedCall
 * @typedef {{ saw: (round: number, call: PlacedCall) => Promise<void> }} NowIn
 */

/**
 * @param {{ root: string, publish: (e: any) => void, fresh?: boolean }} o
 *   `root`: the chat's folder; `publish`: the run's events; `fresh`: each command and search of the agent starts in
 *   `root` (Filament's own hands — `callPlace`)
 * @returns {NowIn}
 */
export function createNowIn({ root, publish, fresh = false }) {
  /** Each folder's place, asked of git once a turn. @type {Map<string, Promise<string | null>>} */
  const asked = new Map();
  /** @param {string} path */
  const placeAt = (path) => {
    const dir = folderOf(path);
    if (!dir) return Promise.resolve(null);
    let p = asked.get(dir);
    if (!p) asked.set(dir, (p = placeOf(dir).then((r) => r.place, () => null)));
    return p;
  };
  /** The chat's folder's place, asked once a call names a place: a turn that names none runs no git here. */
  const home = () => placeAt(root);
  /** The place said last; none until the agent worked outside the chat's folder. @type {string | null} */
  let said = null;
  /** Calls are placed in the order they started, whatever git answers first. */
  let queue = Promise.resolve();
  return {
    /** A call of the main agent started (Filament's loop: as it runs). Resolves once it is placed. */
    saw(round, call) {
      const at = callPlace(call.name, call.input, { root, locations: call.locations || [], fresh });
      if (!at) return queue;
      queue = queue
        .then(async () => {
          const [place, mine] = await Promise.all([placeAt(at), home()]);
          if (!place || place === (said ?? mine)) return;
          said = place;
          publish({ type: "place", round, ...(call.id != null ? { id: String(call.id) } : {}), place, home: place === mine });
        })
        .catch(() => {});
      return queue;
    },
  };
}

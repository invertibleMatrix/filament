// @ts-check
// A list read again and again sent as the rows that moved (the slowness of 11-02): the owner's largest chat's Agents
// list was 1.1 MB, read every few seconds while one of its agents ran — by the Agents tab, by Now and by the Teams
// board each —, though one or two of its rows moved between reads. Each answer is a version, kept as each row's hash;
// a read that names the version it holds is sent the order of the rows' ids and the rows that moved since, and one that
// names a version not kept — another process's, or long gone — is sent every row.
import { createHash, randomUUID } from "node:crypto";

/** One row's hash: what it says, as JSON. @param {unknown} row */
const sigOf = (row) => createHash("sha1").update(JSON.stringify(row)).digest("base64url").slice(0, 16);

/** @param {Map<string, string>} a @param {Map<string, string>} b */
const same = (a, b) => {
  if (a.size !== b.size) return false;
  let i = 0;
  const order = [...b.keys()];
  for (const [id, sig] of a) if (order[i++] !== id || b.get(id) !== sig) return false;
  return true;
};

/**
 * Each list's versions, by key (a chat): `states` kept for each, `keys` kept at most, the one asked longest ago going
 * first.
 * @param {{ keys?: number, states?: number }} [o]
 */
export function listVersions({ keys = 50, states = 8 } = {}) {
  /** This process's mark on its versions: another's are never taken for its own. */
  const boot = randomUUID().slice(0, 8);
  /** @type {Map<string, { n: number, latest: string, states: Map<string, Map<string, string>> }>} */
  const kept = new Map();
  return {
    /**
     * The list as it stands, as a version: every row where `since` is not a version kept of it, else `ids` — every
     * row's id, in order — and the rows that moved since.
     * @template {{ id: string }} R
     * @param {string} key @param {R[]} rows @param {string} [since]
     * @returns {{ version: string, rows: R[], ids?: string[] }}
     */
    take(key, rows, since = "") {
      const sigs = new Map(rows.map((r) => [String(r.id), sigOf(r)]));
      let k = kept.get(key);
      if (k) kept.delete(key);
      else k = { n: 0, latest: "", states: new Map() };
      kept.set(key, k);
      while (kept.size > keys) kept.delete(/** @type {string} */ (kept.keys().next().value));
      const last = k.states.get(k.latest);
      if (!last || !same(last, sigs)) {
        k.latest = `${boot}.${++k.n}`;
        k.states.set(k.latest, sigs);
        while (k.states.size > states) k.states.delete(/** @type {string} */ (k.states.keys().next().value));
      }
      const had = since ? k.states.get(since) : undefined;
      if (!had) return { version: k.latest, rows };
      return { version: k.latest, ids: [...sigs.keys()], rows: rows.filter((r) => had.get(String(r.id)) !== sigs.get(String(r.id))) };
    },
  };
}

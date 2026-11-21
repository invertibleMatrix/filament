// @ts-check
// What a turn's agents changed, as the page reads it (HarnessV4_Git_Plan step 1, GW-D26): from the turn's own run, the
// answer its files card reads, one read per run at a time while it is fresh; for a run Filament holds no more, from the
// chat's record of that turn. Both answer in one shape: `ownChangesOf`'s.
import { api } from "./api.js";

/** How long a run's answer serves every reader before it is read again: a live turn's counts move. */
const FRESH_MS = 4000;
/**
 * The reads being shared, by run and by how many rows they ask (`first`): each let go once it can serve no reader —
 * kept, the page held every run's answer for its life (the owner's of 11-17: 22.8 MB for one turn's).
 * @type {Map<string, { at: number, ended: boolean, p: Promise<any> }>}
 */
const runs = new Map();
/** How many reads are kept now: the tests' probe. */
export const runReadsKept = () => runs.size;

/**
 * @typedef {{ files: any[], during: any[], outside: any[], places: { place: string, start: string }[],
 *   errors: { place: string, error: string }[], totals: { files: number, added: number, removed: number },
 *   folder: string | null, note: string | null }} TurnChanges
 *   each agent's own files per place, net; what changed while its commands ran; the files written outside any
 *   repository; the places in the order first written in; the places git could not read; `folder`, the place of the
 *   turn's folder; `note`, why there is nothing to show
 */

/** No changes, and why. @param {string | null} note @param {string | null} [folder] @returns {TurnChanges} */
export const noChanges = (note, folder = null) => ({ files: [], during: [], outside: [], places: [], errors: [], totals: { files: 0, added: 0, removed: 0 }, folder, note });

/**
 * A run's answer (`GET /runs/:id/changes`), shared by every reader while it is fresh; `fresh` reads it again now (a
 * round of the live turn just ended). A read taken while the run went on never serves a reader that knows it `ended`:
 * the last round would be missing from it. `first`: the whole's lists held to their first rows, with how many each
 * holds (`counts`) — a read of its own, never a whole one's. Rejects as the read did — a run the server holds no more
 * with status 404.
 * @param {string} runId @param {{ fresh?: boolean, ended?: boolean, first?: number }} [o] @returns {Promise<any>}
 */
export function runChanges(runId, { fresh = false, ended = true, first = 0 } = {}) {
  const key = first ? `${runId}\n${first}` : runId;
  const hit = runs.get(key);
  if (hit && !fresh && Date.now() - hit.at < FRESH_MS && (hit.ended || !ended)) return hit.p;
  const p = api(`/runs/${encodeURIComponent(runId)}/changes${first ? `?first=${first}` : ""}`);
  runs.set(key, { at: Date.now(), ended, p });
  const letGo = () => {
    if (runs.get(key)?.p === p) runs.delete(key);
  };
  // Settled, it serves for the rest of its fresh time, then goes.
  p.then(() => /** @type {any} */ (setTimeout(letGo, FRESH_MS))?.unref?.(), letGo);
  return p;
}

/** A run's or a record's answer in the one shape. @param {any} w @param {string | null} folder @param {string | null} note */
export const shaped = (w, folder, note) =>
  w ? { files: w.files || [], during: w.during || [], outside: w.outside || [], places: w.places || [], errors: w.errors || [], totals: w.totals || { files: 0, added: 0, removed: 0 }, folder, note: null } : noChanges(note, folder);

/**
 * A turn's changes: its run's, else — a turn the page read from the chat's history, whose run is gone — its record's.
 * @param {any} chat @param {any} turn @param {{ fresh?: boolean }} [o] @returns {Promise<TurnChanges>}
 */
export async function turnChanges(chat, turn, { fresh = false } = {}) {
  if (turn?.runId) {
    try {
      const r = await runChanges(String(turn.runId), { fresh, ended: turn.status !== "streaming" });
      return shaped(r?.whole, r?.folder || null, r?.note || null);
    } catch (e) {
      if (/** @type {any} */ (e)?.status !== 404 || !turn.history) throw e;
    }
  }
  if (!chat?.chainId || !turn?.history || !turn.n) return noChanges("this turn has no record of what it changed");
  const r = await api(`/memory/sessions/${encodeURIComponent(chat.chainId)}/changes?turn=${Number(turn.n)}&cwd=${encodeURIComponent(chat.cwd || "")}`);
  return r?.files?.length || r?.during?.length || r?.outside?.length ? shaped(r, r.folder || null, null) : noChanges(r?.note || null, r?.folder || null);
}

/**
 * The newest turn of a chat that ran, live or ended — the one Turn shows and the header counts — or null.
 * @param {any} chat @param {{ ended?: boolean }} [o]  `ended`: the newest that has ended
 */
export function newestTurn(chat, { ended = false } = {}) {
  const turns = (chat?.turns || []).filter((/** @type {any} */ t) => t.runId && (!ended || t.status !== "streaming"));
  return turns.at(-1) || null;
}

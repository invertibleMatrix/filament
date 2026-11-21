// @ts-check
// What the page read of a turn, onto the same turn of a fresh reading of its session (the chat-open audit of 10-29). A
// hydrate makes every turn anew, and each turn near the screen read its run's log and its changes again: the turn a page
// followed to its end read its log a third time — followed live from its first event, read again as a past turn's
// cards, read again when the turn ended and the transcript was read for its final words. A turn is the same turn by its
// id; what was read of it holds while it has ended and is the same run's. The lines the person opened under its capsule
// hold through every reading of it.

/** A turn that runs no more, as the transcript says it: an open turn's log still grows. @param {any} t */
const ended = (t) => t?.status === "done" || t?.status === "error" || t?.status === "stopped";

/**
 * A fresh reading's turns with what the page had read of each: its run's whole log aligned (`aligned`, and the cache
 * that holds it once the log was let go of, `alignCache` — labels.js `letGoOfLog` —, which the timeline draws the
 * turn's cards from instead of reading the log again) and its changes card (`tree`). A turn whose changes were asked for
 * and not yet answered asks again: its answer lands on the turn it was asked for. The lines the person opened under a
 * turn's capsule (`linesOpen`, turn.js `ownLine`) go onto its fresh copy whether it has ended or runs still: a coding
 * agent's own turn lists its tasks while it runs, and a reading then makes it anew too.
 * @param {any[]} turns  a fresh reading's turns @param {any[] | null | undefined} was  the chat's turns as drawn
 * @param {(from: any, to: any) => void} [also]  what else the page keeps of a turn (the meter's record), carried with it
 * @returns {any[]} `turns`
 */
export function withReadRuns(turns, was, also) {
  const had = new Map((was || []).filter((t) => t?.turnId != null).map((t) => [t.turnId, t]));
  for (const t of turns) {
    const old = had.get(t.turnId);
    if (!old || old === t) continue;
    if (old.linesOpen) t.linesOpen = old.linesOpen;
    if (!ended(t) || (old.runId || null) !== (t.runId || null)) continue;
    // A copy of the cache: a log handed to the old turn after this (a late frame of its follow) starts that one over,
    // never the fresh turn's.
    if (t.runId && old.alignCache?.whole) {
      t.alignCache = { ...old.alignCache };
      t.aligned = old.aligned;
    }
    if (old.tree && t.tree === undefined) t.tree = old.tree;
    also?.(old, t);
  }
  return turns;
}

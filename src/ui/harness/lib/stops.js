// @ts-check
// What the session's stop said (`POST /sessions/:id/stop`), read for the page: whether it reached a turn, and the run
// a Force stop could end after it (HarnessV4_Tasks U2). Pure: no DOM, no fetch.

/**
 * Whether the session's stop reached a turn (its route's answer): a run that took it as a steer or was forced, or a
 * turn cancelled before its run began. A holder named with nothing stopped is no turn reached.
 * @param {any} out
 */
export const stopReached = (out) => !!out?.stopped;

/**
 * The run a stop sent through the session left to force, should it run on: the one that took the stop as a steer — the
 * harness turn's own, else the first the session named (the turn's request id was not out yet). None where the stop
 * cancelled a turn before its run began.
 * @param {any} out @returns {string | null}
 */
export function runToForce(out) {
  if (out?.stopped !== "steered") return null;
  const id = out.holder?.requestId || out.runs?.[0];
  return id ? String(id) : null;
}

/**
 * What a Force stop sent through the session did (`{ force: true }`): `forced` — a run was ended; `stopped` — it
 * reached a turn with no run to force (cancelled before its run began), which is the stop it was; `nothing` — no turn
 * ran.
 * @param {any} out @returns {"forced" | "stopped" | "nothing"}
 */
export const forceOutcome = (out) => (out?.stopped === "forced" ? "forced" : stopReached(out) ? "stopped" : "nothing");

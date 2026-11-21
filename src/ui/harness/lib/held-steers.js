// @ts-check
// A message typed while the page's turn has not reached its run yet (HarnessV3-CodebasePass decision 2). A turn
// composes, compacts at its line or reads memory before its loop starts, and only a run reads steers: the composer
// used to put the text back in the box without a word. Held here instead — drawn as waiting for the run, sent the
// moment the run is known, in the order typed — and, when the turn ends before any run could read them (or the run
// ended first), handed back to go out as the next message.

/**
 * @typedef {{ id: string, kind: "note" | "veto", text: string, overrules?: any[], teams?: any[], typed?: string, use?: string[], useTeams?: string[], weigh?: true }} HeldSteer
 *   `overrules`: whose answers the message overrules (HarnessV4_Tasks E15 step 3) — they go with it; `teams`: the teams'
 *   results its words carry (team_v2_plan §10 O3), each sent only once a run takes it, and `typed` the person's own words,
 *   for the queue where no run does; `use`, `useTeams`: the agents' tags and the teams' keys its words name with an `@`
 *   past their start, for the main agent to use (HarnessV4_OneAgent_Plan OA2); `weigh`: a fork of the turn weighs it
 *   first, as the person asked (the owner's of 11-05)
 * @typedef {{ held: HeldSteer, out?: any, error?: unknown }} FlushResult
 */

/**
 * @param {{ post: (runId: string, m: HeldSteer) => Promise<any> }} io  `post` sends one message to the run's mailbox
 */
export function createHeldSteers({ post }) {
  /** @type {HeldSteer[]} */
  let held = [];
  let n = 0;
  return {
    /**
     * Hold a message for the run to come.
     * @param {"note" | "veto"} kind @param {string} text @param {any[]} [overrules] @param {{ teams?: any[], typed?: string, use?: string[], useTeams?: string[], weigh?: boolean }} [carry]
     * @returns {HeldSteer}
     */
    hold(kind, text, overrules = [], carry = {}) {
      const teams = carry.teams || [];
      const use = carry.use || [];
      const useTeams = carry.useTeams || [];
      /** @type {HeldSteer} */
      const m = { id: `held-${++n}-${Date.now().toString(36)}`, kind, text: String(text), ...(overrules.length ? { overrules } : {}), ...(teams.length ? { teams, typed: String(carry.typed ?? "") } : {}), ...(use.length ? { use } : {}), ...(useTeams.length ? { useTeams } : {}), ...(kind === "note" && carry.weigh ? { weigh: /** @type {const} */ (true) } : {}) };
      held.push(m);
      return m;
    },
    size: () => held.length,
    /** What is held, in the order typed, left held: the page keeps it as it goes away (HarnessV4_Tasks U4). */
    texts: () => held.map((m) => m.text),
    /**
     * The run is known: every held message goes to its mailbox, one after another so the order typed holds. A message
     * the run refused (it ended first) comes back with its error, for the caller to send as the next message.
     * @param {string} runId @returns {Promise<FlushResult[]>}
     */
    async flush(runId) {
      const list = held;
      held = [];
      /** @type {FlushResult[]} */
      const done = [];
      for (const m of list) {
        try {
          done.push({ held: m, out: await post(runId, m) });
        } catch (error) {
          done.push({ held: m, error });
        }
      }
      return done;
    },
    /** The turn ended with no run to read them: what is still held, for the next message. @returns {HeldSteer[]} */
    release() {
      const list = held;
      held = [];
      return list;
    },
  };
}

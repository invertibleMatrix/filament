// @ts-check
// A coding agent's own turns, asked for (HarnessV3-ACP AC3-9). The ACP bridge says when a cycle the agent began by
// itself on a harness chat's session wants a turn of that chat (`onOwnCycle`); this asks the sessions service for it
// through Filament's own door, as a house call, and tells the bridge how it went: shown — a cycle on its heels asks
// again — or the session busy with a turn of somebody's, asked again once it is free, or held by a question a turn
// paused on, asked again once the question ends — a turn of the chat, the answer's, has come and gone, or it ended with
// none: left for a coding agent, taken away by a rewind, out of time — or refused, when what the session said meanwhile
// is let go of.
import { houseAuth } from "../services/house.js";
import { loopbackPost } from "../services/loopback.js";

/**
 * A cycle the agent began by itself, as the bridge asks for its turn: the agent's upstream and session, the harness
 * chat that shows it and the model its turns name, and the background tasks whose end it read.
 * @typedef {{ upstreamId: string, sessionId: string, chain: string, model: string,
 *   tasks: { id: string, status: string, summary: string }[] }} OwnCycleAsk
 */

/**
 * @param {{ onOwnCycle: ((cycle: OwnCycleAsk) => void) | null, ownAgain: (sessionId: string) => void,
 *   declineOwn: (sessionId: string, why: string) => void }} bridge
 * @param {{ base: () => string, log: (level: string, msg: string) => void,
 *   sessionTurns: import("../services/session-turns.js").SessionTurns,
 *   chainKeyOf: (chainId: string) => string | null,
 *   questionOver: (chainId: string, fn: () => void) => () => void }} o  `base`: where Filament reaches itself (AppDeps
 *   `selfBase`); `chainKeyOf`: the session's lock key, null for a session gone; `questionOver`: heard each time the
 *   question a turn of the chat paused on ends with no answer's turn (the sessions service's `question-over`), and the
 *   way to stop hearing it
 */
export function wireOwnTurns(bridge, { base, log, sessionTurns, chainKeyOf, questionOver }) {
  /** Until nobody runs a turn in the session. @param {string} key */
  const free = (key) =>
    new Promise((resolve) => {
      const off = sessionTurns.onChange(key, (holder) => {
        if (holder) return;
        off();
        resolve(undefined);
      });
    });
  /**
   * Until the question a turn of the session paused on ends: a turn of the session — the answer's — has come and gone,
   * or it ended with none (`questionOver`). @param {string} key @param {string} chainId
   */
  const answered = (key, chainId) =>
    new Promise((resolve) => {
      let ran = false;
      const ended = () => {
        offTurns();
        offOver();
        resolve(undefined);
      };
      const offTurns = sessionTurns.onChange(key, (holder) => {
        if (holder) return void (ran = true);
        if (ran) ended();
      });
      const offOver = questionOver(chainId, ended);
    });
  /** @param {OwnCycleAsk} cycle */
  const ask = async (cycle) => {
    /** @type {Response} */
    let r;
    try {
      r = await loopbackPost(`${base()}/api/sessions/${encodeURIComponent(cycle.chain)}/own-turns`, {
        headers: { "content-type": "application/json", ...houseAuth() },
        body: JSON.stringify({ upstream: cycle.upstreamId, sessionId: cycle.sessionId, model: cycle.model, tasks: cycle.tasks }),
      });
    } catch (/** @type {any} */ e) {
      return bridge.declineOwn(cycle.sessionId, `Filament's door did not answer (${e?.message || e})`);
    }
    if (r.status === 409) {
      const said = await r.json().catch(() => null);
      const key = chainKeyOf(cycle.chain);
      if (!key) return bridge.declineOwn(cycle.sessionId, "its chat is gone");
      const asking = said?.asking === true;
      log("debug", `[acp] ${cycle.sessionId.slice(0, 8)}: the agent's own turn waits for ${asking ? "the end of the question its chat's turn asked" : "the turn running in its chat"}`);
      await (asking ? answered(key, cycle.chain) : free(key));
      return bridge.ownAgain(cycle.sessionId);
    }
    if (!r.ok) {
      const said = await r.text().catch(() => "");
      return bridge.declineOwn(cycle.sessionId, `HTTP ${r.status}${said ? `: ${said.slice(0, 200)}` : ""}`);
    }
    // The reply runs as long as the turn does; it is read to its end, and the bridge told.
    await r.arrayBuffer().catch(() => null);
    bridge.ownAgain(cycle.sessionId);
  };
  bridge.onOwnCycle = (cycle) => void ask(cycle);
}

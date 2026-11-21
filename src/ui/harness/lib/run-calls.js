// @ts-check
// A sub-agent's own calls an ended turn's read left apart (services/runs.js `calls: "apart"`, labels.js `fillCalls`):
// read from the turn's run as its card opens — its launching call's alone —, or every card's at once where Find opens.

/** How many events one page of the read takes. */
export const CALLS_PAGE = 5000;
const CALL_TYPES = new Set(["subagent-tool-start", "subagent-tool-end", "subagent-tool-errors"]);

/**
 * The run's sub-agents' calls, every one in order — of one launching call where `of` names it (its round and its call's
 * id, labels.js `subsApart`). A page that says the run's events were let go of fails the read: a card's calls are
 * filled whole or not at all.
 * @param {(path: string) => Promise<any>} api @param {string} runId @param {{ round: number, parent: any } | null} [of]
 * @returns {Promise<any[]>}
 */
export async function readCalls(api, runId, of = null) {
  /** @type {any[]} */
  const all = [];
  const key = of ? `&round=${Number(of.round) || 0}&parent=${encodeURIComponent(String(of.parent))}` : "";
  for (let since = 0; ;) {
    const page = await api(`/runs/${encodeURIComponent(runId)}/events?since=${since}&limit=${CALLS_PAGE}&calls=only${key}`);
    if (page?.gap) throw new Error("the run no longer holds all of its calls");
    const events = page?.events || [];
    for (const e of events) if (CALL_TYPES.has(e.type) && (!of || (callRound(e) === of.round && e.parent === of.parent))) all.push(e);
    const last = Number(events.at(-1)?.n) || 0;
    if (events.length < CALLS_PAGE || last <= since) return all;
    since = last;
  }
}

/** An event's round as the alignment reads it (labels.js `roundOf`). @param {any} e */
const callRound = (e) => (Number.isInteger(e.round) ? e.round : 0);

/**
 * A run's calls, read whole, by the launching call each is of: its round, then its parent, as the alignment finds it.
 * @param {any[]} events @returns {Map<number, Map<any, any[]>>}
 */
export function callsByLaunch(events) {
  /** @type {Map<number, Map<any, any[]>>} */
  const out = new Map();
  for (const e of events) {
    const r = callRound(e);
    let byParent = out.get(r);
    if (!byParent) out.set(r, (byParent = new Map()));
    const list = byParent.get(e.parent);
    if (list) list.push(e);
    else byParent.set(e.parent, [e]);
  }
  return out;
}

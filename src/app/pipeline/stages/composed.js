// @ts-check
// A native session's turn arrives already composed (HarnessV2 §9): the composer chose every completed turn's shape
// before the request entered the pipeline, so its report is the record's view stamp — in the fields the Context page
// reads for every other request. Stamped here, right after the record exists, because an `agent/<model>` turn is
// answered by the agent stage and never reaches the view stage.
import { composition } from "../../../core/fold.js";

/** @type {import("../context.js").Stage} */
export async function composed(ctx) {
  const { pre, rec, body, format } = ctx;
  if (pre?.api !== "session") return "continue";
  stampComposed(rec, pre.composition || {}, body, format);
  ctx.memory?.trace?.step("context composed", {
    form: rec.view.form,
    historyTokens: rec.view.historyTokens,
    sentTokens: rec.view.sentTokens,
    foldedTurns: rec.view.foldedTurns,
  });
  return "continue";
}

/**
 * A compaction a session turn made, as its record keeps it (`view.compactions`): its row's id, the turns it stands for,
 * its kind and its method — the page finds the compaction's row by it as the turn ends.
 * @param {any} c @returns {{ id: number | null, fromTurn: number, toTurn: number, kind: string, method: string | null }}
 */
export const compactionStamp = (c) => ({ id: c.id ?? null, fromTurn: c.fromTurn, toTurn: c.toTurn, kind: c.kind, method: c.method ?? null });

/**
 * A session turn's composition on its record: the view stamp, in the fields the Context page reads for every other
 * request, and the composer's notes. Again when the turn is composed anew — a seed a coding agent refused for its size,
 * made to fit (HarnessV3-FailurePoints D9), whose composition names every compaction the turn made.
 * @param {any} rec @param {any} c  the composer's report, as the sessions service hands it @param {any} body
 * @param {string} format
 */
export function stampComposed(rec, c, body, format) {
  rec.view = {
    form: c.form || "plain",
    version: c.version ?? 1,
    historyTokens: c.historyTokens ?? 0,
    sentTokens: c.sentTokens ?? 0,
    // What rides beside the history, the loop's prompt and tools, as the composer weighed it: the Context popover's
    // System & tools, the figure the Map and /autofit say (HarnessV3-Launch LD-D17). 0 is a session whose part Filament
    // does not weigh (a client's sends its own), left out so the popover keeps its own rule there.
    ...(Number(c.fixedTokens) > 0 ? { fixedTokens: Number(c.fixedTokens) } : {}),
    // History-scoped twin of sentTokens (the body figure counts the summary head and the new message too) — the
    // honest "what the shapes saved" is historyTokens − shapedTokens.
    shapedTokens: c.shapedTokens ?? 0,
    totalTurns: c.totalTurns ?? 0,
    underSummary: c.underSummary ?? 0,
    foldedTurns: c.foldedTurns ?? 0,
    rawTurns: c.rawTurns ?? 0,
    stubs: c.stubs ?? 0,
    composed: true,
    results: c.results,
    head: c.head || null,
    // The compactions the turn made so far, in the order made (`compactionStamp`).
    compactions: (c.compactions || []).map(compactionStamp),
    settingsHash: c.settingsHash || null,
    shapes: (c.turns || []).map((t) => ({ n: t.n, shape: t.shape, tokens: t.tokens, ...(t.adapted ? { adapted: t.adapted } : {}) })),
    // The rest of the composer's report, for "explain this request" (§10.5): what the result policy did is not
    // visible in the counts above.
    deduped: c.deduped ?? 0,
    pointers: c.pointers ?? 0,
    thinkingStripped: c.thinkingStripped ?? 0,
    // The calibration factor these token counts carry (null = plain heuristic) — the meter says which scale it is
    // showing instead of mixing one with the other unlabeled.
    factor: c.factor ?? null,
    composition: composition(body.messages, format, { system: body.system, tools: body.tools }),
    // When the page sent the turn, when the route had it, each pre-send phase in ms, and the hand-off (BUG-19).
    timing: c.timing || null,
  };
  for (const note of c.notes || []) (rec.priorChanges ||= []).push(`compose: ${note}`);
}

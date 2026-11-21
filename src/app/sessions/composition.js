// @ts-check
// "Explain this request" (HarnessV2 §10.5): the composition report for one request, read off its record — how the
// outbound body was put together, in one shape whichever door the request came through. Per-turn shapes and the
// history → sent count from the view (the composer's for a native session, the history as sent for a proxied client), memory's
// blocks by kind and weight, the compaction in force, the settings hash, the notes in the order they were made. Numbers,
// ids and Filament's own sentences only; no message text.

/** @typedef {Record<string, any>} Rec */

/**
 * @typedef {object} CompositionReport
 * @property {string} requestId
 * @property {string | null} ts
 * @property {string | null} status
 * @property {{ model: string | null, upstream: string | null, upstreamModel: string | null, route: string | null, format: string | null, api: string | null, source: string | null }} request
 * @property {{ chain: string | null, turn: number | null, turnId: number | null, position: string | null, client: string | null, kind: string | null, native: boolean } | null} session
 *   where the request sits: the archive chain, the turn it opened or continued, its position in the conversation
 * @property {string | null} settingsHash  the settings document in force (a native session's turn), null elsewhere
 * @property {{ form: string | null, version: number | null, historyTokens: number | null, sentTokens: number | null, totalTurns: number | null, rawTurns: number | null, foldedTurns: number | null, stubs: number | null, underSummary: number | null, composed: boolean } | null} view
 * @property {{ n: number, shape: string, tokens: number | null }[]} shapes  per turn of the history, oldest first (native sessions)
 * @property {{ policy: string | null, deduped: number | null, pointers: number | null }} results  the tool-result policy and what it did
 * @property {{ head: { fromTurn: number, toTurn: number, kind: string | null } | null, cut: { stop: string, outputTokens: number } | null, mode: string | null }} compaction
 * @property {{ briefing: number, injected: number, tokens: number, items: number, tools: boolean, loaded: boolean, muted: boolean, quiet: boolean, cue: boolean, cuePlaced: boolean, toolRounds: number, toolCalls: number, recalls: number, blocks: { briefing: number, goal: number, turn: number } } | null} memory
 * @property {{ files: string[], triggered: string[], told: { file: string, as: string, how: string }[], hash: string | null, chars: number | null } | null} instructions
 *   `told`: a folder's files told as the agent worked there, with the file it worked on
 * @property {{ status: string | null, rounds: number | null, toolCalls: number | null, denied: number | null, ruleRuns: number | null, learnedRuns: number | null, recalls: number | null, cappedResults: number | null, web: string[], mcp: Rec[] } | null} agent
 * @property {{ input: number, output: number, cacheRead: number, cacheWrite: number, thinking: number } | null} tokens  what the upstream billed
 * @property {number | null} costUsd
 * @property {number | null} listUsd  the same tokens at list price (Providers P4)
 * @property {"metered" | "plan" | null} billing
 * @property {string[]} notes  routing notes first (`priorChanges`), then what happened (`changes`), as recorded
 * @property {string[]} gaps  what this report cannot say and why (no view stage ran, memory did not sit it, …)
 */

/** @param {unknown} v */
const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
/** @param {unknown} v */
const int = (v) => Math.max(0, Math.floor(Number(v) || 0));

/**
 * The report for one record. `chainKind` is the session's kind, from the archive, when the caller has it.
 * @param {Rec} rec  the request record as `usage.detail` returns it
 * @param {{ chainKind?: string | null }} [extra]
 * @returns {CompositionReport}
 */
export function compositionReport(rec, { chainKind = null } = {}) {
  const view = rec.view && typeof rec.view === "object" ? rec.view : null;
  const mem = rec.memory && typeof rec.memory === "object" ? rec.memory : null;
  /** @type {string[]} */
  const gaps = [];
  const native = !!view?.composed || rec.api === "session";
  if (!view) gaps.push(rec.local || mem?.command ? "answered by Filament itself: no body was composed for a model" : "no view stage ran for this request (an internal call or a Responses body), so the history → sent count is not known");
  if (!mem) gaps.push("memory did not sit this request (memory off, or a call of Filament's own)");
  if (!native && view) gaps.push("a proxied client's request: the history is the client's bytes, as it sent them; per-turn shapes belong to native sessions");
  const shapes = Array.isArray(view?.shapes)
    ? view.shapes.map((s) => ({ n: int(s.n), shape: String(s.shape || "raw"), tokens: numOrNull(s.tokens) }))
    : [];
  const settingsHash = view?.settingsHash || null;
  // The compaction in force is the head the composer found, whichever turn wrote it; the view's `compactions` are only
  // those this turn made (the bug report's P11).
  const headComp = view?.head && typeof view.head === "object" && view.head.toTurn != null
    ? { fromTurn: int(view.head.fromTurn), toTurn: int(view.head.toTurn), kind: view.head.kind ? String(view.head.kind) : null }
    : null;
  return {
    requestId: String(rec.id),
    ts: rec.ts || null,
    status: rec.status || null,
    request: {
      model: rec.model || null,
      upstream: rec.upstream || null,
      upstreamModel: rec.upstreamModel || null,
      route: rec.route || null,
      format: rec.format || null,
      api: rec.api || null,
      source: rec.source || null,
    },
    session: mem
      ? {
          chain: mem.chain || null,
          turn: numOrNull(mem.turn),
          turnId: numOrNull(mem.turnId),
          position: mem.position || null,
          client: mem.client || null,
          kind: chainKind || null,
          native,
        }
      : null,
    settingsHash: settingsHash ? String(settingsHash) : null,
    view: view
      ? {
          form: view.form || null,
          version: numOrNull(view.version),
          historyTokens: numOrNull(view.historyTokens),
          sentTokens: numOrNull(view.sentTokens),
          totalTurns: numOrNull(view.totalTurns),
          rawTurns: numOrNull(view.rawTurns),
          foldedTurns: numOrNull(view.foldedTurns),
          stubs: numOrNull(view.stubs),
          underSummary: numOrNull(view.underSummary),
          composed: !!view.composed,
        }
      : null,
    shapes,
    results: {
      policy: view?.results ? String(view.results) : null,
      deduped: numOrNull(view?.deduped),
      pointers: numOrNull(view?.pointers),
    },
    compaction: {
      head: headComp,
      cut: rec.compactionCut ? { stop: String(rec.compactionCut.stop), outputTokens: int(rec.compactionCut.outputTokens) } : null,
      mode: mem?.position === "compaction" ? "client" : headComp ? headComp.kind || "compaction" : null,
    },
    memory: mem
      ? {
          briefing: int(mem.briefing),
          injected: int(mem.injected),
          tokens: int(mem.tokens),
          items: Array.isArray(mem.ids) ? mem.ids.length : int(mem.injected),
          tools: !!mem.tools,
          loaded: !!mem.loaded,
          muted: !!mem.muted,
          quiet: !!mem.quiet,
          cue: !!mem.cue,
          cuePlaced: !!mem.cuePlaced,
          toolRounds: int(mem.toolRounds),
          toolCalls: int(mem.toolCalls),
          recalls: int(mem.recalls),
          blocks: {
            briefing: int(mem.composition?.briefing),
            goal: int(mem.composition?.goal),
            turn: int(mem.tokens),
          },
        }
      : null,
    instructions: rec.agent?.instructions
      ? {
          files: Array.isArray(rec.agent.instructions.files) ? rec.agent.instructions.files.map(String) : [],
          triggered: Array.isArray(rec.agent.instructions.triggered) ? rec.agent.instructions.triggered.map(String) : [],
          // A folder's files told as the agent worked there (agent/instructions.js `folderInstructions`).
          told: Array.isArray(rec.agent.instructions.told) ? rec.agent.instructions.told.map((/** @type {any} */ t) => ({ file: String(t?.file || ""), as: String(t?.as || ""), how: String(t?.how || "") })) : [],
          hash: rec.agent.instructions.hash ? String(rec.agent.instructions.hash) : null,
          chars: numOrNull(rec.agent.instructions.chars),
        }
      : null,
    agent: rec.agent
      ? {
          status: rec.agent.status || null,
          rounds: numOrNull(rec.agent.rounds),
          toolCalls: numOrNull(rec.agent.toolCalls),
          denied: numOrNull(rec.agent.denied),
          ruleRuns: numOrNull(rec.agent.ruleRuns),
          learnedRuns: numOrNull(rec.agent.learnedRuns),
          recalls: numOrNull(rec.agent.recalls),
          cappedResults: numOrNull(rec.agent.cappedResults),
          web: Array.isArray(rec.agent.web) ? rec.agent.web.map(String) : [],
          mcp: Array.isArray(rec.agent.mcp) ? rec.agent.mcp : [],
        }
      : null,
    tokens: rec.tokens && typeof rec.tokens === "object"
      ? { input: int(rec.tokens.input), output: int(rec.tokens.output), cacheRead: int(rec.tokens.cacheRead), cacheWrite: int(rec.tokens.cacheWrite), thinking: int(rec.tokens.thinking) }
      : null,
    // An agent turn's cost is the loop's whole spend; the shell record's own cost is one round (§9.3.4) — the footer's rule.
    costUsd: numOrNull(rec.agent?.spentUsd) ?? (typeof rec.cost === "number" ? rec.cost : null),
    // The same tokens at list price, by the same rule (Providers P4); an agent turn's is its rounds' (null while
    // none named one), never the shell's own one round. `billing` is how the model is billed: a plan pays $0.
    listUsd: rec.agent?.spentUsd != null ? numOrNull(rec.agent.listUsd) : typeof rec.listCost === "number" ? rec.listCost : null,
    billing: rec.billing === "plan" || rec.billing === "metered" ? rec.billing : null,
    notes: [...(Array.isArray(rec.priorChanges) ? rec.priorChanges : []), ...(Array.isArray(rec.changes) ? rec.changes : [])].map(String),
    gaps,
  };
}

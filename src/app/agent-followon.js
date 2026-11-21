// @ts-check
// A coding agent's turn that goes on within its request (HarnessV3-ACP AC6): Filament's words to the agent as its next
// prompt in the same session — a graph task's sub-agent that ended without its report is asked for it — and the
// bridge's results of the prompts joined into the one turn the request records.

/**
 * The request's body with the turn so far and Filament's next prompt after it. The turn so far is as the archive keeps
 * it — the agent's work and words, and what it took into its running turn — so the bridge, which sends the prompt
 * alone in the same session, counts the chat's turns the session has as the chat will hold them; were the session
 * gone, its seed would say what came before.
 * @param {any} body @param {{ work: any[], final: any[] }} soFar @param {string} words
 */
export function followedBody(body, soFar, words) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  return { ...body, messages: [...messages, ...soFar.work, ...(soFar.final.length ? [{ role: "assistant", content: soFar.final }] : []), { role: "user", content: words }] };
}

/** @param {number | null | undefined} a @param {number | null | undefined} b */
const sum = (a, b) => (a == null || b == null ? null : a + b);

/**
 * Two prompts' usage as the bridges count one turn's (`turnUsage`): added up, each model's apart.
 * @param {any} a @param {any} b
 */
function joinUsage(a, b) {
  const usage = a.usage && b.usage
    ? { input: a.usage.input + b.usage.input, output: a.usage.output + b.usage.output, cacheRead: a.usage.cacheRead + b.usage.cacheRead, cacheWrite: a.usage.cacheWrite + b.usage.cacheWrite, total: sum(a.usage.total, b.usage.total), ...(a.usage.cacheSeen || b.usage.cacheSeen ? { cacheSeen: true } : {}) }
    : a.usage || b.usage || null;
  /** @type {Map<string, any>} */
  const byModel = new Map();
  for (const m of [...(a.modelUsage || []), ...(b.modelUsage || [])]) {
    const was = byModel.get(m.model);
    byModel.set(m.model, was ? { model: m.model, input: was.input + m.input, output: was.output + m.output, cacheRead: was.cacheRead + m.cacheRead, cacheWrite: was.cacheWrite + m.cacheWrite } : m);
  }
  return { usage, modelUsage: byModel.size ? [...byModel.values()] : null };
}

/**
 * What two prompts' runs cost together, by the agent's figures of each run's own (a bridge's `context.cost`): summed,
 * one that said none counting nothing; unknown where either's share of its agent's running total is (`costUnseen`,
 * the first's words for why); none where neither said one.
 * @param {any} a @param {any} b
 * @returns {{ cost: number | null, unseen: string }}
 */
function joinCost(a, b) {
  const unseen = a.costUnseen || b.costUnseen || "";
  if (unseen) return { cost: null, unseen };
  const [ca, cb] = [a.context?.cost, b.context?.cost];
  if (typeof ca !== "number" && typeof cb !== "number") return { cost: null, unseen };
  return { cost: Math.round(((typeof ca === "number" ? ca : 0) + (typeof cb === "number" ? cb : 0)) * 1e6) / 1e6, unseen };
}

/**
 * Two of a request's prompts to its agent, as the one turn its record keeps: what both said, spent and changed; how
 * the session was found, the first's; the rest — how it ended, its context, its account — as the later left it, its
 * context's cost both runs' (`joinCost`).
 * @param {any} a @param {any} b
 */
export function joinTurns(a, b) {
  const { usage, modelUsage } = joinUsage(a, b);
  const { cost, unseen } = joinCost(a, b);
  const context = b.context || a.context;
  return {
    ...b,
    reused: a.reused,
    seeded: a.seeded,
    resumed: a.resumed,
    notes: [...(a.notes || []), ...(b.notes || [])],
    structured: [...(a.structured || []), ...(b.structured || [])],
    usage,
    modelUsage,
    linesAdded: (a.linesAdded || 0) + (b.linesAdded || 0),
    linesRemoved: (a.linesRemoved || 0) + (b.linesRemoved || 0),
    ...(context ? { context: { ...context, cost } } : {}),
    ...(unseen ? { costUnseen: unseen } : {}),
  };
}

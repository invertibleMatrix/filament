// @ts-check
// What a session has spent (HarnessV2 §5.8; Step 6 §2.2): the spend ledger the records feed — the chain's
// `meta.spend`, every model call the session makes, its loop's ticks and its sub-agents' calls included. Spend is
// tracked, never capped: this module only reads the ledger, for the Spend and Cache widgets and the settings answer.

/**
 * The session's usage (Step 6 §2.2/§2.3): the durable ledger's figures for the Spend and Cache widgets — the
 * dollars, the four token columns, what the cache saved against no-cache, the unpriced count ("estimate off"),
 * and the newest request's own numbers. Totals only, from the chain's meta: the widgets never read the ring.
 * `cacheSeen`: the prompt tokens of the requests whose usage said its cache numbers (core/cache-facts.js), which a
 * share read from the cache is taken of — left out by a ledger kept before the count, which its figures speak for.
 * @param {any} chain @param {{ usd: number, listUsd: number, runs: number } | null} [teams]  the teams beside it (`teamsSpendOf`)
 */
export function usageOf(chain, teams = null) {
  const s = chain?.meta?.spend || {};
  const num = (/** @type {any} */ v) => Number(v) || 0;
  const a = s.agents || {};
  return {
    usd: num(s.usd),
    // Of `usd`, its sub-agents' calls (the owner's of 11-05), counted apart from the ledger's first write since
    // (`before`: what the chat had spent until then, none of it told apart); and the teams beside the chat, whose own
    // chats keep their spend (`teamsSpendOf`) — the chat's whole cost is `usd` and theirs.
    agents: { usd: num(a.usd), listUsd: num(a.listUsd), requests: num(a.requests), before: s.agents ? num(a.before) : num(s.usd) },
    teams: teams || { usd: 0, listUsd: 0, runs: 0 },
    // at list price (Providers P4), and how many requests it leaves out (their model has no price card)
    listUsd: num(s.listUsd),
    listUnpriced: num(s.listUnpricedRequests),
    byModel: s.byModel || {},
    requests: num(s.requests),
    input: num(s.inputTokens),
    output: num(s.outputTokens),
    cacheRead: num(s.cacheReadTokens),
    cacheWrite: num(s.cacheWriteTokens),
    // the writes kept an hour, out of `cacheWrite`: they cost twice the input price
    cacheWrite1h: num(s.cacheWrite1hTokens),
    ...(s.cacheSeenTokens != null ? { cacheSeen: num(s.cacheSeenTokens) } : {}),
    savedUsd: num(s.savedUsd),
    unpriced: num(s.unpricedRequests),
    turns: Number(chain?.turns) || 0,
    last: s.last || null,
  };
}

/**
 * What the teams beside a chat have spent (team_v2_plan §5.3: each runs in a chat of its own, its workers' calls on
 * its ledger): their ledgers summed, and how many ran. Read from their meta, never their transcripts. Accounting never
 * breaks what reads it: links or a meta that cannot be read count no team.
 * @param {{ besideOf: (id: string) => string[], metaOf: (id: string, keys: readonly string[]) => any } | null | undefined} archive
 * @param {string} mainId
 * @returns {{ usd: number, listUsd: number, runs: number }}
 */
export function teamsSpendOf(archive, mainId) {
  const out = { usd: 0, listUsd: 0, runs: 0 };
  if (!archive?.besideOf || !mainId) return out;
  try {
    for (const id of archive.besideOf(String(mainId))) {
      const s = archive.metaOf(id, ["spend"])?.spend || {};
      out.usd += Number(s.usd) || 0;
      out.listUsd += Number(s.listUsd) || 0;
      out.runs += 1;
    }
  } catch {
    return { usd: 0, listUsd: 0, runs: 0 };
  }
  out.usd = Math.round(out.usd * 1e6) / 1e6;
  out.listUsd = Math.round(out.listUsd * 1e6) / 1e6;
  return out;
}

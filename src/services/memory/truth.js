// @ts-check
// The session inspector's read side (WP-S): one session's truth — who it is, what is in force over it, what it cost
// and did, what memory did for it, and its family — assembled from the archive chain, the session policies and the
// request records that belong to it. Counts, flags, ids and policy knobs, and the few texts the session's own pages
// show: the goal and the task graph. The transcript is the archive's job, not this one's.
import { driveOf, driveShort } from "../../core/goal-drive.js";
import { graphView } from "../../core/task-graph.js";

/** @typedef {Record<string, any>} Rec */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * The tool legs of a session's turns: the work messages of kind `tool_use` — one per round of a tool loop, counted
 * from the stored kinds without opening a body. Turn semantics as the UI names them (HarnessV2 Phase 6).
 * @param {any} archive @param {{ work?: string[] }[]} turns
 */
export function toolLegsOf(archive, turns) {
  // The archive's own count keeps each turn's between reads (archive.js `toolLegs`).
  if (typeof archive?.toolLegs === "function") return archive.toolLegs(turns);
  const hashes = turns.flatMap((t) => (Array.isArray(t.work) ? t.work : []));
  if (!hashes.length || typeof archive?.messageKinds !== "function") return 0;
  const kinds = archive.messageKinds(hashes);
  return hashes.reduce((n, h) => n + (kinds.get(h) === "tool_use" ? 1 : 0), 0);
}

/**
 * What the request records say about a session: tokens, dollars, the cache, the folds and the cheap calls memory made
 * on its behalf. Pure over the records handed in.
 * @param {Rec[]} records  oldest first, the session's own requests plus memory's calls tagged for it
 * @param {string} chainId
 */
export function trafficOf(records, chainId) {
  // A slash command Filament answered itself (/compact, @mem, /help …) is a record on the chain but not a model call:
  // it is counted apart so the cost picture matches the benchmark's.
  // An agent-loop tick rides the session's own chain (quiet, tools only), so lineage decides child-ness, not the chain;
  // a sub-agent's run rides it the same way.
  const isChild = (r) => !!(r.agentOf || r.subagentOf);
  const own = records.filter((r) => r.memory?.chain === chainId && !r.memoryFor && !r.memory?.command && !isChild(r));
  const commands = records.filter((r) => r.memory?.chain === chainId && r.memory?.command).length;
  const cheap = records.filter((r) => r.memoryFor?.chain === chainId);
  // Everything else handed in: the rounds of the session's own agent turns (the calls that really cost: a turn's own
  // record is $0) and its sub-agents' runs with their rounds. Not sub-agents alone: a session that launched none has
  // its rounds here (HarnessV4_Tasks C8: one drive read this as sub-agents' spend on a session that had none).
  const children = records.filter((r) => !own.includes(r) && !cheap.includes(r) && !r.memory?.command);
  const sum = (rows) => {
    const t = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, thinking: 0 };
    let costUsd = 0;
    let priced = 0;
    let unpriced = 0;
    for (const r of rows) {
      for (const k of Object.keys(t)) t[k] += num(r.tokens?.[k]);
      if (typeof r.cost === "number") {
        costUsd += r.cost;
        priced++;
      } else if (r.status !== "pending") unpriced++;
    }
    const seen = t.input + t.cacheRead;
    return {
      requests: rows.length,
      tokens: t,
      costUsd: round(costUsd, 6),
      pricedRequests: priced,
      unpricedRequests: unpriced,
      cacheHitRate: seen ? round(t.cacheRead / seen, 4) : null,
    };
  };
  const models = new Map();
  for (const r of own) {
    const m = String(r.upstreamModel || r.model || "");
    if (m) models.set(m, (models.get(m) || 0) + 1);
  }
  const views = own.filter((r) => r.view);
  const latestView = views.length ? views[views.length - 1].view : null;
  const byPurpose = new Map();
  for (const r of cheap) {
    const p = String(r.memoryFor?.purpose || "memory");
    const row = byPurpose.get(p) || { purpose: p, calls: 0, tokens: 0, costUsd: 0 };
    row.calls++;
    row.tokens += num(r.tokens?.input) + num(r.tokens?.output) + num(r.tokens?.cacheRead);
    if (typeof r.cost === "number") row.costUsd = round(row.costUsd + r.cost, 6);
    byPurpose.set(p, row);
  }
  return {
    own: sum(own),
    children: sum(children),
    cheap: { ...sum(cheap), byPurpose: [...byPurpose.values()] },
    models: [...models.entries()].map(([model, requests]) => ({ model, requests })),
    commands,
    live: records.some((r) => r.status === "pending"),
    first: own[0]?.ts || records[0]?.ts || null,
    last: own.length ? own[own.length - 1].ts : records.length ? records[records.length - 1].ts : null,
    statuses: own.reduce((acc, r) => ((acc[r.status] = (acc[r.status] || 0) + 1), acc), /** @type {Record<string, number>} */ ({})),
    view: {
      requestsWithView: views.length,
      requestsFolded: views.filter((r) => num(r.view.foldedTurns) > 0).length,
      stubs: views.reduce((n, r) => n + num(r.view.stubs), 0),
      latest: latestView
        ? {
            historyTokens: num(latestView.historyTokens),
            sentTokens: num(latestView.sentTokens),
            foldedTurns: num(latestView.foldedTurns),
            totalTurns: num(latestView.totalTurns),
            stubs: num(latestView.stubs),
            rawTurns: num(latestView.rawTurns),
          }
        : null,
    },
    memory: {
      requestsBriefed: own.filter((r) => num(r.memory?.briefing) > 0).length,
      requestsInjected: own.filter((r) => num(r.memory?.injected) > 0).length,
      itemsInjected: own.reduce((n, r) => n + num(r.memory?.injected), 0),
      tokensInjected: own.reduce((n, r) => n + num(r.memory?.tokens), 0),
      loaded: own.filter((r) => r.memory?.loaded).length,
      quiet: own.filter((r) => r.memory?.quiet).length,
      toolsOffered: own.filter((r) => r.memory?.tools).length,
    },
  };
}

/**
 * The session's goal: what it is, where it stands, and its drive (core/goal-drive.js) — nothing of money (the
 * owner's of 11-05); null when it has none. The truth's `inForce.goal`, and what a page that follows the goal alone
 * asks for.
 * @param {any} goal  the chain's `meta.goal`
 */
export function goalOf(goal) {
  return goal
    ? {
        status: goal.status,
        text: goal.text,
        slice: goal.slice || null,
        sizeClass: goal.estimate?.sizeClass || null,
        drive: driveOf(goal) ? { round: Number(goal.drive.round) || 0, cap: Number(goal.drive.cap) || 0, halted: goal.drive.halted ?? null, words: driveShort(driveOf(goal)) } : null,
        createdAt: goal.createdAt,
        acceptedAt: goal.acceptedAt || null,
        closedAt: goal.closedAt || null,
      }
    : null;
}

/**
 * The whole truth for one chain.
 * @param {{ archive: any, policies: any, lineage: (id: string) => any }} deps
 * @param {string} chainId
 * @param {{ records?: Rec[], capped?: boolean, now?: number, injectionRows?: number }} [opts]
 * @returns {any | null}  null when the chain does not exist
 */
export function sessionTruth({ archive, policies, lineage }, chainId, { records = [], capped = false, now = Date.now(), injectionRows = 50 } = {}) {
  const chain = archive.getChain(chainId);
  if (!chain) return null;
  const meta = chain.meta || {};
  const project = chain.project_id ? archive.getProject(chain.project_id) : null;
  const turns = archive.getTurns(chain.id);
  const finished = turns.filter((t) => t.ended_at != null);
  const compactions = archive.getCompactions(chain.id);
  const byKind = compactions.reduce((acc, c) => ((acc[c.kind || "compaction"] = (acc[c.kind || "compaction"] || 0) + 1), acc), /** @type {Record<string, number>} */ ({}));
  const traffic = trafficOf(records, chain.id);
  const forks = archive.linksFor(chain.id).filter((l) => l.type === "forked" && l.dst === chain.id).length;
  const inj = archive.injections.forChain(chain.id, injectionRows);
  const items = archive.items.list({ chainId: chain.id, limit: 1000 });
  const modelsSeen = new Set([...(chain.model ? [chain.model] : []), ...turns.map((t) => t.model).filter(Boolean), ...traffic.models.map((m) => m.model)]);
  return {
    identity: {
      chainId: chain.id,
      title: chain.title || null,
      project: project ? { id: project.id, name: project.name || null, cwd: project.cwd || null } : chain.project_id ? { id: chain.project_id, name: null, cwd: null } : null,
      client: chain.client || null,
      models: [...modelsSeen],
      startedAt: chain.started_at || null,
      lastAt: chain.last_at || null,
      ageMs: chain.started_at ? Math.max(0, now - chain.started_at) : null,
      idleMs: chain.last_at ? Math.max(0, now - chain.last_at) : null,
      live: traffic.live,
      turns: chain.turns || 0,
      turnRows: turns.length,
      openTurn: turns.length && turns[turns.length - 1].ended_at == null ? turns[turns.length - 1].n : null,
      fork: meta.fork ? { from: meta.fork.from, atTurn: meta.fork.atTurn, at: meta.fork.at || null } : null,
      forks,
      tree: meta.tree || null,
    },
    inForce: {
      muted: !!meta.muted,
      // The permission mode the agent loop's turns run under in this session (`agent/turn.js` writes `meta.agent`
      // on every turn): the mode its newest request fixed, else the session's own as it stands — its calls read it
      // at each call (HarnessV3-AtHome AH-F1); null for a session no loop has touched.
      permissions: meta.agent ? meta.agent.permissions || policies.docFor(chain.id).effective?.loop?.permissions || null : null,
      goal: goalOf(meta.goal),
      // The session's task graph (HarnessV3-TaskGraph) as a page draws it, null before the first add.
      graph: graphView(meta.graph),
      pinned: !!meta.pinned,
      archived: !!meta.archived,
      unread: !!meta.unread,
    },
    cost: {
      requests: traffic.own.requests,
      tokens: traffic.own.tokens,
      costUsd: traffic.own.costUsd,
      pricedRequests: traffic.own.pricedRequests,
      unpricedRequests: traffic.own.unpricedRequests,
      cacheHitRate: traffic.own.cacheHitRate,
      children: traffic.children,
      cheap: traffic.cheap,
      totalUsd: round(traffic.own.costUsd + traffic.children.costUsd + traffic.cheap.costUsd, 6),
      byModel: traffic.models,
      commands: traffic.commands,
      statuses: traffic.statuses,
      firstRequestAt: traffic.first,
      lastRequestAt: traffic.last,
      coverage: {
        ringCapped: capped,
        note: capped
          ? "the request ring is full: requests older than its oldest row are in the request log on disk but not counted here"
          : null,
      },
    },
    activity: {
      turns: chain.turns || 0,
      finishedTurns: finished.length,
      workMessages: turns.reduce((n, t) => n + (t.work?.length || 0), 0),
      // One tool leg = one round of a turn's tool loop: the model's message that called tools (kind tool_use in the
      // work) and the results that answered it. The transcript counts the same messages, so the two numbers agree.
      toolLegs: toolLegsOf(archive, turns),
      compactions: { total: compactions.length, byKind },
      folds: traffic.view,
      cheapCalls: traffic.cheap.byPurpose,
    },
    memory: {
      briefing: !!chain.briefing,
      briefingItems: Array.isArray(meta.briefingIds) ? meta.briefingIds.length : 0,
      ...traffic.memory,
      injections: {
        total: inj.total,
        tokens: inj.tokens,
        used: inj.used,
        unused: inj.unused,
        rows: inj.rows.map((r) => ({ id: r.id, requestId: r.request_id, turnId: r.turn_id, kind: r.kind, ids: r.ids.length, tokens: r.tokens, used: r.used, at: r.created_at })),
      },
      items: {
        total: items.length,
        byStatus: items.reduce((acc, i) => ((acc[i.status] = (acc[i.status] || 0) + 1), acc), /** @type {Record<string, number>} */ ({})),
        byKind: items.reduce((acc, i) => ((acc[i.kind] = (acc[i.kind] || 0) + 1), acc), /** @type {Record<string, number>} */ ({})),
        corrections: items.filter((i) => /correction/i.test(String(i.kind))).length,
      },
      learnedThrough: num(meta.learnedThrough),
      state: chain.state ? { status: chain.state.status || null, open: Array.isArray(chain.state.open) ? chain.state.open.length : 0, done: Array.isArray(chain.state.done) ? chain.state.done.length : 0, learnedAt: chain.state.learnedAt || null } : null,
    },
    lineage: lineage(chain.id),
  };
}

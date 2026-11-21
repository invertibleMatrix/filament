// @ts-check
// The context-fit stage: OBSERVATION only. Every request leaves `rec.context` behind — { window, source, usable,
// estimate, verdict } — the one shape every window question reads (records, the meter, the widgets): which window
// applies, where it came from ("operator" its upstream's model card, "endpoint" the provider's own model listing,
// "builtin" the shipped estimates, null none is known), how much of it this request wants, and the one word for it.
//
// It never rewrites a request, never retries, never refuses one: a request that does not fit goes out as it came and
// the provider's refusal reaches the client untouched. Reshaping on the way out would break the prompt cache — a
// "clear just enough" boundary walks one result forward per request and re-writes the whole prefix, and the bill
// with it (one session: 87 legs, 16.9M tokens, $117). When a session's context outgrows its window, the person
// drives — the `/autofit` command (src/app/commands/autofit.js) compacts exactly as many of the oldest turns as the
// window needs, with the margin they name — deliberately, once, when they say so.
//
// The agent loop's own rounds are not stamped (the loop manages its window itself); the session's strategies (the
// fold, compaction at the line) are the session's own documented shapes, not a middleman — they are what the
// session asked its requests to look like.
import { findUpstream, renderUpstreamModel, agentWindowOf } from "../../../core/routing.js";
import { parseModelSuffix } from "../../../core/shaping.js";
import { contextWindowWithSource } from "../../../core/pricing.js";
import { estimateTokens, estimateBodyTokens } from "../../../core/tokens.js";
import { calibFactor } from "../../../services/token-calib.js";
import { fitVerdict, AUTOFIT_RESERVE_CAP } from "../../../core/autofit.js";
import { discoveredWindows } from "../../../adapters/providers/http.js";

/** @type {import("../context.js").Stage} */
export async function autofit(ctx, deps) {
  const { config } = deps;
  const cfg = config();
  const { body, pre, rec, route, requested, candidates } = ctx;
  const agentRound = !!rec.agentOf; // the loop's own round: its window, its compaction, its recovery
  // The stamp names the upstream whose window the numbers judge: the FIRST candidate, and a failover may serve
  // another whose window differs — the attribution keeps the record honest instead of silently wrong.
  if (agentRound || !Array.isArray(body.messages)) return "continue";
  const firstUp = findUpstream(cfg, candidates[0]?.upstream);
  const sentName =
    renderUpstreamModel(candidates[0]?.upstreamModel ?? route.upstreamModel, requested.base, route.captures || []) ||
    requested.base;
  const win = contextWindowWithSource(
    sentName,
    firstUp?.pricing,
    firstUp ? discoveredWindows(firstUp.id) : null,
    agentWindowOf(firstUp, sentName),
  );
  const factor = calibFactor(firstUp?.id, parseModelSuffix(requested.base, cfg.rules).base);
  const overhead = () => estimateTokens(JSON.stringify(body.system ?? "") + JSON.stringify(body.tools ?? []));
  const est = pre?.responsesBody ? null : estimateBodyTokens(body, "conversation", factor, { weights: ctx.weights ?? null }) + overhead();
  // What the verdict measures against, by lane. A session's composed request carries its composer's own numbers on
  // `pre.composition` — `usable` there IS the compaction line the composer aims at (Step 6: the percentage of the
  // window), so the meter and the machinery can never disagree. A native request has no composer and no line: its
  // reserve is its own reply ask (`max_tokens`, capped) plus head-room — how much input the window leaves this one
  // request after what it asks to answer with.
  const composed = pre?.api === "session" ? pre.composition : null;
  const usable = composed && Number(composed.usable) > 0
    ? Number(composed.usable)
    : win.tokens ? Math.max(0, win.tokens - (Math.min(Number(body.max_tokens) || 4096, AUTOFIT_RESERVE_CAP) + 4096)) : null;
  rec.context = {
    window: win.tokens,
    source: win.source,
    upstream: firstUp?.id ?? null,
    usable,
    estimate: est,
    verdict: fitVerdict({ window: win.tokens, usable, estimate: est }),
  };
  return "continue";
}

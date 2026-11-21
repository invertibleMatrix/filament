// @ts-check
// `/autofit …` typed in a chat Filament runs. Nothing between a client and its provider rewrites a request, so when a request
// was refused for size this is the person's one move: it compacts exactly as many of the session's oldest turns as the window needs —
// never more — or with `status` only says the numbers. Answered before any candidate is chosen, so it never reaches
// a model or an agent.
import { openCommandRecord, answerWith } from "./answer.js";

/**
 * @param {import("../pipeline/context.js").RequestContext} ctx
 * @param {import("../deps.js").AppDeps} deps
 * @param {{ rest: string, command: string }} cmd
 */
export async function answerAutofitCommand(ctx, deps, cmd) {
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream, cwd: true });
  const rest = String(cmd.rest || "").trim();
  const status = rest === "status";
  const margin = /^(\d{1,2})\s*%?$/.exec(rest)?.[1];
  if ((rest && !status && margin == null) || (margin != null && (Number(margin) < 30 || Number(margin) > 95)))
    return void await answerWith(ctx, deps, rec, `/autofit takes a margin (30–95, the share of the compaction line to hold) or "status" — "/autofit", "/autofit 70", "/autofit status".`);
  // The session situate found for the request — a harness turn's own, memory situating the turn or leaving it out —
  // never one made for the command: a fit works on turns a session has.
  const chainId = ctx.memory.session?.chain || null;
  if (!deps.sessions || !chainId)
    return void await answerWith(
      ctx,
      deps,
      rec,
      deps.memory.archive
        ? "/autofit works on Filament's own sessions; this chat's session is not one of them."
        : `No archive, so this chat has no session to fit. ${deps.memory.archiveWhy()}`,
    );
  /** @type {any} */ let out;
  try {
    // `within`: this command is answered inside its own turn — the session's live one, never a reason to refuse.
    out = await deps.sessions.autofit(String(chainId), { status, margin: margin != null ? Number(margin) / 100 : undefined, within: ctx.res });
  } catch (/** @type {any} */ e) {
    out = { note: `failed: ${String(e?.message || e).slice(0, 200)}` };
  }
  const from = out?.compaction?.fromTurn, to = out?.compaction?.toTurn;
  // The harness draws the card in place of the text, so the card carries the answer's note too: the summary it folded
  // in, the parts of the request, the target and what was learned are said nowhere else (HarnessV3-Readiness RD1 a).
  const card = out?.action === "compacted"
    ? {
        kind: "autofit",
        v: 1,
        title: "/autofit — compacted to fit",
        lines: [
          `window ${fmt(out.window)} · compacts at ${fmt(out.usable)}`,
          `before ${fmt(out.now)} → after ${fmt(out.after)} tokens`,
          `${from === to ? `turn ${to}` : `turns ${from}–${to}`} → one summary`,
        ],
        note: out.note,
      }
    : null;
  await answerWith(ctx, deps, rec, `/autofit ${out?.note || "done."}`, { card });
}

const fmt = (n) => (Number(n) || 0).toLocaleString("en-US");

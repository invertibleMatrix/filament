// The context-fit vocabulary: the one verdict word every surface uses, the reply reserve a request's fit is judged
// with, and the reading of a provider's "did not fit" refusal. Nothing here reshapes a request: the pipeline only
// stamps the fit, and the harness's agent loop (the client of its own rounds) is the one reader of `detectOverflow`.

const OVERFLOW_RE =
  /prompt is too long|context[_ ]length|context window|too many (input )?tokens|maximum context|exceeds the context|reduce (the length|your prompt)/i;

/**
 * What the context stamp reserves for the reply before judging a request's fit: its own `max_tokens`, capped. A
 * request that asks for a 128,000-token ceiling (the fallback for models with no stated maximum output) almost never
 * receives that much, so reserving all of it would call a half-full window `edge`. The cap is the same room the
 * composer's max_tokens clamp leaves at the compaction line, so the stamp and the loop hold the same room free.
 */
export const AUTOFIT_RESERVE_CAP = 32_000;

/**
 * The one word every surface (records, run events, the meter, the widgets) uses for "does the next request fit":
 * `unknown` no window is known OR nothing was measured against it; `over` the estimate exceeds the window
 * itself, so no compaction can save it; `edge` at or past the compaction line (or, on a native request, its
 * reserve); `tight` within 10% of it. A non-positive usable figure (a window smaller than its own reserve) carries
 * no edge to measure against, so the verdict judges the window alone.
 * @param {{ window?: number | null, usable?: number | null, estimate?: number | null }} f
 * @returns {"unknown" | "over" | "edge" | "tight" | "fits"}
 */
export function fitVerdict({ window = null, usable = null, estimate = null } = {}) {
  const w = Number(window) || 0;
  const u = Number(usable) > 0 ? Number(usable) : 0;
  const e = Number(estimate);
  if (!w || !Number.isFinite(e)) return "unknown";
  if (e > w) return "over";
  if (u && e >= u) return "edge";
  if (u && e >= u * 0.9) return "tight";
  return "fits";
}

// Does this provider error say the request did not fit? → { limit } (limit null when the text names none).
export function detectOverflow(text) {
  const t = String(text || "");
  if (!OVERFLOW_RE.test(t)) return null;
  let limit = null;
  const m =
    />\s*([\d,]{4,})/.exec(t) ||
    /maximum(?: context length)? is ([\d,]+)/i.exec(t) ||
    /([\d,]+)\s*maximum/i.exec(t) ||
    /context (?:window|length) of ([\d,]+)/i.exec(t) ||
    /limit (?:is|of) ([\d,]+)/i.exec(t);
  if (m) {
    const n = Number(m[1].replace(/,/g, ""));
    if (Number.isFinite(n) && n >= 1000) limit = n;
  }
  return { limit };
}

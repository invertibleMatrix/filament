// @ts-check
// Memory → Activity's "What memory showed, and what the work used" (the memory plan's b4), in words: the rows and lines
// the console draws from `GET /api/memory/metrics`. Pure, so the words are tested without a page.

/** What each layer memory shows through is, as the panel names it (the log's kinds: services/memory/metrics.js LAYERS). */
const LAYER_WORDS = Object.freeze(
  /** @type {Record<string, string>} */ ({
    briefing: "Briefing",
    turn: "Turn block",
    pitfall: "Pitfall on a tool call",
    thread: "Open thread on a tool call",
    erratum: "Correction",
    brief: "Sub-agent's brief",
  }),
);
/** The windows the panel offers. */
export const METRIC_WINDOWS = Object.freeze([
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
]);
/** Whose memories, as the panel names each group. */
const ORIGIN_WORDS = Object.freeze(
  /** @type {Record<string, string>} */ ({ person: "your word", agent: "the agent's notes", finding: "sub-agents' findings", learner: "learned from sessions", other: "other" }),
);
/** What the panel says under its head. */
export const METRICS_NOTE =
  "Each memory shown counts once per showing. It counts as used when the reply repeats a phrase of it, when the turn's tool calls carry a word of it that is rare across memory (a rule obeyed in a command), when the agent confirms it, or when the agent's memory search finds it again. Counts and ids only, never words.";

/** @param {number | null} r */
const pct = (r) => (r == null ? "–" : `${Math.round(r * 100)}%`);
/** @param {number} n */
const num = (n) => Number(n || 0).toLocaleString("en-US");

/**
 * The panel's rows and lines from the route's answer.
 * @param {any} r
 * @returns {{ empty: string | null, rows: { layer: string, shown: string, used: string, rate: string, tokens: string, perTurn: string, again: string }[], lines: string[] }}
 */
export function metricsView(r) {
  const layers = Array.isArray(r?.layers) ? r.layers : [];
  if (!layers.length) return { empty: `Memory showed nothing in the last ${r?.days ?? "–"} days.`, rows: [], lines: [] };
  const rows = layers.map((/** @type {any} */ L) => ({
    layer: LAYER_WORDS[L.layer] || String(L.layer),
    shown: num(L.shown),
    used: L.judged ? `${num(L.used)} of ${num(L.judged)}` : "not judged",
    rate: pct(L.usedRate),
    tokens: num(L.tokens),
    perTurn: L.tokensPerTurn == null ? "–" : num(L.tokensPerTurn),
    again: L.again ? num(L.again) : "–",
  }));
  const origins = (r.origins || []).filter((/** @type {any} */ o) => o.judged);
  const lines = [
    ...(origins.length ? [`Used, by whose memory it is: ${origins.map((/** @type {any} */ o) => `${ORIGIN_WORDS[o.origin] || o.origin} ${pct(o.usedRate)} of ${num(o.judged)}`).join(" · ")}`] : []),
    `Served, then corrected: ${num(r.corrected?.corrected ?? 0)} of the ${num(r.corrected?.shown ?? 0)} memories shown (${pct(r.corrected?.rate ?? null)})`,
    `Fading now: ${num(r.faded ?? 0)} ${r.faded === 1 ? "memory" : "memories"} whose last three showings went unused, left out of turn blocks until one is used`,
  ];
  return { empty: null, rows, lines };
}

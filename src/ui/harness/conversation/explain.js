// @ts-check
// "Explain this request" (HarnessV2 §10.5): the composition report of one request as a dialog — how the body the model
// saw was put together. Sections follow the report: the request, where it sat, the context (shapes, history → sent,
// the result policy), memory's blocks, compaction, the loop, then every note Filament made, in order. Pure rendering
// over the report; the fetch is the caller's.
import { h } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { costWords } from "../../lib/cost.js";

/** @param {string} label @param {any} value */
const kv = (label, value) => (value == null || value === "" ? null : [h("span", { class: "k" }, label), h("span", { class: "v" }, String(value))]);
/** @param {string} title @param {(HTMLElement[] | null)[]} pairs @param {HTMLElement | null} [extra] */
const section = (title, pairs, extra = null) => {
  const cells = pairs.flatMap((p) => p || []);
  if (!cells.length && !extra) return null;
  return h("section", { class: "explain-section" }, h("h4", {}, title), cells.length ? h("div", { class: "kv" }, ...cells) : null, extra);
};
/** @param {number | null | undefined} n */
const tok = (n) => (n == null ? null : `${fmt.n(n)} tok`);

/**
 * The per-turn shapes as a strip: one cell per turn, colour by shape, width by tokens.
 * @param {{ n: number, shape: string, tokens: number | null, adapted?: "translated" | "folded" }[]} shapes
 */
export function shapeStrip(shapes) {
  if (!shapes.length) return null;
  const max = Math.max(1, ...shapes.map((s) => s.tokens || 0));
  return h("div", { class: "explain-strip", role: "img", "aria-label": `${shapes.length} turns by shape` },
    ...shapes.map((s) => h("span", {
      class: `cell shape-${s.shape}${s.adapted === "folded" ? " is-folded" : ""}`,
      style: `flex-grow: ${Math.max(1, Math.round(((s.tokens || 0) / max) * 20))}`,
      title: `turn ${s.n}: ${s.shape}${s.tokens != null ? ` · ${fmt.n(s.tokens)} tok` : ""}${s.adapted === "folded" ? " · folded — its tools have no equivalent here" : s.adapted ? " · rebuilt from another window's vocabulary" : ""}`,
    }, String(s.n))));
}

/**
 * The report as an element. `report` is what `GET /api/requests/:id/composition` returns.
 * @param {any} report  the CompositionReport shape of app/sessions/composition.js (the UI layer does not import the app layer)
 */
export function renderExplain(report) {
  const r = report;
  const v = r.view;
  const shapesByKind = r.shapes.reduce((acc, s) => ((acc[s.shape] = (acc[s.shape] || 0) + 1), acc), /** @type {Record<string, number>} */ ({}));
  const shapeLine = Object.entries(shapesByKind).map(([k, n]) => `${n} ${k}`).join(" · ");
  const request = section("request", [
    kv("model", r.request.model),
    kv("upstream", r.request.upstream && r.request.upstreamModel ? `${r.request.upstream} as ${r.request.upstreamModel}` : r.request.upstream),
    kv("route", r.request.route),
    kv("door", r.request.api === "session" ? "native session" : r.request.format ? `${r.request.format} (proxied)` : null),
    kv("status", r.status),
    kv("billed", r.tokens ? `${fmt.n(r.tokens.input)} in · ${fmt.n(r.tokens.output)} out${r.tokens.cacheRead ? ` · ${fmt.n(r.tokens.cacheRead)} cache read` : ""}${r.tokens.cacheWrite ? ` · ${fmt.n(r.tokens.cacheWrite)} cache write` : ""}` : null),
    kv("cost", r.costUsd != null || r.listUsd != null ? costWords(r.costUsd ?? null, r.listUsd ?? null).text : null),
    kv("billing", r.billing === "plan" ? "on a plan: the request paid $0, its list price kept as analytics" : r.billing === "metered" ? "per token, at the list price" : null),
    kv("settings", r.settingsHash ? `document ${r.settingsHash}` : null),
  ]);
  const session = r.session
    ? section("where it sat", [
        kv("session", r.session.chain ? `${r.session.chain}${r.session.kind ? ` (${r.session.kind})` : ""}` : null),
        kv("turn", r.session.turn != null ? `turn ${r.session.turn}${r.session.position ? ` · ${r.session.position}` : ""}` : r.session.position),
        kv("client", r.session.client),
      ])
    : null;
  const context = v
    ? section("context", [
        kv("form", v.form ? `${v.form === "plain" ? "whole" : v.form}${v.composed ? " (composed by Filament)" : ""}` : null),
        kv("history → sent", v.historyTokens != null && v.sentTokens != null ? `${fmt.n(v.historyTokens)} → ${fmt.n(v.sentTokens)} tok${v.historyTokens ? ` (${fmt.pct(v.sentTokens / v.historyTokens)})` : ""}` : null),
        kv("turns", v.totalTurns != null ? `${fmt.n(v.totalTurns)} in history${shapeLine ? ` — ${shapeLine}` : v.foldedTurns ? ` — ${v.foldedTurns} folded` : ""}` : null),
        kv("under a summary", v.underSummary ? `${v.underSummary} turn${v.underSummary === 1 ? "" : "s"}` : null),
        kv("results", r.results.policy ? `${r.results.policy}${r.results.deduped ? ` · ${r.results.deduped} deduped` : ""}${r.results.pointers ? ` · ${r.results.pointers} pointers` : ""}` : null),
        kv("stubs", v.stubs ? fmt.n(v.stubs) : null),
      ], shapeStrip(r.shapes))
    : null;
  const mem = r.memory
    ? section("memory", [
        kv("state", r.memory.muted ? "muted (recording, not injecting)" : r.memory.quiet ? "quiet (a loop's own tick)" : "on"),
        kv("briefing", r.memory.blocks.briefing ? `${fmt.n(r.memory.blocks.briefing)} tok in the system prompt` : r.memory.briefing ? `${r.memory.briefing} items on this message` : "none"),
        kv("this turn", r.memory.injected ? `${r.memory.injected} item${r.memory.injected === 1 ? "" : "s"} · ${fmt.n(r.memory.tokens)} tok` : "nothing added"),
        kv("goal", r.memory.blocks.goal ? `${fmt.n(r.memory.blocks.goal)} tok` : null),
        kv("tools", r.memory.tools ? `offered${r.memory.toolRounds ? ` · used in ${r.memory.toolRounds} round${r.memory.toolRounds === 1 ? "" : "s"} (${r.memory.toolCalls} call${r.memory.toolCalls === 1 ? "" : "s"}${r.memory.recalls ? `, ${r.memory.recalls} recall${r.memory.recalls === 1 ? "" : "s"}` : ""})` : ""}` : "not offered"),
        kv("loaded", r.memory.loaded ? "a past session was loaded into this request" : null),
        kv(
          "cue",
          r.memory.cue
            ? (r.memory.cuePlaced
              ? "a one-line cue was placed before the reply"
              : "memory found related sessions here (this request's history is Filament's own; the cue is data on this record, never placed in front)")
            : null,
        ),
      ])
    : null;
  const comp = section("compaction", [
    kv("in force", r.compaction.head ? `turns ${r.compaction.head.fromTurn}–${r.compaction.head.toTurn} stand as a ${r.compaction.head.kind || "compaction"} summary` : null),
    kv("mode", r.compaction.mode && !r.compaction.head ? r.compaction.mode : null),
    kv("cut", r.compaction.cut ? `the summary stopped at the output cap (${r.compaction.cut.stop}, ${fmt.n(r.compaction.cut.outputTokens)} tok)` : null),
  ]);
  const agent = r.agent
    ? section("the loop", [
        kv("outcome", r.agent.status),
        kv("rounds · tool calls", r.agent.rounds != null ? `${r.agent.rounds} · ${r.agent.toolCalls ?? 0}` : null),
        kv("rules", r.agent.denied || r.agent.ruleRuns ? `${r.agent.denied || 0} refused · ${r.agent.ruleRuns || 0} ran on a rule` : null),
        kv("learned", r.agent.learnedRuns ? `${r.agent.learnedRuns} ran on a learned permission` : null),
        kv("recalls", r.agent.recalls ? fmt.n(r.agent.recalls) : null),
        kv("capped results", r.agent.cappedResults ? fmt.n(r.agent.cappedResults) : null),
        kv("web", r.agent.web.length ? r.agent.web.join(", ") : null),
        kv("mcp", r.agent.mcp.length ? r.agent.mcp.map((m) => `${m.name}${m.tools != null ? ` (${m.tools} tools${m.problem ? ", did not answer" : ""})` : m.problem ? " (left out)" : ""}`).join(", ") : null),
        kv("instructions", r.instructions ? `${r.instructions.files.length ? r.instructions.files.join(", ") : "no files"}${r.instructions.triggered.length ? ` · skills: ${r.instructions.triggered.join(", ")}` : ""}${r.instructions.hash ? ` · ${r.instructions.hash}` : ""}` : null),
        // A folder's files, told as the agent worked there.
        kv("told as it worked", r.instructions?.told?.length ? r.instructions.told.map((/** @type {any} */ t) => `${t.file} (as it ${t.how === "edit" ? "edited" : t.how === "write" ? "wrote" : "read"} ${t.as})`).join(", ") : null),
      ])
    : null;
  const notes = r.notes.length
    ? h("section", { class: "explain-section" }, h("h4", {}, `what Filament did (${r.notes.length})`), h("ol", { class: "explain-notes" }, ...r.notes.map((n) => h("li", {}, n))))
    : null;
  const gaps = r.gaps.length ? h("p", { class: "muted small explain-gaps" }, r.gaps.join(" ")) : null;
  return h("div", { class: "explain" }, request, session, context, mem, comp, agent, notes, gaps);
}

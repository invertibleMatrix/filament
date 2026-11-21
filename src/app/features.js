// @ts-check
// The Feature board (HarnessV2 §10.6): one screen, one row per feature — translation, memory, compaction,
// per-session config, the loop, forks — with its global switch, its state in the session that is open, a number from
// the owner's own traffic (the request records in RAM and the archive), and where the evidence lives. Pure over what
// it is handed; the admin row gathers the inputs.
import { findRoute, findUpstream } from "../core/routing.js";
import { parseModelSuffix } from "../core/shaping.js";
import { parseAgentModel } from "./agent/turn.js";
import { UPSTREAM_TYPES } from "../core/schema.js";
import { methodName } from "../core/context-words.js";

/** @typedef {Record<string, any>} Rec */
/**
 * @typedef {object} Feature
 * @property {string} id
 * @property {string} label
 * @property {string} what  one sentence: what the feature does
 * @property {{ on: boolean, key: string, value: string }} switch  the global switch as the config has it: `value` in
 *   words (HarnessV3-Launch LD-D10), `key` the config path the board's tooltips name
 * @property {{ on: boolean | null, state: string, detail?: string } | null} session  its state in the open session, null without one
 * @property {{ value: number, what: string, source: "records" | "archive" }} count  a number from the owner's own sessions
 * @property {{ label: string, href: string }} evidence  where the numbers can be checked: a harness route (`#/…`), or
 *   a console page, which the board opens in a tab of its own
 * @property {{ label: string, action: string, under: string, settings?: any, defaults?: boolean } | null} compare  the
 *   replay-compare action, where one makes sense: the copy runs under `settings` over the session's own, or under your
 *   defaults alone (`defaults`); `under` says it in words
 */

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Every request's record: the console's Records, as Settings › About links it (the owner's of 11-09). */
const RECORDS = "/ui/#requests";

/** What a fork's transcript is, in words (the `fork.transcript` options). */
const FORK_TRANSCRIPT = Object.freeze({
  ditto: "The transcript as it was",
  folds: "Every inherited turn folded",
  brief: "One summary of the lineage",
});
/**
 * What a fork gets, in words (HarnessV3-Launch LD-D10): its transcript, with whose settings. Both come from resolved
 * settings, which hold one of each setting's choices.
 * @param {keyof typeof FORK_TRANSCRIPT} transcript @param {string} settings
 */
const forkWords = (transcript, settings) =>
  `${FORK_TRANSCRIPT[transcript]}, with ${settings === "project" ? "the project's settings alone" : "the session's own settings"}`;
/** @param {Rec[]} records @param {(r: Rec) => boolean} test */
const countRecords = (records, test) => records.reduce((n, r) => n + (test(r) ? 1 : 0), 0);

/**
 * The format an upstream speaks natively (the first of its type's formats), for saying whether a session's traffic
 * is translated. @param {any} cfg @param {string} model
 */
function wireOf(cfg, model) {
  const asked = parseModelSuffix(model, cfg.rules || {});
  const inner = parseAgentModel(asked.base)?.model || asked.base;
  const route = findRoute(cfg, inner) || findRoute(cfg, model);
  const up = route ? findUpstream(cfg, route.upstream) : null;
  const formats = up ? /** @type {any} */ (UPSTREAM_TYPES)[up.type]?.formats || [] : [];
  return { route: route?.match || null, upstream: up?.id || null, type: up?.type || null, formats };
}

/**
 * @param {{ cfg: any, records: Rec[], archive?: any | null, session?: { id: string, truth: any, settings: any } | null }} a
 *   `records`: the request ring, oldest first; `archive`: the memory archive when memory is on; `session`: the open
 *   session's truth (`sessionTruth`) and settings (`settingsOf`) when a session is open.
 * @returns {{ generatedAt: number, window: { records: number, oldest: string | null }, archive: boolean, session: string | null, features: Feature[] }}
 *   `archive`: whether memory's archive was read (the board's line names it only then, HarnessV3-Launch LD-D18)
 */
export function featureBoard({ cfg, records, archive = null, session = null }) {
  const own = records.filter((r) => r && !r.memoryFor && !r.local && r.status !== "pending");
  const chainCounts = archive?.chainCounts ? archive.chainCounts() : null;
  const counts = archive?.counts ? archive.counts() : null;
  const truth = session?.truth || null;
  const eff = session?.settings?.effective || null;
  const sources = session?.settings?.sources || {};
  const sessionLayer = Object.entries(sources).filter(([, v]) => v === "session").map(([k]) => k);
  const model = String(eff?.model?.name || truth?.identity?.models?.[0] || "");
  const wire = model ? wireOf(cfg, model) : null;
  const loopModel = model ? parseAgentModel(model) : null;
  const translateMode = String(cfg.rules?.translate?.mode || "auto");
  const memOn = cfg.memory?.enabled === true;
  const autoOn = memOn && cfg.memory?.autopilot?.enabled !== false;
  const comp = truth?.activity?.compactions || { total: 0, byKind: {} };
  const sessionInj = truth?.memory?.injections || null;

  /** @type {Feature[]} */
  const features = [
    {
      id: "translation",
      label: "Translation",
      what: "A request in one wire format answered by an upstream that speaks another: the body, the tools and the stream are translated both ways.",
      switch: { on: translateMode !== "never", key: "rules.translate.mode", value: translateMode === "never" ? "Off: a request in a format the provider doesn't speak is refused" : "On whenever the formats differ" },
      session: session
        ? wire && wire.upstream
          ? wire.formats.includes("anthropic")
            ? { on: false, state: "not needed", detail: `${wire.upstream} (${wire.type}) speaks the harness's format` }
            : { on: true, state: "translating", detail: `anthropic → ${wire.formats[0] || wire.type} for ${wire.upstream}` }
          : { on: null, state: "no route for this session's model" }
        : null,
      count: { value: countRecords(own, (r) => !!r.translatedFormats), what: "requests translated between formats", source: "records" },
      evidence: { label: "Records", href: RECORDS },
      compare: null,
    },
    {
      id: "memory",
      label: "Memory",
      what: "Sessions archived, facts learned at idle, a briefing and per-turn recall placed in the prompt, memory tools offered to the model.",
      switch: { on: memOn, key: "memory.enabled · memory.autopilot.enabled", value: memOn ? (autoOn ? "On, with recall in every request" : "On, without automatic recall") : "Off" },
      session: session
        ? truth?.inForce?.muted || eff?.memory?.enabled === false
          ? { on: false, state: "muted", detail: "recording, not injecting (memory.enabled false on this session)" }
          : { on: true, state: "on", detail: `${truth?.memory?.briefing ? `briefing of ${truth.memory.briefingItems} items` : "no briefing"} · ${sessionInj?.total || 0} injection${sessionInj?.total === 1 ? "" : "s"} (${sessionInj?.used || 0} used) · ${truth?.memory?.items?.total || 0} items learned` }
        : null,
      count: { value: counts ? num(counts.injections) : countRecords(own, (r) => num(r.memory?.injected) > 0), what: counts ? "memory injections archived" : "requests that got memory injected", source: counts ? "archive" : "records" },
      evidence: { label: "Memory", href: "#/settings/memory" },
      compare: session ? { label: "Replay with memory off", action: "replay-compare", under: "memory off", settings: { memory: { enabled: false } } } : null,
    },
    {
      id: "compaction",
      label: "Compaction",
      what: "The window kept in bounds: a session's turns go whole until its compaction line, then make room its own way; /autofit fits a session on command. A client's own compaction goes to its model — nothing rewrites a request between a client and its provider.",
      switch: { on: true, key: "(always on)", value: "Always on in a chat Filament runs · /compact and /autofit on command" },
      session: session
        ? { on: true, state: `${methodName(eff?.context?.compaction?.method || "summary", { keepWhole: eff?.context?.compaction?.keepWhole })}${eff?.context?.compaction?.mode === "auto" ? " · makes room by itself" : ""}`, detail: `${comp.total || 0} compaction${comp.total === 1 ? "" : "s"}${comp.total ? ` (${Object.entries(comp.byKind || {}).map(([k, n]) => `${n} ${k}`).join(", ")})` : ""}` }
        : null,
      count: counts
        ? { value: num(counts.compactions), what: `compaction summaries archived${chainCounts ? ` (${Object.entries(chainCounts.compactionsByKind).map(([k, n]) => `${n} ${k}`).join(", ") || "none"})` : ""}`, source: "archive" }
        : { value: countRecords(records, (r) => r?.memoryFor?.purpose === "compact" && r.status !== "pending"), what: "compaction summaries written (calls in the request log)", source: "records" },
      evidence: { label: "Usage stats", href: "#/settings/usage" },
      compare: session ? { label: "Replay with tool results as one line", action: "replay-compare", under: "tool results as one line", settings: { context: { results: "line" } } } : null,
    },
    {
      id: "session-config",
      label: "Per-session config",
      what: "One settings document in three layers — global, project, session — resolved at every turn, hashed onto every turn, edited in the inspector.",
      switch: { on: true, key: "(always on)", value: "Always on: three layers, every setting live" },
      session: session
        ? { on: sessionLayer.length > 0, state: sessionLayer.length ? `${sessionLayer.length} setting${sessionLayer.length === 1 ? "" : "s"} chosen for this session` : "global and project layers only", detail: `document ${session.settings?.hash || "–"}` }
        : null,
      count: { value: chainCounts ? num(chainCounts.withSettings) : 0, what: "sessions with a document of their own", source: "archive" },
      evidence: { label: "Records", href: RECORDS },
      compare: session ? { label: "Replay under your defaults", action: "replay-compare", under: "your defaults", defaults: true } : null,
    },
    {
      id: "loop",
      label: "Agent loop",
      what: "Filament's own hands (read, write, edit, bash, grep, glob, web, MCP) under a permission mode, rules and hooks; the model plans, acts and asks.",
      // Always on (the owner's of 11-09): Filament's own loop has no switch.
      switch: { on: true, key: "agentLoop.permissions", value: `Always on, in ${cfg.agentLoop?.permissions || "edit"} mode by default` },
      session: session
        ? loopModel
          ? { on: true, state: `${truth?.inForce?.permissions || eff?.loop?.permissions || "edit"} mode`, detail: `${(eff?.loop?.rules || []).length} rule${(eff?.loop?.rules || []).length === 1 ? "" : "s"} · ${(eff?.hooks || []).length} hook${(eff?.hooks || []).length === 1 ? "" : "s"} · ${truth?.activity?.toolLegs ?? 0} tool legs so far` }
          : { on: false, state: "a plain model (no hands)" }
        : null,
      count: { value: countRecords(own, (r) => !!r.agent), what: "agent-loop turns", source: "records" },
      evidence: { label: "Records", href: RECORDS },
      compare: null,
    },
    {
      id: "fork",
      label: "Fork",
      what: "A session copied at a turn as a new one — the transcript as it was, folded or as one summary; the results kept or cleared; the working tree rewound.",
      switch: { on: true, key: "fork.transcript · fork.settings (per session)", value: eff ? forkWords(eff.fork.transcript, eff.fork.settings) : `${forkWords("ditto", "inherit")} (by default)` },
      session: session
        ? truth?.identity?.fork
          ? { on: true, state: `forked from ${truth.identity.fork.from} at turn ${truth.identity.fork.atTurn}`, detail: `${truth.identity.forks || 0} fork${truth.identity.forks === 1 ? "" : "s"} taken from this session` }
          : { on: false, state: "not a fork", detail: `${truth?.identity?.forks || 0} fork${truth?.identity?.forks === 1 ? "" : "s"} taken from this session` }
        : null,
      count: { value: chainCounts ? num(chainCounts.byKind.fork) : 0, what: "fork sessions in the archive", source: "archive" },
      evidence: { label: "Sessions", href: "#/" },
      compare: session ? { label: "Replay the last turns under your defaults", action: "replay-compare", under: "your defaults", defaults: true } : null,
    },
  ];
  return {
    generatedAt: Date.now(),
    window: { records: own.length, oldest: own.length ? own[0].ts || null : null },
    archive: archive != null,
    session: session?.id || null,
    features,
  };
}

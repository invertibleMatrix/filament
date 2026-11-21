// @ts-check
// A run's spine, docked as a side-pane tab: one station per round, a lamp for its state, what the round thought, said
// and met under it, and a metrics strip. The maximised room (control-room.js) renders the same spine, so a replay
// looks the same in both.
import { h, morphChildren } from "../../lib/dom.js";
import { api, followRun, RUN_GONE } from "../lib/api.js";
import { routeFor } from "../lib/router.js";
import { earlierCompactionWords, outputCutWords, windowSourceWords } from "../lib/labels.js";
import { onceAFrame } from "../lib/once-a-frame.js";

/** A token figure the spine's size: 82,000 → "~82k". @param {number} n */
const kTok = (n) => `~${Math.max(1, Math.round(n / 1000))}k`;

/**
 * One sentence for each shape of the loop's compaction event (Step 4 D6): rounds compacted, with the numbers; a
 * fold that left the conversation past its line and stood the line down; a round the provider refused for size, retried once; a
 * Compact that folded nothing. And a coding agent's own (HarnessV3-ACP AC2-1): its figures, or why it failed.
 * @param {any} e
 */
export function compactionWords(e) {
  if (e?.own) {
    const who = e.by || "The agent";
    if (e.result === "failed") return `${who} could not compact its context${e.error ? `: ${e.error}` : "."}`;
    const figures = e.tokensBefore > 0 && e.tokensAfter > 0 ? ` (${kTok(e.tokensBefore)} → ${kTok(e.tokensAfter)} tok)` : e.tokensBefore > 0 ? ` at ${kTok(e.tokensBefore)} tok` : "";
    return `${who} compacted its own context${e.manual ? " on request" : ""}${figures} — what came before is a summary in its session now.`;
  }
  // The loop's own compaction writes one summary of the older rounds: said as a summary, never a fold (U3, UX-4).
  if (e?.manual && e.result === "little") return "Compact asked — this turn has too little finished work to summarize yet; nothing was summarized.";
  if (e?.manual && e.result === "empty") return "Compact asked — the summarizer came back empty, so nothing was summarized.";
  if (e?.earlier) return `${earlierCompactionWords(e)}.`;
  if (e?.stoodDown) return "Folding this turn's rounds left the conversation past its line (the earlier turns hold the rest) — standing down for the rest of this turn; the next message makes room in the whole session.";
  if (e?.why === "overflow-refusal") {
    const how = [
      e.cleared ? `clearing ${e.cleared} old tool result${e.cleared === 1 ? "" : "s"}` : null,
      e.folded ? "summarizing the oldest rounds into one" : null,
    ].filter(Boolean);
    return `The provider refused a round for size — retried once${how.length ? ` after ${how.join(" and ")}` : ", with nothing to clear or summarize"}.`;
  }
  // A fork's summary read the live conversation from the provider's cache (turn.js `forkRounds`), not a transcript.
  return `Compacted rounds ${e?.fromRound}–${e?.toRound} into a summary${e?.fork ? " written from the warm cache" : ""} (${kTok(e?.tokensBefore || 0)} → ${kTok(e?.tokensAfter || 0)} tok).`;
}

/**
 * The window the turn runs against, from the loop's `window` event: its size, where the number came from, the
 * compaction line. @param {any} w
 */
export function windowLine(w) {
  if (!w?.window) return `Window ${windowSourceWords(null)} — the window machinery stands down.`;
  return `Window ${kTok(w.window).slice(1)} — ${windowSourceWords(w.source)}${w.usable ? ` · compacts ${kTok(w.usable).slice(1)}` : ""}`;
}

/**
 * Group a run's events into stations. Pure — the scrubber reuses it with a prefix of the list, and the maximised
 * room reads where the run stands from it.
 * @param {any[]} events
 * @returns {{ rounds: any[], metrics: any, ended: boolean, summary: any, window: any }}
 */
export function stationsFrom(events) {
  const fold = stationsFold();
  for (const e of events || []) fold.add(e);
  return fold.view();
}

/**
 * The stations folded one event at a time, read as they stand at any point (`view`): a live spine folds each event as
 * it comes, where it grouped the whole run again at each one — its work grew with the run. `stationsFrom` is this fold
 * over a list.
 */
export function stationsFold() {
  /** @type {Map<number, any>} */
  const rounds = new Map();
  /** @param {number} n */
  const round = (n) => {
    if (!rounds.has(n)) rounds.set(n, { n, state: "waiting", thought: "", text: "", ask: "", bodies: [] });
    return rounds.get(n);
  };
  let current = 0;
  let ended = false;
  /** @type {any} */
  let summary = null;
  /** The loop's window event, once per turn. @type {any} */
  let win = null;
  /** @param {any} e */
  const add = (e) => {
    if (e.type === "round-start") {
      current = e.round || current + 1;
      // A round ends when the next one starts: the loop calls the model once a round, one round at a time.
      for (const r of rounds.values()) if (r.state === "running" && r.n < current) r.state = "done";
      round(current).state = "running";
    }
    else if (e.type === "round-thinking") { const r = round(e.round || current); r.thought = e.thinking || r.thought; }
    else if (e.type === "round-text") { const r = round(e.round || current); if (e.text) r.text = (r.text + e.text).slice(-2000); }
    else if (e.type === "ask") { round(e.round || current).ask = e.question || ""; }
    else if (e.type === "vetoed") {
      round(e.round || current).bodies.push({ kind: "vetoed", text: e.text ? `Vetoed: ${e.text}` : "The round was vetoed." });
    } else if (e.type === "budget") {
      // The rail that ended the turn, in the round it bit: without this a budget-stopped run just goes quiet. The
      // output ceiling is the one rail a turn has.
      round(e.round || current).bodies.push({ kind: "budget", text: "Stopped at its output ceiling." });
    } else if (e.type === "output-cut") {
      // A cut the turn went on from (HarnessV3-TaskGraph-v2 TG2-D62).
      round(e.round || current).bodies.push({ kind: "budget", text: outputCutWords(e) });
    } else if (e.type === "compacting") {
      // A coding agent's compaction before its first model call (round 0) stands at the first round's station.
      round(e.round || current || 1).bodies.push({ kind: "folding", text: e.own ? `${e.by || "The agent"} is compacting its own context…` : e.earlier ? "Making room in the whole chat: the earlier turns give way first…" : "Compacting the oldest rounds into a summary to stay inside the window…" });
    } else if (e.type === "compaction") {
      // The window edge: what left the live context (the run log keeps every round), a stand-down, a refused round.
      // Only a fold counts in the metrics' compactions: not a Compact that folded nothing, or an agent's that failed.
      const folded = !e.stoodDown && !e.result && (e.why !== "overflow-refusal" || !!e.folded);
      round(e.round || current || 1).bodies.push({ kind: folded ? "compaction" : "folding", text: compactionWords(e) });
    } else if (e.type === "window") {
      win = e;
    } else if (e.type === "stopped") {
      round(e.round || current).bodies.push({ kind: "stopped", text: e.text ? `Stopped: ${e.text}` : "The run was stopped." });
    } else if (e.type === "run-end") {
      ended = true;
      summary = e.summary || null;
      for (const r of rounds.values()) if (r.state === "running") r.state = e.status === "error" ? "failed" : "done";
    }
  };
  /** @returns {{ rounds: any[], metrics: any, ended: boolean, summary: any, window: any }} */
  const view = () => {
    const list = [...rounds.values()].sort((a, b) => a.n - b.n);
    return {
      rounds: list,
      ended,
      summary,
      window: win,
      metrics: {
        rounds: list.length,
        compactions: list.reduce((n, r) => n + r.bodies.filter((/** @type {any} */ b) => b.kind === "compaction").length, 0),
      },
    };
  };
  return { add, view };
}

/**
 * The metrics strip both views share. Tiles whose data the events do not carry are absent, never invented.
 * @param {any} view
 * @param {{ maximise?: boolean, runId?: string }} [opts]
 */
export function renderMetrics(view, opts = {}) {
  return h("div", { class: "run-metrics", "data-key": "metrics" },
    metric("Rounds", String(view.metrics.rounds)),
    view.metrics.compactions ? metric("Compactions", String(view.metrics.compactions)) : null,
    view.summary?.inputTokens ? metric("Tokens in", String(view.summary.inputTokens)) : null,
    view.summary?.childCostUsd ? metric("$", `$${Number(view.summary.childCostUsd).toFixed(4)}`) : null,
    opts.maximise || !opts.runId ? null : h("a", { class: "ghost sm", href: routeFor("control-room", { id: opts.runId }) }, "Maximise"));
}

/** @param {string} label @param {string} value */
const metric = (label, value) => h("div", { class: "run-metric" }, h("span", { class: "run-metric-label" }, label), h("span", { class: "run-metric-value" }, value));

/**
 * The docked spine. Follows a live run; an ended run gets the replay scrubber.
 * @param {HTMLElement} host
 * @param {{ runId: string, maximise?: boolean, events?: any[], live?: boolean }} o
 * @returns {{ el: HTMLElement, load: () => Promise<void>, stop: () => void, refresh: () => void }}
 */
export function renderRun(host, o) {
  const el = h("div", { class: "run-spine" }, h("div", { class: "pane-empty" }, "Loading the run…"));
  host.append(el);
  /** @type {any[]} */
  let events = [];
  /** @type {{ requested: number, firstAvailable: number } | null} */
  let gap = null;
  let truncated = 0;
  /** The server no longer holds the run's log (its follow answered so): said, not a lamp that runs for ever. */
  let missing = false;
  /** @type {{ stop: () => void } | null} */
  let follower = null;
  /** The run's events folded so far, the log they came from and how many of it, and whether its end was among them. */
  let fold = stationsFold();
  /** @type {any[] | null} */
  let foldedOf = null;
  let folded = 0;
  let endFolded = false;
  /** The stations of the whole log as it stands: only the events since the last paint are folded in. */
  const whole = () => {
    if (foldedOf !== events || folded > events.length) {
      fold = stationsFold();
      foldedOf = events;
      folded = 0;
      endFolded = false;
    }
    while (folded < events.length) {
      const e = events[folded++];
      fold.add(e);
      if (e.type === "run-end") endFolded = true;
    }
    return fold.view();
  };

  const paint = (upto = events.length) => {
    const all = whole();
    const view = upto >= events.length ? all : stationsFrom(events.slice(0, upto));
    const scrub = el.querySelector(".run-scrub-row");
    // The scrubber stays mounted for the whole replay: `view.ended` is false for any prefix that stops before the
    // run-end event, and judging by it would delete the control the moment it was dragged.
    const replay = endFolded && events.length > 1;
    // Drawn in place, each part keyed by what it is and each station by its round: a paint at every event of a
    // streaming reply made the Maximise link and the stations anew under a resting pointer (the owner's of 11-01:
    // buttons blinking under a resting pointer, clicks lost). The scrubber that stands is passed as itself.
    morphChildren(el, [
      gap ? h("p", { class: "pane-note", "data-key": "gap" }, `Events ${gap.requested + 1}–${gap.firstAvailable - 1} are no longer in the log.`) : null,
      truncated ? h("p", { class: "pane-note", "data-key": "truncated" }, `Showing the first ${events.length} events; the run is longer.`) : null,
      missing ? h("p", { class: "pane-note", "data-key": "missing" }, RUN_GONE) : null,
      renderMetrics(view, o),
      view.window ? h("p", { class: "pane-note run-window", "data-key": "window" }, windowLine(view.window)) : null,
      replay ? (scrub || scrubber(events.length)) : null,
      view.rounds.length ? h("div", { class: "run-stations", "data-key": "stations" }, ...view.rounds.map((r, i) => station(r, i, view))) : h("div", { class: "pane-empty", "data-key": "empty" }, "This run has no rounds yet.")]);
  };

  const paintSoon = onceAFrame(() => {
    if (el.isConnected) paint();
  });

  /** @param {any} r @param {number} i @param {any} view */
  const station = (r, i, view) => {
    const passed = view.rounds.slice(0, i).every((/** @type {any} */ x) => x.state === "done");
    const rail = r.state === "running" ? "live" : passed ? "passed" : "";
    return h("div", { class: `run-station ${r.state}`, "data-key": String(r.n) },
      h("span", { class: `run-rail ${rail}` }),
      h("div", { class: "run-station-head" },
        h("span", { class: `run-lamp ${r.state}` }),
        h("span", { class: "run-station-title" }, `Round ${r.n}`)),
      r.thought ? h("div", { class: "run-thought" }, r.thought.slice(-180)) : null,
      r.text ? h("div", { class: "run-body" }, r.text.slice(-400)) : null,
      r.ask ? h("div", { class: "run-body ask" }, r.ask) : null,
      ...r.bodies.map((/** @type {any} */ b) => h("div", { class: `run-body ${b.kind}` }, b.text)));
  };

  /** @param {number} total */
  const scrubber = (total) => {
    const range = h("input", { class: "run-scrub", type: "range", min: "1", max: String(total), value: String(total) });
    range.addEventListener("input", () => paint(Number(/** @type {HTMLInputElement} */ (range).value)));
    return h("div", { class: "run-scrub-row", "data-key": "scrub" }, h("span", {}, "Replay"), range);
  };

  const load = async () => {
    // A caller that already holds the events (the maximised room's expanded spine) renders them and follows nothing —
    // a second stream on the same run would leak when the room closes.
    if (o.events) { events = o.events; paint(); return; }
    const page = await api(`/runs/${encodeURIComponent(o.runId)}/events?limit=50000`);
    events = page?.events || [];
    gap = page?.gap || null;
    truncated = page?.run?.events && page.run.events > events.length ? page.run.events : 0;
    paint();
    if (o.live !== false && !events.some((e) => e.type === "run-end")) follow();
  };

  const follow = () => {
    const last = events.at(-1);
    follower = followRun(o.runId, {
      since: last?.n || 0,
      onEvent: (e) => {
        // Detached only means the tab switched away — the spine cache re-adopts this same node, so the stream
        // keeps running (painting into a detached node is harmless) and revival is automatic. The run's own end,
        // or the cache's eviction, closes it. Drawn once a frame, however many events land in it.
        events.push(e);
        if (el.isConnected) paintSoon();
      },
      onGap: (g) => { gap = g; if (el.isConnected) paint(); },
      onMissing: () => { missing = true; if (el.isConnected) paint(); },
    });
  };

  const stop = () => follower?.stop();

  return { el, load, stop, refresh: () => paint() };
}

/** The live spines, one per run: a pane redraw (every pulse while a run streams) re-adopts the same nodes — the
 * events, the follower and the scrubber position survive, instead of a fresh 50 000-event pull per redraw. */
const spines = new Map();

/**
 * The docked Run tab: this chat's own live run. The run list cannot be filtered to a chat — a
 * run's stored session key is not the archive chain id, and disk-only runs carry no meta at all — so guessing would
 * show another chat's run. The conductor already knows which run this chat opened.
 * @param {HTMLElement} body
 * @param {{ chat: any }} ctx
 */
export function renderRunPane(body, ctx) {
  const runId = ctx.chat?.live?.runId || "";
  const box = h("div", { class: "pane-scroll", "data-run": runId });
  body.append(box);
  if (!runId) {
    box.append(h("div", { class: "pane-empty" }, "No run in this chat yet. An agent turn opens its spine here."));
    return;
  }
  const cached = spines.get(runId);
  // Bound the cache: older spines' followers are stopped, their runs are gone from the pane's reach.
  for (const [id, s] of spines) if (id !== runId && spines.size > 4) { s.stop(); spines.delete(id); }
  if (cached) {
    // Re-adopt: the spine's own follower kept painting into it while it sat detached.
    box.append(cached.el);
    cached.refresh?.();
    return;
  }
  const spine = renderRun(box, { runId });
  spines.set(runId, spine);
  spine.load().catch((e) => box.append(h("div", { class: "pane-empty" }, `This run could not be opened: ${String(/** @type {any} */ (e)?.message || e)}`)));
}

/**
 * The tab at the run's pulse: the spine that stands for the chat's run is drawn again by its own paint, in place —
 * the pulse emptied the tab and put a new box around the spine, whose paint made its controls anew (the owner's of
 * 11-01: buttons blinking under a resting pointer, clicks lost). A chat whose run is another now, or none yet, gets
 * the tab drawn anew.
 * @param {HTMLElement} body
 * @param {{ chat: any }} ctx
 */
export function refreshRunPane(body, ctx) {
  const runId = ctx.chat?.live?.runId || "";
  const box = body.querySelector(".pane-scroll");
  if (box && box.getAttribute("data-run") === runId) {
    spines.get(runId)?.refresh();
    return;
  }
  body.replaceChildren();
  renderRunPane(body, ctx);
}

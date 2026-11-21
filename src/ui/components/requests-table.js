// @ts-check
// The Traffic requests table and the pills that sit on a row. The harness page does not import this.
// `createRequestsTable` takes the admin shell's state and navigation so this file never closes over app.js.

import { h } from "../lib/dom.js";
import { fmt, upstreamWords } from "../lib/format.js";

/**
 * A request that has not finished is pending (sent on, no byte yet) or in flight (the reply is arriving): the record's
 * `phase`, which the server sets on every request still running.
 * @param {any} r
 */
export function phaseOf(r) {
  return r.status !== "pending" ? null : r.phase;
}

/** What a running row's quiet pill means (`liveCells`). */
export const QUIET_WORDS = "No byte of the reply has arrived for this long: the model is thinking, a tool is running, or its provider has stalled. Nothing here ends the call by itself; Stop does.";

/**
 * A running call's row as the live list says it each second (HarnessV4_Tasks U1; HarnessV3-FailurePoints §5.1 item
 * 1): what has streamed so far, thinking included, and the thinking alone, in tokens estimated from the characters;
 * how long since its newest byte; and `quiet` once none has come for over three seconds (the server's `stalled`),
 * for a pill on the row — a call that is stuck and one that works read apart. A turn of Filament's own (`now`) says
 * its model call's figures while one is in flight; between calls nothing streams, and its cells say what it does.
 * @param {any} r  the live list's record
 * @returns {{ out: string, outTitle: string, think: string, lastByte: string, quiet: string }}
 */
export function liveCells(r) {
  const streaming = phaseOf(r) === "streaming";
  // A turn between its model calls: it runs a tool, waits on its sub-agents, or works on what a call gave it.
  const between = streaming && r.now && r.now.what !== "model" ? `no model call in flight — ${r.now.what === "tool" ? `the turn runs ${r.now.name || "a tool"}` : r.now.what === "waiting" ? r.now.why || "the turn waits" : "the turn works between calls"}` : "";
  if (between) return { out: "–", outTitle: between, think: "–", lastByte: between, quiet: "" };
  return {
    out: streaming ? `~${fmt.n(r.liveOutTokens || 0)}` : "–",
    outTitle: streaming ? `streamed so far${r.now ? " by its model call in flight" : ""}, thinking included: tokens estimated from the characters` : "no byte of the reply yet",
    think: streaming && r.liveThinkTokens ? `~${fmt.n(r.liveThinkTokens)}` : "–",
    lastByte: streaming && r.sinceOutputMs != null ? `last byte ${fmt.ms(r.sinceOutputMs)} ago` : "no byte of the reply yet",
    quiet: streaming && r.stalled ? `quiet ${fmt.ms(r.sinceOutputMs)}` : "",
  };
}

/**
 * What a call that ended without its reply had streamed (HarnessV4_Tasks U1; HarnessV3-FailurePoints §5.1 item 4):
 * the record of one that failed mid-stream, was cut or lost its client keeps its text and its thinking, in
 * characters. `out` counts both, as a running row's does; `words` says it, for the row's cells and the request's
 * drawer. Null for a call that finished, one still running, and one nothing had streamed of.
 * @param {any} r
 * @returns {{ out: number, thinking: number, words: string } | null}
 */
export function streamedOf(r) {
  if (!r || r.status === "ok" || r.status === "pending") return null;
  const thinkChars = Number(r.thinkingChars) || 0;
  const textChars = Number(r.textChars) || 0;
  if (thinkChars + textChars <= 0) return null;
  const thinking = fmt.tokens(thinkChars);
  const text = fmt.tokens(textChars);
  const parts = [thinking ? `${fmt.n(thinking)} tokens of thinking` : "", text ? `${fmt.n(text)} tokens of text` : ""].filter(Boolean).join(" and ");
  return { out: fmt.tokens(thinkChars + textChars), thinking, words: `About ${parts} had streamed before it ended (estimated from the characters).` };
}

/** What each kind of agent failure means (HarnessV3-ACP AC0-3), for the pill's tooltip. */
const FAILURE_WORDS = {
  auth: "The agent is not signed in, or its account cannot be used now: sign in with its own CLI. It cools down meanwhile.",
  limit: "A rate limit, an overloaded provider or a plan's window spent: the agent cools down and is tried again later.",
  refusal: "The agent refused the request as sent: sending it again unchanged fails the same way. No cooldown: it says nothing about the agent's health.",
  overflow: "The conversation no longer fits the agent's context, or its answer ran past the model's output limit. No cooldown: it says nothing about the agent's health.",
  timeout: "The provider behind the agent did not answer it in time: it cools down, and the request may be tried again.",
  transport: "The agent's process died or its pipe broke: it cools down, and the request may be tried again.",
};

/**
 * The word an agent failure's kind adds to its row's pill, and what it means; null when the record names none.
 * @param {any} failure  the record's `failure`: `{ kind, retryable }`
 * @returns {{ word: string, title: string } | null}
 */
export function failureWords(failure) {
  const kind = failure?.kind;
  return typeof kind === "string" && Object.hasOwn(FAILURE_WORDS, kind)
    ? { word: kind, title: FAILURE_WORDS[/** @type {keyof typeof FAILURE_WORDS} */ (kind)] }
    : null;
}

/** @param {any} r */
export function statusPill(r) {
  const ph = phaseOf(r);
  if (ph === "pending")
    return h(
      "span",
      { class: "pill pending", title: "Sent on; no byte of the reply has arrived yet." },
      "pending",
    );
  if (ph === "streaming")
    return h("span", { class: "pill live", title: "The reply is arriving right now." }, "in flight");
  const cls = r.status === "ok" ? "ok" : r.status === "aborted" ? "warn" : "err";
  const failed = failureWords(r.failure);
  return h(
    "span",
    { class: `pill ${cls}`, title: failed?.title || null },
    r.status === "ok"
      ? "ok"
      : r.status === "error"
        ? `error${r.httpStatus ? " " + r.httpStatus : ""}${failed ? ` · ${failed.word}` : ""}`
        : r.status,
  );
}

/** Why a provider was skipped, in words: the recorded reason, else the HTTP status. */
export function failReason(t) {
  if (t.reason && !/^\d+$/.test(String(t.reason))) return String(t.reason);
  const s = Number(t.status);
  return s === 429
    ? "rate limit"
    : s === 529
      ? "overloaded"
      : s === 401 || s === 403
        ? "bad key"
        : s === 404
          ? "unknown model"
          : s === 400
            ? "rejected the request"
            : s >= 500
              ? "provider error"
              : s
                ? `HTTP ${s}`
                : "unreachable";
}

export const failStep = (t) => (t.status ? `HTTP ${t.status} (${failReason(t)})` : failReason(t));

/**
 * The failover story of one request. Null when the primary served it. `servedBy` is null where nobody on the route
 * answered (HarnessV4_Tasks B10). A request whose backups were only skipped carries no structured field: its
 * "failover:" change notes are the trail.
 * @param {any} r
 */
export function failoverTrail(r) {
  if (!r) return null;
  const fo = r.failover;
  if (fo && (fo.servedBy || (fo.trail || []).length))
    return { trail: fo.trail || [], servedBy: fo.servedBy === null ? null : fo.servedBy || r.upstream };
  const notes = (r.changes || []).filter((c) => /^failover:/i.test(c));
  if (!notes.length && !(r.attempt > 1)) return null;
  return { trail: notes.map((n) => ({ text: n.replace(/^failover:\s*/i, "") })), servedBy: r.upstream };
}

/**
 * Where a request went, for the table's upstream cell (HarnessV3-Launch LD-D9): a command Filament answered itself
 * went nowhere, Filament's own way into a turn reads in words, and a provider shows as its id with the model name it
 * received.
 * @param {any} r
 */
export function whereWent(r) {
  if (r.local || r.memory?.command) return "answered by Filament";
  if (!r.upstream) return "–";
  return `${upstreamWords(r.upstream) || r.upstream}${r.upstreamModel ? ` / ${r.upstreamModel}` : ""}`;
}

/**
 * The turn a record's call belongs to — a loop turn's tick, a sub-agent's turn — or null for a request of its own. A
 * sub-agent the developer launched from the side (`subagentOf: "owner"`) is its own.
 * @param {any} r
 * @returns {string | null}
 */
export function turnParentOf(r) {
  return r.agentOf || (r.subagentOf && r.subagentOf !== "owner" ? r.subagentOf : null) || null;
}

/**
 * One row per turn (LD-D9): the records whose turn is in the list too, by that turn's id, in list order. A
 * sub-agent's calls sit under the sub-agent, and the sub-agent under the turn that launched it.
 * @param {any[]} list
 * @returns {Map<string, any[]>}
 */
export function callsByTurn(list) {
  const present = new Set(list.map((r) => r.id));
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const r of list) {
    const p = turnParentOf(r);
    if (p && p !== r.id && present.has(p)) out.set(p, [...(out.get(p) || []), r]);
  }
  return out;
}

/**
 * @param {object} d
 * @param {any} d.state
 * @param {(id: string) => void} d.openRequest
 * @param {() => void} d.render
 * @param {(path: string, opts?: any) => Promise<any>} d.api
 * @param {(msg: string, kind?: string) => void} d.toast
 * @param {(id: string) => string} d.upDisplay
 * @param {(title: string, hint?: string) => Node} d.empty
 */
export function createRequestsTable({ state, openRequest, render, api, toast, upDisplay, empty }) {
  const trailLines = (fo) => [
    ...fo.trail.map((t, i) => `${i + 1}. ${t.text ? t.text : `${upDisplay(t.upstream)} — ${failStep(t)}`}`),
    ...(fo.servedBy ? [`${fo.trail.length + 1}. ${upDisplay(fo.servedBy)} — served`] : []),
  ];

  function failoverPill(r) {
    const fo = failoverTrail(r);
    return fo ? h("span", { class: "pill fo", title: trailLines(fo).join("\n") }, "failover") : null;
  }

  function viewPill(r) {
    const v = r.view;
    if (!v || !v.foldedTurns) return null;
    const saved = v.historyTokens
      ? Math.round((100 * (v.historyTokens - v.sentTokens)) / v.historyTokens)
      : 0;
    const title =
      `folded by a compaction: ~${fmt.n(v.historyTokens)} tokens of history → ` +
      `~${fmt.n(v.sentTokens)} sent (${saved}% folded away); ${v.foldedTurns} of ${v.totalTurns} ` +
      `turns folded into ${v.stubs} tool stubs`;
    return h("span", { class: "pill view", title }, `⤵ ${saved}%`);
  }

  function cutPill(r) {
    const c = r.compactionCut;
    if (!c) return null;
    const toks = c.outputTokens ? `, ${fmt.n(c.outputTokens)} tokens` : "";
    const title =
      `the client's compaction summary stopped at the output cap (${c.stop}${toks}): ` +
      `the client adopted a summary cut mid-sentence — raise the client's max_tokens ` +
      `for compaction`;
    return h("span", { class: "pill warn", title }, "✂ summary cut");
  }

  function memPill(r) {
    const m = r.memory;
    if (!m || (!m.tokens && !m.toolRounds)) return null;
    const briefing = m.briefing ? ` (briefing: ${m.briefing} items)` : "";
    const injected = m.injected ? `, ${m.injected} on the message` : "";
    const rounds = m.toolRounds ? `, ${m.toolRounds} tool round(s) the model spent on memory` : "";
    const title =
      `memory: ~${fmt.n(m.tokens || 0)} tokens added${briefing}${injected}${rounds} ` +
      `— open the request for the full timeline`;
    return h("span", { class: "pill mem", title }, "M");
  }

  function sourcePill(r) {
    const s = r.source;
    if (!s || s === "client") return null;
    if (s === "replay") return null;
    const meta = state.schema?.trafficSources?.[s] || {};
    const purpose = r.memoryFor?.purpose;
    const pMeta = purpose ? state.schema?.memoryPurposes?.[purpose] || {} : {};
    const text = purpose ? `${meta.short || s} · ${pMeta.label || purpose}` : meta.short || s;
    const title = [
      `Filament made this call itself, not one of your tools: ${pMeta.hint || meta.hint || ""}`.trim(),
      r.parentRequest
        ? `Caused by request ${r.parentRequest} — open that one to see the turn that triggered it.`
        : null,
      r.jobId ? `Part of job ${r.jobId}.` : null,
      r.bodyWithheld || null,
    ]
      .filter(Boolean)
      .join("\n");
    return h("span", { class: `pill src-${s}`, title }, text);
  }

  function stopReqBtn(id) {
    return h(
      "button",
      {
        class: "sm ghost danger",
        title: "Abort this in-flight request (the agent sees a cancelled turn)",
        onclick: async (e) => {
          e.stopPropagation();
          try {
            await api(`/requests/${encodeURIComponent(id)}/cancel`, { method: "POST", body: {} });
            toast("Cancelled");
          } catch (/** @type {any} */ err) {
            toast(err.message, "err");
          }
        },
      },
      "✕",
    );
  }

  /**
   * The requests table, newest first, one row per turn: a turn's model calls fold under it (LD-D9). Options:
   * `dividers` puts a row between days; `group` folds consecutive requests of one conversation into a summary row;
   * `limit` stops after that many rows of their own (a turn with its calls is one).
   * @param {any[]} list
   * @param {{ dividers?: boolean, group?: boolean, limit?: number }} [opts]
   */
  function requestsTable(list, { dividers = false, group = false, limit = Infinity } = {}) {
    if (!list.length) return empty("No requests yet", "Traffic from your agents appears here live.");
    const heads = [
      ["time", ""],
      ["model", "name the agent asked for"],
      ["upstream", "where it went / name it received"],
      ["status", ""],
      ["first byte", "time until the first byte of the reply"],
      ["total", ""],
      ["tok/s", "output tokens per second after the first byte"],
      ["in", "input tokens (fresh)"],
      ["cache read", "input tokens served from the prompt cache"],
      ["cache write", "input tokens written to the cache"],
      ["out", "output tokens"],
      ["thinking", "thinking tokens (part of output)"],
      ["paid", "what the request paid: $0 on a subscription plan, a provider's own charge when it states one"],
      ["at list", "the same tokens at the list price (Providers P4): what a plan's request was worth"],
      ["changes", "number of edits Filament made; click the row"],
    ];
    const open = (state.reqOpen ||= new Set());
    const dayOf = (iso) => new Date(iso).toDateString();
    const dayLabel = (iso) => {
      const d = new Date(iso),
        t = new Date(),
        y = new Date();
      y.setDate(t.getDate() - 1);
      const same = (a, b) => a.toDateString() === b.toDateString();
      const prefix = same(d, t) ? "Today · " : same(d, y) ? "Yesterday · " : "";
      const year = d.getFullYear() === t.getFullYear() ? undefined : "numeric";
      return `${prefix}${d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short", year })}`;
    };
    /**
     * @param {any} r @param {string} [cls]
     * @param {{ replays: number, calls: number, open: boolean } | null} [fold]  what folds under the row: its replays,
     *   and a turn's model calls (LD-D9)
     */
    const rowOf = (r, cls = "", fold = null) => {
      const est = r.estimatedTokens ? "~" : "";
      const tip = r.estimatedTokens
        ? "estimated: the agent reports no usage; cost is covered by its subscription"
        : null;
      // A call that ended without its reply's usage says what had streamed (`streamedOf`).
      const kept = streamedOf(r);
      const keptOut = kept && r.tokens?.output == null;
      const keptThink = !!kept?.thinking && r.tokens?.thinking == null;
      return h(
        "tr",
        {
          class: `clickable ${cls}${fold ? " has-folded" : ""}`,
          "data-id": r.id,
          onclick: () => openRequest(r.id),
        },
        h(
          "td",
          { class: "muted" },
          fold
            ? h(
                "span",
                {
                  class: "caret",
                  title: fold.open
                    ? "Hide what is folded under this row"
                    : `Show ${[fold.calls ? `this turn's ${fold.calls} model call${fold.calls === 1 ? "" : "s"}` : "", fold.replays ? `${fold.replays} replay${fold.replays === 1 ? "" : "s"} of this request` : ""].filter(Boolean).join(" and ")}`,
                  onclick: (e) => {
                    e.stopPropagation();
                    const s = (state.foldOpen ||= new Set());
                    if (s.has(r.id)) s.delete(r.id);
                    else s.add(r.id);
                    render();
                  },
                },
                fold.open ? "▾" : "▸",
              )
            : null,
          fold ? " " : "",
          fmt.t(r.ts),
          fold?.calls
            ? h(
                "span",
                {
                  class: "pill",
                  style: "margin-left:6px",
                  title: `The model calls this turn made — click the arrow to see them`,
                },
                `${fold.calls} call${fold.calls === 1 ? "" : "s"}`,
              )
            : null,
          fold?.replays
            ? h(
                "span",
                {
                  class: "pill",
                  style: "margin-left:6px",
                  title: `${fold.replays} replay${fold.replays === 1 ? "" : "s"} were run against this request's stored body — click the arrow to see them`,
                },
                `↻ ${fold.replays}`,
              )
            : null,
        ),
        h("td", {}, h("code", {}, r.model)),
        h("td", { class: "muted" }, whereWent(r)),
        h(
          "td",
          { class: "c-status" },
          statusPill(r),
          failoverPill(r),
          memPill(r),
          viewPill(r),
          cutPill(r),
          sourcePill(r),
          r.replayOf ? h("span", { class: "pill", title: `a replay of request ${r.replayOf}` }, "↻") : null,
          r.status === "pending" ? stopReqBtn(r.id) : null,
        ),
        h("td", { class: "c-ttft" }, fmt.ms(r.ttftMs)),
        h("td", { class: "c-total" }, fmt.ms(r.totalMs)),
        h("td", { class: "c-tps" }, r.tps != null ? r.tps : r.status === "pending" ? "…" : "–"),
        h("td", { title: tip }, est + fmt.n(r.tokens?.input)),
        h("td", {}, fmt.n(r.tokens?.cacheRead)),
        h("td", {}, fmt.n(r.tokens?.cacheWrite)),
        h("td", { class: "c-out", title: keptOut ? kept.words : tip }, keptOut ? `~${fmt.n(kept.out)}` : est + fmt.n(r.tokens?.output)),
        h("td", { class: "c-think", title: keptThink ? kept.words : null }, keptThink ? `~${fmt.n(kept.thinking)}` : fmt.n(r.tokens?.thinking)),
        h("td", { title: tip || (r.billing === "plan" ? "on a plan: this request paid $0" : null) }, r.estimatedTokens && typeof r.cost !== "number" ? h("span", { class: "muted" }, "agent") : fmt.usd(r.cost)),
        h("td", { title: typeof r.listCost === "number" ? null : "no list price: nobody prices this model here" }, typeof r.listCost === "number" ? fmt.usd(r.listCost) : h("span", { class: "muted" }, "–")),
        h("td", {}, r.changes?.length || 0),
      );
    };
    const convRow = (run, key, isOpen) => {
      const newest = run[0],
        oldest = run[run.length - 1],
        n = run.length;
      const models = [...new Set(run.map((r) => r.model))],
        ups = [...new Set(run.map((r) => r.upstream).filter(Boolean))];
      const errs = run.filter((r) => r.status === "error").length,
        pend = run.filter((r) => r.status === "pending").length;
      const sum = (k) => run.reduce((a, r) => a + (r.tokens?.[k] || 0), 0);
      const cost = run.reduce((a, r) => a + (r.cost || 0), 0);
      const priced = run.some((r) => typeof r.cost === "number");
      const list = run.reduce((a, r) => a + (typeof r.listCost === "number" ? r.listCost : 0), 0);
      const listed = run.some((r) => typeof r.listCost === "number");
      const est = run.some((r) => r.estimatedTokens) ? "~" : "";
      const ttfts = run
        .map((r) => r.ttftMs)
        .filter((v) => v != null)
        .sort((a, b) => a - b);
      const p50 = ttfts.length ? ttfts[Math.floor(ttfts.length / 2)] : null;
      const tpsList = run.map((r) => r.tps).filter((v) => v != null);
      const tps = tpsList.length
        ? Math.round((tpsList.reduce((a, b) => a + b, 0) / tpsList.length) * 10) / 10
        : null;
      const total = run.reduce((a, r) => a + (r.totalMs || 0), 0);
      const changes = run.reduce((a, r) => a + (r.changes?.length || 0), 0);
      return h(
        "tr",
        {
          class: `clickable conv-row${isOpen ? " open" : ""}`,
          title: isOpen
            ? "Click to fold this conversation"
            : "Click to show every request of this conversation",
          onclick: () => {
            if (open.has(key)) open.delete(key);
            else open.add(key);
            render();
          },
        },
        h(
          "td",
          { class: "muted" },
          h("span", { class: "caret" }, isOpen ? "▾" : "▸"),
          ` ${fmt.t(oldest.ts)} → ${fmt.t(newest.ts)}`,
        ),
        h(
          "td",
          {},
          h("span", { class: "conv-tag" }, `conversation · ${n} requests`),
          h(
            "div",
            { class: "small" },
            ...models.slice(0, 2).flatMap((m, k) => [k ? " " : "", h("code", {}, m)]),
            models.length > 2 ? h("span", { class: "muted" }, ` +${models.length - 2}`) : null,
          ),
        ),
        h("td", { class: "muted" }, ups.join(", ") || "–"),
        h(
          "td",
          {},
          pend
            ? h("span", { class: "pill live" }, `${pend} in flight`)
            : errs
              ? h("span", { class: "pill err" }, `${errs} failed`)
              : h("span", { class: "pill ok" }, "ok"),
          run.some((r2) => r2.memory?.tokens || r2.memory?.toolRounds)
            ? h(
                "span",
                {
                  class: "pill mem",
                  title: "memory was injected into at least one request of this conversation",
                },
                "M",
              )
            : null,
          run.some((r2) => r2.status === "pending") ? stopReqBtn(newest.id) : null,
        ),
        h("td", { title: "median first byte" }, fmt.ms(p50)),
        h("td", { title: "time in the model, summed over the conversation" }, fmt.ms(total)),
        h("td", { title: "average tokens per second" }, tps ?? "–"),
        h("td", {}, est + fmt.n(sum("input"))),
        h("td", {}, fmt.n(sum("cacheRead"))),
        h("td", {}, fmt.n(sum("cacheWrite"))),
        h("td", {}, est + fmt.n(sum("output"))),
        h("td", {}, fmt.n(sum("thinking"))),
        h("td", {}, priced ? fmt.usd(cost) : h("span", { class: "muted" }, est ? "agent" : "–")),
        h("td", {}, listed ? fmt.usd(list) : h("span", { class: "muted" }, "–")),
        h("td", {}, changes || 0),
      );
    };
    const foldOpen = (state.foldOpen ||= new Set());
    const replaysBy = new Map();
    for (const r of list)
      if (r.replayOf) {
        const a = replaysBy.get(r.replayOf) || [];
        a.push(r);
        replaysBy.set(r.replayOf, a);
      }
    // A turn's model calls fold under the turn, as replays fold under the request they replayed.
    const callsOf = callsByTurn(list);
    const inTurn = new Set([...callsOf.values()].flat().map((r) => r.id));
    const present = new Set(list.map((r) => r.id));
    const folded = (r) => (!!r.replayOf && present.has(r.replayOf)) || inTurn.has(r.id);
    const rows = [];
    const pushWithFolded = (r, cls = "", depth = 0) => {
      const replays = (replaysBy.get(r.id) || [])
        .slice()
        .sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
      const calls = callsOf.get(r.id) || [];
      const fold = replays.length || calls.length ? { replays: replays.length, calls: calls.length, open: foldOpen.has(r.id) } : null;
      rows.push(rowOf(r, cls, fold));
      if (!fold || !fold.open) return;
      for (const [kids, kind] of [[calls, "in-turn"], [replays, "in-replay"]])
        for (const k of kids) {
          const kidCls = `${kind} ${cls}`.trim();
          if (depth < 3) pushWithFolded(k, kidCls, depth + 1);
          else rows.push(rowOf(k, kidCls));
        }
    };
    let lastDay = null,
      i = 0,
      shown = 0;
    while (i < list.length && shown < limit) {
      const r = list[i];
      if (folded(r)) {
        i++;
        continue;
      }
      if (dividers && dayOf(r.ts) !== lastDay) {
        lastDay = dayOf(r.ts);
        rows.push(h("tr", { class: "day-row" }, h("td", { colspan: heads.length }, dayLabel(r.ts))));
      }
      let j = i;
      if (group && r.clientSession)
        while (
          j + 1 < list.length &&
          list[j + 1].clientSession === r.clientSession &&
          (!dividers || dayOf(list[j + 1].ts) === lastDay)
        )
          j++;
      const run = list.slice(i, j + 1).filter((x) => !folded(x));
      shown++;
      i = j + 1;
      if (run.length > 1) {
        const key = `${r.clientSession}@${run[run.length - 1].ts}`;
        const isOpen = open.has(key);
        rows.push(convRow(run, key, isOpen));
        if (isOpen) for (const m of run) pushWithFolded(m, "in-conv");
      } else pushWithFolded(r);
    }
    return h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        { class: "requests" },
        h("thead", {}, h("tr", {}, ...heads.map(([x, tip]) => h("th", { title: tip }, x)))),
        h("tbody", {}, ...rows),
      ),
    );
  }

  return {
    requestsTable,
    failoverPill,
    viewPill,
    cutPill,
    memPill,
    sourcePill,
    stopReqBtn,
    trailLines,
  };
}

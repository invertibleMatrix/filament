// @ts-check
// The tray's card (HarnessV3-Native NA-D9; the harness's since NA3b): what needs you, what works and what finished, at a
// glance, in the desktop app's small window by the tray. Now: the harness's own Now — Needs you, Working, Done, every
// project, in its rows and words (harness/now-list.js) — and the model calls in flight with their speed; a row opens its
// chat in the harness. Today: the alerts, the day's requests, tokens, cache and cost, the coding agents' plans, where the
// money went, failover. Requests: the last twelve. Upstreams: each one's state over the day, a coding agent's plan.
// Memory is not the card's (the owner, 10-22: the harness and the dashboard show it). Drawn with the widget kit; asked
// every 3 s while it shows — what the head and Now need, and the part in view —, never while it is hidden. In the app
// its buttons are the app's (`window.filamentDesktop`, given to the card's window alone); in a browser it is the same
// page without Restart.
import { h } from "./lib/dom.js";
import { createApi } from "./lib/api.js";
import { upstreamWords } from "./lib/format.js";
import { COVERED, readsAs } from "./lib/accounts.js";
import { createNow } from "./harness/now-list.js";
import { placeName, rowMoment } from "./harness/lib/labels.js";
import { quietWords } from "./harness/lib/now.js";
import { actions, group, head, hero, icon, kids, note, row, section, segmented, switchRow, tok, usd } from "./harness/widgets/kit.js";

/**
 * @typedef {{ state?: any, summary?: any, days?: any, live?: any, runs?: any, holders?: any, chats?: any, accounts?: any,
 *   reqs?: any, ups?: any, failover?: any, alerts?: any }} CardData
 *   each endpoint's answer, as it came; one that did not answer, or was not asked, is missing
 * @typedef {{ owned: boolean, state: string, port?: number }} AppFacts  the app's word on its Filament, where the card is the app's
 * @typedef {{ needs: number, works: number, done: readonly any[], fill: (host: any) => void }} NowView
 *   the harness's Now, as the page holds it (`createNow`): its counts, Done's rows, and its rows drawn into a host
 * @typedef {{ part: string, data: CardData | null, at: number, app: AppFacts | null, port: number, now?: NowView | null }} CardView
 *   `data`: null where Filament did not answer
 * @typedef {{ act?: (id: string, route?: string) => void, setFailover?: (on: boolean) => void, choose: (part: string) => void,
 *   open: (path: string) => void }} CardActs
 */

/** The card's parts, on its segmented control: Now first, as the card opens. */
export const PARTS = Object.freeze([
  { id: "now", label: "Now" },
  { id: "today", label: "Today" },
  { id: "requests", label: "Requests" },
  { id: "upstreams", label: "Upstreams" },
]);
/** How often the card asks while it shows. */
export const EVERY_MS = 3000;
/** The chats' names and their unread marks, and the coding agents' plans (each agent asked how it signs in): read again
 * only this often. */
export const CHATS_MS = 15_000;
export const ACCOUNTS_MS = 60_000;

/**
 * What a tick reads: the head's and Now's each time, and the part in view's.
 * @type {Readonly<Record<string, readonly (readonly [keyof CardData, string])[]>>}
 */
export const READS = Object.freeze({
  always: [
    ["state", "/state"],
    ["summary", "/usage/summary"],
    ["days", "/usage/days?limit=1"],
    ["live", "/live"],
    ["runs", "/runs?limit=50"],
    ["holders", "/sessions/holders"],
  ],
  now: [],
  today: [
    ["failover", "/failover"],
    ["alerts", "/alerts"],
  ],
  requests: [["reqs", "/requests?limit=12"]],
  upstreams: [["ups", "/usage/upstreams?hours=24"]],
});
const CHATS_READ = /** @type {const} */ (["chats", "/memory/sessions?limit=200&kind=interactive,fork,team"]);
const ACCOUNTS_READ = /** @type {const} */ (["accounts", "/agent-accounts"]);
/** The sources whose rows are turns (a chat's agent, a sub-agent): their model calls sit under them. */
const TURNS = ["agent-loop", "subagent"];
/** The alerts the card leaves to the harness and the dashboard. */
const NOT_THE_CARDS = ["memory"];

/** @param {unknown} v */
const n0 = (v) => Math.max(0, Number(v) || 0);
/** @param {number} ms */
const msWords = (ms) => (ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`);
/** A time of day, as the card's rows show it. @param {string | number} at */
const timeOf = (at) => {
  const d = new Date(at);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
};
/** A share as a whole percent. @param {number} v */
const share = (v) => `${Math.round(100 * n0(v))}%`;
/** A long span in a few words. @param {number} ms */
const span = (ms) => {
  const s = Math.round(n0(ms) / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

/** An upstream's name as the card shows it, its agent's suffix left off. @param {string} id @param {readonly any[]} ups */
export const upName = (id, ups) => String((ups || []).find((u) => u.id === id)?.name || id || "").replace(" (agent via ACP)", "");
/** What kind of upstream it is, in a few words. @param {any} u */
export const upKind = (u) => ({ acp: "coding agent", qoder: "Qoder cloud", anthropic: "Anthropic API", openai: "OpenAI API", codex: "Codex", "cursor-sdk": "Cursor" })[String(u?.type)] || String(u?.type || "");
/** The upstreams that are coding agents. @param {any} u */
const isAgent = (u) => ["acp", "codex", "cursor-sdk"].includes(String(u?.type));

/**
 * A chat as Now names it, from the sessions list: its title, its project, its newest activity, its unread mark.
 * @param {readonly any[] | null | undefined} list
 * @returns {(chain: string) => import("./harness/lib/now.js").ChatFacts | null}
 */
export function chatFactsOf(list) {
  const by = new Map((list || []).map((s) => [String(s.id), s]));
  return (chain) => {
    const s = by.get(chain);
    if (!s) return null;
    return { title: String(s.title || s.preview || "untitled"), project: placeName(String(s.projectName || s.cwd || "")) || "", when: rowMoment(s), unread: !!s.unread };
  };
}
/** Who holds each session's turn, as `/sessions/holders` says. @param {any} r @returns {Map<string, any>} */
export const holdersOf = (r) => new Map((r?.holders || []).map((/** @type {any} */ x) => [String(x.chainId), { window: x.window, client: x.client, label: x.label, since: x.since, own: null }]));
/**
 * Each chat's work stretch while it goes on — its start, and what keeps it between its turns —, as `/sessions/holders`
 * says. @param {any} r @returns {Map<string, import("./harness/lib/now.js").Stretch>}
 */
export const stretchesOf = (r) => new Map((r?.stretches || []).filter((/** @type {any} */ x) => x?.chainId && Number(x.since) > 0).map((/** @type {any} */ x) => [String(x.chainId), { since: Number(x.since), waits: x.waits || null }]));

/**
 * The card's Now (NA3b): the harness's own, as each tick reads it (`read`) — the runs list, who holds each chat's turn
 * and each chat's work stretch, from the holders read (the owner's of 11-03: its rows count a chat's time from the
 * stretch's start, as the page's do). `h`, `drawIn`: as `createNow`'s.
 * @param {{ call: any, chats: (chain: string) => import("./harness/lib/now.js").ChatFacts | null, unread: () => ReadonlySet<string>,
 *   onOpen: (row: import("./harness/lib/now.js").NowRow) => void, onSeen: (chains: string[]) => void, h?: typeof h, drawIn?: (host: any, nodes: any[]) => void }} o
 */
export function cardNow(o) {
  /** @type {Map<string, any>} */
  let holders = new Map();
  /** @type {Map<string, import("./harness/lib/now.js").Stretch>} */
  let stretches = new Map();
  const now = createNow({ h: o.h || h, ...(o.drawIn ? { drawIn: o.drawIn } : {}), call: o.call, chats: o.chats, unread: o.unread, holders: () => holders, stretches: () => stretches, onOpen: o.onOpen, onSeen: o.onSeen });
  return {
    now,
    /** A tick's answers: Now reads them. @param {CardData} d */
    async read(d) {
      holders = holdersOf(d.holders);
      stretches = stretchesOf(d.holders);
      await now.update(d.runs?.runs || []);
    },
  };
}

/**
 * Where a row of Now opens in the harness: its chat; a team's lead on the chat's Team view, a thread on its Sub
 * Agents view.
 * @param {{ chain: string, thread?: string | null, team?: string }} r
 */
export const routeOf = (r) => `#/task/${encodeURIComponent(r.chain)}${r.thread ? "/side" : r.team ? "/team" : ""}`;

/**
 * What runs now, from `/api/live`'s `now`: a call to the row's own model is its thinking, as the harness says it; a
 * call to another model names it.
 * @param {any} now @param {string} [model]  the row's model
 */
export function nowWords(now, model = "") {
  if (!now) return "";
  const forMs = now.forMs != null ? ` · ${span(now.forMs)}` : "";
  if (now.what === "model") return now.model && now.model !== model ? `calling ${now.model}${forMs}` : `thinking${forMs}`;
  if (now.what === "tool") return `running ${now.name}${now.args ? ` ${now.args}` : ""}${forMs}`;
  if (now.what === "waiting") return `${now.why || "waiting"}${forMs}`;
  return `working${forMs}`;
}

/**
 * What the card's head says: the pill's word and tone, and its quiet line. The pill says first what needs you, then
 * what works, then the model calls in flight, then the day's failures.
 * @param {CardView} v
 * @returns {{ pill: string, tone: "ok" | "warn" | "err" | "accent", line: string }}
 */
export function headFacts(v) {
  const port = v.app?.port || v.port;
  if (!v.data?.state) {
    const restarting = v.app?.state === "restarting" || v.app?.state === "starting";
    return { pill: restarting ? "Restarting…" : "Not answering", tone: restarting ? "warn" : "err", line: `port ${port}` };
  }
  const { state, summary } = v.data;
  const line = `v${state.version} · port ${port} · up ${(n0(state.uptimeMs) / 3_600_000).toFixed(1)} h`;
  const needs = n0(v.now?.needs);
  if (needs) return { pill: `${needs} need${needs === 1 ? "s" : ""} you`, tone: "warn", line };
  const works = n0(v.now?.works);
  if (works) return { pill: `${works} working`, tone: "accent", line };
  const inFlight = (v.data.live?.active || []).filter((/** @type {any} */ a) => !a.parentId).length;
  if (inFlight) return { pill: `${inFlight} in flight`, tone: "accent", line };
  const rate = n0(summary?.requests) ? n0(summary.errors) / n0(summary.requests) : 0;
  if (rate > 0.1) return { pill: "Some requests failing", tone: "warn", line };
  return { pill: "Running", tone: "ok", line };
}

/** A small pill: a dot and a word, in its tone. @param {typeof h} mk @param {string} text @param {string} tone */
const pill = (mk, text, tone) => mk("span", { class: `tc-pill is-${tone || "quiet"}` }, mk("span", { class: "tc-dot", "aria-hidden": "true" }), text);

/** The day's row of the daily store. @param {CardData} d */
const todayOf = (d) => (d.days?.days || []).find((/** @type {any} */ x) => x.day === d.days?.today) || null;

/** The day's figures, one tile each. @param {typeof h} mk @param {CardData} d */
function tiles(mk, d) {
  const today = todayOf(d);
  const sum = d.summary || {};
  const tin = today ? n0(today.input) + n0(today.cacheRead) + n0(today.cacheWrite) : 0;
  const tout = today ? n0(today.output) : 0;
  const tile = (/** @type {string} */ title, /** @type {string} */ value, /** @type {string} */ caption, /** @type {"" | "warn" | "error" | "good"} */ tone = "") =>
    mk("div", { class: "tc-tile" }, mk("div", { class: "inst-section-title" }, title), hero(mk, { value, caption, tone }));
  return mk(
    "div",
    { class: "tc-tiles" },
    tile("Requests today", String(n0(today?.requests)), `${n0(today?.errors)} errors · ${n0(sum.requests)} in 24 h`, n0(today?.errors) ? "warn" : ""),
    tile("Tokens today", tok(tin + tout), `${tok(tin)} in · ${tok(tout)} out`),
    tile("Cache hit", share(today ? today.cacheHitRate : sum.cacheHitRate), `${tok(today ? today.cacheRead : sum.tokens?.cacheRead)} read · ${tok(today ? today.cacheWrite : sum.tokens?.cacheWrite)} written`),
    tile("Cost today", usd(n0(today?.cost)), `API models only · ${usd(n0(sum.cost))} in 24 h`),
  );
}

/**
 * The model calls in flight: a row per turn — its model, what it does, its speed — its sub-agents' turns under it.
 * @param {typeof h} mk @param {readonly any[]} active
 */
export function flightRows(mk, active) {
  /** @type {any[]} */
  const out = [];
  /** @param {any} a @param {number} depth */
  const add = (a, depth) => {
    const call = active.find((x) => x.parentId === a.id && !TURNS.includes(String(x.source)));
    // The composer's gauge's speed: the last second's while the model writes, else its average while it wrote.
    const sp = a.now ? call : a;
    const writing = !!sp && n0(sp.liveTpsNow) > 0;
    const tps = writing ? sp.liveTpsNow : sp ? sp.liveTpsWriting : null;
    out.push(
      row(mk, {
        label: String(a.model || "–"),
        sub: a.now ? nowWords(a.now, String(a.model || "")) : String(a.source) === "subagent" ? "a sub-agent" : "",
        value: tps ? `${tps} tok/s` : a.now ? "" : "waiting…",
        cls: `tc-now${depth ? ` tc-depth-${Math.min(depth, 3)}` : ""}${writing ? "" : " tc-still"}`,
      }),
    );
    if (depth < 3) for (const s of active.filter((x) => x.parentId === a.id && x !== call)) add(s, depth + 1);
  };
  for (const a of active.filter((x) => !x.parentId)) add(a, 0);
  return out;
}

/** Today in one line under Now: its cost, tokens and requests; a press shows Today. @param {typeof h} mk @param {CardData} d @param {CardActs} acts */
function dayLine(mk, d, acts) {
  const t = todayOf(d);
  const tokens = t ? n0(t.input) + n0(t.cacheRead) + n0(t.cacheWrite) + n0(t.output) : 0;
  return mk(
    "button",
    { class: "tc-day", type: "button", title: "Show Today", onclick: () => acts.choose("today") },
    mk("span", { class: "tc-day-name" }, "Today"),
    mk("span", { class: "tc-day-facts" }, `${usd(n0(t?.cost))} · ${tok(tokens)} tokens · ${n0(t?.requests)} requests`),
    icon(mk, "chevronRight"),
  );
}

/**
 * Now: the harness's Now — Needs you, Working, Done — then the model calls in flight, then the day in a line. Quiet,
 * one line says so, as the harness's left bar does.
 * @param {typeof h} mk @param {CardView} v @param {CardActs} acts
 */
function nowPart(mk, v, acts) {
  const d = /** @type {CardData} */ (v.data);
  const n = v.now || null;
  const list = mk("div", { class: "tc-nowlist" });
  n?.fill(list);
  const flights = flightRows(mk, d.live?.active || []);
  const quiet = !n0(n?.needs) && !n0(n?.works) && !flights.length;
  return kids([
    quiet ? mk("div", { class: "tc-quiet", role: "status" }, quietWords(n?.done || [], Date.now())) : null,
    list,
    flights.length ? section(mk, "Model calls now", group(mk, ...flights)) : null,
    dayLine(mk, d, acts),
  ]);
}

/**
 * A coding agent's plan in words: its windows as it said them — "5h 62% · weekly 41%" —, the one nearest its end
 * first; spent, when it is free again. How it stands is that window's reading (lib/accounts.js `readsAs`): one spent
 * that extra usage covers is `covered`, which stops nothing and has no "free again".
 * @param {any} account  `/agent-accounts`' `account`
 * @returns {{ words: string, state: string }}  `state`: "ok", "warning", "spent", "covered" or ""
 */
export function planWords(account) {
  const ws = (account?.windows || []).filter((/** @type {any} */ w) => w.state !== "reset");
  if (!ws.length) return { words: "", state: "" };
  const rank = { spent: 3, warning: 2, ok: 1 };
  const sorted = [...ws].sort((a, b) => (/** @type {any} */ (rank)[b.state] || 0) - (/** @type {any} */ (rank)[a.state] || 0) || n0(b.usedPercent) - n0(a.usedPercent));
  const parts = sorted.map((w) => `${w.label || w.kind || "window"} ${w.usedPercent != null ? `${Math.round(w.usedPercent)}%` : String(w.state)}`);
  const top = sorted[0];
  const state = readsAs(account, top);
  const free = state === "spent" && top.resetsAt ? ` · free again at ${new Date(top.resetsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false })}` : "";
  return { words: `${parts.join(" · ")}${free}`, state };
}
const PLAN_PILL = /** @type {Record<string, [string, string]>} */ ({ ok: ["within plan", "ok"], warning: ["near its limit", "warn"], covered: [COVERED, "warn"], spent: ["spent", "err"] });

/** The coding agents' plans, where they said them. @param {typeof h} mk @param {CardData} d */
function plans(mk, d) {
  const rows = (d.accounts?.agents || [])
    .filter((/** @type {any} */ a) => !a.off)
    .map((/** @type {any} */ a) => ({ a, p: planWords(a.account) }))
    .filter((/** @type {any} */ x) => x.p.words)
    .map((/** @type {any} */ x) =>
      row(mk, {
        label: String(x.a.name || x.a.upstream).replace(" (agent via ACP)", ""),
        sub: [x.a.account?.identity?.label || "", x.p.words].filter(Boolean).join(" · "),
        trailing: pill(mk, (PLAN_PILL[x.p.state] || [""])[0], (PLAN_PILL[x.p.state] || ["", "quiet"])[1]),
      }),
    );
  return rows.length ? section(mk, "Plans", group(mk, ...rows), note(mk, "What a coding agent's subscription has used: its cost is not in the dollars above.")) : null;
}

/** Where the money went, the last 24 hours: the three models that cost most. @param {typeof h} mk @param {CardData} d */
function whereItWent(mk, d) {
  const by = Object.entries(d.summary?.byModel || {})
    .map(([model, b]) => ({ model, cost: n0(/** @type {any} */ (b).cost), requests: n0(/** @type {any} */ (b).requests) }))
    .filter((x) => x.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 3);
  if (!by.length) return null;
  return section(mk, "Where it went · 24 h", group(mk, ...by.map((x) => row(mk, { label: x.model, sub: `${x.requests} request${x.requests === 1 ? "" : "s"}`, value: usd(x.cost) }))));
}

/** Today. @param {typeof h} mk @param {CardData} d @param {CardActs} acts */
function today(mk, d, acts) {
  const st = d.state || {};
  const ups = st.config?.upstreams || [];
  const bodies = String(st.config?.observability?.storeBodies || "");
  const fo = d.failover;
  return kids([
    alertsCallout(mk, d.alerts?.alerts),
    tiles(mk, d),
    plans(mk, d),
    whereItWent(mk, d),
    fo
      ? section(
          mk,
          "Failover",
          group(
            mk,
            switchRow(mk, {
              label: "Use a route's backups when its provider fails",
              sub: (fo.routesWithBackups || []).length
                ? (fo.routesWithBackups || []).map((/** @type {any} */ r) => `${r.match}: ${(r.chain || []).map((/** @type {string} */ id) => upName(id, ups)).join(" → ")}`).join(" · ")
                : "No route has a backup yet: add one on the dashboard's Routes page.",
              checked: fo.enabled === true,
              disabled: !acts.setFailover,
              onChange: (v) => acts.setFailover?.(v),
            }),
          ),
        )
      : null,
    bodies === "shaped" || bodies === "full"
      ? mk(
          "div",
          { class: "inst-callout is-warn" },
          icon(mk, "info"),
          mk("span", {}, `Each request keeps its whole body (storeBodies is ${bodies}), so the log reaches back only a short way${st.logReach?.since ? `; the oldest is from ${timeOf(st.logReach.since)}` : ""}. Set it back to summary in Settings › Observability when you are done.`),
        )
      : null,
  ]);
}

/** The alerts the card shows: Filament's, but memory's. @param {readonly any[] | undefined} list */
export const cardAlerts = (list) => (list || []).filter((a) => !NOT_THE_CARDS.includes(String(a?.kind)));

/** The alerts Filament holds, the newest first, three at the most. @param {typeof h} mk @param {readonly any[] | undefined} all */
function alertsCallout(mk, all) {
  const list = cardAlerts(all);
  const shown = [...list].reverse().slice(0, 3);
  if (!shown.length) return null;
  return mk(
    "div",
    { class: "tc-alerts" },
    ...shown.map((a) => mk("div", { class: "inst-callout is-warn" }, icon(mk, "shieldAlert"), mk("span", {}, mk("b", { class: "tc-kind" }, a.kind), " ", a.text))),
    list.length > 3 ? note(mk, `${list.length - 3} more on the dashboard.`) : null,
  );
}

/** One request's row. @param {typeof h} mk @param {any} r @param {readonly any[]} ups */
export function requestRow(mk, r, ups) {
  const tone = r.status === "ok" ? "ok" : r.status === "pending" || r.status === "aborted" ? "warn" : "err";
  const status = r.status === "error" ? `error${r.httpStatus ? ` ${r.httpStatus}` : ""}` : String(r.status || "");
  const est = r.estimatedTokens ? "~" : "";
  const inAll = n0(r.tokens?.input) + n0(r.tokens?.cacheRead);
  const hit = inAll > 0 && r.tokens?.cacheRead ? share(n0(r.tokens.cacheRead) / inAll) : r.estimatedTokens ? "n/a" : "0%";
  let via = r.local ? "Filament (a chat command)" : r.upstream ? upstreamWords(r.upstream) || upName(r.upstream, ups) : "–";
  if (r.attempt > 1) via = `${via} (#${r.attempt})`;
  const child = r.source === "agent-tick" || r.source === "subagent";
  // One in flight has no figures yet: it says so, not zeros.
  const facts = r.status === "pending"
    ? [timeOf(r.ts), `via ${via}`, "in flight"]
    : [timeOf(r.ts), `via ${via}`, r.ttftMs != null ? `${msWords(r.ttftMs)} to first token` : "", r.tps != null ? `${r.tps} tok/s` : "", `${hit} cached`, `${est}${tok(inAll)} in / ${est}${tok(r.tokens?.output)} out`];
  return row(mk, {
    label: `${child ? "› " : ""}${r.source === "subagent" ? "sub-agent " : ""}${r.model || "–"}`,
    sub: facts.filter(Boolean).join(" · "),
    trailing: pill(mk, status, tone),
    cls: child ? "tc-child" : "",
  });
}

/** Requests. @param {typeof h} mk @param {CardData} d */
function requests(mk, d) {
  const list = d.reqs?.requests || [];
  if (!list.length) return [note(mk, "No requests yet.")];
  const ups = d.state?.config?.upstreams || [];
  const ok = list.filter((/** @type {any} */ r) => r.status === "ok").length;
  return [group(mk, ...list.map((/** @type {any} */ r) => requestRow(mk, r, ups))), note(mk, `${ok} of ${list.length} succeeded · via: the provider that answered, (#2) a backup took over · ~ an agent's estimate · › a call made inside a turn`)];
}

/** An upstream's state over the day. @param {any} s  its day @param {any} hb  its health */
export function upState(s, hb) {
  if (hb?.coolingDown) return { word: "cooling down", tone: "warn" };
  if (hb?.quotaExceeded) return { word: "quota used up", tone: "err" };
  if (!s) return { word: "no traffic", tone: "quiet" };
  const ok = 1 - n0(s.errorRate);
  return ok >= 0.98 ? { word: "healthy", tone: "ok" } : ok >= 0.9 ? { word: "degraded", tone: "warn" } : { word: "failing", tone: "err" };
}

/** Upstreams; how Filament is set up under them. @param {typeof h} mk @param {CardData} d @param {number} port */
function upstreams(mk, d, port) {
  const all = d.state?.config?.upstreams || [];
  const on = all.filter((/** @type {any} */ u) => u.enabled !== false);
  const off = all.length - on.length;
  const routes = (d.state?.config?.routes || []).filter((/** @type {any} */ r) => r.enabled !== false).length;
  const agents = on.filter(isAgent).length;
  const rows = on.map((/** @type {any} */ u) => {
    const s = d.ups?.upstreams?.[u.id];
    const st = upState(s, d.ups?.health?.[u.id]);
    // A coding agent bills its plan, not Filament's dollars: its plan's windows, where it said them.
    const plan = isAgent(u) ? planWords((d.accounts?.agents || []).find((/** @type {any} */ a) => a.upstream === u.id)?.account).words : "";
    const cost = isAgent(u) ? plan || "" : s ? usd(n0(s.cost)) : "–";
    return row(mk, {
      label: String(u.name || u.id).replace(" (agent via ACP)", ""),
      sub: [upKind(u), s ? `${n0(s.requests)} requests · ${tok(n0(s.input) + n0(s.output))} tokens` : "", cost].filter(Boolean).join(" · "),
      trailing: pill(mk, st.word, st.tone),
    });
  });
  return kids([
    rows.length ? group(mk, ...rows) : note(mk, "No upstream is on."),
    note(mk, `The last 24 hours.${off ? ` ${off} upstream${off === 1 ? "" : "s"} off, not shown.` : ""} ${on.length} on · ${agents} coding agent${agents === 1 ? "" : "s"} · ${routes} route${routes === 1 ? "" : "s"} · agents reach Filament at http://127.0.0.1:${port}/v1`),
  ]);
}

/**
 * The whole card: its head (the tile, Filament, its line, the pill, ×), the parts, what the chosen part shows, and its
 * foot (when it was asked; Restart, Dashboard, Open Filament).
 * @param {typeof h} mk @param {CardView} v @param {CardActs} acts
 */
export function cardView(mk, v, acts) {
  const f = headFacts(v);
  const port = v.app?.port || v.port;
  const app = !!acts.act;
  const body = !v.data?.state
    ? [
        mk(
          "div",
          { class: "inst-callout is-warn", role: "status" },
          icon(mk, "info"),
          mk("span", {}, v.app?.state === "restarting" || v.app?.state === "starting" ? "Filament is restarting: the card fills again once it answers." : `Filament does not answer on port ${port}.${app ? (v.app?.owned ? " The app starts it again by itself." : " It was started elsewhere: if nothing answers soon, the app starts Filament itself.") : ""}`),
        ),
      ]
    : v.part === "today"
      ? today(mk, v.data, acts)
      : v.part === "requests"
        ? requests(mk, v.data)
        : v.part === "upstreams"
          ? upstreams(mk, v.data, port)
          : nowPart(mk, v, acts);
  const seg = segmented(mk, { options: PARTS, value: () => v.part, onChange: (id) => acts.choose(id), ariaLabel: "What the card shows" });
  return mk(
    "div",
    { class: "tc" },
    mk(
      "div",
      { class: "tc-top" },
      head(mk, {
        icon: "activity",
        title: "Filament",
        sub: f.line,
        trailing: mk("div", { class: "tc-trail" }, pill(mk, f.pill, f.tone), app ? mk("button", { class: "tc-close", type: "button", title: "Hide the card (Esc)", "aria-label": "Hide the card", onclick: () => acts.act?.("hide") }, icon(mk, "x")) : null),
      }),
      seg.el,
    ),
    mk("div", { class: "tc-body" }, ...body),
    mk(
      "div",
      { class: "tc-foot" },
      mk("span", { class: "tc-at" }, v.at ? `updated ${timeOf(v.at)}` : ""),
      actions(mk, [
        app ? { label: "Restart", onClick: () => acts.act?.("restart"), disabled: !v.app?.owned || !(v.app?.state === "up" || v.app?.state === "late" || v.app?.state === "taken" || v.app?.state === "failed"), title: v.app?.owned ? "Restart Filament: asked while nothing runs" : "Filament was started elsewhere: restart it there" } : null,
        { label: "Dashboard", onClick: () => (app ? acts.act?.("dashboard") : acts.open("/")) },
        { label: "Open Filament", primary: true, onClick: () => (app ? acts.act?.("harness") : acts.open("/ui/harness.html")) },
      ]),
    ),
  );
}

/**
 * What a tick asks, all at once: the head's and Now's, the part in view's, and the chats' names and the agents' plans
 * where they are due; one that does not answer is left out.
 * @param {(path: string, init?: any) => Promise<any>} api @param {string} [part]
 * @param {{ chats?: boolean, accounts?: boolean }} [due]
 * @returns {Promise<CardData | null>}
 */
export async function readCard(api, part = "now", due = {}) {
  const asks = [...READS.always, ...(READS[part] || []), ...(due.chats ? [CHATS_READ] : []), ...(due.accounts ? [ACCOUNTS_READ] : [])];
  const got = await Promise.allSettled(asks.map(([, p]) => api(p)));
  /** @type {CardData} */
  const d = {};
  got.forEach((g, i) => {
    if (g.status === "fulfilled") d[asks[i][0]] = g.value;
  });
  return d.state ? d : null;
}

// ---- the page --------------------------------------------------------------------------------------------------------
if (typeof document !== "undefined" && document.getElementById("card")) void start();

async function start() {
  const { watchTheme } = await import("./harness/theme.js");
  watchTheme();
  const root = /** @type {HTMLElement} */ (document.getElementById("card"));
  const api = createApi();
  const bridge = /** @type {any} */ (window).filamentDesktop || null;
  /** The chats' list, the agents' plans, and when each was read. */
  let chats = /** @type {any[]} */ ([]);
  let factsOf = chatFactsOf(chats);
  let chatsAt = 0;
  /** @type {any} */
  let accounts = null;
  let accountsAt = 0;
  /** @type {CardView} */
  const v = { part: "now", data: null, at: 0, app: null, port: Number(location.port) || 80, now: null };
  /** @type {CardActs} */
  const acts = {
    ...(bridge ? { act: (/** @type {string} */ id, /** @type {string | undefined} */ route) => bridge.act(id, route) } : {}),
    setFailover: (on) => void api("/failover", { method: "POST", body: { enabled: on } }).then(() => tick(), () => tick()),
    choose: (part) => {
      v.part = part;
      paint();
      void tick();
    },
    open: (path) => void (location.href = path),
  };
  const card = cardNow({
    call: api,
    chats: (chain) => factsOf(chain),
    unread: () => new Set(chats.filter((s) => s.unread).map((s) => String(s.id))),
    // A row opens its chat in the harness: the app's window, or this tab.
    onOpen: (r) => (bridge ? bridge.act("open", routeOf(r)) : acts.open(`/ui/harness.html${routeOf(r)}`)),
    // Done's Clear: marked seen, as the harness marks them.
    onSeen: (list) => {
      for (const c of list) {
        const s = chats.find((x) => String(x.id) === c);
        if (s) s.unread = false;
        void api(`/sessions/${encodeURIComponent(c)}/settings`, { method: "PATCH", body: { patch: { display: { unread: false } } } }).catch(() => {});
      }
      card.now.refresh();
      paint();
    },
  });
  v.now = card.now;
  const paint = () => {
    const scroll = root.querySelector(".tc-body")?.scrollTop || 0;
    root.replaceChildren(cardView(h, v, acts));
    const b = root.querySelector(".tc-body");
    if (b) b.scrollTop = scroll;
  };
  let busy = false;
  const tick = async () => {
    if (busy || document.visibilityState !== "visible") return;
    busy = true;
    try {
      const t = Date.now();
      const due = { chats: t - chatsAt >= CHATS_MS, accounts: (v.part === "today" || v.part === "upstreams") && t - accountsAt >= ACCOUNTS_MS };
      const d = await readCard(api, v.part, due);
      if (d?.chats) [chats, factsOf, chatsAt] = [d.chats.sessions || [], chatFactsOf(d.chats.sessions), t];
      if (d?.accounts) [accounts, accountsAt] = [d.accounts, t];
      if (d) {
        d.accounts = accounts;
        await card.read(d);
      }
      v.data = d;
      v.at = Date.now();
    } finally {
      busy = false;
    }
    paint();
  };
  bridge?.onState?.((/** @type {AppFacts} */ s) => {
    v.app = s;
    paint();
  });
  // The app draws its own page while Filament gives none: in this card's theme.
  bridge?.look?.({ light: document.documentElement.classList.contains("theme-zai-light") });
  document.addEventListener("visibilitychange", () => void tick());
  setInterval(() => void tick(), EVERY_MS);
  paint();
  await tick();
}

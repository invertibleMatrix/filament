// @ts-check
// The Spend instrument (HarnessV3 Step 6 design): what this session has cost, in the Apple Card manner — the total
// as the hero, a column per turn, the dollars split into output, cache writes, cache reads and new input, the tokens
// processed and the share read from cache, and what the cache saved. View only: spend is tracked, never capped.
// Every figure is the server's — the session's usage ledger (`settings.usage`: its loop's
// ticks and its sub-agents' calls included), the turns' facts, and the model's price card (`settings.price`) for
// the split. It never fetches. Paid is the hero; beside it the same tokens at list price (Providers P4): on a plan a
// request pays $0, so the bars, the split and the per-model list read the list figure and say so. The total is the
// chat's whole cost (the owner's of 11-05): its own ledger and the teams that ran beside it, each in a chat of its own
// (`usage.teams`); Who spent it tells the chat's agent, its sub-agents (`usage.agents`) and those teams apart.
// What is not known is not drawn as a figure: a chat none of whose requests has a price — a coding agent's plan paid,
// and nothing said what — has no pill and no "$0.00", and the cache's share and savings are said where its requests'
// usage said their cache numbers (lib/cache-facts.js).
import { h } from "../../lib/dom.js";
import { listDiffers, byModelRows } from "../../lib/cost.js";
import { planTag } from "../../lib/accounts.js";
import { cacheSaid, hitOf, seenPrompt } from "../../lib/cache-facts.js";
import { forecastNext } from "../panes/pane-data.js";
import { head, hero, barStrip, stackBar, legend, group, row, note, link, tok, usd, pct, chartTurns } from "./kit.js";

/**
 * The session's dollars split by what they bought, from its token totals and the model's price card (USD per million
 * tokens). The split is the card's arithmetic, so a session that ran several models reads as an estimate; with no
 * card there is no split.
 * @param {any} u  the usage ledger @param {any} price  `{ input, output, cacheRead, cacheWrite }` or null
 * @returns {{ key: string, label: string, usd: number, color: string }[] | null}
 */
export function spendSplit(u, price) {
  if (!u || !price) return null;
  const at = (/** @type {number} */ tokens, /** @type {any} */ perM) => ((Number(tokens) || 0) * (Number(perM) || 0)) / 1e6;
  const parts = [
    { key: "output", label: "Output", usd: at(u.output, price.output), color: "var(--color-sys-orange)" },
    // An hour's writes cost twice the input price, the rest the card's write price (the owner's 1-hour cache of 10-29).
    { key: "write", label: "Cache writes", usd: at(Math.max(0, (Number(u.cacheWrite) || 0) - (Number(u.cacheWrite1h) || 0)), price.cacheWrite) + at(u.cacheWrite1h, 2 * (Number(price.input) || 0)), color: "var(--color-sys-teal)" },
    { key: "read", label: "Cache reads", usd: at(u.cacheRead, price.cacheRead), color: "var(--color-sys-green)" },
    { key: "input", label: "New input", usd: at(u.input, price.input), color: "var(--color-sys-blue)" },
  ];
  return parts.some((p) => p.usd > 0) ? parts : null;
}

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @returns {import("./frame.js").WidgetSpec}
 */
export function spendWidget(ctx, io = {}) {
  const mk = io.h || h;
  const usage = () => ctx.view()?.settings?.usage || null;
  /** The teams beside the chat: what their chats spent, and how many ran. */
  const teams = () => usage()?.teams || { usd: 0, listUsd: 0, runs: 0 };
  const total = () => (Number(usage()?.usd) || 0) + (Number(teams().usd) || 0);
  /** The same at list price; none where the ledger keeps no list figure. @returns {number | undefined} */
  const listTotal = () => (typeof usage()?.listUsd === "number" ? Number(usage()?.listUsd) + (Number(teams().listUsd) || 0) : undefined);
  /**
   * The total is not known: the chat has requests and none of them has a price, paid or at list, and no team beside it
   * spent. A chat that has made no request has spent nothing, which is known.
   */
  const unknown = () => {
    const u = usage();
    const n = Number(u?.requests) || 0;
    return n > 0 && (Number(u?.unpriced) || 0) >= n && !(total() > 0) && !(Number(listTotal()) > 0);
  };
  /** The total as the pill, the hero and the tile say it. */
  const totalWords = () => (unknown() ? "—" : usd(total()));

  /** @param {typeof h} m @param {() => void} close */
  const panel = (m, close) => {
    const u = usage();
    const turns = chartTurns(ctx.turns?.() || []);
    const shown = turns.slice(-24);
    // Whether the list figure says anything the paid one does not: a plan, or a provider's own charge.
    const atList = !!u && listDiffers(total(), listTotal());
    const t = teams();
    const a = u?.agents || { usd: 0, listUsd: 0, requests: 0, before: 0 };
    /** A share as the hero says it: paid, or at list on a plan. @param {number} paid @param {number} list */
    const share = (paid, list) => (atList ? `${usd(Math.max(0, list))} at list` : usd(Math.max(0, paid)));
    const apart = Number(a.requests) > 0 || Number(t.runs) > 0;
    /** A turn's dollars paid, or null: a command made no request, an unpriced model has no figure. @param {any} t */
    const paidOf = (t) => (t.command || t.facts?.costUsd == null || !(Number(t.facts.costUsd) >= 0) ? null : Number(t.facts.costUsd));
    /** A turn's dollars at list price, or null: a command made no request, an unpriced model has no figure. @param {any} t */
    const listOf = (t) => (t.command || t.facts?.listUsd == null || !(Number(t.facts.listUsd) >= 0) ? null : Number(t.facts.listUsd));
    // The bars chart what the turns were worth when the session runs on a plan — a column of $0 says nothing.
    const costOf = (/** @type {any} */ t) => (atList ? listOf(t) ?? paidOf(t) : paidOf(t));
    /** @param {any} t */
    const turnWords = (t) => {
      const p = paidOf(t), l = listOf(t);
      if (!listDiffers(p, l)) return usd(/** @type {number} */ (p ?? l));
      return p == null ? `${usd(Number(l))} at list` : `paid ${usd(p)} · ${usd(Number(l))} at list`;
    };
    const lastTurn = [...shown].reverse().find((t) => costOf(t) != null);
    const models = byModelRows(u);
    const split = spendSplit(u, ctx.view()?.settings?.price || null);
    const splitSum = split ? split.reduce((n, p) => n + p.usd, 0) : 0;
    const processed = u ? (Number(u.input) || 0) + (Number(u.cacheRead) || 0) + (Number(u.cacheWrite) || 0) + (Number(u.output) || 0) : 0;
    const prompt = u ? (Number(u.input) || 0) + (Number(u.cacheRead) || 0) + (Number(u.cacheWrite) || 0) : 0;
    const requests = Number(u?.requests) || 0;
    const turnCount = Number(u?.turns) || turns.length;
    return m("div", { class: "inst inst-spend" },
      head(m, { icon: "circleDollar", title: "Spend", sub: `${t.runs ? "This chat and its teams" : "This session"} · estimated from your prices` }),
      hero(m, {
        value: totalWords(),
        caption: `${atList ? `${usd(Number(listTotal()))} at list price · ` : ""}${turnCount} turn${turnCount === 1 ? "" : "s"} · ${requests} request${requests === 1 ? "" : "s"}${u?.unpriced ? ` · ${u.unpriced} unpriced` : ""}`,
      }),
      // Who spent it (the owner's of 11-05): the chat's agent — its turns, Claude Code's own helpers in them —, the
      // sub-agents it launched and you did, and the teams beside it.
      apart && u
        ? m("div", { class: "inst-card" },
            m("div", { class: "inst-card-head" }, m("span", { class: "inst-card-title" }, "Who spent it")),
            group(m,
              row(m, { icon: "messageSquare", iconColor: "var(--color-sys-blue)", label: "This chat's agent", sub: "Its own turns", value: share((Number(u.usd) || 0) - (Number(a.usd) || 0), (Number(u.listUsd) || 0) - (Number(a.listUsd) || 0)) }),
              row(m, { icon: "bot", iconColor: "var(--color-sys-purple)", label: "Sub-agents", sub: `${a.requests} request${a.requests === 1 ? "" : "s"}`, value: share(Number(a.usd) || 0, Number(a.listUsd) || 0) }),
              // Teams that ran stay counted; none ran, the row waits for Settings › Experimental's Teams switch.
              t.runs || ctx.team?.on?.() !== false ? row(m, { icon: "users", iconColor: "var(--color-sys-orange)", label: "Teams beside it", sub: t.runs ? `${t.runs} run${t.runs === 1 ? "" : "s"}, each a chat of its own` : "None ran", value: share(Number(t.usd) || 0, Number(t.listUsd) || 0) }) : null),
            Number(a.before) > 0 ? note(m, `The ${usd(Number(a.before))} spent before sub-agents were counted apart is under the chat's agent.`) : null)
        : null,
      m("div", { class: "inst-card" },
        m("div", { class: "inst-card-head" },
          m("span", { class: "inst-card-title" }, "By turn"),
          m("span", { class: "inst-card-fig" }, lastTurn ? `${turnWords(lastTurn)} last turn` : "")),
        shown.length
          ? barStrip(m, shown.map((t, i) => {
              const c = costOf(t);
              return { value: c ?? 0, label: t.command ? `Turn ${t.n}: a command — no request` : c == null ? `Turn ${t.n}: not priced` : `Turn ${t.n}: ${turnWords(t)}`, mark: i === shown.length - 1 };
            }), { ariaLabel: atList ? "each turn at list price" : "the cost of each turn", slots: 12, height: 56, draw: true })
          : note(m, "Each finished turn adds a column.")),
      split
        ? m("div", { class: "inst-card" },
            m("div", { class: "inst-card-head" }, m("span", { class: "inst-card-title" }, "Where it went"), m("span", { class: "inst-card-fig" }, `${usd(splitSum)}${atList ? " at list" : ""}`)),
            stackBar(m, split.map((p) => ({ value: p.usd, color: p.color, label: p.label })), { tall: true }),
            legend(m, split.map((p) => ({ color: p.color, label: p.label, value: usd(p.usd), share: pct(p.usd, splitSum) }))))
        : null,
      // Where the money and the list price went, model by model (Providers P4) — once there is more than one, or a
      // plan to tell apart.
      models.rows.length > 1 || (models.rows.length && atList)
        ? m("div", { class: "inst-card" },
            m("div", { class: "inst-card-head" }, m("span", { class: "inst-card-title" }, "By model"), m("span", { class: "inst-card-fig" }, `${models.rows.length} model${models.rows.length === 1 ? "" : "s"}`)),
            group(m, ...models.rows.slice(0, 6).map((r) => row(m, {
              label: r.model,
              sub: `${r.requests} request${r.requests === 1 ? "" : "s"}${listDiffers(r.usd, r.listUsd) ? ` · paid ${usd(r.usd)}` : ""}`,
              value: listDiffers(r.usd, r.listUsd) ? `${usd(r.listUsd)} at list` : usd(r.usd),
            }))),
            models.rows.length > 6 ? note(m, `and ${models.rows.length - 6} more`) : null)
        : null,
      // The cache's share and its savings, of the requests whose usage said its cache numbers: none said, none drawn.
      group(m,
        row(m, { icon: "layers", iconColor: "var(--color-sys-blue)", label: "Tokens processed", sub: hitOf(u) != null ? `${pct(/** @type {number} */ (hitOf(u)), 1)} of the prompt read from cache${seenPrompt(u) < prompt ? ", where reported" : ""}` : undefined, value: tok(processed) }),
        cacheSaid(u) && (Number(u?.listUnpriced) || 0) < requests
          ? row(m, { icon: "zap", iconColor: "var(--color-sys-green)", label: "Saved by the cache", sub: "Against sending every token as new input", value: m("span", { class: "inst-good" }, usd(Number(u?.savedUsd) || 0)) })
          : null),
      u?.unpriced
        ? note(m, `${u.unpriced} request${u.unpriced === 1 ? " has" : "s have"} no price — set the model's price on the Upstreams page and it counts from then on.`, "warn")
        : null,
      m("div", { class: "inst-foot" }, m("span", { class: "inst-foot-note" }, "Tracked, never capped"), link(m, "Prices", () => { close(); ctx.openPage("upstreams"); })));
  };

  /**
   * The next turn's cost at this rate, an estimate: a straight line through the priced turns' figures (at list price on
   * a plan, where each paid $0), read one turn on — null with fewer than three priced turns. A turn nothing priced has
   * no figure, and is none of them.
   */
  const forecast = () => {
    const u = usage();
    const atList = !!u && listDiffers(Number(u.usd) || 0, u.listUsd);
    const costs = chartTurns(ctx.turns?.() || []).filter((t) => !t.command).map((t) => (atList ? t.facts?.listUsd ?? t.facts?.costUsd : t.facts?.costUsd)).filter((v) => v != null).map(Number).filter((v) => Number.isFinite(v) && v >= 0);
    return costs.length >= 3 ? { usd: forecastNext(costs), atList } : null;
  };

  return {
    id: "spend",
    label: "Spend",
    tileIcon: "circleDollar",
    width: 340,
    // The tile on Overview (proposal_ux §4.6, S): the total; on a plan, what it paid beside the list price; and the
    // next turn's cost at this rate, said as the estimate it is.
    tile: (m) => {
      const u = usage();
      const atList = !!u && listDiffers(total(), listTotal());
      const plan = planTag(ctx.accounts?.session()?.account?.identity);
      const next = forecast();
      return [
        hero(m, { value: totalWords() }),
        m("div", { class: "ov-lines" },
          atList ? m("span", {}, `on your ${plan ? `${plan} ` : ""}plan`) : m("span", {}, u?.requests ? `${u.requests} request${u.requests === 1 ? "" : "s"}${unknown() ? ", none priced" : ""}` : "nothing spent yet"),
          atList ? m("span", {}, `${usd(Number(listTotal()))} at list price`) : null,
          next?.usd != null ? m("span", { class: "ov-quiet" }, `next turn ≈ ${usd(next.usd)}${next.atList ? " at list" : ""}`) : null),
      ];
    },
    // Nothing has been spent before the session exists (Facade D9); and no pill for a total nothing priced.
    visible: () => ctx.hasSession() && !unknown(),
    state: totalWords,
    tone: () => "",
    title: () => {
      const u = usage();
      const t = teams();
      if (unknown()) return `Spend: not priced — none of this chat's ${u.requests} request${u.requests === 1 ? "" : "s"} named a price`;
      return `Spend: ${usd(total())} this session${t.runs ? `, ${usd(Number(t.usd) || 0)} of it its teams'` : ""}${u && listDiffers(total(), listTotal()) ? ` · ${usd(Number(listTotal()))} at list price` : ""}`;
    },
    panel,
  };
}

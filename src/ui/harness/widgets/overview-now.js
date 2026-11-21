// @ts-check
// Overview's Right now tiles that have no pill (proposal_ux §4.6): This turn — the running turn's round, its time, the
// loop's state and the call running now, with Stop, the one act a face holds, which never starts or spends — and
// Agents for this chat — how many work and how many ended, the newest one's line, and the seats for agents on the side
// as a bar. Their figures are lib/overview.js's; a widget never fetches.
import { h } from "../../lib/dom.js";
import { menu } from "../lib/ui.js";
import { agentsNow, turnNow, TURN_STATES } from "../lib/overview.js";
import { rowWords, statusWord, statusTone } from "../lib/subagents.js";
import { poolLine, poolRows } from "../lib/pool.js";
import { ago, group, hero, kids, link, note, row, spanWords } from "./kit.js";
import { mayAskRow } from "./may-ask.js";

/** @typedef {import("./kit.js").Mk} Mk */

/** A quiet word at a tile's head's end. @param {Mk} mk @param {string} words */
const quiet = (mk, words) => (words ? mk("span", { class: "ov-quiet" }, words) : null);

/**
 * This turn.
 * @param {import("./registry.js").WidgetContext} ctx
 * @returns {import("./frame.js").WidgetSpec}
 */
export function turnWidget(ctx) {
  const now = () => turnNow(ctx.chat?.());
  /** The words of a turn's state, for the pill-less title and the back. */
  const stateWords = () => {
    const t = now();
    if (t.phase === "none") return "no turn yet";
    if (t.phase === "asks") return t.asks;
    if (t.phase === "failed") return `turn ${t.n} stopped`;
    if (t.phase === "ended") return `turn ${t.n} ended`;
    return `step ${t.round}`;
  };
  /** @param {Mk} mk */
  const chips = (mk) => {
    const on = now().state;
    return mk("div", { class: "ov-states" }, ...TURN_STATES.map((s) => mk("span", { class: `ov-state${s.id === on ? " is-on" : ""}` }, s.words)));
  };
  return {
    id: "turn",
    label: "This turn",
    icon: "zap",
    liveNow: true,
    width: 320,
    state: stateWords,
    tone: () => (now().phase === "asks" ? "warn" : now().phase === "failed" ? "error" : ""),
    tileTrail: (mk) => {
      const t = now();
      return quiet(mk, t.phase === "running" || t.phase === "asks" ? (t.startedAt ? `started ${ago(t.startedAt)}` : "") : t.endedAt ? `ended ${ago(t.endedAt)}` : "");
    },
    tile: (mk) => {
      const t = now();
      if (t.phase === "none") return [hero(mk, { value: "No turn yet" }), note(mk, "Waiting for your first message.")];
      if (t.phase === "failed")
        return [
          hero(mk, { value: `Turn ${t.n}`, caption: "stopped" }),
          note(mk, `Stopped: ${t.error}`, "error"),
          mk("div", { class: "ov-acts" }, link(mk, "Open it in the chat", () => ctx.scrollToTurn(t.n))),
        ];
      if (t.phase === "ended")
        return [
          hero(mk, { value: `Turn ${t.n}`, caption: [t.round ? `${t.round} step${t.round === 1 ? "" : "s"}` : "", t.startedAt && t.endedAt ? `took ${spanWords(t.endedAt - t.startedAt)}` : ""].filter(Boolean).join(" · ") }),
          note(mk, "Nothing runs now. The next message starts a turn."),
        ];
      const took = t.startedAt ? spanWords(Date.now() - t.startedAt) : "";
      return [
        hero(mk, { value: `Step ${t.round}`, unit: took }),
        chips(mk),
        t.phase === "asks"
          ? mk("div", { class: "ov-doing is-warn" }, mk("span", { class: "ov-doing-text" }, `Waits for you: ${t.asks.replace(/^Waiting for /, "")}`), link(mk, "Open the ask", () => ctx.openView?.("chat")))
          : mk("div", { class: "ov-doing" }, mk("span", { class: "ov-doing-text" }, t.doing || "between steps"), ctx.stopTurn ? mk("button", { class: "ov-stop", type: "button", onclick: () => ctx.stopTurn?.() }, "Stop") : null),
      ];
    },
    now: () => {
      const t = now();
      if (t.phase === "none") return note(h, "No turn has run in this chat yet.");
      return group(h,
        row(h, { label: "Turn", value: String(t.n || "—") }),
        t.round ? row(h, { label: "Steps", value: String(t.round) }) : null,
        t.startedAt ? row(h, { label: "Started", value: ago(t.startedAt) }) : null,
        t.endedAt ? row(h, { label: "Ended", value: ago(t.endedAt) }) : null,
        t.doing ? row(h, { label: "Doing", value: t.doing }) : null,
        t.asks ? row(h, { label: "Waits for", value: t.asks.replace(/^Waiting for /, "") }) : null,
        t.error ? row(h, { label: "Stopped", value: t.error }) : null);
    },
    link: () => ({ label: "Open the run", onClick: () => ctx.openPane?.("run") }),
  };
}

/**
 * The models for agents on the side, in the chip's words, and how many of the session's agents work now. The list
 * holds no count: what holds a model is its own limit, under its provider (the owner's word of 11-05).
 * @param {import("./registry.js").WidgetContext} ctx
 */
export function seatsNow(ctx) {
  const list = poolRows(ctx.view()?.settings?.flat?.["subagents.pool"]);
  const inUse = (ctx.subagents?.rows() || []).filter((r) => r.status === "running").length;
  return { line: poolLine(list, ctx.subagents?.sessionModel() || ""), inUse };
}

/**
 * Agents for this chat.
 * @param {import("./registry.js").WidgetContext} ctx
 * @returns {import("./frame.js").WidgetSpec}
 */
export function agentsWidget(ctx) {
  const rows = () => ctx.subagents?.rows() || [];
  /** @param {Mk} mk */
  const seatsBar = (mk) => {
    const s = seatsNow(ctx);
    return mk("div", { class: "ov-seats" },
      mk("div", { class: "ov-seats-line" },
        mk("span", { class: "ov-seats-what" }, `Default models · ${s.line}`),
        mk("span", { class: "ov-seats-count" }, `${s.inUse} at work`)));
  };
  return {
    id: "agents",
    label: "Agents for this chat",
    icon: "botMessageSquare",
    liveNow: true,
    width: 360,
    state: () => {
      const a = agentsNow(rows());
      return a.working ? `${a.working} working` : a.done ? `${a.done} done` : "none yet";
    },
    tileTrail: (mk) => link(mk, "Open Agents", () => ctx.openView?.("side")),
    tile: (mk) => {
      const a = agentsNow(rows());
      const r = a.newest;
      return [
        mk("div", { class: "ov-counts" },
          mk("span", { class: "ov-count" }, mk("b", {}, String(a.working)), " working"),
          mk("span", { class: "ov-count" }, mk("b", {}, String(a.done)), " done")),
        r
          ? mk("div", { class: `ov-agent tone-${statusTone(r.status)}` },
              mk("span", { class: "ov-agent-dot" }),
              mk("span", { class: "ov-agent-text" }, rowWords(r).name || "An agent"),
              mk("span", { class: "ov-agent-state" }, statusWord(r.status)))
          : note(mk, "No agents in this chat yet. New thread asks one; the main agent hears nothing unless you send it."),
        seatsBar(mk),
      ];
    },
    // The back: whom the main agent may ask, and the seats — the rows the Agents pane held.
    panel: (mk, close) => {
      const may = ctx.mayAsk?.() || null;
      const openMenu = (/** @type {any[]} */ items, /** @type {any} */ at) => menu(items, at);
      return mk("div", { class: "inst inst-agents" },
        mk("div", { class: "inst-head" }, mk("div", { class: "inst-head-text" }, mk("div", { class: "inst-title" }, "Agents for this chat"))),
        ...kids([
          may ? group(mk, mayAskRow(mk, may, openMenu)) : null,
          seatsBar(mk),
          link(mk, "Open Agents", () => { close(); ctx.openView?.("side"); }),
        ]));
    },
  };
}

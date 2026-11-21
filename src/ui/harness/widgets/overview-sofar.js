// @ts-check
// Overview's This chat so far tiles that have no pill (proposal_ux §4.6): Tokens processed, Activity, Files changed,
// Compactions, How models did, Goal and progress. Each shows what the chat used since it started — a figure, one bar
// or one chart, at most three rows then "+N more" (§5.3) — and its back gives the rest. Their figures are
// lib/overview.js's, the chat's changes the page's read (`chatChanges`); a widget never fetches.
import { h } from "../../lib/dom.js";
import { activityOf, compactionsOf, foldColumns, modelsOf, tokensOf } from "../lib/overview.js";
import { compactionFacts, compactionWords } from "../lib/labels.js";
import { prettyModel } from "../lib/families.js";
import { ago, barStrip, group, hero, legend, link, note, pct, row, stackBar, tok } from "./kit.js";
import { cacheSaid, promptOf, seenPrompt } from "../../lib/cache-facts.js";

/** @typedef {import("./kit.js").Mk} Mk */
/** @typedef {import("./registry.js").WidgetContext} WidgetContext */
/** @typedef {import("./frame.js").WidgetSpec} WidgetSpec */

/** The most rows a tile's list shows before "+N more" (§5.3 rule 2). */
const ROWS = 3;

/** The parts of the tokens' bar, each in its thing's colour (§5.4): the cache green, what is new blue, out amber. */
const TOKEN_PARTS = Object.freeze([
  { key: "cacheRead", label: "From cache", color: "var(--color-sys-green)" },
  { key: "cacheWrite", label: "Into cache", color: "var(--color-sys-teal)" },
  { key: "input", label: "New in", color: "var(--color-sys-blue)" },
  { key: "output", label: "Out", color: "var(--color-sys-orange)" },
]);

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function tokensWidget(ctx) {
  const figures = () => tokensOf(ctx.view()?.settings?.usage);
  /** Some request of the chat said its cache numbers (lib/cache-facts.js): the cache's parts are figures then, else nothing counted them. */
  const said = () => cacheSaid(ctx.view()?.settings?.usage);
  /** And some said none: the share read back is of those that did, and says so. */
  const partial = () => {
    const u = ctx.view()?.settings?.usage;
    return said() && seenPrompt(u) < promptOf(u);
  };
  const parts = () => {
    const t = figures();
    return t ? TOKEN_PARTS.filter((p) => said() || !p.key.startsWith("cache")).map((p) => ({ label: p.label, color: p.color, value: t[/** @type {"cacheRead" | "cacheWrite" | "input" | "output"} */ (p.key)] })) : [];
  };
  return {
    id: "tokens",
    label: "Tokens processed",
    icon: "layers",
    state: () => (figures()?.total ? `${tok(/** @type {number} */ (figures()?.total))}` : "none yet"),
    tileTrail: (mk) => {
      const t = figures();
      const a = activityOf(ctx.turns());
      return t?.requests ? mk("span", { class: "ov-quiet" }, `${a.rounds && a.counted === a.turns ? `${a.rounds} step${a.rounds === 1 ? "" : "s"} · ` : ""}${t.requests} request${t.requests === 1 ? "" : "s"}`) : null;
    },
    tile: (mk) => {
      const t = figures();
      if (!t?.total) return [hero(mk, { value: "0" }), note(mk, "Fills as you work: what each request reads, writes to the cache and gets back.")];
      return [
        hero(mk, { value: tok(t.total), caption: t.readShare != null ? `${pct(t.readShare, 1)} read back from cache${partial() ? ", where reported" : ""}` : "" }),
        stackBar(mk, parts()),
        legend(mk, parts().filter((p) => p.value > 0).map((p) => ({ color: p.color, label: p.label, value: tok(p.value) }))),
      ];
    },
    now: () => {
      const t = figures();
      if (!t?.total) return note(h, "No request has booked on this chat yet.");
      return group(h, ...parts().map((p) => row(h, { label: p.label, value: `${p.value.toLocaleString("en-US")} tokens` })), row(h, { label: "Requests", value: String(t.requests) }));
    },
    link: () => ({ label: "Open the run", onClick: () => ctx.openPane?.("run") }),
  };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function activityWidget(ctx) {
  const figures = () => activityOf(ctx.turns());
  /** @param {Mk} mk @param {string} value @param {string} words @param {boolean} [warn] */
  const count = (mk, value, words, warn = false) => mk("span", { class: `ov-stat${warn ? " is-warn" : ""}` }, mk("b", {}, value), mk("span", {}, words));
  return {
    id: "activity",
    label: "Activity",
    icon: "listTodo",
    state: () => `${figures().turns} turns`,
    tileTrail: (mk) => link(mk, "Open the run", () => ctx.openPane?.("run")),
    tile: (mk, size) => {
      const a = figures();
      // Older turns were kept before Filament counted their calls: the counts are the counted turns', said so.
      const partly = a.counted < a.turns;
      return [
        mk("div", { class: "ov-stats" },
          count(mk, String(a.turns), a.turns === 1 ? "turn" : "turns"),
          count(mk, a.counted ? String(a.rounds) : "—", a.rounds === 1 ? "step" : "steps"),
          count(mk, a.counted ? String(a.calls) : "—", "tool calls"),
          count(mk, String(a.failed), "failed", a.failed > 0),
          partly && a.counted ? mk("span", { class: "ov-quiet ov-stats-note", title: `${a.turns - a.counted} older turn${a.turns - a.counted === 1 ? " was" : "s were"} kept before Filament counted their calls` }, `in ${a.counted} of ${a.turns} turns`) : null),
        size === "S" ? null : barStrip(mk, foldColumns(a.perTurn).map((c, i, all) => ({ value: c.value, label: `${c.label}: ${c.value} tool call${c.value === 1 ? "" : "s"}`, mark: i === all.length - 1 })), { height: 30, ariaLabel: "Tool calls per turn", slots: 24 }),
      ];
    },
    now: () => {
      const a = figures();
      return [
        group(h,
          row(h, { label: "Turns", value: String(a.turns) }),
          row(h, { label: "Steps", sub: "the main agent's goes: each calls tools, then reads what they answer", value: String(a.rounds) }),
          row(h, { label: "Tool calls", value: String(a.calls) }),
          row(h, { label: "Failed", sub: "requests that ended in an error", value: String(a.failed) })),
        a.counted < a.turns ? note(h, `${a.turns - a.counted} older turn${a.turns - a.counted === 1 ? " was" : "s were"} kept before Filament counted their calls; they count none.`) : null,
      ].filter(Boolean);
    },
    link: () => ({ label: "Open the run", onClick: () => ctx.openPane?.("run") }),
  };
}

/** A changed file's kind as the tile's legend says it, and its colour. @param {any} f */
const fileKind = (f) =>
  f.status === "added" ? { words: "new", color: "var(--color-sys-green)" }
  : f.status === "deleted" ? { words: "gone", color: "var(--color-sys-red)" }
  : f.status === "renamed" ? { words: "moved", color: "var(--color-sys-blue)" }
  : { words: "changed", color: "var(--color-sys-orange)" };

/** A path's last part. @param {string} p */
const leaf = (p) => String(p || "").split(/[\\/]/).filter(Boolean).at(-1) || String(p || "");

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function filesWidget(ctx) {
  const answer = () => ctx.chatChanges?.() ?? null;
  /** The files, most changed lines first. */
  const files = () => [...(answer()?.files || [])].sort((a, b) => (b.added + b.removed) - (a.added + a.removed));
  return {
    id: "files",
    label: "Files changed",
    icon: "fileDiff",
    state: () => {
      const t = answer()?.totals;
      return t?.files ? `+${t.added} −${t.removed}` : "none yet";
    },
    tileSub: () => (ctx.chat?.()?.git?.branch ? `on ${ctx.chat?.()?.git?.branch}` : ""),
    tileTrail: (mk) => link(mk, "Open Changes", () => ctx.openPane?.("changes")),
    // Nothing written yet: off the page until something is (the design pass of 10-24); the header's Changes stays.
    empty: () => answer()?.totals?.files === 0,
    tile: (mk) => {
      const a = answer();
      if (a === null) return note(mk, "Reading what this chat changed…");
      const t = a.totals || { files: 0, added: 0, removed: 0 };
      if (!t.files) return [hero(mk, { value: "No changes" }), note(mk, a.note && !/recorded no change/.test(String(a.note)) ? String(a.note) : "Nothing this chat's agents wrote shows in git yet.")];
      const top = files().slice(0, ROWS);
      return [
        mk("div", { class: "ov-diff" },
          mk("span", { class: "ov-diff-add" }, `+${t.added}`),
          mk("span", { class: "ov-diff-del" }, `−${t.removed}`),
          mk("span", { class: "ov-quiet" }, `${t.files} file${t.files === 1 ? "" : "s"}`)),
        stackBar(mk, top.map((f) => ({ value: f.added + f.removed || 1, color: fileKind(f).color, label: `${f.path} +${f.added} −${f.removed}` })), { tall: true }),
        mk("div", { class: "ov-legend-line" }, ...top.map((f) => mk("span", { class: "ov-legend-item" }, mk("span", { class: "inst-dot", style: `background:${fileKind(f).color}` }), `${leaf(f.path)} ${fileKind(f).words}`))),
      ];
    },
    now: () => {
      const list = files();
      if (!list.length) return note(h, "No file changes yet.");
      return [
        group(h, ...list.slice(0, 6).map((f) => row(h, { label: leaf(f.path), sub: f.path, value: f.binary ? "binary" : `+${f.added} −${f.removed}` }))),
        list.length > 6 ? note(h, `+${list.length - 6} more in Changes`) : null,
      ].filter(Boolean);
    },
    link: () => ({ label: "Open Changes", onClick: () => ctx.openPane?.("changes") }),
  };
}

/** A compaction's way in a few words: the agent's own, or Filament's summary. @param {any} b */
const compactionWay = (b) => (b.method === "own" ? "the agent's own" : b.method === "fold" ? "folded" : "Filament's summary");

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function compactionsWidget(ctx) {
  const list = () => compactionsOf(ctx.turns());
  return {
    id: "compactions",
    label: "Compactions",
    icon: "foldVertical",
    width: 360,
    state: () => String(list().length),
    empty: () => list().length === 0,
    tile: (mk) => {
      const all = list();
      const last = all.at(-1);
      if (!last) return [hero(mk, { value: "0" }), note(mk, "None yet. Earlier turns are kept as your sheet says.")];
      const facts = compactionFacts(last).split(" · ").filter(Boolean)[0] || "";
      return [
        hero(mk, { value: String(all.length) }),
        mk("div", { class: "ov-lines" },
          mk("span", {}, `${compactionWay(last)}${last.at ? ` · ${ago(Number(last.at))}` : ""}`),
          facts ? mk("span", {}, `${facts} tokens`) : null),
      ];
    },
    now: () => {
      const all = [...list()].reverse();
      if (!all.length) return note(h, "No compaction in this chat yet.");
      return [
        group(h, ...all.slice(0, 6).map((b) => row(h, { label: compactionWords(b), sub: `${b.at ? ago(Number(b.at)) : ""}${compactionFacts(b)}` }))),
        all.length > 6 ? note(h, `${all.length - 6} older`) : null,
      ].filter(Boolean);
    },
    link: () => (ctx.openHow ? { label: "How earlier turns are kept", onClick: () => ctx.openHow?.() } : null),
  };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function modelsWidget(ctx) {
  const list = () => modelsOf(ctx.turns(), ctx.subagents?.rows() || []);
  /** @param {ReturnType<typeof modelsOf>[number]} m */
  const words = (m) => `${m.calls} call${m.calls === 1 ? "" : "s"}${m.output ? ` · ${tok(m.output)} out` : ""} · ${m.failed} failed`;
  return {
    id: "models",
    label: "How models did",
    icon: "chartColumn",
    width: 380,
    state: () => `${list().length} model${list().length === 1 ? "" : "s"}`,
    tileTrail: (mk) => mk("span", { class: "ov-quiet" }, "calls · out · failed"),
    tile: (mk) => {
      const all = list();
      if (!all.length) return note(mk, "Fills as models answer: the agent's, and the sub-agents'.");
      return [
        mk("div", { class: "ov-rows" }, ...all.slice(0, ROWS).map((m) =>
          mk("div", { class: `ov-row${m.failed ? " is-warn" : ""}` },
            mk("span", { class: "ov-row-name" }, mk("b", {}, prettyModel(m.model)), mk("span", { class: "ov-quiet" }, m.who === "agent" ? " · the agent" : " · sub-agents")),
            mk("span", { class: "ov-row-value" }, words(m))))),
        all.length > ROWS ? mk("span", { class: "ov-more" }, `+${all.length - ROWS} more`) : null,
      ];
    },
    now: () => {
      const all = list();
      if (!all.length) return note(h, "No model has answered in this chat yet.");
      return [
        group(h, ...all.map((m) => row(h, { label: prettyModel(m.model), sub: m.who === "agent" ? "the agent" : "sub-agents", value: words(m) }))),
        note(h, "Memory's own calls book on no chat; Usage stats has them."),
      ];
    },
  };
}

/** @param {WidgetContext} ctx @returns {WidgetSpec} */
export function goalWidget(ctx) {
  const goal = () => ctx.chat?.()?.goal || null;
  const list = () => ctx.checklist?.() || [];
  const progress = () => {
    const items = list();
    const done = items.filter((p) => p.status === "done").length;
    return { done, all: items.length, next: items.find((p) => p.status !== "done")?.text || "" };
  };
  return {
    id: "goal",
    label: "Goal and progress",
    icon: "goal",
    state: () => (goal() ? String(goal().status || "active") : progress().all ? `${progress().done} of ${progress().all}` : "none"),
    tileTrail: (mk) => (goal() ? mk("span", { class: "ov-quiet" }, "set by /goal") : null),
    tile: (mk) => {
      const g = goal();
      const p = progress();
      if (!g && !p.all) return [hero(mk, { value: "No goal" }), note(mk, "/goal and a few words sets one; a checklist the agent writes shows its progress here.")];
      return [
        g ? mk("p", { class: "ov-goal" }, String(g.text || "")) : null,
        p.all
          ? mk("div", { class: "ov-progress" },
              mk("div", { class: "ov-meter" }, mk("span", { class: "ov-meter-fill is-good", style: `width:${Math.round((p.done / p.all) * 100)}%` })),
              mk("span", { class: "ov-progress-n" }, `${p.done} of ${p.all}`))
          : null,
        p.next ? mk("p", { class: "ov-quiet ov-next" }, `Next: ${p.next}`) : null,
      ].filter(Boolean);
    },
    now: () => {
      const g = goal();
      const p = progress();
      return [
        g ? group(h, row(h, { label: "Goal", sub: g.status || "active", value: g.drive?.words || "" }), row(h, { label: String(g.text || "") })) : note(h, "No goal set. /goal and a few words sets one."),
        p.all ? group(h, ...list().slice(0, 6).map((x) => row(h, { label: String(x.text || ""), value: x.status === "done" ? "done" : x.status === "doing" ? "doing" : "" }))) : null,
      ].filter(Boolean);
    },
    actions: () => {
      const g = goal();
      if (!g) return [];
      return [
        g.status === "proposed" ? h("button", { class: "primary sm", type: "button", onclick: () => ctx.command("/goal accept") }, "Accept") : null,
        h("button", { class: "ghost sm", type: "button", title: "Clear the goal", onclick: () => ctx.command("/goal abandon") }, "Clear"),
      ];
    },
    link: () => (list().length ? { label: "Open the plan", onClick: () => ctx.openView?.("plan") } : null),
  };
}

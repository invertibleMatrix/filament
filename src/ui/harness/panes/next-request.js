// @ts-check
// The Next request pane (proposal_ux §4.11, M5): what the next message sends, part by part and turn by turn — the
// pre-send inspector the Session inspector's Context Map began (R1). Its parts bar is the compose answer's own figures
// (`/compose?dry=1`, the page's cached preview): Filament's part (its prompt and tools), the conversation as it would be
// sent, and your draft as you type it, on the window's scale with the compaction line. Its turns are the map's stack —
// each earlier turn with how it is sent and its snippet, a turn under a compaction's summary banded — with the
// draft as a ghost at the top. Dry-run shows the request message by message, nothing sent.
// A coding agent builds its own requests: the pane says so, and its turns' forms are greyed (rule 5).
// Each paint is made in place (dom.js `morphChildren`): the bar, the legend and the turns' cards that stood stay, with
// the newest figures.
import { h, morphChildren } from "../../lib/dom.js";
import { fmt } from "../../lib/format.js";
import { api } from "../lib/api.js";
import { ICONS } from "../lib/icons.js";
import { mapCells, SHAPE_WORDS, SHAPE_MEANS } from "../../lib/settings/knobs.js";
import { openDryRun } from "./inspector/inspector.js";
import { createInspectorCallbacks } from "../context-callbacks.js";
import { kids, legend, stackBar } from "../widgets/kit.js";

/**
 * @typedef {{ chat: any, preview: () => Promise<any | null>, draft: () => string, onToast: (msg: string, kind?: string) => void,
 *   reload: () => void, coder: () => string }} NextRequestCtx
 *   `preview`: the chat's compose answer, as the page caches it; `reload`: the chat's settings read again; `coder`: the coding agent's name where one runs the chat, else ""
 */

/** The parts of the next request, each in the colour the Context widget gives its kind. */
const PARTS = Object.freeze([
  { key: "fixed", label: "Filament's part", title: "The loop's prompt and its tools", color: "var(--color-sys-gray)" },
  { key: "conversation", label: "The conversation", title: "The earlier turns, each in the form it is sent in", color: "var(--color-sys-blue)" },
  { key: "draft", label: "Your draft", title: "What you are typing, estimated as you type", color: "var(--color-sys-orange)" },
]);

/** The first line of a message's content: a turn's snippet. @param {any} content */
const snippetOf = (content) => {
  const text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(" ") : "";
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, 110);
};

/** The transcript's rows by turn number (snippets, work counts), read once per chat and turn count. */
const rowsRead = new Map();

/** The shown pane's draft painter: the composer's live figures move it as you type. @type {null | (() => void)} */
let livePaint = null;
/** Each drawn pane's read again, by its body: a pulse refreshes it in place, what it shows standing until the answer lands. */
const drawers = new WeakMap();

/** Your draft moved: the shown pane's bar and ghost row follow it. */
export function draftMoved() {
  livePaint?.();
}

/** @param {HTMLElement} body @param {NextRequestCtx} ctx */
export function renderNextRequest(body, ctx) {
  const chat = ctx.chat;
  livePaint = null;
  if (!chat?.chainId) {
    body.append(h("div", { class: "pane-empty" }, "No request yet. The first message's request shows here once the chat has started; the Start's bar weighs it before."));
    return;
  }
  const chainId = String(chat.chainId);
  const icb = createInspectorCallbacks({ chainIdOf: () => chainId, reload: () => { ctx.reload(); draw(); }, onToast: ctx.onToast, draft: ctx.draft });
  const coder = ctx.coder();
  const partsBox = h("div", { class: "nr-parts" });
  const turnsBox = h("div", { class: "nr-turns" }, h("div", { class: "pane-empty" }, "Reading the chat…"));
  const dry = h("button", { class: "ghost sm", type: "button", title: "The request the next message would send, message by message — nothing is sent" }, "The request as it would be sent");
  body.append(
    h("div", { class: "pane-scroll nr" },
      h("p", { class: "nr-line" }, coder
        ? `${coder} builds its own requests. This shows what Filament adds, and an estimate of the rest; the turns' forms are ${coder}'s.`
        : "What the next message sends, part by part and turn by turn."),
      partsBox,
      h("div", { class: "nr-actions" }, dry),
      h("h4", { class: "pane-sub" }, "The turns ", h("span", { class: "nr-sub" }, "oldest first")),
      turnsBox));

  /** @type {any} */
  let preview = null;
  /** @type {any[] | null} */
  let cells = null;

  dry.addEventListener("click", () => openDryRun(icb));

  /**
   * The parts bar: the compose answer's figures and your draft, on the window's scale. Drawn in place — the pulse and
   * every keystroke paint it, and a bar made anew each time stood under a resting pointer as new parts (the owner's of
   * 11-01: buttons blinking under a resting pointer, clicks lost).
   */
  const paintParts = () => {
    const c = preview?.current || null;
    const draftTokens = fmt.tokens(String(ctx.draft() || "").length);
    if (!c) {
      morphChildren(partsBox, [h("div", { class: "pane-empty" }, preview === null ? "Weighing the next request…" : "The next request could not be weighed.")]);
      return;
    }
    const win = Number(c.window) || 0;
    const values = { fixed: Number(c.fixed) || 0, conversation: Number(c.tokens) || 0, draft: draftTokens };
    const parts = PARTS.map((p) => ({ ...p, value: values[/** @type {"fixed" | "conversation" | "draft"} */ (p.key)] })).filter((p) => p.value > 0);
    const whole = parts.reduce((n, p) => n + p.value, 0);
    morphChildren(partsBox, kids([
      h("div", { class: "nr-fig", "data-key": "fig" },
        h("b", {}, fmt.n(whole)),
        h("span", {}, win ? ` of ${fmt.n(win)} tokens · ${Math.min(100, Math.round((whole / win) * 100))}%` : " tokens · the window is unknown"),
        c.usable ? h("span", { class: "nr-quiet" }, ` · makes room at ${fmt.n(c.usable)}`) : null),
      stackBar(h, parts.map((p) => ({ value: p.value, color: p.color, label: `${p.label}: ${fmt.n(p.value)}` })), { total: win || whole, tall: true, notch: win && c.usable ? Number(c.usable) / win : null }),
      legend(h, parts.map((p) => ({ color: p.color, label: p.label, value: fmt.n(p.value) }))),
      c.head || c.recall
        ? h("p", { class: "nr-quiet" }, [
            c.head ? `turns ${c.head.fromTurn}–${c.head.toTurn} travel as one summary` : "",            c.recall ? "the model can pull archived material back (filament_recall)" : "",
          ].filter(Boolean).join(" · "))
        : null,
    ]));
  };

  /** The ghost row's figure, as you type. */
  const paintGhost = () => {
    const ghost = turnsBox.querySelector(".ctx-ghost .ctx-turn-tokens");
    const tokens = fmt.tokens(String(ctx.draft() || "").length);
    if (ghost) ghost.textContent = `~${fmt.n(tokens)}`;
    else if (tokens > 0 && cells) paintTurns();
  };

  /** The turns' stack, drawn in place: each card keyed by its turn stands as the chat grows. */
  const paintTurns = () => {
    const rows = rowsRead.get(chainId)?.rows || null;
    const draftTokens = fmt.tokens(String(ctx.draft() || "").length);
    turnsBox.classList.toggle("is-greyed", !!coder);
    morphChildren(turnsBox, [mapStack(cells, rows, draftTokens)]);
  };

  function draw() {
    ctx.preview().then((p) => {
      preview = p || false;
      cells = p ? mapCells(p) : [];
      if (!body.isConnected) return;
      paintParts();
      paintTurns();
    }).catch((e) => {
      preview = false;
      if (!body.isConnected) return;
      paintParts();
      // The turns come from the same answer: none drawn yet, they say why rather than reading on.
      if (!cells) turnsBox.replaceChildren(h("div", { class: "pane-empty" }, `The turns could not be read: ${String(e?.message || e)}`));
    });
    const turnsNow = (chat.turns || []).length;
    const had = rowsRead.get(chainId);
    if (!had || had.turns !== turnsNow) {
      rowsRead.set(chainId, { turns: turnsNow, rows: had?.rows || null });
      api(`/sessions/${encodeURIComponent(chainId)}/transcript?work=0`)
        .then((tr) => {
          rowsRead.set(chainId, { turns: turnsNow, rows: new Map((tr?.turns || []).map((/** @type {any} */ r) => [Number(r.n), r])) });
          if (body.isConnected && cells) paintTurns();
        })
        .catch(() => {});
    }
  }

  livePaint = () => {
    if (!body.isConnected) { livePaint = null; return; }
    paintParts();
    paintGhost();
  };
  drawers.set(body, draw);
  paintParts();
  draw();
}

/**
 * The pane read again in place on the run's pulse: the preview the page caches answers anew once the chat moved (its
 * key does), and what the pane shows stands until it lands.
 * @param {HTMLElement} body @param {NextRequestCtx} ctx
 */
export function refreshNextRequest(body, ctx) {
  const draw = drawers.get(body);
  if (draw) return draw();
  body.replaceChildren();
  renderNextRequest(body, ctx);
}

/**
 * One turn of the stack: its figures and form on the first line, your words for it under them, so the stack reads as
 * the conversation.
 * @param {any} c  a mapCells cell @param {number} maxTok  the largest turn's tokens @param {any} row  its transcript row, or null
 */
function turnCard(c, maxTok, row) {
  const words = SHAPE_WORDS[c.shape] || c.shape;
  const means = SHAPE_MEANS[c.shape] || "";
  const marks = [c.fallback || ""].filter(Boolean);
  const w = maxTok ? Math.max(3, Math.round((c.tokens / maxTok) * 100)) : 3;
  const snippet = row ? snippetOf(row.user?.content) : "";
  const tools = Number(row?.workCount) || 0;
  return h("div", {
    class: `ctx-turn shape-${c.shape}`,
    "data-key": `turn:${c.n}`,
    title: `turn ${c.n} · ${fmt.n(c.tokens)} tokens · ${words} — ${means}${marks.length ? ` (${marks.join("; ")})` : ""}`,
  },
    h("span", { class: "ctx-turn-line" },
      h("span", { class: "ctx-turn-n" }, `#${c.n}`),
      h("span", { class: "ctx-turn-bar" }, h("span", { class: `ctx-turn-fill shape-${c.shape}`, style: `width:${w}%` })),
      h("span", { class: "ctx-turn-tokens" }, fmt.n(c.tokens)),
      h("span", { class: "ctx-turn-shape" }, words),
      tools ? h("span", { class: "ctx-turn-tools", title: `${tools} work message${tools === 1 ? "" : "s"} between your message and the answer` }, `${tools} tools`) : null),
    snippet ? h("span", { class: "ctx-turn-snippet" }, snippet) : null);
}

/**
 * The stack: the window's turns as proportional bars, the turns a compaction summarised banded, your draft as a ghost
 * at the top, and the legend with the tally. Each part is keyed by what it is — a card by its turn, a band by the first
 * turn under it, the legend's keys by their shape — for a paint in place to keep it as the chat grows.
 * @param {any[] | null} cells  mapCells of the compose answer @param {Map<number, any> | null} rowsByN
 * @param {number} draftTokens
 */
export function mapStack(cells, rowsByN, draftTokens) {
  if (!cells) return h("div", { class: "ctx-empty" }, "Reading the chat…");
  if (!cells.length && !draftTokens) return h("div", { class: "ctx-empty" }, "No earlier turns yet: the stack fills as the chat runs.");
  const maxTok = Math.max(...cells.map((/** @type {any} */ c) => c.tokens || 0), draftTokens, 1);
  const stack = h("div", { class: "ctx-stack" });
  if (draftTokens > 0) {
    const w = Math.max(3, Math.round((draftTokens / maxTok) * 100));
    stack.append(h("div", { class: "ctx-ghost", "data-key": "ghost", title: `your draft, estimated as you type — it becomes turn ${cells.length + 1} when sent` },
      h("span", { class: "ctx-turn-line" },
        h("span", { class: "ctx-turn-n" }, "next"),
        h("span", { class: "ctx-turn-bar" }, h("span", { class: "ctx-turn-fill ghost", style: `width:${w}%` })),
        h("span", { class: "ctx-turn-tokens" }, `~${fmt.n(draftTokens)}`),
        h("span", { class: "ctx-turn-shape" }, "your draft"))));
  }
  /** Turns under a compaction's summary, banded. @type {any[]} */
  let under = [];
  const flushUnder = () => {
    if (!under.length) return;
    const from = under[0].n, to = under[under.length - 1].n;
    stack.append(h("div", { class: "ctx-under", "data-key": `under:${from}`, title: "a compaction wrote these turns as one summary" },
      h("span", { class: "ctx-under-ic", html: ICONS.archive }),
      h("span", { class: "ctx-under-text" }, from === to ? `turn ${from} travels as one summary` : `turns ${from}–${to} travel as one summary`),
      h("span", { class: "ctx-under-meta" }, `${under.length} turn${under.length === 1 ? "" : "s"}`)));
    under = [];
  };
  for (const c of cells) {
    if (c.boundaryBefore) { flushUnder(); stack.append(h("div", { class: "ctx-boundary", "data-key": `boundary:${c.n}`, title: "a compaction" })); }
    if (c.under) { under.push(c); continue; }
    flushUnder();
    stack.append(turnCard(c, maxTok, rowsByN?.get(c.n) || null));
  }
  flushUnder();
  const byShape = new Map();
  for (const c of cells.filter((/** @type {any} */ c) => !c.under)) byShape.set(c.shape, (byShape.get(c.shape) || 0) + 1);
  const totalTok = cells.reduce((/** @type {number} */ n, /** @type {any} */ c) => n + (c.tokens || 0), 0);
  const tally = [
    `${cells.length} turn${cells.length === 1 ? "" : "s"}`,
    ...[...byShape.entries()].map(([s, n]) => `${n} ${SHAPE_WORDS[s] || s}`),
    `${fmt.n(totalTok)} tokens to the model`,
  ].join(" · ");
  return h("div", {},
    stack,
    h("div", { class: "ctx-legend" },
      ...[...byShape.keys()].map((/** @type {string} */ s) => h("span", { class: "ctx-legend-key", "data-key": s, title: SHAPE_MEANS[s] || "" },
        h("span", { class: `ctx-map-swatch shape-${s}` }), SHAPE_WORDS[s] || s)),
      h("span", { class: "ctx-legend-note" }, tally)));
}

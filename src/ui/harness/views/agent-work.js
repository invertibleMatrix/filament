// @ts-check
// Your agent's own work, drawn as a flow, in the Agents tab's pane (HarnessV4_OneAgent_Plan L47, §16): the agents your
// main agent sent off by itself, a step per reply — its agents side by side — each step's line saying what had happened
// by then (lib/agent-work.js). The flow card's own steps, rail and boxes (views/flow.css), so it reads as a flow reads;
// a box pressed shows what it was asked and its answer under the steps, with Open its thread. A picture of what
// happened: nothing in it runs or acts (L47-D1). A draw that shows the same picture is skipped; one that does not —
// a box ended, a pulse landed, the clock turned a box's figures — is drawn in place (dom.js `morphChildren`), each
// step, box and button keyed by what it is, so a box under a resting pointer is the element that stood: its hover
// holds and a press on it lands (the owner's of 11-01: buttons blinking under a resting pointer, clicks lost).
import { h, morphChildren } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { kids } from "../widgets/kit.js";
import { cardIcon, cardTone } from "../lib/agent-cards.js";
import { money } from "../lib/flow.js";
import { doneMark } from "../lib/marks.js";
import { STEPS_SHOWN, WORK_BADGE, boxWords, sentWords, workWords } from "../lib/agent-work.js";

/** @typedef {typeof h} Mk */
/** @typedef {import("../lib/agent-work.js").Work} Work */
/** @typedef {import("../lib/agent-work.js").WorkBox} WorkBox */

/** The head's words under its name. */
export const WORK_LINE = "What your agent sent its agents to do in this chat. A step is what one of its replies sent off, side by side; a step below came later.";
/** The threads' whole words kept at most, the oldest read going first (`createWorkPane`). */
const WHOLES_KEPT = 20;
/** The characters of what it was asked and of its answer a box shows: the list's cards' form, as it ever showed them. */
const SHOWN_CHARS = 4000;
/** Words cut as the server cuts a card's (core/text.js `cut`). @param {string} s */
const upTo = (s) => (s.length > SHOWN_CHARS ? `${s.slice(0, SHOWN_CHARS - 1)}…` : s);
/** What the picture is, under the steps. */
export const WORK_NOTE = "A picture of what happened: it runs nothing. Each agent's thread has its whole exchange; Stop, Retry and Apply are there.";

/**
 * What the pane reads and does — the host's. `work`: the picture now; `cards`: the saved agents, for each box's face;
 * `openThread`: a box's thread on the Agents tab; `whole`: a thread's exchanges' asking and answer whole, in order, for
 * a box whose words the list carries clipped (`cut`) — null where Filament holds the thread no longer.
 * @typedef {{ work: () => Work, cards: () => { tag: string, from?: string | null }[], openThread: (id: string) => void, now?: () => number,
 *   whole?: (thread: string) => Promise<{ asked: string, answer: string }[] | null> }} WorkIO
 */

/**
 * The pane a row of your agent's own work shows.
 * @param {WorkIO} io @param {{ h?: Mk, place?: (parent: any, wanted: any[]) => void }} [o]  the tests' fake DOM and its
 *   `place`: how a draw goes into the pane — in place (dom.js `morphChildren`, the page's), or a fake DOM's own
 */
export function createWorkPane(io, o = {}) {
  const mk = o.h || h;
  const place = o.place || morphChildren;
  const now = io.now || Date.now;
  const el = mk("section", { class: "tv-section fl-pane", "aria-label": "Your agent's work, as a flow" });
  /** @param {string} name @param {string} [cls] */
  const glyph = (name, cls = "inst-ic") => mk("span", { class: cls, "aria-hidden": "true", html: ICONS[/** @type {keyof typeof ICONS} */ (name)] || "" });
  /** The box picked, and whether the earlier steps show; kept per chat. @type {WeakMap<object, { sel: string | null, earlier: boolean }>} */
  const states = new WeakMap();
  /** @type {any} */
  let chat = null;
  let drawnKey = "";
  /**
   * The threads read whole for the boxes picked whose list's words are clipped (`io.whole`), once each, every box of a
   * thread from the one read: keyed by the thread and its boxes' states — a box that ends has an answer to read.
   * `reading` while on its way; `failed` where it could not be read, read again at the box's next pick.
   * @type {Map<string, { words: { asked: string, answer: string }[] } | "reading" | "failed">}
   */
  const wholes = new Map();
  /** @param {WorkBox} b @param {{ b: WorkBox }[]} all */
  const wholeKey = (b, all) => `${b.thread}\n${all.filter((x) => x.b.thread === b.thread).map((x) => x.b.state).join(",")}`;

  const stateOf = () => {
    let s = states.get(chat);
    if (!s) {
      s = { sel: null, earlier: false };
      states.set(chat, s);
    }
    return s;
  };

  /** A box's face: its card's glyph and colour; a coding agent's own the bot. @param {WorkBox} b @param {string} size */
  const faceOf = (b, size) => {
    const c = b.tag ? io.cards().find((x) => x.tag === b.tag) || { tag: b.tag } : null;
    return mk("span", { class: `pf ${size} t-${c ? cardTone(c) : "gray"}`, "aria-hidden": "true" }, glyph(c ? cardIcon(c) : "bot", "pf-ic"));
  };

  /** @param {WorkBox} b */
  const pick = (b) => {
    const s = stateOf();
    s.sel = s.sel === b.id ? null : b.id;
    // Its thread could not be read whole: a pick asks again.
    for (const [k, v] of wholes) if (v === "failed" && k.startsWith(`${b.thread}\n`)) wholes.delete(k);
    paint(chat);
  };

  /** A box in its step: its face, its name, a graph task's or a coding agent's tag, its state, what it was asked, its figures. @param {WorkBox} b @param {string | null} sel @param {number} t */
  const boxEl = (b, sel, t) => {
    const badge = WORK_BADGE[b.state];
    return mk("button", {
      class: `fl-box st-${b.state}${b.state === "asking" ? " is-asks" : ""}${sel === b.id ? " is-sel" : ""}`,
      type: "button",
      "data-box": b.id,
      "data-key": b.id,
      title: `${b.name}: what it was asked and its answer`,
      "aria-pressed": sel === b.id ? "true" : "false",
      onclick: () => pick(b),
    },
    mk("span", { class: "fl-box-top" }, faceOf(b, "s28"),
      mk("span", { class: "fl-box-who" }, mk("b", {}, b.name), mk("span", { class: "fl-tags" }, ...kids([
        b.graph ? mk("span", { class: "fl-tag", title: "A task of your agent's task graph: the Plan tab draws what it needs" }, `task ${b.graph}`) : null,
        b.of ? mk("span", { class: "fl-tag", title: `An agent of ${b.of}'s own, which Filament did not launch` }, `${b.of}'s own`) : null,
      ]))),
      // Done is a quiet tick, as a flow's box and a task graph's are.
      b.state === "done" ? doneMark(mk) : mk("span", { class: `tg-badge ${badge.cls}` }, badge.words)),
    mk("span", { class: "fl-box-line" }, b.task || "—"),
    mk("span", { class: "fl-box-needs" }, boxWords(b, t)));
  };

  /**
   * The box picked: who sent it, which step, its figures, what it was asked, its answer — each its first 4,000
   * characters, read whole where the chat's list carries its first words alone (`whole`; `reading` until then, `failed`
   * where it could not be) — and its thread.
   * @param {WorkBox} b @param {number} step @param {number} t @param {{ asked: string, answer: string } | null} whole
   * @param {"" | "reading" | "whole" | "failed"} read
   */
  const detailOf = (b, step, t, whole, read) => {
    const badge = WORK_BADGE[b.state];
    const live = b.state === "working" || b.state === "asking";
    const asked = whole ? upTo(whole.asked) || b.asked : b.asked;
    const answer = b.answer && (whole ? upTo(whole.answer) || b.answer : b.answer);
    // Keyed by its box, and each part by what it is: an answer landing under a resting pointer moves nothing else.
    return mk("div", { class: `fl-detail${b.state === "asking" ? " is-asks" : ""}`, "data-detail": b.id, "data-key": `detail:${b.id}` },
      mk("div", { class: "fl-d-top", "data-key": "top" }, faceOf(b, "s32"),
        mk("div", { class: "fl-d-who" }, mk("b", {}, b.name),
          mk("div", { class: "fl-q" }, [sentWords(b), `step ${step + 1}`, boxWords(b, t)].filter(Boolean).join(" · "))),
        mk("span", { class: `tg-badge ${badge.cls}` }, badge.words)),
      ...kids([
        asked ? mk("div", { class: "fl-d-sect", "data-key": "asked" }, "Asked") : null,
        asked ? mk("p", { class: "fl-d-words", "data-key": "asked-words" }, asked) : null,
        answer ? mk("div", { class: "fl-d-sect", "data-key": "answer" }, "Its answer") : null,
        answer ? mk("div", { class: "fl-ans", "data-key": "answer-words" }, answer) : null,
        read === "reading" ? mk("p", { class: "fl-note", "data-key": "reading" }, glyph("info", "fl-note-ic"), "Reading its whole words…") : null,
        read === "failed" ? mk("p", { class: "fl-note", "data-key": "reading" }, glyph("info", "fl-note-ic"), "These are its first words: the rest could not be read. Its thread has them whole.") : null,
        !b.answer && b.error ? mk("p", { class: "fl-note is-warn", "data-key": "note" }, glyph("info", "fl-note-ic"), b.error[0].toUpperCase() + b.error.slice(1)) : null,
        !b.answer && !b.error && live ? mk("p", { class: "fl-note", "data-key": "note" }, glyph("info", "fl-note-ic"), b.state === "asking" ? "It asks you: its thread has the question." : "It works still: its thread shows what it does now.") : null,
      ]),
      mk("div", { class: "fl-foot", "data-key": "foot" },
        mk("button", { class: "inst-btn is-primary", type: "button", title: "Its whole exchange, on the Agents tab", onclick: () => io.openThread(b.thread) }, "Open its thread")));
  };

  /** @param {any} c  the chat on screen */
  function paint(c) {
    chat = c;
    if (!chat?.chainId) {
      drawnKey = "";
      place(el, []);
      return;
    }
    const s = stateOf();
    const t = now();
    const w = io.work();
    const all = w.steps.flatMap((st, i) => st.boxes.map((b) => ({ b, i })));
    const sel = all.find((x) => x.b.id === s.sel) || null;
    // The box picked whose list's words are clipped: its thread read whole once, drawn again as it lands.
    const wk = sel?.b.cut && io.whole ? wholeKey(sel.b, all) : "";
    if (wk && sel && !wholes.has(wk)) {
      wholes.set(wk, "reading");
      const c = chat;
      /** @param {{ asked: string, answer: string }[] | null} words */
      const landed = (words) => {
        wholes.set(wk, words ? { words } : "failed");
        for (const k of wholes.keys()) if (wholes.size > WHOLES_KEPT && k !== wk) wholes.delete(k);
        if (chat === c) paint(c);
      };
      /** @type {NonNullable<WorkIO["whole"]>} */ (io.whole)(sel.b.thread).then(landed, () => landed(null));
    }
    const got = wk ? wholes.get(wk) : undefined;
    const whole = sel && got && typeof got === "object" ? got.words[sel.b.n - 1] || null : null;
    /** @type {"" | "reading" | "whole" | "failed"} */
    const read = !wk ? "" : whole ? "whole" : got === "reading" ? "reading" : "failed";
    const key = JSON.stringify([chat.chainId, w, s.sel, s.earlier, Math.floor(t / 30_000), wk, read]);
    if (key === drawnKey) return;
    drawnKey = key;
    const words = workWords(w);
    if (!words) {
      s.sel = null;
      place(el, [mk("p", { class: "bes-line" }, "Your agent has sent no agent of its own in this chat yet. When it does, each reply's agents stand here side by side, in steps.")]);
      return;
    }
    const folded = w.steps.length > STEPS_SHOWN && !s.earlier ? w.steps.length - STEPS_SHOWN : 0;
    const shown = w.steps.map((st, i) => ({ st, i })).slice(folded);
    if (s.sel && !sel) s.sel = null;
    const working = w.working > 0;
    place(el, [mk("section", { class: `fl-card is-work ${working ? "is-running" : "is-done"}`, "aria-label": "Your agent's work, as a flow" },
      mk("div", { class: "fl-head", "data-key": "head" },
        mk("span", { class: "fl-tile" }, glyph("waypoints")),
        mk("div", { class: "fl-ht" },
          mk("div", { class: "fl-name" }, "Your agent's work", mk("span", { class: "fl-fig" }, words)),
          mk("div", { class: "fl-goal", title: WORK_LINE }, WORK_LINE))),
      ...kids([folded ? mk("button", { class: "br-link fl-earlier", type: "button", "data-key": "earlier", title: "The steps before these", onclick: () => { s.earlier = true; paint(chat); } }, `Earlier steps · ${folded}`, glyph("chevronDown", "br-link-ic")) : null]),
      mk("div", { class: "fl-steps", "data-key": "steps" },
        ...shown.map(({ st, i }) => {
          const done = st.boxes.every((b) => b.state !== "working" && b.state !== "asking");
          return mk("div", { class: `fl-step${done ? " is-done" : " is-now"}`, "data-step": String(i + 1), "data-key": `step:${i + 1}` },
            mk("div", { class: "fl-rail" }, mk("span", { class: "fl-num", title: `Step ${i + 1}` }, String(i + 1))),
            mk("div", { class: "fl-boxes" },
              ...kids([st.why ? mk("div", { class: "fl-why", title: "What had happened before it" }, st.why) : null]),
              ...st.boxes.map((b) => boxEl(b, s.sel, t))));
        })),
      ...kids([sel ? detailOf(sel.b, sel.i, t, whole, read) : null]),
      mk("p", { class: "fl-note", "data-key": "note" }, glyph("info", "fl-note-ic"), `${WORK_NOTE}${w.usd > 0 ? ` In all: ${money(w.usd)}.` : ""}`))]);
  }

  return { el, paint, /** The row's words, null with none sent: the Agents tab's foot row shows only then. */ row: () => workWords(io.work()) };
}

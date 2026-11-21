// @ts-check
// A coding agent's question in the dock (HarnessV3-ACP AC2-4): what an agent asks the person while its turn runs, drawn
// from the form its run's `ask` event carries (adapters/agents/asks.js) and answered on the run while the turn waits.
// Its questions come one at a time ("2 of 3", Back), their choices on the number keys, several where a question allows,
// the person's own words where it takes them (a secret masked), and Skip; a plan it proposes shows whole, accepted or
// rejected with words, or answered with one of its agent's own ways on (Claude's, AC3-3); a link shows its address
// whole before it opens. A permission the session's switch asks about is the loop's own card (decisions.js).
import { h, setHtml } from "../../lib/dom.js";
import { ICONS } from "../lib/icons.js";
import { mdChat } from "../lib/md-stream.js";
import { inlineMarks } from "../widgets/kit.js";
import { planBody } from "../lib/labels.js";

/**
 * @typedef {{ outcome: string, answers?: Record<string, { chosen: string[], words?: string }>, reason?: string }} AgentAnswer
 * @typedef {{ answer: (a: AgentAnswer) => Promise<string>, plan: (x: { choice: string, words: string }) => Promise<string>,
 *   open: (url: string) => void, mode: string }} AgentAskIO  `answer` sends it and resolves "" once the run took it,
 *   else why not, which the block says; `plan`: a plan answered with one of its agent's own ways on — the person's
 *   words with a way to keep planning — the same; `open` opens a link in a new tab; `mode`: the session's permission
 *   switch as the block is drawn
 */

/** How many choices the number keys reach. */
const KEYED = 9;
/** A plan's to-do glyph and its word, by its status. */
const TODO_MARKS = Object.freeze({
  completed: { glyph: "circleCheck", word: "done" },
  in_progress: { glyph: "loader", word: "doing" },
  pending: { glyph: "circle", word: "pending" },
});

/**
 * Whether the person's answer to one question is one its agent reads: a number where it wants one, an answer where it
 * needs one. Returns why not, or "".
 * @param {any} q @param {number} chosen  how many of its choices are chosen @param {string} words
 */
function replyProblem(q, chosen, words) {
  if (words && q.words === "integer" && !/^-?\d+$/.test(words)) return "This one takes a whole number.";
  if (words && q.words === "number" && !/^-?\d+(\.\d+)?$/.test(words)) return "This one takes a number.";
  if (q.required && !chosen && !words) return "This one needs an answer.";
  return "";
}

/**
 * The dock's block for one of an agent's questions (the run's `ask` event), drawn by its form's kind. One answer at a
 * time: the block's controls wait for it, stay down once the run took it — the block leaves the dock as the question
 * settles — and come back with the run's words when it refused it.
 * @param {typeof h} mk @param {any} ask @param {AgentAskIO} io
 * @returns {any}
 */
export function agentAskBlock(mk, ask, io) {
  const form = ask.form || {};
  const who = String(form.agent || "The agent");
  const err = mk("div", { class: "ax-err", role: "alert" });
  /** Everything the person answers with, held down while an answer is on its way. @type {any[]} */
  const controls = [];
  let busy = false;
  let sent = false;
  const hold = () => {
    for (const c of controls) c.toggleAttribute("disabled", busy || sent);
  };
  /** An answer on its way: `deliver` resolves "" once the run took it, else why not. @param {() => Promise<string>} deliver */
  const settle = async (deliver) => {
    if (busy || sent) return;
    busy = true;
    err.replaceChildren();
    hold();
    let why = "";
    try {
      why = await deliver();
    } catch (e) {
      why = e instanceof Error ? e.message : String(e);
    }
    busy = false;
    sent = !why;
    if (why) err.replaceChildren(why);
    hold();
  };
  /** @param {AgentAnswer} a */
  const send = (a) => settle(() => io.answer(a));
  /** @param {string} label @param {string} title @param {() => void} fn @param {boolean} [primary] */
  const btn = (label, title, fn, primary = false) => {
    const b = mk("button", { class: `inst-btn${primary ? " is-primary" : ""}`, type: "button", title, onclick: fn }, label);
    controls.push(b);
    return b;
  };
  /**
   * A choice the person may pick: its number key, its mark, its label and what it means.
   * @param {any} c @param {number} i @param {{ several?: boolean, pick: () => void, go: () => void }} o
   */
  const choiceRow = (c, i, o) => {
    const row = mk("button", { class: `ix-option${o.several ? " is-check" : ""}`, type: "button", role: o.several ? "checkbox" : "radio", onclick: o.pick, ondblclick: o.go },
      mk("span", { class: "ax-key", "aria-hidden": "true" }, i < KEYED ? String(i + 1) : ""),
      mk("span", { class: "ix-option-mark", html: ICONS.check }),
      mk("span", { class: "ix-option-label" }, String(c.label)),
      c.description ? mk("span", { class: "ix-option-desc" }, String(c.description)) : null);
    controls.push(row);
    return row;
  };
  /** @param {string} icon @param {string} words @param {any} [aside] */
  const head = (icon, words, aside = null) =>
    mk("div", { class: "ix-head" },
      mk("span", { class: "ix-head-ic ask", html: ICONS[/** @type {keyof typeof ICONS} */ (icon)] || "" }),
      mk("span", { class: "ax-who" }, words),
      aside);
  const detail = () => (form.detail ? mk("div", { class: "ax-detail" }, String(form.detail)) : null);
  /** @param {any} hint @param {...any} acts */
  const foot = (hint, ...acts) => mk("div", { class: "ix-foot" }, hint, mk("div", { class: "ax-acts" }, ...acts));

  /** Its questions, one at a time. */
  const questions = () => {
    const qs = Array.isArray(form.questions) ? form.questions : [];
    /** What the person chose for each question so far, its form's defaults first. @type {Map<string, Set<string>>} */
    const chosen = new Map(qs.map((/** @type {any} */ q) => [String(q.id), new Set(Array.isArray(q.preset) ? q.preset.map(String) : [])]));
    let at = 0;
    /** The words the person may write: masked for a secret, a number checked as it's sent. @param {any} q */
    const wordsField = (q) => {
      const numeric = q.words === "number" || q.words === "integer";
      const placeholder = q.choices?.length
        ? "Or answer in your own words"
        : q.words === "secret" ? "Hidden as you type, and never shown again" : numeric ? (q.words === "integer" ? "A whole number" : "A number") : "Your answer";
      const common = { class: "ix-feedback ax-words", placeholder, "aria-label": `Your answer to ${q.prompt || q.id}`, autocomplete: "off" };
      const el = q.words === "text"
        ? mk("textarea", { ...common, rows: "2" }, String(q.presetWords || ""))
        : mk("input", { ...common, type: q.words === "secret" ? "password" : "text", ...(numeric ? { inputmode: q.words === "integer" ? "numeric" : "decimal" } : {}), value: q.presetWords ? String(q.presetWords) : undefined });
      controls.push(el);
      return el;
    };
    const panes = qs.map((/** @type {any} */ q) => {
      const id = String(q.id);
      /** @param {string} c */
      const pick = (c) => () => choose(id, c);
      const rows = (Array.isArray(q.choices) ? q.choices : []).map((/** @type {any} */ c, /** @type {number} */ i) => ({
        id: String(c.id),
        row: choiceRow(c, i, { several: !!q.several, pick: pick(String(c.id)), go: () => { if (!q.several) go(); } }),
      }));
      const words = q.words ? wordsField(q) : null;
      const el = mk("div", { class: "ax-q" },
        mk("div", { class: "ax-q-text" },
          q.header ? mk("span", { class: "ax-chip" }, String(q.header)) : null,
          mk("span", { class: "ax-prompt" }, ...inlineMarks(mk, String(q.prompt || q.id)))),
        rows.length ? mk("div", { class: "ix-options", role: q.several ? "group" : "radiogroup", "aria-label": String(q.prompt || q.id) }, ...rows.map((/** @type {any} */ r) => r.row)) : null,
        words);
      return { q, id, el, rows, words };
    });
    /** @param {(typeof panes)[number]} p */
    const wordsOf = (p) => String(p.words?.value ?? "").trim();
    /** @param {string} id @param {string} c */
    const choose = (id, c) => {
      if (busy || sent) return;
      const p = panes.find((x) => x.id === id);
      const set = chosen.get(id);
      if (!p || !set) return;
      if (!p.q.several) chosen.set(id, new Set([c]));
      else if (set.has(c)) set.delete(c);
      else set.add(c);
      err.replaceChildren();
      paint();
    };
    const answers = () =>
      Object.fromEntries(panes.flatMap((p) => {
        const picked = [...(chosen.get(p.id) || [])];
        const words = wordsOf(p);
        return picked.length || words ? [[p.id, { chosen: picked, ...(words ? { words } : {}) }]] : [];
      }));
    const focusPane = () => (panes[at].rows[0]?.row || panes[at].words)?.focus?.();
    /** On to the next question once this one's answer reads right; the last sends them all. */
    const go = () => {
      if (busy || sent || !panes.length) return;
      const p = panes[at];
      const why = replyProblem(p.q, chosen.get(p.id)?.size || 0, wordsOf(p));
      if (why) {
        err.replaceChildren(why);
        return;
      }
      err.replaceChildren();
      if (at < panes.length - 1) {
        at++;
        paint();
        focusPane();
        return;
      }
      void send({ outcome: "answered", answers: answers() });
    };
    const stage = mk("div", { class: "ax-stage" });
    const step = mk("span", { class: "ax-step" });
    const hint = mk("span", { class: "ix-hint" });
    const back = btn("Back", "The question before", () => {
      if (busy || sent || at === 0) return;
      at--;
      err.replaceChildren();
      paint();
      focusPane();
    });
    const skip = btn("Skip", `Answer none of it: ${who} goes on without your answers`, () => void send({ outcome: "skipped" }));
    const next = btn("Send", "", go, true);
    /** @type {any} */
    let shown = null;
    const paint = () => {
      const p = panes[at];
      if (!p) return;
      for (const x of panes)
        for (const r of x.rows) {
          const on = !!chosen.get(x.id)?.has(r.id);
          r.row.classList.toggle("on", on);
          r.row.setAttribute("aria-checked", on ? "true" : "false");
        }
      if (shown !== p.el) {
        stage.replaceChildren(p.el);
        shown = p.el;
      }
      const last = at === panes.length - 1;
      step.replaceChildren(panes.length > 1 ? `${at + 1} of ${panes.length}` : "");
      back.classList.toggle("hidden", at === 0);
      next.replaceChildren(last ? "Send" : "Next");
      next.setAttribute("title", last ? `Send your answer${panes.length > 1 ? "s" : ""} to ${who}` : "The next question");
      const keys = p.rows.length ? `1–${Math.min(p.rows.length, KEYED)} to choose · ` : "";
      hint.replaceChildren(`${keys}${p.q.words === "text" ? "Ctrl+Enter" : "Enter"} to ${last ? "send" : "go on"}`);
    };
    /** @param {KeyboardEvent} e */
    const keys = (e) => {
      const target = /** @type {any} */ (e.target);
      const tag = String(target?.tagName || "");
      const typing = tag === "TEXTAREA" || tag === "INPUT";
      const p = panes[at];
      if (!p) return;
      if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const r = p.rows[Number(e.key) - 1];
        if (!r) return;
        e.preventDefault();
        choose(p.id, r.id);
        // A single choice with nothing more to write moves on, but never sends: the last question waits for Enter.
        if (!p.q.several && !p.words && at < panes.length - 1) go();
      } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !typing && p.rows.length) {
        e.preventDefault();
        const i = p.rows.findIndex((r) => r.row === target);
        const n = (i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1) + p.rows.length) % p.rows.length;
        p.rows[n].row.focus?.();
      } else if (e.key === "Enter") {
        const row = p.rows.find((r) => r.row === target);
        // Another button answers its own click; a new line is Enter's in a text box.
        if ((tag === "BUTTON" && !row) || (tag === "TEXTAREA" && !e.ctrlKey && !e.metaKey)) return;
        e.preventDefault();
        if (row && !p.q.several) choose(p.id, row.id);
        go();
      }
    };
    const title = String(form.title || "");
    const lone = panes.length === 1 ? String(panes[0].q.prompt || "") : "";
    paint();
    return mk("div", { class: "ix-block ax-block", role: "group", "aria-label": `${who} asks`, tabindex: "-1", onkeydown: keys },
      head("circleHelp", `${who} asks`, step),
      title && title !== lone ? mk("div", { class: "ix-reason ax-title" }, ...inlineMarks(mk, title)) : null,
      detail(),
      stage,
      err,
      foot(hint, skip, back, next));
  };

  /** A plan's answer as Accept, or Reject with the person's words (Cursor's). */
  const planVerdict = () => {
    const why = mk("textarea", { class: "ix-feedback ax-words hidden", rows: "2", placeholder: `What should change? ${who} reads it (optional)`, "aria-label": "What should change" });
    controls.push(why);
    let rejecting = false;
    const acts = mk("div", { class: "ax-acts" });
    const rejectNow = () => {
      const words = String(why.value ?? "").trim();
      void send({ outcome: "rejected", ...(words ? { reason: words } : {}) });
    };
    const reject = btn("Reject", `Say no: ${who} plans again`, () => { rejecting = true; paint(); why.focus?.(); });
    const accept = btn("Accept", `${who} goes on with this plan`, () => void send({ outcome: "accepted" }), true);
    const cancel = btn("Cancel", "Back to the answers", () => { rejecting = false; paint(); reject.focus?.(); });
    const sendReject = btn("Reject", `Say no, with your words: ${who} plans again`, rejectNow, true);
    why.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        rejectNow();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        rejecting = false;
        paint();
        reject.focus?.();
      }
    });
    const paint = () => {
      acts.replaceChildren(...(rejecting ? [cancel, sendReject] : [reject, accept]));
      why.classList.toggle("hidden", !rejecting);
    };
    paint();
    return { parts: [why], hint: mk("span", { class: "ix-hint" }, `${who} waits for your decision`), acts, keys: null };
  };

  /**
   * A plan's answer as one of its agent's own ways on (HarnessV3-ACP AC3-3): its rows on the number keys and the
   * arrows, the first chosen, Enter or the button named for the row sending it. A way to keep planning opens the words
   * box — Ctrl+Enter sends from it — and its words go to the agent as the person's next message. Under Read-only a yes
   * says the switch moves to Ask before changes: Read-only would refuse every edit the plan needs.
   * @param {any[]} ways
   */
  const planWays = (ways) => {
    let at = 0;
    /** A way that keeps the agent planning. @param {any} c */
    const back = (c) => /^reject/i.test(String(c?.kind || ""));
    const words = mk("textarea", { class: "ix-feedback ax-words hidden", rows: "2", placeholder: `What should change? It goes to ${who} as your next message (optional)`, "aria-label": "What should change" });
    controls.push(words);
    const go = () => {
      const c = ways[at];
      if (c) void settle(() => io.plan({ choice: String(c.id), words: back(c) ? String(words.value ?? "").trim() : "" }));
    };
    const rows = ways.map((/** @type {any} */ c, /** @type {number} */ i) => choiceRow(c, i, { pick: () => { at = i; paint(); }, go }));
    const lift = mk("div", { class: "ax-detail hidden" }, "Read-only would refuse its edits: a yes moves the switch to Ask before changes.");
    const confirm = btn("", "", go, true);
    const hint = mk("span", { class: "ix-hint" });
    const paint = () => {
      rows.forEach((/** @type {any} */ r, /** @type {number} */ i) => {
        r.classList.toggle("on", i === at);
        r.setAttribute("aria-checked", i === at ? "true" : "false");
      });
      const c = ways[at];
      words.classList.toggle("hidden", !back(c));
      lift.classList.toggle("hidden", io.mode !== "read-only" || back(c));
      confirm.replaceChildren(String(c?.label || "Answer"));
      confirm.setAttribute("title", `Answer ${who}: ${c?.label || ""}`);
      hint.replaceChildren(`↑↓ or 1–${Math.min(rows.length, KEYED)} to choose · ${back(c) ? "Ctrl+Enter" : "Enter"} to answer`);
    };
    words.addEventListener("keydown", (/** @type {KeyboardEvent} */ e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        go();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        rows[at]?.focus?.();
      }
    });
    /** The rows' keys; the words box keeps its own. @param {KeyboardEvent} e */
    const keys = (e) => {
      const target = /** @type {any} */ (e.target);
      const tag = String(target?.tagName || "");
      if (tag === "TEXTAREA") return;
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[1-9]$/.test(e.key) && rows[Number(e.key) - 1]) {
        e.preventDefault();
        at = Number(e.key) - 1;
        paint();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        at = (at + (e.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
        paint();
        rows[at].focus?.();
      } else if (e.key === "Enter" && !(tag === "BUTTON" && !rows.includes(target))) {
        e.preventDefault();
        // The row Enter is pressed on is the answer, whichever was chosen before.
        if (rows.includes(target)) at = rows.indexOf(target);
        go();
      }
    };
    paint();
    const asks = String(form.questions?.[0]?.prompt || "");
    return {
      parts: [
        asks ? mk("div", { class: "ix-reason ax-title" }, ...inlineMarks(mk, asks)) : null,
        mk("div", { class: "ix-options", role: "radiogroup", "aria-label": "Your answer" }, ...rows),
        lift,
        words,
      ],
      hint,
      acts: mk("div", { class: "ax-acts" }, confirm),
      keys,
    };
  };

  /**
   * The plan it proposes, whole, then its answer: Accept, or Reject with the person's words — or one of its agent's own
   * ways on, where it offers them (Claude's).
   */
  const plan = () => {
    const p = form.plan || {};
    const body = planBody(p);
    const text = body.trim() ? mk("div", { class: "ax-plan-text a-md" }) : null;
    if (text) setHtml(text, mdChat(body, null).out);
    // Its to-dos under their own caption, so the list reads apart from the plan's text above it.
    const todos = Array.isArray(p.todos) && p.todos.length
      ? mk("div", { class: "ax-todo-list" },
        mk("div", { class: "ax-todos-head", "aria-hidden": "true" }, `To-dos · ${p.todos.length}`),
        mk("ul", { class: "ax-todos", "aria-label": "Its to-dos" },
          ...p.todos.map((/** @type {any} */ t) => {
            const m = /** @type {Record<string, { glyph: string, word: string }>} */ (TODO_MARKS)[String(t.status)] || TODO_MARKS.pending;
            return mk("li", { class: `ax-todo is-${m.word}` },
              mk("span", { class: "ax-todo-ic", html: ICONS[/** @type {keyof typeof ICONS} */ (m.glyph)] }),
              mk("span", {}, String(t.text)));
          })))
      : null;
    const ways = Array.isArray(form.questions?.[0]?.choices) ? form.questions[0].choices : [];
    const answer = ways.length ? planWays(ways) : planVerdict();
    return mk("div", { class: "ix-block ax-block is-plan", role: "group", "aria-label": `${who} proposes a plan`, tabindex: "-1", ...(answer.keys ? { onkeydown: answer.keys } : {}) },
      head("listTodo", `${who} proposes a plan`),
      p.name ? mk("div", { class: "ax-title is-name" }, String(p.name)) : null,
      p.overview ? mk("div", { class: "ax-overview" }, ...inlineMarks(mk, String(p.overview))) : null,
      text || todos ? mk("div", { class: "ax-plan" }, text, todos) : null,
      ...answer.parts,
      err,
      mk("div", { class: "ix-foot" }, answer.hint, answer.acts));
  };

  /** A link it asks the person to open: its address whole, before anything opens. */
  const link = () => {
    const url = String(form.link?.url || "");
    let host = "";
    try {
      host = new URL(url).host;
    } catch {}
    const decline = btn("Decline", `${who} goes on without it`, () => void send({ outcome: "declined" }));
    const open = btn("Open", `Open ${host || "it"} in a new tab`, () => {
      if (busy || sent) return;
      io.open(url);
      void send({ outcome: "accepted" });
    }, true);
    return mk("div", { class: "ix-block ax-block is-link", role: "group", "aria-label": `${who} asks you to open a link`, tabindex: "-1" },
      head("globe", `${who} asks you to open a link`),
      form.title ? mk("div", { class: "ix-reason" }, ...inlineMarks(mk, String(form.title))) : null,
      detail(),
      mk("div", { class: "ax-link" }, mk("span", { class: "ax-link-ic", html: ICONS.externalLink }), mk("code", { class: "ax-url" }, url)),
      err,
      foot(mk("span", { class: "ix-hint" }, host ? `Opens ${host} in a new tab` : "Opens in a new tab"), decline, open));
  };

  const block = form.kind === "plan" ? plan() : form.kind === "link" ? link() : questions();
  hold();
  return block;
}

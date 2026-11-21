// @ts-check
// The Memory instrument (HarnessV3 Step 6 design; HarnessV3-Memory M6-4): what memory did for the newest turn, and the
// switches that decide it for this session. The pill is the turn's count ("3"), with a dot when memory spoke at one
// of the turn's calls (in its accent) or asks the user something (orange); "Muted" for this session's own
// `memory.enabled: false`, "Off" when the global switch decides, "Left out" where Memory settings leave the chat out
// (its engine's `leftOut`, the setting's words, which the popover and the tile say). The popover reads the turn's memory as the app read
// it from the archive (`view.memory`, M6-1): what was said at the calls and whether it was followed; each memory the
// turn was shown, how it is known and how sure memory is of it, with Confirm, Correct and Retire on it; what the turn
// filed and what that replaced; memory's questions, answered in place. Until that read lands it says the turn's
// figures (`facts.memory`). A widget never fetches (D17): every action goes through the context's memory door, which
// reads the turn again after it, and the open popover redraws. While memory's engine installs or updates, its percent
// is the pill and its words head the popover; a missing engine is said, with the way to install it (HarnessV3-AtHome
// AH-D2).
import { h, standing } from "../../lib/dom.js";
import { KIND_WORDS, isRetired as retired, plural, claimLine, claimWords, mayConfirm, questionWords, questionAnswers } from "../../lib/claims.js";
import { engineProgress, engineMissing } from "../../lib/engine.js";
import { head, hero, group, switchRow, row, note, link, section, tok, pages, kids, icon } from "./kit.js";

/** The switches, in the order drawn: the knob and the words for what turns on — the New Task board speaks them too. */
export const MEMORY_SWITCHES = Object.freeze([
  { path: "memory.turnBlock", label: "Recall into each turn", sub: "Relevant memories join the window as you write" },
  { path: "memory.tools", label: "Memory tools for the model", sub: "It can search and save memories itself" },
  { path: "memory.briefing", label: "Session briefing", sub: "A short summary of what matters, up front" },
]);

/** How each kind of memory is drawn: its glyph, its system color, and its name (the console says the same names). */
export const MEMORY_KINDS = Object.freeze({
  rule: { icon: "shieldCheck", color: "var(--color-sys-red)", word: KIND_WORDS.rule },
  convention: { icon: "listTree", color: "var(--color-sys-indigo)", word: KIND_WORDS.convention },
  preference: { icon: "thumbsUp", color: "var(--color-sys-orange)", word: KIND_WORDS.preference },
  decision: { icon: "scale", color: "var(--color-sys-purple)", word: KIND_WORDS.decision },
  fact: { icon: "info", color: "var(--color-sys-blue)", word: KIND_WORDS.fact },
  thread: { icon: "waypoints", color: "var(--color-sys-teal)", word: KIND_WORDS.thread },
  procedure: { icon: "listTodo", color: "var(--color-sys-green)", word: KIND_WORDS.procedure },
  words: { icon: "history", color: "var(--color-sys-gray)", word: KIND_WORDS.words },
});
/** @param {string} kind */
const kindOf = (kind) => /** @type {Record<string, { icon: string, color: string, word: string }>} */ (MEMORY_KINDS)[kind] || { icon: "brain", color: "var(--color-sys-gray)", word: "Memory" };

/** Where a shown memory came in, in words. */
/** The memories Overview's tile names before "+N more". */
const TILE_ROWS = 2;
const LAYERS = Object.freeze({ briefing: "in the briefing", turn: "recalled", erratum: "in a correction note", pitfall: "at a call", thread: "at a call", brief: "in an agent's brief" });

/**
 * @param {import("./registry.js").WidgetContext} ctx
 * @param {import("./frame.js").WidgetIO} [io]
 * @returns {import("./frame.js").WidgetSpec}
 */
export function memoryWidget(ctx, io = {}) {
  const mk = io.h || h;
  const settings = () => ctx.view()?.settings || {};
  const eff = () => settings().effective || {};
  const on = () => eff().memory?.enabled !== false;
  const source = () => String(settings().sources?.["memory.enabled"] || "default");
  const muted = () => !on() && source() !== "global"; // a session or project layer mutes this session alone
  /** Why Memory settings leave this chat out, in their words (its engine as the page reads it: sessions/service.js `engineOf`), or null. */
  const leftOut = () => (settings().engine?.leftOut ? String(settings().engine.leftOut) : null);
  /** Whether memory works in this chat: on for it, and not left out by Memory settings. */
  const works = () => on() && !leftOut();
  /** Where memory works in this chat, why it learns nothing from it now, in the server's words (`engineOf`), or null. */
  const learnsNothing = () => (works() && settings().engine?.learnsNothing ? String(settings().engine.learnsNothing) : null);
  const facts = () => ctx.view()?.facts?.memory || null;
  /** The turn's memory as the app read it (M6-1), or null until it lands. */
  const mem = () => ctx.view()?.memory || null;
  const count = () => Number(mem()?.count ?? facts()?.injected ?? 0);
  const fired = () => (Array.isArray(mem()?.reminders) ? mem().reminders : []);
  const asks = () => Number(mem()?.asks?.count) || 0;
  const flag = (/** @type {string} */ path) => {
    const [, key] = path.split(".");
    return eff().memory?.[key] !== false;
  };
  /**
   * An install or update of memory's engine running now, in words; said only while memory works in the chat, and of
   * recall alone where it learns nothing from it, which the chat's own line says.
   */
  const progress = () => (works() ? engineProgress(ctx.memoryEngine(), { learns: !learnsNothing() }) : null);
  /** Memory's engine missing, in words; said only while memory works in the chat, as `progress` says it. */
  const missing = () => (works() ? engineMissing(ctx.memoryEngine(), { learns: !learnsNothing() }) : null);
  /** Library › Memory on the chat's own workspace (proposal_ux §4.15); the dashboard's page where there is no Library. */
  const browse = () => (ctx.openLibrary ? ctx.openLibrary("memory", String(ctx.chat?.()?.cwd || "")) : ctx.openPage("memory"));
  /** The popover's own state: the claim being corrected and its draft, and an action on its way. */
  const st = { editing: /** @type {string | null} */ (null), draft: "", busy: false };
  /** @type {ReturnType<typeof pages> | null} */
  let pg = null;
  const redraw = () => pg?.repaint();

  /** An action through the door; a refusal is said in a toast. @param {() => Promise<any>} fn */
  const act = async (fn) => {
    st.busy = true;
    redraw();
    try {
      const r = await fn();
      if (r && r.ok === false) ctx.toast(r.error || "memory refused it", "err");
    } catch (/** @type {any} */ e) {
      ctx.toast(e?.message || String(e), "err");
    } finally {
      st.busy = false;
      st.editing = null;
      redraw();
    }
  };
  /** @param {typeof h} m @param {string} glyph @param {string} label @param {string} title @param {() => void} onClick */
  const actBtn = (m, glyph, label, title, onClick) =>
    m("button", { class: "inst-claim-act", type: "button", title, "aria-label": title, ...(st.busy ? { disabled: "" } : {}), onclick: (/** @type {Event} */ e) => { e.stopPropagation?.(); if (!st.busy) onClick(); } }, icon(m, glyph), m("span", { class: "inst-claim-act-label" }, label));

  /** Whether the draft says something new of a claim. @param {any} c */
  const fresh = (c) => !!st.draft.trim() && st.draft.trim() !== String(c.text).trim();
  /** @param {any} c */
  const save = (c) => {
    if (!st.busy && fresh(c)) act(() => ctx.memory.correct(c.id, st.draft.trim()));
  };
  /**
   * A claim being corrected: its words in a field, Cancel and Save — Save only once the words say something new, kept
   * in step as they are typed. ⌘/Ctrl-Enter saves, Esc cancels. @param {typeof h} m @param {any} c
   */
  const correcting = (m, c) => {
    const saveBtn = m("button", { class: "inst-btn is-primary", type: "button", onclick: () => save(c) }, "Save");
    // The Save on the page: the popover is drawn again in place, its field typed in where it stood.
    const mark = () => standing(saveBtn).toggleAttribute("disabled", st.busy || !fresh(c));
    const field = m("textarea", {
      class: "inst-field",
      rows: "3",
      "aria-label": `What is true now, in place of ${c.id}`,
      oninput: (/** @type {Event} */ e) => {
        st.draft = String(/** @type {HTMLTextAreaElement} */ (e.target).value);
        mark();
      },
      onkeydown: (/** @type {KeyboardEvent} */ e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(c); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation?.(); st.editing = null; redraw(); }
      },
    });
    field.value = st.draft;
    mark();
    return m("div", { class: "inst-row inst-claim is-editing" },
      m("div", { class: "inst-claim-edit-head" }, `Correct ${c.id}`),
      field,
      m("div", { class: "inst-actions" },
        m("button", { class: "inst-btn", type: "button", onclick: () => { st.editing = null; redraw(); } }, "Cancel"),
        saveBtn));
  };

  /**
   * One memory as a row: its kind's tile, its words in two lines, what memory knows of it, and its actions (Confirm
   * when it says something new, `mayConfirm`; Correct; Retire) — a retired one and past words have none.
   * @param {typeof h} m @param {any} c @param {readonly (string | null | false | undefined)[]} [lead]
   */
  const claimRow = (m, c, lead = []) => {
    if (st.editing === c.id) return correcting(m, c);
    const k = kindOf(c.kind);
    const acting = c.status && !retired(c.status) && c.kind !== "words" && c.kind !== "engine";
    const acts = acting
      ? m("span", { class: "inst-claim-acts" }, ...kids([
          mayConfirm(c) ? actBtn(m, "check", "Confirm", `Confirm ${c.id}: it is right`, () => act(() => ctx.memory.confirm(c.id))) : null,
          actBtn(m, "pencil", "Correct", `Correct ${c.id}`, () => { st.editing = c.id; st.draft = String(c.text); redraw(); }),
          actBtn(m, "archive", "Retire", `Retire ${c.id}: it is not true`, () => act(() => ctx.memory.forget(c.id))),
        ]))
      : null;
    const words = claimWords(c);
    return row(m, {
      icon: k.icon,
      iconColor: k.color,
      label: m("span", { class: "inst-claim-text", title: words }, words),
      sub: c.kind === "words" || c.kind === "engine" ? lead.filter(Boolean).join(" · ") : claimLine(c, lead),
      trailing: acts,
      cls: `inst-claim${retired(c.status) ? " is-retired" : ""}`,
    });
  };

  /** @param {typeof h} m @param {any} r */
  const reminderRow = (m, r) =>
    row(m, {
      icon: r.kind === "thread" ? "waypoints" : "shieldAlert",
      iconColor: r.kind === "thread" ? "var(--color-sys-teal)" : "var(--color-sys-orange)",
      label: m("span", { class: "inst-claim-text", title: r.claim?.text || "" }, r.claim?.text || r.claim?.id || ""),
      sub: r.kind === "thread"
        ? `Open thread · on ${r.file}`
        : [`On ${r.shape}${r.args ? ` ${r.args}` : ""}`, r.times > 1 ? `said ${r.times} times` : null, r.followed ? "followed" : r.unless ? "not followed yet" : null].filter(Boolean).join(" · "),
      trailing: r.followed ? icon(m, "circleCheck", "inst-check") : null,
      cls: "inst-claim",
    });

  /** @param {typeof h} m @param {any} q */
  const questionRow = (m, q) => {
    const say = questionAnswers(q);
    return row(m, {
      icon: "circleHelp",
      iconColor: "var(--color-sys-orange)",
      label: m("span", { class: "inst-claim-text", title: questionWords(q) }, questionWords(q)),
      sub: q.reason,
      trailing: m("span", { class: "inst-claim-acts is-shown" },
        actBtn(m, "check", say.accept.label, say.accept.aria, () => act(() => ctx.memory.answer(q.id, "accept"))),
        actBtn(m, "x", say.reject.label, say.reject.aria, () => act(() => ctx.memory.answer(q.id, "reject")))),
      cls: "inst-claim",
    });
  };

  /** @param {typeof h} m @param {() => void} close */
  const body = (m, close) => {
    const f = facts();
    const t = mem();
    const related = Array.isArray(f?.related?.sessions) ? f.related.sessions : [];
    const p = progress();
    const gone = missing();
    const unlearned = learnsNothing();
    const status = leftOut() ? `Left out · ${leftOut()}` : !on() ? (muted() ? "Muted for this session" : "Off in your global settings") : `On · ${p ? p.sub : gone ? gone.short : unlearned ? "learning nothing from this session" : "learning from this session"}`;
    const n = count();
    const tokens = Number(t?.tokens ?? f?.tokens) || 0;
    const caption = t || f
      ? [
          "in the last turn",
          tokens ? `${tok(tokens)} tokens` : null,
          fired().length ? plural(fired().length, "reminder") + " at its calls" : null,
          f?.recalls ? `${f.recalls} looked up by the model` : null,
        ].filter(Boolean).join(" · ")
      : "Its work shows here once a turn ends.";
    const shown = Array.isArray(t?.shown) ? t.shown : [];
    const said = Array.isArray(t?.said) ? t.said : [];
    const first = Array.isArray(t?.asks?.first) ? t.asks.first : [];
    return m("div", { class: `inst inst-memory${st.busy ? " is-busy" : ""}` }, ...kids([
      head(m, { icon: "brain", title: "Memory", sub: status }),
      unlearned ? note(m, `${unlearned[0].toUpperCase()}${unlearned.slice(1)}.`) : null,
      p ? note(m, `${p.line}. ${p.meanwhile}`) : null,
      // Install offered only where one can bring the engine: without a bundle here, the note says why.
      gone ? note(m, gone.installable ? [gone.note, " ", link(m, "Install it on the Memory page", () => { close(); ctx.openPage("memory"); })] : gone.note, gone.failed ? "warn" : "") : null,
      works() ? hero(m, { value: String(n), unit: n === 1 ? "memory" : "memories", caption }) : note(m, leftOut()
        ? "Memory settings leave this chat out: nothing is recalled into it, nothing is learned from it, and no other chat reads it. Its turns are kept for the chat itself."
        : muted()
        ? "Nothing is recalled into this conversation and nothing is learned from it. Recording continues."
        : "Memory is off for every session — turn it on in the console's settings."),
      works() && fired().length ? section(m, "At the call", group(m, ...fired().map((r) => reminderRow(m, r)))) : null,
      works() && shown.length
        ? section(m, "This turn", group(m, ...shown.map((c) => claimRow(m, c, [
            (c.layers || []).map((/** @type {string} */ l) => /** @type {Record<string, string>} */ (LAYERS)[l] || l).join(", "),
            c.used === true ? "used" : null,
          ]))))
        : null,
      works() && said.length
        ? section(m, "Said this turn", group(m, ...said.map((c) => claimRow(m, c, [
            c.replaces?.length ? `replaces “${c.replaces.map((/** @type {any} */ o) => o.text).join("”, “")}”` : null,
          ]))))
        : null,
      works() && asks()
        ? section(m, asks() > first.length ? `Memory asks (${asks()})` : "Memory asks", group(m, ...first.map((q) => questionRow(m, q))))
        : null,
      // In a chat Memory settings leave out the session's switches decide nothing: they stand as set, and wait.
      group(m,
        switchRow(m, {
          label: "Memory for this session",
          checked: on(),
          disabled: !!leftOut() || (!on() && !muted()),
          title: leftOut() ? `Memory settings leave this chat out (${leftOut()}) — they decide, not this switch` : !on() && !muted() ? "Off globally — the console's switch decides" : "",
          onChange: (v) => ctx.write(v ? { unset: ["memory.enabled"] } : { patch: { "memory.enabled": false } }),
        }),
        ...MEMORY_SWITCHES.map((s) => switchRow(m, {
          label: s.label,
          sub: s.sub,
          checked: works() && flag(s.path),
          disabled: !works(),
          onChange: (v) => ctx.write({ patch: { [s.path]: v } }),
        }))),
      related.length
        ? section(m, "Related sessions", group(m, ...related.slice(0, 3).map((/** @type {any} */ s) => row(m, {
            icon: "history",
            iconColor: "var(--color-sys-indigo)",
            // As the sidebar names it; the press puts the line in the box, nothing sent (app.js `addLine`).
            label: String(s.title || ctx.sessionRow?.(String(s.id))?.title || ctx.sessionRow?.(String(s.id))?.preview || "an untitled chat"),
            sub: `${s.date ? `${s.date} · ` : ""}Add it to your next message`,
            onClick: () => { close(); if (ctx.addLine) ctx.addLine(`@mem load ${s.id}`); else ctx.command(`@mem load ${s.id}`); },
          }))))
        : null,
      m("div", { class: "inst-foot" },
        link(m, "Browse memories", () => { close(); browse(); }),
        link(m, "All memory settings", () => { close(); ctx.openSetup?.("memory"); })),
    ]));
  };

  return {
    id: "memory",
    label: "Memory",
    icon: "brain",
    width: 380,
    // The tile on Overview (proposal_ux §4.6, M): what memory recalled into the last turn and what it filed, then the
    // first memories the turn was shown, at most two as the mock has them, each in its kind's colour (§5.3), and the
    // way to all of them.
    tileTrail: (m) => m("span", { class: "ov-quiet" }, leftOut() ? "left out here" : !on() ? (muted() ? "muted here" : "off everywhere") : progress() ? `installing · ${progress()?.percent}%` : learnsNothing() ? "on · learns nothing from this chat" : "on · learns from this chat"),
    tile: (m) => {
      if (leftOut()) return [hero(m, { value: "Left out" }), m("p", { class: "ov-line" }, `Memory settings leave this chat out (${leftOut()}): nothing is recalled into it and nothing is learned from it.`)];
      if (!on()) return [hero(m, { value: muted() ? "Muted" : "Off" }), m("p", { class: "ov-line" }, muted() ? "Nothing is recalled into this chat and nothing is learned from it." : "Memory is off for every chat, in your settings.")];
      const shown = Array.isArray(mem()?.shown) ? mem().shown : [];
      const filed = Array.isArray(mem()?.said) ? mem().said.length : 0;
      const gone = missing();
      return [
        hero(m, { value: String(count()), unit: [`recalled into the last turn`, filed ? `${filed} filed` : ""].filter(Boolean).join(" · ") }),
        gone ? m("p", { class: "ov-line is-warn" }, gone.short) : null,
        shown.length
          ? m("ul", { class: "ov-list" }, ...shown.slice(0, TILE_ROWS).map((/** @type {any} */ c) =>
              m("li", { class: "ov-list-item" }, m("span", { class: "inst-dot", style: `background:${kindOf(c.kind).color}` }), m("span", { class: "ov-list-text", title: claimWords(c) }, claimWords(c)))))
          : null,
        m("div", { class: "ov-acts is-split" },
          shown.length > TILE_ROWS ? m("span", { class: "ov-more" }, `+${shown.length - TILE_ROWS} more`) : m("span", {}),
          link(m, "All memories", () => browse())),
      ];
    },
    // Nothing has run yet before the session exists (Facade D9).
    visible: () => ctx.hasSession(),
    state: () => (leftOut() ? "Left out" : !on() ? (muted() ? "Muted" : "Off") : progress() ? `${progress()?.percent}%` : String(count())),
    // In the strip, "Memory 0 recalled": the count is what the last turn was given (the design pass of 10-24).
    named: true,
    more: () => (works() && !progress() ? "recalled" : progress() ? "installing" : ""),
    tone: () => "",
    // The install's percent stands alone: the turn's dots wait for it.
    marks: () => ({ acted: works() && !progress() && fired().length > 0 && !asks(), asking: works() && !progress() && asks() > 0 }),
    title: () =>
      leftOut()
        ? `Memory: left out of this chat — ${leftOut()}`
        : !on()
        ? muted()
          ? "Memory: muted for this session"
          : "Memory: off for every session (global settings)"
        : progress()?.line ||
          [
            `Memory: ${count()} in the last turn`,
            fired().length ? plural(fired().length, "reminder") + " at its calls" : null,
            asks() ? `${plural(asks(), "question")} for you` : null,
            missing()?.short,
          ].filter(Boolean).join(" · "),
    panel: (m, close, relayout) => {
      st.editing = null;
      pg = pages(m, { onSwap: relayout, drawIn: io.drawIn });
      pg.open(() => body(m, close));
      return pg.el;
    },
    repaint: () => redraw(),
  };
}

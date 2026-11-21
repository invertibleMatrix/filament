// @ts-check
// What a card may be (HarnessV3-Facade D4): the kinds Filament attaches to its own answers, and the validator the
// server runs before attaching one. A card that fails validation is logged and never sent — the answer goes out as
// text alone. The page never validates: it draws the kinds it knows and an unknown kind (a server newer than the
// page) falls back to the answer's text, so there is no second validator in the page.
//
// The shape: `{ kind, v: 1, …data, lead?, actions? }`, where `actions` is `[{ label, command }]` and each `command` is
// chat text the harness sends as the person's next message — every button is something any client can type
// (guardrail 18) — and `lead` is what changed for the person, in a sentence or two of plain words: any command may
// give its card one, and the page draws it first, the card's rows under it as the detail they are. Everything Filament
// writes keeps its text exactly as today; the card rides beside it.

export const CARD_KINDS = Object.freeze(["settings-change", "settings-list", "goal", "autofit"]);
export const CARD_V = 1;
const MAX_ACTIONS = 12;
const MAX_LEAD = 600;

/**
 * What is wrong with the card, or null when it may be attached. Structural, not semantic: the validator guards the
 * wire shape, the commands own their values.
 * @param {any} card
 * @returns {string | null}
 */
export function cardProblem(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) return "not an object";
  if (!CARD_KINDS.includes(card.kind)) return `unknown kind "${String(card.kind)}"`;
  if (card.v !== CARD_V) return `expected v ${CARD_V}`;
  if (card.lead !== undefined) {
    if (typeof card.lead !== "string" || !card.lead.trim()) return "lead is not words";
    if (card.lead.length > MAX_LEAD) return `lead is longer than ${MAX_LEAD} characters`;
  }
  if (card.actions !== undefined) {
    if (!Array.isArray(card.actions)) return "actions is not a list";
    if (card.actions.length > MAX_ACTIONS) return `more than ${MAX_ACTIONS} actions`;
    for (const a of card.actions) {
      if (!a || typeof a !== "object") return "an action is not an object";
      if (typeof a.label !== "string" || !a.label.trim()) return "an action has no label";
      if (typeof a.command !== "string" || !a.command.trim()) return "an action has no command";
      if (Object.keys(a).some((k) => k !== "label" && k !== "command")) return "an action carries more than label and command";
    }
  }
  switch (card.kind) {
    case "settings-change": {
      const changes = card.changes;
      if (!Array.isArray(changes) || !changes.length) return "settings-change has no changes";
      for (const c of changes) {
        if (!c || typeof c !== "object") return "a change is not an object";
        if (typeof c.path !== "string" || !c.path.trim()) return "a change has no path";
        if (!("to" in c)) return `the change of ${c.path} carries no new value`;
        for (const k of ["fromSource", "toSource"]) {
          if (typeof c[k] !== "string" || !c[k].trim()) return `the change of ${c.path} has no ${k}`;
        }
      }
      break;
    }
    case "settings-list": {
      if (typeof card.title !== "string" || !card.title.trim()) return "settings-list has no title";
      if (!Array.isArray(card.rows) || !card.rows.length) return "settings-list has no rows";
      for (const r of card.rows) {
        if (!r || typeof r !== "object") return "a row is not an object";
        if (typeof r.path !== "string" || !r.path.trim()) return "a row has no path";
        if (!("value" in r)) return `the row of ${r.path} carries no value`;
        if (typeof r.source !== "string" || !r.source.trim()) return `the row of ${r.path} has no source`;
      }
      break;
    }
    case "goal": {
      if (typeof card.state !== "string" || !card.state.trim()) return "goal has no state";
      if (typeof card.title !== "string") return "goal has no title";
      if (card.notes != null && (!Array.isArray(card.notes) || card.notes.some((/** @type {any} */ n) => typeof n !== "string"))) return "goal notes must be a list of words";
      break;
    }
    case "autofit": {
      if (typeof card.title !== "string" || !card.title.trim()) return "autofit has no title";
      if (!Array.isArray(card.lines) || !card.lines.length) return "autofit has no lines";
      if (card.lines.some((/** @type {any} */ l) => typeof l !== "string")) return "autofit lines must be words";
      if (card.note != null && typeof card.note !== "string") return "autofit note must be words";
      break;
    }
  }
  return null;
}


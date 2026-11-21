// @ts-check
// Drawing a card (HarnessV3-Facade D4, FB): the five kinds Filament attaches to its own answers, and the memory
// note. The server validated the card before sending it; the page draws the kinds it knows and a kind it doesn't
// know (a server newer than the page) falls back to the answer's text — there is no second validator here. Every
// button is chat text the page sends as the person's next message (guardrail 18); a button that only opens one of
// Filament's own screens is the one exception.
import { h } from "../../lib/dom.js";
import { sourceWords, settingChangeWords } from "../lib/labels.js";

/** The kinds this page draws; anything else falls back to the text. */
export const DRAWN_KINDS = ["settings-change", "settings-list", "goal", "autofit"];

/**
 * The card's element, or null when the page does not know the kind (the caller paints the text instead).
 * @param {any} card
 * @param {{ onCommand?: (command: string) => void, onInspector?: () => void }} [cb]
 * @param {{ h?: any }} [io]
 */
export function cardEl(card, cb = {}, io = {}) {
  const mk = io.h || h;
  if (!card || typeof card !== "object" || !DRAWN_KINDS.includes(card.kind)) return null;
  const cmd = (/** @type {string} */ command) => () => cb.onCommand?.(String(command || ""));
  const actions = (list) =>
    Array.isArray(list) && list.length
      ? mk("div", { class: "card-actions" }, ...list.map((a) => mk("button", { class: "ghost sm", type: "button", onclick: cmd(a.command) }, String(a.label || a.command))))
      : null;
  // What changed for the person, in the command's own words (core/cards.js `lead`): first on any kind, the card's rows
  // under it as the detail they are.
  const lead = typeof card.lead === "string" && card.lead.trim() ? mk("p", { class: "card-lead" }, card.lead) : null;
  if (card.kind === "settings-change") {
    // The change in words first ("Effort: Max", "Memory off"); the old → new values only when both are plain
    // values — an object (a tool map, a list of connectors) reads in the words alone, never as JSON.
    const plain = (/** @type {any} */ v) => v === null || v === undefined || ["string", "number", "boolean"].includes(typeof v);
    const rows = (card.changes || []).map((c) =>
      mk("div", { class: "card-row" },
        mk("span", { class: "card-words" }, settingChangeWords(String(c.path), c.to ?? undefined, c.from ?? undefined)),
        plain(c.from) && plain(c.to) ? mk("span", { class: "card-change" }, `${show(c.from)} → ${show(c.to)}`) : null,
        mk("span", { class: "card-path" }, c.path),
        mk("span", { class: "card-sources muted" }, `was ${sourceWords(c.fromSource, card.preset?.name)}, now ${sourceWords(c.toSource, card.preset?.name)}`)));
    const title = (card.changes || []).length === 1 ? "Setting changed" : `${(card.changes || []).length} settings changed`;
    // A card that says what changed in words keeps its rows folded under them: the settings are how it was done.
    if (lead) return mk("div", { class: "shim-card card-settings-change" }, lead, mk("details", { class: "card-detail" }, mk("summary", { class: "card-title" }, title), ...rows), actions(card.actions));
    return mk("div", { class: "shim-card card-settings-change" },
      mk("div", { class: "card-title" }, title),
      ...rows,
      actions(card.actions));
  }
  if (card.kind === "settings-list") {
    const rows = (card.rows || []).map((r) =>
      mk("div", { class: "card-row settings-row" },
        mk("span", { class: "card-path" }, r.path),
        mk("span", { class: "card-value" }, String(r.valueText ?? String(r.value))),
        mk("span", { class: "card-sources muted" }, sourceWords(r.source, card.preset)),
        r.source === "session" ? mk("button", { class: "ghost sm", type: "button", title: `/unset ${r.path}`, onclick: cmd(`/unset ${r.path}`) }, "Reset") : null));
    return mk("div", { class: "shim-card card-settings-list" },
      lead,
      mk("div", { class: "card-title" }, String(card.title || "Settings in force")),
      ...rows,
      mk("div", { class: "card-foot" },
        mk("button", { class: "ghost sm", type: "button", onclick: () => cb.onInspector?.() }, "Open Overview")));
  }
  if (card.kind === "autofit") {
    // Drawn in place of the answer's text, so its note — the rest of what the text says — is drawn too (RD1 a).
    return mk("div", { class: "shim-card card-autofit" },
      lead,
      mk("div", { class: "card-title" }, String(card.title)),
      ...(card.lines || []).map((/** @type {string} */ l) => mk("div", { class: "card-row" }, mk("span", { class: "card-value" }, String(l)))),
      card.note ? mk("div", { class: "card-row card-note" }, mk("span", { class: "card-value muted" }, String(card.note))) : null);
  }
  // goal
  const e = card.estimate || null;
  const rows = [
    mk("div", { class: "card-row" }, mk("span", { class: "card-path" }, "goal"), mk("span", { class: "card-value" }, String(card.text || ""))),
    card.slice ? mk("div", { class: "card-row" }, mk("span", { class: "card-path" }, "slice"), mk("span", { class: "card-value" }, String(card.slice))) : null,
    e ? mk("div", { class: "card-row" }, mk("span", { class: "card-path" }, "estimate"), mk("span", { class: "card-value" }, `${e.sizeClass || "?"} — ${e.achievableSlice || "no slice proposed"}`)) : null,
    e && Array.isArray(e.assumptions) && e.assumptions.length ? mk("div", { class: "card-row" }, mk("span", { class: "card-path" }, "assumes"), mk("span", { class: "card-value" }, e.assumptions.join("; "))) : null,
    e && e.firstStep ? mk("div", { class: "card-row" }, mk("span", { class: "card-path" }, "first step"), mk("span", { class: "card-value" }, String(e.firstStep))) : null,
    // Its drive (core/goal-drive.js): its round, or why it halted and what goes on.
    card.drive ? mk("div", { class: "card-row" }, mk("span", { class: "card-path" }, "drive"), mk("span", { class: "card-value" }, String(card.drive))) : null,
    // What the answer said beyond the goal (an estimate not made): the card never hides it.
    ...(Array.isArray(card.notes) ? card.notes.map((/** @type {string} */ n) => mk("div", { class: "card-row card-note" }, mk("span", { class: "card-path" }, "note"), mk("span", { class: "card-value muted" }, String(n)))) : []),
  ].filter(Boolean);
  return mk("div", { class: `shim-card card-goal card-goal-${card.state}` },
    lead,
    mk("div", { class: "card-title" }, String(card.title || "Goal")),
    ...rows,
    actions(card.actions));
}

/** A value as the card row shows it: null reads "unset", strings and numbers as they are. @param {any} v */
function show(v) {
  if (v === null || v === undefined) return "unset";
  return typeof v === "string" ? v : JSON.stringify(v);
}

/**
 * The memory note above a finished reply (D5): one quiet line saying what memory told the agent — "Memory briefed the
 * agent: your 3 latest chats here, 9 memories" — closed, that opens to what those are: each chat's title, date and
 * summary, with "Add to next message" (`addLine`: `@mem load` at the top of the message box, which pastes it in at Send
 * — nothing is sent, and a turn running now is never steered by it), then the memories' own words, read when it first
 * opens. Drawn from the turn's facts (`memory.related`) when the turn ends — never read back from text; the record
 * counts and never quotes, so a chat's name where it has no title and its summary come from the sessions list the page
 * holds (`chatOf`) and the memories from the turn's memory (`told`). (The owner's word of 10-27: "i don't know the
 * purpose of it … not sure what does that memory contain at all" — it said "found", read as a search for their
 * message, and named titles alone, under a pink band.)
 * @param {any} related  the cue's data { items?, told?, sessions?: [{ id, title, date?, continues? }] }, or null
 * @param {{ addLine?: (line: string) => void, chatOf?: (id: string) => { title?: string | null, preview?: string | null, state?: string | null } | null,
 *   told?: () => Promise<string[]> }} [cb]
 * @param {{ h?: any }} [io]
 */
export function memoryNoteEl(related, cb = {}, io = {}) {
  const mk = io.h || h;
  const sessions = Array.isArray(related?.sessions) ? related.sessions : [];
  // `told`: every memory the briefing named (the user's rules, the project's dossier, the related ones); where the cue
  // counts none, the related ones (`items`).
  const told = Number(related?.told) || Number(related?.items) || 0;
  if (!sessions.length && !told) return null;
  // The chats this one continues (its lineage), then the latest ones of its folder.
  const arc = sessions.filter((/** @type {any} */ s) => s.continues).length;
  const recent = sessions.length - arc;
  const before = arc ? (arc === 1 ? "the chat this continues" : `the ${arc} chats this continues`) : "";
  const chats = recent ? (recent === 1 ? "your latest chat here" : `your ${recent} latest chats here`) : "";
  const kept = told ? `${told} ${told === 1 ? "memory" : "memories"}` : "";
  const line = `Memory briefed the agent: ${[before, chats, kept].filter(Boolean).join(", ")}`;
  const words = told && cb.told ? mk("div", { class: "memory-note-told" }) : null;
  let asked = false;
  const readTold = () => {
    if (asked || !words || !cb.told) return;
    asked = true;
    words.replaceChildren(mk("div", { class: "card-row memory-note-row memory-note-summary" }, "Reading what it was told…"));
    cb.told().then(
      (said) => words.replaceChildren(...(said.length ? said : ["Memory holds none of them now."]).map((t) => mk("div", { class: "card-row memory-note-row memory-note-summary" }, String(t)))),
      () => words.replaceChildren(mk("div", { class: "card-row memory-note-row memory-note-summary" }, "Memory could not be read just now.")),
    );
  };
  const rows = sessions.map((/** @type {any} */ s) => {
    const row = cb.chatOf?.(String(s.id)) || null;
    const summary = row?.state || "";
    // As the sidebar names a chat: its title, else its first words from the page's own list — never the record's.
    const name = String(s.title || row?.title || row?.preview || "an untitled chat");
    return mk("div", { class: "card-row memory-note-row" },
      mk("div", { class: "memory-note-what" },
        mk("span", { class: "card-path" }, name),
        s.date ? mk("span", { class: "memory-note-date" }, ` · ${s.date}`) : null,
        summary ? mk("div", { class: "memory-note-summary" }, String(summary)) : null),
      mk("button", { class: "ghost sm", type: "button", title: `Puts @mem load ${s.id} at the top of your message: Send pastes this chat's turns in`, onclick: () => cb.addLine?.(`@mem load ${s.id}`) }, "Add to next message"));
  });
  if (!rows.length && !words) return mk("div", { class: "memory-note" }, mk("div", { class: "card-title" }, line));
  return mk("details", { class: "memory-note", ontoggle: (/** @type {any} */ e) => { if (e?.target?.open) readTold(); } },
    mk("summary", { class: "card-title" }, line), ...rows, words);
}

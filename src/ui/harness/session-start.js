// @ts-check
// The session-start choice (HarnessV3 Step 2 D15): what a new chat holds until its first send — the Start board's
// held changes over your defaults, and the permission picker's standing. One pure builder turns that held choice into
// the exact `POST /api/sessions` body `ensureSession` sends, so the permission rule is testable without a DOM. A new
// chat starts from your defaults: there are no presets (the owner's of 11-07).
import { nestLayer } from "../lib/settings/editor.js";

/**
 * What an unborn chat's mode switch shows (HarnessV4_Settings_Plan HS-D48): the mode picked for it, with no note;
 * while nobody has picked, the board's held mode, else "New chats start in" from your settings (Filament's `edit`
 * until they are read) — each with the note that says whose it is. The composer has one switch for every chat, so it
 * is asked again whenever a chat is selected.
 * @param {{ permTouched?: boolean, pickedPerm?: string | null, heldPerm?: string | null }} chat
 * @param {string | null} newChatMode  "New chats start in", as your defaults say it
 * @returns {{ mode: string, note: string | null }}
 */
export function chipStanding(chat, newChatMode) {
  if (chat.permTouched && chat.pickedPerm) return { mode: chat.pickedPerm, note: null };
  const own = chat.heldPerm || null;
  if (!own) return { mode: newChatMode || "edit", note: "from Settings › Permissions until you change it" };
  return { mode: own, note: "from your held changes until you change it" };
}

/**
 * The create body's part of where the chat works (HarnessV4_Git_Plan GW-D45, GW-D49): a place's folder as the chat's,
 * or the new worktree to make with its name — `made` when Filament made the name from the message (GW-D44) — and the
 * paths its line left on to copy into it (HarnessV4_Four_Plan FO-D34); left out until the line read the project's list.
 * @param {any} choice  `chat.worksIn`, held by conversation/works-in.js
 * @returns {{ cwd?: string, worktree?: { name: string, made: boolean, copy?: string[] } }}
 */
export function worksInPart(choice) {
  if (choice?.make && choice.name)
    return { worktree: { name: String(choice.name), made: !choice.typed, ...(Array.isArray(choice.copy) ? { copy: choice.copy.map(String) } : {}) } };
  if (choice?.path && choice.cwd) return { cwd: String(choice.cwd) };
  return {};
}

/**
 * The body the first send carries (D15): `settings` only when something is actually held — the board's changes,
 * plus `model.effort` where the picker holds one, and `loop.permissions` ONLY when the person picked a mode for this
 * chat: an untouched switch sends nothing, so the chat follows "New chats start in" — now and after it changes
 * (HarnessV4_Settings_Plan HS-D48). The model is the base name — never a suffixed one (Facade D6, FC 11). Where the
 * chat works (`worksInPart`): a place's folder stands for `cwd`, a new worktree rides as `worktree`, made from `cwd`
 * by the create.
 * @param {{ held?: Record<string, any>, permTouched?: boolean, worksIn?: any, from?: { space: string } }} chat  the held choice
 * @param {string} cwd @param {string} model @param {string} [title]
 * @param {string} [perm]  the composer's permission mode at send time ("" = the default)
 * @param {string} [effort]  the composer's effort at send time ("" = Default)
 * @param {Record<string, any>} [held]  the rest of the composer's tuning as flat knobs (model.fast, model.window,
 *   model.thinking.budget) — each only where the board's changes do not already hold the knob
 * @returns {{ cwd: string, model: string, title?: string, autoTitle?: boolean, settings?: any, worktree?: { name: string, made: boolean, copy?: string[] }, from?: { space: string } }}
 */
export function sessionStartBody(chat, cwd, model, title = "", perm = "", effort = "", held = {}) {
  /** @type {any} */
  const body = { cwd, model, ...worksInPart(chat.worksIn) };
  // A name given is the name; without one the server names the session by its first message that reaches the model.
  if (title) body.title = title;
  else body.autoTitle = true;
  // Handed from a Space of your own (A4): the session remembers it, for that Space's What happened.
  if (chat.from?.space) body.from = { space: chat.from.space };
  /** @type {Record<string, any>} */
  const flat = { ...(chat.held || {}) };
  // The picker contributes `loop.permissions` only once the person picked — and never over a board change of the
  // same knob, which the held changes already hold.
  if (perm && chat.permTouched && !("loop.permissions" in flat)) flat["loop.permissions"] = perm;
  if (effort && !("model.effort" in flat)) flat["model.effort"] = effort;
  for (const [k, v] of Object.entries(held || {})) if (v !== undefined && v !== null && !(k in flat)) flat[k] = v;
  if (Object.keys(flat).length) body.settings = nestLayer(flat);
  return body;
}

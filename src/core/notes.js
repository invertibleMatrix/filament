// @ts-check
// A note is the fact behind a line in a record's `changes`: something Filament did differently from what was asked, or
// could not do at all. One object, two renderings — the record sentence (pinned byte for byte by the golden corpus)
// and the hint the user reads in the chat — so neither side has to parse the other's prose. Every kind in the
// registry has both renderers; test/core-notes.test.js fails when one is missing or when a kind has no sample.

/**
 * How the agent's working folder was decided. "home" without `blocked` means no project path was found at all.
 * @typedef {"header" | "system prompt" | "message" | "default" | "first allowlisted folder" | "home"} CwdWhere
 */

/**
 * @typedef {{ kind: "cwd", cwd: string, where: CwdWhere, blocked: string | null, ignored: string[] }} CwdNote
 *   `blocked` is the client's folder the allowlist refused; `ignored` lists allowlist entries skipped for not being
 *   folder paths.
 * @typedef {{ kind: "model-not-offered", model: string, offers: string[], keeping: string, typed?: boolean, keyed?: boolean }} ModelNotOfferedNote
 *   `typed`: the name was typed on the upstream's card (HarnessV4_Tasks E9) — the person chose it, so they are told.
 * @typedef {{ kind: "mode-not-offered", mode: string, has: string[] }} ModeNotOfferedNote
 * @typedef {{ kind: "effort-not-applied", effort: string, reason: string }} EffortNotAppliedNote
 * @typedef {{ kind: "model-name-ignored", ignored: string[] }} ModelNameIgnoredNote
 * @typedef {{ kind: "images-dropped", count: number }} ImagesDroppedNote
 * @typedef {{ kind: "files-undelivered", count: number }} FilesUndeliveredNote
 * @typedef {{ kind: "permissions-unanswerable" }} PermissionsUnanswerableNote
 *   the policy is "ask" but the client has no question tool, so the prompt was allowed once
 * @typedef {{ kind: "question-unasked", asked: string, why: string, heard: string }} QuestionUnaskedNote
 *   the agent asked the person something nobody could be asked (HarnessV3-ACP AC2-4): `why` not, and what the agent
 *   heard at once instead (skipped, declined, or its plan accepted)
 * @typedef {{ kind: "other-model", chosen: string, answered: string, why?: "not-offered" | "rerouted" | null }} OtherModelNote
 *   the model that answered is not the one the chat names (core/answering-model.js `answeredAs`): `chosen` as sent to
 *   the agent, `answered` as the agent said it; `why` where the turn said it — the agent does not offer the name
 *   ("not-offered"), or sent the turn to another model ("rerouted")
 */

/**
 * @typedef {CwdNote | ModelNotOfferedNote | ModeNotOfferedNote | EffortNotAppliedNote | ModelNameIgnoredNote
 *   | ImagesDroppedNote | FilesUndeliveredNote | PermissionsUnanswerableNote | QuestionUnaskedNote | OtherModelNote} Note
 */

/**
 * What the hint renderer needs from the conversation: the agent's display name and whether this is the chat's first
 * turn (some advice is only worth giving once, at the start).
 * @typedef {{ agentName: string, firstTurn: boolean }} HintContext
 */

/**
 * A sentence for the user. `mustSay` hints go out even with `acp.hints` off, once per conversation: Filament silently
 * did something other than what was configured and there is no other way to learn that from inside a chat.
 * @typedef {{ mustSay: boolean, text: string }} Hint
 */

/** @type {(xs: string[]) => string} */
const quoted = (xs) => xs.map((x) => `\u201c${x}\u201d`).join(", ");

const SETTINGS = "under Destinations \u2192 Upstreams";

/**
 * The parenthesised part of the cwd record line — also what `determineCwd` returns as `source`, so the two never
 * disagree.
 * @param {Omit<CwdNote, "kind" | "cwd">} n
 */
export function cwdSourceText(n) {
  let s = n.where === "home" && !n.blocked ? "home (no project path found)" : n.where;
  if (n.blocked) s += `; ${n.blocked} is outside cwdAllowlist`;
  if (n.ignored.length) {
    const entries = n.ignored.length === 1 ? "entry" : "entries";
    s += `; cwdAllowlist ${entries} ${quoted(n.ignored)} ignored: not a folder path`;
  }
  return s;
}

/**
 * @template {Note["kind"]} K
 * @typedef {{
 *   record: (note: Extract<Note, { kind: K }>) => string,
 *   hints: (note: Extract<Note, { kind: K }>, ctx: HintContext) => Hint[],
 * }} Renderers
 */

/** @type {{ [K in Note["kind"]]: Renderers<K> }} */
export const NOTE_KINDS = {
  cwd: {
    record: (n) => `acp: cwd ${n.cwd} (${cwdSourceText(n)})`,
    hints: (n, { agentName, firstTurn }) => {
      /** @type {Hint[]} */
      const out = [];
      if (n.blocked)
        out.push({
          mustSay: true,
          text:
            `this chat's folder ${n.blocked} is not among the folders ${agentName} may work in (acp.cwdAllowlist), ` +
            `so it works in ${n.cwd} instead; add the folder to that list ${SETTINGS}.`,
        });
      else if (n.where === "home" && firstTurn)
        out.push({
          mustSay: false,
          text:
            `no project folder came with this chat, so ${agentName} works in ${n.cwd}; open the chat inside a ` +
            `project folder, or set acp.cwdDefault ${SETTINGS}.`,
        });
      if (n.ignored.length)
        out.push({
          mustSay: false,
          text:
            `the allowed-folders list of ${agentName} (acp.cwdAllowlist) contains ${quoted(n.ignored)}, which is ` +
            `not a folder path; it was ignored. Fix the list ${SETTINGS}.`,
        });
      return out;
    },
  },
  "model-not-offered": {
    record: (n) =>
      `acp: model ${n.model}${n.typed ? " (typed on the upstream's card)" : n.keyed ? " (from the account's API key)" : ""} not offered by this agent (offers ${n.offers.join(", ")}); keeping ${n.keeping}`,
    hints: (n, { agentName }) => [
      {
        mustSay: !!(n.typed || n.keyed),
        text: n.typed
          ? `\u201c${n.model}\u201d, the name you typed on its card, is not a model ${agentName} offers, so it kept ${n.keeping} (it offers ${n.offers.join(", ")}).`
          : n.keyed
            ? `\u201c${n.model}\u201d, which Anthropic lists for this account's API key, is not a model ${agentName} offers, so it kept ${n.keeping} (it offers ${n.offers.join(", ")}).`
            : `\u201c${n.model}\u201d is not a model ${agentName} offers, so it kept ${n.keeping} (it offers ${n.offers.join(", ")}).`,
      },
    ],
  },
  "mode-not-offered": {
    record: (n) => `acp: mode ${n.mode} not offered by this agent (has ${n.has.join("/")})`,
    hints: (n, { agentName }) => [
      {
        mustSay: false,
        text: `mode @${n.mode} is not one ${agentName} has (${n.has.join("/")}); the current mode stays.`,
      },
    ],
  },
  "effort-not-applied": {
    record: (n) => `acp: effort ${n.effort} not applied: ${n.reason}`,
    hints: (n) => [{ mustSay: false, text: `effort ${n.effort} was not applied: ${n.reason}.` }],
  },
  "model-name-ignored": {
    record: (n) => `acp: ignored in the model name: ${n.ignored.join(", ")}`,
    hints: (n, { agentName }) => [
      {
        mustSay: false,
        text: `\u201c${n.ignored.join(", ")}\u201d in the model name means nothing to ${agentName}; the rest of the name was applied.`,
      },
    ],
  },
  "images-dropped": {
    record: (n) => `acp: ${n.count} image(s) dropped (this agent does not accept images)`,
    hints: (n, { agentName }) => [
      { mustSay: false, text: `${n.count} image(s) were not sent: ${agentName} does not accept images.` },
    ],
  },
  "files-undelivered": {
    record: (n) => `acp: ${n.count} binary file(s) could not be delivered to this agent`,
    hints: (n, { agentName }) => [
      {
        mustSay: false,
        text: `${n.count} attached file(s) could not be delivered to ${agentName}; paste the text or give it the file's path.`,
      },
    ],
  },
  "permissions-unanswerable": {
    record: () => "acp: permissions ask: the client has no question tool, so the prompt was allowed once",
    hints: (_n, { agentName }) => [
      {
        mustSay: true,
        text:
          `${agentName}'s permission policy is \u201cask\u201d, but this chat tool declares no question tool, so its ` +
          `prompts were allowed once; Claude Code offers AskUserQuestion and gets real prompts.`,
      },
    ],
  },
  "question-unasked": {
    record: (n) => `acp: the agent asked \u201c${n.asked}\u201d, but ${n.why}; it heard \u201c${n.heard}\u201d`,
    hints: (n, { agentName }) => [
      {
        mustSay: true,
        text: `${agentName} asked \u201c${n.asked}\u201d, but ${n.why}, so it went on without your answer (it heard \u201c${n.heard}\u201d).`,
      },
    ],
  },
  // Always said: the chat names one model on every screen while another wrote the reply, and nothing else in a chat
  // says so. Both names, what it means, and the one thing the person can do.
  "other-model": {
    record: (n) => `acp: answered by ${n.answered}, not ${n.chosen}, the model asked for${n.why === "not-offered" ? " (not offered)" : n.why === "rerouted" ? " (rerouted)" : ""}`,
    hints: (n, { agentName }) => [
      {
        mustSay: true,
        text:
          `This reply came from ${n.answered}, not ${n.chosen}, the model this chat names: ` +
          (n.why === "not-offered"
            ? `${agentName} does not offer that model on this account and kept its own.`
            : n.why === "rerouted"
              ? `${agentName} sent the turn to another model.`
              : `${agentName} answered on its own model, most likely because this account is not offered that one.`) +
          ` To get the model you choose, pick one ${agentName} lists for this account in the model menu.`,
      },
    ],
  },
};

/**
 * @template {Note["kind"]} K
 * @param {Extract<Note, { kind: K }>} note
 * @returns {Renderers<K>}
 */
function renderersFor(note) {
  const r = NOTE_KINDS[/** @type {K} */ (note.kind)];
  if (!r) throw new Error(`unknown note kind ${JSON.stringify(note.kind)}`);
  return r;
}

/**
 * The line a record's `changes` carries for this note.
 * @param {Note} note
 */
export function renderRecord(note) {
  return renderersFor(note).record(/** @type {any} */ (note));
}

/**
 * What the user should read about this note, if anything: zero or more hints, in the order they should be said.
 * @param {Note} note
 * @param {HintContext} ctx
 * @returns {Hint[]}
 */
export function renderHints(note, ctx) {
  return renderersFor(note).hints(/** @type {any} */ (note), ctx);
}

/**
 * A note with its position in the turn's `notes` list, so a continuing turn can slice both lists the same way.
 * @typedef {{ at: number, note: Note }} Positioned
 */

/**
 * Push a note onto a turn's two lists at once: the record sentence onto `notes` (what records and tests read) and
 * the object, with its position, onto `structured` (what the hint renderer reads).
 * @param {string[]} notes
 * @param {Positioned[]} structured
 * @param {Note} note
 */
export function pushNote(notes, structured, note) {
  structured.push({ at: notes.length, note });
  notes.push(renderRecord(note));
}

/**
 * Append another pair of lists (an attachment scan's, say) onto a turn's, re-based so positions stay right.
 * @param {string[]} notes
 * @param {Positioned[]} structured
 * @param {{ notes: string[], structured: Positioned[] }} more
 */
export function appendNotes(notes, structured, more) {
  for (const s of more.structured) structured.push({ at: notes.length + s.at, note: s.note });
  notes.push(...more.notes);
}

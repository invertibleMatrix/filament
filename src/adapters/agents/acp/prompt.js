// The prompt text one turn sends, for the ACP agents and Cursor's SDK alike: the newest user message with the recall
// memory gave it after its words, preceded — when the session needs it — by the turns it missed (another model
// handled them), the earlier conversation it is seeded with (a harness chat's: the harness's composition of it,
// compacted or not, HarnessV3-ACP AC5-1 and AC-R1; an outside client's: the archive, or the client's own history), the
// client's system prompt, what changed in Filament's context for the session (HarnessV3-ACP AC4-1), and the steering
// instruction once per steered session. An agent's own command goes as typed, and what the session is owed waits for
// the next prompt (the bug report's L20); the session has what a prompt carries once it goes out (`told`, L21).
// For the steering instruction's default text. Read from the schema rather than copied, so the words the dashboard
// shows as the default and the words actually sent can never drift apart. (schema.js imports nothing, so no cycle.)
import { SCHEMAS } from "../../../core/schema.js";
import { estimateTokens } from "../../../core/tokens.js";
import { isUserTurn } from "../../../core/wire/flatten.js";
import { ahead, isAgentCommand, notHeldIn, withPromptBlocks } from "../context.js";
import { COMPACTED_WORDS, EARLIER_WORDS } from "../compactions.js";

export const DEFAULT_STEERING_PROMPT =
  SCHEMAS?.UPSTREAM?.acp?.steeringPrompt?.default ||
  "Tool routing: prefer the Filament tools (Read, Write, Edit, Bash, Glob, Grep) over your built-in equivalents; they are rendered natively in the person's editor.";

// The messages of the client's history `keep` takes by the person's turn each is in, counted up to it. A turn is the
// person's: tool results answering the agent's own calls are none (`isUserTurn`).
function byTurn(history, keep) {
  let turn = 0;
  return history.filter((m) => {
    if (isUserTurn(m)) turn++;
    return keep(turn);
  });
}

// The part of the client's history a session missed: everything from the first user turn it did not see, but the
// turns it heard as typed (`heard`: its own commands, sent while it was owed the turns before them, L20) and what
// answered them. Empty when it saw them all.
export function missedTurns(history, seenUserTurns, heard = []) {
  return byTurn(history, (turn) => turn > seenUserTurns && !heard.includes(turn));
}

// What a fresh session's seed carries of the client's history: all of it but the turns the session heard as typed —
// its own commands, sent while its seed waited (L20) — and what answered them.
export function unheard(history, heard = []) {
  return byTurn(history, (turn) => !heard.includes(turn));
}

/**
 * The person's words the agent took into its running turn (HarnessV3-ACP AC3-1), the turn whose prompt was the
 * history's `at`-th user turn, in the order it took them. The archive keeps them inside that turn, so from then on the
 * chat's history holds them as user turns the session saw: the next prompt counts them so (`seenWithin`).
 * @param {{ seenUserTurns?: number | null, within?: { after: number, texts: string[] } }} conv @param {number} at
 * @param {string} text @param {boolean} [pictures]  pictures came with the words (HarnessV4_Tasks C22)
 */
export function tookWithin(conv, at, text, pictures = false) {
  const words = String(text || "").trim();
  // Pictures with no words are a turn of the history's too, its text empty.
  if (!words && !pictures) return;
  if (conv.within?.after !== at) conv.within = { after: at, texts: [] };
  conv.within.texts.push(words);
}

// How many of the history's user turns right after the `after`-th are the person's words the agent took into that
// turn (`texts`, in order): the archive keeps them last in a message of the turn — after the results it answers, or as
// one of its own — so each such turn ends with them. The count stops at the first that does not, someone else's turn.
// A history without them has none: an outside client's never held them, and a fold puts them in the turn's answer.
function turnsWithin(history, after, texts) {
  let turn = 0;
  let next = 0;
  let n = 0;
  for (const m of history) {
    if (!isUserTurn(m)) continue;
    turn++;
    if (turn <= after) continue;
    const text = String(m.text || "");
    let j = next;
    while (j < texts.length && !text.endsWith(texts[j])) j++;
    if (j === texts.length) break;
    next = j + 1;
    n++;
    if (next === texts.length) break;
  }
  return n;
}

/**
 * Filament's copy of the chat starts from a summary its sessions went on under — a coding agent's own, or the one
 * Filament wrote for the copy alone (`seenOf`, ../compactions.js) — and this session last counted the person's turns
 * on another start: the harness's count takes the place of its own, once for that start. What the session kept by the earlier form's places goes with it — the words taken within its last turn
 * (`within`, which the harness's count holds as they stand now) and the turns it heard as typed (`heard`: a session
 * that owed turns compacts into no summary of the chat's, `owes`, so only another agent's summary reaches one here,
 * and that summary stands for them). A session that has counted none yet is seeded, and counts on this start.
 * @param {{ seenUserTurns?: number | null, countedOn?: number, within?: any, heard?: number[] }} conv
 * @param {{ head: number, seen: number } | null} said
 * @returns {boolean} whether the harness's count was taken
 */
export function recounted(conv, said) {
  if (!said || conv.countedOn === said.head) return false;
  conv.countedOn = said.head;
  if (conv.seenUserTurns == null) return false;
  conv.seenUserTurns = said.seen;
  delete conv.within;
  delete conv.heard;
  return true;
}

/**
 * The user turns the agent's last turn holds in this history — the person's words it took while it ran — counted as
 * seen (`seenUserTurns`), once: else the next prompt hands the agent its own turn back as one another assistant
 * handled, from the first of them on. Returns how many.
 * @param {{ seenUserTurns?: number | null, within?: { after: number, texts: string[] } }} conv @param {any[]} history
 */
export function seenWithin(conv, history) {
  const w = conv.within;
  delete conv.within;
  if (!w || conv.seenUserTurns == null) return 0;
  const n = turnsWithin(history, w.after, w.texts);
  conv.seenUserTurns += n;
  return n;
}

export function transcript(history) {
  return history
    .filter((m) => m.role !== "system")
    .map((m) => `### ${m.role === "assistant" ? "Assistant" : "User"}\n${m.text}`)
    .join("\n\n");
}

/**
 * The prompt text, the number of user turns the client has sent (`told` records them on the session as the prompt
 * goes out), whether the words are the agent's own command, and whether the steering instruction went with them — the
 * session has it once the prompt is taken. `context`: Filament's update said ahead of the prompt, and the recall after
 * the person's words. An agent's own command (`/compact`) goes as typed: what the session is owed — the update, the
 * recall, the steering, the turns it missed, its seed — waits for the next prompt, which leaves the command's exchange
 * out (the bug report's L20).
 * `who` heads the notes: the bridge's name. `composed`: a harness chat's fresh session is seeded from the request's own
 * history, the harness's composition of the chat, and this is the compaction it stands on — 0 before any (AC5-1,
 * AC-R1); null for an outside client's, seeded from the archive or the client's own history.
 * `commands`: the agent's commands the words are read against — the session's own, or the ones that stand in for them
 * while a session opened just now hasn't said its own (the bridge's `#commandsFor`).
 * `tried`: how many of the history's user turns are an earlier try of this message, which the chat keeps as one turn
 * with it (`earlierTriesOf`, HarnessV4_Tasks B8): the count leaves them out.
 * `seen`: what the harness says of the copy's start and the session's place in it (`recounted`).
 * `skipped` in the answer: turns another engine answered were left untold (`acp.catchUp` off), so the session holds
 * less than the chat from here on (`told`).
 * `whole`: a harness chat's history as its seed and its catch-up read it — the same messages as `history`, each call
 * with its whole input and each result whole (flatten.js `whole`, HarnessV4_Tasks A7), read only where one of them
 * needs it: what the harness composed whole reaches the agent whole. Null for an outside client's.
 * @param {{ acp: any, flat: any[], history: any[], last: { text?: string }, conv: any, reused: boolean,
 *   resumed: boolean, seeded: boolean, archSeed: any, notes: string[], who?: string, composed?: number | null,
 *   context?: { update: { text: string } | null, prompt: { text: string }[] } | null,
 *   commands?: readonly (string | { name?: string })[] | null, tried?: number, seen?: { head: number, seen: number } | null,
 *   whole?: (() => any[]) | null }} o
 */
export function composePrompt({ acp, flat, history, last, conv, reused, resumed, seeded, archSeed, notes, who = "acp", composed = null, context = null, commands = conv.commands, tried = 0, seen = null, whole = null }) {
  /** @type {any[] | null} */
  let read = null;
  const wholeHistory = () => (whole ? (read ??= whole()) : null);
  const sysText =
    acp.forwardSystemPrompt === true
      ? history
          .filter((m) => m.role === "system")
          .map((m) => m.text)
          .join("\n\n")
      : "";
  const words = last.text || "Continue.";
  const command = isAgentCommand(words, commands);
  // Turns the client had with another model or agent while this session sat idle (A -> B -> back to A): the
  // session only ever saw its own turns, so hand it the part it missed before the new message.
  const userTurns = flat.filter(isUserTurn).length - tried;
  // The copy took a new start under this session since it last counted: the harness's count is the one.
  if (recounted(conv, seen)) notes.push(`${who}: Filament's copy of the chat starts from a summary written since this session's last prompt, while the session went on: its place in the copy is the harness's count`);
  // What the person said while the agent's last turn ran is in that turn, and the session heard it there.
  const within = seenWithin(conv, history);
  if (within) notes.push(`${who}: ${within} message(s) sent while the agent's last turn ran are in that turn: the session heard them there, so they are not handed back`);
  // `acp.catchUp` (default on) decides whether the agent is told about the turns it missed while this chat was
  // talking to a different model. `conv.seenUserTurns` advances either way (`told`), so switching the knob off and
  // back on later does not dump the whole backlog at once — off means "deliberately not told", not "not yet counted".
  const behind = reused && !resumed && !seeded && conv.seenUserTurns != null && userTurns - 1 > conv.seenUserTurns;
  const missed = acp.catchUp !== false && behind ? missedTurns(wholeHistory() || history, conv.seenUserTurns, conv.heard) : [];
  const skipped = behind && acp.catchUp === false;
  const caughtUp = missed.filter(isUserTurn).length;
  // The agent's own command goes as typed, and what the session is owed waits for the next prompt (the bug report's
  // L20): wrapped in it, the command would reach the agent as words.
  if (command) {
    const name = words.trim().split(/\s/)[0];
    if (seeded) notes.push(`${who}: ${name} is the agent's own command, sent as typed: the session's seed waits for the next message`);
    else if (caughtUp)
      notes.push(`${who}: ${name} is the agent's own command, sent as typed: the ${caughtUp} turn(s) handled elsewhere since this session's last turn wait for the next message`);
    return { promptText: words, userTurns, command, steered: false, skipped, held: /** @type {string[]} */ ([]) };
  }
  // The seed leaves out what the session heard as typed (L20).
  const owed = unheard(history, conv.heard);
  const all = seeded && composed != null ? wholeHistory() : null;
  const seed = !seeded ? "" : composed != null ? transcript(all ? unheard(all, conv.heard) : owed) : archSeed ? archSeed.text : transcript(owed);
  const caught = missed.length ? transcript(missed) : "";
  // What the seed or the catch-up says already goes with the prompt once: there (`notHeldIn`).
  const kept = notHeldIn(context?.prompt || [], [seed, caught].filter(Boolean).join("\n\n"));
  for (const id of kept.held) notes.push(`${who}: what the ${id} block says came with the session's ${seed ? "seed" : "catch-up"} — not said again with its prompt`);
  let promptText = withPromptBlocks(words, kept.blocks);
  if (missed.length) {
    promptText = `Meanwhile, this conversation continued with another assistant (you did not see these turns; continue from them, do not repeat them):\n\n${caught}\n\n---\nLatest user message:\n\n${promptText}`;
    notes.push(
      `${who}: ${caughtUp} turn(s) handled elsewhere since this session's last turn were included so the agent catches up`,
    );
  }
  if (seeded && composed != null) {
    const prior = owed.filter((m) => m.role !== "system");
    promptText = `${sysText ? "Instructions from the client application:\n" + sysText + "\n\n" : ""}${composed ? COMPACTED_WORDS : EARLIER_WORDS}:\n\n${seed}\n\n---\nLatest user message:\n\n${promptText}`;
    const what = `the harness's composition, ${prior.length} message${prior.length === 1 ? "" : "s"}, ~${estimateTokens(seed)} tokens`;
    notes.push(composed ? `${who}: seeded from the chat as its compaction ${composed} left it: ${what}` : `${who}: seeded from the whole chat: ${what}`);
  } else if (seeded) {
    // P7: prefer the archive over the client's history, and SAY which one was used — "the agent knows the
    // conversation" means something different depending on the source, and the request record is the only place a
    // user can check. `archSeed` was computed at session creation, where it also decides whether there is anything
    // to seed at all, so it is not looked up twice.
    const arch = archSeed;
    promptText = `${sysText ? "Instructions from the client application:\n" + sysText + "\n\n" : ""}${EARLIER_WORDS}:\n\n${seed}\n\n---\nLatest user message:\n\n${promptText}`;
    // All three cases say which source was used. "Seeded from the client's history" is not one fact but two — the
    // knob is off, or there was nothing archived — and they have different remedies, so they get different words.
    if (arch) {
      notes.push(
        `${who}: seeded from Filament's archive (${arch.view} view) — ${arch.turns} turn(s), ~${arch.tokens} tokens${arch.dropped ? `, ${arch.dropped} older turn(s) dropped to fit the ${arch.budget}-token budget` : ""}${arch.excludedInFlight ? ", this turn excluded" : ""}; the client's own history was not used`,
      );
      // The archive can hold FEWER turns than the client just resent — the early part of a chat that ran with memory
      // off, or before this folder was un-excluded. Preferring the archive then silently shortens what the agent is
      // told it already knows, so say so rather than let the record imply the archive was complete.
      const bodyTurns = history.filter(isUserTurn).length;
      if (bodyTurns > arch.turns)
        notes.push(
          `${who}: the archive holds ${arch.turns} turn(s) but the client resent ${bodyTurns} — the earlier ones were never archived (memory was off, or this folder was excluded), so the seed is shorter than the client's own history`,
        );
    } else if (acp.seedFromArchive === false)
      notes.push(`${who}: seeded from the client's history (acp.seedFromArchive is off)`);
    else
      notes.push(
        `${who}: seeded from the client's history — this chat has no archived turns to seed from (memory off, or it has only ever talked to agents)`,
      );
  } else if (sysText && conv.seenUserTurns == null)
    promptText = `Instructions from the client application:\n${sysText}\n\n---\n${promptText}`;
  if (context?.update) promptText = ahead(context.update.text, promptText);
  // Steering (Rung 2, P6): once per agent session, at the very start of the first prompt, so it reads as a standing
  // instruction rather than as part of the user's message. Deliberately NOT repeated on later turns — an agent obeys
  // an instruction it was just given, so repeating it would make the leak rate measure compliance with a reminder
  // rather than with the session's setup, which is the number actually worth having. Said again once the agent
  // compacted its context, whose summary may have dropped it (`steerSaid` false, AC-R4): the setup restored.
  // Keyed on the SESSION's state, not the config: instructing an agent to prefer tools it was never given would be
  // worse than saying nothing — it would send it looking for tools that do not exist, and then record a leak rate
  // for a choice it never had. Said with the first prompt that is not the agent's own command: one that is leaves the
  // session unsteered (the bug report's L19).
  const steered = !!conv.steering && !conv.steerSaid;
  if (steered) {
    promptText = `${String(acp.steeringPrompt || "").trim() || DEFAULT_STEERING_PROMPT}\n\n---\n${promptText}`;
    notes.push(
      conv.steerSaid === false
        ? `${who}: steering instructions sent again: the agent compacted its context since, and its summary may have dropped them`
        : `${who}: steering instructions sent with this first turn (not repeated later, so the leak rate stays a real measurement)`,
    );
  }
  return { promptText, userTurns, command, steered, skipped, held: kept.held };
}

/**
 * What the session has of the chat once a prompt goes out (the bridge says so as it sends one; a turn stopped before
 * then told it nothing, the bug report's L21): the person's turns up to this one, its seed with them. The agent's own
 * command tells it none of what it is owed (L20) — its seed, or the turns it missed: the command's own turn is heard,
 * which the seed or the catch-up that comes later leaves out with what answered it. A session no prompt of the
 * person's has reached is owed what came before it, as far as the bridge knows: an outside client's seed comes from
 * the archive, whatever the request holds. `skipped`: turns another engine answered were left untold, for good: the
 * session holds less than the chat (`partial`; `owes`, ../compactions.js).
 * @param {{ seenUserTurns?: number | null, heard?: number[], fresh?: boolean, partial?: boolean }} conv
 * @param {{ userTurns: number, command: boolean, skipped?: boolean }} prompt
 */
export function told(conv, { userTurns, command, skipped = false }) {
  if (skipped) conv.partial = true;
  if (command && (conv.seenUserTurns == null || userTurns - 1 > conv.seenUserTurns)) {
    conv.heard = [...(conv.heard || []), userTurns];
    return;
  }
  conv.seenUserTurns = userTurns;
  delete conv.heard;
  delete conv.fresh;
}

/**
 * A steer's send (HarnessV3-ACP AC3-1) that counts what the agent takes: words that went into its running turn — the
 * turn whose prompt was the history's `at`-th user turn — are the session's (`tookWithin`), as the archive keeps them
 * (`words`: the person's own, where the agent hears them wrapped, a sub-agent's), and the next prompt counts the user
 * turns the history holds of them as seen (`seenWithin`): two taken at one step are one turn there, and a turn folded
 * into its answer holds none. Words handed back go as the next message, told then. `by`: whose they are, which a turn
 * cancelled at its next step says (next-step.js).
 * @template {boolean | "after"} T  how the agent took them: `"after"`, after its turn's answer (HarnessV3-FailurePoints
 *   §7.2)
 * @param {{ seenUserTurns?: number | null, within?: { after: number, texts: string[] } }} conv @param {number} at
 * @param {(text: string, images?: SteerImage[], by?: "person" | "filament") => Promise<T>} send
 * @returns {(text: string, words?: string, images?: SteerImage[], by?: "person" | "filament") => Promise<T>}
 */
export const countTaken = (conv, at, send) => async (text, words = text, images = [], by = undefined) => {
  const took = await send(text, images, by);
  if (took) tookWithin(conv, at, words, images.length > 0);
  return took;
};

/** @typedef {import("../../../core/media.js").SteerImage} SteerImage  a picture the person's words carry */

/**
 * The person's words and the pictures they carry as one prompt's blocks, as ACP takes them (HarnessV4_Tasks C22):
 * the words first, then each picture.
 * @param {string} text @param {SteerImage[]} [images]
 */
export const steerPrompt = (text, images = []) => [...(text ? [{ type: "text", text }] : []), ...images.map((p) => ({ type: "image", data: p.data, mimeType: p.mediaType }))];

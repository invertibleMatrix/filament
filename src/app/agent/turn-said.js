// @ts-check
// What a turn's start says on the model's copy of the person's message (the owner's of 11-06: "am i sensing a smoking
// gun"): the shells that ended, ahead of it; a hook's or a change's note, the files it read that changed since, what
// is still open, the envelopes still sealed and where it stands on its task graph, after it. The archive keeps the
// message as the person sent it, so each later turn puts those words back on it — the bytes the provider cached for
// the turn are the bytes every later turn sends, and the cache holds from one turn to the next. Each message is found
// as its own turn's (`turnsOf`), never by its words alone: a person's "go on" said twice is two turns, and a rewind or
// a summary that takes the first away leaves the second its own. Pure: the turn keeps and reads them (agent/turn.js),
// the loop says what it added (agent/loop.js).
import { pinHashOf } from "../../core/fold.js";
import { stripMessageMemoryBlocks } from "../../services/memory/brain.js";

/**
 * What a turn's start said on its message: `head` ahead of it, `tail` after it, each a text block, in the order said.
 * @typedef {{ head: string[], tail: string[] }} Said
 */
/**
 * A turn of the chain as a request's messages are matched to it: its number, and its message's words as the archive
 * pins them (`meta.key`, core/fold.js `pinHashOf`).
 * @typedef {{ n: number, key: string }} TurnPin
 */

/** A person's message: the user's, not the results of the model's calls alone. @param {any} m */
const isPerson = (m) => m?.role === "user" && (typeof m.content === "string" || (Array.isArray(m.content) && m.content.some((/** @type {any} */ b) => b?.type !== "tool_result")));

/**
 * Which turn each of a request's person messages is, read from the newest back: a message is the newest of the turns
 * before the one matched last whose message has its words. The newest message is the request's own turn's, none of
 * these; one no turn has — a summary's lead, a message a fold reshaped — is none's. A turn whose message the history no
 * longer holds (a summary took it, a command answered it) is passed over. A message is matched without memory's blocks,
 * which memory puts back on it before these lines are: its turn was pinned by the message as the person sent it.
 * @param {any[]} messages @param {readonly TurnPin[]} turns  the chain's turns standing before this one, oldest first
 * @returns {Map<number, number>} a message's index → its turn's number
 */
export function turnsOf(messages, turns) {
  /** @type {Map<number, number>} */
  const out = new Map();
  const persons = (Array.isArray(messages) ? messages : []).flatMap((m, i) => (isPerson(m) ? [i] : []));
  let left = turns.length - 1;
  for (let j = persons.length - 2; j >= 0 && left >= 0; j--) {
    const pin = pinHashOf(stripMessageMemoryBlocks(messages[persons[j]]));
    let k = left;
    while (k >= 0 && turns[k].key !== pin) k--;
    if (k < 0) continue;
    out.set(persons[j], turns[k].n);
    left = k - 1;
  }
  return out;
}

/**
 * The message with what its turn's start said on it, as the turn said it: `head` ahead, `tail` after.
 * @param {any} m @param {Said} said
 */
export function withSaid(m, said) {
  const head = (said?.head || []).map((text) => ({ type: "text", text }));
  const tail = (said?.tail || []).map((text) => ({ type: "text", text }));
  if (!head.length && !tail.length) return m;
  const blocks = Array.isArray(m?.content) ? m.content : [{ type: "text", text: String(m?.content ?? "") }];
  return { ...m, content: [...head, ...blocks, ...tail] };
}

/**
 * The request's messages with each person's message carrying again what its own turn's start said on it. The rest
 * stays as it is.
 * @param {any[]} messages @param {ReadonlyMap<number, Said>} said  by turn number @param {readonly TurnPin[]} turns
 * @returns {{ messages: any[], put: number }}
 */
export function putSaidBack(messages, said, turns) {
  if (!Array.isArray(messages) || !said?.size) return { messages, put: 0 };
  let put = 0;
  const out = messages.slice();
  for (const [i, n] of turnsOf(messages, turns)) {
    const s = said.get(n);
    if (!s) continue;
    out[i] = withSaid(messages[i], s);
    put++;
  }
  return { messages: put ? out : messages, put };
}

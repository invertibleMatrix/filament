// @ts-check
// Chats named by memory's model (Settings › Experimental, `experimental.nameChats`; the owner's of 11-05): as a chat's
// first message is sent (the owner's of 11-06: no longer once its turn has ended), memory's model for the chat
// (`modelFor`: the one set in Settings › Memory, else the chat's compaction model, else its own) reads about 1K tokens
// of it and names the chat in a few words, as Claude's desktop app does, while the agent works. A try that failed is
// made again at the turn's end, the answer read too. Only a chat Filament named from its first message is renamed (the
// archive's `autoNamed`), and once: a name of the person's, given as it was made or since, takes the mark off
// (memory's `display.title` mirror), and so does this name. A chat made while the switch was off is named at its next
// message once it is on. Memory's learning on or off is not asked — the switch is the person's own —, but a chat kept
// from memory is never read: Memory settings leave it out (`keptToItself`), or it or its project keeps its turns from
// learning (`keptPrivate`). Memory's model is asked twice at most (`NAME_TRIES`); a chat with no message to read among
// its first turns keeps its name. The name rides the `turns` topic (`named`), where the sidebar and the chat's header
// write it in.
import { ownTextOf } from "../services/memory/archive.js";
import { textOfMessage } from "../core/messages.js";

/** About 1K tokens of the chat, at four characters a token: its first message, and the answer where there is one, share them. */
export const NAME_CHARS = 4000;
/** The longest name kept, cut at a word. */
export const NAME_MAX = 60;
/** How many times memory's model is asked to name a chat: past them — it failed, or its answer named nothing — the chat keeps its name. */
export const NAME_TRIES = 2;
/** The turns a name is read from: past them with no exchange to read, the chat keeps its name. */
export const FIRST_TURNS = 5;
/** What memory's model is asked: the name alone. */
export const NAME_PROMPT =
  "You name chats. Reply with the chat's name alone: 2 to 6 words, in the language the person wrote in, sentence case, saying what the chat is about. No quotes, no full stop, no words like \"Chat about\".";

/**
 * What memory's model reads: the first message, then the answer where there is one yet, within `NAME_CHARS` — the
 * message takes up to two thirds, the answer the rest, and either takes what the other leaves.
 * @param {string} asked @param {string} [answer]  none as the message is sent
 */
export function nameInput(asked, answer = "") {
  const a = String(asked || "").trim();
  const b = String(answer || "").trim();
  const room = NAME_CHARS;
  const aRoom = Math.max(Math.floor((room * 2) / 3), room - b.length);
  const aCut = a.slice(0, aRoom);
  const said = `The person's first message:\n${aCut}${aCut.length < a.length ? " …" : ""}`;
  if (!b) return said;
  const bCut = b.slice(0, room - aCut.length);
  return `${said}\n\nThe answer:\n${bCut}${bCut.length < b.length ? " …" : ""}`;
}

/**
 * Memory's model's answer as a name: its first line with words in it once its thinking, a heading's marks, bold and
 * code marks, a label ("Title:") and quotes are off — an underscore inside a word stays (`parse_args`) — without a full
 * stop, cut to `NAME_MAX` at a word; null where nothing is left.
 * @param {unknown} raw @returns {string | null}
 */
export function cleanName(raw) {
  const text = String(raw || "").replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, "");
  for (const line of text.split(/\r?\n/)) {
    let s = line
      .trim()
      .replace(/^#+\s*/, "")
      .replace(/[*`]+/g, "")
      .replace(/^(__?)(.+)\1$/, "$2")
      .trim()
      .replace(/^(?:title|name|chat name)\s*[:：]\s*/i, "")
      .replace(/^["'“”‘’«»「」]+|["'“”‘’«»「」]+$/g, "")
      .replace(/[.。!！?？:;,\s]+$/u, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!/[\p{L}\p{N}]/u.test(s)) continue;
    if (s.length > NAME_MAX) {
      const cut = s.slice(0, NAME_MAX + 1);
      const at = cut.lastIndexOf(" ");
      s = (at > NAME_MAX / 2 ? cut.slice(0, at) : s.slice(0, NAME_MAX)).trim();
    }
    return s;
  }
  return null;
}

/**
 * The exchange a name is read from: among a chat's first turns, the first the person wrote words in — never one
 * Filament answered itself (a command), one the agent began by itself, one rewound away or one kept apart from memory
 * —, with its answer where it has one (none while its turn runs); null where none is yet.
 * @param {any} a  the archive @param {string} chainId @returns {{ asked: string, answer: string } | null}
 */
export function firstExchange(a, chainId) {
  for (const t of a.getTurns(chainId, { to: FIRST_TURNS })) {
    const m = t.meta || {};
    if (!t.user_hash || m.command || m.own || m.rewound || m.apart) continue;
    const user = a.getMessage(t.user_hash)?.message;
    const asked = user ? ownTextOf(user) : "";
    if (!String(asked || "").trim()) continue;
    const reply = t.final_hash ? a.getMessage(t.final_hash)?.message : null;
    return { asked, answer: reply ? textOfMessage(reply) : "" };
  }
  return null;
}

/**
 * Whether a chat's own settings, or its project's, keep it from learning (`privacy.learn` off there): a private chat or
 * repository. All chats' value is memory's learning switch (`memory.capture.learn`), which the person's switch here
 * stands beside. @param {any} doc  the chat's settings document (`memory.docFor`)
 */
export const keptPrivate = (doc) => doc?.flat?.["privacy.learn"] === false && (doc.sources?.["privacy.learn"] === "session" || doc.sources?.["privacy.learn"] === "project");

/**
 * @param {{ config: () => any, memory: () => any, publish: (msg: any) => void, log?: (level: string, msg: string) => void }} o
 *   `memory`: the memory service — its archive, its model for a chat (`modelFor`), its calls and what it keeps from
 *   other chats
 */
export function createChatNamer(o) {
  const log = o.log || (() => {});
  /** The chats being named now: one call a chat. @type {Set<string>} */
  const naming = new Set();
  const on = () => o.config()?.experimental?.nameChats === true;

  /** @param {string} chainId */
  async function name(chainId) {
    if (!on() || naming.has(chainId)) return;
    naming.add(chainId);
    try {
      const memory = o.memory();
      const a = memory?.archive;
      if (!a || !memory.modelFor?.({ chainId })?.model) return;
      const mark = a.metaOf(chainId, ["autoNamed", "nameTries"]);
      if (mark?.autoNamed !== true) return;
      /** The mark taken off: the chat keeps the name it has. */
      const keep = () => a.mergeMeta(chainId, { autoNamed: undefined, nameTries: undefined });
      // Kept from memory: nothing of it goes to another model, memory's provider maybe another than its own.
      if (memory.keptToItself?.(chainId) || keptPrivate(memory.docFor?.(chainId))) return void keep();
      const first = firstExchange(a, chainId);
      if (!first) {
        if (a.newestTurnN(chainId, { ended: true }) >= FIRST_TURNS) keep();
        return;
      }
      /** @type {string | null} */
      let title = null;
      let why = "its answer named nothing";
      try {
        title = cleanName(await memory.callModel({ system: NAME_PROMPT, user: nameInput(first.asked, first.answer), purpose: "title", chainId }));
      } catch (/** @type {any} */ e) {
        why = String(e?.message || e);
      }
      // Renamed meanwhile, named already, or the switch turned off while it wrote: the chat's name stands.
      if (!on() || a.metaOf(chainId, ["autoNamed"])?.autoNamed !== true) return;
      if (!title) {
        const tries = (Number(mark.nameTries) || 0) + 1;
        if (tries >= NAME_TRIES) keep();
        else a.mergeMeta(chainId, { nameTries: tries });
        log("warn", `chat names: ${chainId} was not named by memory's model (${why})${tries >= NAME_TRIES ? `: it keeps its name after ${tries} tries` : ""}`);
        return;
      }
      a.setTitle(chainId, title);
      keep();
      o.publish({ type: "named", chainId, title });
    } catch (/** @type {any} */ e) {
      log("warn", `chat names: ${chainId} could not be named (${e?.message || e})`);
    } finally {
      naming.delete(chainId);
    }
  }

  return {
    /**
     * A turn's message goes to its model or agent (memory's `onMessageSent`), past every refusal of Filament's own — a
     * hook's block, a command it answers: named from it at once, while the agent works. @param {{ chainId: string }} t
     */
    messageSent: (t) => void setImmediate(() => void name(String(t.chainId))),
    /**
     * A turn's reply was archived (memory's `onTurnFinished`): a try at its start that failed is made again, the answer
     * read too — once the turn's own writes are done: a refusal is marked Filament's answer after its reply is archived.
     * @param {{ chainId: string }} t
     */
    turnFinished: (t) => void setImmediate(() => void name(String(t.chainId))),
    name,
  };
}

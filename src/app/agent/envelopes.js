// @ts-check
// Envelopes (HarnessV4_Envelopes_Plan): another agent's result that lands while an agent works reaches it sealed — one
// line in its sender's words — and waits until the agent opens it, oldest first. The registry (subagents.js) keeps the
// sealed ones with the session; the loop (loop.js) seals while it works, opens while it waits, and says the list again
// where the agent's memory of the lines may be gone. These are their words, in one place both read.

import { CHAT_LINK } from "../../services/agent-cards.js";
import { clip } from "../../core/text.js";

/** @typedef {import("./subagents.js").Envelope} Envelope */
/** @typedef {import("./subagents.js").Taken} Taken */

/** The longest subject an envelope's line carries. */
export const SUBJECT_CHARS = 200;
/** A line that reads `Subject: …`, bold or not: its words. */
const SUBJECT_LINE = /^(?:[*_#>\s]*)subject(?:[*_]*)\s*:\s*(?:[*_]+\s*)?(.+?)(?:\s*[*_]+)?$/i;
/**
 * A report's subject line, its sender's own (EN-D3): its first line that is not empty, where it reads `Subject: …` —
 * bold or not — else the last line that does. A team's result is its lead's whole turn, whose earlier steps' words
 * come before the final message that starts with its subject (EN-D22, the drive of 10-24); the first one wins over a
 * quote further down. Cut to `SUBJECT_CHARS`; "" where it has none.
 * @param {string} report
 */
export function subjectOf(report) {
  const lines = String(report || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const first = SUBJECT_LINE.exec(lines[0] || "");
  const m = first || lines.slice(1).reverse().map((l) => SUBJECT_LINE.exec(l)).find(Boolean) || null;
  const s = m ? m[1].trim() : "";
  return s.length > SUBJECT_CHARS ? `${s.slice(0, SUBJECT_CHARS - 1)}…` : s;
}
/**
 * Whether the envelope tool's call writes a letter to another chat, or answers one (app/letters.js), rather than opening
 * what is sealed. @param {any} input
 */
export const writesLetter = (input) => (input?.to != null && String(input.to).trim() !== "") || (input?.answer != null && String(input.answer).trim() !== "");
/**
 * Whether the envelope tool's call dismisses lines of what is still open (agent/still-open.js, the owner's of 11-09): a
 * call of its own, taken before anything else it asks. @param {any} input
 */
export const dismisses = (input) => Array.isArray(input?.dismiss) && input.dismiss.some((/** @type {unknown} */ x) => String(x ?? "").trim() !== "");
/** Whether the call asks more than its dismiss: a letter, an answer, a picture, or envelopes opened. @param {any} input */
export const otherThanDismiss = (input) => writesLetter(input) || (typeof input?.picture === "string" && input.picture.trim() !== "") || input?.all === true || Number(input?.count) > 0;
/**
 * The envelope tool's answer to a dismiss: what was dismissed, and the ids of nothing open now. A sub-agent's change it
 * dismissed still waits in the person's Changes (`waits`; the owner's of 11-10: the card said nothing waits while 35
 * files did): said, with how it stops waiting there too. `more`: the call asked more besides, which a call of its own does.
 * @param {{ dismissed: readonly string[], unknown: readonly string[], waits?: readonly string[] }} r @param {boolean} [more]
 */
export function dismissAnswer(r, more = false) {
  const done = r.dismissed.length
    ? `Dismissed ${r.dismissed.join(", ")}: Filament leaves ${r.dismissed.length === 1 ? "it" : "them"} out of what is still open until what ${r.dismissed.length === 1 ? "it names changes" : "they name changes"}.`
    : "Nothing was dismissed.";
  const w = r.waits || [];
  const waits = w.length
    ? ` The change of ${w.length === 1 ? `sub-agent ${w[0]}` : `sub-agents ${w.join(", ")}`} still waits in the person's Changes: where it came into your folder another way, mark it applied (agent with its agent_id and mark_applied: true), so it waits there no more either.`
    : "";
  const none = r.unknown.length ? ` Nothing open now goes by ${r.unknown.join(", ")}: give the ids in brackets that end the lines of what is still open.` : "";
  return `${done}${waits}${none}${more ? " The rest of the call was not run: dismiss goes in a call of its own." : ""}`;
}
/** The chat a letter names: its id, `chat:<id>`, or its tag `[title](chat:<id>)`; "" for none. @param {unknown} v */
export const chatNamed = (v) => {
  const s = String(v ?? "").trim();
  const tag = new RegExp(CHAT_LINK.source).exec(s);
  const id = tag ? tag[2] : s.replace(/^chat:/, "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
};
/**
 * The envelope tool's call in a line, as its row reads it (ui conversation/tools/render.js `argsOf`), the loop's and a
 * coding agent's alike: the lines of what is still open it dismisses, which go first (`dismisses`); a letter — to the
 * chat by its id, however it was named, and its subject — or an answer to one, as the loop takes them next
 * (`writesLetter`); else a picture by its name (HarnessV4_DesignPass_Plan UX1), else how many sealed ones it opens (EN6):
 * every one, a number of them, or the oldest ("").
 * @param {any} inp
 */
export function envelopeSummary(inp) {
  if (dismisses(inp)) return clip(`dismiss ${inp.dismiss.map(String).join(", ")}`, 160);
  if (inp?.answer != null && String(inp.answer).trim()) return clip(`answer ${String(inp.answer).trim()}`, 120);
  if (inp?.to != null && String(inp.to).trim()) return clip(`letter to ${chatNamed(inp.to) || String(inp.to).trim()}${typeof inp.subject === "string" && inp.subject.trim() ? `: ${inp.subject.trim()}` : ""}`, 160);
  if (typeof inp?.picture === "string" && inp.picture.trim()) return `picture ${inp.picture.trim()}`;
  return inp?.all === true ? "all" : Number(inp?.count) > 1 ? String(Math.floor(Number(inp.count))) : "";
}
/** A sentence's end, where the words lack one. @param {string} s */
const ended = (s) => (/[.!?…]$/.test(s) ? s : `${s}.`);
/** "one envelope is" or "3 envelopes are". @param {number} n */
const are = (n) => (n === 1 ? "one envelope is" : `${n} envelopes are`);
/** What a sealed one's line says after its subject: how it opens (`envelopeLine`), and where `openedLetters` ends a subject. */
const SEALED_HOW = " Finish what you are doing first, then open it with Filament's envelope tool when you reach a stopping point.";
/**
 * The line a sealed result reaches the loop in (§1): its number, its sender and its subject, how it opens, and how many
 * are sealed now.
 * @param {Envelope} e @param {number} sealedNow
 */
export const envelopeLine = (e, sealedNow) =>
  `[Filament: envelope ${e.n}, sealed — from ${e.sender}: ${ended(e.subject)}${SEALED_HOW} Envelopes open oldest first; ${sealedNow === 1 ? "this is the one sealed now" : `${sealedNow} are sealed now`}.]`;
/**
 * The session's sealed envelopes in a line each, oldest first: said again where the agent's own memory of the lines may
 * be gone — a turn's start, after a compaction (EN-D6). "" for none.
 * @param {readonly Envelope[]} list
 */
export const sealedListText = (list) =>
  list.length
    ? `[Filament: ${are(list.length)} still sealed, oldest first:\n${list.map((e) => `- envelope ${e.n}, from ${e.sender}: ${ended(e.subject)}`).join("\n")}\nOpen ${list.length === 1 ? "it" : "them"} with Filament's envelope tool when you reach a stopping point.]`
    : "";
/**
 * The turn's end with envelopes still sealed (EN-D5, case 11): said once a turn, and the agent may end all the same.
 * "" for none.
 * @param {readonly Envelope[]} list
 */
export const sealedReminder = (list) =>
  list.length
    ? `[Filament: ${are(list.length)} still sealed (${list.map((e) => `envelope ${e.n}, from ${e.sender}: ${e.subject}`).join("; ")}): open ${list.length === 1 ? "it" : "them"} now with Filament's envelope tool, or end your turn and ${list.length === 1 ? "it waits" : "they wait"} for your next one.]`
    : "";
/**
 * A sealed result as it reaches the agent opened — by its envelope tool, or in a wait: its number and sender ahead of
 * the report whole, so the agent knows which line it answers.
 * @param {Taken} t
 */
export const openedText = (t) => `[Filament: envelope ${Number(t.envelope) || "?"}, opened — from ${t.sender || `sub-agent ${t.from} ("${t.description}")`}]\n${t.text}`;

/** An opened one's first line (`openedText`): its number and its sender. */
const OPENED_HEAD = /^\[Filament: envelope (\d+|\?), opened — from (.*)\]$/gm;
/** A sealed one's line (`envelopeLine`): its number, and its sender and subject up to how it opens. */
const SEALED_AT = new RegExp(`\\[Filament: envelope (\\d+), sealed — from ([^\\n]*?)(?=${SEALED_HOW.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "g");
/** A sealed one in the list said again (`sealedListText`): its number, and its sender and subject. */
const LISTED_AT = /^- envelope (\d+), from (.*)$/gm;
/** A letter's own line, at its end (app/letters.js): its id. */
const LETTER_ID = /\[Filament: letter (lt_[0-9a-f]+)[,.]/g;
/** The words of a message: its text, its text blocks, and the results' words in it. @param {any} m @returns {string[]} */
const wordsIn = (m) => {
  const c = m?.content;
  if (typeof c === "string") return [c];
  if (!Array.isArray(c)) return [];
  return c.flatMap((/** @type {any} */ b) =>
    b?.type === "text" ? [String(b.text ?? "")] : b?.type === "tool_result" ? (typeof b.content === "string" ? [b.content] : Array.isArray(b.content) ? b.content.filter((/** @type {any} */ x) => x?.type === "text").map((/** @type {any} */ x) => String(x.text ?? "")) : []) : [],
  );
};
/**
 * The letters another agent wrote that a run of messages opened (`openedText` of one whose words end with its letter's
 * line), in the order they were opened, each once: its id, who wrote it, and its subject where the line it was sealed
 * in is among the messages (`envelopeLine`, `sealedListText`; "" where none is). What a summary of those turns may lose
 * (the owner's of 11-09): the block after it names them (sessions/reattach.js).
 * @param {readonly any[]} messages @returns {{ id: string, from: string, subject: string }[]}
 */
export function openedLetters(messages) {
  const texts = messages.flatMap(wordsIn);
  /** Each sealed one's "sender: subject", by its number. @type {Map<string, string>} */
  const sealed = new Map();
  for (const t of texts) for (const re of [SEALED_AT, LISTED_AT]) for (const m of t.matchAll(re)) sealed.set(m[1], m[2]);
  /** @type {{ id: string, from: string, subject: string }[]} */
  const out = [];
  for (const t of texts) {
    const heads = [...t.matchAll(OPENED_HEAD)];
    heads.forEach((h, i) => {
      const body = t.slice(Number(h.index) + h[0].length, i + 1 < heads.length ? heads[i + 1].index : t.length);
      const id = [...body.matchAll(LETTER_ID)].at(-1)?.[1];
      if (!id || out.some((l) => l.id === id)) return;
      const from = h[2];
      const said = sealed.get(h[1]) || "";
      const subject = said.startsWith(`${from}: `) ? said.slice(from.length + 2).replace(/\.$/, "") : "";
      out.push({ id, from, subject });
    });
  }
  return out;
}
/** A picture's size in an answer's words. @param {number} bytes */
const sizeOf = (bytes) => (bytes < 1024 ? `${bytes} bytes` : `${Math.round(bytes / 1024).toLocaleString("en-US")} KB`);
/** When a picture was drawn, to the minute, in UTC. @param {number} ms */
const stamp = (ms) => `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`;
/** A picture in a line: its name, its id, who drew it and for what. @param {import("./subagents.js").PictureOf} x */
const pictureLine = (x) => `${x.title} (${x.id}), drawn by ${x.by}${x.task ? ` for "${x.task}"` : ""}`;
/**
 * The envelope tool's answer for a picture (HarnessV4_DesignPass_Plan UX1, cases 2 to 5 and 12): the one asked for,
 * its code whole, with who drew it, for what and when, and the older ones of its name by their ids; one whose code is
 * no longer kept, said so; with none of that name, the chat's pictures, newest first. `also`: the call asked for
 * sealed envelopes too, which stay sealed.
 * @param {string} key @param {import("./subagents.js").Picture | null} p @param {boolean} [also]
 */
export function pictureAnswer(key, p, also = false) {
  const stays = also ? "\n\n[Filament: the sealed envelopes stay sealed: open them with a call of their own.]" : "";
  if (p?.found) {
    const f = p.found;
    const older = p.older.length ? `\n\n[Filament: ${p.older.length === 1 ? "an older picture has" : `${p.older.length} older pictures have`} the same name: ${p.older.map((x) => `${x.id}, drawn by ${x.by}`).join("; ")} — open one by its id.]` : "";
    return `[Filament: picture ${f.title}, opened — drawn by ${f.by}${f.task ? ` for "${f.task}"` : ""}, ${stamp(f.at)}, ${sizeOf(f.bytes)}. Its code, whole:]\n${f.code}${older}${stays}`;
  }
  if (p?.gone) return `The picture ${pictureLine(p.gone)} is listed, but its code is no longer kept: the developer saw it; describe what you need from its agent's report instead.${stays}`;
  const names = p?.names || [];
  if (!names.length) return `No picture named "${key}": no agent of this chat drew one.${stays}`;
  const more = names.length > 20 ? `\n- and ${names.length - 20} older` : "";
  return `No picture named "${key}". The pictures this chat's agents drew, newest first:\n${names.slice(0, 20).map((x) => `- ${pictureLine(x)}`).join("\n")}${more}\nOpen one by its name or its id.${stays}`;
}

/**
 * The envelope tool's answer (case 9, 10): the opened ones whole, oldest first, and how many are still sealed.
 * @param {readonly Taken[]} opened @param {number} left
 */
export function envelopeAnswer(opened, left) {
  if (!opened.length) return "No envelope is sealed.";
  const rest = left ? ` ${are(left)} still sealed: call envelope again to open the next.` : " None is sealed now.";
  return `${opened.map(openedText).join("\n\n")}\n\n[Filament: ${opened.length === 1 ? "one envelope" : `${opened.length} envelopes`} opened.${rest}]`;
}

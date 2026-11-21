// @ts-check
// What comes back after a summary (HarnessV3-AtHome AH-D9 b). The summary stands for the turns, but the files they
// worked on are the work itself, and a model reaches for them again first thing after a compaction. So the newest
// files the summarized work read, wrote or edited come back as they are on disk at compaction time, with the live
// plan and the task graph while it has open tasks (HarnessV3-TaskGraph), in one block after the summary. Each file comes back whole or is only named, never cut: a file too big, outside
// the session's folder, one the rules in force would not let the agent read without asking, or one past the block's
// room is named, with a line saying it can be read again. The block is written once, with the compaction, so every
// request after it sends the same bytes and the provider's cache holds.
// A summary that takes the place of an earlier one reads the turns since that one, and what that one's block brought
// back (`blockFiles`, `blockPlan`) — never the whole session's work again (HarnessV4_Tasks C29).
import { readFileSync, statSync } from "node:fs";
import { normalize } from "node:path";
import { canonicalOf } from "../../core/tool-vocab.js";
import { estimateTokens, tailWithinTokens } from "../../core/tokens.js";
import { imageTypeOf, sizeWords } from "../../core/media.js";
import { lineNumber, resolveInside } from "../../adapters/tools/hands.js";
import { asksFirst, ruleFor, rulesFrom } from "../agent/rules.js";
import { redactorOf } from "../../core/redact.js";
import { openGraphText } from "../../core/task-graph.js";
import { withoutNote } from "./shapes.js";
import { graphCrew } from "../../services/session-settings.js";
import { goThrough } from "../agent/still-open.js";
import { openedLetters } from "../agent/envelopes.js";

/** The most files that come back, shown or named. */
export const REATTACH_FILES = 5;
/** The most one file brought back may weigh; a bigger one is named instead. */
export const REATTACH_FILE_TOKENS = 5_000;
/** The block's room: a tenth of the model's window, never more than five whole files' worth. @param {number | null | undefined} window */
export const reattachBudget = (window) => Math.min(REATTACH_FILES * REATTACH_FILE_TOKENS, Math.floor((Number(window) || 0) / 10));

/** The most of the last reply that comes back after a summary, in tokens as `estimateTokens` counts them: its end, where cut. */
export const REATTACH_REPLY_TOKENS = 1_500;
/** The kinds of pause a turn ends on (loop.js `PausedTurn`): its closing line is the question the next message answers. */
const PAUSE_KINDS = new Set(["ask", "permission"]);
/** The most skills a summary's block names as loaded in the turns it stands for, the newest first. */
export const REATTACH_SKILLS = 5;

/** A message's words: its text blocks, or its string. @param {any} m */
const wordsOf = (m) =>
  (typeof m?.content === "string" ? m.content : Array.isArray(m?.content) ? m.content.filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => String(b.text ?? "")).join("\n\n") : "").trim();

/**
 * The skills a run of messages loaded with Filament's skill tool — the loop's, or a coding agent's through Filament's
 * MCP server — by the name each call gave, a call whose result came back an error loading none. A plugin's index is a
 * load as well; a look in a skill's folder (list, read, find) is not.
 * @param {readonly any[]} messages @returns {string[]}
 */
export function loadedSkills(messages) {
  const failed = new Set();
  for (const m of messages) for (const b of Array.isArray(m?.content) ? m.content : []) if (b?.type === "tool_result" && b.is_error) failed.add(b.tool_use_id);
  /** @type {string[]} */
  const out = [];
  for (const m of messages)
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (b?.type !== "tool_use" || failed.has(b.id)) continue;
      const name = skillLoadOf(b.name, b.input);
      if (name) out.push(name);
    }
  return out;
}

/**
 * The skill a call of Filament's skill tool loads, by the name it gave — "" for any other call, and for a look in a
 * skill's folder (list, read, find). @param {unknown} tool  the call's tool, by Filament's name or its MCP name @param {any} input
 */
export const skillLoadOf = (tool, input) => {
  if (String(tool || "").replace(/^mcp__filament__/, "") !== "skill") return "";
  const name = String(input?.name ?? "").trim().replace(/^\//, "");
  const action = String(input?.action ?? "").trim().toLowerCase() || "load";
  return name && action === "load" ? name : "";
};

/**
 * Skills by name and the turn each was loaded in, where that is known, the newest first, each once (its newest load),
 * at most REATTACH_SKILLS. @template {{ name: string, turn?: number }} K @param {readonly K[]} list  oldest first
 * @returns {K[]}
 */
export const newestSkills = (list) => {
  /** @type {Map<string, K>} */
  const by = new Map();
  for (const k of list) {
    by.delete(k.name.toLowerCase());
    by.set(k.name.toLowerCase(), k);
  }
  return [...by.values()].reverse().sort((a, b) => (Number(b.turn) || 0) - (Number(a.turn) || 0)).slice(0, REATTACH_SKILLS);
};

/** The kinds of call that name a file the work used. */
const FILE_KINDS = new Set(["read", "write", "edit"]);
/**
 * A call read in any tool vocabulary (`canonicalOf`), a coding agent's call of one of Filament's own tools over its MCP
 * server by that tool's own name: `mcp__filament__checklist` is the checklist, as the loop's plan, and
 * `mcp__filament__Read` a read (the owner's of 11-08: a coding agent's checklist never reached the block after a
 * summary nor a switch's handover).
 * @param {any} b  a tool_use block
 */
const callOf = (b) => canonicalOf(String(b?.name ?? "").replace(/^mcp__filament__/, ""), b?.input);
/** How one path is known whatever way a call spelled it. @param {string} p */
const keyOf = (p) => {
  const n = normalize(p);
  return process.platform === "win32" ? n.toLowerCase() : n;
};

/**
 * The letters a run of messages answered with Filament's envelope tool (`answer`, the loop's or a coding agent's through
 * Filament's MCP server), by their ids. @param {readonly any[]} messages @returns {Set<string>}
 */
const answeredIn = (messages) => {
  const out = new Set();
  for (const m of messages)
    for (const b of Array.isArray(m?.content) ? m.content : [])
      if (b?.type === "tool_use" && String(b.name || "").replace(/^mcp__filament__/, "") === "envelope" && b.input?.answer != null) out.add(String(b.input.answer).trim());
  return out;
};

/**
 * The files a run of messages read, wrote or edited, newest first, each once, in any tool vocabulary (`canonicalOf`).
 * A path keeps the spelling of its newest call.
 * @param {readonly any[]} messages
 * @returns {string[]}
 */
export function touchedFiles(messages) {
  /** @type {string[]} */
  const out = [];
  const seen = new Set();
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = Array.isArray(messages[i]?.content) ? messages[i].content : [];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j];
      if (b?.type !== "tool_use") continue;
      const c = callOf(b);
      const path = c && FILE_KINDS.has(c.kind) ? String(c.fields.path ?? "").trim() : "";
      if (!path || seen.has(keyOf(path))) continue;
      seen.add(keyOf(path));
      out.push(path);
    }
  }
  return out;
}

/**
 * The files one reply's calls read, wrote or edited, in its order, each with what was done (`canonicalOf`): a call
 * whose result came back an error did none of it.
 * @param {any} reply @param {readonly any[]} [results]  the round's results, its tool_result blocks among them
 * @returns {{ path: string, how: "read" | "write" | "edit" }[]}
 */
export function filesWorked(reply, results = []) {
  const failed = new Set(results.filter((r) => r?.type === "tool_result" && r.is_error).map((r) => r.tool_use_id));
  /** @type {{ path: string, how: "read" | "write" | "edit" }[]} */
  const out = [];
  for (const b of Array.isArray(reply?.content) ? reply.content : []) {
    if (b?.type !== "tool_use" || failed.has(b.id)) continue;
    const c = callOf(b);
    const path = c && FILE_KINDS.has(c.kind) ? String(c.fields.path ?? "").trim() : "";
    if (path) out.push({ path, how: /** @type {"read" | "write" | "edit"} */ (c?.kind) });
  }
  return out;
}

/**
 * The newest plan a run of messages recorded (a todo call in any vocabulary), its items in our status words; null when
 * none was recorded. A call that keeps no list — Claude Code's TaskCreate, one task by its subject — records none, nor
 * one whose result came back an error (the hunt of 11-08: either stood as the plan, a TaskCreate as a plan of none).
 * @param {readonly any[]} messages
 * @returns {{ text: string, status: string }[] | null}
 */
export function planIn(messages) {
  const failed = new Set();
  for (const m of messages) for (const b of Array.isArray(m?.content) ? m.content : []) if (b?.type === "tool_result" && b.is_error) failed.add(b.tool_use_id);
  for (let i = messages.length - 1; i >= 0; i--) {
    const blocks = Array.isArray(messages[i]?.content) ? messages[i].content : [];
    for (let j = blocks.length - 1; j >= 0; j--) {
      const b = blocks[j];
      const c = b?.type === "tool_use" && !failed.has(b.id) ? callOf(b) : null;
      if (c?.kind === "todo" && Array.isArray(b.input?.items ?? b.input?.todos)) return c.fields.items;
    }
  }
  return null;
}

/**
 * A plan still being worked: some item is not done.
 * @template {{ status: string }} T @param {T[] | null} items @returns {T[] | null}
 */
export const livePlan = (items) => (items && items.some((it) => it.status !== "done") ? items : null);

/**
 * `files` each once, in order, less those the `kept` messages read, wrote or edited: their own calls show them.
 * @param {readonly string[]} files @param {readonly any[]} kept
 */
export function unshown(files, kept) {
  const seen = new Set(touchedFiles(kept).map(keyOf));
  return files.filter((p) => {
    const k = keyOf(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * What comes back after a summary of the turns up to `toTurn`: the files those turns used, newest first, less the ones
 * a kept turn after them uses (its own call shows them); and their newest plan while it is live, unless a kept turn
 * recorded a newer one. Where the history starts from an earlier summary (`head`), the turns are those since it, and
 * what its block brought back comes after them — its files, and its plan where no turn since recorded one — as the
 * loop's fold carries an earlier fold's block (loop.js): the work an earlier summary stands for is not read again.
 * `letters`: the letters another agent wrote that those turns opened (envelopes.js `openedLetters`), each with the turn
 * it was opened in — what a summary may lose once its words are gone (the owner's of 11-09) — but those answered since,
 * and those still `owed` a reply, which the list of what is open says.
 * @param {readonly { n: number, work?: any[] }[]} turns @param {number} toTurn
 * @param {{ to_turn?: any, attached?: string | null } | null} [head] @param {{ owed?: readonly string[] }} [o]
 */
export function afterSummaryCandidates(turns, toTurn, head = null, { owed = [] } = {}) {
  const from = head ? Number(head.to_turn) || 0 : 0;
  const sorted = [...turns].sort((a, b) => a.n - b.n);
  const workOf = (/** @type {readonly { work?: any[] }[]} */ list) => list.flatMap((t) => t.work || []);
  const summarized = workOf(sorted.filter((t) => t.n > from && t.n <= toTurn));
  const kept = workOf(sorted.filter((t) => t.n > toTurn));
  const earlier = head?.attached || "";
  const span = sorted.filter((t) => t.n > from && t.n <= toTurn);
  // The reply the person's next message answers: the newest summarized turn's last words, its end where it is long —
  // where no turn after it stays whole, whose own reply is the one answered; and none where that turn failed, was cut
  // off or refused, whose last words are Filament's line on it (shapes.js `modelTurnsOf`), no reply of the agent's.
  const newest = /** @type {any} */ (sorted.some((t) => t.n > toTurn) ? null : span.at(-1));
  const last = newest && !(newest.meta?.failed || newest.meta?.cutOff || newest.meta?.refused) ? newest : null;
  // Filament's own line that closed it — a stop, a budget reached, a window full — is no word of the agent's, and goes;
  // a pause's question stays, which the next message answers. The words are its final's, where it kept one (none
  // where the line was all of it: the text written before a round's calls is no reply); a turn that kept no final at
  // all (a coding agent's), its newest message's.
  const notice = last?.meta?.notice?.kind;
  const own = last && notice && !PAUSE_KINDS.has(notice) ? withoutNote(last) : last;
  const final = !last ? "" : last.final == null ? wordsOf([...(last.work || [])].reverse().find((/** @type {any} */ m) => m?.role === "assistant")) : wordsOf(own.final);
  const tail = tailWithinTokens(final, REATTACH_REPLY_TOKENS);
  const reply = tail.length < final.length ? `…${tail}` : final;
  // The skills the agent loaded in those turns (`loadedSkills`), each by its newest turn: their text went with them.
  /** @type {Map<string, { name: string, turn: number }>} */
  const loaded = new Map();
  for (const t of span) for (const name of loadedSkills(t.work || [])) loaded.set(name.toLowerCase(), { name, turn: t.n });
  // The letters opened in those turns, each by the turn it was opened in, after those the earlier block named (the
  // review of 11-09: they went with the next summary); none answered in them or after, none still owed.
  const answered = answeredIn(workOf(sorted.filter((t) => t.n > from)));
  const owes = new Set(owed);
  /** @type {Map<string, { id: string, from: string, subject: string, turn: number }>} */
  const letters = new Map();
  /** @param {{ id: string, from: string, subject: string, turn: number }} l */
  const letter = (l) => void (!letters.has(l.id) && !answered.has(l.id) && !owes.has(l.id) && letters.set(l.id, l));
  for (const l of blockLetters(earlier) || []) letter(l);
  for (const t of span) for (const l of lettersIn(t.work || [])) letter({ ...l, turn: l.turn ?? Number(t.n) });
  return {
    files: unshown([...touchedFiles(summarized), ...(blockFiles(earlier) || [])], kept),
    plan: planIn(kept) ? null : livePlan(planIn(summarized) || blockPlan(earlier)),
    reply: reply ? { text: reply, turn: Number(last.n) } : null,
    skills: [...loaded.values()].sort((a, b) => b.turn - a.turn).slice(0, REATTACH_SKILLS),
    letters: [...letters.values()],
  };
}

/**
 * One file as it is on disk now: its numbered text, or why it is only named; null when it is gone.
 * @param {string} path @param {{ root: string, rules: readonly import("../agent/rules.js").Rule[], redact: ((text: string) => string) | null }} o
 * @returns {{ text: string } | { why: string } | null}
 */
function bringBack(path, { root, rules, redact }) {
  const hit = ruleFor(rules, "read", { path });
  if (hit?.verdict === "deny") return { why: "a rule denies reading it" };
  if (asksFirst(hit)) return { why: "a rule asks before it is read" };
  /** @type {string} */
  let abs;
  try {
    abs = resolveInside(root, path);
  } catch {
    return { why: "outside the session's folder" };
  }
  /** @type {import("node:fs").Stats} */
  let st;
  try {
    st = statSync(abs);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const tooBig = { why: `${sizeWords(st.size)}: too big to bring back whole` };
  // No file of more bytes than eight a token fits; past that it is not even opened.
  if (st.size > REATTACH_FILE_TOKENS * 8) return tooBig;
  const bytes = readFileSync(abs);
  if (imageTypeOf(bytes)) return { why: "an image" };
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { why: "a PDF" };
  const raw = bytes.toString("utf8");
  if (raw.includes("\0")) return { why: "a binary file" };
  const text = redact ? redact(raw) : raw;
  if (!text) return { text: "(the file is empty)" };
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  const numbered = lines.map((l, i) => lineNumber(i + 1) + l).join("\n");
  return estimateTokens(numbered) > REATTACH_FILE_TOKENS ? tooBig : { text: numbered };
}

/**
 * A block without the parts that follow its files, plan, graph and what was open — the letters opened, the workers
 * that had ended, the skills, the reply — whose words are anyone's: a line of a reply that opens as a file's element
 * names no file the work used, and what follows a plan is no end of it. In the order the block writes them, so the
 * first one found is where they start. @param {string} s
 */
const ownParts = (s) => {
  const at = ["\n\n<letters>\n", "\n\n<ended>\n", "\n\n<skills>\n", "\n\n<last-reply"].map((tag) => s.indexOf(tag)).filter((i) => i >= 0);
  return at.length ? s.slice(0, Math.min(...at)) : s;
};

/** A path as an attribute value. @param {string} p */
const attr = (p) => p.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
/** The words every block opens with. */
const BACK_LEAD = "[Filament brought these back after the summary: ";

/**
 * The files a block brought back or named, in its order, as their calls spelled them; null for text that is no block.
 * The loop's next fold reads them from the block it folds — they come back again after its summary — and leaves the
 * block out of what its summarizer reads. A file's own lines are numbered, so none of them reads as an element.
 * @param {string} text
 * @returns {string[] | null}
 */
export function blockFiles(text) {
  const s = String(text ?? "");
  if (!s.startsWith(BACK_LEAD)) return null;
  return [...ownParts(s).matchAll(/^<file path="([^"]*)"/gm)].map((m) => m[1].replace(/&lt;/g, "<").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

/**
 * The plan a block brought back, as it stood there; null for text that is no block, or a block with no plan. An item
 * is a line `- [status] text`; a line that opens none goes on with the item above it.
 * @param {string} text
 * @returns {{ text: string, status: string }[] | null}
 */
export function blockPlan(text) {
  const s = String(text ?? "");
  if (!s.startsWith(BACK_LEAD)) return null;
  const m = /\n\n<plan>\n([\s\S]*?)\n<\/plan>(?:\n\n<tasks>\n[\s\S]*?\n<\/tasks>)?(?:\n\n<open>\n[\s\S]*\n<\/open>)?$/.exec(ownParts(s));
  if (!m) return null;
  /** @type {{ text: string, status: string }[]} */
  const items = [];
  for (const line of m[1].split("\n")) {
    const it = /^- \[([^\]]+)\] (.*)$/.exec(line);
    if (it) items.push({ status: it[1], text: it[2] });
    else if (items.length) items[items.length - 1].text += `\n${line}`;
  }
  return items.length ? items : null;
}

/** What a letter's line says brings its words back, to a reader that has filament_recall. @param {number} turn */
const letterRecall = (turn) => `; its words come back with filament_recall({ turn: ${turn} })`;
/** The same read back, at a line's end. */
const LETTER_RECALL = /; its words come back with filament_recall\(\{ turn: \d+ \}\)$/;
/**
 * A letter as the block names it (`reattachBlock`'s `letters`), with the turn recall brings its words back from where
 * the reader has filament_recall (`recall`). @param {{ id: string, from: string, subject: string, turn: number }} l @param {boolean} recall
 */
const letterLine = (l, recall) =>
  `- letter ${l.id}${l.subject ? `, "${l.subject.replace(/\s+/g, " ")}"` : ""}, from ${l.from}, opened in turn ${l.turn} — it asked no reply${recall ? letterRecall(l.turn) : ""}`;
/** A letter's line read back (`letterLine`): its id, subject, who wrote it and its turn. */
const LETTER_LINE = /^- letter ([^\s,]+)(?:, "(.*?)")?, from (.*), opened in turn (\d+) — /;

/**
 * The letters a block named as opened in the turns its summary stands for (`letterLine`), in its order; null for text
 * that is no block. The next summary names them again (the review of 11-09: a letter opened before one compaction went
 * with the next). Only the block's own part: a reply after it may hold the same words.
 * @param {string} text
 * @returns {{ id: string, from: string, subject: string, turn: number }[] | null}
 */
export function blockLetters(text) {
  const s = String(text ?? "");
  if (!s.startsWith(BACK_LEAD)) return null;
  const at = s.indexOf("\n\n<letters>\n");
  if (at < 0 || at !== ownParts(s).length) return [];
  const end = s.indexOf("\n</letters>", at);
  /** @type {{ id: string, from: string, subject: string, turn: number }[]} */
  const out = [];
  for (const line of s.slice(at + "\n\n<letters>\n".length, end < 0 ? s.length : end).split("\n")) {
    const m = LETTER_LINE.exec(line);
    if (m) out.push({ id: m[1], from: m[3], subject: m[2] ?? "", turn: Number(m[4]) });
  }
  return out;
}

/**
 * The letters a run of messages holds as opened, each once: those a block among them named (`blockLetters`, an
 * earlier fold's, with their turns), then those they opened (envelopes.js `openedLetters`).
 * @param {readonly any[]} messages @returns {{ id: string, from: string, subject: string, turn?: number }[]}
 */
const lettersIn = (messages) => {
  const named = messages.flatMap((m) => (m?.role === "user" && Array.isArray(m.content) ? m.content.flatMap((/** @type {any} */ b) => (b?.type === "text" ? blockLetters(b.text) || [] : [])) : []));
  /** @type {Map<string, { id: string, from: string, subject: string, turn?: number }>} */
  const out = new Map();
  for (const l of [...named, ...openedLetters(messages)]) if (!out.has(l.id)) out.set(l.id, l);
  return [...out.values()];
};

/**
 * The letters the loop's fold of a turn's rounds names after its summary (loop.js): those the folded rounds opened, and
 * those an earlier fold's block named, less those answered in `since` — the folded rounds and the rounds kept. A letter
 * opened in the turn has no turn yet: the turn's to say.
 * @param {readonly any[]} folded @param {readonly any[]} since
 */
export function foldedLetters(folded, since) {
  const answered = answeredIn(since);
  return lettersIn(folded).filter((l) => !answered.has(l.id));
}

/**
 * What one look at a session's files has read back so far, by path as its call spelled it (`bringBack`'s answer): a
 * caller that weighs several cuts at once — the compactor's plan weighs a summary, a trim and the newest turns, each
 * reading back the files of nearly the same turns — resolves, stats and reads each file once. One look's own, under
 * one folder, one set of rules and one redaction; never kept past it: the files change between looks.
 * @typedef {Map<string, { text: string } | { why: string } | null>} BroughtBack
 */

/**
 * The block that rides after a summary: the files read back newest first, whole or named, at most five within the
 * window's tenth, then the plan, then the task graph (`graph`: its text, `openGraphText`'s). With no folder (`root`
 * empty) no file is shown or named: there is nowhere to read one from, or to read it again. `text` is "" when there is
 * nothing to bring back. `room`, where the caller knows what its summary freed, bounds the files further (never past
 * the window's tenth): the loop's fold gives half of what it freed, so what comes back cannot undo the fold. `read`:
 * what this look has read back already (`BroughtBack`), and keeps what it reads now; absent, every file is read.
 * `open`: what was still open as the summary was written, a line each (agent/still-open.js), last — outside the room,
 * under the same redaction. `ended`: a team's lead's — its workers of the turn that ended, with how to reach them, a line
 * each (agent/team-tools.js `endedWorkers`), after it the same way.
 * `skills`: the skills the agent loaded in the summarized turns, by name, to load again — each with the turn it was
 * loaded in where the caller knows one (a fold of the loop's in a turn that has no number yet names it alone), and
 * never in a coding agent's block (`own`), which counts no turns of Filament's; `reply`: the newest summarized
 * turn's reply, which the person's next message answers, word for word (the owner's of 11-07: a compaction is the
 * checkpoint to tell the agent what it is likely to forget).
 * `handover`: the same block handed to the model a chat moved to (`handoverFor`), in words of the move, no summary's —
 * what stands now, from the model that answered last (`from`). Where something is open, the lead asks the agent to go
 * through it (the owner's of 11-09: every compaction reminds) — and to dismiss what no longer holds, where it has
 * Filament's envelope tool (`dismiss`). `letters`: the letters opened in the summarized turns (`afterSummaryCandidates`),
 * after what was open, each with the turn filament_recall brings it back from where the reader has that tool (`recall`;
 * the owner's of 11-09, D6). The turns a summary stands for, which filament_recall brings back, are said by the composer
 * (`withRecall`), never kept in the block. `own`: the block a coding agent hears after its own compaction (the owner's
 * of 11-10: one block, as the loop's fold has), in words of that compaction — `now`, at its next step in the turn, or
 * `since`, at its next turn's start where none came, a compaction in a turn or outside one — what stands as it is read,
 * no summary's; `seed`, where that start opens a new session from Filament's copy of the chat instead, which never
 * compacted: what the copy may not say, in words true of that session. `team`: a lead's team as it stands then
 * (agent/team-tools.js `teamNow`), after what is open.
 * @param {{ files: readonly string[], plan: { text: string, status: string }[] | null, graph?: string | null, root: string, rules: readonly import("../agent/rules.js").Rule[], redact: ((text: string) => string) | null, window: number | null | undefined, room?: number | null, read?: BroughtBack | null, open?: readonly string[] | null, ended?: readonly string[] | null, reply?: { text: string, turn: number } | null, skills?: readonly { name: string, turn?: number }[] | null, handover?: { from: string } | null, own?: "now" | "since" | "seed" | null, team?: string | null,
 *   letters?: readonly { id: string, from: string, subject: string, turn: number }[] | null, dismiss?: boolean, recall?: boolean }} o
 * @returns {{ text: string, files: { path: string, shown: boolean, why?: string }[], plan: boolean, graph: boolean, open: number, tokens: number }}
 */
export function reattachBlock({ files, plan, graph = null, root, rules, redact, window, room = null, read = null, open = null, ended = null, reply = null, skills = null, handover = null, own = null, team = null, letters = null, dismiss = true, recall = true }) {
  let left = room == null ? reattachBudget(window) : Math.min(reattachBudget(window), Math.max(0, Math.floor(Number(room) || 0)));
  /** @type {{ path: string, shown: boolean, why?: string }[]} */
  const listed = [];
  /** @type {string[]} */
  const parts = [];
  const named = (/** @type {string} */ path, /** @type {string} */ why) => {
    listed.push({ path, shown: false, why });
    parts.push(`<file path="${attr(path)}" shown="no">${why}</file>`);
  };
  for (const path of root ? files : []) {
    if (listed.length >= REATTACH_FILES) break;
    let r = read?.get(path);
    if (r === undefined) {
      r = bringBack(path, { root, rules, redact });
      read?.set(path, r);
    }
    if (r === null) continue;
    if ("why" in r) {
      named(path, r.why);
      continue;
    }
    const element = `<file path="${attr(path)}">\n${r.text}\n</file>`;
    const cost = estimateTokens(element);
    if (cost > left) {
      named(path, listed.some((f) => f.shown) ? "no room left after the files above" : "no room to bring it back");
      continue;
    }
    left -= cost;
    listed.push({ path, shown: true });
    parts.push(element);
  }
  if (plan) parts.push(`<plan>\n${plan.map((it) => `- [${it.status}] ${it.text}`).join("\n")}\n</plan>`);
  if (graph) parts.push(`<tasks>\n${graph}\n</tasks>`);
  const opened = open?.length ? (redact ? open.map(redact) : open) : null;
  if (opened) parts.push(`<open>\n${opened.join("\n")}\n</open>`);
  const crew = team ? (redact ? redact(team) : team) : "";
  if (crew) parts.push(`<team>\n${crew}\n</team>`);
  const lettered = letters?.length ? letters.map((l) => letterLine(l, recall)) : null;
  if (lettered) parts.push(`<letters>\n${(redact ? lettered.map(redact) : lettered).join("\n")}\n</letters>`);
  const done = ended?.length ? (redact ? ended.map(redact) : ended) : null;
  if (done) parts.push(`<ended>\n${done.join("\n")}\n</ended>`);
  if (skills?.length) parts.push(`<skills>\n${skills.map((k) => (!own && Number(k.turn) > 0 ? `- ${k.name} (turn ${k.turn})` : `- ${k.name}`)).join("\n")}\n</skills>`);
  // Named by its turn: the block stands at the history's head for as long as its summary does, turns after it.
  const replied = reply?.text ? (redact ? redact(reply.text) : reply.text) : "";
  if (replied) parts.push(`<last-reply turn="${reply?.turn}">\n${replied}\n</last-reply>`);
  if (!parts.length) return { text: "", files: [], plan: false, graph: false, open: 0, tokens: 0 };
  // Every compaction asks the agent to go through what is open (the owner's of 11-09).
  const through = opened ? ` ${goThrough(handover || own ? "it" : "what was open", dismiss)}` : "";
  // A handover and the agent's own compaction say what stands now; a summary's block, what stood as it was written.
  const now = handover || own ? "stands" : "stood";
  const what = [
    ...(listed.length ? ["the files the work used most recently, as they are on disk now"] : []),
    ...(plan ? [`the plan as it ${now}`] : []),
    ...(graph ? [`the task graph as it ${now}`] : []),
    ...(opened ? [handover || own ? "what is still open" : "what was still open as the summary was written"] : []),
    ...(crew ? ["your team as it stands now"] : []),
    ...(lettered ? [handover ? "the letters opened before the move, which asked no reply" : "the letters you opened in those turns, which asked no reply"] : []),
    ...(done ? ["your workers of this turn that had ended"] : []),
    ...(skills?.length ? [handover ? "the skills loaded before the move" : "the skills you had loaded"] : []),
    ...(replied ? [`your reply that ended turn ${reply?.turn}, which the person's message after the summary answers`] : []),
  ];
  const said = what.length > 2 ? `${what.slice(0, -1).join(", ")}, and ${what[what.length - 1]}` : what.join(", and ");
  // A coding agent has a skill tool of its own, which loads its own folders' skills: the tool is named as Filament's
  // in every block, whoever reads it.
  const begins = own === "seed" ? "Your session begins from Filament's copy of this chat" : `You compacted your context ${own === "now" ? "just now" : "before this message"}, and its summary may have left out what stands`;
  const lead = own
    ? `[Filament: ${begins}: here ${what.length === 1 && !skills?.length ? "is" : "are"} ${said}.${opened ? ` What is open is as it stands now: read a command's output or stop it by its id rather than starting it again.${through}` : ""}${skills?.length ? ` A skill named was loaded ${own === "seed" ? "earlier in this chat, and its text may not have come with the copy" : "before you compacted, and its text may have gone with it"}: load it again with Filament's \`skill\` tool before you follow it.` : ""}]`
    : handover
    ? `[Filament handed these over as this chat moved to you from ${handover.from}: ${said}.${listed.some((f) => !f.shown) ? " A file only named was not handed over; read it if you need it." : ""}${opened ? ` What is open is as it stands now: read a command's output or stop it by its id rather than starting it again.${through}` : ""}${skills?.length ? " A skill named was loaded before the move, and its text did not come with it: load it again with Filament's `skill` tool before you follow it." : ""}]`
    : `${BACK_LEAD}${said}.${listed.some((f) => !f.shown) ? " A file only named was not brought back; read it again if you need it." : ""}${opened ? ` What was open still is unless a later message says it ended: read a command's output or stop it by its id rather than starting it again.${through}` : ""}${skills?.length ? " A skill named was loaded in the turns the summary stands for, and its text went with them: load it again with Filament's `skill` tool before you follow it." : ""}]`;
  const text = [lead, ...parts].join("\n\n");
  return { text, files: listed, plan: !!plan, graph: !!graph, open: opened?.length ?? 0, tokens: estimateTokens(text) };
}

/**
 * What comes back after a summary of a session's turns up to `toTurn`: their files read from `root` under the session
 * document's rules and redaction, their live plan, and the session's task graph (`graph`, its chain's) while it has
 * open tasks, in its planner's words (`teams` finds a team's members, whom a lead's tasks name) — the
 * one rule the compactor and /autofit share. `window` is the
 * model's, or the one assumed for it when nobody states one. `head` is the summary the history starts from now, where
 * it has one (`afterSummaryCandidates`). `kept`: what is kept behind each of the graph's tasks (E33), marked on it.
 * `where`: where its planner stands, each running and paused task's newest checkpoint in it (E41 P1 case 3), in the
 * planner's words — the runner's. `read`: what this look at the files has read back already (`BroughtBack`), for a
 * caller that weighs several cuts at once. `open`: what is still open in the chat now (agent/still-open.js), a line each.
 * @param {{ doc: any, turns: readonly { n: number, work?: any[] }[], toTurn: number, head?: { to_turn?: any, attached?: string | null } | null,
 *   root: string | null | undefined, window: number, graph?: import("../../core/task-graph.js").Graph | null,
 *   teams?: import("../../services/teams.js").TeamStore | null, kept?: import("../../core/task-graph.js").Kept | null,
 *   where?: ((crew: import("../../core/task-graph.js").Crew) => string | null) | null, read?: BroughtBack | null, open?: readonly string[] | null,
 *   owed?: readonly string[], dismiss?: boolean }} o
 *   `owed`: the letters still waiting for the agent's reply, which `open` names; `dismiss`: whether the agent that reads
 *   the block has Filament's envelope tool.
 * The block is kept with its compaction and read by whoever reads the history after it, filament_recall theirs or not:
 * it names no tool, and the composer says what recall brings back to a reader that has it (`withRecall`).
 */
export const backAfterSummary = ({ doc, turns, toTurn, head = null, root, window, graph = null, teams = null, kept = null, where = null, read = null, open = null, owed = [], dismiss = true }) => {
  const crew = graphCrew(doc, teams);
  return reattachBlock({ ...afterSummaryCandidates(turns, toTurn, head, { owed }), graph: openGraphText(graph, crew, kept, where ? where(crew) : null, { done: true }), root: String(root || ""), rules: rulesFrom(doc), redact: redactorOf(doc?.privacy?.redact), window, read, open, dismiss, recall: false });
};

/** What a summary's head says filament_recall brings back: the turns it stands for. @param {{ from: number, to: number }} turns */
const recallSentence = ({ from, to }) =>
  // With several, recall's list of the turns names where each answer ended (the owner's of 11-08).
  from === to
    ? `Turn ${from} comes back word for word with filament_recall({ turn: ${from} }).`
    : `Any of turns ${from}–${to} comes back word for word with filament_recall({ turn: n }), and filament_recall with no arguments lists them, newest first, with how each answer ended.`;
/** The same at a block's lead's end, as a block kept before the composer said it carries it. */
const LEAD_RECALL = / (?:Turn \d+ comes back word for word with filament_recall\(\{ turn: \d+ \}\)\.|Any of turns \d+–\d+ comes back word for word with filament_recall\(\{ turn: n \}\), and filament_recall with no arguments lists them, newest first, with how each answer ended\.)\]$/;

/**
 * A block's letters' lines (`letterLine`) as the composer sends them to a reader of the history (the owner's of 11-09,
 * D6): each says the turn its words come back from where the reader has filament_recall (`recall`), and none where it
 * has not. A block is kept without those words — the block after a summary (`backAfterSummary`), and the loop's fold in
 * a turn's work (agent/turn.js) —; one kept before they moved out of it carries them, and they go first, so they are
 * said once. Any other text is sent as kept, the same string where nothing changes.
 * @param {string} text @param {boolean} recall
 */
export function withLettersRecall(text, recall) {
  if (!text.startsWith(BACK_LEAD)) return text;
  // The letters' lines are the block's own part's, where the parts anyone's words fill have not begun (`ownParts`).
  const at = text.indexOf("\n\n<letters>\n");
  if (at < 0 || at !== ownParts(text).length) return text;
  const from = at + "\n\n<letters>\n".length;
  const close = text.indexOf("\n</letters>", from);
  const to = close < 0 ? text.length : close;
  const lines = text.slice(from, to).split("\n").map((line) => {
    const bare = line.replace(LETTER_RECALL, "");
    const m = LETTER_LINE.exec(bare);
    return recall && m ? `${bare}${letterRecall(Number(m[4]))}` : bare;
  });
  return `${text.slice(0, from)}${lines.join("\n")}${text.slice(to)}`;
}

/**
 * The block after a summary (`backAfterSummary`) as the composer sends it to a reader of the history (the owner's of
 * 11-09, D6): where the reader has filament_recall (`turns`: the turns the summary stands for), its lead ends saying they
 * come back word for word, and its letters' lines say the turn each comes back from (`withLettersRecall`) — and a summary
 * with nothing brought back after it has that line alone; where it has none (`turns` null), no word of the tool. A block
 * kept before these words moved out of it carries them: they go first, so they are said once, and never to a reader
 * without the tool. Any other text is sent as kept.
 * @param {string | null | undefined} text @param {{ from: number, to: number } | null} turns
 */
export function withRecall(text, turns) {
  const s = String(text ?? "");
  if (!s) return turns ? `[Filament: ${recallSentence(turns)}]` : "";
  if (!s.startsWith(BACK_LEAD)) return s;
  const said = withLettersRecall(s, !!turns);
  const end = said.indexOf("\n\n");
  const lead = (end < 0 ? said : said.slice(0, end)).replace(LEAD_RECALL, "]");
  return `${turns ? `${lead.slice(0, -1)} ${recallSentence(turns)}]` : lead}${end < 0 ? "" : said.slice(end)}`;
}

/**
 * What the model a chat moved to is handed (the owner's of 11-08: a switch, from a coding agent to the loop, the loop to
 * one, or one agent to another, lost the plan, the skills loaded, what was still open and the task graph's notes): the
 * block a summary brings back, of the turns since the copy's head, in words of the move (`from`, the model that
 * answered last). The turns the carry form folds lose their tool output, so the files they used come back as after a
 * summary, with their plan and the skills they loaded; the newest `whole` turns the form carries whole show their own,
 * as a kept turn does after a summary, and so does the head, which the history keeps (Infinity: every turn whole). The
 * task graph with what is kept behind each task and where its planner stands, and what is open now, whatever the form.
 * The letters the folded turns opened that asked no reply, as after a summary — not those still `owed` a reply, which
 * `open` names. Neither the newest reply, which the history holds, nor recall's pointers, which a folded turn names itself.
 * `after`: the newest turn the side the chat moved to holds already — a coding agent's session the chat goes back to, or
 * the loop's copy, which keeps the loop's own turns with what it was handed then — whose files, plan, skills and letters
 * go from the turns after it alone (the bug hunt of 11-09: a side the chat went back to was handed its own again). The
 * task graph and what is open stand now, and go whatever it holds. With the block, how many skills and letters it names:
 * the switch's card says what the handover will carry. A letter's line names filament_recall only to a model that has
 * it (`recall`; the owner's of 11-09, D6).
 * @param {{ doc: any, turns: readonly { n: number, work?: any[] }[], head?: { to_turn?: any, attached?: string | null } | null,
 *   root: string | null | undefined, window: number, graph?: import("../../core/task-graph.js").Graph | null,
 *   teams?: import("../../services/teams.js").TeamStore | null, kept?: import("../../core/task-graph.js").Kept | null,
 *   where?: ((crew: import("../../core/task-graph.js").Crew) => string | null) | null, open?: readonly string[] | null, from: string,
 *   whole?: number, owed?: readonly string[], after?: number, recall?: boolean }} o
 */
export const handoverFor = ({ doc, turns, head = null, root, window, graph = null, teams = null, kept = null, where = null, open = null, from, whole = 0, owed = [], after = 0, recall = true }) => {
  const crew = graphCrew(doc, teams);
  const since = Math.max(head ? Number(head.to_turn) || 0 : 0, Number(after) || 0);
  const ns = turns.map((t) => Number(t.n) || 0).filter((n) => n > since).sort((a, b) => a - b);
  const toTurn = whole >= ns.length ? since : ns[ns.length - 1 - whole];
  const { files, plan, skills, letters } = afterSummaryCandidates(turns, toTurn, since ? { to_turn: since } : null, { owed });
  return { ...reattachBlock({ files, plan, skills, letters, graph: openGraphText(graph, crew, kept, where ? where(crew) : null, { done: true }), root: String(root || ""), rules: rulesFrom(doc), redact: redactorOf(doc?.privacy?.redact), window, open, handover: { from }, recall }), skills: skills.length, letters: letters.length };
};

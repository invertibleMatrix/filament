// The memory brain: autopilot for long-term memory (docs/memory-architecture.md §6).
//
// For every real request it (1) situates the request: project from the working directory, client, chain
// (conversation across clients), position; (2) reads signals from the newest user message (its words to search by,
// a client's compaction); (3) retrieves deep: the store (Mnemosyne) for facts
// and turn summaries, the archive for past sessions and learned items, the user's word everywhere always; (4) sizes the block
// from the position alone with a confidence gate; (5) places it so provider prompt caches survive: one stable
// briefing per chain at the end of the system prompt, per-turn material appended to the newest user message and
// re-attached byte-identically when the client resends history; (6) files nothing from a message by its words: what
// the person says is kept by the agent's quoted remember, their @mem commands or the learner (the memory plan's d3);
// (7) after the reply, marks which injected items were used so unused ones fade.
//
// Memory content never enters logs or records: notes and records carry counts and ids.
import { isAbsolute, resolve } from "node:path";
import { shortHash as sha, sha256 } from "../../core/hash.js";
import { estimateTokens as est } from "../../core/tokens.js";
import { clip, durationWords, looksLikeCode } from "../../core/text.js";
import { inBrief, isAskLine, withoutArtifactFiles } from "../../core/messages.js";
import { answersCallsOnly, flattenMessages, isUserTurn, stripReminders } from "../../core/wire/flatten.js";
import { carriesReturned } from "../../core/wire/responses.js";
import { addsNothing, clientConversationId, chainRefOf } from "../../core/conversation.js";
import { NO_PROJECT_ID, normalizeCwd, projectIdOf, projectNameOf } from "../../core/project-id.js";
import { isMachineryRequest } from "../house.js";
import { projectFolderOf } from "../project-folder.js";
import { currentTrace, safeQuery } from "./trace.js";
import { isRetired } from "./archive.js";
import { ROLES, filamentRole, speaksForUser } from "./port.js";
import { EngineOutbox } from "./outbox.js";
import { holdsValue, slotNorm, aboutUser, USER_SLOT } from "./slots.js";
import { PROCEDURE_CHARS, PROCEDURE_FORM, asProcedure, goalOfProcedure, procedureHead, procedureSlot } from "./procedures.js";
import { AnchorCheck, anchorsFor, namedPaths, worstOf } from "./anchors.js";
import { pitfallsOf, callShapes, shapesToMatch, triggerTool, callText, holdsWay, callCarries, sameTrigger, commandOf } from "./triggers.js";
import { valuesOf, withinFolder } from "./values.js";
import { requestEnv, environmentSays, toolNamesOf } from "./request-env.js";
import { goalNow, goalNoteText, goalOfNote, GOAL_BLOCK_KIND } from "./goal.js";
import { standingBlock } from "./repo-lines.js";
import { withheldStoreFor } from "./withheld-store.js";
import { restoreMessages } from "../../core/withheld.js";
import { BRIEFING_TOKENS } from "../../core/schema.js";
// One detector for "the client is asking its model to summarize the conversation", shared with the handed stage: the
// signal that archives a compaction is the same one that names a summary cut at the output cap.
import { COMPACTION_PROMPT_RE } from "../trim.js";
import { localDay } from "../daily-usage.js";
import { METRIC_DAYS, METRIC_DAYS_MAX, memoryMetrics } from "./metrics.js";
import { normWords, segmentsOf, segmentCounts, shortestWord } from "./words.js";

export const MEMORY_TAG = "filament-memory";
/** @param {string} t */
const hasBlock = (t) => t.includes(`<${MEMORY_TAG}`);

/**
 * Whether memory's tools ride on a request: one rule for every request of a session — its turns, its quiet and muted
 * requests, its compaction request — so the tools section the provider caches never changes under the conversation.
 * Sticky: engine health does not change it (P1.3 of the 2026-09-19 cache audit; a call made while the engine is down
 * fails inside executeMemoryTool and is reported to the model as an error result). Muted and quiet requests keep the
 * tools (P1.2/P1.3); a global autopilot-off is a declared, request-stable setting and stays tool-free, as does capture
 * alone. A fresh chain (no turns, no briefing, no blocks) has nothing to keep stable: an off or muted first contact
 * stays bare, as its header promises.
 * @param {{ auto: any, meta: any, sit: any, chain: any, blocks: Record<string, unknown>, captureOnly: boolean }} o
 */
function toolsOffered({ auto, meta, sit, chain, blocks, captureOnly }) {
  if (auto.tools === false) return false;
  if (!(meta.muted || auto.enabled === false || captureOnly || sit.quiet)) return true;
  const freshChain = (chain.turns || 0) === 0 && !chain.briefing && !Object.keys(blocks || {}).length;
  return auto.enabled !== false && !captureOnly && !((sit.quiet || meta.muted) && freshChain && !sit.toolsOnly);
}
const BLOCK_RE = new RegExp(`\\n*<${MEMORY_TAG}\\b[^>]*>[\\s\\S]*?</${MEMORY_TAG}>\\n*`, "g");
const STOP = new Set(
  "a an the and or but if then so of to in on at for from by with without about into over under as is are was were be been being am do does did done have has had having i me my mine we us our ours you your yours he she it its they them their this that these those there here what which who whom whose when where why how can could should would will shall may might must not no yes please just also very really quite some any all each every both few more most other such only own same than too s t don doesn didn isn aren wasn weren won wouldn couldn shouldn let lets ok okay hi hello hey thanks thank again now still already ever never always sometimes often maybe well right like get got make made want need know think see look use using used try trying going go want wanted sure thing things something anything nothing everything way".split(
    /\s+/,
  ),
);
// Paths, dotted or colon-joined names, camelCase, snake_case, name+digits. No `i` flag: camelCase needs real case.
const CODE_TOKEN =
  /^(?=.*[A-Za-z])(?:[A-Za-z0-9_]+(?:[./:\\-][A-Za-z0-9_]+)+|[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*|[A-Za-z_][A-Za-z0-9_]*_[A-Za-z0-9_]+|[a-z]+\d+[a-z0-9]*)$/;
// Words that cannot identify what a correction is about: nearly every correction contains them,
// so a shared "user"/"always"/"use" must never retire an old memory on its own.
const GENERIC_KEY = new Set([
  "correction",
  "user",
  "project",
  "session",
  "message",
  "please",
  "anymore",
  "instead",
  "switch",
  "switched",
  "change",
  "changed",
  "prefer",
  "prefers",
  "want",
  "wanted",
  "rule",
  "like",
  "stop",
  "stopped",
  "don",
]);
// Turns a message into alternative keyword searches, so recall can match past work that words
// things differently. Answer is JSON; one small call, short timeout, deep-signal messages only.
const REWRITE_PROMPT = `You turn one message into keyword searches over the user's past session notes. Return ONLY JSON: {"queries":["...","..."]}. 2 to 3 queries, 2 to 6 words each: alternative words, project names, file names or error names for the same intent. No sentences, no explanations.`;

// ---------------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------------

// Words worth searching for: stop words removed, code-like tokens (paths, identifiers, error names) kept and put
// first, order of first appearance otherwise, at most `max`. A word is any script's (the memory plan's c1): punctuation
// outside ASCII splits too, a word starts with a letter and holds letters, marks and digits, and is long enough for its
// script (words.js `shortestWord`); a run of a script written without spaces is one word here, which the engine and the
// archive's trigram index search by its parts. ASCII reads as it did.
export function keywordsOf(text, { max = 14 } = {}) {
  const raw = String(text || "")
    .replace(BLOCK_RE, " ")
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\w\s./:_-]/g, " "));
  const seen = new Set();
  const code = [];
  const words = [];
  for (const tok of raw.split(/[\s"'`(){}\[\]<>,;!?|=+*&^%$#@~]+|[^\p{L}\p{M}\p{N}\x00-\x7f]+/u)) {
    let t = tok.replace(/^[.:/\\-]+|[.:/\\-]+$/g, "");
    if (t.length < 2 || t.length > 64) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    if (CODE_TOKEN.test(t)) {
      seen.add(key);
      code.push(t);
      continue;
    }
    if (!/^\p{L}[\p{L}\p{M}\p{N}'-]*$/u.test(t)) continue;
    if (STOP.has(key) || key.length < shortestWord(key)) continue;
    seen.add(key);
    words.push(key);
  }
  return [...code, ...words].slice(0, max);
}
export const queryOf = (text, opts) => keywordsOf(text, opts).join(" ");
/** A claim's identifying words, lower-cased: its keywords without the words claims of every kind carry. @param {string} text */
export const identifyingWords = (text) =>
  keywordsOf(text, { max: 40 })
    .map((k) => k.toLowerCase())
    .filter((k) => !GENERIC_KEY.has(k));

// Remove every memory block Filament added, so hashes and captures see the client's own text.
export const stripMemoryBlocks = (text) =>
  String(text ?? "")
    .replace(BLOCK_RE, "\n")
    .trim();

const textOfContent = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((b) => b && b.type === "text" && typeof b.text === "string")
          .map((b) => b.text)
          .join("\n")
      : "";

/** The most claims a session was shown that a learning pass judges (the memory plan's d4). */
export const SHOWN_CLAIMS = 30;
/** Past this many characters, what follows the person's opening paragraph reads as pasted (Q3 (a)). */
export const PASTED_CHARS = 600;
/**
 * What of the person's message capture reads as their own words (Q3 (a), HarnessV3-FixRound F4 item 21): text that
 * reads as quoted or pasted is left out — a fenced block (``` or ~~~; an unclosed one runs to the end), a quoted line
 * ("> …"), and a long block under their opening paragraph (another agent's review below "look at this"). Free, and it
 * misses some on purpose: a paste with no opening line of theirs is read whole, and a long message of their own
 * keeps only its first paragraph.
 * @param {string} text @returns {string}
 */
export function ownWords(text) {
  /** @type {string[]} */
  const kept = [];
  /** @type {string | null} */
  let fence = null;
  for (const line of String(text ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    if (/^\s*>/.test(line)) continue;
    kept.push(line);
  }
  const t = kept.join("\n").trim();
  const paras = t.split(/\n\s*\n/);
  if (paras.length > 1 && paras.slice(1).join("\n\n").trim().length >= PASTED_CHARS) return paras[0].trim();
  return t;
}

/**
 * Whether a message is a client's compaction summary opening a chat (Claude Code's own words, machine text): it quotes
 * the person's words back, and is no message of theirs. @param {string} t
 */
export const opensCompaction = (t) =>
  /^this session is being continued from a previous conversation|^summary of the conversation so far|^# conversation summary|continued from a previous (session|conversation)/i.test(String(t ?? "").trim());

/**
 * A quote of the person's own words (the memory plan's d1): what an agent's remember or correct gives to be filed as
 * the user's word. Its length is its characters other than spaces, so no language's words are counted.
 */
export const QUOTE_CHARS = Object.freeze({ min: 8, max: 500 });
/** A text as a quote is looked for in it: its letters' case and its spaces folded. @param {unknown} t */
const foldQuote = (t) => String(t ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
/** How many turns back a quote is looked for in its chat, newest first. */
const QUOTE_TURNS = 500;
/**
 * Whether a quote says the claim it is filed with (d1): half the claim's identifying words, its numbers among them, are
 * in the quote, each found as it stands — inside a run of a script written without spaces too, so a quote in the
 * person's language backs a claim written in another where the two share names and numbers. A quote of words the
 * person typed about something else gives the claim nothing. @param {string} quote @param {string} text
 */
const quoteSays = (quote, text) => {
  const q = foldQuote(quote);
  const keys = [...new Set([...identifyingWords(text), ...(foldQuote(text).match(/\p{N}{2,}/gu) || [])])];
  return keys.length > 0 && keys.filter((k) => q.includes(k)).length * 2 >= keys.length;
};
/**
 * What the person typed in a message, for a quote (d1): its text blocks that are no notice of Filament's — a notice
 * that carries a command's output, a team's result or a flow's news after its bracket is not theirs (`personPart`) — a
 * client's reminders and memory's blocks stripped, then their own words of it (`ownWords`). @param {any} msg
 * @returns {string}
 */
const typedWords = (msg) => {
  const c = msg?.content;
  const blocks = typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : [];
  const typed = blocks
    .filter((/** @type {any} */ b) => b?.type === "text" && typeof b.text === "string")
    .map((/** @type {any} */ b) => stripReminders(b.text).text)
    .filter((t) => !isFilamentText(t));
  return ownWords(stripMemoryBlocks(typed.join("\n\n")));
};

// Signals in the newest user message. How much memory looks up for it is never read from its words (the memory plan's
// c3): a turn's room is structural, and a message with no word to search by gets no lookup (`keywords` empty); whether
// it corrects the reply before is the learner's to judge (d4). What a client's own machine text says — a compaction's
// summary opening the chat, a compaction prompt — stays read.
export function signalsOf(text) {
  const t = stripMemoryBlocks(text).trim();
  const s = {
    afterCompaction: false,
    entities: [],
    keywords: keywordsOf(t),
  };
  if (opensCompaction(t)) s.afterCompaction = true;
  if (COMPACTION_PROMPT_RE.test(t)) s.compactionRequest = true;
  s.entities = s.keywords.filter((k) => CODE_TOKEN.test(k));
  return s;
}

// Project: where the client works. From the system prompt ("Working directory: …", what Claude Code sends), a
// header, or the agent's cwd. `cwd` is that folder; `home` the folder the project is made of — the same
// place in the repository's main folder for a folder in a worktree (HarnessV4_Git_Plan GW-D46), else the folder
// itself. The id and the name are `home`'s. `mayAsk`: whether the disk may be asked of the folder — a network share the
// folder rules keep out may not, and stands as written.
/** @param {{ systemText?: string, cwdHint?: string, acpCwd?: string, mayAsk?: (folder: string) => boolean }} [o] */
export function projectOf({ systemText = "", cwdHint = "", acpCwd = "", mayAsk = () => true } = {}) {
  let cwd = String(cwdHint || acpCwd || "").trim();
  if (!cwd) {
    const m =
      /(?:Working directory|Current working directory|cwd|Project root|Repository root)\s*[:=]\s*[`"']?([^\n`"']+)/i.exec(
        systemText || "",
      );
    if (m) cwd = m[1].trim();
  }
  if (!cwd) {
    const m = /<env>[\s\S]*?Working directory:\s*([^\n]+)/i.exec(systemText || "");
    if (m) cwd = m[1].trim();
  }
  cwd = cwd.replace(/[\\/]+$/, "");
  if (!cwd) return { cwd: "", id: NO_PROJECT_ID, name: "", home: "" };
  const home = projectFolderOf(cwd, { asks: mayAsk(cwd) });
  return { cwd, id: projectIdOf(home), name: projectNameOf(home), home };
}

// The chain key a client's conversation id maps to. One place, because a fork hands the client a fresh conversation
// id and must land it on the fork's chain through exactly this mapping.
export const chainKeyForConversationId = (id) => `h:${sha(String(id), 20)}`;
/**
 * What a request's chain is found or opened by: its project, the project's folder, client and model. Filament's
 * machinery — a loop's tick, a sub-agent's run — rides the developer's own chain as Filament's request, so its
 * user-agent and inner model never become the session's client and model. A chain born in a folder that is not its
 * project's (a worktree, GW-D46) keeps that folder as its own (`meta.cwd`, GW-D47). @param {any} sit
 */
export function chainLookup(sit) {
  const machinery = isMachineryRequest(sit.headers);
  const cwd = sit.project?.cwd || null;
  const home = sit.project?.home || cwd;
  return {
    project: sit.project?.id === "none" ? null : sit.project?.id,
    cwd: home,
    client: machinery ? null : sit.client,
    model: machinery ? null : sit.model,
    ...(cwd && normalizeCwd(cwd) !== normalizeCwd(home) ? { meta: { cwd } } : {}),
  };
}
// The kinds the harness's session list shows unless asked otherwise: the developer's own tasks and their forks.
// Ticks and imported sub-agent transcripts stay in the archive for the inspectors (HarnessV2 D4).
export const LISTED_KINDS = Object.freeze(["interactive", "fork"]);
// What a search spans unless asked otherwise (`@mem sessions`, the model's `sessions` tool, the dashboard): every
// conversation that was somebody's, i.e. all but the chains Filament opened for its own calls (a loop's ticks) and an
// outside agent's MCP session, which holds what it was shown, no conversation (HarnessV3-Memory M7-D40).
export const SEARCH_KINDS = Object.freeze(["interactive", "fork", "subagent"]);
// What recall quotes as words from a past session (HarnessV3-Memory M7-3): a person's own sessions and their forks. A
// tick's are Filament's words, and an imported sub-agent's are the words of the agent that briefed it: none of them is
// what the user typed.
const QUOTED_KINDS = Object.freeze(["interactive", "fork"]);

// The client, from the user-agent (first token before '/') and the conversation headers it sends. The harness names
// itself (`x-filament-client: harness`, a header only Filament's own calls keep: services/house.js); a browser's
// user-agent would say "mozilla".
export function clientOf(headers = {}) {
  const ua = String(headers["user-agent"] || "");
  const first = ua.split(/[\s/]/)[0].toLowerCase();
  if (String(headers["x-filament-client"] || "").toLowerCase() === "harness") return "harness";
  if (/claude-cli|claude-code/.test(ua.toLowerCase())) return "claude-code";
  if (headers["x-session-id"] && !/^(assistant|ping|memory)-/.test(String(headers["x-session-id"])))
    return first || "unknown";
  if (headers["x-opencode-session"]) return "opencode";
  if (/codex/i.test(ua)) return "codex";
  if (/cursor/i.test(ua)) return "cursor";
  return first || "unknown";
}

/**
 * Why Memory settings leave a request out (`memory.capture`), in their words — or null where none of them does: its
 * client is one they exclude, its model matches an excluded pattern — as named, or as the model an `agent/<model>`
 * name runs the agent loop on —, or its folder or its project's folder (a worktree's main folder, GW-D48) is an
 * excluded folder or inside one. One answer: memory's situate decides by it, and what says why a chat is left out —
 * the engine's note, /goal, /team, /set, a harness chat's engine on its page — names the same reason. The cheap lists
 * go first: `place`, the request's folder and its project's, is asked last and only where a folder is excluded, as
 * finding the folder may walk the conversation; `model` may be asked the same way, only where a model is excluded and
 * the client passed (a chat's, `chatLeftOut`, reads its settings).
 * @param {{ excludeClients?: unknown[], excludeModels?: unknown[], excludeFolders?: unknown[] }} capture
 * @param {{ client: string, model: string | (() => string), place: () => { cwd: string, home: string } }} request
 * @returns {string | null}
 */
export function capturedOut(capture, { client, model: named, place }) {
  if (capture.excludeClients?.some((c) => c && client.includes(String(c).toLowerCase()))) return `client "${client}" is excluded in Memory settings`;
  if (!capture.excludeModels?.length) return capturedFolder(capture, place);
  const model = typeof named === "function" ? named() : named;
  const loops = String(model || "").replace(/^agent\//, "");
  if (capture.excludeModels.some((p) => globMatch(p, model) || globMatch(p, loops))) return `model "${model}" is excluded in Memory settings`;
  return capturedFolder(capture, place);
}

/**
 * `capturedOut`'s folder: the request's folder or its project's, each an excluded folder or inside one — or null.
 * @param {{ excludeFolders?: unknown[] }} capture @param {() => { cwd: string, home: string }} place
 * @returns {string | null}
 */
function capturedFolder(capture, place) {
  if (!capture.excludeFolders?.length) return null;
  const { cwd, home } = place();
  if (!cwd) return null;
  // The folder or its project's folder, each the excluded folder or inside it.
  const excluded = (/** @type {unknown} */ f) => {
    const x = normalizeCwd(f);
    return !!x && [cwd, home].some((p) => {
      const n = normalizeCwd(p);
      return !!n && (n === x || n.startsWith(`${x}/`));
    });
  };
  return capture.excludeFolders.some(excluded) ? "the working folder is excluded in Memory settings" : null;
}

// A client id in one or two words for a person to read (the busy reply D13, the holder badge, a client's chat named on
// the page). An unknown client still gets a name, never a blank.
export function clientLabel(client) {
  return (
    ({ harness: "the harness", "claude-code": "Claude Code", cursor: "Cursor", opencode: "OpenCode", codex: "Codex" }[
      String(client || "").toLowerCase()
    ] || String(client || "another chat"))
  );
}

/**
 * A holder's words (Facade D13): the harness's window is "the harness", any other holder its client's (a chat's move
 * says its own), and a turn a coding agent began by itself the agent's name (HarnessV3-ACP AC3-9). The one answer to
 * that rule — `SessionTurns` stamps it on every snapshot through `labelOf`. Takes a holder-shaped object
 * ({ window, client, own }) or null.
 * @param {{ window?: string | null, client?: string | null, own?: { agent: string } | null } | null | undefined} holder
 */
export function holderLabel(holder) {
  if (!holder) return clientLabel(null);
  if (holder.own?.agent) return holder.own.agent;
  return holder.window === "harness" ? clientLabel("harness") : clientLabel(holder.client);
}

/**
 * The cue's sentence (Facade D5), one function over the cue's data — byte-for-byte the sentence Filament has always
 * put in front of a reply (pinned by a test). One paragraph, no blank line inside: the recorded prefix is found by
 * the hash of the text before the reply's first blank line (Step 2 D11).
 * @param {{ items?: number, sessions?: { id: string, title?: string }[], questions?: number } | null} cue
 * @returns {string}
 */
export function cueText(cue) {
  const items = Number(cue?.items) || 0;
  const sessions = Array.isArray(cue?.sessions) ? cue.sessions : [];
  // Memory's open questions for the user (HarnessV3-Memory M4-6), named after the rest; none adds nothing.
  const q = Number(cue?.questions) || 0;
  const asks = q ? `${q} question${q === 1 ? "" : "s"} for you: say "@mem inbox" to see ${q === 1 ? "it" : "them"}.` : "";
  if (!items && !sessions.length) return asks ? `Memory: ${asks}` : "";
  const parts = sessions.slice(0, 3).map((c) => `${c.id}${c.title ? ` ${clip(c.title, 32)}` : ""}`);
  return `Memory: ${items ? `${items} related item${items === 1 ? "" : "s"}` : ""}${items && sessions.length ? ", " : ""}${sessions.length ? `${sessions.length} earlier session${sessions.length === 1 ? "" : "s"} here (${parts.join("; ")})` : ""}. Say "@mem load <session>" to bring one in.${asks ? ` ${asks}` : ""}`;
}

// Index of the newest user message that is the person speaking (not a tool result), or -1.
export function newestUserIndex(format, body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m?.role === "assistant") return -1;
    if (m?.role !== "user") continue;
    if (answersCalls(m, format)) return -1; // a tool-loop leg
    return i;
  }
  return -1;
}
export const userTextAt = (body, i) =>
  i >= 0 && body?.messages?.[i] ? textOfContent(body.messages[i].content) : "";
// A user text block Filament wrote itself — a sub-agent's report or launch notice riding the next message
// (app/agent/subagents.js), a note of its own — opens with "[Filament:". It is never the person speaking (BUG-27: a
// relayed report's "never touch it" was captured as the owner's correction, and that correction superseded seven of
// their real memories). The developer's steers are relayed under their own head and stay theirs.
const FILAMENT_TEXT = /^\s*\[Filament:/;
export const isFilamentText = (text) => FILAMENT_TEXT.test(String(text ?? ""));
/**
 * The person's own words in message `i`, as memory reads them (signals, the learner, recall's query): its text blocks
 * without Filament's own, memory blocks and a client's `<system-reminder>` blocks stripped — those address the client's
 * own model (its CLAUDE.md, hook output, its own nudges), and read as the person's they were captured as their rules
 * (the bug report's L14). Filament's own are told apart by whole blocks — a plain string is read as it came. What is
 * sent upstream is untouched, so no cache moves.
 * @param {any} body @param {number} i @returns {string}
 */
export const personTextAt = (body, i) => {
  const content = i >= 0 ? body?.messages?.[i]?.content : null;
  if (!Array.isArray(content)) return stripMemoryBlocks(stripReminders(userTextAt(body, i)).text);
  const parts = content.map((b) => (b && b.type === "text" && typeof b.text === "string" ? { ...b, text: personPart(stripReminders(b.text).text) } : b));
  return stripMemoryBlocks(textOfContent(parts.filter((b) => !(b && b.type === "text" && !b.text))));
};
/**
 * What of one text block is the person's: none of a block that opens with "[Filament:", which is Filament's whole. A
 * notice of Filament's may carry a body past its bracket — a background command's output, a team's result, a flow's
 * news — and nothing tells such a body from words the person typed under a notice they pasted, so neither is read as
 * theirs (the memory plan's d3; the tail was, and a command's output of "]" and a blank line, or a team's whole result,
 * became the person's words). Their own words come in a block of their own.
 * @param {string} text @returns {string}
 */
const personPart = (text) => (isFilamentText(text) ? "" : text);
/**
 * A user message apart, for a reader that must know whose words it reads (the learner, HarnessV4_Tasks C12): `said`,
 * the person's own (`personTextAt`), and `rode`, Filament's own notices that came with them — the text blocks that open
 * with "[Filament:", whole. A client's reminders and memory's blocks are in
 * neither: they address the model, and tell a reader of the session nothing the session does not. Nor is the line
 * that names whom the agent may ask, nor the composer's side by side line (`isAskLine`): standing words, no news of this one.
 * @param {any} message @returns {{ said: string, rode: string }}
 */
export const wordsOfMessage = (message) => ({ said: personTextAt({ messages: [message] }, 0), rode: noticesOfMessage(message).join("\n") });
/** Filament's own notices that came with a user message, a block each: `wordsOfMessage`'s `rode`, apart. @param {any} message @returns {string[]} */
export const noticesOfMessage = (message) =>
  (Array.isArray(message?.content) ? message.content : [])
    .filter((/** @type {any} */ b) => b?.type === "text" && typeof b.text === "string" && isFilamentText(b.text) && !isAskLine(b.text))
    .map((/** @type {any} */ b) => stripReminders(b.text).text.trim());
/**
 * A user message apart as the summary view folds it (archive.js `render`'s `words`): `wordsOfMessage`'s, with its notices
 * a block each, so each is folded to its own first line (the review of 11-08: a notice's body has lines of its own).
 * @param {any} message @returns {{ said: string, rode: string, notices: string[] }}
 */
export const summaryWordsOf = (message) => ({ ...wordsOfMessage(message), notices: noticesOfMessage(message) });
/** A flattened message that is the person's text: no tool result's (`isUserTurn`). @param {any} m */
const isPersonText = (m) => isUserTurn(m) && !!m.text && !/^\[tool result/.test(m.text);
export const allUserTexts = (format, body) =>
  flattenMessages(format, body)
    .filter(isPersonText)
    .map((m) => stripMemoryBlocks(m.text))
    .filter(Boolean);
export const systemTextOf = (format, body, responsesBody) =>
  responsesBody?.instructions
    ? String(responsesBody.instructions)
    : flattenMessages(format, body)
        .filter((m) => m.role === "system")
        .map((m) => m.text)
        .join("\n");

// Is this message a person speaking, rather than a tool-result leg continuing the previous turn? Three places must
// agree on the answer — the newest-user search, block re-attachment and the `nth` occurrence count — so it lives here
// once, and reads a leg as the archive's turns do (`isUserTurn`): a tool message; an Anthropic user message of tool
// results with none of the person's words beside them, a client's reminder being none of theirs (the bug report's
// H15); what a Responses client's tools returned beside their outputs (`carriesReturned`).
/** @param {any} m @param {string} format */
const answersCalls = (m, format) =>
  format === "anthropic" ? m.role === "user" && answersCallsOnly(m.content) : m.role === "tool" || carriesReturned(m);
export const isBlockEligibleUser = (m, format) => !!m && m.role === "user" && !answersCalls(m, format);

// A tool-result leg: never eligible for NEW blocks (the turn budget is zero on legs), but blocks that were
// legitimately attached to one — deferred memory tool results, rules-that-act reminders — must be RE-attached
// on every resend or the provider's cached prefix breaks from that message (P1.1 of the 2026-09-19 cache audit).
export const isToolLeg = (m, format) => !!m && answersCalls(m, format);
// Everything a stored block may live on: person-speaking user messages and tool-result legs. New content still
// attaches only to block-eligible user messages; this wider set is for RE-attachment and `nth` counting only.
export const isBlockAttachable = (m, format) => isBlockEligibleUser(m, format) || isToolLeg(m, format);
// The kinds of block that may live on a tool-result leg (prepare's `putBlock`): the results of the model's memory tools
// a mixed reply left (`tool`, on the newest message, a leg or the person's) — in a chat Memory settings leave out, the
// results of its filament_recall calls (`recall`), the only blocks placed there — and memory at the moment of action
// (`rule`, on the leg that answers the calls). Every other kind is placed on a person message.
const LEG_KINDS = new Set(["tool", "recall", "rule"]);
// The kinds of block a chat Memory settings leave out has placed again (`reattachBlocks`' `kinds`): the results of its
// filament_recall calls, the only blocks placed there.
const RECALL_ONLY = new Set(["recall"]);
// A session the person loaded onto a message (`@mem load`) is kept beside the message's own block, under the message's
// hash with this mark: it neither takes the place of the recall or the tool results the message carries nor keeps the
// message from its recall, and it rides that one message alone — never a later one of the same words.
const LOAD_SLOT = "#load";
/**
 * Where the load the nth copy of a message's words rode is kept: each copy its own, so a load on a later copy takes
 * nothing from an earlier one.
 * @param {string} h @param {number} nth
 */
const loadSlot = (h, nth) => (nth > 1 ? `${h}${LOAD_SLOT}${nth}` : h + LOAD_SLOT);
// The results of the model's memory calls a reply could not carry (`tool`), placed on the next request's newest message,
// are kept beside that message's own block too, under its hash with this mark: they never take the place of the recall,
// the errata or the rule reminders the message carries. A message's blocks go out in one order on every request — its
// own block, what stands for the session (`STANDING_SLOT`), the results, a load — each placed where that order puts it,
// so every resend sends the message's bytes as its first request did.
const TOOL_SLOT = "#tool";
/** Where the results the nth copy of a message's words rode are kept, each copy its own. @param {string} h @param {number} nth */
const toolSlot = (h, nth) => (nth > 1 ? `${h}${TOOL_SLOT}${nth}` : h + TOOL_SLOT);
// What stands for the session and came after its system prompt went out — a briefing built on a later turn
// (`briefingSeated`), the goal accepted, sliced or closed since (`goalPinned`) — rides the person's message, kept beside
// that message's own block under its hash with this mark: the system prompt keeps every byte the provider cached, and
// takes them at the chat's next compaction.
const STANDING_SLOT = "#standing";
/** Where what stands that the nth copy of a message's words rode is kept, each copy its own. @param {string} h @param {number} nth */
const standingSlot = (h, nth) => (nth > 1 ? `${h}${STANDING_SLOT}${nth}` : h + STANDING_SLOT);
// The kinds of block kept in that slot.
const STANDING_BLOCKS = new Set(["briefing", GOAL_BLOCK_KIND]);
// Where a chain's briefing seat and goal pin are kept: for each window of the chain (a client's conversation, the
// harness's), as each sends a history of its own and has compactions of its own (`newestCompactionId`).
const windowOf = (/** @type {any} */ sit) => String(sit.window || "-");
/** The text of the newest briefing a request's history carries on a message (`reattachBlocks`' `placedOut`), "" for none. @param {{ text: string, kind: string }[]} placed */
const carriedBriefing = (placed) => {
  let text = "";
  for (const b of placed) if (b.kind === "briefing") text = b.text;
  return text;
};
/**
 * Where the kth block placed in a slot of a message's copy is kept: each placement under a key of its own, in the order
 * they came — a second deferral or load onto a message that carries one already (a retry of the request it rode) goes
 * out after it, as that request sent the two, on every later request too.
 * @param {string} slot @param {number} k
 */
const placementOf = (slot, k) => (k > 1 ? `${slot}.${k}` : slot);

// ---- one pass over the conversation, memoized for the life of one request -------------------------------------
// A CPU profile of a 3.2 MB / 420-message session (`node --cpu-prof` over `scripts/cache-stress.mjs --turns 200
// --msg-kb 16`) put ~22% of total runtime in sha256 `update`, essentially all of it `messageHash` recomputing the
// SAME messages several times per request: once per message in `reattachBlocks`, then a fresh full walk with fresh
// hashes inside `putBlock` for EVERY block stored, plus `flattenMessages` three separate times in `situate`. On an
// append-only conversation the client resends in full each turn, that is O(n) work repeated k times per request over
// a history that only ever grows — the quadratic long-session cost the W3 review predicted.
//
// This collapses it to one flatten, one hash per message per request, and one occurrence-count walk. `stats` counts
// the walks, flattens and hashes actually performed, so a test can pin the collapse rather than trust a comment:
// reverting any part of it moves a number.
//
// Safety: the memo is keyed by message INDEX and lives only for one request. Memory blocks attached during prepare do
// not invalidate it, because `messageHash` strips them before hashing — a message's hash is the hash of the CLIENT's
// bytes, identical before and after we attach anything. Nothing outside prepare reads the memo.
export function createConversationScan(format, body, responsesBody = null) {
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const stats = { flattens: 0, walks: 0, hashes: 0, strips: 0 };
  let flat = null;
  const flatOf = () => {
    if (flat === null) {
      stats.flattens++;
      flat = flattenMessages(format, body);
    }
    return flat;
  };
  const hashes = new Map();
  const hashAt = (i) => {
    if (hashes.has(i)) return hashes.get(i);
    const m = msgs[i];
    const h = m ? messageHash(m) : null;
    hashes.set(i, h);
    stats.hashes++;
    return h;
  };
  // The eligible indices are captured EAGERLY, before anything mutates the body. Attaching a memory block to a
  // tool-result-only user message would make it look eligible afterwards, and `nth` is stored in the archive and
  // replayed against the client's CLEAN bytes on every later request — so counting a mutated message would pick the
  // wrong duplicate and break the provider's cache from that point on. Capturing the list costs one shape-check walk
  // (no stringify, no hashing); the hashes themselves stay lazy.
  const eligibleIdx = [];
  const attachIdx = [];
  for (let i = 0; i < msgs.length; i++) {
    if (isBlockEligibleUser(msgs[i], format)) {
      eligibleIdx.push(i);
      attachIdx.push(i);
    } else if (isToolLeg(msgs[i], format)) attachIdx.push(i);
  }
  // How many attachable messages share each hash — what `nth` means. Tool legs are counted too: a deferred or
  // rule block stored on a leg needs its occurrence number to re-attach to the same leg on a resend. Normal user
  // blocks are unaffected — a user message and a tool leg can never share a hash, because the content differs. For
  // the same reason a person message's hash is counted among the person messages alone (`nthOf(h, { legs: false })`):
  // its count is the same, and no leg — most of an agent's history — is hashed to find it.
  let counts = null;
  let personCounts = null;
  const countIn = (idx) => {
    const m = new Map();
    stats.walks++;
    for (const i of idx) {
      const h = hashAt(i);
      m.set(h, (m.get(h) || 0) + 1);
    }
    return m;
  };
  const countsOf = () => (counts ??= countIn(attachIdx));
  let sys = null;
  const systemText = () => {
    if (sys !== null) return sys;
    sys = responsesBody?.instructions
      ? String(responsesBody.instructions)
      : flatOf()
          .filter((m) => m.role === "system")
          .map((m) => m.text)
          .join("\n");
    return sys;
  };
  // Only the first user text and the count are ever consumed: the session fingerprint and first-vs-mid position.
  // Materializing and regex-stripping EVERY user message on a 200-turn session was the largest allocation in the path,
  // so keep the first and merely count the rest. The tag check matters: `String.replace` allocates a copy even when
  // nothing matches, so skipping it for the 99% of messages with no memory block avoids one full copy of each.
  let users = null;
  const usersOf = () => {
    if (users) return users;
    stats.walks++;
    const list = flatOf().filter(isPersonText);
    const clean = (t) =>
      typeof t === "string" && hasBlock(t) ? (stats.strips++, stripMemoryBlocks(t)) : t;
    let first = "",
      count = 0;
    for (const m of list) {
      const t = clean(m.text);
      if (!t) continue;
      count++;
      if (!first) first = t;
    }
    users = { count, first };
    return users;
  };
  return {
    stats,
    format,
    body,
    messages: msgs,
    get length() {
      return msgs.length;
    },
    flat: flatOf,
    systemText,
    hashAt,
    nthOf: (h, { legs = true } = {}) => (legs || counts ? countsOf() : (personCounts ??= countIn(eligibleIdx))).get(h) || 0,
    eligibleIdx,
    attachIdx,
    isEligible: (i) => isBlockEligibleUser(msgs[i], format),
    firstUserText: () => usersOf().first,
    userTextCount: () => usersOf().count,
    // The full list, for the callers that genuinely need every user text (the session fingerprint's fallback and the
    // `@mem` command surface). Deliberately not used by the hot path.
    allUserTexts: () =>
      flatOf()
        .filter(isPersonText)
        .map((m) => stripMemoryBlocks(m.text))
        .filter(Boolean),
  };
}

// A copy of a wire message with Filament's own `<filament-memory>` blocks removed, in every content shape.
// Used for hashing, so a resent message maps to the same block: what the CLIENT sent, not the injections Filament
// added on the way through.

export function stripMessageMemoryBlocks(msg) {
  if (!msg) return msg;
  // Fast path: a message with nothing to strip is returned BY IDENTITY, not copied — `String.replace` and `flatMap`
  // both allocate, and on a long conversation nearly every message has no memory block, so the common case now costs
  // a substring search instead of a full copy.
  //
  // The condition is deliberately exact, because `messageHash` hashes this result and blocks are PERSISTED under that
  // hash. The slow path trims (stripMemoryBlocks ends in .trim()), so this one trims too: a message seen once with a
  // block and once without would otherwise hash two ways when its content has boundary whitespace, and the block
  // stored under one hash would never re-attach under the other. Identity is therefore only taken when stripping AND
  // trimming would both be no-ops.
  if (typeof msg.content === "string") {
    const c = msg.content;
    if (!hasBlock(c)) {
      // No block to strip — but the slow path trims, and blocks are keyed by the hash of the trimmed text, so the
      // trim cannot be skipped. It does not have to be expensive though: V8's trim only
      // walks the boundary whitespace and returns the same string when there is none, so a clean message is still
      // returned by identity and a padded one costs a slice header, not a copy. What this branch really saves is the
      // BLOCK_RE scan over the whole message, which is the expensive part.
      const t = c.trim();
      return t === c ? msg : { ...msg, content: t };
    }
    return { ...msg, content: stripMemoryBlocks(c) };
  }
  if (Array.isArray(msg.content)) {
    // Array content is never trimmed by the slow path, so identity is hash-preserving here whenever no text block
    // carries the tag: the rebuilt object would JSON-stringify identically, key order included.
    if (
      !msg.content.some(
        (b) => b && b.type === "text" && typeof b.text === "string" && hasBlock(b.text),
      )
    )
      return msg;
    return {
      ...msg,
      content: msg.content.flatMap((b) => {
        if (b && b.type === "text" && typeof b.text === "string" && hasBlock(b.text)) {
          const t = stripMemoryBlocks(b.text);
          return t ? [{ ...b, text: t }] : [];
        }
        return [b];
      }),
    };
  }
  return msg;
}

// Hash of a message as the client sent it (memory blocks removed), so a resent message maps to the same block.
export function messageHash(msg) {
  if (!msg) return sha("");
  return sha(JSON.stringify(stripMessageMemoryBlocks(msg)), 24);
}

/**
 * Where a tool-loop leg's history parts from the archived turn (HarnessV2 F6): the leg's messages from `from` are
 * compared, by the archive's own content hash, with the turn's work followed by its final, as far as both go. A leg
 * that only extends the archived loop, or replays a prefix of it, agrees (null); the first differing position is a
 * branch — an edited result or a rewound loop — and the leg must not be folded into the turn.
 * @param {{ work?: string[], final_hash?: string | null } | null} turnRow
 * @param {any[]} msgs @param {number} from
 * @returns {{ at: number } | null}
 */
export function contradiction(turnRow, msgs, from) {
  if (!turnRow) return null;
  const expected = [...(turnRow.work || []), ...(turnRow.final_hash ? [turnRow.final_hash] : [])];
  const n = Math.min(expected.length, Math.max(0, msgs.length - from));
  for (let i = 0; i < n; i++) {
    const m = msgs[from + i];
    if (sha256(JSON.stringify(m === undefined ? null : m)) !== expected[i]) return { at: i };
  }
  return null;
}

/**
 * Memory's block of `kind`, as every model is given it. Its words come from what was said and read — a page, a tool's
 * output, a model's note — so a Filament tag among them is written as text (`&lt;`): a memory holding
 * `</filament-memory>` ended its block early, and what followed read as the person's words or Filament's (the bug
 * report's L13). @param {string} kind @param {string} text
 */
export const memoryBlock = (kind, text) => `<${MEMORY_TAG} kind="${kind}">\n${text.trim().replace(/<(\s*\/?\s*filament-)/gi, "&lt;$1")}\n</${MEMORY_TAG}>`;

// System-prompt placement (stable per chain): replaces an existing block of the same kind where it stands, else
// appends; with no text, takes it away. A block placed again with the same words leaves every byte where it stood —
// a loop's tick, whose system holds the request's own (blocks and all) ahead of the loop's prompt, is placed again on
// each round, and a block moved to the end there began the prompt with "\n" (t419).
export function applySystemBlock(format, body, responsesBody, text, kind = "briefing") {
  const k = kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\n*<${MEMORY_TAG} kind="${k}">[\\s\\S]*?</${MEMORY_TAG}>\\n*`, "g");
  const one = new RegExp(`<${MEMORY_TAG} kind="${k}">[\\s\\S]*?</${MEMORY_TAG}>`);
  const opens = new RegExp(`<${MEMORY_TAG} kind="${k}"`);
  const add = (s) => {
    const was = String(s || "");
    if (text && one.test(was)) return was.replace(one, () => memoryBlock(kind, text));
    const base = was.replace(re, "\n").replace(/\s+$/, "");
    return text ? (base ? `${base}\n\n${memoryBlock(kind, text)}` : memoryBlock(kind, text)) : base;
  };
  if (format === "anthropic") {
    if (Array.isArray(body.system)) {
      const i = body.system.findIndex((b) => b?.type === "text" && opens.test(b.text || ""));
      if (i >= 0) {
        if (text) body.system[i].text = memoryBlock(kind, text);
        else body.system.splice(i, 1);
      } else if (text) body.system.push({ type: "text", text: memoryBlock(kind, text) });
    } else if (typeof body.system === "string" && body.system.trim()) body.system = add(body.system);
    else if (text) body.system = memoryBlock(kind, text);
  } else {
    const msgs = Array.isArray(body.messages) ? body.messages : (body.messages = []);
    const sys = msgs.find((m) => m && (m.role === "system" || m.role === "developer"));
    if (sys) {
      if (typeof sys.content === "string") sys.content = add(sys.content);
      else if (Array.isArray(sys.content)) {
        const i = sys.content.findIndex((b) => b?.type === "text" && opens.test(b.text || ""));
        if (i >= 0) {
          if (text) sys.content[i].text = memoryBlock(kind, text);
          else sys.content.splice(i, 1);
        } else if (text) sys.content.push({ type: "text", text: memoryBlock(kind, text) });
      }
    } else if (text) msgs.unshift({ role: "system", content: memoryBlock(kind, text) });
  }
  if (responsesBody) responsesBody.instructions = add(responsesBody.instructions);
}

// Append a block to one user message (per-turn placement), or put it before `before` — a block the message carries
// already — as appending the two in that order would. Idempotent for the same block text.
export function applyUserBlock(body, index, text, kind = "turn", before = null) {
  const m = body?.messages?.[index];
  if (!m || !text) return false;
  const b = memoryBlock(kind, text);
  if (typeof m.content === "string") {
    if (m.content.includes(b)) return false;
    const at = before ? m.content.lastIndexOf(`\n\n${before}`) : -1;
    m.content = at >= 0 ? `${m.content.slice(0, at)}\n\n${b}${m.content.slice(at)}` : `${m.content}\n\n${b}`;
    return true;
  }
  if (Array.isArray(m.content)) {
    if (m.content.some((x) => x?.type === "text" && (x.text || "").includes(b))) return false;
    const at = before ? m.content.findIndex((x) => x?.type === "text" && x.text === before) : -1;
    if (at >= 0) m.content.splice(at, 0, { type: "text", text: b });
    else m.content.push({ type: "text", text: b });
    return true;
  }
  if (m.content == null) {
    m.content = b;
    return true;
  }
  return false;
}

/**
 * Memory's blocks taken from a request a coding agent answers (HarnessV3-ACP AC4-2), each as memory placed it: the
 * system prompt's (briefing, goal) and the newest message's (recall, a session the person loaded). The
 * request is left with none, on any message: an agent is no model Filament sends the request to — what it is given
 * goes through its own channels, and the history it is seeded from is the person's words.
 * @param {string} format @param {any} body
 * @returns {{ system: { kind: string, text: string }[], newest: { kind: string, text: string }[] }}
 */
export function liftMemoryBlocks(format, body) {
  const one = new RegExp(`\\n*<${MEMORY_TAG}\\b(?:\\s+kind="([^"]*)")?[^>]*>\\n?([\\s\\S]*?)\\n?</${MEMORY_TAG}>\\n*`, "g");
  /** The text without its blocks, and the blocks. @param {string} s */
  const lift = (s) => {
    /** @type {{ kind: string, text: string }[]} */
    const found = [];
    const text = String(s).replace(one, (_, kind, inner) => {
      found.push({ kind: kind || "turn", text: String(inner).trim() });
      return "\n\n";
    });
    return found.length ? { text: text.trim(), found } : { text: String(s), found };
  };
  /** A message's or a system prompt's content without its blocks, into `into`. @param {any} content @param {{ kind: string, text: string }[] | null} into */
  const strip = (content, into) => {
    if (typeof content === "string") {
      const r = lift(content);
      if (into) into.push(...r.found);
      return r.text;
    }
    if (!Array.isArray(content)) return content;
    const out = [];
    for (const part of content) {
      if (part?.type !== "text" || typeof part.text !== "string") {
        out.push(part);
        continue;
      }
      const r = lift(part.text);
      if (into) into.push(...r.found);
      if (!r.found.length) out.push(part);
      else if (r.text) out.push({ ...part, text: r.text });
    }
    return out;
  };
  /** @type {{ kind: string, text: string }[]} */
  const system = [];
  /** @type {{ kind: string, text: string }[]} */
  const newest = [];
  if (format === "anthropic" && body?.system != null) body.system = strip(body.system, system);
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const last = msgs.length - 1;
  msgs.forEach((m, i) => {
    if (!m || m.content == null) return;
    const sys = m.role === "system" || m.role === "developer";
    m.content = strip(m.content, sys ? system : i === last && m.role === "user" ? newest : null);
  });
  return { system, newest };
}

/**
 * The calls whose results a request's withheld memory exchange carries once it is put back on its way upstream
 * (pipeline/stages/withheld.js, which this asks as that stage will): how many results of each id the exchange answers
 * beyond what the client's own messages do — a provider that names each reply's calls afresh (`call_0`) gives the
 * rounds, and the client's own calls, the same ids.
 * @param {string} format @param {any[]} messages @param {any} archive
 * @returns {Map<string, number>}
 */
function carriedByPutBack(format, messages, archive) {
  /** @type {Map<string, number>} */
  const none = new Map();
  if ((format !== "anthropic" && format !== "openai") || !Array.isArray(messages) || messages.length < 2) return none;
  const store = withheldStoreFor(archive);
  if (!store) return none;
  const r = restoreMessages(format, messages, (anchors) => store.lookup(anchors));
  if (!r.restored) return none;
  /** How many tool results of each id some messages carry. @param {any[]} ms */
  const answeredIn = (ms) => {
    /** @type {Map<string, number>} */
    const ids = new Map();
    const add = (/** @type {unknown} */ id) => ids.set(String(id), (ids.get(String(id)) || 0) + 1);
    for (const m of ms) {
      if (m?.role === "tool" && m.tool_call_id) add(m.tool_call_id);
      else if (m?.role === "user" && Array.isArray(m.content))
        for (const b of m.content) if (b?.type === "tool_result" && b.tool_use_id) add(b.tool_use_id);
    }
    return ids;
  };
  const sent = answeredIn(messages);
  const carried = new Map();
  for (const [id, n] of answeredIn(r.messages)) if (n > (sent.get(id) || 0)) carried.set(id, n - (sent.get(id) || 0));
  return carried;
}

// Re-attach the blocks earlier turns received, so the model sees the same history on every request (cache-stable).
// A block is keyed by message hash; `nth` records which occurrence of that hash it was created for, so a message
// that went out clean keeps staying clean even when an identical later twin earns a block (changing already-sent
// bytes is what kills the provider's prompt cache). Values may be plain strings (nth = 1) or { text, nth }. What stands
// for the session said since its system prompt went out (`standingSlot`), the results of memory calls (`toolSlot`) and a
// session loaded onto a message (`loadSlot`) go after the message's own block, in that order, on the copy of its words
// they were placed on — each placement in a slot in the order it came
// (`placementOf`). `kinds`: the kinds of block placed again, null for every kind — a placement of another kind is passed
// over where it stands in its slot, and the placements after it there are placed all the same. `placedOut`: told each
// block placed again, its text and kind (e2).
/**
 * @param {string} format @param {any} body @param {any} blocksByHash @param {any} [scan] @param {Set<string> | null} [kinds]
 * @param {{ text: string, kind: string }[] | null} [placedOut]
 */
export function reattachBlocks(format, body, blocksByHash, scan = null, kinds = null, placedOut = null) {
  let n = 0;
  if (!blocksByHash) return n;
  /** A block placed again, told to `placedOut` (the memory plan's e2: what the session has in view). @param {string} text @param {string} kind */
  const told = (text, kind) => {
    placedOut?.push({ text, kind });
    return true;
  };
  const at = (h) => {
    const v = typeof blocksByHash.get === "function" ? blocksByHash.get(h) : blocksByHash[h];
    return v == null ? null : typeof v === "string" ? { text: v, nth: 1 } : v;
  };
  /** Whether a block of this kind is placed again. @param {string} kind */
  const placed = (kind) => !kinds || kinds.has(kind);
  /**
   * The blocks in the slots of the nth copy of a message's words, at index i: what stands, the results of memory calls,
   * then loads, each placement in its order. @param {number} i @param {string} h @param {number} nth
   */
  const slotted = (i, h, nth) => {
    let added = 0;
    for (const [slot, kind] of [[standingSlot(h, nth), GOAL_BLOCK_KIND], [toolSlot(h, nth), "tool"], [loadSlot(h, nth), "load"]])
      for (let k = 1; ; k++) {
        const b = at(placementOf(slot, k));
        if (!b) break;
        if (nth === (b.nth || 1) && placed(b.kind || kind) && applyUserBlock(body, i, b.text, b.kind || kind) && told(b.text, b.kind || kind)) added++;
      }
    return added;
  };
  const entries = typeof blocksByHash.get === "function" ? [...blocksByHash.entries()] : Object.entries(blocksByHash);
  // With no stored block to place again there is nothing to re-attach, so the whole walk — and every hash in it — is
  // skipped. On a fresh chain that is the common case, and it used to cost a sha256 per user message to discover there
  // was nothing. A block kept as a bare string is a message's own (`turn`); one with no kind is its slot's.
  const kindAt = (/** @type {string} */ key, /** @type {any} */ v) =>
    (typeof v === "string" ? null : v.kind) || (key.includes(TOOL_SLOT) ? "tool" : key.includes(LOAD_SLOT) ? "load" : key.includes(STANDING_SLOT) ? GOAL_BLOCK_KIND : "turn");
  if (!entries.some(([key, v]) => v != null && placed(kindAt(key, v)))) return n;
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const seen = new Map();
  // The walk covers every position a stored block may live on: person-speaking user messages AND tool-result legs
  // (deferred memory tool results and rules-that-act reminders attach to legs; P1.1 made legs re-attach too — a
  // block on the wire once and bare on the next request breaks the provider's cached prefix from that message).
  // A user message and a tool leg can never share a hash, so one occurrence counter serves both sets — and a chain
  // that holds no block placed again of a kind placed on a leg (`LEG_KINDS`) has none a leg could take: its walk leaves
  // the legs out and counts every person message all the same. The legs are most of an agent's history: walking them
  // would stringify and hash each on every request, to find nothing.
  const onLegs = entries.some(([, v]) => v != null && typeof v !== "string" && LEG_KINDS.has(v.kind) && placed(v.kind));
  const attachable = onLegs ? isBlockAttachable : isBlockEligibleUser;
  const idx = (onLegs ? scan?.attachIdx : scan?.eligibleIdx) || null;
  if (idx) {
    for (const i of idx) {
      const h = scan.hashAt(i);
      seen.set(h, (seen.get(h) || 0) + 1);
      const e = at(h);
      if (e && seen.get(h) >= (e.nth || 1) && placed(e.kind || "turn") && applyUserBlock(body, i, e.text, e.kind || "turn") && told(e.text, e.kind || "turn")) n++;
      n += slotted(i, h, seen.get(h));
    }
    return n;
  }
  for (let i = 0; i < msgs.length; i++) {
    if (!attachable(msgs[i], format)) continue;
    const h = messageHash(msgs[i]);
    seen.set(h, (seen.get(h) || 0) + 1);
    const e = at(h);
    if (e && seen.get(h) >= (e.nth || 1) && placed(e.kind || "turn") && applyUserBlock(body, i, e.text, e.kind || "turn") && told(e.text, e.kind || "turn")) n++;
    n += slotted(i, h, seen.get(h));
  }
  return n;
}

/**
 * A line that shows a memory, by the id at its head: a turn block's claim or past words (`- [i12 fact · …]`,
 * `- [s:<chain>:<n> · …]`) and a reminder at the moment of action (`- [memory i12 · …]`). An id a line only names — an
 * erratum's replacement in 200 characters, a claim's words citing another — is not shown by it.
 */
const SHOWN_LINE = /^- \[(?:memory )?(i\d+|s:[^\s\]·]+)[ \]]/gm;
/** A memory a memory call's results give, whole: the results' `id` (memory-tools.js `searchResults`). */
const RESULT_ID = /"id":"(i\d+|s:[^"]+)"/g;
/** The claims a topic page among those results carries (the memory plan's f7): its lines end with them, `[i12, i14]`. */
const PAGE_CITES = / \[((?:i\d+, )*i\d+)(?:\]| ·)/g;
/**
 * The memories a session has in view in the blocks placed again on its messages (the memory plan's e2): those a turn
 * block or a reminder at the moment of action shows on a line, and those the results of its memory calls give. A block
 * whose message a compaction took is not placed, so what it showed is not in view.
 * @param {{ text: string, kind: string }[]} placed @returns {Set<string>}
 */
export const idsInView = (placed) => {
  /** @type {Set<string>} */
  const out = new Set();
  for (const b of placed) {
    const re = b.kind === "tool" ? RESULT_ID : b.kind === "turn" || b.kind === "rule" ? SHOWN_LINE : null;
    if (re) for (const m of String(b.text).matchAll(re)) out.add(m[1]);
    if (b.kind === "tool" && String(b.text).includes('"kind":"page"')) for (const m of String(b.text).matchAll(PAGE_CITES)) for (const id of m[1].split(", ")) out.add(id);
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------
// Ranking helpers
// ---------------------------------------------------------------------------------------------------
// Any script's words (the memory plan's c1, words.js): an ASCII text normalizes and splits as `[^a-z0-9]` did; a claim
// in Urdu or Russian keys, compares and echoes by its own words, and one in Chinese or Japanese by its pairs of characters.
const norm = normWords;
const overlap = (a, b) => {
  const A = new Set(segmentsOf(a).filter(segmentCounts));
  const B = new Set(segmentsOf(b).filter(segmentCounts));
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / Math.min(A.size, B.size);
};
const grams = (s, n = 6) => {
  const w = segmentsOf(s);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
};
// What the engine wrote by itself — not Filament, not you: its sleep summaries and model-refresh guesses (`sleep_*`),
// and its regex fragments of other memories (`memoria_*`). Filament owns what is true (HarnessV3-Memory MD-0): none of it
// is served, whatever its score (F12: "Project 'test' at H:\test" was one such guess, applied unchecked).
// Kinds that hold for as long as they stand: never faded for being quiet (HarnessV3-Memory MD-11). An obeyed rule is
// not echoed, and silence is no evidence against it (F4).
const STANDING_KINDS = new Set(["rule", "preference", "convention"]);
// Kinds the autopilot never fades for going unused (MD-11, M5-6): what holds, and how a thing is done here — a
// procedure is served when a task names its goal, and a task that needs it is rarer than one that does not.
const NEVER_FADES = new Set([...STANDING_KINDS, "procedure"]);
// Past words, not claims: a past session's turn as typed, or an engine copy of a turn. Listed apart, as quotes (F5).
const EVIDENCE_KINDS = new Set(["session", "turn"]);
// What an ability held (kind `ability:<name>`): abilities are gone (skills took their place), and what one held is
// kept as it was but recalled nowhere and matched by no new claim.
const oldAbility = (/** @type {string} */ kind) => String(kind || "").startsWith("ability:");
// The kinds a claim is (HarnessV3-Memory MD-3): what the claim browser lists (M6-5). A permission and a quote are kept
// as items too, and shown where they are used.
const CLAIM_KINDS = new Set(["rule", "convention", "preference", "procedure", "decision", "fact", "thread"]);
/**
 * The kinds a model or an agent remembers (the bug report's H4): those its remember tool names. A permission and a
 * quote have their own ways in — the person's Always allow, a session's own words — and an open thread or a convention
 * is the learner's to file. The person and the owner remember any claim.
 */
export const REMEMBERED_KINDS = Object.freeze(["fact", "rule", "preference", "decision", "procedure"]);
const KIND_REFUSAL = "memory: a memory is remembered as ";
/** Whether a remember was refused for its kind: the caller's to fix. @param {string} message */
export const isKindRefusal = (message) => message.startsWith(KIND_REFUSAL);
/** The claim browser's states (M6-5): standing; to review (standing, and flagged, held back or no longer sure); retired. */
export const CLAIM_STATES = Object.freeze(["standing", "review", "retired"]);
/**
 * The claim browser's kinds (M6-5), as a reader looks for them: a pitfall is a claim with a trigger, whatever its kind
 * (M5-D1). @type {Readonly<Record<string, (it: any, card: any) => boolean>>}
 */
const CLAIM_FILTERS = Object.freeze({
  rules: (it) => STANDING_KINDS.has(it.kind),
  howto: (it) => it.kind === "procedure",
  pitfalls: (it, card) => !!card.triggers,
  decisions: (it) => it.kind === "decision",
  facts: (it) => it.kind === "fact",
  threads: (it) => it.kind === "thread",
});
export const CLAIM_FILTER_KEYS = Object.freeze(Object.keys(CLAIM_FILTERS));
// The kinds whose words may name a pitfall (HarnessV3-Memory M5-2): what holds and how to work; never an open thread,
// a quote or a permission.
const TRIGGER_KINDS = new Set(["rule", "convention", "preference", "fact", "decision"]);
// How much a pitfall the miner saw matters (M5-4): how to run the project's own commands, as a convention does.
const SEEN_IMPORTANCE = 0.7;
// The most open threads the learner is shown (M5-5): it says which ones the session finished or worked on.
const OPEN_THREADS_SHOWN = 20;
/** The id a line shows and the tools take back (MD-9): `i<n>` for an archive item. @param {number} id */
export const itemRef = (id) => `i${id}`;
/**
 * How a memory is known, in the words its line shows (MD-9) — written from the model's side of the prompt, where "you"
 * is the model: `user said` (stated or added by the person), `user corrected`, `user confirmed`, `user's words` (their
 * sentence, read as a preference or decision), `inferred` (learned from past sessions, unchecked), `assistant noted`
 * (stored by a model's tool call), `a sub-agent found` (read from a sub-agent's report, or stored by its own tool call,
 * M7-D19), `an agent found` (stored or corrected by an agent outside Filament over MCP, M7-D47), `imported`. An engine
 * row with no item behind it is `imported`.
 * @param {any} it  the archive item, or null
 */
export function trustOf(it) {
  if (it.origin === "person" || it.origin === "owner") return "user said";
  if (it.origin === "correction") return "user corrected";
  if (it.status === "confirmed") return "user confirmed";
  if (it.origin === "capture") return "user's words";
  if (it.origin === "model") return "assistant noted";
  if (it.origin === "subagent") return "a sub-agent found";
  if (it.origin === "agent") return "an agent found";
  if (it.origin === "import") return "imported";
  return "inferred";
}
/**
 * One memory line: a claim with its id, kind, trust and flags; past words with their id and date only. A procedure is
 * never cut short of its steps (M5-6): half a procedure would be followed as if it were all of it.
 */
function memoryLine(it, max) {
  const when = it.when ? ` · ${it.when}` : "";
  const flags = it.flags?.length ? ` · ${it.flags.join(" · ")}` : "";
  return EVIDENCE_KINDS.has(it.kind)
    ? `- [${it.id}${when}] ${clip(it.text, max)}`
    : `- [${it.id} ${it.kind} · ${it.trust || "inferred"}${when}${flags}] ${clip(it.text, it.kind === "procedure" ? Math.max(max, PROCEDURE_CHARS) : max)}`;
}
/**
 * How much of a procedure's goal a query names (M5-6): the share of the goal's identifying words (stemmed lightly, so
 * "releases" and "release" are one) the query holds; 0 below half. A procedure is offered for its goal, never for a word
 * one of its steps shares with the task ("npm" in "fix the npm warning").
 * @param {string} goal @param {string} query
 */
export function goalCover(goal, query) {
  const root = (/** @type {string} */ w) => (w.length > 4 ? w.replace(/(?:ing|ed|es|s)$/, "").replace(/e$/, "") : w);
  const g = [...new Set(identifyingWords(goal).map(root))];
  if (!g.length) return 0;
  const q = new Set(identifyingWords(query).map(root));
  const n = g.filter((w) => q.has(w)).length;
  return n > 0 && n * 2 >= g.length ? n / g.length : 0;
}
/**
 * A block's memories in the order they get its room (M5-6): a procedure first — it is there because the task named its
 * goal, and a task that is one is the one it serves — then the rest in rank order. A line that does not fit is passed
 * over for the next that does.
 * @template {{ kind: string }} T @param {T[]} items @returns {T[]}
 */
/**
 * What a turn waits on while memory works, and the person's way to let it go (HarnessV3-FailurePoints §5.1 item 3):
 * each wait is the turn's phase while it lasts, and its signal ends when the person sends the turn without it.
 * @typedef {(phase: { kind: "recalling" }) => { signal: AbortSignal, end: () => void }} MemoryWaiting
 */
/**
 * How long a turn waits on memory in all — its briefing and its related memory — before it goes on
 * without it: an engine that stopped answering, or a model call that never ends, holds no turn past it. What memory was
 * doing goes on unwaited.
 */
export const MEMORY_WAIT_MS = 60_000;
/**
 * Who let memory's work go: the person (Send without it), or the turn's clock (`MEMORY_WAIT_MS`).
 * @typedef {"person" | "clock"} LetGo
 */
/**
 * Memory's work the turn waits on, said while it runs, until `until` (a time, in ms): the person may send the turn
 * without it, and past `until` the turn goes on without it; either way the work goes on unwaited. → `{ value }`, or
 * `{ letGo }` once let go.
 * @template T @param {MemoryWaiting | null} waiting @param {"recalling"} kind @param {() => Promise<T>} work
 * @param {number} until
 * @returns {Promise<{ value: T } | { letGo: LetGo }>}
 */
async function waitedOn(waiting, kind, work, until) {
  const w = waiting?.({ kind }) || null;
  const running = work();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let clock = null;
  try {
    return await new Promise((resolve, reject) => {
      /** @type {LetGo | null} */
      let gone = null;
      /** @param {LetGo} by */
      const letGo = (by) => {
        gone ??= by;
        resolve({ letGo: gone });
      };
      w?.signal.addEventListener("abort", () => letGo("person"), { once: true });
      clock = setTimeout(() => letGo("clock"), Math.max(0, until - Date.now()));
      running.then(
        (value) => resolve({ value }),
        (e) => {
          // Work let go fails on its own, unwaited.
          if (!gone) reject(e);
        },
      );
    });
  } finally {
    if (clock) clearTimeout(clock);
    w?.end();
  }
}
/** Why memory's work was let go, as a turn's note ends: "the turn was sent without it", or the clock's. @param {LetGo} by @param {number} ms */
const letGoWords = (by, ms) => (by === "clock" ? `memory took longer than ${durationWords(ms)}, and the turn went on without it` : "the turn was sent without it");

const procedureFirst = (items) => [...items.filter((it) => it.kind === "procedure"), ...items.filter((it) => it.kind !== "procedure")];
// Anchors (HarnessV3-Memory M3-3): a gone file, or a symbol the claim names gone from its file, holds the claim back
// from the autopilot; a changed file is a label (M3-D6). Search still shows a held claim, labelled.
const HOLDS = new Set(["gone", "symbol"]);
/** The flags an anchor state puts on a line. @param {{ state: string, symbol?: string } | null} a @returns {string[]} */
const anchorFlags = (a) =>
  !a || a.state === "ok" ? [] : a.state === "changed" ? ["file changed since"] : a.state === "gone" ? ["file gone"] : [`file changed since: no ${a.symbol}`];
/**
 * The flag a question to the user puts on a claim it would retire (M4-6), or on the user's word a later session said
 * otherwise (M6-D16: it holds while asked, and says what the later value is). @param {any} asked  the open question, or
 * undefined @returns {string[]}
 */
const askedFlags = (asked) =>
  !asked
    ? []
    : asked.proposal?.action === "correct"
      ? [`said otherwise later: ${clip(asked.proposal.value || asked.proposal.text, 60)}`]
      : [asked.proposal?.replacement ? `in question: the user is asked if ${itemRef(asked.proposal.replacement)} replaces it` : "in question: the user is asked to retire it"];
/**
 * What a block's flags mean, said once under the block when a line carries one: a changed file (M3-3), how many
 * sessions said a claim (M3-6), a claim the user is asked about (M4-6), and a procedure the dossier lists by its goal
 * (M5-6). @param {{ flags?: string[], byGoal?: boolean }[]} shown
 * @returns {string[]}
 */
function legendOf(shown) {
  const flags = shown.flatMap((it) => it.flags || []);
  return [
    ...(flags.some((f) => f.startsWith("file changed since")) ? ['A line marked "file changed since" names a file that changed after it was recorded: read the file before relying on it.'] : []),
    ...(flags.some((f) => /^✓\d/.test(f)) ? ["✓n: n separate sessions said it."] : []),
    ...(flags.some((f) => f.startsWith("in question")) ? ['A line marked "in question" is one the user has been asked to retire ("@mem inbox"): until they answer, prefer the line named to replace it, or ask them.'] : []),
    ...(flags.some((f) => f.startsWith("said otherwise later")) ? ['A line marked "said otherwise later" is the user\'s word that a later session contradicted: it holds until they answer ("@mem inbox"); where it matters, ask them which is true.'] : []),
    ...(shown.some((it) => it.byGoal) ? ['A "How to" line names a procedure kept for this project: its steps come with a message that asks for it, and filament_memory_search gives them (search its goal).'] : []),
    ...(shown.some((it) => it.page) ? ['A line ending "→ page:<name>" has a topic page, what memory holds on its topic in a few lines: filament_memory_search with "page:<name>" gives it.'] : []),
    ...(shown.some((it) => it.trust === "a sub-agent found") ? ['"a sub-agent found": what a sub-agent of a session reported or stored, unchecked.'] : []),
    ...(shown.some((it) => it.trust === "an agent found") ? ['"an agent found": what an agent outside Filament stored over MCP, unchecked.'] : []),
  ];
}
/**
 * What memory is for, said where the model writes it (the memory plan's d2): what it is for, never how — a rule of how
 * ("record only failures") cut a model's gain from memory by a fifth — and what is derivable from the code is no memory.
 * The briefing's header ends with it where memory's tools are offered, and the remember tool's words carry it.
 */
export const MEMORY_PURPOSE =
  "Later sessions with this user start from what memory holds: keep there what they could not re-read from the code or git — the user's rules, corrections and decisions with their reason, and the pitfalls you hit.";
/** The briefing's line on memory's tools, where they are offered: one sentence, their definitions say the rest (d2). */
const BRIEFING_TOOLS =
  "Memory tools (filament_memory_*): search and sessions find what past sessions hold, load brings one in, remember and correct keep what holds now, close, confirm and forget settle a line by its id — use them when the user refers to past work, when context is missing, or before repeating something the user corrected; a recent session above is named for reference: never load one on your own to pick up its work, only when the user asks for it or tags it.";
/**
 * The briefing's header: leads, never the truth (the owner's of 10-30: "telling it would help agent not take these
 * words as source of truth which could be a disaster"), said first, before a line of it is read; with memory's tools
 * offered, how to fix a line and what memory is for. @param {boolean} toolsNamed
 */
const briefingHead = (toolsNamed) =>
  "Long-term memory (Filament): what past sessions recorded about the user and this project — leads, not the source of truth. Much may have changed since each line was written that memory does not know. Before you act on a line — a file, a function, a setting, a command, the state of the work, what is done or still open — check it against the code, git and the running system now; never build on it unchecked. The user's own rules and preferences are their instructions, not claims: follow them. Each line starts with its id, its kind and how it is known — user said, user corrected or user confirmed (the user's own word), user's words (their sentence, read as a preference or decision), inferred (learned from past sessions, unchecked), assistant noted (stored by an assistant), imported. Do not recite it unprompted; reference it as 'from memory'. When what you find contradicts a memory, trust what you find" +
  (toolsNamed
    ? " and fix the memory by its id: filament_memory_correct(id, text, reason) replaces it (never store a separate 'Correction' note — the old line would stay beside it); filament_memory_confirm(id) when one proved right."
    : ".") +
  " Words from past sessions are quotes, not checked facts." +
  (toolsNamed ? ` ${MEMORY_PURPOSE}` : "");
/** Below this confidence the autopilot leaves a claim out; an explicit search still finds it (M3-D8). */
export const CONFIDENCE_GATE = 0.35;
/**
 * The briefing's blocks and their shares of the room the user's rules and identity leave (the owner's of 10-29): with a
 * task in the first message, recall has what the others leave (36% at least); with none, no recall, and its share
 * goes to the dossier and the project's procedures, whole. The effort's arc comes out of the sessions' share. What can
 * be read from the repository is small — this folder, its newest commit, the other worktrees in one line — and a
 * session's row says what it ended with, not what it left open (the memory plan's e1): the room is the dossier's and
 * recall's, what only memory holds.
 */
export const BRIEFING_SHARES = Object.freeze({
  task: Object.freeze({ standing: 0.08, sessions: 0.14, howTo: 0, dossier: 0.42 }),
  none: Object.freeze({ standing: 0.08, sessions: 0.14, howTo: 0.2, dossier: 0.58 }),
});
/**
 * The lines of the user's word that holds in every project a briefing names at most, and their share of its budget (the
 * memory plan's e1, f5); their kinds — the rules, preferences and conventions of no project are among the user's rules.
 */
const IDENTITY_LINES = 6;
const IDENTITY_SHARE = 0.1;
const EVERYWHERE_KINDS = ["fact", "decision"];
/** The project's recent sessions a briefing names at most, and how much of what each ended with its row says. */
const SESSION_ROWS = 5;
const SESSION_SUMMARY_CHARS = 160;
/** How long a briefing waits on git for where the repository stands; a slower read is let go (the block is left out). */
const STANDING_WAIT_MS = 4000;
/**
 * A brief's share of the session's briefing budget at most (M7-1): the size it had before the briefing grew (10-29) to
 * carry where the repository stands and the recent sessions, which a brief does not.
 */
const BRIEF_TOKENS = 1200;
/**
 * The dossier's sections, in order (M4-7, M5-7): "How to" lists the project's procedures by goal (M5-6); "Pitfalls" holds
 * the claims with a trigger (M5-D1), whatever their kind: what goes wrong here, and the way that works.
 */
export const DOSSIER_SECTIONS = Object.freeze(["What it is", "Conventions and rules", "How to", "Pitfalls", "Key decisions", "Facts", "Current work and open threads"]);
/** The section a claim of each kind goes under when the dossier is rendered from claims (M4-D5). */
const SECTION_OF = Object.freeze({
  convention: "Conventions and rules",
  rule: "Conventions and rules",
  preference: "Conventions and rules",
  procedure: "How to",
  decision: "Key decisions",
  fact: "Facts",
  thread: "Current work and open threads",
});
/** The section a claim goes under when the dossier is rendered from claims: a pitfall under Pitfalls, else by its kind (M5-7). @param {{ kind: string, triggered?: number | boolean }} it */
const sectionOf = (it) => (it.triggered ? "Pitfalls" : SECTION_OF[it.kind]);
/** The most claims a section rendered from claims shows, as the curator's lines a section (M4-7). */
export const SECTION_LINES = 6;
// Topic pages (the memory plan's f7): a page is served with PAGE_SHOWN lines left or more; a search serves one in the
// place of PAGE_HITS claims found or more that its lines rest on, PAGE_SERVED pages at most.
const PAGE_SHOWN = 2;
const PAGE_HITS = 2;
const PAGE_SERVED = 2;
/** A search serves a page where the claims it found are this share of what the page's lines rest on, or the page is no longer than they are: it is worth its words. */
const PAGE_SHARE = 1 / 3;
/**
 * A claim as a topic page was written from it (the memory plan's f7): its id and a hash of its words. A line shows only
 * while each claim it cites is still the one it was written from: an id SQLite gave again once the newest claims were
 * deleted, or words changed in place, is not. @param {{ id: number, text: string }} c @returns {[number, string]}
 */
export const pageSource = (c) => [Number(c.id), sha(String(c.text), 12)];
/** A search's result for a topic page: `covers`, the claims found it stands in for; `shows`, every claim its lines carry. */
const pageHit = (/** @type {any} */ p, /** @type {{ text: string, cites: string[] }} */ b, /** @type {number} */ score, /** @type {string[]} */ covers) => ({
  kind: "page",
  id: `page:${p.slug}`,
  text: b.text,
  score,
  when: dateOf(p.created_at),
  covers,
  shows: b.cites,
});
/** What a quote counts as when it is ranked among claims: words from a past session that nobody checked (M3-D21). */
const QUOTE_CONFIDENCE = 0.5;
/** A turn block carries at most this many quotes, after its claims (M3-6). */
const TURN_QUOTES = 2;
/**
 * How sure memory is of a claim now (HarnessV3-Memory MD-3, M3-D8), computed per request from its record and never
 * stored, in [0, 1]: where it came from, the other sessions that said it, the suspicions on it (a session found it
 * wrong, the memory plan's d4; never on the user's word, which is changed only by asking: M7-D68), whether the turn it
 * came from bears it out (`grounded`, f2), a file that changed under it, and its age by kind (rules, preferences and conventions do not age). An open thread ages from when a
 * session last said it (`lastSaid`, M4-5): one taken up again is fresh.
 * @param {any} it  the claim @param {{ evidence?: number, suspected?: number, grounded?: number, changed?: boolean, lastSaid?: number | null }} [o] @param {number} [now]
 */
export function confidenceOf(it, { evidence = 0, suspected = 0, grounded = 0, changed = false, lastSaid = null } = {}, now = Date.now()) {
  // The agent's own note (`model`) stands with a learned claim: of the claims shown, as many of each were used (the memory
  // plan's d5, measured on a live archive: 14.5% and 14.4%), a sub-agent's or an outside agent's finding a third as many.
  let c =
    it.origin === "correction" ? 1 : speaksForUser(it.origin) ? 0.95 : it.status === "confirmed" ? 0.9 : it.origin === "capture" ? 0.8 : it.origin === "subagent" || it.origin === "agent" ? 0.55 : it.origin === "import" ? 0.4 : 0.6;
  c += Math.min(0.15, 0.05 * evidence);
  // The turn it came from bears it out (the memory plan's f2): as much as a session saying it again.
  if (grounded) c += 0.05;
  if (!userBacked(it)) c -= 0.25 * suspected;
  if (changed) c -= 0.2;
  const days = Math.max(0, (now - (Number(it.created_at) || now)) / 86400000);
  const quiet = Math.max(0, (now - Math.max(Number(it.created_at) || now, Number(lastSaid) || 0)) / 86400000);
  if (it.kind === "thread") c -= (0.1 * Math.max(0, quiet - 7)) / 7;
  else if (it.kind === "fact" || it.kind === "decision") c -= Math.min(0.2, (0.05 * Math.max(0, days - 180)) / 90);
  return Math.max(0, Math.min(1, c));
}
// Use in the dossier (the memory plan's f3). A claim's use rate over its last USE_LAST judged turn showings (a turn's
// related memory, shown where a message names it: a briefing shows the dossier's claims whatever the session is about,
// so its verdicts would weigh a claim down for being in the dossier; and the last few, not a window of days, so the rate
// moves on new verdicts alone - a claim in the dossier is shown in no turn, and a window would let its rate lapse as
// days pass, out of the dossier and back) weighs on its place among the dossier's claims, counted in thirds once
// USE_JUDGED were judged, so its rank moves only when the rate crosses a third: used in a third of them 1.15, in two
// thirds 1.3, less, or judged too seldom to tell, 1. A claim the briefings of
// DOSSIER_UNUSED_SESSIONS sessions showed after it was last used (or ever, if never), each session's replies judged and
// none using it (`judgeBriefing`: every reply of the session, not its first alone), leaves the dossier: search still
// finds it, and a turn's related memory still shows it where a message names it, which is how it comes back - once
// used, the count starts again. No window: a claim the dossier left is in no briefing's dossier, and a window would let
// it age back in a month later. Measured on the live archive (11-07): 15 sessions had a briefing in 30 days; at five,
// 6 claims that may fade would leave (4 facts, 2 decisions), at eight none.
const USE_LAST = 9;
const USE_JUDGED = 3;
export const DOSSIER_UNUSED_SESSIONS = 5;
/** A claim's weight among the dossier's claims by its use rate, in thirds (f3). @param {{ judged: number, used: number } | undefined} u */
export const useWeight = (u) => {
  if (!u || u.judged < USE_JUDGED) return 1;
  const rate = u.used / u.judged;
  return rate >= 2 / 3 ? 1.3 : rate >= 1 / 3 ? 1.15 : 1;
};
/**
 * A claim that keeps its place in the dossier however little it is used (f3): what holds and how a thing is done here
 * (rules, preferences, conventions, procedures: never faded, MD-11), an open thread (work in flight, which expires on
 * its own), the user's word (`userBacked`: said, corrected, captured or confirmed), and a pitfall (fired, followed and kept on its calls, a better signal than a
 * reply's words). @param {any} it @param {boolean} pitfall
 */
const keepsItsPlace = (it, pitfall) => NEVER_FADES.has(it.kind) || it.kind === "thread" || userBacked(it) || pitfall;
/** A claim's relevance weighed by its confidence (M3-D8): a sure claim keeps it, an unsure one keeps half. */
const weighed = (/** @type {number} */ relevance, /** @type {number} */ confidence) => relevance * (0.5 + 0.5 * confidence);
/** The ids a memory may have been shown by (`i<n>`, its engine row's): what the injections log may hold for it. @param {any} item */
const shownRefs = (item) => [itemRef(item.id), ...(item.memory_id ? [item.memory_id, `e:${item.memory_id}`] : [])];
const EVIDENCE_HEAD = "Words from past sessions (quotes, not checked facts):";
/** The turn's recalled claims, under words that say what they are: leads from the past, checked before they are used. */
export const RELATED_HEAD = "Related memory for this message (Filament; claims from past sessions, not the source of truth — check each against the code and the system now before acting on it):";
// How long a session that was shown a memory still hears that it was retired (M1-7).
const ERRATA_DAYS = 14;
// How a merge's status change gives its reason (M4-2): what the merged claim said holds in the survivor's words, so no
// erratum is said of it, by the queue or by a brief.
const MERGED = "merged: says the same as";
// The most errata a brief opens with (M7-D2): the ones the session was shown most recently.
const BRIEF_ERRATA = 10;
/** Who a brief is for (M7-D1), as its head says it. */
const BRIEF_FOR = Object.freeze({ subagent: "a sub-agent", agent: "an agent" });
/**
 * Who found a claim a sub-agent's run or an agent outside Filament gave (M7-D19, M7-D47): the sub-agent's id or the
 * outside agent's client ("cursor"), its type where it is known (the sub-agent's, "MCP" for an agent on /mcp/memory),
 * and its model.
 * @typedef {{ agent: string, type?: string | null, model?: string | null }} Finder
 */
/**
 * A reminder's firing not yet recorded (`remindersFor` with `mark: false`): the claim's row id and the `fired` event's
 * detail, for `noteFired` once its line reached the agent.
 * @typedef {{ id: number, detail: Record<string, unknown> }} Fire
 */
/** The origin a finder's claims get: an outside agent's, else a sub-agent's. @param {Finder} finder */
export const finderOrigin = (finder) => (finder.type === "MCP" ? "agent" : "subagent");
/** What a finder is, by the origin its claims get (M7-D19, M7-D47). */
const FINDER_IS = Object.freeze({ agent: "an agent over MCP", subagent: "a sub-agent" });
/**
 * Who retired a memory, as an erratum says it: the user, Filament, an agent that is a finder by its name and what it is
 * (M7-D47), else an assistant. @param {string} by @param {Finder | null} [finder]
 */
const retiredBy = (by, finder = null) =>
  speaksForUser(by) ? "the user" : filamentRole(by) ? "Filament" : finder ? `${finder.agent}, ${FINDER_IS[finderOrigin(finder)]}` : "an assistant";
/** A stored time as an ISO string, or null. @param {number | null | undefined} t */
const isoAt = (t) => (t ? new Date(t).toISOString() : null);
/** A claim as the port shows it: its id, words, standing and project, and its slot when it has one. @param {any} it */
const claimView = (it) => ({
  id: itemRef(it.id),
  kind: it.kind,
  text: it.text,
  status: it.status,
  trust: trustOf(it),
  project: it.project_id ?? null,
  created: isoAt(it.created_at),
  ...(it.slot ? { slot: it.slot, value: it.slot_value ?? null } : {}),
});
/** Every write says who asks (M2-4): one of the roles, never a default. @param {any} by */
function whoAsks(by) {
  if (!ROLES.includes(by)) throw new Error(`memory: a write needs who is asking (by: ${ROLES.join(", ")}); got ${by}`);
}
/** A write that puts words in a claim: never the curator's (M4-D3), whose words would be nobody's. @param {any} by */
function whoSays(by) {
  whoAsks(by);
  if (by === "curator") throw new Error("memory: the curator never writes a claim's words (HarnessV3-Memory M4-D3)");
}
/**
 * The origin a remembered or corrected claim gets from who asked: a sub-agent's run's own call is its finding
 * (M7-D20).
 * @param {string} by @param {string} users the user's origin @param {Finder | null} [finder]
 */
const originOf = (by, users, finder = null) => (speaksForUser(by) ? users : finder ? finderOrigin(finder) : by === "learner" ? "learner" : "model");
/**
 * A claim the user said, corrected or confirmed (MD-3), or their own words an agent quoted (`capture`): a learned value
 * never replaces it (M2-6), and a rule or preference of it stands in every briefing (M3-6). The words are theirs: since
 * nothing files a claim from a message by its words (the memory plan's d3), "remember: never X" reaches memory as the
 * agent's quoted remember, and it holds the place capture's explicit remember held.
 * @param {any} it
 */
export const userBacked = (it) => speaksForUser(it.origin) || it.origin === "correction" || it.origin === "capture" || it.status === "confirmed";
/**
 * Kinds that are the person's word — how to work, and what they decided: only the person's own words give a learned one
 * that standing (M2-6, MEMR-7). What a session established that they did not say is a fact.
 */
const AUTHORITY_KINDS = new Set(["rule", "preference", "decision"]);
/** One erratum line: the retired memory and, when one replaced it, the replacement. */
function erratumLine(e) {
  if (e.anchor) {
    const what =
      e.anchor.state === "changed"
        ? `${e.anchor.file} changed since it was recorded; read the file before relying on it`
        : e.anchor.state === "symbol"
          ? `${e.anchor.file} no longer has ${e.anchor.symbol}; the memory is held back`
          : `${e.anchor.file} is gone; the memory is held back`;
    return `Memory check: [${e.ref}] "${e.old}" — ${what} (${dateOf(e.at)}).`;
  }
  return `Memory correction: [${e.ref}] "${e.old}" no longer holds${e.nowRef ? ` — now [${e.nowRef}] "${e.now}"` : ""} (${e.by}, ${dateOf(e.at)}).`;
}
const engineWritten = (row) => /^(sleep_|memoria_)/.test(String(row?.source || "")) || row?.tier === "memoria";
/** `replyGrams`: the reply's five-word runs, built once where many items are judged against one reply. */
export function usedInReply(itemText, replyText, replyGrams = null) {
  const g = grams(itemText, 5);
  if (!g.size) return overlap(itemText, replyText) > 0.6;
  const r = replyGrams || grams(replyText, 5);
  for (const x of g) if (r.has(x)) return true;
  return overlap(itemText, replyText) > 0.7;
}
/**
 * A text's words as the judge of a turn's work reads them, in any script: `normWords`' runs of letters, marks and
 * digits, each long enough for its script (`shortestWord`). @param {string} s @returns {string[]}
 */
export const termsOf = (s) =>
  normWords(s)
    .split(" ")
    .filter((t) => t && t.length >= shortestWord(t));
// Recall by meaning (the memory plan's c2, `retrieve`): the engine's rows nearest the person's sentence, from this
// cosine similarity up, their score weighed by DENSE_WEIGHT; the sentence clipped to DENSE_CHARS.
const DENSE_MIN_SIM = 0.45;
const DENSE_WEIGHT = 0.6;
const DENSE_CHARS = 500;
/** Past this, a tool call's string is a file's body, not a command, a path or a pattern: its words are left out. */
const WORK_STRING_CHARS = 2000;
/**
 * The words a turn's tool calls carried (b4) — commands, paths, patterns, an edit's lines — as a set; memory's own tools'
 * calls left out (a search for a memory is no use of it: `creditShownIn` counts what it found).
 * @param {any[]} workMessages @returns {Set<string>}
 */
export function workTermsOf(workMessages) {
  /** @type {Set<string>} */
  const terms = new Set();
  /** @param {any} v @param {number} depth */
  const take = (v, depth) => {
    if (typeof v === "string") {
      if (v.length <= WORK_STRING_CHARS) for (const t of termsOf(v)) terms.add(t);
      return;
    }
    if (depth > 4 || !v || typeof v !== "object") return;
    for (const x of Array.isArray(v) ? v : Object.values(v)) take(x, depth + 1);
  };
  for (const m of workMessages || []) {
    if (m?.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (b?.type === "tool_use" && !/filament_(memory_|recall)/.test(String(b.name || ""))) take(b.input, 0);
  }
  return terms;
}
/**
 * Whether a turn's work bore an item out (b4): a word of it that is rare across memory — a tool's name, a file's, a flag —
 * is among the words its tool calls carried. A rule obeyed in a command and never said in the reply counts.
 * @param {string} itemText @param {Set<string>} terms  `workTermsOf` @param {(term: string) => boolean} rare
 */
export function usedInWork(itemText, terms, rare) {
  if (!terms.size) return false;
  for (const t of new Set(termsOf(itemText))) if (terms.has(t) && rare(t)) return true;
  return false;
}
// The machine's own calendar day, as the pages read a date-only stamp: a UTC date read a session touched after
// midnight east of UTC as yesterday's (HarnessV3-FixRound decision 30).
export const dateOf = (ts) => {
  const d = ts ? new Date(ts) : null;
  return d && !isNaN(d) ? localDay(d) : "";
};
/**
 * The keys of a chain's meta a request's memory pass reads (`prepare`): the environment it runs in, whether a loop's
 * tick made it, whether memory is off for it, its goal, and its briefing's tries and the ids the briefing showed.
 */
const PREPARE_META = Object.freeze(["environment", "internal", "muted", "goal", "goalPinned", "briefingTries", "briefingIds", "briefingSeat"]);

// ---------------------------------------------------------------------------------------------------
// The brain
// ---------------------------------------------------------------------------------------------------
export class MemoryBrain {
  /** A dry run under way (`prepare` with `dryRun`): `archive` is already the stand-in that writes nothing. */
  #dry = false;
  /** How many standing claims hold each word (`rareTerms`), and the claims' stamp it was counted at. @type {{ stamp: string, df: Map<string, number>, most: number } | null} */
  #rare = null;
  /** The engine's vectors are being made again with its model (the service's `reembedEngine`): recall leaves the engine out. */
  reembedding = false;
  // store: MemoryStore or null (archive-only). archive: Archive. getConfig: () => memory config group.
  constructor({
    store = null,
    archive,
    getConfig = () => ({}),
    log = () => {},
    now = () => Date.now(),
    toolDefs = null,
    callModel = null,
    chainFor = null,
    observe = null,
    settingsOf = null,
    chatModelOf = null,
    runOf = null,
    repoState = null,
    mayAsk = () => true,
    pendingLoads = null,
  } = {}) {
    // observe: the observation bus's producer end (M5-4), told what a proxied client's tool calls did; null when memory
    // does not learn. settingsOf: a chain's settings document as every door resolves it (session-settings
    // `resolveChainSettings`, over the whole config), or null. chatModelOf: the model a chat's turns name, by its id (a
    // harness chat's with its effort and its tier, as its turns send it), or null, which leaves the chain's model column.
    // runOf: a request's record by its id (its lineage: the sub-agent a run is, and what launched it, M7-D20), or null.
    // repoState: where a folder's repository stands (adapters/git/standing.js `repoStandingOf`, from the composition
    // root: memory reads no git itself), or null.
    // mayAsk: whether the disk may be asked of a folder a request names, as the folder rules say (from the composition
    // root): a network share they keep out is never asked, and stands in its own project. pendingLoads: the sessions
    // waiting to be loaded, by a chat's key (`@mem load`, a client's header) — the memory service's map — or null.
    Object.assign(this, { store, archive, getConfig, log, now, toolDefs, callModel, chainFor, observe, settingsOf, chatModelOf, runOf, repoState, mayAsk, pendingLoads });
    /** How long a turn waits on memory in all (`MEMORY_WAIT_MS`; tests give a shorter one). */
    this.waitMs = MEMORY_WAIT_MS;
    // Every engine write about an item goes through here (HarnessV3-Memory M2-2); the learner shares it.
    this.outbox = new EngineOutbox({ archive, getStore: () => this.store, log, now });
    // Anchors (M3-3): file reads kept across requests, and the claims already looked at for paths in this process.
    this.anchorCheck = new AnchorCheck();
    this.examined = new Set();
    // The environment check (M3-4): the contradictions already recorded as events in this process.
    this.contestedSeen = new Set();
    this.lastTexts = new Map(); // requestId -> [[id, text]] of what was injected, for use tracking after the reply
    this.deferred = new Map(); // a request's `deferTo` -> text of memory tool results waiting for its next request
    // W3.11 / 3.14: entries expire at 6 h but were only removed when that chain returned. Dead chains leaked forever.
    this.sweepTimer = setInterval(() => this.sweepDeferred(), 60_000);
    this.sweepTimer.unref?.();
  }
  sweepDeferred(now = this.now()) {
    const maxAge = 6 * 3600_000;
    for (const [id, row] of this.deferred) if (!row || now - row.at >= maxAge) this.deferred.delete(id);
  }
  stop() {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    this.outbox.stop();
  }

  // Searches as durable operations (the noisy `search` kind), injected by the server through MemoryService as
  // `brain.onOp` — the same pattern as the other producers. The brain is rebuilt on every memory open, so the
  // recorder is forwarded, not assigned once. The QUERY is user text, so only its length is recorded; the durable
  // fact is how many hits came back and how long it took.
  #op(title, opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break a search */
    }
  }
  /**
   * The memory config for one request: the settings it runs under (HarnessV2 §5.5; on `sit.settings`, a harness
   * session's whole document or the knobs an outside client's session chose — situate) over the global `auto` and
   * `capture`. The knobs they name replace the config's for this request only; `learn` is off when either
   * `memory.learn` or `privacy.learn` says so. `session` carries the two switches that have no global twin (the
   * briefing, the per-turn block), null when the settings state neither. `toolsRefused` names the model that turned
   * the tools off, when one did.
   */
  settingsFor(sit) {
    const s = this.#settingsOf(sit);
    // A model that refused memory's tools, on a request that carries none of its own, is offered none whatever the
    // settings say (HarnessV3-AtHome AH-D1): the refusal is a fact about the model, not a choice (memory-prepare.js).
    const refused = sit?.toolsRefused && s.auto.tools !== false ? sit.toolsRefused : null;
    return refused ? { ...s, auto: { ...s.auto, tools: false }, toolsRefused: refused } : { ...s, toolsRefused: null };
  }
  /** settingsFor's settings, before a model's refusal. @param {any} sit */
  #settingsOf(sit) {
    const { auto, capture } = this.cfg();
    const settings = sit?.settings;
    if (!settings || typeof settings !== "object") return { auto, capture, session: null };
    const doc = settings.memory || {};
    const priv = settings.privacy || {};
    const a = { ...auto };
    if (typeof doc.tools === "boolean") a.tools = doc.tools;
    if (Number.isFinite(Number(doc.turnTokens)) && doc.turnTokens !== null) a.turnTokens = Number(doc.turnTokens);
    if (Number.isFinite(Number(doc.minScore)) && doc.minScore !== null) a.minScore = Number(doc.minScore);
    const c = { ...capture };
    if (doc.learn === false || priv.learn === false) c.learn = false;
    const session =
      doc.briefing != null || doc.turnBlock != null ? { briefing: doc.briefing !== false, turnBlock: doc.turnBlock !== false } : null;
    return { auto: a, capture: c, session };
  }
  cfg() {
    const m = this.getConfig() || {};
    // Memory off (the global switch) is the muted state everywhere: the turns are still recorded, nothing is
    // recalled, offered as a tool or learned — the same meaning the per-session `memory.enabled` knob has.
    const off = m.enabled !== true;
    return {
      off,
      auto: {
        enabled: true,
        mode: "conservative",
        briefingTokens: BRIEFING_TOKENS,
        turnTokens: 300,
        minScore: 0.2,
        tools: true,
        toolIterations: 4,
        cue: true,
        rewrite: false,
        ...(m.autopilot || {}),
        ...(off ? { enabled: false, tools: false, cue: false } : {}),
      },
      capture: {
        turns: true,
        learn: true,
        inputCapChars: 4000,
        excludeClients: [],
        excludeModels: [],
        excludeFolders: [],
        ...(m.capture || {}),
        ...(off ? { learn: false } : {}),
      },
      commands: { enabled: true, prefix: "@mem", ...(m.commands || {}) },
    };
  }
  /** Queue one engine write about an item (M2-2): the outbox sends it off the request path, in order, until it lands. */
  enqueue(itemId, op, args = {}) {
    currentTrace()?.step(`engine ${op} queued`, { note: "the outbox sends it off the request path" });
    return this.outbox.enqueue(itemId, op, args);
  }
  /**
   * An item, with its engine copy queued in the same transaction and its anchors taken (M3-3); a text already on file
   * keeps the copy and the anchors it has.
   */
  addItem(fields, { via = "filament", client = "" } = {}) {
    return this.archive.transaction(() => {
      const r = this.archive.items.add(fields);
      if (!r.deduped) {
        this.enqueue(r.id, "mirror", { via, client });
        this.#anchor(r.id, fields);
        this.#arm(r.id, fields);
      }
      return r;
    });
  }
  /**
   * A claim's triggers from its words (M5-2), as `pitfallsOf` reads them. Kinds that say how to work or what holds
   * have them; an open thread, a quote and a permission do not.
   * @param {number} id @param {{ kind?: string, text: string }} c
   */
  #arm(id, { kind = "", text }) {
    if (!TRIGGER_KINDS.has(kind)) return;
    const rows = pitfallsOf(text);
    if (rows.length) this.archive.triggers.set(id, "words", rows);
  }
  /**
   * The pitfalls a tool call is about to repeat (M5-3): the standing claims of its project, or global, with a trigger
   * on one of the call's shapes, whose words the call carries (M5-D31) and whose right way it lacks. Only an armed
   * trigger fires (M5-D2): the user's word, a confirmed claim, or one another session said again. One held back by its
   * files, or under the confidence gate (M3-6), does not. A trigger with a right way fires on every call that misses
   * it; one without fires once a conversation (M5-D3). Each firing is a `fired` event naming the session, the turn and
   * the shape; a call that then holds the right way in that conversation is a `followed` one (M6-2). A call that holds
   * the right way of a trigger in force where it never fired is a `kept` one (M7-D63), once a conversation: the rule
   * worked with no reminder. A `conversation` is the model context that made the call when it is not the session's own
   * (a sub-agent's id, M7-3): its acts are its session's, on its session's turn, and name it. `mark: false`: a firing
   * is not recorded here but handed back (`fire`), for `noteFired` once its line reached the agent — a coding agent's
   * words may go only at its next step, or never (the review of bcc37fbb7, FabeleHelper's lt_f840c285).
   * @param {{ projectId: string | null, chainId?: string | null, turnId?: number | null, conversation?: string | null, tool: string, input: any, mark?: boolean }} c
   * @returns {{ id: string, text: string, line: string, fire?: Fire }[]}  each claim's line as it rides on the call's result
   */
  pitfallsFor({ projectId, chainId = null, turnId = null, conversation = null, tool, input, mark = true }) {
    const shapes = callShapes(tool, input);
    const rows = shapes.length ? this.archive.triggers.matching(projectId, triggerTool(tool), shapesToMatch(shapes)) : [];
    if (!rows.length) return [];
    const text = callText(tool, input);
    const counts = this.archive.items.eventCounts(rows.map((r) => r.id));
    const check = this.anchorCheck.run();
    /** @type {{ id: string, text: string, line: string }[]} */
    const out = [];
    const fired = new Set();
    const here = conversation || chainId;
    const where = { ...(chainId ? { chain: chainId } : {}), ...(turnId != null ? { turn: turnId } : {}), ...(conversation ? { conversation } : {}) };
    for (const r of rows) {
      if (fired.has(r.id) || !callCarries(tool, input, r.trigger_shape, r.trigger_args)) continue;
      const rec = counts.get(r.id) || { evidence: 0, suspected: 0, lastSaid: null };
      // In force: the user's word or one said again, standing in its files, over the confidence gate. Only such a
      // trigger fires, and only its right way taken unprompted is kept (M7-D63).
      const inForce = () => {
        if (!(userBacked(r) || rec.evidence > 0)) return false;
        const st = this.#standing(r, check, null);
        return st.hold ? false : confidenceOf(r, { ...rec, changed: st.changed }, this.now()) >= CONFIDENCE_GATE ? st : false;
      };
      // The right way: after the reminder said it in this conversation, the reminder followed (M6-2), once a firing;
      // where it never fired, the rule kept with no reminder (M7-D63), once a conversation. A record that it worked
      // (M6-D4), never evidence that it is true.
      if (holdsWay(text, r.trigger_unless)) {
        const last = here ? this.archive.items.lastAct(r.id, here, r.trigger_shape, r.trigger_args) : "none";
        const act = last === "fired" ? "followed" : last === null && inForce() ? "kept" : null;
        if (act)
          this.archive.items.note(r.id, act, {
            by: "filament",
            detail: { ...where, shape: r.trigger_shape, ...(r.trigger_args ? { args: r.trigger_args } : {}), unless: r.trigger_unless },
          });
        continue;
      }
      const st = inForce();
      if (!st) continue;
      if (!r.trigger_unless && here && this.archive.items.firedIn(r.id, here, { bare: true })) continue;
      fired.add(r.id);
      const fire = { id: r.id, detail: { ...where, shape: r.trigger_shape, ...(r.trigger_args ? { args: r.trigger_args } : {}), ...(r.trigger_unless ? { unless: r.trigger_unless } : {}) } };
      if (mark) this.noteFired([fire]);
      out.push({ id: itemRef(r.id), kind: "pitfall", text: r.text, line: `[memory ${itemRef(r.id)} · ${trustOf(r)}${st.flags.length ? ` · ${st.flags.join(" · ")}` : ""}] ${clip(r.text, 300)}`, ...(mark ? {} : { fire }) });
    }
    return out;
  }
  /**
   * Close an open thread whose work is done (M5-5, M7-D64): retired (dismissed) with `done: <because>`, and a `closed`
   * event in the session that finished it, so it is no longer served or said at a call. The user's own thread is
   * theirs to close: a `close` question instead, the thread open until they answer. `finder`: the agent that closed it,
   * named on both events. → `{ asked }` the question, or `{ r }` the status change.
   * @param {any} it  a standing thread
   * @param {{ by: string, because?: string, chainId?: string | null, turnId?: number | null, finder?: Finder | null }} o
   * @returns {Promise<{ asked: { id: number, raised: boolean }, r?: undefined } | { r: any, asked?: undefined }>}
   */
  async #closeThread(it, { by, because = "", chainId = null, turnId = null, finder = null }) {
    const why = clip(String(because || "").trim(), 160) || "the session finished it";
    const where = chainId ? ` (session ${chainId})` : "";
    const reason = `done: ${why}${where}`;
    if (userBacked(it))
      return {
        asked: this.archive.inbox.add({ projectId: it.project_id ?? null, kind: "close", key: `close:${it.id}:${chainId ?? ""}`, itemIds: [it.id], proposal: { action: "retire", id: it.id, reason, chain: chainId }, reason: `${chainId ? `session ${chainId}` : "an agent"} says it is done: ${why}` }),
      };
    const r = await this.setItemStatus(it.id, "dismissed", { by, reason, chainId, finder });
    if (r.ok) this.archive.items.note(it.id, "closed", { by, detail: { ...(chainId ? { chain: chainId } : {}), ...(turnId != null ? { turn: turnId } : {}), ...(finder ? { finder } : {}) } });
    return { r };
  }
  /**
   * An open thread whose work is done, closed by any id a line or a search shows (M7-D64), as the learner closes one:
   * the user's own is asked about; a claim that is no thread is refused in words; one retired already says so.
   * @param {string} id @param {{ by?: string, because?: string, chainId?: string | null, turnId?: number | null, finder?: Finder | null }} [o]
   */
  async closeThread(id, { by = /** @type {any} */ (undefined), because = "", chainId = null, turnId = null, finder = null } = {}) {
    whoAsks(by);
    if (this.resolveRef(id).type === "words")
      return { ok: false, error: `${String(id).trim().slice(0, 60)} is a past session's words, not an open thread: an open thread is a memory with an i-number, as its line or a search result shows it (kind thread)` };
    const c = await this.claimOf(id);
    if ("error" in c) return { ok: false, error: c.error };
    const it = c.item;
    if (it.kind !== "thread") return { ok: false, error: `${itemRef(it.id)} is a ${it.kind}, not an open thread: filament_memory_correct changes it` };
    if (isRetired(it.status)) return { ok: true, id: itemRef(it.id), status: it.status, already: true };
    const shut = await this.#closeThread(it, { by, because, chainId, turnId, finder });
    if (shut.asked) return { ok: true, id: itemRef(it.id), asked: `q${shut.asked.id}`, note: "the user's own thread: they are asked to close it, and it stays open until they answer" };
    return shut.r.ok ? { ok: true, id: itemRef(it.id), status: "dismissed", closed: true } : shut.r;
  }
  /**
   * The open thread a task of a session's graph names (HarnessV4_GraphThreads E28), read only: its id, its words, whether
   * it is the user's own — its close asks them — and its project; or why the id names no open thread, in words.
   * @param {string} id @returns {{ id: string, text: string, own: boolean, project: string | null } | { error: string }}
   */
  threadOf(id) {
    if (this.resolveRef(id).type === "words") return { error: `${String(id).trim().slice(0, 60)} is a past session's words, not an open thread: an open thread is a memory with an i-number, as its line shows it (kind thread)` };
    const n = this.namedItem(id);
    if ("error" in n) return { error: n.error };
    const it = n.item;
    if (it.kind !== "thread") return { error: `${itemRef(it.id)} is a ${it.kind}, not an open thread` };
    if (isRetired(it.status)) return { error: `memory's thread ${itemRef(it.id)} is closed already` };
    return { id: itemRef(it.id), text: String(it.text || ""), own: userBacked(it), project: it.project_id ?? null };
  }
  /**
   * The open threads a tool call touches (M5-5): the project's standing threads anchored to a file the call names, or
   * to a folder that holds one (`callPaths`). Each resurfaces once a conversation (`pitfallsFor`'s), a `fired` event
   * naming the file; one held back by its files, or no longer sure (an open thread ages from when a session last said
   * it, M4-5), does not. A thread needs no second session to resurface (M5-D17): it is said once a conversation, and only
   * on its own file. `mark: false`: as `pitfallsFor`'s.
   * @param {{ projectId: string | null, chainId?: string | null, turnId?: number | null, conversation?: string | null, tool: string, input: any, mark?: boolean }} c
   * @returns {{ id: string, kind: "thread", text: string, line: string, fire?: Fire }[]}
   */
  threadsFor({ projectId, chainId = null, turnId = null, conversation = null, tool, input, mark = true }) {
    const root = projectId && projectId !== NO_PROJECT_ID ? this.archive.getProject?.(projectId)?.cwd : null;
    const paths = root ? callPaths(tool, input, root) : [];
    const rows = paths.length ? this.archive.anchors.ofKind(projectId, "thread").filter((r) => paths.some((p) => withinFolder(p, r.anchor_path))) : [];
    if (!rows.length) return [];
    const counts = this.archive.items.eventCounts(rows.map((r) => r.id));
    const check = this.anchorCheck.run();
    /** @type {{ id: string, kind: "thread", text: string, line: string }[]} */
    const out = [];
    const looked = new Set();
    const here = conversation || chainId;
    for (const r of rows) {
      if (looked.has(r.id)) continue;
      looked.add(r.id);
      if (here && this.archive.items.firedIn(r.id, here)) continue;
      const st = this.#standing(r, check, null);
      if (st.hold || confidenceOf(r, { ...counts.get(r.id), changed: st.changed }, this.now()) < CONFIDENCE_GATE) continue;
      const fire = { id: r.id, detail: { ...(chainId ? { chain: chainId } : {}), ...(turnId != null ? { turn: turnId } : {}), ...(conversation ? { conversation } : {}), file: r.anchor_name } };
      if (mark) this.noteFired([fire]);
      out.push({
        id: itemRef(r.id),
        kind: "thread",
        text: r.text,
        line: `[memory ${itemRef(r.id)} · ${trustOf(r)} · open thread on ${r.anchor_name}${st.flags.length ? ` · ${st.flags.join(" · ")}` : ""}] ${clip(r.text, 300)}`,
        ...(mark ? {} : { fire }),
      });
    }
    return out;
  }
  /**
   * Memory at the moment of action (M5-3, M5-5): the pitfalls a tool call walks into, then the open threads on the files
   * it touches, each as the line that rides on its result. `mark: false`: as `pitfallsFor`'s.
   * @param {{ projectId: string | null, chainId?: string | null, turnId?: number | null, conversation?: string | null, tool: string, input: any, mark?: boolean }} c
   * @returns {{ id: string, kind: "pitfall" | "thread", text: string, line: string, fire?: Fire }[]}
   */
  remindersFor(c) {
    return [...this.pitfallsFor(c), ...this.threadsFor(c)];
  }
  /**
   * The firings `remindersFor` handed back unmarked, recorded now that their lines reached the agent: each a `fired`
   * event, as a marked read writes it. @param {readonly Fire[]} fires
   */
  noteFired(fires) {
    for (const f of fires) this.archive.items.note(f.id, "fired", { by: "filament", detail: f.detail });
  }
  /**
   * The open threads of a project as the learner is shown them (M5-5), so it can say which ones a session finished or
   * worked on: the standing ones, the most recently said first, at most `limit`.
   * @param {string | null} projectId @param {{ limit?: number }} [o] @returns {{ id: string, text: string }[]}
   */
  openThreads(projectId, { limit = OPEN_THREADS_SHOWN } = {}) {
    if (!projectId || projectId === NO_PROJECT_ID) return [];
    const rows = this.archive.items.standing(projectId).filter((it) => it.kind === "thread");
    const counts = this.archive.items.eventCounts(rows.map((it) => it.id));
    const said = (/** @type {any} */ it) => Math.max(Number(it.created_at) || 0, Number(counts.get(it.id)?.lastSaid) || 0);
    return rows
      .sort((a, b) => said(b) - said(a) || b.id - a.id)
      .slice(0, limit)
      .map((it) => ({ id: itemRef(it.id), text: it.text }));
  }
  /**
   * The goals of a project's standing procedures as the learner is shown them (M5-6), so a session that did one again
   * files it under the same goal — the same slot, one way standing — rather than beside it in other words. The newest
   * first, at most `limit`.
   * @param {string | null} projectId @param {{ limit?: number }} [o] @returns {string[]}
   */
  procedureGoals(projectId, { limit = OPEN_THREADS_SHOWN } = {}) {
    if (!projectId || projectId === NO_PROJECT_ID) return [];
    /** @type {Set<string>} */
    const goals = new Set();
    for (const it of this.archive.items.standing(projectId).filter((it) => it.kind === "procedure").sort((a, b) => b.id - a.id)) {
      const g = goalOfProcedure(it.text);
      if (g) goals.add(g);
    }
    return [...goals].slice(0, limit);
  }
  /**
   * What a session did to the open threads it was shown (M5-5), as the learner read it. The ones it finished close: a
   * learned one is retired (dismissed, "done: …", M5-D5) with a `closed` event naming the session; the user's own is
   * asked instead (inbox kind `close`, once a session). The ones it worked on that stay open are said again (evidence:
   * a thread ages from when a session last said it). An id it was not shown, or no open thread of the project, is
   * passed over. → how many closed, were asked about, and were said again.
   * @param {{ projectId: string | null, chainId: string, turnId?: number | null, shown: string[], closed?: any[], still?: any[] }} s
   *   `closed`: `{ id, because }` (or a bare id); `still`: ids
   */
  async settleThreads({ projectId, chainId, turnId = null, shown, closed = [], still = [] }) {
    const out = { closed: 0, asked: 0, still: 0 };
    const pick = (/** @type {any} */ ref) => {
      const id = Number(String(ref ?? "").trim().replace(/^i/i, ""));
      const it = Number.isInteger(id) && shown.includes(itemRef(id)) ? this.archive.items.get(id) : null;
      return it && it.kind === "thread" && it.project_id === projectId && !isRetired(it.status) ? it : null;
    };
    const done = new Set();
    for (const c of Array.isArray(closed) ? closed : []) {
      const it = pick(c && typeof c === "object" ? c.id : c);
      if (!it || done.has(it.id)) continue;
      done.add(it.id);
      const shut = await this.#closeThread(it, { by: "learner", because: c && typeof c === "object" ? c.because : "", chainId, turnId });
      if (shut.asked) out.asked += shut.asked.raised ? 1 : 0;
      else if (shut.r.ok) out.closed++;
    }
    for (const ref of Array.isArray(still) ? still : []) {
      const it = pick(ref);
      if (it && !done.has(it.id) && this.#evidence(it, { chainId, turnId, text: it.text }).filed === "evidence") out.still++;
    }
    return out;
  }
  /**
   * A pitfall the miner saw (M5-4): a command that failed in a session and then worked set up another way. A standing
   * claim of the project, or global, with the same trigger (its shape, words and right way: `sameTrigger`) is said
   * again: evidence, once a session and never from its own (`#evidence`), so another session's sighting arms it
   * (M5-D2). Else it is filed as a learned fact (`fileLearned`: inferred, unarmed) with the trigger seen; a claim on
   * file that says it already takes the evidence, and the trigger when it has none.
   * @param {{ projectId: string, chainId: string, turnId?: number | null, text: string, trigger: import("./triggers.js").Trigger }} s
   * @returns {Promise<{ id: number, filed: string }>}
   */
  async fileSeen({ projectId, chainId, turnId = null, text, trigger }) {
    const same = this.archive.triggers.matching(projectId, trigger.tool, [trigger.shape]).find((r) => sameTrigger({ args: r.trigger_args, unless: r.trigger_unless }, trigger));
    if (same) return this.#evidence(same, { chainId, turnId, text });
    // A claim near in words that has a trigger is another pitfall: had it this one, `same` was it.
    const r = await this.fileLearned({ projectId, chainId, turnId, kind: "fact", text, importance: SEEN_IMPORTANCE }, { via: "filament-observe", alike: (c) => !this.archive.triggers.of(c.id).length });
    const had = r.filed === "added" ? null : this.archive.items.get(r.id);
    if (r.filed === "added" || (had && !isRetired(had.status) && !this.archive.triggers.of(r.id).length)) this.archive.triggers.set(r.id, "seen", [trigger]);
    return r;
  }
  /**
   * Anchor a claim to the files and folders it names under its project's folder (M3-3), as they are now. `saidAt`, when
   * it was said, marks a file modified since as changed from the start (M3-D7). Global claims and quotes have no
   * project folder and no anchors.
   * @param {number} id @param {{ projectId?: string | null, text: string, kind?: string, saidAt?: number | null }} c
   */
  #anchor(id, { projectId = null, text, kind = "", saidAt = null }) {
    this.examined.add(id);
    if (!projectId || EVIDENCE_KINDS.has(kind)) return;
    const root = this.archive.getProject?.(projectId)?.cwd;
    const rows = root ? anchorsFor(text, root, { saidAt }) : [];
    if (rows.length) this.archive.anchors.add(id, rows);
  }
  /**
   * Where a claim's files stand now (M3-3): the worst of its anchors, or null when it has none. A claim not looked at
   * in this process and with no anchors is anchored first, as of when it was said (M3-D12). A state that moved is
   * recorded once (`#anchorMoved`).
   * @param {any} claim @param {ReturnType<AnchorCheck["run"]>} check
   * @returns {{ state: import("./anchors.js").AnchorState, symbol?: string } | null}
   */
  #anchorState(claim, check) {
    let rows = this.archive.anchors.of(claim.id);
    if (!rows.length && !this.examined.has(claim.id)) {
      this.#anchor(claim.id, { projectId: claim.project_id, text: claim.text, kind: claim.kind, saidAt: this.#saidAt(claim) });
      rows = this.archive.anchors.of(claim.id);
    }
    if (!rows.length) return null;
    const now = rows.map((a) => ({ a, ...check(a) }));
    for (const n of now) if (n.state !== n.a.state) this.#anchorMoved(claim, n.a, n);
    return worstOf(now);
  }
  /**
   * An anchor seen in a new state (M3-3): the anchor keeps it, the claim's history gets an `anchor` event (the curator's
   * queue, M4), and the sessions shown the claim in the last `ERRATA_DAYS` hear of it once, at the top of their next
   * turn block — the one that looked included.
   * @param {any} claim @param {any} a  the anchor as stored @param {{ state: string, symbol?: string }} n  as seen now
   */
  #anchorMoved(claim, a, n) {
    this.archive.anchors.setState(claim.id, a.path, n.state);
    const anchor = { file: a.name, state: n.state, ...(n.symbol ? { symbol: n.symbol } : {}) };
    this.archive.items.note(claim.id, "anchor", { by: "filament", detail: { ...anchor, from: a.state } });
    currentTrace()?.step("memory file moved", { memory: itemRef(claim.id), from: a.state, to: n.state });
    if (n.state === "ok") return;
    const chains = this.archive.injections.chainsShown(shownRefs(claim), this.now() - ERRATA_DAYS * 86400000);
    const entry = { ref: itemRef(claim.id), old: clip(claim.text, 160), anchor, at: this.now() };
    for (const c of chains) this.archive.appendMeta(c, "errata", entry, 10);
  }
  /**
   * The anchored claims this session was shown, checked against their files (M3-3), so a move is told this turn.
   * @param {string} chainId @param {ReturnType<AnchorCheck["run"]>} check
   */
  #checkShown(chainId, check) {
    const ids = this.archive.anchors.shownIn(chainId);
    if (!ids.length) return;
    for (const id of ids) {
      const claim = this.archive.items.get(id);
      if (claim && !isRetired(claim.status)) this.#anchorState(claim, check);
    }
  }
  /**
   * A claim's anchors as the port shows them (M3-3): each file or folder, its state now, the symbols it held. Read only:
   * a state that moved is recorded when recall or a session's turn checks it.
   * @param {number} id
   */
  #anchorView(id) {
    const rows = this.archive.anchors.of(id);
    if (!rows.length) return {};
    const check = this.anchorCheck.run();
    return {
      anchors: rows.map((a) => ({
        file: a.name,
        kind: a.kind,
        state: check(a).state,
        ...(a.symbols.length ? { symbols: a.symbols } : {}),
        anchored: isoAt(a.at),
        ...(a.head ? { head: a.head.slice(0, 12) } : {}),
      })),
    };
  }
  storeReady() {
    return (
      !!this.store &&
      (typeof this.store.status !== "function" || !["degraded"].includes(this.store.status().state))
    );
  }

  /**
   * A request's conversation, read once when first asked: its scan (`createConversationScan`), the system text and the
   * project the request works in (`projectOf`).
   * @param {{ format: string, body: any, responsesBody?: any, cwdHint?: string, acpCwd?: string }} req
   */
  #readerOf({ format, body, responsesBody = null, cwdHint = "", acpCwd = "" }) {
    /** @type {{ scan: ReturnType<typeof createConversationScan>, systemText: string, project: ReturnType<typeof projectOf> } | null} */
    let read = null;
    return () => {
      if (!read) {
        const scan = createConversationScan(format, body, responsesBody);
        const systemText = scan.systemText();
        read = { scan, systemText, project: projectOf({ systemText, cwdHint, acpCwd, mayAsk: this.mayAsk }) };
      }
      return read;
    };
  }

  /**
   * Why Memory settings leave a request out, in their words (`capturedOut`) — or null where none of them does. The
   * request is read as `situate` reads it, so a request it left out for them is told situate's own reason.
   * @param {{ format: string, body: any, responsesBody?: any, headers?: Record<string, any>, cwdHint?: string, acpCwd?: string, model?: string }} req
   */
  excludedWhy({ format, body, responsesBody = null, headers = {}, cwdHint = "", acpCwd = "", model = "" }) {
    const read = this.#readerOf({ format, body, responsesBody, cwdHint, acpCwd });
    return this.#capturedFor(this.cfg().capture, { headers, model, read });
  }

  /**
   * `capturedOut` for a request: its own client, model and folder, then, where it names a chat by id
   * (`x-filament-chain`, which only Filament's own calls keep), the chat's (`chatLeftOut`) — a loop's round and its
   * forks, a sub-agent's call, a team's worker and a flow's step go out under Filament's own user-agent, on a model of
   * their own, for the chat that named them, and a chat Memory settings leave out keeps memory out of them all.
   * @param {any} capture @param {{ headers: Record<string, any>, model: string, read: () => { project: any } }} request
   */
  #capturedFor(capture, { headers, model, read }) {
    const own = capturedOut(capture, { client: clientOf(headers), model, place: () => read().project });
    if (own) return own;
    const ref = chainRefOf(headers);
    return ref ? this.chatLeftOut(ref, capture) : null;
  }

  /**
   * Why Memory settings leave a chat out, in their words (`capturedOut`) — or null where none of them does: its client
   * (the harness's for its own chat, a fork of an outside client's chat among them, whose column keeps the client its
   * history came from), the model its turns name (`chatModelOf`) and the folder they name (`#chatPlace`); a team's chat
   * beside another (`mainOf`) is left out with that chat too. Every call made for a chat is left out with it
   * (`#capturedFor`), and so are its sub-agents' brief and what is learned from their reports (`subagentLeftOut`).
   * Nothing is read where no list names anything, and the chat's model only where a model is excluded and its client
   * passed — `model`, where the caller holds the name its turns send already (the page's engine), is not read again.
   * @param {string} chainId @param {any} [capture] @param {string | null} [model]
   * @returns {string | null}
   */
  chatLeftOut(chainId, capture = this.cfg().capture, model = null) {
    if (!capture.excludeClients?.length && !capture.excludeModels?.length && !capture.excludeFolders?.length) return null;
    const head = chainId ? this.archive.chainHead(String(chainId)) : null;
    if (!head) return null;
    const own = this.#chatOut(capture, head, model);
    if (own || head.kind !== "team") return own;
    const main = this.archive.mainOf(head.id);
    const beside = main ? this.archive.chainHead(main) : null;
    return beside ? this.#chatOut(capture, beside) : null;
  }
  /**
   * `capturedOut` for one chat, by its head: the model its turns name read only where it is asked (`model`, given, is
   * not). @param {any} capture @param {{ id: string, project_id: string | null, client: string | null, model: string | null, native: boolean }} head
   * @param {string | null} [model]
   */
  #chatOut(capture, head, model = null) {
    const named = () => (model != null ? model : String((this.chatModelOf ? this.chatModelOf(head.id) : head.model) || ""));
    return capturedOut(capture, { client: head.native ? "harness" : String(head.client || ""), model: named, place: () => this.#chatPlace(head) });
  }

  /**
   * Why Memory settings leave a sub-agent's work out — the brief it is handed, what is learned from its report: the
   * model its calls go out on (`model`, as sent: `agent/<model>` for the loop's), which their own situate leaves out,
   * else the chat it works for (`chatLeftOut`). @param {string} chainId @param {string} [model]
   * @returns {string | null}
   */
  subagentLeftOut(chainId, model = "") {
    const capture = this.cfg().capture;
    const own = model ? capturedOut(capture, { client: "", model, place: () => ({ cwd: "", home: "" }) }) : null;
    return own || this.chatLeftOut(chainId, capture);
  }
  /**
   * Why a chat's turns are its own alone, in words — or null where memory reads them: Memory settings leave the chat
   * out (`chatLeftOut`), or they keep turns out of memory (`capture.turns` off) and the chat is one Filament composes,
   * which keeps its turns as its own record all the same (`turnIntent`). The learner reads none of them either
   * (learn.js `learningOptOut`).
   * @param {string} chainId
   * @returns {string | null}
   */
  turnsAsideWhy(chainId) {
    const out = this.chatLeftOut(chainId);
    if (out) return out;
    if (this.cfg().capture?.turns !== false) return null;
    return this.archive.chainHead(String(chainId))?.native ? "turn capture is off in Memory settings" : null;
  }
  /**
   * Why a turn begun now in a chat is kept apart for good (archive `beginTurn`'s `apart`): its turns are its own alone
   * as it is begun (`turnsAsideWhy`). Settings that could not be read keep it apart all the same.
   * @param {string} chainId @returns {string | null}
   */
  apartWhy(chainId) {
    try {
      return this.turnsAsideWhy(chainId);
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: whether a turn of chat ${chainId} is kept apart could not be read (${String(e?.message || e).slice(0, 120)}); it is kept apart`);
      return "Memory settings could not be read";
    }
  }
  /**
   * Whether a chat's turns are its own alone (`turnsAsideWhy`), so memory reads none of them for another chat or call —
   * a search, the per-turn recall, the sessions a briefing or a cue names, a session list, a load or a grep, a chat one
   * continues. Its turns are kept all the same where Filament composes it (its own record, `situate`'s `keep`). So is one
   * every turn of which was kept apart as it was begun (archive `apartOf`), whatever its settings say now: nothing of it
   * is memory's to read. A chat with some turns kept apart is read without them (`apartToo`). One whose settings could
   * not be read is kept to itself: its turns go nowhere they may not. `seen`: the answers one pass over many chats has
   * had, by chat.
   * @param {string} chainId @param {Map<string, boolean>} [seen]
   * @returns {boolean}
   */
  keptToItself(chainId, seen = undefined) {
    const id = String(chainId || "");
    if (!id) return false;
    const had = seen?.get(id);
    if (had !== undefined) return had;
    let out = true;
    try {
      if (this.turnsAsideWhy(id)) out = true;
      else {
        const a = this.archive.apartOf(id);
        out = a.turns > 0 && a.apart >= a.turns;
      }
    } catch (/** @type {any} */ e) {
      this.log("warn", `memory: whether Memory settings leave chat ${id} out could not be read (${String(e?.message || e).slice(0, 120)}); its turns are read for no other chat`);
    }
    seen?.set(id, out);
    return out;
  }
  /**
   * The title memory gives another chat or call for a session: none where a turn kept apart named it
   * (`meta.namedApart`), whose words it is. @param {{ title?: string | null, meta?: any }} c @returns {string | null}
   */
  titleFor(c) {
    return c?.meta?.namedApart ? null : c?.title || null;
  }
  /**
   * The folder a chat's turns name, and its project's (`projectOf`): the worktree it was checked out into, else its own
   * folder, else its project's.
   * @param {{ id: string, project_id: string | null }} head
   */
  #chatPlace(head) {
    const meta = this.archive.metaOf(head.id, ["tree", "cwd"]) || {};
    const own = meta.tree?.worktree ? String(meta.tree.worktree) : typeof meta.cwd === "string" ? meta.cwd : "";
    const folder = own || (head.project_id ? String(this.archive.getProject(head.project_id)?.cwd || "") : "");
    return projectOf({ cwdHint: folder, mayAsk: this.mayAsk });
  }

  /**
   * Situate a request. Returns null when memory does not apply (housekeeping, internal, excluded, muted). `keep`: the
   * request is a turn of a chat Filament composes, whose turns are that chat's own record — its history is composed from
   * them and its page reads them: one Memory settings leave out is situated all the same, saying why in their words
   * (`leftOut`), and memory's prepare keeps its turn and does nothing else of its own (`prepare`).
   */
  situate({ format, body, responsesBody = null, headers = {}, cwdHint = "", acpCwd = "", model = "", keep = false }) {
    const { capture } = this.cfg();
    const tr = currentTrace();
    const client = clientOf(headers);
    const skip = (why) => {
      tr?.step("memory stays out", { why });
      return null;
    };
    // The cheap opt-outs run BEFORE any walk of the conversation: Filament's own calls, a client that asked memory to
    // stay out, and the exclusion lists. On a 3 MB body, ordering these first is the difference between touching the
    // conversation and not touching it at all.
    if (/^filament-/.test(String(headers["user-agent"] || ""))) return skip("Filament's own internal request");
    // Purpose-tagged calls (engine consolidation, learning, trim slices, the assistant) are Filament's own traffic:
    // they never get situated, chained or captured. The accounting side (memoryFor) reads the same header.
    if (headers["x-filament-memory-purpose"]) return skip("Filament's own internal memory call");
    // A coding agent Filament launched (core/conversation.js `addsNothing`): its turn has memory's work already, so its model calls
    // get none of it again — bare, as Filament's own calls are, never quiet's re-attach.
    if (addsNothing(headers)) return skip("a coding agent's call that asked Filament to add nothing: its turn has memory already");
    // A per-request "memory off" is NOT a bare path: stripping the briefing and the blocks the conversation already
    // carried would break the provider's cached prefix at position 0 and at every blocked message (P1.2 of the
    // 2026-09-19 cache audit). The request goes through prepare in quiet mode instead: re-attach + briefing, no new
    // injection, no capture, no learning. The exclude lists below stay bare — they are privacy boundaries set by the
    // operator, where a break is the point, not a side effect.
    // `tools` is quiet plus the memory tools regardless of the chain's age: an agent-loop tick re-sends a conversation
    // whose memory work the developer's own request already did, and only needs the tools in the model's hands.
    const memHeader = String(headers["x-filament-memory"] || "").toLowerCase();
    const quiet = memHeader === "off" || memHeader === "tools";
    const toolsOnly = memHeader === "tools";
    // ONE pass, memoized for the whole request: the system text, the user-text window, every message hash and the
    // `nth` occurrence counts all come from `scan`, and `prepare` reuses the same object. See createConversationScan
    // for the profile that motivated it. The exclusion lists ask for the folder last (`capturedOut`): the scan is made
    // there, where a folder is excluded and the client and the model passed, else right after them.
    const read = this.#readerOf({ format, body, responsesBody, cwdHint, acpCwd });
    const out = this.#capturedFor(capture, { headers, model, read });
    if (out && !keep) return skip(out);
    if (out) tr?.step("memory stays out", { why: out, note: "the chat keeps its turn: Filament composes its history from it, and memory does nothing else in it" });
    const { scan, systemText, project } = read();
    const idx = newestUserIndex(format, body);
    const newest = idx >= 0 ? personTextAt(body, idx) : "";
    const firstText = scan.firstUserText();
    const userCount = scan.userTextCount();
    const headerId = clientConversationId(headers);
    // A chain named by id continues under its own stored key, whatever conversation header rides along; an unknown
    // id is ignored (said on the trace) rather than minting a chain nobody can find again. Its head is all that is read
    // (every round of every agent names its chain): never its meta, which grows with the chat.
    const chainRef = chainRefOf(headers);
    const byChain = chainRef ? this.archive.chainHead(chainRef) : null;
    // The window's own key (Step 3 D1): where this request was typed, computed BEFORE any x-filament-chain header
    // resolves — the chain's key names the session, not the conversation that typed the turn. The harness names
    // itself, so its window is `harness`; Filament's own machinery (a loop's ticks) has no conversation of its own and
    // stamps no window — decided in prepare, where those turns are already told apart.
    const ownKey = headerId
      ? chainKeyForConversationId(headerId)
      : `f:${sha(`${project.cwd}\n${firstText.slice(0, 2000)}`, 20)}`;
    const key = byChain ? byChain.key : ownKey;
    const keySource = byChain ? "chain" : headerId ? "header" : "fingerprint";
    const window = client === "harness" ? "harness" : ownKey;
    const position = idx < 0 ? "toolLeg" : userCount <= 1 ? "first" : "mid";
    tr?.step("situated", {
      client,
      project: project.name || "none",
      position,
      session: byChain
        ? `the archive chain ${byChain.id} named by the request`
        : headerId
          ? "from the client's conversation id"
          : "fingerprint of folder + first message",
      ...(chainRef && !byChain ? { ignoredChainHeader: "no such chain" } : {}),
      userMessages: userCount,
      newest: idx >= 0 ? "a person speaking" : "a tool result (tool loop leg)",
      systemChars: systemText.length,
    });
    return {
      format,
      body,
      responsesBody,
      headers,
      client,
      model,
      project,
      systemText,
      scan,
      newestIndex: idx,
      newest,
      firstText,
      key,
      keySource,
      window,
      chainRef: byChain ? byChain.id : null,
      position,
      quiet,
      toolsOnly,
      // Why Memory settings leave the request out, in their words, where they do and it is situated all the same
      // (`keep`); null where memory works in it.
      leftOut: out || null,
      // When the request arrived, on the archive's clock: a command's turn, recorded with its answer, began here.
      at: this.archive ? this.archive.now() : Date.now(),
      // Lazy: materializing every user text is exactly what the scan exists to avoid, but older callers (and the
      // `@mem` surface) may still want the full list, so it stays available without being paid for by default.
      get userTexts() {
        return scan.allUserTexts();
      },
    };
  }

  /**
   * A request of a chat Filament composes (`keep`) whose situate failed (`why`), situated from what it names alone — the
   * chat's head, its newest message, its client — so memory's prepare keeps its turn where the archive can write it and
   * does nothing else for it (`missed`). Null for any other request, or one that names no chat Filament composes. The
   * archive failing to read the head throws: it is no read to stand in for.
   * @param {{ format: string, body: any, responsesBody?: any, headers?: Record<string, any>, model?: string, keep?: boolean }} args
   * @param {string} why
   */
  missedSituation({ format, body, responsesBody = null, headers = {}, model = "", keep = false }, why) {
    if (!keep || !this.archive || !Array.isArray(body?.messages)) return null;
    const chainRef = chainRefOf(headers);
    const head = chainRef ? this.archive.chainHead(String(chainRef)) : null;
    if (!head?.native) return null;
    const client = clientOf(headers);
    const idx = newestUserIndex(format, body);
    const memHeader = String(headers["x-filament-memory"] || "").toLowerCase();
    return {
      format,
      body,
      responsesBody,
      headers,
      client,
      model,
      project: { id: head.project_id || NO_PROJECT_ID, name: "", cwd: "" },
      systemText: "",
      scan: null,
      newestIndex: idx,
      newest: idx >= 0 ? personTextAt(body, idx) : "",
      firstText: "",
      key: head.key,
      keySource: "chain",
      window: client === "harness" ? "harness" : head.key,
      chainRef: head.id,
      position: idx < 0 ? "toolLeg" : body.messages.slice(0, idx).some((/** @type {any} */ m) => m?.role === "user") ? "mid" : "first",
      quiet: memHeader === "off" || memHeader === "tools",
      toolsOnly: memHeader === "tools",
      leftOut: null,
      missed: why,
      at: this.archive.now(),
      userTexts: [],
    };
  }

  // The whole pre-request pass. Mutates body/responsesBody. Returns what the record needs.
  /**
   * What a reply could not carry, for the next request at `key` (a request's `deferTo`): its text, and `calls` — each
   * call's id and its part of the text — so the next request says no result a memory exchange it puts back carries.
   * @param {string} key @param {string} text @param {{ id: string, text: string }[] | null} [calls]
   */
  setDeferred(key, text, calls = null) {
    if (key && text) this.deferred.set(key, { text, calls: Array.isArray(calls) && calls.length ? calls : null, at: this.now() });
  }

  /**
   * What this request is to its session (Step 3 D12): "turn" (it opens one), "leg" (it continues one — a
   * tool-loop leg), "compaction" (the client asks its model to summarise), or "none" (quiet, an outside client's with
   * turn capture off, or nobody's session). ONE answer: prepare and alignHistory both call it, so the two never disagree
   * about what a request is.
   * @param {any} sit
   * @returns {"turn" | "leg" | "compaction" | "none"}
   */
  turnIntent(sit) {
    if (!sit || !this.archive || !Array.isArray(sit.body?.messages)) return "none";
    const newest = sit.newestIndex >= 0 ? sit.newest : "";
    // A turn a coding agent began by itself opens one, whatever its message says (HarnessV3-ACP AC3-9), and so does a
    // message typed in a chat Filament composes: Filament compacts those itself, so none of their requests is a client
    // asking its model to summarise.
    if (newest && !sit.ownCycle && !sit.composed && signalsOf(newest).compactionRequest) return "compaction";
    // Turn capture governs memory's capture of an outside client's turns; a chat Filament composes keeps its own turns
    // under it, its record, which memory reads for nothing else while capture is off (`turnsAsideWhy`).
    const { capture } = this.settingsFor(sit);
    if (sit.quiet || (capture.turns === false && !sit.composed)) return "none";
    return sit.newestIndex >= 0 ? "turn" : "leg";
  }

  /**
   * @param {any} sit
   * @param {{ requestId?: string | null, upstream?: string, captureOnly?: boolean, dryRun?: boolean, engine?: any, waiting?: MemoryWaiting | null, opened?: ((turn: { chain: string, n: number | null, turnId?: number, legWork?: any[] }) => void) | null }} [o]
   *   `waiting`: the turn's way to say what memory makes it wait on, and to let that go (`waitedOn`) · `opened`: told the
   *   turn this request runs — the one it opens, or the one its tool-loop leg goes on with — as soon as that is known,
   *   before anything memory waits on: its chain and number (none for a leg of a turn the archive does not hold), and
   *   where the reply is archived on it, its row and a leg's loop so far (`legWork`) — a leg on a branch archives nothing
   */
  async prepare(sit, { requestId = null, upstream = "", captureOnly = false, dryRun = false, engine = null, waiting = null, opened = null } = {}) {
    if (dryRun && !this.#dry) {
      const real = this.archive;
      const noop = () => ({ turnId: null, n: null, isNew: false, id: null, deduped: true });
      // What a meta write gives back is read by one writer alone, the tick's, which falls back to its own copy.
      const none = () => null;
      this.archive = new Proxy(real, {
        get: (t, k) =>
          [
            "beginTurn",
            "setBriefing",
            "setBlock",
            "setMeta",
            "setMetaKeys",
            "setParent",
            "link",
            "addCompaction",
            "setTitle",
            "setState",
            "addWork",
            "finishTurn",
            "rekeyChain",
          ].includes(k)
            ? noop
            : k === "mergeMeta" || k === "appendMeta"
              ? none
              : k === "chainForKey"
                ? // The chain the key names, looked up and left as it is (as `chainFor` does dry): none is made or touched.
                  (/** @type {string} */ key, /** @type {any} */ lookup) => {
                    const id = t.chainIdForKey(key);
                    return id ? t.getChain(id) : { id: "dry", key, turns: 0, meta_json: null, blocks_json: null, briefing: null, project_id: lookup?.project || "none" };
                  }
                : k === "items"
                  ? { ...t.items, add: noop, setStatus: noop, setMemoryId: noop, note: noop }
                  : k === "injections"
                    ? { ...t.injections, add: noop, markUsed: noop }
                    : k === "anchors"
                      ? { ...t.anchors, add: noop, replace: noop, setState: () => false }
                      : typeof t[k] === "function"
                        ? t[k].bind(t)
                        : t[k],
      });
      this.#dry = true;
      try {
        return await this.prepare(sit, { requestId, upstream, captureOnly, dryRun });
      } finally {
        this.#dry = false;
        this.archive = real;
      }
    }
    const { auto, session, toolsRefused } = this.settingsFor(sit);
    const notes = [];
    if (toolsRefused)
      notes.push(
        toolsRefused.said
          ? `memory: tools not offered — ${toolsRefused.model} at ${toolsRefused.upstream} takes no tools (${toolsRefused.said === "operator" ? "its row on the Upstreams page says so" : "its provider's model list says so"})`
          : `memory: tools not offered — ${toolsRefused.model} at ${toolsRefused.upstream} refused them on an earlier request (HTTP ${toolsRefused.status}); Filament remembers that until this upstream's address or type changes, or a restart`,
      );
    const tr = currentTrace();
    const t0 = this.now();
    // The person may send the turn without memory's lookups (`waiting`), and the turn's clock does past `waitMs` in
    // all: once either has, the rest of this request's lookups are not started.
    const waitMs = this.waitMs;
    const until = Date.now() + waitMs;
    /** @type {LetGo | null} */
    let letGo = null;
    /** @template T @param {() => Promise<T>} work @returns {Promise<{ value: T } | { letGo: LetGo }>} */
    const recalled = async (work) => {
      if (letGo) return { letGo };
      const r = await waitedOn(waiting, "recalling", work, until);
      if ("letGo" in r) {
        letGo = r.letGo;
        if (letGo === "clock") tr?.step("memory let go", { ms: waitMs, note: "the turn waited on memory as long as a turn waits, and went on without it" });
      }
      return r;
    };
    // A chat Memory settings leave out (`sit.leftOut`, situated all the same as a turn of a chat Filament composes) keeps
    // its turn — the chat's own record, which its history is composed from and its page reads — and nothing of memory's:
    // nothing is read of the person's words or of the files and environment for memory, no block earlier turns received
    // is placed again, no briefing, goal, cue or memory tool rides, and nothing is recalled, captured or learned. So does a
    // turn of such a chat whose situate or prepare failed (`sit.missed`, why): its turn is kept, and memory does nothing
    // else for it (`missedSituation`, the service's `prepare`).
    const leftOut = sit.leftOut || null;
    const apart = leftOut || sit.missed || null;
    // One look at the files per request (M3-3): the briefing, the turn block and the shown claims share its stats.
    if (!apart) sit.fileCheck ??= this.anchorCheck.run();
    const tick = !!sit.headers?.["x-filament-agent-of"];
    const create = () =>
      this.chainFor
        ? this.chainFor(sit, { dry: dryRun })
        : this.archive.chainForKey(sit.key, chainLookup(sit)); // a brain built without the creator (tests): the archive direct
    const chain = tr ? tr.spanSync("session lookup", create) : create();
    // Of the chain's meta, the keys this pass reads (`PREPARE_META`), not the meta whole: every round of every agent
    // comes here, and the meta grows with the chat. A chain that was there had nothing written to its meta since the
    // lookup, so SQLite takes them out of it as it is now; one born for this request holds the small meta it was born
    // with, read as the lookup read it — its creator may have written its first layer since.
    let meta = chain.isNew ? parse(chain.meta_json) || {} : this.archive.metaOf(chain.id, PREPARE_META) || {};
    // The request's own environment (M3-4): its folder, platform, tools and lockfiles, read once per request.
    if (!apart) sit.env ??= requestEnv({ project: sit.project.id, cwd: sit.project.cwd, systemText: sit.systemText, tools: toolNamesOf(sit.body, sit.responsesBody), environment: meta.environment });
    // A loop's own tick is Filament's request, not the developer's: a chain it opens is marked so the session list (the
    // sidebar's tasks) leaves it out, while the archive keeps it for the run's inspectors.
    if (chain.isNew && tick && !meta.internal) {
      meta = this.archive.mergeMeta(chain.id, { internal: "tick" }) || { ...meta, internal: "tick" };
      this.archive.setChainKind?.(chain.id, "tick"); // the typed column the list filters on (HarnessV2 D4)
    }
    if (tr) {
      const last = tr.steps[tr.steps.length - 1];
      if (last?.name === "session lookup")
        Object.assign(last, {
          session: chain.id,
          new: !!chain.isNew,
          turnsSoFar: chain.turns || 0,
          muted: meta.muted ? true : undefined,
          briefingStored: chain.briefing ? true : false,
        });
    }
    let turn = null;
    /** The loop so far on a tool-loop leg, for the turn's work (HarnessV2 F6). @type {any[]} */
    let legWork = [];
    // The person's words say what they ask for; the message of a turn a coding agent began by itself is Filament's: no
    // word of it is looked up by.
    const personSpoke = sit.newestIndex >= 0 && !sit.ownCycle && !apart;
    const signals = personSpoke ? signalsOf(sit.newest) : { keywords: [], entities: [] };
    if (signals.afterCompaction && sit.position === "first") sit.position = "afterCompaction";
    tr?.step("signals read", {
      position: sit.position,
      signals:
        Object.entries(signals)
          .filter(([k, v]) => v === true)
          .map(([k]) => k)
          .join(", ") || "none",
      keywords: (signals.keywords || []).length,
      codeTokens: (signals.entities || []).length,
      // What memory would search for: none where it reads nothing of the person's words (`apart`) — the trace rides the
      // request's record, which others read.
      query: sit.newestIndex >= 0 && !apart ? safeQuery(queryOf(sit.newest, { max: 16 })) : undefined,
    });
    // What this request is to its session, asked once (D12): prepare and alignHistory share the one answer, so the two
    // cannot disagree about what a request is.
    const intent = this.turnIntent(sit);
    if (intent === "compaction") {
      // the client asks its model to summarise the conversation: nothing to inject, the reply becomes a compaction. Its
      // tools are as every request of the session has them (`toolsOffered`): the request carries the whole
      // conversation, and a tools section changed under it makes the provider read all of it uncached.
      tr?.step("compaction request", {
        note: "the client asks its model to summarise; nothing new is added, the summary is archived afterwards",
      });
      const blocks0 = this.archive.blocksFor(chain.id);
      /** @type {{ text: string, kind: string }[]} */
      const placed0 = [];
      reattachBlocks(sit.format, sit.body, blocks0, sit.scan, null, placed0);
      const carried0 = !!carriedBriefing(placed0);
      const seated0 = !!chain.briefing && this.briefingSeated(sit, chain, meta, chain.briefing, carried0);
      if (seated0 && !carried0) applySystemBlock(sit.format, sit.body, sit.responsesBody, chain.briefing);
      this.applyGoal(sit, meta, chain.id, null);
      return {
        chain: chain.id,
        chainKey: sit.key,
        turn: null,
        turnN: null,
        newTurn: false,
        project: sit.project.id,
        client: sit.client,
        position: "compaction",
        signals: { compactionRequest: true },
        briefing: 0,
        injected: 0,
        tokens: 0,
        ids: [],
        tools: toolsOffered({ auto, meta, sit, chain, blocks: blocks0, captureOnly }),
        cue: null,
        notes: [
          "memory: this is the client's compaction request; the summary it produces is archived as a compaction",
        ],
        // The summary stands for the turns up to the newest that finished, by its number: a turn that never ended is
        // none it holds, and finished turns counted would fall short of it.
        compaction: { chainId: chain.id, fromTurn: 1, toTurn: this.archive.newestTurnN(chain.id, { ended: true }), window: tick ? null : sit.window || null },
        ms: this.now() - t0,
      };
    }
    /**
     * Why the turn this request opens is kept apart for good, where it is (archive `apart`): Memory settings leave the
     * chat out, or turn capture is off in a chat Filament composes. Memory's own work reads none of it — no correction
     * marked from its words, nothing learned.
     * @type {string | null}
     */
    let turnApart = null;
    if (intent === "turn") {
      turnApart = leftOut || this.apartWhy(chain.id);
      // A turn typed in a window (Step 3 D4): Filament's own machinery (a loop's tick) was typed in none, so it stamps
      // no window — a per-request fingerprint would litter the chain's window list and trip the shared-session paths
      // for traffic that belongs to no conversation.
      const stamps = {
        window: tick ? null : sit.window || null,
        format: sit.format || null,
        engine,
        // The turn a coding agent began by itself (HarnessV3-ACP AC3-9): whose, and the background tasks it answers.
        own: sit.ownCycle ? { agent: String(sit.ownCycle.agent || ""), tasks: sit.ownCycle.tasks || [] } : null,
        // The page's own name for the send, where a session turn's page named it.
        send: sit.send || null,
        // A thread's brief opens it (core/threads.js): Filament's own, none of the person's to quote.
        brief: sit.brief === true,
        // Who began it where it is not the person (core/turn-by.js): none of theirs to quote.
        by: sit.by || null,
        // This request runs the turn until its record closes (HarnessV3-FailurePoints finding 3).
        running: true,
        // It came alongside its window's turn, or as a second send of a request of it that runs now — as alignHistory
        // told it (`alongside`, `joinsRunning`).
        alongside: !!sit.alongside,
        joinsRunning: !!sit.joinsRunning,
        // The chat's turns are its own alone as it is begun — Memory settings leave it out, or turn capture is off in a
        // chat Filament composes: the turn stays apart for good, whatever its settings say later (archive `apart`).
        apart: turnApart,
      };
      if (sit.alongside) notes.push("memory: this request came while this window's own turn was at work — a turn of its own beside that one, which rewinds nothing of the session's line");
      turn = tr
        ? tr.spanSync("turn archived", () =>
            this.archive.beginTurn(chain.id, {
              requestId,
              model: sit.model,
              upstream,
              client: sit.client,
              ...stamps,
              userMessage: sit.body.messages[sit.newestIndex],
            }),
          )
        : this.archive.beginTurn(chain.id, {
            requestId,
            model: sit.model,
            upstream,
            client: sit.client,
            ...stamps,
            userMessage: sit.body.messages[sit.newestIndex],
          });
      if (turn?.n) opened?.({ chain: chain.id, n: turn.n, turnId: turn.turnId });
      if (tr) {
        const last = tr.steps[tr.steps.length - 1];
        if (last?.name === "turn archived")
          Object.assign(last, {
            turn: turn?.n ?? null,
            new: !!turn?.isNew,
            note: turn?.isNew
              ? "the user's message is stored byte-exact (encrypted archive)"
              : "same message seen before: no new turn",
          });
      }
    } else if (intent === "leg") {
      // A tool-loop leg of a proxied client (HarnessV2 F6): the turn it continues is the one its newest person-speaking
      // message opened; the messages after that one — the loop so far, in the client's own bytes — become the turn's
      // work when the reply lands, and the leg's reply the turn's final (the newest reply is the answer until a later
      // leg replaces it). Cloned now, before blocks re-attach to the body.
      const msgs = Array.isArray(sit.body?.messages) ? sit.body.messages : [];
      let at = -1;
      for (let i = msgs.length - 1; i >= 0 && at < 0; i--) if (isBlockEligibleUser(msgs[i], sit.format)) at = i;
      // The turn this leg continues is this WINDOW's (D1): on a shared session the chain's newest may be another
      // window's, and pinning to it would leave the leg unarchived.
      const leg = at >= 0 ? this.archive.turnForUser(chain.id, msgs[at], { window: tick ? null : sit.window || null }) : null;
      // The leg continues the turn only when its history agrees with the archived loop: the archived work, then the
      // archived final, message for message as far as both go. A client that edited a result or rewound the loop is
      // on a branch; folding it in would put a contradicting message beside the one it replaced and swap the turn's
      // real answer for this leg's reply, so such a leg archives nothing and says so.
      const archived = leg ? this.archive.getTurn(leg.turnId) : null;
      const branch = leg ? contradiction(archived, msgs, at + 1) : null;
      if (leg && !branch) {
        turn = { turnId: leg.turnId, n: leg.n, isNew: false };
        // Only what the archive does not hold yet is cloned and handed on: `contradiction` proved the loop's first
        // messages, as far as the archived work goes, equal to it hash for hash, and `addWork` passes over a hash the
        // turn's work holds. Handing on the whole loop would clone and hash it all again on every leg, a cost growing
        // with each leg of the turn. The note counts the loop so far.
        const loop = msgs.length - (at + 1);
        legWork = structuredClone(msgs.slice(at + 1 + (archived?.work?.length || 0)));
        opened?.({ chain: chain.id, n: leg.n, turnId: leg.turnId, legWork });
        notes.push(`memory: a tool-loop leg of turn ${leg.n} — the loop so far (${loop} message${loop === 1 ? "" : "s"}) is archived as the turn's work, this reply as its final`);
        tr?.step("turn continued", {
          turn: leg.n,
          legMessages: loop,
          note: "a tool-loop leg: the loop so far joins the turn's work when the reply lands, the reply becomes its final",
        });
      } else if (leg) {
        // A leg on a branch runs its turn all the same, its reply archived nowhere: the client's loop ends where it does.
        opened?.({ chain: chain.id, n: leg.n });
        notes.push(`memory: a tool-loop leg that does not continue turn ${leg.n} as archived (message ${branch.at + 1} of the loop differs — the history was edited or rewound); nothing archived for this leg`);
        tr?.step("turn not archived", { why: "a tool-loop leg on a branch of the archived turn", turn: leg.n, differsAt: branch.at });
      } else {
        // So does a leg of a turn the archive does not hold, whose turn has no number here.
        opened?.({ chain: chain.id, n: null });
        tr?.step("turn not archived", {
          why: at < 0 ? "a tool-loop leg with no user message before it" : "a tool-loop leg of a turn this archive does not hold",
        });
      }
    } else
      tr?.step("turn not archived", {
        why:
          sit.newestIndex < 0
            ? "a tool-loop leg of a memory-quiet request"
            : "turn capture is off in Memory settings",
      });
    const out = {
      chain: chain.id,
      // Where what a reply to this request could not carry waits (`setDeferred`): a loop's tick names its own run,
      // since several loops may run on one session at once; any other request, its session.
      deferTo: tick ? `${chain.id}/${sit.headers["x-filament-agent-of"]}` : chain.id,
      chainKey: sit.key,
      turn: turn?.turnId || null,
      turnN: turn?.n || null,
      newTurn: !!turn?.isNew,
      ...(legWork.length ? { legWork } : {}),
      project: sit.project.id,
      client: sit.client,
      position: sit.position,
      signals: Object.fromEntries(
        Object.entries(signals)
          .filter(([k, v]) => v === true)
          .map(([k]) => [k, true]),
      ),
      briefing: 0,
      injected: 0,
      tokens: 0,
      ids: [],
      tools: false,
      cue: null,
      notes,
      muted: !!meta.muted,
      ms: 0,
      // What memory's standing blocks weigh on this request, in estimated tokens (the record's composition, harness
      // plan B8): the briefing and the goal block at the end of the system prompt. `tokens` above is the per-turn
      // material (recall, blocks, the briefing on the turn it was built).
      composition: { briefing: 0, goal: 0 },
      // The goal in force for the request, where memory gave it one (the system prompt's pin and what the person's
      // messages said since): its block, "" for none; null where memory gave the request no goal at all. A coding agent
      // is handed it as its session's standing goal (agent-context.js).
      goalInForce: /** @type {string | null} */ (null),
      // The briefing in force for the request, where memory gave it one, in the system prompt or on the message it rides
      // (`briefingSeated`): "" for none, null where memory gave the request none at all. A coding agent is handed it as
      // its session's standing briefing.
      briefingInForce: /** @type {string | null} */ (null),
    };
    // A chat Memory settings leave out has its turn kept, and that is all: the turn's agent hears nothing of memory's
    // either (`silent`), and what earlier turns received before it was left out is not placed again — the exclusion is
    // a boundary the person set, where a cache that breaks is the point; from there on its requests carry nothing of
    // memory's, turn after turn, but the results of its own filament_recall calls (`recall`, below). A turn whose
    // situate or prepare failed (`missed`) is kept so, that turn alone.
    /**
     * The turn that launched a sub-agent whose call this is, where its pictures are kept (HarnessV4_Visuals_Plan VS-D48)
     * whether memory works in the chat or not: what memory does with that turn is read from `silent`. Undefined for any
     * other call.
     */
    const launchTurnOf = () => (sit.headers?.["x-filament-subagent"] ? this.archive.turnOfRequest(chain.id, sit.headers["x-filament-subagent-of"] || null) : undefined);
    /** @param {typeof out} o */
    const keptApart = (o) => {
      o.silent = true;
      if (leftOut) o.leftOut = leftOut;
      else o.missed = sit.missed;
      // A call Filament's machinery makes for the chat (a loop's tick, a sub-agent's call) opens no turn, and is
      // memory-quiet as such a call is in any chat: its reply is the turn's to keep, not its own.
      if (sit.quiet) o.quiet = true;
      // A sub-agent's pictures are kept on the turn that launched it, as in any chat (`launchTurnOf`).
      const launched = launchTurnOf();
      if (launched !== undefined) o.launchTurn = launched;
      notes.push(leftOut ? `memory: ${leftOut} — the chat keeps its turns, and memory adds nothing to it` : `memory: skipped (${sit.missed}) — the chat keeps the turn, and memory adds nothing to it`);
      tr?.step("autopilot stops here", { why: leftOut ? `${leftOut}: the chat keeps its turns, nothing of memory's rides it` : `${sit.missed}: the chat keeps the turn, nothing of memory's rides it` });
      o.ms = this.now() - t0;
      return o;
    };
    if (apart && !leftOut) return keptApart(out);
    // Re-attach what earlier turns received, always (cache stability), even when muted.
    // A block is stored per message hash, uncapped: trimming it would change history the provider already cached.
    const blocks = this.archive.blocksFor(chain.id);
    // Session-id rotation: a new chain over the same conversation bytes. The most recent sibling chain of this
    // project that has blocks lends them for RE-ATTACHMENT ONLY (nothing is written back), so the history the
    // provider already saw stays byte-identical (P2 of the 2026-09-19 cache audit). The briefing is NOT adopted —
    // it stays per-chain. Chains closed by `@mem new` (key carries `#closed-`) never lend: a fresh start was asked for.
    // Nor does the harness's own chat (`native` — its forks, and an import the person goes on with there, among them;
    // `n:` a fork whose making has not marked it yet): no session is shared between a client and the harness, so none
    // is a client conversation's earlier self.
    if (!leftOut && chain.isNew && !Object.keys(blocks).length && sit.project.id !== "none") {
      for (const sib of this.archive.recentHeads(50)) {
        if (
          sib.id === chain.id ||
          sib.project_id !== sit.project.id ||
          String(sib.key || "").includes("#closed-") ||
          String(sib.key || "").startsWith("n:") ||
          this.archive.chainHead(sib.id)?.native
        )
          continue;
        const sb = this.archive.blocksFor(sib.id);
        if (Object.keys(sb).length) {
          Object.assign(blocks, sb);
          tr?.step("blocks adopted from a sibling session", {
            from: sib.id,
            blocks: Object.keys(sb).length,
            note: "the client's session id rotated; re-attachment borrows the sibling's blocks, nothing is copied or rewritten",
          });
          break;
        }
      }
    }
    // Store a new block for this request's target message; nth = which duplicate of that text it is, so an
    // earlier identical message that went out clean stays clean on every resend.
    // `nth` = which duplicate of this exact client message it is, so an earlier identical message that went out
    // clean stays clean on every resend. It used to be a fresh full walk with a fresh hash of every message, PER
    // BLOCK STORED — k blocks meant k·n hashes. The scan already holds both the eligibility list (frozen before any
    // mutation, which is what `nth` must be counted against) and the per-index hashes, so this is now a map lookup.
    // A block placed on a person message is counted among the person messages (`nthOf`'s `legs: false`): the same count.
    // The message that ends the person's request, found where it stands now: a system prompt memory adds to a chat body
    // that had none goes before every message (`applySystemBlock`), and an index taken before would name the one before it.
    const newestMsg = sit.newestIndex >= 0 ? sit.body.messages[sit.newestIndex] : null;
    const newestNow = () => (newestMsg ? sit.body.messages.indexOf(newestMsg) : -1);
    // Whether it ends the request: on an OpenAI tool leg the calls' results come after it.
    const atTail = () => !!newestMsg && sit.body.messages.at(-1) === newestMsg;
    /** @param {string} h @param {string} [kind] */
    const nthHere = (h, kind = "turn") =>
      Math.max(1, sit.scan.nthOf(h, { legs: LEG_KINDS.has(kind) }));
    // Kept under the message's hash: what stands, the results of memory calls and a load beside the message's own block
    // (`standingSlot`, `toolSlot`, `loadSlot`), each placed after the ones its slot holds already, under a key of its own
    // (`placementOf`).
    const putBlock = (h, text, kind = "turn") => {
      const nth = nthHere(h, kind);
      let key = h;
      if (kind === "load" || kind === "tool" || kind === "recall" || STANDING_BLOCKS.has(kind)) {
        const slot = kind === "load" ? loadSlot(h, nth) : STANDING_BLOCKS.has(kind) ? standingSlot(h, nth) : toolSlot(h, nth);
        let k = 1;
        while (blocks[placementOf(slot, k)]) k++;
        key = placementOf(slot, k);
      }
      blocks[key] = { text, nth, kind };
      this.archive.setBlock(chain.id, key, text, nth, kind);
    };
    /**
     * The block a message's copy carries already in a slot after the one being placed, as it went out — what stands, the
     * results of memory calls, then a load — which a block placed now goes before, where every later request puts it;
     * null for none.
     * @param {string} h @param {"own" | "standing" | "tool"} placing
     */
    const laterBlock = (h, placing) => {
      const later = [standingSlot(h, nthHere(h, GOAL_BLOCK_KIND)), toolSlot(h, nthHere(h, "tool")), loadSlot(h, nthHere(h, "load"))];
      for (const key of later.slice(placing === "own" ? 0 : placing === "standing" ? 1 : 2)) {
        const b = blocks[key];
        if (b) return memoryBlock(b.kind || (key.includes(TOOL_SLOT) ? "tool" : key.includes(STANDING_SLOT) ? GOAL_BLOCK_KIND : "load"), b.text);
      }
      return null;
    };
    /**
     * The goal said on the person's message where it is not the one the request gives the model already — the goal the
     * system prompt carries (`applyGoal`, pinned at the chat's newest compaction), or the newest goal note the history
     * it sends carries (`goalOfNote`): accepted, its slice rewritten or closed since. Said once, on the person's newest
     * message — a client's own system message after it changes nothing — and kept beside its own block: every later request sends it again where it went out, and one
     * whose history lost that message (rewound, or sent again with other words) says it anew. A loop's tick, a quiet
     * request and a tool leg say nothing — the person's next message says it. Answers what it weighs.
     */
    const tellGoal = () => {
      if (captureOnly || sit.quiet || !newestMsg) return 0;
      const now = goalNow(meta.goal);
      let told = String(meta.goalPinned?.[windowOf(sit)]?.text || "");
      for (const b of placedAgain) if (b.kind === GOAL_BLOCK_KIND) told = goalOfNote(b.text);
      if (now === told) return 0;
      const t = goalNoteText(meta.goal, told);
      const h = sit.scan ? sit.scan.hashAt(sit.newestIndex) : messageHash(newestMsg);
      if (applyUserBlock(sit.body, newestNow(), t, GOAL_BLOCK_KIND, laterBlock(h, "standing"))) putBlock(h, t, GOAL_BLOCK_KIND);
      notes.push(`memory: the goal ${now ? (told ? "changed" : "is active") : "was closed"} — said on this message; the system prompt keeps the goal it went out with`);
      tr?.step("goal said on the message", { note: "changed since the system prompt went out; the system prompt takes it at the next compaction" });
      return est(t);
    };
    // A chat Memory settings leave out has placed again what was placed in it while it was left out alone — the results of
    // its filament_recall calls (`recall`) — so its bytes stay what they went out as, and nothing memory placed before:
    // each where it stands among the placements of its slot, those before it passed over.
    const placing = leftOut ? RECALL_ONLY : null;
    /** @type {{ text: string, kind: string }[]} */
    const placedAgain = [];
    const reattached = reattachBlocks(sit.format, sit.body, blocks, sit.scan || null, placing, placedAgain);
    // What the session has in view already — the memories its earlier turn blocks, reminders and memory calls showed, on
    // messages it still sends — a new turn block does not say again (the memory plan's e2); a compaction that took those
    // messages takes them out of view, and they may be said again.
    const inView = idsInView(placedAgain);
    if (reattached)
      notes.push(
        `memory: re-attached ${reattached} earlier block${reattached === 1 ? "" : "s"} so the model sees the same history`,
      );
    tr?.step("earlier blocks re-attached", {
      blocks: reattached,
      stored: placing ? Object.values(blocks).filter((b) => placing.has(b?.kind)).length : Object.keys(blocks).length,
      note: "byte-identical, so the provider's prompt cache survives",
    });
    // Memory tool results a mixed reply left for this request: attached to the newest message (a tool-result leg,
    // usually), quiet or muted as the request may be — they answer the model's own calls, and a loop's next tick is the
    // only request its model reads them in (the bug report's H14). Expired entries are dropped: a chain that never
    // sends again should not hold the text forever. In a chat Memory settings leave out they are the results of its
    // filament_recall calls, placed as such (`recall`).
    const deferredRow = captureOnly ? null : this.deferred.get(out.deferTo);
    if (deferredRow) {
      this.deferred.delete(out.deferTo);
      const fresh = this.now() - deferredRow.at < 6 * 3600_000;
      // A result the memory exchange this request puts back carries already — a round before a failed follow-up, which
      // the client's merged message brings back (pipeline/stages/withheld.js) — rides no deferral: each reaches the model
      // once, and a request that puts nothing back is told every one. The exchange carries the earliest rounds, so of the
      // results under one id, those of the earliest rounds are the ones it carries (`deferMemoryResults` keeps them in
      // the rounds' order).
      const carried = fresh && deferredRow.calls && !sit.responsesBody ? carriedByPutBack(sit.format, sit.body.messages, this.archive) : null;
      const left = new Map(carried || []);
      const deferred = !fresh
        ? null
        : carried?.size
          ? deferredRow.calls
              .filter((/** @type {any} */ c) => {
                const n = left.get(c.id) || 0;
                if (n) left.set(c.id, n - 1);
                return !n;
              })
              .map((/** @type {any} */ c) => c.text)
              .join("\n\n")
          : deferredRow.text;
      if (deferred) {
        const idx = sit.body.messages.length - 1;
        const last = sit.body.messages[idx];
        if (last && last.role !== "assistant") {
          const h = sit.scan ? sit.scan.hashAt(idx) : messageHash(last);
          const t = `Results of the memory tools the model called in its previous reply (Filament):\n${deferred}`;
          // Beside the message's own block — never in its place — after the results it carries already and before a load
          // it carries, kept as it went out: in a chat Memory settings leave out, as the results of its filament_recall calls.
          const kind = leftOut ? "recall" : "tool";
          if (applyUserBlock(sit.body, idx, t, kind, laterBlock(h, "tool"))) {
            putBlock(h, t, kind);
            // On the person's message, beside the turn block this request may add: what they give is in view (e2).
            for (const id of idsInView([{ text: t, kind }])) inView.add(id);
          }
          out.tokens += est(t);
          notes.push("memory: results of the model's memory tool calls attached to this message");
          tr?.step("deferred tool results attached", {
            tokens: est(t),
            note: "the model mixed memory tools with the client's tools last reply; the memory results ride along now",
          });
        }
      }
    }
    if (leftOut) return keptApart(out);
    if (meta.muted || auto.enabled === false || captureOnly || sit.quiet) {
      // Memory says nothing new into this request, and the agent loop it starts keeps to the same: no reminder rides a
      // call's result and no call is told to the miner (M6-7), as a proxied client's legs get neither past this point.
      // A sub-agent's run (Filament's own: the header is house-only) is quiet — its brief opened it — but it is the
      // session's own work (M7-D3): where the session's memory is on, its calls get their reminders and teach the miner,
      // on the turn that launched it.
      const ownWork = !!sit.headers?.["x-filament-subagent"] && !meta.muted && auto.enabled !== false;
      out.silent = !ownWork;
      // The turn that launched it is where its pictures are kept (`launchTurnOf`).
      const launched = launchTurnOf();
      if (launched !== undefined) out.launchTurn = launched;
      // Its calls are said and told as its own conversation's (M7-3): a reminder said to the developer's loop is still
      // said to it, and a failure of one is never paired with a call that worked in the other.
      if (ownWork) out.conversation = String(sit.headers["x-filament-subagent"]);
      // A loop's own tick files what its memory tools write on the turn of the loop it belongs to (M7-D20): the
      // developer's request's, or, when the run it is a tick of is a sub-agent's, the turn that launched it, named for
      // the sub-agent.
      const run = tick ? this.runOf?.(sit.headers["x-filament-agent-of"]) || null : null;
      if (tick) {
        out.loopTurn = this.archive.turnOfRequest(chain.id, run?.subagent ? run.subagentOf || null : sit.headers["x-filament-agent-of"]);
        if (run?.subagent) out.finder = { agent: String(run.subagent), model: sit.model || null };
      }
      // A briefing built earlier keeps riding (the system prompt the provider cached) unless the session's document
      // says `memory.briefing: false` — then it goes, and the cache miss is the developer's choice. One the chat's system
      // prompt went out without rides the message it was built on, placed again with the history (`briefingSeated`).
      const keepBriefing = !!chain.briefing && !captureOnly && !(session && !session.briefing);
      // A sub-agent's run, or a tick of one: a conversation of its own, which the person's messages never reach — it is
      // given what stands as its first request found it (`runStanding`).
      const subagent = sit.headers?.["x-filament-subagent"] || run?.subagent || null;
      const runStood = subagent && !captureOnly ? this.runStanding(chain.id, String(subagent), meta, keepBriefing ? chain.briefing : "") : null;
      // One a message of the history carries already stays there alone (`carriedBriefing`).
      const carried = carriedBriefing(placedAgain);
      const seated = keepBriefing && this.briefingSeated(sit, chain, meta, chain.briefing, !!carried);
      const briefingHere = runStood ? runStood.briefing : seated && !carried ? chain.briefing : "";
      const placeBriefing = !!briefingHere;
      tr?.step("autopilot stops here", {
        why: sit.toolsOnly
          ? "a loop's own tick (x-filament-memory: tools) — the developer's request did memory's work; only the tools are offered"
          : sit.quiet
            ? "the client sent x-filament-memory: off — nothing is recalled or recorded; the history already sent stays byte-identical, and the session's standing blocks (briefing, goal) still ride"
            : meta.muted
            ? "this chat asked memory to stay out (@mem off)"
            : auto.enabled === false
              ? this.cfg().off
                ? "memory is off in Memory settings — the turn is recorded, nothing is recalled"
                : "autopilot is off in Memory settings"
              : "a coding agent: its turns are archived, it gets memory through Filament's MCP server",
        briefingReplaced: placeBriefing ? true : undefined,
      });
      if (placeBriefing) {
        applySystemBlock(sit.format, sit.body, sit.responsesBody, briefingHere);
        out.composition.briefing = est(briefingHere);
      } else if (chain.briefing && !captureOnly && !keepBriefing) notes.push(`memory: no briefing — the session turned it off (${carried ? "the one an earlier message carries stays there, as it went out" : "one built earlier is not placed"})`);
      if (!captureOnly) {
        out.composition.goal = this.applyGoal(sit, meta, chain.id, runStood) + tellGoal();
        if (out.composition.goal) out.goal = true;
        out.goalInForce = goalNow(meta.goal);
        out.briefingInForce = keepBriefing ? carried || (seated ? chain.briefing : "") : "";
      }
      out.tools = toolsOffered({ auto, meta, sit, chain, blocks, captureOnly });
      if (sit.quiet) {
        out.quiet = true;
        // A tick whose model takes no tools, or refused them, is offered none either: the line above says why.
        notes.push(
          sit.toolsOnly
            ? `memory: a loop's own tick — the developer's request already did memory's work; ${out.tools ? "only the tools are offered, " : ""}nothing of memory's own is added or recorded`
            : "memory: the client asked memory to stay out of this request; earlier injections are kept byte-identical, nothing of memory's own is added or recorded",
        );
      }
      out.ms = this.now() - t0;
      return out;
    }
    // Memory at the moment of action (HarnessV3-Memory M5-3, M5-5, MD-14). On a tool-result leg, what memory knows of
    // the calls the model just made rides on their results: the pitfalls they walked into and the open threads on the
    // files they touched (`remindersFor`), then the rules that act (`rules.act`, opt-in per rule: one with no trigger,
    // matched by its words), so the model reads them before its next step. The block is kept by the leg's hash, so a
    // resend places it again byte for byte. A loop's own rounds are quiet requests and never get here: the loop
    // attaches its own (M5-D4).
    if (sit.newestIndex < 0) {
      const msgs = sit.body.messages || [];
      const lastIdx = msgs.length - 1;
      const last = msgs[lastIdx];
      const prev = msgs[lastIdx - 1];
      const hashL = last && last.role !== "assistant" && prev?.role === "assistant" ? (sit.scan ? sit.scan.hashAt(lastIdx) : messageHash(last)) : null;
      if (hashL && blocks[hashL] === undefined) {
        // What the calls did, told to the observation bus (M5-4), where the miner reads a failure the next call works around.
        if (this.observe) for (const r of toolResultsOf(prev, last)) this.observe({ type: "tool.result", project: sit.project.id, chain: chain.id, turn: out.turn, ...r });
        const calls = toolCallsOf(prev);
        const reminders = calls.flatMap((c) => this.remindersFor({ projectId: sit.project.id, chainId: chain.id, turnId: out.turn, tool: c.name, input: c.input }));
        const byKind = { pitfall: reminders.filter((m) => m.kind === "pitfall"), thread: reminders.filter((m) => m.kind === "thread") };
        const actIds = (this.getConfig()?.rules?.act || []).map(String).filter(Boolean);
        const callText = actIds.length ? toolCallsText(prev) : "";
        const acting = [];
        for (const id of callText ? actIds : []) {
          // Listed as a line shows it (`i<n>`), or by its engine row's id.
          const ref = this.resolveRef(id);
          const it = ref.type === "item" ? ref.item : null;
          if (!it || it.kind !== "rule" || isRetired(it.status) || reminders.some((m) => m.id === itemRef(it.id))) continue;
          if (overlap(it.text, callText) >= 0.25) acting.push(it);
        }
        tr?.step("memory at the moment of action", {
          calls: calls.length,
          pitfalls: byKind.pitfall.length,
          threads: byKind.thread.length,
          ...(actIds.length ? { rulesConsidered: actIds.length, rules: acting.length } : {}),
          tokens: reminders.length || acting.length ? est([...reminders.map((m) => m.line), ...acting.map((m) => m.text)].join("\n")) : 0,
        });
        if (reminders.length || acting.length) {
          const t = [
            ...(reminders.length ? [`Memory on the tool call${calls.length === 1 ? "" : "s"} the model just made (Filament):`, ...reminders.map((m) => `- ${m.line}`)] : []),
            ...(acting.length ? ["Rules from memory that apply to the tool call the model just made (Filament):", ...acting.map((m) => `- ${clip(m.text, 300)}`)] : []),
          ].join("\n");
          putBlock(hashL, t, "rule");
          applyUserBlock(sit.body, lastIdx, t, "rule", laterBlock(hashL, "own"));
          out.tokens += est(t);
          if (reminders.length) {
            out.ids.push(...reminders.map((m) => m.id));
            this.noteInjected(requestId, reminders.map((m) => [m.id, m.text]));
          }
          for (const [kind, list] of /** @type {[ "pitfall" | "thread", typeof reminders][]} */ (Object.entries(byKind))) {
            if (!list.length) continue;
            out[kind === "pitfall" ? "pitfalls" : "threads"] = list.length;
            this.archive.injections.add({ requestId, chainId: chain.id, turnId: out.turn, kind, ids: list.map((m) => m.id), tokens: est(list.map((m) => m.line).join("\n")) });
            notes.push(
              kind === "pitfall"
                ? `memory: ${list.length} pitfall${list.length === 1 ? "" : "s"} attached to the tool result (the call walked into what memory knows)`
                : `memory: ${list.length} open thread${list.length === 1 ? "" : "s"} attached to the tool result (the call touched its file)`,
            );
          }
          if (acting.length) {
            out.rules = acting.length;
            notes.push(`memory: ${acting.length} rule${acting.length === 1 ? "" : "s"} attached to the tool result (rules that act)`);
          }
        }
      }
    }

    // Continuation: a client's compaction opened this chat with its summary — link to the most recent other chain of
    // this project. Nothing the person typed links it (the memory plan's c3: "continue …" is their word to the agent);
    // a chat whose agent loads a session of its project in its first turn is linked to it then (`linkLoaded`). A
    // request in no folder has no project to continue in: the conversations there are every app's and every chat's
    // (HarnessV3-AtHome AH-D1). A chat Memory settings leave out is no chat another continues (`keptToItself`). A
    // harness chat goes on as itself — its compaction is Filament's own.
    if (
      sit.project.id !== NO_PROJECT_ID &&
      sit.client !== "harness" &&
      sit.position === "afterCompaction" &&
      turn?.isNew &&
      (turn.n || 1) <= 1
    ) {
      const prev = this.archive.chainsForProject(sit.project.id, { limit: 3, kinds: LISTED_KINDS }).find((c) => c.id !== chain.id && !this.keptToItself(c.id));
      if (prev) {
        tr?.step("linked to the previous session", {
          previous: prev.id,
          afterCompaction: signals.afterCompaction || undefined,
          compactionArchived: signals.afterCompaction && sit.newest ? true : undefined,
        });
        this.archive.link(chain.id, prev.id, "continues", 1);
        if (!chain.parent_id) this.archive.setParent?.(chain.id, prev.id);
        if (signals.afterCompaction && sit.newest) {
          try {
            this.archive.addCompaction(prev.id, {
              fromTurn: 1,
              toTurn: prev.turns || 0,
              summaryText: sit.newest,
              kind: "client",
              method: "summary",
              ...(tick ? {} : sit.window ? { window: sit.window } : {}),
            });
          } catch {}
        }
        notes.push(
          `memory: this session continues ${this.titleFor(prev) ? `"${clip(String(this.titleFor(prev)), 50)}"` : "an earlier session"} in the same project${signals.afterCompaction ? " (after a compaction)" : ""}`,
        );
      }
    }

    // 1. Briefing (once per chain; tried on up to three of the person's turns until one finds material — turns memory
    // sat out, muted or quiet, are no tries: the bug report's L15). A session whose document says `memory.briefing:
    // false` gets none — not built, and one built earlier not placed (the cache miss is the developer's choice, said
    // in the notes). Built on the chat's first request it closes the system prompt; built on a later one — the first
    // found no material, or was let go — it rides the message it was built on, and the system prompt takes it at the
    // chat's next compaction (`briefingSeated`). One a message of the history carries already — this chat's, or a
    // sibling's whose blocks a rotated session id borrowed — stays there alone: none is placed beside it, or built.
    const briefingOff = session ? !session.briefing : false;
    const briefingTries = Number(meta.briefingTries) || 0;
    const carried = carriedBriefing(placedAgain);
    let briefing = briefingOff ? "" : chain.briefing || "";
    // The procedures this request's briefing listed by goal only (M5-6): recall may still serve their steps.
    /** @type {string[]} */
    let listed = [];
    if (briefingOff) {
      tr?.step("no briefing", { why: "the session's document turns the briefing off (memory.briefing)", stored: chain.briefing ? true : undefined });
      notes.push(`memory: no briefing — the session turned it off${carried ? " (the one an earlier message carries stays there, as it went out)" : chain.briefing ? " (one built earlier is not placed)" : ""}`);
    } else if (briefing) {
      const seatedNow = this.briefingSeated(sit, chain, meta, briefing, !!carried) && !carried;
      tr?.step("briefing reused", {
        tokens: est(briefing),
        note: seatedNow
          ? "built on this session's first turn; placed byte-identically at the end of the system prompt"
          : "built after the system prompt went out; it rides the message it was built on, placed again with the history",
      });
      // Its reply is judged against what the briefing showed too (f3), as the first was.
      if (requestId && meta.briefingIds?.length) {
        this.#briefingDue.set(requestId, { chainId: chain.id, ids: meta.briefingIds });
        if (this.#briefingDue.size > 200) this.#briefingDue.delete(this.#briefingDue.keys().next().value);
      }
    }
    else if (carried) tr?.step("briefing carried", { note: "a message of the history carries one already (a sibling's, borrowed with its blocks): none is built" });
    else if (!(briefingTries < 3 && sit.newestIndex >= 0))
      tr?.step("no briefing", {
        why:
          sit.newestIndex < 0
            ? "a tool-loop leg"
            : "tried on three of this session's turns without material for one; not tried again",
      });
    const built =
      !briefingOff && !briefing && !carried && briefingTries < 3 && sit.newestIndex >= 0
        ? await recalled(() => (tr ? tr.span("briefing built", () => this.buildBriefing({ chain, sit, signals })) : this.buildBriefing({ chain, sit, signals })))
        : undefined;
    // A briefing built on this message recalled on its words: its turn block has its own room (e2).
    const briefedNow = !!(built && "value" in built && built.value.text);
    if (built && "letGo" in built) {
      tr?.step("briefing let go", { note: `${built.letGo === "clock" ? "the turn's clock" : "the person"} let it go; no try is counted, and the next turn builds it` });
      notes.push(`memory: the briefing was let go — ${letGoWords(built.letGo, waitMs)}`);
    }
    if (built && "value" in built) {
      const b = built.value;
      const seated = !!b.text && this.briefingSeated(sit, chain, meta, b.text, false);
      tr?.step(
        b.text ? "briefing placed" : "briefing empty",
        b.text
          ? {
              items: b.count,
              tokens: b.tokens,
              sources: b.sources || "none",
              cue: b.cue ? true : undefined,
              note: seated ? "at the end of the system prompt, once per session" : "on this message: the system prompt went out without one, and takes it at the next compaction",
            }
          : { note: "nothing known about this user or project yet, and no engine for the tools" },
      );
      briefing = b.text;
      if (b.text) {
        this.noteInjected(requestId, b.pairs);
        this.#briefingPairs.set(chain.id, b.pairs);
        if (this.#briefingPairs.size > 200) this.#briefingPairs.delete(this.#briefingPairs.keys().next().value);
        this.archive.setBriefing(chain.id, b.text);
        // What the briefing showed, so recall does not serve it again: a procedure it only listed by goal it did not.
        listed = b.listed;
        meta.briefingIds = b.ids.filter((id) => !listed.includes(id));
        // Merged, not written whole: this request's `meta` was read before the briefing's model calls, and a goal
        // may have landed on the chain meanwhile. The dossier's version is pinned with the briefing that
        // carries it (M4-7): the session reads that one to its end, byte for byte, and errata cover what changes meanwhile.
        this.archive.mergeMeta(chain.id, { briefingIds: meta.briefingIds, dossier: b.dossier ?? undefined });
        this.archive.injections.add({
          requestId,
          chainId: chain.id,
          turnId: out.turn,
          kind: "briefing",
          ids: b.ids,
          tokens: b.tokens,
        });
        out.briefing = b.count;
        out.tokens += b.tokens;
        out.ids.push(...b.ids);
        if (b.cue) out.cue = b.cue;
        notes.push(
          `memory: briefing added to ${seated ? "the system prompt" : "this message — the system prompt went out without one and takes it at the next compaction"} (${b.count} item${b.count === 1 ? "" : "s"}, ~${b.tokens} tokens, ${b.sources})`,
        );
      } else this.archive.mergeMeta(chain.id, { briefingTries: briefingTries + 1 });
    }
    if (briefing && !carried && this.briefingSeated(sit, chain, meta, briefing, !!carried)) {
      applySystemBlock(sit.format, sit.body, sit.responsesBody, briefing);
      out.composition.briefing = est(briefing);
    } else if (briefing && newestMsg && !carried) {
      // Said on the person's message — the one it was built on, or their next where the history no longer sends the
      // message that carried it (rewound, or sent again with other words) — and kept beside that
      // message's own block, before the results of memory calls and a load: every later request sends it there again.
      const h = sit.scan ? sit.scan.hashAt(sit.newestIndex) : messageHash(newestMsg);
      if (applyUserBlock(sit.body, newestNow(), briefing, "briefing", laterBlock(h, "standing"))) putBlock(h, briefing, "briefing");
      if (!briefedNow) notes.push("memory: the briefing rides this message — the history no longer sends the one that carried it");
    }
    out.briefingInForce = briefingOff ? "" : carried || briefing;
    out.composition.goal = this.applyGoal(sit, meta, chain.id, null) + tellGoal();
    if (out.composition.goal) out.goal = true;
    out.goalInForce = goalNow(meta.goal);

    // 2. Per-turn block on the newest user message. With `memory.turnBlock: false` no new lookup runs, and the block
    // holds only what corrects what the session was shown; a block an earlier request stored for this same message
    // still re-attaches (history stays byte-identical). A message with no word to look up by ("ok", "thanks") has none.
    const turnBlockOff = session ? !session.turnBlock : false;
    if (sit.newestIndex >= 0 && signals.keywords.length) {
      const hash = sit.scan
        ? sit.scan.hashAt(sit.newestIndex)
        : messageHash(sit.body.messages[sit.newestIndex]);
      const stored = typeof blocks[hash] === "string" ? { text: blocks[hash], nth: 1 } : blocks[hash];
      let text = stored?.text;
      let fresh = false;
      // A fresh lookup may only run for the message that is the TAIL of this request. On an OpenAI tool leg the
      // newest user message sits mid-history (tool results came after it), and retrieval is not deterministic over
      // time — a second-chance lookup there could attach content the original turn did not have, changing bytes
      // the provider already cached (P1.4 of the 2026-09-19 cache audit). Tool legs re-attach stored blocks only.
      const isTail = atTail();
      /**
       * The block with what this session was shown and is retired since (M1-7), or whose files moved (M3-3), said
       * once at its top. The files of every anchored claim the session was ever shown are checked (`#checkShown`), more
       * with each turn: their stats are taken ahead, off the event loop, and the checks read them.
       * @param {string} block @returns {Promise<string>}
       */
      const withErrata = async (block) => {
        await sit.fileCheck.warm(this.archive.anchors.pathsShownIn(chain.id));
        const { text: t, errata } = this.sayErrata(chain.id, { requestId, turnId: out.turn, check: sit.fileCheck });
        if (!errata.length) return block;
        out.tokens += est(t);
        // What replaced each is added to this request as anything memory adds is: judged used by the reply (M7-D40).
        for (const e of errata) if (e.nowRef && !out.ids.includes(e.nowRef)) out.ids.push(e.nowRef);
        const fixed = errata.filter((e) => !e.anchor).length;
        const moved = errata.length - fixed;
        if (fixed)
          notes.push(`memory: ${fixed} memor${fixed === 1 ? "y" : "ies"} this session was shown ${fixed === 1 ? "was" : "were"} corrected since; said at the top of this message`);
        if (moved)
          notes.push(`memory: the files of ${moved} memor${moved === 1 ? "y" : "ies"} this session was shown changed since; said at the top of this message`);
        tr?.step("errata attached", {
          errata: fixed || undefined,
          files: moved || undefined,
          tokens: est(t),
          note: "memories this session was shown, retired since or whose files moved",
        });
        return block ? `${t}\n${block}` : t;
      };
      if (text === undefined && turnBlockOff) {
        tr?.step("turn block skipped", { note: "the session's document turns the per-turn block off (memory.turnBlock)" });
        notes.push("memory: no per-turn recall — the session turned it off");
        // What corrects what the session was shown is no recall: it is still said (the bug report's L12).
        text = isTail ? await withErrata("") : "";
        fresh = isTail;
        if (text) putBlock(hash, text);
      }
      if (text === undefined && !isTail)
        tr?.step("turn block skipped", {
          note: "a tool-loop leg: stored blocks re-attach, but no new lookup runs mid-history",
        });
      if (text === undefined && isTail) {
        const budget = this.turnBudget(sit, auto, briefedNow);
        tr?.step("turn budget", {
          tokens: budget,
          base: auto.turnTokens ?? 300,
          why:
            [
              sit.position === "afterCompaction"
                ? "after a compaction: ×1.5"
                : sit.position === "first" && !briefedNow
                  ? "a first message no briefing recalled on: ×1.5"
                  : null,
              auto.mode === "conservative" ? "conservative mode: at most 3 items" : null,
            ]
              .filter(Boolean)
              .join("; ") || "plain turn",
        });
        const lookup = {
          chain,
          sit,
          signals,
          budgetTokens: budget,
          excludeIds: new Set([...[...out.ids, ...(meta.briefingIds || [])].filter((id) => !listed.includes(id)), ...inView]),
        };
        const looked =
          budget > 0
            ? await recalled(() => (tr ? tr.span("related memory looked up", () => this.buildTurnBlock(lookup)) : this.buildTurnBlock(lookup)))
            : { value: { text: "", ids: [], count: 0, tokens: 0 } };
        const gone = "letGo" in looked ? looked.letGo : null;
        /** @type {any} */
        const r = "value" in looked ? looked.value : { text: "", ids: [], count: 0, tokens: 0 };
        tr?.step(
          r.text ? "turn block attached" : "nothing attached",
          r.text
            ? {
                items: r.count,
                tokens: r.tokens,
                sources: r.sources || "none",
                note: "appended to the newest user message; re-attached on every resend",
              }
            : {
                why: gone
                  ? `let go: ${letGoWords(gone, waitMs)}`
                  : budget <= 0
                    ? "no budget for this message"
                    : r.excluded
                      ? "everything that matched is in view already: in the briefing, or an earlier block of this chat"
                      : r.top != null && r.top < auto.minScore
                        ? `the best score ${r.top} is under the floor ${auto.minScore}`
                        : r.top != null
                          ? "nothing left after ranking and de-duplication"
                          : "no query words, or nothing matched",
              },
        );
        if (gone) notes.push(`memory: related memory was let go — ${letGoWords(gone, waitMs)}`);
        text = r.text || "";
        fresh = true;
        if (text) {
          this.noteInjected(requestId, r.pairs);
          this.archive.injections.add({
            requestId,
            chainId: chain.id,
            turnId: out.turn,
            kind: "turn",
            ids: r.ids,
            tokens: r.tokens,
          });
          out.injected = r.count;
          out.tokens += r.tokens;
          out.ids.push(...r.ids);
          notes.push(
            `memory: ${r.count} related item${r.count === 1 ? "" : "s"} attached to this message (~${r.tokens} tokens${r.sources ? `, ${r.sources}` : ""})`,
          );
        } else if (budget > 0 && !gone) notes.push("memory: nothing confident enough to add for this message");
        text = await withErrata(text);
        if (text) putBlock(hash, text);
      }
      // On a message the results of memory calls or a load rode already (a retry of the request they rode), a block made
      // now goes before them, where every later request puts the message's own block.
      if (text) applyUserBlock(sit.body, newestNow(), text, stored?.kind || "turn", laterBlock(hash, "own"));
      if (!fresh && text) {
        notes.push("memory: this message's block re-attached (tool loop or retry)");
        tr?.step("turn block re-attached", {
          tokens: est(text),
          note: "this message was seen before (retry or tool loop): the same block, no new lookup",
        });
      }
      if (!fresh && !text && !turnBlockOff)
        tr?.step("turn block skipped", { note: "this message was looked up before and had nothing to add" });
    } else
      tr?.step("no turn block", {
        why: sit.newestIndex < 0 ? "a tool-loop leg" : personSpoke ? "no word in the message to look up by" : "not the person's words to look up by (a turn Filament began, or a chat set apart)",
      });

    // 2b. A session the user asked to load (@mem load or a header) waits under the chat's key for the request it is
    // attached to, on the newest user message, once: a request memory says nothing new into (above) leaves it waiting,
    // and a dry run only looks. It goes after the message's own block, kept beside it (`loadSlot`), so every resend
    // puts the two back in the order they went. A lineage loaded for a caller that reaches its own project's sessions
    // alone (`sit.confined`) keeps to them. The chat's own session, loaded or in the lineage loaded, brings its turns
    // before the one this message opened — the message being sent is never pasted into itself — and is linked to no
    // other. One with nothing to paste is used up, and the notes say so. A chat Memory settings leave out is loaded into
    // no other (`keptToItself`): the load is used up, and the notes say why; another chat's turns kept apart stay out of
    // what is loaded (`load`'s `others`).
    const pendingLoad = sit.newestIndex >= 0 ? this.pendingLoads?.get(sit.key) || null : null;
    if (pendingLoad && pendingLoad.chainId !== chain.id && this.keptToItself(pendingLoad.chainId)) {
      if (!dryRun) this.pendingLoads?.delete(sit.key);
      notes.push(`memory: session ${pendingLoad.chainId} is left out of memory (Memory settings): nothing of it is loaded here`);
      tr?.step("past session not loaded", { session: pendingLoad.chainId, why: "Memory settings leave that chat out" });
    } else if (pendingLoad) {
      if (!dryRun) this.pendingLoads?.delete(sit.key);
      const own = pendingLoad.chainId === chain.id;
      try {
        const r = this.load(pendingLoad.chainId, {
          view: pendingLoad.view || "chat",
          budgetTokens: pendingLoad.budgetTokens || 6000,
          ...(out.turnN ? { toTurn: out.turnN - 1, toTurnOf: chain.id } : {}),
          ...(sit.confined ? { within: sit.project.id } : {}),
          others: !own,
        });
        const text =
          r?.text ||
          (r?.messages
            ? r.messages
                .map(
                  (m) =>
                    `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
                )
                .join("\n\n")
            : "");
        if (text) {
          const h = sit.scan
            ? sit.scan.hashAt(sit.newestIndex)
            : messageHash(sit.body.messages[sit.newestIndex]);
          const t = `Past session ${pendingLoad.chainId} (${pendingLoad.view || "chat"} view), loaded on the user's request (Filament):\n${text}`;
          if (applyUserBlock(sit.body, newestNow(), t, "load")) putBlock(h, t, "load");
          if (!own) this.archive.link(chain.id, pendingLoad.chainId, "loaded", 1);
          out.loaded = pendingLoad.chainId;
          out.tokens += est(text);
          notes.push(
            `memory: session ${pendingLoad.chainId} attached to this message (${pendingLoad.view || "chat"} view, ~${est(text)} tokens)`,
          );
          tr?.step("past session loaded", {
            session: pendingLoad.chainId,
            view: pendingLoad.view || "chat",
            tokens: est(text),
          });
        } else {
          notes.push(`memory: nothing of session ${pendingLoad.chainId} to load${own ? " before this message" : ""}`);
          tr?.step("past session load empty", {
            session: pendingLoad.chainId,
            note: own ? "the chat's own session holds no turn before this message" : "the session holds nothing to render",
          });
        }
      } catch (e) {
        notes.push(`memory: could not load session ${pendingLoad.chainId} (${e.message.slice(0, 80)})`);
        tr?.step("past session load failed", {
          session: pendingLoad.chainId,
          error: e.message.slice(0, 120),
        });
      }
    }

    out.tools = toolsOffered({ auto, meta, sit, chain, blocks, captureOnly });
    tr?.step(
      out.tools ? "memory tools offered" : "memory tools not offered",
      out.tools
        ? { tools: 7, note: "Filament runs the calls and asks the model again; the client sees one answer" }
        : { why: toolsRefused?.said ? "the model takes no tools" : toolsRefused ? "the model refused tools on an earlier request" : "tools are off in Memory settings" },
    );
    out.ms = this.now() - t0;
    return out;
  }

  /** What each session's briefing showed, as its texts were judged (`noteInjected`'s pairs), by chain: the newest 200. */
  #briefingPairs = new Map();
  /** The requests of a session whose briefing was built earlier, to judge against what it showed (f3): the newest 200. */
  #briefingDue = new Map();
  /** What a session's later replies credited already, by chain, so a reply judges only the rest. */
  #briefingCredited = new Map();
  /**
   * A later reply of a session judged against what its briefing showed (the memory plan's f3): the briefing's showing
   * was judged on the session's first reply alone, and a claim in it is not shown again that session, so a claim the
   * session went on to use counted as never used. A reply that repeats a phrase of one, or a call that carries a word
   * of it rare across memory (`usedInReply`, `usedInWork`, as `afterReply` judges), credits the briefing's showing
   * (`creditShownIn`, its kind `briefing`), once a session, and every use sets its last use (`usedNow`): a fork, whose
   * briefing was its parent's, has no showing to credit, and a session's later use counts as late as it came. Its texts
   * are the ones the briefing was judged by, else, where Filament started since, the claims' own.
   * @param {string} requestId @param {string} replyText @param {any[]} workMessages
   */
  #judgeBriefing(requestId, replyText, workMessages) {
    const due = this.#briefingDue.get(requestId);
    if (!due) return;
    this.#briefingDue.delete(requestId);
    if (!replyText && !workMessages.length) return;
    /** @type {[string, string][]} */
    let pairs = this.#briefingPairs.get(due.chainId);
    if (!pairs) {
      pairs = due.ids
        .filter((/** @type {string} */ id) => /^i\d+$/.test(id))
        .map((/** @type {string} */ id) => [id, this.archive.items.get(Number(id.slice(1)))?.text])
        .filter((/** @type {any[]} */ p) => p[1]);
      this.#briefingPairs.set(due.chainId, pairs);
      if (this.#briefingPairs.size > 200) this.#briefingPairs.delete(this.#briefingPairs.keys().next().value);
    }
    if (!pairs.length) return;
    const credited = this.#briefingCredited.get(due.chainId) || new Set();
    const terms = workMessages.length ? workTermsOf(workMessages) : new Set();
    const rare = terms.size ? this.rareTerms() : () => false;
    const replyGrams = replyText ? grams(replyText, 5) : null;
    const used = [...new Set(pairs.filter(([, t]) => (replyText && usedInReply(t, replyText, replyGrams)) || usedInWork(t, terms, rare)).map(([id]) => id))];
    if (!used.length) return;
    const fresh = used.filter((id) => !credited.has(id));
    const shown = new Set(fresh.length ? this.archive.injections.creditShownIn(due.chainId, fresh, "briefing") : []);
    this.archive.injections.usedNow(used.filter((id) => !shown.has(id)));
    for (const id of fresh) credited.add(id);
    this.#briefingCredited.set(due.chainId, credited);
    if (this.#briefingCredited.size > 200) this.#briefingCredited.delete(this.#briefingCredited.keys().next().value);
    currentTrace()?.step("briefing's use judged", { used: used.length, credited: shown.size, note: "a later reply bore out what the session's briefing showed: its showing is credited once, and each use is its last" });
  }

  noteInjected(requestId, pairs) {
    if (!requestId || !pairs?.length) return;
    // A request whose record has ended was judged at its reply, or never will be (it failed, its client left): its texts
    // go, so the cap below reaches only requests still running, and none is judged "not used" for being pushed out.
    for (const id of this.lastTexts.keys()) if (this.runOf?.(id)?.totalMs != null) this.lastTexts.delete(id);
    const cur = this.lastTexts.get(requestId) || [];
    this.lastTexts.set(requestId, cur.concat(pairs));
    if (this.lastTexts.size > 200) this.lastTexts.delete(this.lastTexts.keys().next().value);
  }

  /**
   * A turn block's room, by where the message stands alone (the memory plan's c3): half again after a compaction, which
   * took the earlier blocks out of view, and on a chat's first message where no briefing was built on it; a first
   * message a briefing was built on has the turn block's own, the briefing recalling on the same words (e2). `briefed`:
   * a briefing was built on this request.
   * @param {any} sit @param {any} auto @param {boolean} [briefed]
   */
  turnBudget(sit, auto, briefed = false) {
    if (sit.position === "toolLeg") return 0;
    const base = auto.turnTokens ?? 300;
    return sit.position === "afterCompaction" || (sit.position === "first" && !briefed) ? Math.round(base * 1.5) : base;
  }

  // Memory's model suggests 2-3 alternative keyword queries for a message that references the
  // past or changes topic, so recall can match work worded differently. One small call, waited for
  // (HarnessV3-FailurePoints FP-D4: quality first); a failed rewrite is dropped, and recall goes on
  // with the message's own words.
  // `chainId`: the chat it is for, whose model memory's call runs on where none is set (the memory plan's m1).
  async rewriteQueries(text, chainId = null) {
    if (!this.callModel || !text) return [];
    const raw = stripMemoryBlocks(text).replace(/\s+/g, " ").trim().slice(0, 600);
    if (raw.length < 12) return [];
    const tr = currentTrace();
    const t0 = this.now();
    try {
      const answer = await this.callModel({ system: REWRITE_PROMPT, user: raw, purpose: "recall", ...(chainId ? { chainId } : {}) });
      let parsed = null;
      try {
        parsed = JSON.parse(
          String(answer || "")
            .replace(/^```(?:json)?/i, "")
            .replace(/```\s*$/, "")
            .trim(),
        );
      } catch {}
      const base = new Set(keywordsOf(raw, { max: 40 }).map((k) => k.toLowerCase()));
      const out = [];
      for (const q of (Array.isArray(parsed?.queries) ? parsed.queries : []).slice(0, 3)) {
        const clean = String(q || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 60);
        if (clean.length < 3) continue;
        const words = clean.toLowerCase().split(" ");
        if (words.every((w) => base.has(w))) continue; // adds nothing the base query does not already say
        out.push(clean);
      }
      tr?.step("query rewritten", {
        ms: Math.round((this.now() - t0) * 10) / 10,
        variants: out.map(safeQuery),
        note: out.length
          ? "memory's model offered alternative search words"
          : "the rewrite added nothing over the message's own words",
      });
      return out;
    } catch (e) {
      tr?.step("query rewrite skipped", {
        ms: Math.round((this.now() - t0) * 10) / 10,
        error: String(e?.message || e).slice(0, 80),
      });
      return [];
    }
  }

  // The session's ancestors: parent chains via parent_id, else `continues` links (live captures
  // and imports write both). Returns [parent, grandparent, …], oldest ancestor last.
  lineageOf(chain, { maxDepth = 6 } = {}) {
    if (!chain) return [];
    const out = [];
    const seen = new Set([chain.id]);
    let cur = chain;
    for (let i = 0; i < maxDepth; i++) {
      let parent = cur.parent_id && cur.parent_id !== chain.id ? this.archive.getChain(cur.parent_id) : null;
      if (!parent || seen.has(parent.id)) {
        const l = this.archive
          .linksFor(cur.id)
          .find((x) => x.type === "continues" && x.src === cur.id && !seen.has(x.dst));
        parent = l ? this.archive.getChain(l.dst) : null;
      }
      if (!parent || seen.has(parent.id)) break;
      seen.add(parent.id);
      out.push(parent);
      cur = parent;
    }
    return out;
  }

  /**
   * A chat whose agent loads a session of the chat's project before its first turn is finished continues that session
   * (the memory plan's c3): the link is written from what the agent did, never from the person's words. Once, where the
   * chat has none yet; a person's session alone (`LISTED_KINDS`), and none Memory settings leave out (`keptToItself`).
   * @param {string} chainId  the chat's @param {string} loadedId @returns {boolean} whether it linked
   */
  linkLoaded(chainId, loadedId) {
    if (!chainId || !loadedId || chainId === loadedId) return false;
    const chain = this.archive.getChain(chainId);
    const prev = this.archive.getChain(loadedId);
    if (!chain || !prev || chain.parent_id || (chain.turns || 0) > 0) return false;
    if (chain.project_id === NO_PROJECT_ID || prev.project_id !== chain.project_id) return false;
    if (!LISTED_KINDS.includes(prev.kind || "interactive") || this.keptToItself(chain.id) || this.keptToItself(prev.id)) return false;
    if (this.archive.linksFor(chain.id).some((/** @type {any} */ l) => l.type === "continues" && l.src === chain.id)) return false;
    this.archive.link(chain.id, prev.id, "continues", 1);
    this.archive.setParent?.(chain.id, prev.id);
    return true;
  }

  // Deep retrieval for one query plus optional variants by memory's model: the store, learned items,
  // past sessions. Ranked and deduplicated across all queries. excludeChainId keeps the current
  // session out of its own "related memory"; `unquoted` keeps only its words out (a brief's session, M7-D10: what it
  // established serves the worker, what was typed in it is the conversation the session's view setting gives or not).
  // `within`: a project whose own claims, the ones that hold in every project and its own sessions' words alone are
  // served — an explicit search of one project's memory; left out, memory crosses projects and its own ranks first.
  async retrieve({
    query,
    queries = [],
    text = "",
    projectId,
    mode = "turn",
    limit = 12,
    excludeIds = new Set(),
    entities = [],
    excludeChainId = null,
    unquoted = null,
    auto = this.cfg().auto,
    check = this.anchorCheck.run(),
    env = null,
    within = undefined,
  }) {
    const out = [];
    const seen = new Set();
    const sources = new Set();
    const tr = currentTrace();
    let topScore = null;
    let excluded = 0,
      duplicates = 0;
    const all = [
      ...new Set(
        [query, ...(queries || [])]
          .map((q) =>
            String(q || "")
              .replace(/\s+/g, " ")
              .trim(),
          )
          .filter(Boolean),
      ),
    ];
    const push = (item) => {
      if (!item.text) return;
      if (excludeIds.has(item.id)) {
        excluded++;
        return;
      }
      const k = norm(item.text).slice(0, 80);
      if (seen.has(k)) {
        duplicates++;
        return;
      }
      seen.add(k);
      out.push(item);
    };
    tr?.step("retrieve", {
      mode,
      queries: all.map(safeQuery),
      limit,
      project: projectId || "none",
      excluded: excludeIds.size || undefined,
    });
    if (this.reembedding) tr?.step("engine skipped", { why: "its vectors are being made again with its model: the archive answers alone" });
    if (this.storeReady() && !this.reembedding && all.length) {
      try {
        let rows = [];
        let underFloor = 0,
          faded = 0,
          fenced = 0,
          retired = 0,
          adopted = 0,
          offGoal = 0,
          elsewhere = 0,
          kept = 0;
        for (const q of all)
          rows = rows.concat(
            await this.store.recall(q, {
              topK: Math.max(limit, 8),
              temporalWeight: mode === "briefing" ? 0 : 0.1,
            }),
          );
        // By meaning too (the memory plan's c2): the engine's recall keeps a row only where it shares words with the
        // ask, so a memory in another language, or worded otherwise, never came. Its rows nearest the person's own
        // sentence (`text`; the query where none) come after the words' — from DENSE_MIN_SIM up, weighed by
        // DENSE_WEIGHT, below a row the words found — and pass every check theirs do.
        const said = String(text || query || "").replace(/\s+/g, " ").trim().slice(0, DENSE_CHARS);
        if (said && typeof this.store.dense === "function") {
          const near = await this.store.dense(said, { topK: Math.max(limit, 8), minSim: DENSE_MIN_SIM }).catch(() => []);
          if (near.length) tr?.step("by meaning", { rows: near.length, best: Math.round(Math.max(...near.map((r) => Number(r.score) || 0)) * 100) / 100 });
          rows = rows.concat(near.map((r) => ({ ...r, score: (Number(r.score) || 0) * DENSE_WEIGHT })));
        }
        const top = Math.max(0, ...rows.map((r) => Number(r.score) || 0));
        topScore = rows.length ? Math.round(top * 100) / 100 : null;
        for (const r of rows) {
          const score = Number(r.score) || 0;
          if (!(score >= auto.minScore || (score >= 0.05 && score >= 0.6 * top))) {
            underFloor++;
            continue;
          }
          if (engineWritten(r)) {
            fenced++;
            continue;
          }
          // The claim behind the row decides (MD-1, M2-3): whether it is served, and as what. A retired claim's copy is
          // not served, even where the engine still holds it valid (its invalidation still queued, or an imported
          // copy); a row no claim stands behind yet is adopted as one.
          const { item: claim, how } = this.claimOfRow(r);
          if (how === "adopted") adopted++;
          if (excludeChainId && claim.chain_id === excludeChainId) continue; // the current session is not "related memory" for itself
          if (within !== undefined && claim.project_id != null && claim.project_id !== within) {
            elsewhere++;
            continue;
          }
          if (oldAbility(claim.kind)) continue;
          if (isRetired(claim.status)) {
            retired++;
            continue;
          }
          const kind = claim.kind;
          // A procedure comes when the task names its goal (M5-6), whatever else of its steps the engine matched; an
          // explicit search finds it by any of its words.
          if (kind === "procedure" && mode !== "search" && !all.some((q) => goalCover(goalOfProcedure(claim.text) ?? "", q) > 0)) {
            offGoal++;
            continue;
          }
          const ref = itemRef(claim.id);
          const proj = claim.project_id === projectId ? 0.15 : 0;
          const ent = entities.length && entities.some((e) => norm(claim.text).includes(norm(e))) ? 0.2 : 0;
          // Autopilot lets ignored facts fade; rules, preferences, conventions, procedures and what the user confirmed
          // never do, and explicit searches still see everything.
          const fades = auto.mode === "conservative" && mode !== "search" && !NEVER_FADES.has(kind) && claim.status !== "confirmed";
          const never = fades ? this.archive.injections.neverUsedCount?.(ref) || 0 : 0;
          if (never >= 3) {
            faded++;
            continue;
          }
          push({
            kind,
            id: ref,
            text: claim.text,
            score: Math.min(1, score + proj + ent - never * 0.05),
            when: dateOf(r.timestamp),
            chainId: claim.chain_id || null,
            turnId: claim.turn_id || null,
            trust: trustOf(claim),
            claim,
            veracity: r.veracity,
            importance: r.importance,
          });
          kept++;
          sources.add("memory");
        }
        tr?.step("engine results filtered", {
          rows: rows.length,
          kept,
          underFloor,
          faded,
          engineWritten: fenced || undefined,
          retired: retired || undefined,
          adopted: adopted || undefined,
          offGoal: offGoal || undefined,
          elsewhere: elsewhere || undefined,
          top: topScore,
          floor: auto.minScore,
          note: [faded ? "faded = a fact ignored three times running (conservative mode)" : "", offGoal ? "offGoal = a procedure whose goal the task does not name" : "", elsewhere ? "elsewhere = a claim of another project, in a search of one project's memory" : ""].filter(Boolean).join("; ") || undefined,
        });
      } catch (e) {
        this.log(
          "warn",
          `memory: recall failed (${e.message.slice(0, 120)}); continuing with the archive only`,
        );
        tr?.step("engine recall failed", {
          error: e.message.slice(0, 120),
          note: "continuing with the archive only",
        });
      }
    } else
      tr?.step("engine not asked", {
        why: !all.length
          ? "no query words"
          : "the engine is not ready (not installed, starting, or degraded)",
      });
    // Learned items for this project (confirmed first) that overlap any of the queries.
    try {
      const t = this.now();
      let considered = 0,
        kept = 0;
      const best = (text) => Math.max(0, ...all.map((q) => overlap(q, text)));
      for (const it of this.archive.items.list({ projectId, limit: 200 })) {
        if (isRetired(it.status) || oldAbility(it.kind)) continue;
        considered++;
        // A procedure by its goal (M5-6), outside an explicit search: how much of it the task names.
        const goal = it.kind === "procedure" && mode !== "search" ? goalOfProcedure(it.text) ?? "" : null;
        const o = goal != null ? Math.max(0, ...all.map((q) => goalCover(goal, q))) : best(it.text);
        if (o < 0.25) continue;
        push({
          kind: it.kind,
          id: itemRef(it.id),
          text: it.text,
          score: Math.min(1, 0.4 + o * 0.5),
          when: dateOf(it.created_at),
          chainId: it.chain_id,
          turnId: it.turn_id,
          trust: trustOf(it),
          claim: it,
        });
        sources.add("items");
        kept++;
      }
      tr?.step("learned items scanned", {
        ms: Math.round((this.now() - t) * 10) / 10,
        considered,
        kept,
        note: "items learned from past sessions of this project, matched by word overlap (a procedure by its goal)",
      });
    } catch {}
    // Past sessions matching what the user typed before — none of a chat Memory settings leave out (`keptToItself`).
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    for (const q of all) {
      try {
        const t = this.now();
        // Excluded in SQL: fetching 8 rows and discarding the ones from this very session meant the busiest chain in
        // the index crowded out the actual results, and paid for a snippet per discarded row.
        // So is another project's, in a search of one project's memory.
        const hits = this.archive.searchInputs(q, { limit: 8, notChainId: excludeChainId || unquoted, distinct: true, kinds: QUOTED_KINDS, project: within ?? null, apartToo: false });
        hits.forEach((h, i) => {
          if (excludeChainId && h.chainId === excludeChainId) return;
          if (within === null && h.projectId != null) return; // a search of no project's memory: what was typed in none
          if (!h.snippet) return;
          if (this.keptToItself(h.chainId, keptAside)) return;
          // A turn whose own claim was retired, or is held back, is not quoted back: "… eu-west-2" from the turn that made
          // the claim a correction superseded would bring the old value back as words (F5). Nor is the
          // turn that said a procedure: it comes as itself, by its goal (M5-6).
          if (this.withdrawnWords(h.chainId, h.turnId, h.snippet, check, env)) return;
          push({
            kind: "session",
            id: `s:${h.chainId}:${h.n}`,
            text: `${h.title ? `"${clip(h.title, 60)}" ` : ""}turn ${h.n}: ${clip(h.snippet, 220)}`,
            score: Math.max(0.2, 0.55 - i * 0.05) + (h.projectId === projectId ? 0.1 : 0),
            when: dateOf(h.at),
            chainId: h.chainId,
            turnId: h.turnId,
          });
        });
        if (hits.length) sources.add("sessions");
        tr?.step("past sessions searched", {
          ms: Math.round((this.now() - t) * 10) / 10,
          hits: hits.length,
          note: "full-text search over what the user typed in earlier sessions",
        });
      } catch {}
    }
    // Confidence (M3-6): each claim's relevance weighed by how sure memory is of it, from its record. A quote counts as
    // words nobody checked.
    const now = this.now();
    const counts = this.archive.items.eventCounts(out.flatMap((c) => (c.claim ? [c.claim.id] : [])));
    const ranked = out.map((c) => {
      if (!c.claim) return { ...c, relevance: c.score, score: weighed(c.score, QUOTE_CONFIDENCE) };
      const record = counts.get(c.claim.id) || { evidence: 0, suspected: 0 };
      return { ...c, relevance: c.score, record, score: weighed(c.score, confidenceOf(c.claim, record, now)) };
    });
    ranked.sort((a, b) => b.score - a.score);
    // A claim's standing is read in rank order, only as far as the limit needs (M3-3, M3-4): a gone file or symbol, or
    // a value the request's environment contradicts, holds the claim back, except from an explicit search, where it
    // shows labelled (and marked `held`); a changed file is a flag on its line and lowers its confidence. Under the
    // gate the autopilot leaves a claim out.
    const items = [];
    let held = 0;
    let unsure = 0;
    for (const { claim, relevance, record, ...it } of ranked) {
      if (items.length >= limit) break;
      if (!claim) {
        items.push(it);
        continue;
      }
      const st = this.#standing(claim, check, env);
      if (st.hold && mode !== "search") {
        held++;
        continue;
      }
      const sure = confidenceOf(claim, { ...record, changed: st.changed }, now);
      if (sure < CONFIDENCE_GATE && mode !== "search") {
        unsure++;
        continue;
      }
      const backed = 1 + record.evidence;
      items.push({
        ...it,
        score: weighed(relevance, sure),
        confidence: Math.round(sure * 100) / 100,
        flags: [...(backed >= 2 ? [`✓${backed}`] : []), ...st.flags],
        ...(st.hold ? { held: true } : {}),
      });
    }
    items.sort((a, b) => b.score - a.score);
    // A quote of the very turn a claim served here, or shown before it (`excludeIds`), was filed from says nothing that
    // claim does not: one fact, one line (M4-2).
    const claimed = new Set(items.filter((it) => !EVIDENCE_KINDS.has(it.kind) && it.chainId && it.turnId != null).map((it) => `${it.chainId}\0${it.turnId}`));
    for (const ref of excludeIds || []) {
      const m = /^i(\d+)$/.exec(String(ref));
      const c = m ? this.archive.items.get(Number(m[1])) : null;
      if (c?.chain_id && c.turn_id != null) claimed.add(`${c.chain_id}\0${c.turn_id}`);
    }
    const said = items.filter((it) => EVIDENCE_KINDS.has(it.kind) && claimed.has(`${it.chainId}\0${it.turnId}`));
    if (said.length) items.splice(0, items.length, ...items.filter((it) => !said.includes(it)));
    tr?.step("ranked", {
      candidates: out.length,
      returned: items.length,
      quotesOfShownClaims: said.length || undefined,
      heldBack: held || undefined,
      unsure: unsure || undefined,
      inView: excluded || undefined,
      duplicates: duplicates || undefined,
      sources: [...sources].join("+") || "none",
      top: items[0] ? Math.round(items[0].score * 100) / 100 : undefined,
      note:
        [
          held ? "held back = a memory whose file is gone or lost a symbol it names, or that the request's environment contradicts" : null,
          unsure ? `unsure = a memory whose confidence is under ${CONFIDENCE_GATE}` : null,
        ]
          .filter(Boolean)
          .join("; ") || undefined,
    });
    return { items, sources: [...sources].join("+"), top: topScore, excluded };
  }

  /**
   * True when a past turn made a claim that has since been retired or is held back (M3-3, M3-4), or a procedure (M5-6:
   * its words come as the procedure, for a task that names its goal, never as a quote for a word a step shares), and
   * the quoted words are that claim's.
   * @param {string} chainId @param {number} turnId @param {string} words @param {ReturnType<AnchorCheck["run"]>} check
   * @param {import("./request-env.js").RequestEnv | null} env
   */
  withdrawnWords(chainId, turnId, words, check, env) {
    if (!chainId || turnId == null) return false;
    return this.archive.items
      .list({ chainId, limit: 50 })
      .some((it) => it.turn_id === turnId && overlap(it.text, words) >= 0.5 && (isRetired(it.status) || it.kind === "procedure" || this.#standing(it, check, env).hold));
  }
  /**
   * Whether a ranked claim is held back, and the flags its line carries: its files (`#anchorState`, M3-3), the
   * request's environment (`#contested`, M3-4), and a question to the user that would retire it (M4-6): the user's
   * word stays served until they answer, but never as if nothing rivalled it.
   * @param {any} claim @param {ReturnType<AnchorCheck["run"]>} check @param {import("./request-env.js").RequestEnv | null} env
   * @returns {{ hold: boolean, changed: boolean, flags: string[] }}
   */
  #standing(claim, check, env) {
    const anchored = this.#anchorState(claim, check);
    const contest = env ? this.#contested(claim, env) : null;
    const asked = this.archive.inbox.asking().get(claim.id);
    return {
      hold: HOLDS.has(anchored?.state ?? "") || !!contest,
      changed: anchored?.state === "changed",
      flags: [
        ...anchorFlags(anchored),
        ...(contest ? [contest.elsewhere ? `of another project: here ${contest.says}` : `contested: the environment says ${contest.says}`] : []),
        ...askedFlags(asked),
      ],
    };
  }
  /**
   * A claim's standing as a view shows it (HarnessV3-Memory M6-1): its files as they are now and a question about it.
   * Read only: a file that moved is recorded when recall or a session's turn looks (`#anchorState`), never by a view.
   * @param {any} claim @param {ReturnType<AnchorCheck["run"]>} check @param {Map<number, any>} asking  the open questions by claim (`inbox.asking`)
   * @returns {{ held: boolean, changed: boolean, flags: string[] }}
   */
  #standingNow(claim, check, asking) {
    const rows = this.archive.anchors.of(claim.id);
    const anchored = rows.length ? worstOf(rows.map((a) => check(a))) : null;
    return {
      held: HOLDS.has(anchored?.state ?? ""),
      changed: anchored?.state === "changed",
      flags: [...anchorFlags(anchored), ...askedFlags(asking.get(claim.id))],
    };
  }
  /**
   * L0, the constitution (M3-6, M3-D9): the user's own rules, preferences and conventions — said, corrected or
   * confirmed by them — of the project and global, oldest first, in `room` characters (the first one always shows,
   * however long its line). Never ranked against facts, never faded; one held back by its files or the environment
   * stays out, and each is looked at only as far as the room goes. What does not fit is counted, never dropped in
   * silence (the count can include one not looked at that would be held back). Learned ones stay in recall, where
   * confidence ranks them. `except`: the ids a briefing riding beside it already shows (a brief's, M7-D9), neither
   * shown again nor counted as more.
   * @param {any} sit @param {number} room @param {Set<string> | null} [except]
   * @returns {{ text: string, shown: { kind: string, id: string, text: string, flags: string[] }[], rules: number, held: number }}
   */
  #constitution(sit, room, except = null) {
    const rules = this.archive.items.usersWord(sit.project.id, [...STANDING_KINDS]);
    const shown = [];
    const lines = [];
    let used = 0;
    let held = 0;
    let riding = 0;
    for (const it of rules.rows()) {
      if (except?.has(itemRef(it.id))) {
        riding++;
        continue;
      }
      const st = this.#standing(it, sit.fileCheck, sit.env);
      if (st.hold) {
        held++;
        continue;
      }
      const backed = 1 + Number(it.evidence);
      const r = { kind: it.kind, id: itemRef(it.id), text: it.text, when: dateOf(it.created_at), trust: trustOf(it), flags: [...(backed >= 2 ? [`✓${backed}`] : []), ...st.flags] };
      const line = memoryLine(r, 260);
      if (lines.length && used + line.length > room) break;
      lines.push(line);
      shown.push(r);
      used += line.length;
    }
    const more = rules.count - shown.length - held - riding;
    const text = lines.length ? ["The user's rules and preferences (their own word):", ...lines, ...(more ? [`…and ${more} more; filament_memory_search finds them.`] : [])].join("\n") : "";
    return { text, shown, rules: rules.count, held };
  }
  /**
   * L1, the project's dossier (M4-7, MD-13): what a session should know of the project before it starts, after the
   * user's rules, in `room` characters (its first line always shows). The curator's latest version when there is one: a
   * line shows only while every claim it cites stands and is not held back (M4-D4, M4-D10), so a retired claim leaves it
   * at once, whatever version was written — and while no session it cites is one memory keeps to itself now
   * (`keptToItself`: Memory settings came to leave it out, or every turn of it was kept apart), whose words it holds;
   * the claims that earned a place since follow it. With no version (the curator
   * off, or not yet run) it is rendered from the project's claims by kind (M4-D5), a procedure listed by its goal
   * (M5-6). What does not fit is counted. A brief's (M7-1) passes `except`, the ids a briefing riding beside it already
   * shows (M7-D9): a line that cites only those, and such a claim since, is left to that briefing; and `pitfalls: false`:
   * a line that rests only on pitfalls, and such a claim since, is left to the brief's own layer, which says the ones of
   * the worker's hands (M7-D14).
   * @param {any} sit @param {number} room @param {{ except?: Set<string> | null, pitfalls?: boolean }} [o]
   * @returns {{ text: string, version: number | null, shown: { id: string, text: string, flags: string[], byGoal?: boolean }[], lines: number, hidden: number, more: number }}
   */
  #dossierBlock(sit, room, { except = null, pitfalls = true } = {}) {
    const pid = sit.project.id;
    if (!pid || pid === NO_PROJECT_ID) return { text: "", version: null, shown: [], placed: [], lines: 0, hidden: 0, more: 0 };
    const d = this.archive.dossiers.latest(pid);
    /** @type {{ section: string, text: string, flags: string[], line: string, cites: { id: string, text: string, flags: string[], byGoal?: boolean }[] }[]} */
    const rows = [];
    let hidden = 0;
    let unused = 0;
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    const citedItems = d ? [...new Set(d.cites)].map((id) => this.archive.items.get(Number(id))).filter(Boolean) : [];
    const use = citedItems.length ? this.dossierUse(citedItems, (it) => this.archive.triggers.of(it.id).length > 0) : new Map();
    if (d)
      for (const sec of d.sections)
        for (const l of sec.lines) {
          if (l.cites.some((/** @type {string} */ c) => /^s:/.test(c) && this.keptToItself(c.slice(2), keptAside))) {
            hidden++;
            continue;
          }
          const claims = l.cites.filter((c) => /^i\d+$/.test(c)).map((c) => this.archive.items.get(Number(c.slice(1))));
          if (except && claims.length && claims.every((it) => it && except.has(itemRef(it.id)))) continue;
          if (!pitfalls && claims.length && claims.every((it) => it && this.archive.triggers.of(it.id).length)) continue;
          const standing = claims.map((it) => (it && !isRetired(it.status) ? this.#standing(it, sit.fileCheck, sit.env) : null));
          if (standing.some((st) => !st || st.hold)) {
            hidden++;
            continue;
          }
          // Every claim it rests on went unused (f3): left out now, as the curator's next version leaves it, and counted.
          if (claims.length && claims.every((it) => use.get(it.id)?.unused)) {
            unused++;
            continue;
          }
          // A claim's file that changed since is said on its line, as recall says it (M3-3): the curator checks it next.
          const flags = [...new Set(standing.flatMap((st) => st?.flags || []))];
          rows.push({
            section: sec.title,
            text: l.text,
            flags,
            line: `- ${l.text} [${l.cites.join(", ")}${flags.length ? ` · ${flags.join(" · ")}` : ""}]`,
            cites: claims.map((it) => ({ id: itemRef(it.id), text: l.text, flags, ...(it.kind === "procedure" ? { byGoal: true } : {}) })),
          });
        }
    const cited = new Set(d ? d.cites : []);
    for (const ref of except || []) if (/^i\d+$/.test(ref)) cited.add(Number(ref.slice(1)));
    const fresh = this.#dossierClaims(sit, { since: d ? d.created_at : 0, skip: cited, pitfalls });
    // A procedure is listed by its goal (M5-6): its steps come with a task that names it.
    for (const r of fresh.rows) {
      const byGoal = r.kind === "procedure";
      rows.push({
        section: d ? `New since v${d.version}` : r.section,
        text: byGoal ? procedureHead(r.text) : r.text,
        flags: r.flags,
        line: memoryLine(byGoal ? { ...r, text: procedureHead(r.text) } : r, 200),
        cites: [{ id: r.id, text: r.text, flags: r.flags, ...(byGoal ? { byGoal } : {}) }],
      });
    }
    if (!d) rows.sort((a, b) => DOSSIER_SECTIONS.indexOf(a.section) - DOSSIER_SECTIONS.indexOf(b.section));
    const head = d
      ? `The project's dossier (v${d.version}, ${dateOf(d.created_at)}; each line ends with the memories it rests on):`
      : "The project's dossier (its standing memories, by kind):";
    const out = [head];
    const shown = [];
    /** @type {(typeof rows[number] & { page?: string })[]} */
    const placed = [];
    let used = head.length;
    let section = "";
    let n = 0;
    const linkOf = this.#pageLinker(pid, sit);
    for (const row of rows) {
      // A line links to the topic page that rests on its claims (f7), each page once.
      const page = linkOf(row.cites.map((c) => c.id));
      const line = page ? `${row.line} → page:${page.slug}` : row.line;
      const add = (row.section !== section ? row.section.length + 2 : 0) + line.length + 1;
      if (n && used + add > room) break;
      page?.take();
      if (row.section !== section) out.push(`${row.section}:`);
      section = row.section;
      out.push(line);
      shown.push(...row.cites.map((c, i) => (page && !i ? { ...c, page: page.slug } : c)));
      placed.push(page ? { ...row, page: page.slug } : row);
      used += add;
      n++;
    }
    const more = rows.length - n + fresh.capped + unused;
    if (more) out.push(`…and ${more} more line${more === 1 ? "" : "s"}; filament_memory_search finds them.`);
    return { text: n ? out.join("\n") : "", version: d?.version ?? null, shown, placed, lines: n, hidden, more };
  }
  /**
   * How use weighs on the dossier's claims (the memory plan's f3), for the curator's and a dossier rendered from claims
   * alike: each claim's weight by its use rate over its last USE_LAST judged turn showings (`useWeight`), and whether
   * it is `unused` - the
   * briefings of DOSSIER_UNUSED_SESSIONS sessions showed it since it was last used, and it does not keep its place
   * (`keepsItsPlace`). → by claim id. @param {any[]} items @param {(it: any) => boolean} pitfall
   * @returns {Map<number, { weight: number, unused: boolean }>}
   */
  dossierUse(items, pitfall) {
    /** @type {Map<number, { weight: number, unused: boolean }>} */
    const out = new Map();
    if (!items.length) return out;
    const counts = this.archive.injections.recentUse(items.map((it) => itemRef(it.id)), "turn", USE_LAST);
    const fading = items.filter((it) => !keepsItsPlace(it, pitfall(it)));
    const unusedIn = fading.length ? this.archive.injections.briefedSinceUse(fading.map((it) => itemRef(it.id))) : new Map();
    for (const it of items) out.set(it.id, { weight: useWeight(counts.get(itemRef(it.id))), unused: (unusedIn.get(itemRef(it.id)) || 0) >= DOSSIER_UNUSED_SESSIONS });
    return out;
  }
  /**
   * A topic page as it reads now (the memory plan's f7): its lines whose every claim stands and is not held back — a
   * retired claim's line leaves at once, whatever version was written, as the dossier's does — each ending with the
   * claims it rests on and their flags. Its `text` is empty where fewer than PAGE_SHOWN lines are left: no page.
   * @param {any} p  a row of `archive.pages` @param {{ fileCheck: any, env: any }} sit
   * @returns {{ text: string, cites: string[], lines: number, hidden: number }}
   */
  pageBlock(p, sit) {
    const out = [];
    /** @type {Set<string>} */
    const cites = new Set();
    let hidden = 0;
    let n = 0;
    let section = "";
    // Each claim still the one it was written from, of the page's project (a chat moved to another takes its claims).
    const from = new Map((p.sources || []).map((/** @type {[number, string]} */ [id, h]) => [Number(id), h]));
    const same = (/** @type {any} */ it) => it && !isRetired(it.status) && it.project_id === p.project_id && from.get(it.id) === pageSource(it)[1];
    for (const sec of p.sections)
      for (const l of sec.lines) {
        const claims = l.cites.filter((/** @type {string} */ c) => /^i\d+$/.test(c)).map((/** @type {string} */ c) => this.archive.items.get(Number(c.slice(1))));
        const standing = claims.map((/** @type {any} */ it) => (same(it) ? this.#standing(it, sit.fileCheck, sit.env) : null));
        if (!claims.length || standing.some((st) => !st || st.hold)) {
          hidden++;
          continue;
        }
        const flags = [...new Set(standing.flatMap((st) => st?.flags || []))];
        if (sec.title !== section) out.push(`${sec.title}:`);
        section = sec.title;
        out.push(`- ${l.text} [${l.cites.join(", ")}${flags.length ? ` · ${flags.join(" · ")}` : ""}]`);
        for (const c of l.cites) cites.add(c);
        n++;
      }
    if (n < PAGE_SHOWN) return { text: "", cites: [], lines: n, hidden };
    const head = `Topic page "${p.title}" (page:${p.slug}, v${p.version}, ${dateOf(p.created_at)}; each line ends with the memories it rests on):`;
    return { text: [head, ...out].join("\n"), cites: [...cites], lines: n, hidden };
  }
  /**
   * Which topic page a dossier line links to (the memory plan's f7): of the project's pages, the one written on the most
   * of the line's claims whose lines, as they read now, rest on one of them; each page once, `take`n by the line placed
   * with it. Each page read once a dossier, only where a line could link to it. @param {string} pid @param {any} sit
   * @returns {(ids: string[]) => { slug: string, take: () => void } | null}
   */
  #pageLinker(pid, sit) {
    const pages = this.archive.pages.list(pid);
    if (!pages.length) return () => null;
    /** @type {Map<string, Set<string> | null>} */
    const live = new Map();
    /** @type {Set<string>} */
    const linked = new Set();
    return (ids) => {
      const ranked = pages
        .filter((p) => !linked.has(p.slug))
        .map((p) => ({ p, n: ids.filter((id) => p.cites.includes(Number(String(id).slice(1)))).length }))
        .filter((x) => x.n > 0)
        .sort((a, b) => b.n - a.n || a.p.slug.localeCompare(b.p.slug));
      for (const { p } of ranked) {
        if (!live.has(p.slug)) {
          const b = this.pageBlock(p, sit);
          live.set(p.slug, b.text ? new Set(b.cites) : null);
        }
        const now = live.get(p.slug);
        if (now && ids.some((id) => now.has(id))) return { slug: p.slug, take: () => linked.add(p.slug) };
      }
      return null;
    };
  }
  /**
   * The topic page a search names (`page:<slug>`, the memory plan's f7), of the asker's project, as a result; null for
   * none, or one with too few lines left. @param {string | null} projectId @param {string} slug @param {any} env
   */
  #namedPage(projectId, slug, env) {
    if (!projectId || projectId === NO_PROJECT_ID) return null;
    const p = this.archive.pages.bySlug(projectId, slug.toLowerCase());
    const b = p ? this.pageBlock(p, { fileCheck: this.anchorCheck.run(), env }) : null;
    return p && b?.text ? pageHit(p, b, 1, []) : null;
  }
  /**
   * A search's results with the topic pages that answer it (the memory plan's f7), of the asker's project: each page
   * whose lines, as they read now, rest on PAGE_HITS of the claims found or more — those a third of what its lines rest
   * on (PAGE_SHARE), or the page no longer than they are — in the place of the first of them, and those claims, which
   * its lines carry with their ids, left out (`covers`): a question several claims of one topic answer is answered by
   * the page in fewer words, and a narrow one is not handed a page of other things. At most PAGE_SERVED pages.
   * @param {any[]} items @param {string | null} projectId @param {any} env
   */
  #withPages(items, projectId, env) {
    if (!projectId || projectId === NO_PROJECT_ID) return items;
    const sit = { fileCheck: this.anchorCheck.run(), env };
    const found = new Set(items.filter((it) => /^i\d+$/.test(String(it.id))).map((it) => String(it.id)));
    if (found.size < PAGE_HITS) return items;
    const cands = this.archive.pages
      .list(projectId)
      .map((p) => ({ p, n: p.cites.filter((/** @type {number} */ id) => found.has(itemRef(id))).length }))
      .filter((x) => x.n >= PAGE_HITS)
      .sort((a, b) => b.n - a.n || a.p.slug.localeCompare(b.p.slug));
    let out = items;
    let served = 0;
    for (const { p } of cands) {
      if (served >= PAGE_SERVED) break;
      const b = this.pageBlock(p, sit);
      if (!b.text) continue;
      const covered = out.filter((it) => b.cites.includes(it.id));
      const covers = new Set(covered.map((it) => String(it.id)));
      if (covers.size < PAGE_HITS) continue;
      if (covers.size < b.cites.length * PAGE_SHARE && b.text.length > covered.reduce((n, it) => n + String(it.text ?? "").length, 0)) continue;
      const at = out.findIndex((it) => covers.has(it.id));
      const score = Math.max(...covered.map((it) => Number(it.score) || 0));
      out = [...out.slice(0, at), pageHit(p, b, score, [...covers]), ...out.slice(at).filter((it) => !covers.has(it.id))];
      served++;
    }
    return out;
  }
  /**
   * A project's topic pages as a search serves them now (the memory plan's f7): each topic's newest version, its text,
   * what wrote it, how many lines show and how many its retired or held claims hide. Null for no project.
   * @param {string} projectId
   */
  pagesOf(projectId) {
    const project = this.archive.getProject(projectId);
    if (!project) return null;
    const sit = { fileCheck: this.anchorCheck.run(), env: null };
    return {
      project: project.id,
      pages: this.archive.pages.list(project.id).map((p) => {
        const b = this.pageBlock(p, sit);
        return { slug: p.slug, title: p.title, topic: p.topic, version: p.version, written: { at: p.created_at, model: p.model, run: p.run_id != null ? `r${p.run_id}` : null }, text: b.text, lines: b.lines, hidden: b.hidden, cites: b.cites };
      }),
    };
  }
  /**
   * The claims a dossier rendered from claims shows (M4-D11): of those that earned a place (`items.dossierPool`: the
   * user said or confirmed it, or two sessions did, or it is an open thread, the user's own rules aside, which L0
   * shows), the ones memory is sure of (M3-6), not held back and not left for going unused (`dossierUse`, f3), most
   * sure, important and used first, at most
   * `SECTION_LINES` a section (`capped`: how many more), each under its section (`sectionOf`: a pitfall under Pitfalls,
   * M5-7). A fragment of code or markup filed before the learner's filter never shows, confirmed or not (HarnessV2
   * F11); a procedure and a pitfall are not taken for one. `pitfalls: false` leaves the pitfalls out (a brief's).
   * @param {any} sit @param {{ since: number, skip: Set<number>, pitfalls?: boolean }} o @returns {{ rows: any[], capped: number }}
   */
  #dossierClaims(sit, { since, skip, pitfalls = true }) {
    const pool = this.archive.items.dossierPool(sit.project.id, { since });
    const counts = this.archive.items.eventCounts(pool.map((it) => it.id));
    const use = this.dossierUse(pool, (it) => !!it.triggered);
    const now = this.now();
    const scored = [];
    let unused = 0;
    for (const it of pool) {
      // A procedure's steps and a pitfall's commands are what they say (M5-7), not a fragment of code.
      if (skip.has(it.id) || (!pitfalls && it.triggered) || (it.kind !== "procedure" && !it.triggered && looksLikeCode(it.text))) continue;
      const u = use.get(it.id);
      const rec = counts.get(it.id) || { evidence: 0 };
      const st = this.#standing(it, sit.fileCheck, sit.env);
      if (st.hold) continue;
      const sure = confidenceOf(it, { ...rec, changed: st.changed }, now);
      if (sure < CONFIDENCE_GATE) continue;
      // Left for going unused (f3): counted with what does not fit, so "…and N more" says search finds it.
      if (u?.unused) {
        unused++;
        continue;
      }
      const backed = 1 + rec.evidence;
      const r = { kind: it.kind, id: itemRef(it.id), text: it.text, when: dateOf(it.created_at), trust: trustOf(it), flags: [...(backed >= 2 ? [`✓${backed}`] : []), ...st.flags], section: sectionOf(it) };
      scored.push({ r, score: sure * (Number(it.importance) || 0.6) * (u?.weight ?? 1), id: it.id });
    }
    scored.sort((a, b) => b.score - a.score || b.id - a.id);
    /** @type {Record<string, number>} */
    const per = {};
    const rows = scored.filter((x) => (per[x.r.section] = (per[x.r.section] || 0) + 1) <= SECTION_LINES).map((x) => x.r);
    return { rows, capped: scored.length - rows.length + unused };
  }
  /**
   * The request's environment contradicting a claim's value (M3-4), or null. Contested is no status (M3-D4): the claim
   * stands, and is held back while the contradiction holds. A `contested` event records each value the environment was
   * seen to hold against it, once — for this project's claims and global ones; another project's is `elsewhere`.
   * @param {any} claim @param {import("./request-env.js").RequestEnv} env
   * @returns {{ cls: string, value: string, says: string, elsewhere?: boolean } | null}
   */
  #contested(claim, env) {
    const c = environmentSays(valuesOf(claim), env);
    if (!c) return null;
    // The environment speaks for its own project (M3-D26). Another project's claim says what that project is like: it
    // would mislead here, so it is held back, but nothing here says it is wrong, so no event.
    if (claim.project_id != null && claim.project_id !== env.project) return { ...c, elsewhere: true };
    const key = `${claim.id}\0${c.cls}\0${c.says}`;
    if (!this.contestedSeen.has(key)) {
      this.contestedSeen.add(key);
      if (!this.archive.items.events(claim.id).some((e) => e.action === "contested" && e.detail?.class === c.cls && e.detail?.says === c.says))
        this.archive.items.note(claim.id, "contested", { by: "filament", detail: { class: c.cls, value: c.value, says: c.says } });
    }
    return c;
  }

  /**
   * The project's procedures whole, for a briefing with no task yet (M5-6 lists them by goal for a task to name): the
   * ones memory is sure of and that are not held back, most sure and important first, each as recall would serve it, in
   * `room` characters.
   * @param {any} sit @param {number} room
   * @returns {{ text: string, shown: { kind: string, id: string, text: string, when: string, trust: string, flags: string[] }[] }}
   */
  #proceduresWhole(sit, room) {
    const pool = this.archive.items.procedures(sit.project.id);
    const counts = this.archive.items.eventCounts(pool.map((/** @type {any} */ it) => it.id));
    const now = this.now();
    const ranked = [];
    for (const it of pool) {
      const rec = counts.get(it.id) || { evidence: 0 };
      const st = this.#standing(it, sit.fileCheck, sit.env);
      if (st.hold) continue;
      const sure = confidenceOf(it, { ...rec, changed: st.changed }, now);
      if (sure < CONFIDENCE_GATE) continue;
      const backed = 1 + rec.evidence;
      const r = { kind: it.kind, id: itemRef(it.id), text: it.text, when: dateOf(it.created_at), trust: trustOf(it), flags: [...(backed >= 2 ? [`✓${backed}`] : []), ...st.flags] };
      ranked.push({ r, score: sure * (Number(it.importance) || 0.6), id: it.id });
    }
    ranked.sort((a, b) => b.score - a.score || b.id - a.id);
    const head = "How things are done in this project (its procedures, whole):";
    const out = [head];
    const shown = [];
    let used = head.length;
    for (const { r } of ranked) {
      const line = memoryLine(r, PROCEDURE_CHARS);
      if (used + line.length + 1 > room) continue;
      out.push(line);
      shown.push(r);
      used += line.length + 1;
    }
    return { text: shown.length ? out.join("\n") : "", shown };
  }
  /**
   * Where the request's repository stands, for the briefing (the owner's of 10-29): read by the git adapter the
   * composition root hands memory (`repoState`; memory reads no git itself), let go past `STANDING_WAIT_MS` — never
   * waited on longer —; null without an absolute folder, a reader or a repository.
   * @param {any} sit @returns {Promise<import("../../core/repo-standing.js").RepoStanding | null>}
   */
  async #standingOf(sit) {
    const cwd = sit.project?.cwd;
    if (!cwd || !isAbsolute(cwd) || !this.repoState || sit.project.id === NO_PROJECT_ID) return null;
    /** @type {any} */
    let timer = null;
    const late = new Promise((done) => {
      timer = setTimeout(() => done(null), STANDING_WAIT_MS);
      timer.unref?.();
    });
    try {
      return await Promise.race([Promise.resolve().then(() => this.repoState(cwd)).catch(() => null), late]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * What holds in every project (the memory plan's f5): the user's own word of no project — the facts and decisions they
   * said, corrected or confirmed: kept everywhere from a project's (memory's question `everywhere`), set on the Memory
   * page, or said outside any — in `room` characters, IDENTITY_LINES at most, one in a slot about them first. What does
   * not fit is counted. @param {any} sit @param {number} room
   */
  #everywhereLines(sit, room) {
    const rows = [...this.archive.items.usersWord(null, EVERYWHERE_KINDS).rows()];
    const aboutThem = (/** @type {any} */ it) => aboutUser(it.slot);
    const shown = [];
    const lines = [];
    let used = 0;
    for (const it of [...rows.filter(aboutThem), ...rows.filter((it) => !aboutThem(it))]) {
      if (shown.length >= IDENTITY_LINES) break;
      const st = this.#standing(it, sit.fileCheck, sit.env);
      if (st.hold) continue;
      const r = { kind: it.kind, id: itemRef(it.id), text: it.text, when: dateOf(it.created_at), trust: trustOf(it), flags: st.flags };
      const line = memoryLine(r, 200);
      if (used + line.length > room) break;
      lines.push(line);
      shown.push(r);
      used += line.length;
    }
    const more = rows.length - shown.length;
    const text = lines.length ? ["What holds in every project (the user's own word):", ...lines, ...(more > 0 ? [`…and ${more} more; filament_memory_search finds them.`] : [])].join("\n") : "";
    return { text, shown, facts: rows.length };
  }
  /**
   * The user's word that holds in every project, each in a slot about them (the memory plan's f5): the Memory page's
   * Identity facts. @returns {{ id: string, name: string, body: string, trust: string }[]}
   */
  identityFacts() {
    return [...this.archive.items.usersWord(null, EVERYWHERE_KINDS).rows()]
      .filter((it) => aboutUser(it.slot))
      .map((it) => ({ id: itemRef(it.id), name: String(it.slot).slice(USER_SLOT.length), body: String(it.text), trust: trustOf(it) }));
  }
  /**
   * Set a fact about the user that holds in every project, by its name (the Memory page, f5): the standing one of that
   * name is corrected to the words, else they are remembered in its slot — beside the others where the slot holds
   * several values (a language they write). @param {string} name @param {string} body @param {{ by: any }} o
   */
  async setIdentity(name, body, { by }) {
    const slot = `${USER_SLOT}${slotNorm(name)}`;
    const there = this.archive.items.inSlot(null, slot);
    const had = there.find((it) => !it.slot_multi);
    if (had) return norm(had.text) === norm(body) ? { ok: true, id: itemRef(had.id), unchanged: true } : this.correct(itemRef(had.id), { text: body, by, reason: "set on the Memory page" });
    const r = await this.remember(body, { kind: "fact", projectId: null, by });
    const to = { slot, value: null, multi: there.length > 0 };
    if (r.itemId != null && !this.archive.items.get(r.itemId)?.slot)
      this.archive.transaction(() => {
        this.archive.items.setSlot(r.itemId, to);
        this.archive.items.note(r.itemId, "slot", { by, detail: { from: null, to } });
      });
    return { ok: true, ...r };
  }
  /**
   * Retire a fact about the user that holds in every project (the Memory page, f5): by its id — of a slot that holds
   * several, the one asked — else by its name. @param {{ id?: string, name?: string }} which @param {{ by: any }} o
   */
  async forgetIdentity({ id, name }, { by }) {
    const facts = this.identityFacts();
    const had = id ? facts.find((f) => f.id === String(id)) : facts.find((f) => slotNorm(f.name) === slotNorm(name));
    return had ? this.forget(had.id, { by, reason: "removed on the Memory page" }) : { ok: false, error: `no fact about the user ${id ? clip(String(id), 20) : `named ${clip(String(name ?? ""), 60)}`} holds in every project` };
  }

  /**
   * The session's briefing (once per chain, kept byte-stable): the user's rules (L0) and identity first, then each
   * block in its share of the room left (`BRIEFING_SHARES`), so none starves another (the owner's of 10-29: the recent
   * sessions, which said the perf work was merged, never fit behind a full dossier while recall on "hello" took the
   * rest) — the dossier (L1), the procedures whole where there is no task yet, where the repository stands (read by git
   * as the session starts, never from memory), the effort's arc and the project's recent sessions, and recall on the
   * first message where it holds a task.
   */
  async buildBriefing({ chain, sit, signals }) {
    const { auto } = this.settingsFor(sit);
    const budget = Math.max(300, auto.briefingTokens || BRIEFING_TOKENS) * 4;
    // The repository is read while memory is: asked first, waited on beside recall.
    const reading = this.#standingOf(sit);
    // A first message with no task in it — no word to search by: "hello", "thanks", "ok" —: no recall, which would rank
    // the project's claims against a greeting; its room to the dossier, and the project's procedures whole (with a
    // task, M5-6 lists them by goal). A short task ("fix lint") has its words: recalled for.
    const task = (signals?.keywords?.length ?? 0) > 0;
    sit.fileCheck ??= this.anchorCheck.run();
    const lines = [];
    const ids = [];
    const pairs = [];
    let count = 0;
    const sourcesSet = new Set();
    const tr = currentTrace();
    // L0 (M3-6): the user's own rules and preferences open the briefing, in a quarter of its budget.
    const rules = this.#constitution(sit, budget * 0.25);
    if (rules.text) lines.push(rules.text);
    for (const it of rules.shown) {
      ids.push(it.id);
      pairs.push([it.id, it.text]);
    }
    count += rules.shown.length;
    if (rules.shown.length) sourcesSet.add("rules");
    tr?.step("the user's rules", {
      rules: rules.rules,
      shown: rules.shown.length,
      heldBack: rules.held || undefined,
      note: "L0: the user's own rules and preferences, first, in a quarter of the briefing",
    });
    // What holds in every project (the memory plan's f5): the user's word of no project, after their rules.
    const about = this.#everywhereLines(sit, budget * IDENTITY_SHARE);
    if (about.text) lines.push(about.text);
    for (const it of about.shown) {
      ids.push(it.id);
      pairs.push([it.id, it.text]);
    }
    count += about.shown.length;
    if (about.shown.length) sourcesSet.add("identity");
    tr?.step("in every project", {
      facts: about.facts,
      shown: about.shown.length,
      note: `the user's word that holds in every project: ${IDENTITY_LINES} at most, in a tenth of the briefing`,
    });
    const project = sit.project;
    if (project.cwd) lines.push(`Project: ${project.name} (${project.cwd}).`);
    // Memory's tools are named only where they are offered (the owner's of 10-28): a model told of one it was not given
    // calls it all the same, and the call is answered as a tool it does not have.
    const toolsNamed = auto.tools !== false && this.storeReady();
    const head = briefingHead(toolsNamed);
    // Each block below has its share of what the rules and identity left, whatever the others place. The header and the
    // tools' line are the briefing's too (d2): counted in its budget, as the legends are below.
    let used = lines.join("\n").length + head.length + 1 + (toolsNamed ? BRIEFING_TOOLS.length + 1 : 0);
    const rest = Math.max(0, budget - used);
    const shares = task ? BRIEFING_SHARES.task : BRIEFING_SHARES.none;
    /** @param {keyof typeof BRIEFING_SHARES.task & keyof typeof BRIEFING_SHARES.none} block */
    const roomOf = (block) => rest * (shares[block] || 0);
    /** @type {{ howTo: string, dossier: string, lineage: string, sessions: string }} the blocks, worded in reading order below */
    const blocks = { howTo: "", dossier: "", lineage: "", sessions: "" };
    // With no task yet, the project's procedures whole (M5-6 lists them by goal, for a task to name): the dossier leaves
    // a line that cites only them to this block.
    /** @type {any[]} */
    const wholeShown = [];
    if (!task && project.id !== NO_PROJECT_ID) {
      const howTo = this.#proceduresWhole(sit, roomOf("howTo"));
      if (howTo.text) {
        blocks.howTo = howTo.text;
        used += howTo.text.length + 1;
        for (const r of howTo.shown) {
          ids.push(r.id);
          pairs.push([r.id, r.text]);
          wholeShown.push(r);
        }
        count += howTo.shown.length;
        sourcesSet.add("procedures");
      }
      tr?.step("the project's procedures, whole", { shown: howTo.shown.length, note: "no task in the first message to match a goal against, so the procedures come whole" });
    }
    // L1 (M4-7): the project's dossier, after the user's rules, in its share (more where recall has none). The claims it
    // cites are recorded as shown, so errata follow them, and recall does not serve them again.
    const dossier = this.#dossierBlock(sit, roomOf("dossier"), { except: wholeShown.length ? new Set(wholeShown.map((r) => r.id)) : null });
    if (dossier.text) {
      blocks.dossier = dossier.text;
      used += dossier.text.length + 1;
      for (const c of dossier.shown) {
        if (!ids.includes(c.id)) ids.push(c.id);
        pairs.push([c.id, c.text]);
      }
      count += dossier.lines;
      sourcesSet.add("dossier");
    }
    // A procedure the dossier lists by its goal was not shown whole (M5-6): recall may still serve its steps. One shown
    // whole above is not, though a dossier line citing it beside another claim stays: its steps are told.
    const wholeIds = new Set(wholeShown.map((r) => r.id));
    const listed = new Set(dossier.shown.filter((c) => c.byGoal && !wholeIds.has(c.id)).map((c) => c.id));
    tr?.step("the project's dossier", {
      version: dossier.version ?? (dossier.lines ? "rendered from claims" : undefined),
      lines: dossier.lines,
      hidden: dossier.hidden || undefined,
      more: dossier.more || undefined,
      note:
        dossier.version != null
          ? "L1: the curator's latest version; a line whose claims no longer all stand is hidden"
          : "L1: no version written yet, so rendered from the project's claims by kind",
    });
    // The effort's arc: parent sessions joined by continues links, oldest first, with their end
    // states. Members of the arc are named here, so they need not appear again as "recent". Its line comes out of the
    // recent sessions' share. Neither names a chat Memory settings leave out (`keptToItself`).
    const related = [];
    let sessionsRoom = roomOf("sessions");
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    const anc = this.lineageOf(chain).filter((a) => !this.keptToItself(a.id, keptAside));
    const arcIds = new Set(anc.map((a) => a.id));
    if (anc.length) {
      tr?.step("lineage walked", { sessions: anc.length, note: "parent sessions joined by continues links" });
      const parts = [...anc]
        .reverse()
        .slice(-4)
        .map((a) => {
          const st = parse(a.state_json) || {};
          const title = this.titleFor(a);
          return `session ${a.id}${title ? ` "${clip(title, 40)}"` : ""}${st.summary ? ` — ${clip(st.summary, 140)}` : ""}`;
        });
      const line = `This session continues an effort (${anc.length + 1} session${anc.length === 0 ? "" : "s"} so far): ${parts.join(" → ")}.`;
      if (line.length < sessionsRoom) {
        blocks.lineage = line;
        used += line.length + 1;
        sessionsRoom -= line.length + 1;
        sourcesSet.add("lineage");
        // The chats it continues are the briefing's too: the note names them first, as it names the recent ones.
        related.push(...[...anc].reverse().slice(-4).map((a) => ({ id: a.id, title: this.titleFor(a), date: dateOf(a.last_at || a.started_at), continues: true })));
      }
    }
    // Recent sessions of the project with their states, each where it was worked in when that is another folder. A
    // request in no folder has no project: the other folderless conversations are every app's and every chat's, none of
    // them its own (HarnessV3-AtHome AH-D1 — memory is on for everyone), so none is named as this project's.
    const chains =
      project.id === NO_PROJECT_ID
        ? []
        : this.archive.chainsForProject(project.id, { limit: SESSION_ROWS + 1 + anc.length, kinds: LISTED_KINDS }).filter((c) => c.id !== chain.id && !arcIds.has(c.id) && !this.keptToItself(c.id, keptAside));
    const here = project.cwd ? normalizeCwd(project.cwd) : "";
    // A chain keeps its folder only where it is not the project's own (`chainLookup`, GW-D47): one without was worked in
    // the project's folder.
    const home = project.home || (project.id !== NO_PROJECT_ID ? this.archive.getProject(project.id)?.cwd : "") || "";
    /**
     * A session's row: its title, day and folder, what it ended with (its summary, cut), and how much it left open — the
     * items themselves are the project's open threads, and `filament_memory_load` brings the session in (e1).
     * @param {any} c
     */
    const sessionRow = (c) => {
      const st = parse(c.state_json) || {};
      const date = dateOf(c.last_at || c.started_at);
      const folder = c.meta?.cwd || home;
      const open = Array.isArray(st.open) ? st.open.length : 0;
      const bits = [
        // One with no title is "untitled", never its first words: they can say again what the user retired or
        // corrected since (HarnessV4_Tasks U4, V4-D208).
        this.titleFor(c) ? `"${clip(String(this.titleFor(c)), 60)}"` : "untitled",
        date,
        folder && here && normalizeCwd(folder) !== here ? `in ${folder}` : null,
        st.summary ? clip(st.summary, SESSION_SUMMARY_CHARS) : null,
        open ? `${open} left open` : null,
      ]
        .filter(Boolean)
        .join(" — ");
      // Named by its title alone, as the briefing names it: an untitled chat's first words never ride the record (the
      // bug hunt of 10-27) — the page names it from its sessions list, as the sidebar does (HarnessV4_Tasks U4); its
      // day the briefing's own, which the page's note shows when opened (the owner's word of 10-27: "not sure what does
      // that memory contain at all") — its summary the note reads from the sessions list, never from the record.
      return { cue: { id: c.id, title: this.titleFor(c), date }, line: `- session ${c.id} ${bits}` };
    };
    // Each row where it fits its share, and the rest left out — never every row for one too long (the owner's of 10-29:
    // three rows that did not fit together left none).
    const sessionsHead = "Recent sessions in this project:";
    /** @type {{ cue: any, line: string }[]} */
    const rows = [];
    let size = sessionsHead.length;
    for (const c of chains.slice(0, SESSION_ROWS)) {
      const fits = sessionRow(c);
      if (size + fits.line.length + 1 > sessionsRoom) break;
      rows.push(fits);
      size += fits.line.length + 1;
    }
    tr?.step("recent sessions of the project", { sessions: chains.length, placed: rows.length });
    if (rows.length) {
      blocks.sessions = [sessionsHead, ...rows.map((x) => x.line)].join("\n");
      used += blocks.sessions.length + 1;
      count += rows.length;
      sourcesSet.add("sessions");
      // The note names only the chats the briefing did: one left out could name a chat the agent was never told of.
      related.push(...rows.map((x) => x.cue));
    }
    // Deep recall on the first message where it holds a task, beside the repository's read.
    const query = queryOf(sit.newest || sit.firstText, { max: 16 }) || project.name;
    const [r, standing] = await Promise.all([
      task
        ? this.retrieve({
            query,
            text: sit.newest || sit.firstText,
            projectId: project.id,
            mode: "briefing",
            limit: 14,
            entities: signals.entities,
            excludeChainId: chain.id,
            auto,
            check: sit.fileCheck,
            env: sit.env,
            excludeIds: new Set(ids.filter((id) => !listed.has(id))),
            // A caller that reaches its own project's sessions alone is recalled its project's memory alone.
            within: sit.confined ? project.id : undefined,
          })
        : { items: [], sources: "" },
      reading,
    ]);
    if (!task) tr?.step("no recall", { why: "the first message holds no task (a greeting, yes/no, very short): its room goes to the dossier" });
    // Where the repository stands and what happened in it lately: git's, read as the session starts — a memory of it
    // would go stale (the owner's of 10-29: "the perf work is not merged" was served while main held it).
    let repo = "";
    if (standing) {
      const st = standingBlock(standing, roomOf("standing"));
      repo = st.text;
      // Not counted as items: the count is of memories, and git's lines are none.
      used += st.text ? st.text.length + 1 : 0;
      if (st.lines) sourcesSet.add("git");
      tr?.step("where the repository stands", { lines: st.lines, worktrees: standing.worktrees.length, note: "read by git as this session starts, never from memory: this folder, its newest commit, the other worktrees in a line" });
    } else if (this.repoState && project.cwd) tr?.step("where the repository stands", { note: "not read: no repository there, or git did not answer in time" });
    lines.push(...[blocks.dossier, blocks.howTo, repo, blocks.lineage, blocks.sessions].filter(Boolean));
    const picked = [];
    const quoted = [];
    // What the legend explains: every flagged line the briefing shows, the dossier's and the procedures' too — a dossier
    // line's procedure shown whole is no "How to" line to ask the steps of.
    const shown = [...rules.shown, ...about.shown, ...wholeShown, ...dossier.shown.map((c) => (c.byGoal && wholeIds.has(c.id) ? { ...c, byGoal: undefined } : c))];
    // The legend a line brings is the line's cost too (d2): what the blocks above need is counted first.
    const legendChars = (/** @type {any[]} */ list) => {
      const n = legendOf(list).join("\n").length;
      return n ? n + 1 : 0;
    };
    let legend = legendChars(shown);
    used += legend;
    for (const it of procedureFirst(r.items)) {
      const line = memoryLine(it, 260);
      const more = legendChars([...shown, it]);
      if (used + line.length + more - legend > budget) continue;
      (EVIDENCE_KINDS.has(it.kind) ? quoted : picked).push(line);
      if (!ids.includes(it.id)) ids.push(it.id);
      listed.delete(it.id);
      pairs.push([it.id, it.text]);
      used += line.length + more - legend;
      legend = more;
      shown.push(it);
    }
    if (picked.length) lines.push(`Relevant memory:\n${picked.join("\n")}`);
    if (quoted.length) lines.push(`${EVIDENCE_HEAD}\n${quoted.join("\n")}`);
    lines.push(...legendOf(shown));
    if (picked.length || quoted.length) {
      count += picked.length + quoted.length;
      for (const s of r.sources.split("+")) if (s) sourcesSet.add(s);
    }
    if (toolsNamed) lines.push(BRIEFING_TOOLS);
    // Where the repository stands is material too: a briefing of git's lines alone is placed.
    if (!count && !toolsNamed && !repo)
      return { text: "", ids: [], listed: [], count: 0, tokens: 0, sources: "" };
    const text = [head, ...lines].join("\n");
    // The cue as data (Facade D5): the sentence any client shows is `cueText`'s over this, one function, one
    // wording — and the harness draws its memory note from the data instead of reading the sentence back.
    let cue = null;
    const askedIn = project.id === NO_PROJECT_ID ? null : project.id;
    const questions = sit.confined
      ? this.archive.inbox.list({ projectId: askedIn, status: "open", limit: 500 }).filter((q) => this.questionReaches(q, askedIn)).length
      : this.archive.inbox.count(askedIn);
    // Any briefing that named a memory has one — the user's rules, a fact about them or the dossier alone too (the bug
    // hunt of 10-27: the note waited for chats or recalled claims, so a briefing of rules alone showed none).
    if (auto.cue !== false && (related.length || ids.length || questions))
      // `told`: how many memories the briefing named in all — the page's note says it and, opened, reads their words
      // from the turn's memory: the record counts and never quotes.
      cue = {
        items: picked.length,
        told: ids.length,
        sessions: related.map((c) => ({ id: c.id, title: c.title || "", ...(c.date ? { date: c.date } : {}), ...(c.continues ? { continues: true } : {}) })),
        ...(questions ? { questions } : {}),
      };
    return { text, ids, listed: [...listed], count, tokens: est(text), sources: [...sourcesSet].join("+"), cue, pairs, dossier: dossier.version };
  }

  async buildTurnBlock({ chain, sit, signals, budgetTokens, excludeIds }) {
    const budget = budgetTokens * 4;
    const query = queryOf(sit.newest, { max: 16 });
    if (!query) return { text: "", ids: [], count: 0, tokens: 0 };
    const { auto } = this.settingsFor(sit);
    const run = (queries) =>
      this.retrieve({
        query,
        queries,
        text: sit.newest,
        projectId: sit.project.id,
        mode: "turn",
        limit: auto.mode === "conservative" ? 3 : 8,
        excludeIds,
        entities: signals.entities,
        excludeChainId: chain.id,
        auto,
        check: sit.fileCheck,
        env: sit.env,
        within: sit.confined ? sit.project.id : undefined,
      });
    let r = await run([]);
    // The rewriter, where it is on (`autopilot.rewrite`, off by default: the agent searches memory itself when it needs
    // more), is spent only when the base query proves thin: fewer than two survivors after the gates. On a message
    // whose own words already find the material, the call is skipped entirely (it could only recombine them).
    if (auto.rewrite === true && r.items.length < 2) {
      const variants = await this.rewriteQueries(sit.newest, chain.id);
      if (variants.length) r = await run(variants);
    } else if (auto.rewrite === true) {
      currentTrace()?.step("query rewrite skipped", {
        note: "the message's own keywords already found enough; no model call spent",
      });
    }
    if (!r.items.length) return { text: "", ids: [], count: 0, tokens: 0, top: r.top, excluded: r.excluded };
    const lines = [];
    const quoted = [];
    const ids = [];
    const pairs = [];
    const shown = [];
    let used = 0;
    for (const it of procedureFirst(r.items)) {
      const quote = EVIDENCE_KINDS.has(it.kind);
      if (quote && quoted.length >= TURN_QUOTES) continue;
      const line = memoryLine(it, 300);
      // The first line always shows: a procedure longer than the turn's room is still the one the task named.
      if ((lines.length || quoted.length) && used + line.length > budget) continue;
      (quote ? quoted : lines).push(line);
      ids.push(it.id);
      pairs.push([it.id, it.text]);
      used += line.length;
      shown.push(it);
    }
    if (!lines.length && !quoted.length) return { text: "", ids: [], count: 0, tokens: 0 };
    const legend = legendOf(shown);
    const text = [
      lines.length ? `${RELATED_HEAD}\n${lines.join("\n")}${legend.length ? `\n${legend.join("\n")}` : ""}` : null,
      quoted.length ? `${EVIDENCE_HEAD}\n${quoted.join("\n")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
    return { text, ids, count: lines.length + quoted.length, tokens: est(text), sources: r.sources, pairs };
  }

  /**
   * A brief (HarnessV3-Memory M7-1, M7-D1): what memory hands a worker that starts without the session's conversation
   * — a sub-agent or an outside agent — with its task, in the briefing's line format, each line with the
   * id it can cite, confirm or correct. In order: what the session it works for was shown that was retired since, as
   * errata (M7-D2), never as a fact; the user's rules (L0); the project's dossier (L1); the procedures whose goal the
   * task names, whole; the pitfalls of the tools it has, each said again at the call that walks into it; the open
   * threads on the files the task names; then what else memory holds that the task matches, in the room left. Empty,
   * saying why, where memory or its autopilot is off, the session is muted or — a sub-agent's — Memory settings leave
   * the session out, or the model its calls go out on (`model`, `subagentLeftOut`), and when nothing applies. What it
   * shows is logged as shown to the session (`brief`) on the scope's turn, so errata follow it and the turn's memory
   * lists it.
   * @param {{ projectId?: string | null, chainId?: string | null, turnId?: number | null, purpose?: string, task?: string, tools?: string[], budget?: number | null, within?: string, model?: string }} [o]
   *   `tools`: the tools it can run (a pitfall is kept under its tool, `triggerTool`); `budget`: tokens, by default the
   *   session's briefing — at most `BRIEF_TOKENS` of it — and turn block together; `within`: the project whose memory
   *   alone what the task matches is found in (a confined caller's, port.js)
   * @returns {Promise<{ text: string, ids: string[], count: number, tokens: number, layers: Record<string, number>, why?: string }>}
   */
  async brief({ projectId = null, chainId = null, turnId = null, purpose = "agent", task = "", tools = [], budget = null, within = /** @type {string | undefined} */ (undefined), model = "" } = {}) {
    const who = /** @type {Record<string, string>} */ (BRIEF_FOR)[purpose];
    if (!who) throw new Error(`memory: a brief is for ${Object.keys(BRIEF_FOR).join(", ")}; got ${purpose}`);
    const { auto, off } = this.cfg();
    const chain = chainId ? this.archive.getChain(String(chainId)) : null;
    const meta = parse(chain?.meta_json) || {};
    const none = (/** @type {string} */ why) => ({ text: "", ids: [], count: 0, tokens: 0, layers: {}, why });
    if (off) return none("memory is off in Memory settings");
    if (auto.enabled === false) return none("autopilot is off in Memory settings");
    if (meta.muted) return none("memory is off for the session");
    const out = purpose === "subagent" ? this.subagentLeftOut(chain?.id || "", model) : null;
    if (out) return none(out);
    const pid = projectId || NO_PROJECT_ID;
    const project = pid === NO_PROJECT_ID ? null : this.archive.getProject(pid);
    const root = project?.cwd || "";
    const check = this.anchorCheck.run();
    const env = requestEnv({ project: pid, cwd: root || null, tools, environment: meta.environment });
    const sit = { project: { id: pid, name: project?.name || "", cwd: root }, fileCheck: check, env };
    const room = Math.max(300, Number(budget) > 0 ? Number(budget) : Math.min(auto.briefingTokens || BRIEF_TOKENS, BRIEF_TOKENS) + (auto.turnTokens || 300)) * 4;
    const now = this.now();
    /** @type {string[]} */
    const lines = [];
    /** @type {string[]} */
    const ids = [];
    const add = (/** @type {string} */ id) => {
      if (!ids.includes(id)) ids.push(id);
    };
    const layers = { errata: 0, rules: 0, dossier: 0, procedures: 0, pitfalls: 0, threads: 0, related: 0 };
    // The session's briefing rides a sub-agent's requests where the session has one and its settings keep it on, as
    // prepare places it (M7-D9): what it shows (`briefingIds`: a procedure it only listed by goal is not among them) is
    // not said twice; what came since is. An outside agent's requests are not the session's: their brief says it all.
    const keeps = purpose === "subagent" && !!chain?.briefing && this.settingsOf?.(chain.id)?.effective?.memory?.briefing !== false;
    const riding = keeps ? new Set(meta.briefingIds || []) : null;
    // What the session was shown and has seen retired since: first, as errata, never as a fact (M7-D2).
    const errata = chain ? this.#retiredSince(chain.id) : [];
    if (errata.length) lines.push(errata.map(erratumLine).join("\n"));
    for (const e of errata) if (e.nowRef) add(e.nowRef);
    layers.errata = errata.length;
    const rules = this.#constitution(sit, room * 0.25, riding);
    if (rules.text) lines.push(rules.text);
    for (const r of rules.shown) add(r.id);
    layers.rules = rules.shown.length;
    if (root) lines.push(`Project: ${sit.project.name} (${root}).`);
    const dossier = this.#dossierBlock(sit, room * 0.35, { except: riding, pitfalls: false });
    if (dossier.text) lines.push(dossier.text);
    for (const c of dossier.shown) add(c.id);
    layers.dossier = dossier.lines;
    // A procedure the dossier lists by its goal comes whole when the task names that goal (M5-6); a pitfall a dossier
    // line cites beside other claims comes whole in the pitfalls layer, where its note is (M7-D15): the line gives the
    // curator's words, not the claim's.
    const listed = new Set(dossier.shown.filter((c) => c.byGoal).map((c) => c.id));
    const cited = new Set(dossier.shown.map((c) => c.id));
    const query = queryOf(task, { max: 16 });
    const found = query
      ? (await this.retrieve({ query, text: task, projectId: pid, mode: "briefing", limit: 12, unquoted: chain?.id ?? null, auto, check, env, excludeIds: new Set([...ids.filter((id) => !listed.has(id)), ...(riding || [])]), within })).items
      : [];
    /** @type {any[]} */
    const shown = [...rules.shown, ...dossier.shown];
    let used = lines.join("\n").length;
    /**
     * One line into a layer, once in the brief (a procedure listed by its goal once more, whole; a claim a dossier line
     * cited once more, whole, when `again`) and never what the riding briefing shows, when there is room for it — the
     * layer's first always, when `first`.
     * @param {string[]} into @param {any} it @param {string} line @param {boolean} [first] @param {boolean} [again]
     */
    const place = (into, it, line, first = false, again = false) => {
      if (riding?.has(it.id) || (ids.includes(it.id) && !again && !listed.delete(it.id)) || ((into.length || !first) && used + line.length > room)) return;
      into.push(line);
      add(it.id);
      shown.push(it);
      used += line.length;
    };
    /** @type {string[]} */
    const how = [];
    for (const it of found) if (it.kind === "procedure") place(how, it, memoryLine(it, 260), true);
    if (how.length) lines.push(`How to do it here (the procedures your task names):\n${how.join("\n")}`);
    layers.procedures = how.length;
    /** @type {string[]} */
    const traps = [];
    const armed = this.archive.triggers.onTools(pid, [...new Set(tools.map(triggerTool))]);
    const counts = this.archive.items.eventCounts(armed.map((it) => it.id));
    for (const it of armed) {
      const rec = counts.get(it.id) || { evidence: 0, suspected: 0, lastSaid: null };
      if (!(userBacked(it) || rec.evidence > 0)) continue;
      const st = this.#standing(it, check, env);
      if (st.hold || confidenceOf(it, { ...rec, changed: st.changed }, now) < CONFIDENCE_GATE) continue;
      const backed = 1 + rec.evidence;
      const r = { kind: it.kind, id: itemRef(it.id), text: it.text, when: dateOf(it.created_at), trust: trustOf(it), flags: [...(backed >= 2 ? [`✓${backed}`] : []), ...st.flags] };
      place(traps, r, memoryLine(r, 300), false, cited.delete(r.id));
    }
    if (traps.length) lines.push(`Pitfalls of the tools you have (each is said again at the call that walks into it):\n${traps.join("\n")}`);
    layers.pitfalls = traps.length;
    /** @type {string[]} */
    const open = [];
    const named = root ? underRoot(namedPaths(task), root) : [];
    const threads = named.length ? this.archive.anchors.ofKind(pid, "thread").filter((t) => named.some((p) => withinFolder(p, t.anchor_path))) : [];
    const said = this.archive.items.eventCounts(threads.map((t) => t.id));
    for (const t of threads) {
      const st = this.#standing(t, check, env);
      if (st.hold || confidenceOf(t, { ...said.get(t.id), changed: st.changed }, now) < CONFIDENCE_GATE) continue;
      const r = { kind: t.kind, id: itemRef(t.id), text: t.text, flags: st.flags };
      place(open, r, `- [${r.id} thread · ${trustOf(t)} · open thread on ${t.anchor_name}${st.flags.length ? ` · ${st.flags.join(" · ")}` : ""}] ${clip(t.text, 300)}`);
    }
    if (open.length) lines.push(`Open threads on the files your task names:\n${open.join("\n")}`);
    layers.threads = open.length;
    /** @type {string[]} */
    const picked = [];
    /** @type {string[]} */
    const quoted = [];
    for (const it of found) if (it.kind !== "procedure") place(EVIDENCE_KINDS.has(it.kind) ? quoted : picked, it, memoryLine(it, 260));
    if (picked.length) lines.push(`Relevant to your task:\n${picked.join("\n")}`);
    if (quoted.length) lines.push(`${EVIDENCE_HEAD}\n${quoted.join("\n")}`);
    layers.related = picked.length + quoted.length;
    const count = Object.values(layers).reduce((a, b) => a + b, 0);
    if (!count) return { ...none("nothing in memory applies to the task"), layers };
    // An outside agent (M7-6) has no session's conversation to start without, and corrects through its MCP server's tool.
    const outside = purpose === "agent";
    const head = `Memory for your task (Filament)${outside ? "" : `, for ${who} that starts without the session's conversation`}: what the user and past sessions established${riding ? ", beyond the session's briefing in your system prompt, which it does not repeat" : ""}. Each line starts with its id, its kind and how it is known — user said, user corrected or user confirmed (the user's own word), user's words, inferred (learned, unchecked), assistant noted, imported. It is background; your task is the instruction. A memory describes the moment it was recorded: when what you find contradicts one, trust what you find and ${outside ? "correct the memory by its id with `correct`; close an open thread whose work you finished with `close`" : "say so in your report, naming its id (with the memory tools, filament_memory_correct(id, text, reason) fixes it; an open thread whose work you finished: filament_memory_close(id, because))"}.`;
    const text = [head, ...lines, ...legendOf(shown)].join("\n");
    if (chain) this.archive.injections.add({ requestId: null, chainId: chain.id, turnId, kind: "brief", ids, tokens: est(text) });
    return { text, ids, count, tokens: est(text), layers };
  }
  /**
   * What a session was shown in the last `ERRATA_DAYS` that is retired now (M7-D2), the most recently shown first, at
   * most `BRIEF_ERRATA`, as errata say them (`erratumLine`): read, never taken — the session's own queue stays its own.
   * One retired with no erratum (`quiet`: a merge, a thread expired, a finding lapsed) is not said.
   * @param {string} chainId
   */
  #retiredSince(chainId) {
    const out = [];
    for (const ref of this.archive.injections.shownIn(chainId, this.now() - ERRATA_DAYS * 86400000)) {
      const named = this.resolveRef(ref);
      const it = named.type === "item" ? named.item : null;
      if (!it || !isRetired(it.status) || out.some((e) => e.ref === itemRef(it.id))) continue;
      const now = it.superseded_by ? this.archive.items.get(it.superseded_by) : null;
      const last = this.archive.items.events(it.id).filter((e) => e.action === "status").at(-1);
      if (String(last?.reason || "").startsWith(MERGED) || last?.detail?.quiet) continue;
      out.push({ ref: itemRef(it.id), old: clip(it.text, 160), ...(now ? { nowRef: itemRef(now.id), now: clip(now.text, 200) } : {}), by: retiredBy(last?.by, last?.detail?.finder), at: it.invalid_at });
      if (out.length >= BRIEF_ERRATA) break;
    }
    return out;
  }

  /** @type {Map<string, { goal: string, briefing: string }>} */
  #runStood = new Map();
  /**
   * What stands in a sub-agent's run, kept as its first request found it: the run is a conversation of its own, which
   * the person's messages never reach, so its system prompt carries the briefing and the goal in force, and each of its
   * requests sends the system prompt its first did. Kept for the runs of this process, the newest 200.
   * @param {string} chainId @param {string} run  the sub-agent's id @param {any} meta @param {string} briefing
   * @returns {{ goal: string, briefing: string }}
   */
  runStanding(chainId, run, meta, briefing) {
    const key = `${chainId}/${run}`;
    let stood = this.#runStood.get(key);
    if (!stood) {
      stood = { goal: goalNow(meta.goal), briefing };
      this.#runStood.set(key, stood);
      if (this.#runStood.size > 200) this.#runStood.delete(this.#runStood.keys().next().value);
    }
    return stood;
  }

  /**
   * Whether the chat's briefing closes its system prompt (`briefingSeat`, one answer per compaction head of the
   * request's window): yes where the system prompt went out with it from the chat's first request or its newest
   * compaction on; no for one built after a request went out without it — that one rides a person's message, placed
   * again with the history, until the next compaction seats it. `text`: the briefing this request has, stored or built
   * now. A window never seated is seated as it went out: with the chain's stored briefing, or on the chain's first
   * request with the one built now. Never in the system prompt while the history this request sends carries one on a
   * message (`carried`): a compaction undone, a fork, or a compaction that kept that message, sends it there still.
   * @param {any} sit @param {any} chain @param {any} meta  the chain's meta, as this request read it: the seat is written
   *   into it too
   * @param {string} text @param {boolean} carried
   */
  briefingSeated(sit, chain, meta, text, carried) {
    const w = windowOf(sit);
    const head = this.archive.newestCompactionId?.(chain.id, sit.window || null) ?? 0;
    const seat = meta.briefingSeat?.[w];
    if (seat && seat.head === head) return !!seat.system;
    const system = !!text && !carried && (!!seat || !!chain.briefing || !!chain.isNew || !(Number(chain.turns) > 0));
    meta.briefingSeat = { ...(meta.briefingSeat || {}), [w]: { head, system } };
    this.archive.setMetaKeys(chain.id, { briefingSeat: meta.briefingSeat });
    return system;
  }

  /**
   * The session's goal rides the END of the system prompt (WP-I), after the briefing, on every request of the chain: the
   * goal as it stood at the chat's newest compaction (`goalPinned`), so accepting, slicing or closing one changes no byte
   * the provider cached — the change is said on the person's next message (prepare's `tellGoal`), and the system prompt
   * takes it at the next compaction. A chain with no pin yet pins the goal as it stands, so the system prompt keeps the
   * bytes it went out with. Each window of the chain has a pin of its own, moved by its own compactions alone. A
   * sub-agent's run places the goal it began with (`run`, `runStanding`). What it weighs, 0 where no goal is placed.
   * @param {any} sit @param {any} meta  the chain's meta, as this request read it: the pin is written into it too
   * @param {string} chainId @param {{ goal: string } | null} run
   */
  applyGoal(sit, meta, chainId, run) {
    let text = run?.goal ?? "";
    if (!run) {
      const w = windowOf(sit);
      const head = this.archive.newestCompactionId?.(chainId, sit.window || null) ?? 0;
      const pin = meta.goalPinned?.[w];
      if (!pin || pin.head !== head) {
        meta.goalPinned = { ...(meta.goalPinned || {}), [w]: { head, text: goalNow(meta.goal) } };
        this.archive.setMetaKeys(chainId, { goalPinned: meta.goalPinned });
      }
      text = String(meta.goalPinned[w].text || "");
    }
    if (!text) return 0;
    applySystemBlock(sit.format, sit.body, sit.responsesBody, text, GOAL_BLOCK_KIND);
    currentTrace()?.step("goal block placed", { note: "the goal as it stood at the chat's newest compaction, at the end of the system prompt" });
    return est(text);
  }

  /**
   * After the reply: store the final message, mark used injections, keep the chain's state fresh. Answers the session
   * whose compaction row this reply wrote (the client's own summary), else null: only a row written starts the
   * session's learning (HarnessV3-Memory M7-D27).
   * @returns {string | null}
   */
  afterReply({
    chainId,
    turnId,
    requestId,
    finalMessage = null,
    workMessages = [],
    outputChars = 0,
    replyText = "",
    injectedIds = [],
    compaction = null,
  }) {
    const tr = currentTrace();
    let compacted = null;
    try {
      if (compaction?.chainId && replyText) {
        this.archive.addCompaction(compaction.chainId, {
          fromTurn: compaction.fromTurn || 1,
          toTurn: compaction.toTurn || 0,
          summaryText: replyText,
          kind: "client",
          method: "summary",
          ...(compaction.window ? { window: compaction.window } : {}),
        });
        compacted = compaction.chainId;
        tr?.step("compaction archived", {
          session: compaction.chainId,
          turns: `${compaction.fromTurn || 1}-${compaction.toTurn || 0}`,
          chars: replyText.length,
        });
      }
      if (turnId && workMessages.length) {
        this.archive.addWork(turnId, workMessages);
        tr?.step("tool work archived", { messages: workMessages.length });
      }
      if (turnId && finalMessage) {
        const t = this.now();
        this.archive.finishTurn(turnId, { finalMessage, requestId, outputChars });
        tr?.step("reply archived", {
          ms: Math.round((this.now() - t) * 10) / 10,
          outputChars,
          note: "the final answer joins the turn in the archive",
        });
      } else
        tr?.step("reply not archived", {
          why: !turnId ? "no turn was opened for this request" : "no final message (error or empty reply)",
        });
      if (requestId && injectedIds.length) {
        const texts = this.lastTexts.get(requestId) || null;
        this.lastTexts.delete(requestId);
        const said = texts && replyText ? new Set(texts.filter(([, t]) => usedInReply(t, replyText)).map(([id]) => id)) : new Set();
        // What its tool calls did counts too (b4): a rule obeyed in a command is used, though the reply never says it.
        const terms = texts && workMessages.length ? workTermsOf(workMessages) : new Set();
        const rare = terms.size ? this.rareTerms() : () => false;
        const done = texts ? texts.filter(([id, t]) => !said.has(id) && usedInWork(t, terms, rare)).map(([id]) => id) : [];
        const usedIds = [...said, ...done];
        const used = usedIds.length;
        this.archive.injections.markUsed(requestId, used > 0 ? 1 : 0, usedIds);
        tr?.step("use judged", {
          injected: injectedIds.length,
          used,
          ...(done.length ? { inWork: done.length } : {}),
          verdict: used > 0 ? "used" : "not used",
          note: "an item counts as used when the reply repeats a phrase of it, or the turn's tool calls carry a word of it that is rare across memory — each item on its own; facts unused three times running fade, rules and preferences never do",
        });
      } else if (requestId) tr?.step("nothing to judge", { note: "no memory was added to this request" });
      if (requestId) this.#judgeBriefing(requestId, replyText, workMessages);
    } catch (e) {
      this.log("warn", `memory: afterReply bookkeeping failed (${e.message.slice(0, 120)})`);
      tr?.step("bookkeeping failed", { error: e.message.slice(0, 120) });
    }
    return compacted;
  }
  /**
   * Whether a word is rare across memory (b4): held by at most 2% of the standing claims, and by no more than two where
   * there are few. Counted once, and again when a claim is added, changed or retired.
   * @returns {(term: string) => boolean}
   */
  rareTerms() {
    const stamp = String(this.archive.items?.standingStamp?.() ?? "");
    if (!this.#rare || this.#rare.stamp !== stamp) {
      const texts = this.archive.items?.standingTexts?.() || [];
      /** @type {Map<string, number>} */
      const df = new Map();
      for (const t of texts) for (const w of new Set(termsOf(t))) df.set(w, (df.get(w) || 0) + 1);
      this.#rare = { stamp, df, most: Math.max(2, Math.ceil(texts.length * 0.02)) };
    }
    const { df, most } = this.#rare;
    return (term) => (df.get(term) || 0) <= most;
  }
  /**
   * What a session's agent looked up again (b4): a search that answers a memory the session was shown counts as a use
   * of that showing. → the refs credited. @param {string | null} chainId @param {string[]} refs
   */
  creditShown(chainId, refs) {
    if (this.#dry || !chainId || !refs.length) return [];
    return this.archive.injections.creditShownIn?.(chainId, refs) || [];
  }
  /**
   * How often each memory was shown over the last `days`, and used (b4): what the claim browser and the curator read.
   * @param {string[]} refs @param {number} [days] @returns {Map<string, { shown: number, judged: number, used: number }>}
   */
  useCounts(refs, days = METRIC_DAYS) {
    return this.archive.injections.useCounts(refs, this.now() - days * 86400_000);
  }
  /**
   * Memory's metrics over the last `days` (b4): by layer and day, what was shown and used, its tokens, the showings that
   * came again in a session, whose memories are used, what was served and then corrected, and what fades now.
   * @param {number} [days]
   */
  metrics(days = METRIC_DAYS) {
    const d = Math.max(1, Math.min(METRIC_DAYS_MAX, Math.round(Number(days) || METRIC_DAYS)));
    const since = this.now() - d * 86400_000;
    return memoryMetrics(this.archive.injections.rollupRows(since), { since, days: d, fades: (it) => !NEVER_FADES.has(it.kind) && it.status !== "confirmed" });
  }

  // Chat commands and tools call these.
  /**
   * An explicit search: every standing claim that matches, a held one included with its flags (M3-3, M3-4). `at` is the
   * project of whoever asks, whose folder is the environment the claims are checked against. `only`: `projectId`'s
   * memory alone — its claims, those that hold in every project, its sessions' words (no project: none's).
   * @param {string} query @param {{ projectId?: string | null, limit?: number, at?: string | null, only?: boolean }} [o]
   */
  async search(query, { projectId = null, limit = 10, at = projectId, only = false } = {}) {
    const t0 = this.now();
    try {
      const cwd = at ? this.archive.getProject?.(at)?.cwd : null;
      const env = cwd ? requestEnv({ project: at, cwd }) : null;
      // The topic pages of the asker's project (f7), or of the one project searched: one asked for by its name alone.
      const pagesIn = only ? projectId : at;
      const named = /^page:(\S+)$/i.exec(String(query ?? "").trim());
      const page = named ? this.#namedPage(pagesIn, named[1], env) : null;
      if (page) {
        this.#op("memory search: 1 hit(s)", { sub: "search", ms: this.now() - t0, detail: { hits: 1, pages: 1, queryChars: String(query ?? "").length, mode: "search" } });
        return [page];
      }
      const r = await this.retrieve({ query: queryOf(query) || query, text: query, projectId, mode: "search", limit, env, within: only ? projectId : undefined });
      const items = this.#withPages(r.items, pagesIn, env);
      const pages = items.filter((it) => it.kind === "page").length;
      this.#op(`memory search: ${items.length} hit(s)`, {
        sub: "search",
        ms: this.now() - t0,
        detail: { hits: items.length, ...(pages ? { pages } : {}), queryChars: String(query ?? "").length, mode: "search" },
      });
      return items;
    } catch (e) {
      this.#op(`memory search failed: ${String(e.message).slice(0, 120)}`, {
        sub: "search",
        level: "error",
        ms: this.now() - t0,
        detail: { queryChars: String(query ?? "").length, error: String(e.message).slice(0, 160) },
      });
      throw e;
    }
  }
  // `archived`: "exclude" (the default list) · "only" (the archived view) · "all".
  // `kinds`: which chain kinds to list — by default every conversation that was somebody's (SEARCH_KINDS: the
  // harness's list narrows to LISTED_KINDS itself); `internal: "all"` (the older switch the inspectors use) widens
  // to every kind. `client` narrows to one client name. `offset` skips the rows a list read a page at a time has had
  // already. One statement for the rows (archive.listChains), one for the item counts; the search path resolves hits
  // to chain ids first and lists those. `others`: the list goes to another chat or call — a model, an agent, the person
  // in another chat, the console's assistant — and names no chat Memory settings leave out (`keptToItself`), nor its
  // words, nor the words of a turn kept apart (archive `apartToo`, `titleFor`); the person's own lists (the sidebar)
  // name every chat. `agentsOf`: the person's list names whose agents started a chat another machine's agents' device
  // started (`meta.agentDevice`), by the name it gives the device — never the device itself.
  sessions(
    query,
    {
      limit = 10, offset = 0, project = null, archived = "exclude", internal = "exclude", kinds = null, client = null, others = false,
      agentsOf = /** @type {((device: string) => string | null) | null} */ (null),
    } = {},
  ) {
    const wantKinds = kinds && kinds.length ? kinds : internal === "all" ? null : SEARCH_KINDS;
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    const aside = (/** @type {string} */ id) => others && this.keptToItself(id, keptAside);
    const hits = (query ? this.archive.searchInputs(query, { limit: (offset + limit) * 3, project, apartToo: !others }) : []).filter((h) => !aside(h.chainId));
    const hitsByChain = new Map();
    for (const h of hits) {
      const c = hitsByChain.get(h.chainId) || { hits: [] };
      c.hits.push({ n: h.n, snippet: clip(h.snippet, 160) });
      hitsByChain.set(h.chainId, c);
    }
    // A chat whose name holds the words comes first — found by the name the sidebar shows (`chainsNamed`) — then those
    // whose turns hold them.
    const named = query ? this.archive.chainsNamed(query, { limit: offset + limit, project, kinds: wantKinds, apartToo: !others }) : [];
    const rows = this.archive.listChains({
      ids: query ? [...new Set([...named, ...hitsByChain.keys()])] : null,
      project,
      kinds: wantKinds,
      client,
      archived,
      limit,
      offset,
    }).filter((/** @type {any} */ c) => !aside(c.id));
    const itemCounts = this.archive.items.countsByChain
      ? this.archive.items.countsByChain(rows.map((c) => c.id))
      : new Map();
    // Each thread's starter (core/threads.js), in one read for the list.
    const starters = this.archive.threadStarters ? this.archive.threadStarters(rows.map((c) => c.id)) : new Map();
    return rows.map((ch) => {
      const st = ch.state || {};
      const last = ch.meta?.lastLearn || null;
      // Another chat or call is given no words of a turn kept apart: no title or preview such a turn named.
      const apartNamed = others && !!ch.meta?.namedApart;
      const title = apartNamed ? null : ch.title || null;
      return {
        id: ch.id,
        kind: ch.kind || "interactive",
        title,
        // An untitled row is labelled by its first message (clipped) until a title exists; null when the index kept none.
        preview: title || apartNamed ? null : ch.preview || null,
        project: ch.project_id,
        projectName: ch.projectName || null,
        // The chat's own folder, else its project's: a chat in a worktree stands in the main folder's project
        // (HarnessV4_Git_Plan GW-D46) and works in its worktree (GW-D47).
        cwd: (typeof ch.meta?.cwd === "string" && ch.meta.cwd) || ch.projectCwd || null,
        // The places besides its folder the chat's agents wrote in (HarnessV4_Git_Plan GW-D3): the sidebar names
        // where a chat works from them and its folder (GWC-36).
        places: Array.isArray(ch.meta?.places) ? ch.meta.places.map(String) : [],
        client: ch.client,
        // A chat an import brought from another coding agent, by that agent's name (the server's words: the page
        // maps no id). Null for a session made here.
        importedFrom: ch.meta?.import ? clientLabel(ch.meta.import) : null,
        when: dateOf(ch.last_at),
        // Its last moment whole (ms), for what says how long ago — a lane's "idle · 2h", Now's finished row: `when`
        // is a day alone.
        lastAt: Number(ch.last_at) || null,
        created: dateOf(ch.started_at || ch.last_at),
        turns: ch.turns,
        continues: ch.parent_id || null,
        // The sidebar's marks (harness §4.7): pinned floats the row in its project, the ⑂ names the fork, archived
        // and unread are the row's two other states.
        pinned: !!ch.meta?.pinned,
        archived: !!ch.meta?.archived,
        unread: !!ch.meta?.unread,
        fork: ch.meta?.fork ? { from: ch.meta.fork.from, atTurn: ch.meta.fork.atTurn } : null,
        // A thread (core/threads.js): the chat whose agent started it, which the sidebar draws it under.
        ...(starters.has(ch.id) ? { threadOf: starters.get(ch.id) } : {}),
        // A chat another machine's agents started here (the remote-agents plan's s-ui): the sidebar marks it "From
        // MacBook's agents" — a name null once this machine keeps none of them.
        ...(agentsOf && typeof ch.meta?.agentDevice === "string" ? { fromAgents: { name: (typeof ch.meta.agentFrom === "string" && ch.meta.agentFrom) || agentsOf(ch.meta.agentDevice) } } : {}),
        // A crafter chat (app/crafter-chats.js): the skill it crafts, null until named, and the chat /craft was typed
        // in — the line over its box links back to it, and that chat's says while it works.
        craft: ch.meta?.craft && typeof ch.meta.craft === "object"
          ? { skill: typeof ch.meta.craft.skill === "string" && ch.meta.craft.skill ? ch.meta.craft.skill : null, from: typeof ch.meta.craft.from === "string" && ch.meta.craft.from ? ch.meta.craft.from : null }
          : null,
        // A team's chat on the side of another (team_v2_plan §5.3): its team's name and the chat it works for — the
        // sidebar draws it under that chat's row (HarnessV4_Tasks U13-D5).
        ...(ch.kind === "team"
          ? { beside: ch.meta?.beside ? { main: this.archive.mainOf?.(ch.id) ?? null, name: String(ch.meta.beside.name || ch.meta.beside.team || "") } : null }
          : {}),
        state: st.summary ? clip(st.summary, 200) : null,
        open: st.open || [],
        matches: (hitsByChain.get(ch.id)?.hits || []).slice(0, 3),
        items: itemCounts.get(ch.id) || 0,
        settings: !!ch.settings,
        learned: last
          ? {
              at: last.at || null,
              ms: last.ms ?? null,
              skipped: last.skipped || null,
              error: last.error || null,
            }
          : null,
      };
    });
  }
  // One session's material — or, with view "lineage", the session and all its ancestors oldest
  // first, each as a budgeted summary, so one load brings in the whole effort's arc. `within`: a project the ancestors
  // keep to (a confined caller's, port.js), each of another left out; so is an ancestor Memory settings leave out
  // (`keptToItself`). `toTurn` bounds the turns of one session, `toTurnOf` (the one loaded unless named), wherever it
  // stands in what is rendered. `others`: the session goes to another chat or call, so its turns kept apart, and the
  // title such a turn named, stay out (archive `apartToo`) — as an ancestor's always do; the chat's own load reads them.
  load(chainId, { view = "chat", budgetTokens = 4000, fromTurn, toTurn, toTurnOf = chainId, within = /** @type {string | undefined} */ (undefined), others = false } = {}) {
    if (view !== "lineage") return this.archive.render(chainId, { view, budgetTokens, fromTurn, ...(toTurnOf === chainId ? { toTurn } : {}), apartToo: !others, words: summaryWordsOf });
    const chain = this.archive.getChain(chainId);
    if (!chain) return null;
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    const list = [...this.lineageOf(chain).reverse().filter((c) => (within === undefined || c.project_id === within) && !this.keptToItself(c.id, keptAside)), chain];
    const per = Math.max(400, Math.floor((budgetTokens || 4000) / list.length));
    const parts = [];
    for (const c of list) {
      const st = parse(c.state_json) || {};
      const theirs = c.id !== chainId || others;
      const r = this.archive.render(c.id, { view: "summary", budgetTokens: per, ...(c.id === toTurnOf && toTurn != null ? { toTurn } : {}), apartToo: !theirs, words: summaryWordsOf });
      const title = theirs ? this.titleFor(c) : c.title;
      parts.push(
        `### Session ${c.id}${title ? ` "${clip(title, 60)}"` : ""} (${dateOf(c.started_at)})${c.id === chainId ? " — this session" : ""}\n${st.summary ? `End state: ${st.summary}\n` : ""}${r?.text || "(no turns recorded)"}`,
      );
    }
    const text = parts.join("\n\n");
    return {
      view,
      chainId,
      title: others ? this.titleFor(chain) : chain.title,
      turns: list.reduce((n, c) => n + (c.turns || 0), 0),
      sessions: list.length,
      tokens: est(text),
      text,
    };
  }
  /**
   * Where words were said in one session, newest turn first: the archive's grep (the filament-agent plan's Phase 4).
   * `others`: for another chat or call, its turns kept apart stay out (archive `apartToo`).
   * @param {string} chainId @param {any} o
   */
  grep(chainId, { others = false, ...o } = {}) {
    return this.archive.grep(chainId, { ...o, apartToo: !others });
  }
  /**
   * Store a memory someone asked for (MD-1). The person or the owner (`by` "person" or "owner") states it: confirmed,
   * pinned, and a retired text on file stands again. A model's or an agent's call is a note: inferred, unpinned, and it
   * never brings back what was retired — that is the user's word to give. A procedure (M5-6) must read as one, and it
   * replaces the other ways to its goal (`#oneWay`); one given as a procedure that does not read as one is refused.
   * `finder`: a sub-agent's run asks (M7-D20): its note is a finding, named for it. `quote`: the person's own words
   * that say it (the memory plan's d1) — found in this chat's (`#heard`), the claim is filed as the user's words (origin
   * `capture`); not found, it stays the asker's note, and the answer says why. `helper`: a coding agent's
   * sub-agent asks, whose chat is the one that launched it.
   */
  async remember(
    text,
    { kind = "fact", importance = 0.8, projectId = null, chainId = null, turnId = null, client = "", by = /** @type {any} */ (undefined), finder = /** @type {Finder | null} */ (null), quote = "", helper = false } = {},
  ) {
    whoSays(by);
    const model = !speaksForUser(by);
    // What is remembered is a claim, a model's or an agent's of a kind its tool names (H4): a permission filed as a
    // note was an Always allow offered for its command that nobody had approved.
    const kinds = model ? REMEMBERED_KINDS : [...CLAIM_KINDS];
    if (!kinds.includes(kind)) throw new Error(`${KIND_REFUSAL}${kinds.slice(0, -1).join(", ")} or ${kinds.at(-1)}, not "${clip(String(kind), 40)}"`);
    // A procedure (M5-6) is kept as one reads, "How to <goal>: 1. … 2. …", in its goal's slot.
    const p = kind === "procedure" ? asProcedure(text) : null;
    if (kind === "procedure" && !p) throw new Error(`memory: ${PROCEDURE_FORM}`);
    const heard = model && String(quote || "").trim() ? this.#heard(quote, { text: p ? p.text : text, chainId, turnId, finder, helper }) : null;
    const said = heard && "turn" in heard ? heard : null;
    const it = this.addItem(
      {
        projectId,
        chainId,
        turnId,
        kind,
        text: p ? p.text : clip(text, 500),
        status: model ? "inferred" : "confirmed",
        importance,
        origin: said ? "capture" : originOf(by, by, finder),
        ...(p ? { slot: procedureSlot(p) } : {}),
        ...(finder && model ? { finder } : {}),
        ...(said ? { quoted: { quote: said.quote, turn: said.n, by } } : {}),
      },
      { client },
    );
    const told = heard ? ("turn" in heard ? { heard: true } : { unheard: heard.why }) : {};
    // A text already on file (the archive dedupes on it). One that stands keeps its engine copy (or gets one queued);
    // the person's or the owner's remember confirms it, and one that was retired stands again (said back to whoever
    // asked: F4 item 21b), its copy restored.
    const had = it.deduped ? this.archive.items.get(it.id) : null;
    let restored = false;
    if (had) {
      if (isRetired(had.status)) {
        if (model)
          return { id: itemRef(had.id), itemId: had.id, retired: true, note: `this text is on file as ${had.status}; only the user can bring it back` };
        await this.setItemStatus(had.id, "confirmed", { by, reason: "asked to remember it again" });
        restored = true;
      } else {
        if (!model && had.status !== "confirmed") await this.setItemStatus(had.id, "confirmed", { by, reason: "asked to remember it" });
        if (!had.memory_id) this.enqueue(had.id, "mirror", { client });
        if (chainId) this.#evidence(had, { chainId, turnId, text }, by);
        // A note on file the person is now quoted saying: it is their words from here on, its history saying who heard.
        if (said && !userBacked(had))
          this.archive.transaction(() => {
            this.archive.items.setOrigin(had.id, "capture");
            this.archive.items.note(had.id, "heard", { by, detail: { from: had.origin, quote: said.quote, turn: said.n } });
          });
      }
    }
    if (!p) return { id: itemRef(it.id), itemId: it.id, ...(restored ? { restored: true } : {}), ...told };
    // One way to do a thing stands (M5-6): this one replaces the others for its goal, or the user's own holds it.
    const way = isRetired(this.archive.items.get(it.id)?.status) ? { replaced: [], users: null } : await this.#oneWay(it.id, { by, chainId, at: said?.startedAt ?? null });
    if (way.users)
      return { id: itemRef(it.id), itemId: it.id, retired: true, note: `the user's own way to ${p.goal} stands (${itemRef(way.users.id)}); this one was filed dismissed`, ...told };
    return {
      id: itemRef(it.id),
      itemId: it.id,
      ...told,
      ...(restored ? { restored: true } : {}),
      ...(way.replaced.length ? { replaced: way.replaced.map(itemRef) } : {}),
      ...(p.cut ? { note: `its first ${p.steps.length} steps were kept: ${p.cut} more did not fit in a procedure's ${PROCEDURE_CHARS} characters` } : {}),
    };
  }

  /**
   * One way of doing a thing stands (M5-6): a procedure standing in its goal's slot replaces the others there, kept with
   * history and errata — unless one of them is the user's word and it is not, or is their word said before that one (a
   * quote of older words of theirs, `at` when they said it: d3's review) (M2-6): then it is filed dismissed, naming the
   * user's. → the ids it replaced, or the user's procedure that holds the slot.
   * @param {number} id @param {{ by: any, chainId?: string | null, at?: number | null }} o @returns {Promise<{ replaced: number[], users: any | null }>}
   */
  async #oneWay(id, { by, chainId = null, at = null }) {
    const it = this.archive.items.get(id);
    const rivals = it?.slot ? this.archive.items.inSlot(it.project_id, it.slot).filter((/** @type {any} */ c) => c.id !== id) : [];
    const goal = goalOfProcedure(it?.text) ?? "do it";
    const said = at ?? this.#saidAt(it);
    const users = rivals.find((/** @type {any} */ c) => userBacked(c) && (!userBacked(it) || this.#saidAt(c) > said)) ?? null;
    if (users) {
      await this.setItemStatus(id, "dismissed", { by, chainId, errata: false, reason: `the user's own way to ${goal} holds its slot: ${itemRef(users.id)}` });
      this.askLater(users, it, { at: said });
      return { replaced: [], users };
    }
    for (const old of rivals) await this.setItemStatus(old.id, "superseded", { by, replacement: id, chainId, reason: `a newer way to ${goal}` });
    return { replaced: rivals.map((/** @type {any} */ c) => c.id), users: null };
  }

  /**
   * A claim the learner found (HarnessV3-Memory M2-5), filed against the record rather than beside it:
   * - the same words, or the same value in its slot, standing: evidence for that claim (an event, once per session),
   *   not a second claim. The same words retired are left as they are: the learner never brings back what was retired;
   * - near-duplicate words the engine serves, of a claim in this project or global: evidence when it stands; filed
   *   dismissed, naming it, when it was retired. A claim of another project is not this one's duplicate, nor one the
   *   caller says is not `alike` (a pitfall seen is its trigger, not its words: M5-D33), nor a thread another kind's
   *   or another kind a thread's (M7-D65);
   * - else a new claim, inferred. In a single-valued slot the newer word wins: the values said before it are superseded
   *   by it, with history and errata, and when one was said after it, it is filed superseded by that one — but a value
   *   the user said, corrected or confirmed is never replaced by a learned one: the learned claim is filed dismissed,
   *   naming it (M2-6).
   * A rule, a preference or a decision the person's own words of its turn do not say is filed as a fact (M2-6, MEMR-7):
   * text they pasted or quoted, a tool's output and the assistant's words give no authority over how to work, and are
   * no decision of theirs.
   * `saidAt`: when the session said it (its turn's start), so a session learned late does not overrule a newer one.
   * `origin`: the learner's reading of a session (`learner`) or of a sub-agent's report (`subagent`, with its `finder`,
   * M7-D19).
   * @param {{ projectId: string | null, chainId: string, turnId?: number | null, saidAt?: number | null, kind: string, text: string, importance: number, slot?: { slot: string, value: string, multi: boolean } | null }} c
   * @param {{ via?: string, alike?: (claim: any) => boolean, origin?: "learner" | "subagent", finder?: Finder | null }} [o]
   * @returns {Promise<{ id: number, filed: "added" | "evidence" | "known" | "dismissed" | "superseded" }>}
   */
  async fileLearned({ projectId, chainId, turnId = null, saidAt = null, kind: asLearned, text, importance, slot = null }, { via = "filament-learn", alike = () => true, origin = "learner", finder = null } = {}) {
    const kind = AUTHORITY_KINDS.has(asLearned) && !this.#saidByPerson(turnId, text) ? "fact" : asLearned;
    const said = { chainId, turnId, text };
    const same = this.archive.items.withText(projectId, kind, text);
    if (same) return isRetired(same.status) ? { id: same.id, filed: "known" } : this.#evidence(same, said);
    // A slot about the user holds in every project once the user keeps a value of it there (the memory plan's f5): that
    // value is the slot's here too — said again, evidence for it; said otherwise, the user's word holds (M2-6).
    const everywhere = slot && projectId != null && aboutUser(slot.slot) ? this.archive.items.inSlot(null, slot.slot) : [];
    const held = slot && [...this.archive.items.inSlot(projectId, slot.slot), ...everywhere].find((c) => holdsValue(c, slot.value));
    if (held && held.project_id == null && !slot.multi && !held.slot_multi)
      // The project's own learned values of the slot said before it give way to the user's, as a newer value does.
      for (const old of this.archive.items.inSlot(projectId, slot.slot))
        if (!old.slot_multi && !userBacked(old) && !holdsValue(old, slot.value))
          await this.setItemStatus(old.id, "superseded", { by: "learner", replacement: held.id, chainId, reason: `the user's value in every project, said again (${slot.slot}): ${clip(slot.value, 80)}` });
    if (held) return this.#evidence(held, said);
    const close = await this.nearClaim(text, projectId, slot, kind);
    const near = close && alike(close) ? close : null;
    if (near && !isRetired(near.status)) return this.#evidence(near, said);
    const at = saidAt ?? this.now();
    const rivals = slot && !slot.multi ? this.archive.items.inSlot(projectId, slot.slot).filter((c) => !c.slot_multi) : [];
    const later = rivals.filter((c) => this.#saidAt(c) > at).sort((a, b) => this.#saidAt(b) - this.#saidAt(a))[0] || null;
    const users = later ? null : rivals.find(userBacked) || (slot && !slot.multi ? everywhere.find((c) => !c.slot_multi && userBacked(c)) : null) || null;
    const r = this.archive.transaction(() => {
      const r = this.archive.items.add({ projectId, chainId, turnId, kind, text, status: "inferred", importance, origin, slot, finder });
      this.#arm(r.id, { kind, text });
      if (kind !== asLearned)
        this.archive.items.note(r.id, "kind", { by: "learner", reason: `learned as a ${asLearned}; the person's own words of its turn do not say it`, detail: { from: asLearned, to: kind } });
      if (near) this.archive.items.setStatus(r.id, "dismissed", { by: "learner", reason: `${itemRef(near.id)} says this and is ${near.status}` });
      else if (later)
        this.archive.items.setStatus(r.id, "superseded", { by: "learner", replacement: later.id, reason: `an older value in its slot (${slot?.slot}): ${itemRef(later.id)} was said later` });
      else if (users)
        this.archive.items.setStatus(r.id, "dismissed", { by: "learner", reason: `the user's word holds its slot (${slot?.slot}): ${itemRef(users.id)}, ${trustOf(users)}` });
      else this.enqueue(r.id, "mirror", { via });
      return r;
    });
    if (users) this.askLater(users, this.archive.items.get(r.id), { at, value: slot?.value ?? null });
    if (near || users) return { id: r.id, filed: "dismissed" };
    if (later) return { id: r.id, filed: "superseded" };
    this.#anchor(r.id, { projectId, text, kind, saidAt: at });
    for (const old of rivals)
      await this.setItemStatus(old.id, "superseded", { by: "learner", replacement: r.id, chainId, reason: `a newer value in its slot (${slot?.slot}): ${clip(slot?.value, 80)}` });
    return { id: r.id, filed: "added" };
  }

  /**
   * A session said a standing claim again — learned, captured or asked to be remembered: an `evidence` event, once per
   * session, and none from its own session. What confidence counts (M3-6) and the dossier ranks by (M4-7). An undone
   * one (M4-D6) is as if never said. `run`: the curator's pass that moved it here (a merge, M4-2).
   * @param {any} claim @param {{ chainId: string, turnId?: number | null, text: string }} said @param {string} [by] @param {number | null} [run]
   */
  #evidence(claim, { chainId, turnId, text }, by = "learner", run = null) {
    const seen = claim.chain_id === chainId || this.archive.items.events(claim.id).some((e) => e.action === "evidence" && !e.undone_at && e.detail?.chain === chainId);
    if (seen) return { id: claim.id, filed: /** @type {const} */ ("known") };
    this.archive.items.note(claim.id, "evidence", {
      by,
      run,
      detail: { chain: chainId, ...(turnId != null ? { turn: turnId } : {}), ...(norm(text) !== norm(claim.text) ? { text: clip(text, 200) } : {}) },
    });
    return { id: claim.id, filed: /** @type {const} */ ("evidence") };
  }

  /**
   * The standing claims a session was shown (its injections' `i<n>` ids) — up to turn `through` (its id) when given —
   * the most recently shown first, at most `limit`: what a learning pass judges (the memory plan's d4). Threads are the
   * open threads' (`openThreads`), and an always-allow offer is no claim.
   * @param {string} chainId @param {{ through?: number | null, limit?: number }} [o]
   * @returns {{ id: number, kind: string, text: string }[]}
   */
  shownClaims(chainId, { through = null, limit = SHOWN_CLAIMS } = {}) {
    /** @type {{ id: number, kind: string, text: string }[]} */
    const out = [];
    for (const ref of this.archive.injections.shownIn(String(chainId), 0, through)) {
      const m = /^i(\d+)$/.exec(ref);
      const it = m ? this.archive.items.get(Number(m[1])) : null;
      if (!it || isRetired(it.status) || it.kind === "thread" || it.kind === "permission") continue;
      out.push({ id: it.id, kind: it.kind, text: it.text });
      if (out.length >= limit) break;
    }
    return out;
  }
  /**
   * What a learning pass found of the claims its session was shown (the memory plan's d4), the claims it was given
   * (`notes`) alone: one it says the session showed wrong gets a `suspected` event, with the turn and why, once a
   * session — the curator judges it (#suspicions), and it lowers the confidence of a claim that is not the user's word;
   * one it says the session relied on and found true is said again (`evidence`, once a session, never by its own, nor
   * by one that found it wrong).
   * @param {{ chainId: string, projectId: string | null, notes: number[], contradicted: unknown, held: unknown, turnOf: (n: number) => any }} o
   * @returns {{ suspected: number, held: number }}
   */
  judgeShown({ chainId, projectId, notes, contradicted, held, turnOf }) {
    const listed = new Set(notes);
    const idOf = (/** @type {unknown} */ ref) => Number(/^i?(\d+)$/.exec(String(ref ?? "").trim())?.[1]) || null;
    const standing = (/** @type {number | null} */ id) => (id != null && listed.has(id) ? this.archive.items.get(id) : null);
    const out = { suspected: 0, held: 0 };
    /** @type {Set<number>} */
    const wrong = new Set();
    for (const c of Array.isArray(contradicted) ? contradicted.slice(0, SHOWN_CLAIMS) : []) {
      const it = standing(idOf(c?.id));
      if (!it || isRetired(it.status) || wrong.has(it.id)) continue;
      wrong.add(it.id);
      if (this.archive.items.events(it.id).some((e) => e.action === "suspected" && !e.undone_at && e.detail?.chain === chainId)) continue;
      const turn = turnOf(Number(c?.turn));
      const why = clip(String(c?.why ?? "").replace(/\s+/g, " ").trim(), 200) || "the session showed it wrong";
      this.archive.items.note(it.id, "suspected", { by: "learner", reason: why, detail: { chain: chainId, project: projectId, ...(turn ? { turn: turn.id, n: turn.n } : {}), why } });
      out.suspected++;
    }
    for (const ref of Array.isArray(held) ? held.slice(0, SHOWN_CLAIMS) : []) {
      const it = standing(idOf(ref));
      if (!it || isRetired(it.status) || wrong.has(it.id)) continue;
      // Never said again by a session that found it wrong, in an earlier pass too.
      if (this.archive.items.events(it.id).some((e) => e.action === "suspected" && !e.undone_at && e.detail?.chain === chainId)) continue;
      if (this.#evidence(it, { chainId, text: it.text }).filed === "evidence") out.held++;
    }
    return out;
  }

  /**
   * Whether the person's own words of a turn say a learned claim (M2-6): a third of its key words are among them. Their
   * own words as capture reads them: Filament's notices, memory blocks, and quoted or pasted text left out (`ownWords`).
   * Words every learned rule carries ("user", "prefer", "instead") are not key words. No turn, no support; nor a turn of
   * another machine's agents' chat, whose words are theirs (`#agentsChat`); nor one the person did not begin (`meta.by`,
   * core/turn-by.js: a routine's run, an app's ask, a team's opening are Filament's words).
   * @param {number | null} turnId @param {string} text
   */
  #saidByPerson(turnId, text) {
    const turn = turnId != null ? this.archive.getTurn(turnId) : null;
    const msg = turn?.user_hash ? this.archive.getMessage(turn.user_hash)?.message : null;
    if (!msg || turn.meta?.by || this.#agentsChat(turn.chain_id)) return false;
    const own = new Set(keywordsOf(ownWords(personTextAt({ messages: [msg] }, 0)), { max: 200 }).map((k) => k.toLowerCase()));
    const keys = identifyingWords(text);
    return keys.length > 0 && keys.filter((k) => own.has(k)).length * 3 >= keys.length;
  }

  /**
   * Whether the person said `quote` in this chat (the memory plan's d1): its words, case and spaces folded, inside the
   * person's own words (`ownWords` of `personTextAt`: no notice, memory block, quoted or pasted text) of one of the
   * chat's turns, newest first — never a turn Filament began (`meta.own`), one kept apart, one the person rewound or
   * answered with a command, nor a client's compaction summary, which quotes them back. Only an agent of the person's
   * own chat is heard: a sub-agent's (`finder`, a coding agent's `helper`), whose ask came from the agent that launched
   * it, and an outside agent's over MCP, whose chat holds no person's words, are not; nor is any agent's in another
   * machine's agents' chat, whose words are their agents' (`#agentsChat`). Structural, no word read: the
   * words are compared as they stand. → the turn it was said in and the quote as kept, or why it stays a note.
   * The quote must say the claim (`quoteSays`), and the call stand on a turn of the chat. A message that cannot be read
   * is passed over.
   * @param {string} quote @param {{ text: string, chainId: string | null, turnId: number | null, finder: Finder | null, helper: boolean }} o
   * @returns {{ turn: number, n: number, startedAt: number, quote: string } | { why: string }}
   */
  #heard(quote, { text, chainId, turnId, finder, helper }) {
    const q = foldQuote(quote);
    const chars = q.replace(/ /g, "").length;
    if (finder || helper) return { why: "a sub-agent's quote is not heard: the user spoke to the agent that launched it, which quotes them itself" };
    if (chars < QUOTE_CHARS.min) return { why: `a quote is ${QUOTE_CHARS.min} characters at least, besides spaces: quote the user's sentence` };
    if (chars > QUOTE_CHARS.max) return { why: `a quote is ${QUOTE_CHARS.max} characters at most, besides spaces: quote the words that say it` };
    const head = chainId ? this.archive.chainHead(String(chainId)) : null;
    if (!head || !LISTED_KINDS.includes(head.kind) || turnId == null) return { why: "this call stands on no turn of a chat of the user's, so no words of theirs to quote" };
    if (this.#agentsChat(head.id)) return { why: "this chat is another machine's agents': its words are theirs, not the user's, so it holds none of the user's to quote" };
    if (!quoteSays(quote, text)) return { why: "the quote does not say what the memory says: quote the user's words that say it, or leave the quote out" };
    const read = new Set();
    for (const t of this.archive.personTurns(head.id, { last: QUOTE_TURNS })) {
      if (read.has(t.userHash)) continue;
      read.add(t.userHash);
      let said = "";
      try {
        said = typedWords(this.archive.getMessage(t.userHash)?.message);
      } catch {
        continue;
      }
      if (!said || opensCompaction(said)) continue;
      if (foldQuote(said).includes(q)) return { turn: t.id, n: t.n, startedAt: t.startedAt, quote: clip(String(quote).trim(), 500) };
    }
    return { why: "the user's own words in this chat do not hold that quote, so it stays your note: quote them exactly, or leave the quote out" };
  }

  /**
   * Whether a chat is another machine's agents' (archive `agentsChat`: it, or one up its line, carries `meta.agentDevice`):
   * the words that open its turns are theirs, never the person's (the remote-agents plan's fc-word). One that cannot be
   * read is taken as theirs, as server.js takes it (the xf-words2 hunt's). @param {string} chainId
   */
  #agentsChat(chainId) {
    try {
      return this.archive.agentsChat?.(String(chainId)) === true;
    } catch {
      return true;
    }
  }

  /** When a claim was said: the start of the turn it came from, else when it was filed. @param {any} it @returns {number} */
  saidAt(it) {
    return this.#saidAt(it);
  }
  /** @param {any} it @returns {number} */
  #saidAt(it) {
    return (it.turn_id != null && this.archive.getTurn(it.turn_id)?.started_at) || it.created_at;
  }

  /**
   * The user's word holds its slot against a learned or a model's value (M2-6). One said after the user's may be their
   * own newer word the learner heard, so the user is asked, once, whether it replaces theirs (M6-D16): a question that
   * accepted corrects their claim to the later words, with history. Meanwhile their claim stands, flagged with the later
   * value. One said before theirs is not asked about: their word came after it. A value is asked about once, whatever
   * the words it comes in again (answered or not). → whether a question was raised.
   * @param {any} users  the user's claim @param {any} later  the value it held off (filed dismissed)
   * @param {{ at?: number, value?: string | null, run?: number | null }} [o]  `at`: when the later one was said
   */
  askLater(users, later, { at = this.#saidAt(later), value = null, run = null } = {}) {
    if (at <= this.#saidAt(users)) return false;
    const says = clip(String(value || later.text), 120);
    return !!this.archive.inbox.add({
      projectId: users.project_id,
      kind: "retire",
      key: `later:${users.id}:${value ? `=${norm(String(value))}` : later.id}`,
      itemIds: [users.id, later.id],
      proposal: { action: "correct", id: users.id, replacement: later.id, text: later.text, ...(value ? { value: String(value) } : {}), reason: `a later session said otherwise: ${says}` },
      reason: `a later session said otherwise: ${says}`,
      run,
    }).raised;
  }

  /**
   * The claim behind near-duplicate words the engine serves (≥0.8 word overlap): in this project or global, a claim
   * rather than a quote, and — for a claim in a slot — one holding the same value, since "uses
   * pnpm" and "uses bun" share every other word. A thread is near only to a thread (M7-D65): open work and something
   * true in the same words are two claims, and only the thread closes. A standing one first; null when there is none.
   * @param {string} text @param {string | null} projectId @param {{ slot: string, value: string } | null} slot @param {string} kind
   */
  async nearClaim(text, projectId, slot, kind) {
    if (!this.storeReady()) return null;
    let rows = [];
    try {
      rows = await this.store.recall(text.split(/\s+/).slice(0, 12).join(" "), { topK: 3 });
    } catch {
      return null;
    }
    const near = [];
    for (const row of rows) {
      if (engineWritten(row) || overlap(row.content, text) < 0.8) continue;
      const { item } = this.claimOfRow(row);
      if (item.project_id != null && item.project_id !== projectId) continue;
      if (EVIDENCE_KINDS.has(item.kind) || oldAbility(item.kind)) continue;
      if ((item.kind === "thread") !== (kind === "thread")) continue;
      if (slot && ((item.slot && item.slot !== slot.slot) || !holdsValue(item, slot.value))) continue;
      near.push(item);
    }
    return near.find((c) => !isRetired(c.status)) || near[0] || null;
  }

  /**
   * What a memory id names (MD-9): `i<n>` an archive item; `e:<id>`, or a bare engine id as the engine's own tools show
   * it, the item mirrored by that engine row, else the engine row alone; `s:<chain>:<n>` words of a past session, and
   * `s:<chain>` the session itself, as the dossier cites it (M7-D67).
   * @param {string} id
   * @returns {{ type: "item", item: any } | { type: "engine", engineId: string } | { type: "words" } | { type: "none", error: string }}
   */
  resolveRef(id) {
    const s = String(id ?? "").trim();
    const m = /^i(\d+)$/.exec(s);
    if (m) {
      const item = this.archive.items.get(Number(m[1]));
      return item ? { type: "item", item } : { type: "none", error: `no memory ${s}` };
    }
    if (/^s:\S+$/.test(s)) return { type: "words" };
    const engineId = s.startsWith("e:") ? s.slice(2) : s;
    if (!engineId) return { type: "none", error: "no id given" };
    const twins = this.archive.items.byMemoryId(engineId);
    const item = twins.find((x) => !isRetired(x.status)) || twins[0] || null;
    return item ? { type: "item", item } : { type: "engine", engineId };
  }

  /** The stored claim an id a line or a search shows names, or why there is none. Read only. @param {string} id */
  namedItem(id) {
    const ref = this.resolveRef(id);
    if (ref.type === "none") return { error: ref.error };
    if (ref.type === "words") return { error: "that id is a quote from a past session, not a stored memory" };
    if (ref.type === "engine") return { error: `no memory stands behind ${String(id).slice(0, 60)} yet` };
    return { item: ref.item };
  }

  /**
   * A claim as the port shows it (M2-4), by any id a line or a search shows: what it says, how it is known, where it
   * is filed. Read only. @param {string} id
   */
  claim(id) {
    const n = this.namedItem(id);
    return "error" in n ? n : { ...this.#claimView(n.item), ...this.#anchorView(n.item.id) };
  }
  /**
   * A claim as the port shows it (`claimView`), with its finder when a sub-agent's run or an outside agent gave it
   * (M7-D19, M7-D47): read from its `created` event, so only such a claim costs the read. @param {any} it
   */
  #claimView(it) {
    const finder = it.origin === "subagent" || it.origin === "agent" ? this.archive.items.events(it.id).find((e) => e.action === "created")?.detail?.finder : null;
    return { ...claimView(it), ...(finder ? { finder } : {}) };
  }

  /**
   * A claim's words written into a skill (HarnessV4_Skills_Plan step 4): one "skill" event on its History, the claim as
   * it was. False where the id names no claim. @param {string} id @param {{ skill: string, section: string, by: string }} o
   */
  noteAddedToSkill(id, { skill, section, by }) {
    const n = this.namedItem(id);
    if ("error" in n) return false;
    this.archive.items.note(n.item.id, "skill", { by, detail: { skill: String(skill), section: String(section) } });
    return true;
  }

  /**
   * A claim's history (M2-4): the claim, every change with who, why and when, and the claims it replaced and that
   * replaced it. Read only. @param {string} id
   */
  history(id) {
    const n = this.namedItem(id);
    if ("error" in n) return n;
    const it = n.item;
    return {
      ...this.#claimView(it),
      ...this.#anchorView(it.id),
      replaces: this.archive.items.replacing(it.id).map(itemRef),
      replacedBy: it.superseded_by ? itemRef(it.superseded_by) : null,
      events: this.archive.items.events(it.id).map((e) => ({
        at: isoAt(e.at),
        action: e.action,
        by: e.by ?? null,
        ...(e.reason ? { reason: e.reason } : {}),
        ...(e.detail ? { detail: e.detail } : {}),
        ...(e.run_id ? { run: e.run_id } : {}),
        ...(e.undone_at ? { undone: isoAt(e.undone_at) } : {}),
      })),
    };
  }

  /**
   * What memory did for one turn (HarnessV3-Memory M6-1), read from the archive alone (M6-D6): request records carry
   * counts and ids, never memory's words.
   * - `shown`: each claim the turn's requests carried, once, with the layers that carried it (`briefing` on the turn
   *   that built it, `turn` the related-memory block, `erratum`, and `pitfall` or `thread` on a proxied tool leg) and
   *   whether a reply used it (null: not judged yet). Words from a past session show where they are from.
   * - `briefing`: the session's briefing as built (on which turn, how many claims, its tokens); it rides on every turn.
   * - `reminders`: the pitfalls and threads said at this turn's calls, by the harness's loop or on a proxied leg (its
   *   `fired` events), how many times, and whether a pitfall's right way was followed since (M6-2).
   * - `said`: the claims filed from this turn, each with the ones it replaced.
   * - `asks`: memory's open questions in the session's project and the global ones, counted, the first three.
   * Each claim is a card (`#card`). Read only. @param {string} chainId @param {number} n  the turn's number in its session
   */
  turnMemory(chainId, n) {
    const chain = this.archive.getChain(String(chainId));
    const turn = chain && Number.isInteger(n) && n > 0 ? this.archive.getTurns(chain.id, { from: n, to: n })[0] : null;
    if (!turn) return null;
    const projectId = chain.project_id ?? null;
    /** @type {Map<string, { item: any, ref: string, layers: string[], used: boolean | null }>} */
    const shown = new Map();
    let tokens = 0;
    for (const inj of this.archive.injections.ofTurn(chain.id, turn.id)) {
      tokens += inj.tokens;
      for (const { ref, used } of inj.ids) {
        const named = this.resolveRef(ref);
        const item = named.type === "item" ? named.item : null;
        const key = item ? itemRef(item.id) : ref;
        const s = shown.get(key) || { item, ref: key, layers: [], used: null };
        if (!s.layers.includes(inj.kind)) s.layers.push(inj.kind);
        if (used != null) s.used = s.used === true || used;
        shown.set(key, s);
      }
    }
    const acts = this.archive.items.actsIn(chain.id);
    /** @type {Map<string, { itemId: number, first: number, times: number, detail: any }>} */
    const fires = new Map();
    for (const e of acts) {
      if (e.action !== "fired" || e.detail?.turn !== turn.id) continue;
      const d = e.detail;
      const key = [e.item_id, d.shape ?? "", d.args ?? "", d.file ?? ""].join("\n");
      const f = fires.get(key) || { itemId: Number(e.item_id), first: Number(e.id), times: 0, detail: d };
      f.times++;
      fires.set(key, f);
    }
    const filed = this.archive.items.ofTurn(chain.id, turn.id);
    const replaced = new Map(filed.map((it) => [it.id, this.archive.items.replacing(it.id).map((id) => this.archive.items.get(id)).filter(Boolean)]));
    const items = [...[...shown.values()].map((s) => s.item).filter(Boolean), ...[...fires.values()].map((f) => this.archive.items.get(f.itemId)).filter(Boolean), ...filed];
    const ids = items.map((it) => it.id);
    const ctx = this.#cardsOf(ids);
    const card = (/** @type {any} */ it) => this.#card(it, ctx);
    const built = this.archive.injections.briefingOf(chain.id);
    return {
      session: chain.id,
      turn: n,
      project: projectId,
      count: shown.size,
      tokens,
      briefing: built ? { turn: built.turnId != null ? (this.archive.getTurn(built.turnId)?.n ?? null) : null, count: built.ids.length, tokens: built.tokens } : null,
      shown: [...shown.values()].map((s) => ({ ...(s.item ? card(s.item) : this.#quoted(s.ref)), layers: s.layers, used: s.used })),
      reminders: [...fires.values()].map((f) => {
        const it = this.archive.items.get(f.itemId);
        const d = f.detail;
        return {
          kind: d.file != null ? "thread" : "pitfall",
          ...(d.shape ? { shape: d.shape } : {}),
          ...(d.args ? { args: d.args } : {}),
          ...(d.unless ? { unless: d.unless } : {}),
          ...(d.file ? { file: d.file } : {}),
          times: f.times,
          ...(d.unless
            ? { followed: acts.some((e) => e.action === "followed" && Number(e.item_id) === f.itemId && Number(e.id) > f.first && e.detail?.shape === d.shape && (e.detail?.args ?? "") === (d.args ?? "")) }
            : {}),
          claim: it ? card(it) : { id: itemRef(f.itemId), kind: "gone" },
        };
      }),
      said: filed.map((it) => ({ ...card(it), replaces: (replaced.get(it.id) || []).map((old) => ({ id: itemRef(old.id), text: old.text, status: old.status })) })),
      asks: { count: this.archive.inbox.count(projectId), first: this.questions(projectId, { limit: 3 }) },
    };
  }
  /**
   * One claim's card as the claim browser draws it (HarnessV3-Memory M7-D34), by any id a line shows; a stored item that
   * is no claim, refused in words. Read only. @param {string} id
   */
  card(id) {
    const n = this.namedItem(id);
    if ("error" in n) return n;
    const { kind } = n.item;
    if (!CLAIM_KINDS.has(kind)) {
      const is = EVIDENCE_KINDS.has(kind) ? "words from a past session" : kind === "permission" ? "an always-allow offer" : oldAbility(kind) ? `what the ability ${kind.slice(8)} held` : `a ${kind}`;
      return { error: `${itemRef(n.item.id)} is not a claim: it is ${is}` };
    }
    return this.#card(n.item, this.#cardsOf([n.item.id]));
  }
  /** What a view's cards read once for all of them (`#card`). @param {number[]} ids */
  #cardsOf(ids) {
    return { counts: this.archive.items.eventCounts(ids), acts: this.archive.items.actCounts(ids), check: this.anchorCheck.run(), asking: this.archive.inbox.asking(), awaiting: this.archive.inbox.awaiting(), now: this.now() };
  }
  /**
   * A claim as a view shows it (M6-1): the port's view, how memory stands on it now (how sure, the sessions behind it,
   * its flags, held back or not), what replaced it, and its triggers with how often each was said and followed. One a
   * question to the user would put in another's place, or bring back (HarnessV3-Launch RD-D3), says so; held off
   * meanwhile (M6-D16), it is `asked`, not retired: the question is where it is answered (M6-7).
   * @param {any} it @param {{ counts: Map<number, any>, acts: Map<number, any>, check: ReturnType<AnchorCheck["run"]>, asking: Map<number, any>, awaiting: Map<number, any>, now: number }} ctx
   */
  #card(it, { counts, acts, check, asking, awaiting, now }) {
    const rec = counts.get(it.id) || { evidence: 0, suspected: 0, lastSaid: null };
    const st = this.#standingNow(it, check, asking);
    const act = acts.get(it.id);
    const triggers = this.archive.triggers.of(it.id);
    const waits = awaiting.get(it.id);
    return {
      ...this.#claimView(it),
      ...(isRetired(it.status) ? {} : { sure: Math.round(confidenceOf(it, { ...rec, changed: st.changed }, now) * 100) / 100 }),
      backed: 1 + rec.evidence,
      flags: [...st.flags, ...(waits ? [waits.proposal.id != null ? `would replace ${itemRef(waits.proposal.id)} if you say so` : "would come back if you say so"] : [])],
      ...(waits && isRetired(it.status) ? { asked: `q${waits.id}` } : {}),
      ...(st.held ? { held: true } : {}),
      ...(it.superseded_by ? { replacedBy: itemRef(it.superseded_by) } : {}),
      ...(triggers.length
        ? {
            triggers: triggers.map((t) => ({
              shape: t.shape,
              ...(t.args ? { args: t.args } : {}),
              ...(t.unless ? { unless: t.unless } : {}),
              source: t.source,
              ...(act?.triggers.get(`${t.shape}\n${t.args}`) || { fired: 0, followed: 0, kept: 0 }),
            })),
          }
        : {}),
      ...(act ? { fired: act.fired, followed: act.followed, kept: act.kept } : {}),
    };
  }
  /**
   * A shown id with no claim behind it (M6-1): words of a past session, as where they are from, or an engine row Filament
   * has not adopted. @param {string} ref
   */
  #quoted(ref) {
    const m = /^(?:s|chain):(.+):(\d+)$/.exec(ref);
    if (!m) return { id: ref, kind: "engine" };
    const from = this.archive.getChain(m[1]);
    return { id: ref, kind: "words", session: m[1], turn: Number(m[2]), ...(from?.title ? { title: from.title } : {}) };
  }

  /**
   * The claims of a project, or the global ones (`projectId` null: "Everywhere"), as the claim browser lists them
   * (HarnessV3-Memory M6-5): each a card (`#card`), the most recently changed first.
   * - `state`: `standing`; `review`, the standing ones memory flags, holds back or is no longer sure of (what the owner
   *   should look at); or `retired`.
   * - `kind`: one of `CLAIM_FILTER_KEYS`; `q`: words its text holds, each anywhere in it (M7-D62), or its id.
   * - `counts`: how many each state and each kind would list, under the other filters; `more`: how many past `limit`.
   * Read only. @param {string | null} projectId @param {{ state?: string, kind?: string | null, q?: string, limit?: number }} [o]
   */
  claims(projectId, { state = "standing", kind = null, q = "", limit = 200 } = {}) {
    const rows = this.archive.items.list({ projectId: projectId ?? null, limit: 100000 }).filter((it) => CLAIM_KINDS.has(it.kind));
    const ids = rows.map((it) => it.id);
    const ctx = this.#cardsOf(ids);
    const words = String(q ?? "").trim().toLowerCase();
    const terms = words.split(/\s+/);
    const holds = (/** @type {any} */ it) => {
      const text = String(it.text).toLowerCase();
      return terms.every((t) => text.includes(t));
    };
    const all = rows.map((it) => ({ it, c: this.#card(it, ctx) })).filter(({ it, c }) => !words || c.id === words || holds(it));
    // A claim held back always carries its file's flag (`anchorFlags`), so the flags count it.
    const inState = (/** @type {any} */ c, /** @type {string} */ s) =>
      s === "retired" ? isRetired(c.status) : !isRetired(c.status) && (s !== "review" || c.flags.length > 0 || c.sure < CONFIDENCE_GATE);
    const ofKind = (/** @type {any} */ it, /** @type {any} */ c, /** @type {string | null} */ k) => !k || CLAIM_FILTERS[k](it, c);
    const listed = all.filter(({ it, c }) => inState(c, state) && ofKind(it, c, kind));
    return {
      project: projectId ?? null,
      counts: {
        ...Object.fromEntries(CLAIM_STATES.map((s) => [s, all.filter(({ it, c }) => inState(c, s) && ofKind(it, c, kind)).length])),
        kinds: {
          all: all.filter(({ c }) => inState(c, state)).length,
          ...Object.fromEntries(CLAIM_FILTER_KEYS.map((k) => [k, all.filter(({ it, c }) => inState(c, state) && CLAIM_FILTERS[k](it, c)).length])),
        },
      },
      claims: listed.slice(0, limit).map(({ c }) => c),
      more: Math.max(0, listed.length - limit),
    };
  }
  /**
   * Where claims live, as the claim browser's list shows them (M6-5): "Everywhere" (the global claims) first, then each
   * project, the most recently used first, with how many claims stand in it and its dossier's version.
   */
  claimScopes() {
    const n = this.archive.items.scopeCounts([...CLAIM_KINDS]);
    return [
      { project: null, name: "Everywhere", claims: n.get(null) || 0 },
      ...this.archive
        .projects()
        .filter((/** @type {any} */ p) => p.id !== NO_PROJECT_ID)
        .map((/** @type {any} */ p) => ({ project: p.id, name: p.name || p.cwd || p.id, cwd: p.cwd ?? null, claims: n.get(p.id) || 0, dossier: p.dossier ?? null, ...(p.archived ? { archived: true } : {}) })),
    ];
  }

  /**
   * The item a ref names, an engine memory with no item behind it adopted as an imported item first — so a retirement
   * or a correction of it keeps the same history as any other (MD-1). Refusals come back in words.
   * @param {string} id @returns {Promise<{ item: any, engineId?: string } | { error: string }>}
   */
  async claimOf(id) {
    const ref = this.resolveRef(id);
    if (ref.type === "none") return { error: ref.error };
    if (ref.type === "words")
      return { error: "that id is a quote from a past session, not a stored memory; store what holds now with filament_memory_remember" };
    if (ref.type === "item") return { item: ref.item };
    let row = null;
    if (this.storeReady())
      try {
        row = await this.store.get(ref.engineId);
      } catch {}
    if (!row?.content) return { error: `no memory ${String(id).slice(0, 60)}` };
    if (engineWritten(row)) return { error: "that row was written by the engine itself; Filament never serves it" };
    const { item } = this.claimOfRow({ ...row, id: ref.engineId });
    // A claim with an engine copy of its own: this row is another copy, retired alongside it, by its own id.
    return { item, ...(item.memory_id && item.memory_id !== ref.engineId ? { engineId: ref.engineId } : {}) };
  }

  /**
   * The bulk adoption (HarnessV3-Memory M2-3): what recall does one row at a time, done for every row the engine can
   * serve, page by page, so none is left without a claim. A row whose claim is retired (an imported copy, or one its
   * retirement's invalidation has not reached) has its invalidation queued, by its own id. Run once at start and after
   * an engine import.
   * @returns {Promise<{ rows: number, engineWritten: number, copies: number, matched: number, adopted: number, retired: number }>}
   */
  async adoptRows() {
    const out = { rows: 0, engineWritten: 0, copies: 0, matched: 0, adopted: 0, retired: 0 };
    for (const table of ["working", "episodic"])
      for (let after = 0; ; ) {
        const page = await this.store.rows({ table, after, limit: 500 });
        for (const row of page.rows || []) {
          out.rows++;
          if (engineWritten(row)) {
            out.engineWritten++;
            continue;
          }
          this.archive.transaction(() => {
            const { item, how } = this.claimOfRow(row);
            out[how === "copy" ? "copies" : how === "adopted" ? "adopted" : "matched"]++;
            if (!isRetired(item.status)) return;
            this.enqueue(item.id, "invalidate", { id: row.id, ...(item.superseded_by ? { replacement: item.superseded_by } : {}) });
            out.retired++;
          });
        }
        if (page.next == null) break;
        after = page.next;
      }
    return out;
  }

  /**
   * The claim behind an engine row (HarnessV3-Memory M2-3): the item whose copy it is (`memory_id`, a standing one
   * first: claims with the same words share the engine's one row), else the item holding its text in its project and
   * kind, which is how a copy whose id was never written down finds its item (M2-D10), else a claim adopted for it:
   * `import`, inferred. Whether the row is served, and as what, is the claim's to say. Rows the engine wrote by itself
   * are the caller's to leave out. @param {any} row
   * @returns {{ item: any, how: "copy" | "text" | "adopted" }}
   */
  claimOfRow(row) {
    const copies = this.archive.items.byMemoryId(row.id);
    if (copies.length) return { item: copies.find((x) => !isRetired(x.status)) || copies[0], how: "copy" };
    const md = row.metadata || {};
    const added = this.archive.items.add({
      projectId: md.project || null,
      chainId: md.chain || null,
      kind: md.kind || (row.memory_type === "instruction" ? "rule" : row.memory_type === "preference" ? "preference" : "fact"),
      text: clip(row.content, 500),
      status: "inferred",
      importance: row.importance ?? 0.6,
      memoryId: row.id,
      origin: "import",
    });
    if (!added.deduped) return { item: this.archive.items.get(added.id), how: "adopted" };
    const held = this.archive.items.get(added.id);
    if (!held.memory_id) this.archive.items.setMemoryId(held.id, row.id);
    return { item: this.archive.items.get(held.id), how: "text" };
  }

  /**
   * An item's standing changes here and nowhere else (MD-1), so its history, its engine copy and the errata stay in
   * step. Retiring (dismissed, superseded) queues the invalidation of the engine copy — kept, never deleted — in the
   * same transaction (M2-2), and an erratum for the sessions shown the item lately; bringing one back queues the
   * restore, which stores the copy afresh where the engine no longer holds it. `twin`: another engine row holding the same
   * text, retired with it. `run`: the curator's pass it is part of (M4-1). `errata: false`: the claim still holds in its
   * replacement's words (a merge, M4-2) or was never wrong (a thread expired, a finding lapsed: the memory plan's d5),
   * so the sessions shown it hear nothing — no erratum, nor a line in a brief (`quiet` on its status event). Retiring
   * withdraws the open questions
   * about it (M6-D16), but `answering`, the one this answers. `finder`: the agent that changed it (a sub-agent, an agent
   * over MCP), named on its history and in its errata (M7-D47).
   * @param {number} id @param {string} status
   * @param {{ by?: string, reason?: string | null, replacement?: number | null, chainId?: string | null, twin?: string | null, run?: number | null, errata?: boolean, answering?: number | null, finder?: Finder | null }} [o]
   */
  async setItemStatus(id, status, { by = /** @type {any} */ (undefined), reason = null, replacement = null, chainId = null, twin = null, run = null, errata = true, answering = null, finder = null } = {}) {
    whoAsks(by);
    const before = this.archive.items.get(Number(id));
    if (!before) return { ok: false, error: `no memory ${itemRef(id)}` };
    if (status === "superseded" && !replacement) return { ok: false, error: "superseded needs the memory that replaces it: correct it instead" };
    if (before.status === status) return { ok: true, id: itemRef(before.id), status, unchanged: true };
    const retiring = isRetired(status) && !isRetired(before.status);
    const reviving = isRetired(before.status) && !isRetired(status);
    this.archive.transaction(() => {
      this.archive.items.setStatus(before.id, status, { by, reason, replacement, run, finder, quiet: retiring && !errata });
      if (retiring) {
        this.enqueue(before.id, "invalidate", replacement ? { replacement } : {});
        if (twin) this.enqueue(before.id, "invalidate", { id: twin, ...(replacement ? { replacement } : {}) });
        // What memory asked about it is moot now: withdrawn, saying why — all but the question being answered (`answering`).
        for (const q of this.archive.inbox.about(before.id))
          if (q.id !== answering) this.archive.inbox.decide(q.id, { status: "withdrawn", by, outcome: { why: `${itemRef(before.id)} was ${status} meanwhile` } });
      } else if (reviving) {
        this.enqueue(before.id, "restore");
        // Out of the claims the merge looked near while it was retired (the memory plan's f6): it is looked up again.
        this.archive.curator.forgetNear([before.id]);
      }
    });
    if (retiring && errata) this.queueErrata(before, { replacement, by, finder, exceptChain: chainId });
    return { ok: true, id: itemRef(before.id), status };
  }

  /**
   * Retire a memory that was never true, by any id a line or a search shows (MD-1, MD-9): kept, dismissed, with who and
   * why; its engine copy invalidated, never deleted (BUG-28 stands: the item and its copy go together). `finder`: the
   * agent that retires it, named (M7-D47).
   * @param {string} id @param {{ by?: string, reason?: string | null, chainId?: string | null, finder?: Finder | null }} [o]
   */
  async forget(id, { by = /** @type {any} */ (undefined), reason = null, chainId = null, finder = null } = {}) {
    whoAsks(by);
    const c = await this.claimOf(id);
    if ("error" in c) return { ok: false, error: c.error };
    if (isRetired(c.item.status)) return { ok: true, id: itemRef(c.item.id), status: c.item.status, already: true };
    const said = clip(String(reason || "").trim(), 300);
    const r = await this.setItemStatus(c.item.id, "dismissed", { by, reason: said || "not true", chainId, twin: c.engineId || null, finder });
    if (r.ok && !speaksForUser(by) && userBacked(c.item)) this.#askBringBack(c.item, { reason: said, chainId, finder });
    return r;
  }

  /**
   * A model took the user's word away — replaced it with its correction (`now`), or retired it — and the user hears of it
   * (HarnessV3-Launch RD-D3): a question in memory's inbox, answered by bringing their word back or keeping the change.
   * The change stands meanwhile: the model read the code, and holding the stale word up would serve it wrong. Each time
   * is a question of its own, so a word taken away again after it came back is asked about again.
   * @param {any} old  the user's word, as it was
   * @param {{ now?: any, reason: string, chainId: string | null, finder: Finder | null }} o  `reason`: the model's, or ""
   */
  #askBringBack(old, { now = null, reason, chainId, finder }) {
    const who = finder ? `${finder.agent} (${FINDER_IS[finderOrigin(finder)]})` : chainId ? `the agent in session ${chainId}` : "an agent";
    const why = reason ? ` (${reason})` : "";
    const base = `corrected:${old.id}:${now ? now.id : ""}`;
    let key = base;
    for (let n = 2; this.archive.inbox.has(key); n++) key = `${base}:${n}`;
    this.archive.inbox.add({
      projectId: old.project_id ?? null,
      kind: "corrected",
      key,
      itemIds: [old.id, ...(now ? [now.id] : [])],
      // As every question names them: `id` what would go (the correction), `replacement` what would come in (their word).
      proposal: { action: "bring-back", ...(now ? { id: now.id } : {}), replacement: old.id },
      reason: now ? `${who} corrected your word: “${clip(old.text, 120)}” → “${clip(now.text, 120)}”${why}` : `${who} retired your word: “${clip(old.text, 120)}”${why}`,
    });
  }

  /**
   * Why a retired claim is not corrected, and what to do instead (M7-D67): its replacements followed to the end — the
   * one that stands, by its words, to correct instead; or, the end retired too, why, and that what is true now is a new
   * memory, said as the caller makes one.
   * @param {any} old  a retired claim @param {string} by
   */
  #whatStands(old, by) {
    const chain = [];
    let end = old;
    for (let next = old.superseded_by; old.status === "superseded" && next && chain.length < 20; next = end.status === "superseded" ? end.superseded_by : null) {
      const it = this.archive.items.get(next);
      if (!it || it.id === old.id || chain.some((x) => x.id === it.id)) break;
      chain.push(it);
      end = it;
    }
    const how = chain.length ? `${itemRef(old.id)} was replaced by ${chain.map((x) => itemRef(x.id)).join(", then ")}` : `${itemRef(old.id)} is retired`;
    if (!isRetired(end.status)) return `${how}, which stands: "${clip(end.text, 200)}"; correct ${itemRef(end.id)} if it is wrong too`;
    const why = `${end.status}${end.invalid_reason ? `: ${clip(end.invalid_reason, 160)}` : ""}`;
    // Said to the user: a new memory is theirs to keep by a command, or by telling the agent (nothing is filed from a
    // message by its words, the memory plan's d3).
    const anew = speaksForUser(by) ? "keep what is true now as a new memory (`@mem remember …`, or tell the agent)" : "store what is true now with filament_memory_remember";
    return `${how}${chain.length ? ", retired since" : ""} (${why}): nothing of it stands; ${anew}`;
  }

  /**
   * Replace a memory that proved wrong or outdated (MD-1): the new text is its own item, the old one is superseded by
   * it — kept, with the reason — and the sessions shown the old one hear of it on their next turn. Without a new text
   * the old one is only retired. The person or the owner states the new one (confirmed); a model's is a note
   * (inferred) until the user confirms it; a sub-agent's run's (`finder`, M7-D20) is its finding. `answering`: the
   * question of memory's this answers (it stays open to be closed as accepted). `quote`: the person's own words that
   * correct it (the memory plan's d1) — found in this chat's (`#heard`), the new text is the user's correction (origin
   * `correction`), and replaces even their own word without asking them; `helper` as `remember` takes it.
   * @param {string} id
   * @param {{ text?: string, reason?: string, by?: string, chainId?: string | null, turnId?: number | null, client?: string, answering?: number | null, finder?: Finder | null, quote?: string, helper?: boolean }} [o]
   */
  async correct(id, { text = "", reason = "", by = /** @type {any} */ (undefined), chainId = null, turnId = null, client = "", answering = null, finder = null, quote = "", helper = false } = {}) {
    whoSays(by);
    const c = await this.claimOf(id);
    if ("error" in c) return { ok: false, error: c.error };
    const old = c.item;
    if (isRetired(old.status)) return { ok: false, error: this.#whatStands(old, by) };
    const said = clip(String(reason || "").trim(), 300);
    const why = said || "corrected";
    const body = clip(String(text || "").trim(), 500);
    if (!body) return { ...(await this.forget(id, { by, reason: why, chainId, finder })), retired: true };
    if (norm(body) === norm(old.text)) return { ok: false, error: "the new text is the old one; filament_memory_confirm marks a memory that proved right" };
    const model = !speaksForUser(by);
    // An always-allow offer is the user's to answer: a model's new words for one would offer another command (H4).
    if (model && old.kind === "permission") return { ok: false, error: `${itemRef(old.id)} is not a claim: it is an always-allow offer, which only the user answers` };
    let heard = model && String(quote || "").trim() ? this.#heard(quote, { text: body, chainId, turnId, finder, helper }) : null;
    // The user's word said before the memory it would replace is not their newer word.
    if (heard && "turn" in heard && heard.startedAt < this.#saidAt(old)) heard = { why: `the user said that before ${itemRef(old.id)} was said, so it does not replace it as their word` };
    const heardSaid = heard && "turn" in heard ? heard : null;
    const told = heard ? (heardSaid ? { heard: true } : { unheard: heard.why }) : {};
    // The replacement holds the old claim's slot (M2-5): what it gives the value of. Its value is in its words.
    const slot = old.slot ? { slot: old.slot, value: null, multi: !!old.slot_multi } : null;
    const added = this.addItem(
      {
        projectId: old.project_id,
        chainId: chainId ?? old.chain_id,
        turnId,
        kind: EVIDENCE_KINDS.has(old.kind) ? "fact" : old.kind,
        text: body,
        status: model ? "inferred" : "confirmed",
        importance: Math.max(Number(old.importance) || 0, 0.8),
        origin: heardSaid ? "correction" : originOf(by, "correction", finder),
        slot,
        ...(finder && model ? { finder } : {}),
        ...(heardSaid ? { quoted: { quote: heardSaid.quote, turn: heardSaid.n, by } } : {}),
      },
      { client },
    );
    let now = this.archive.items.get(added.id);
    if (isRetired(now.status)) {
      if (model) return { ok: false, error: `that text is on file as ${now.status} (${itemRef(now.id)}); only the user can bring it back` };
      await this.setItemStatus(now.id, "confirmed", { by, reason: why });
      now = this.archive.items.get(now.id);
    } else if (added.deduped && !now.memory_id) this.enqueue(now.id, "mirror", { client });
    // A text on file the person is quoted correcting to: their correction from here on, its history saying who heard.
    if (added.deduped && heardSaid && !userBacked(now))
      this.archive.transaction(() => {
        this.archive.items.setOrigin(now.id, "correction");
        this.archive.items.note(now.id, "heard", { by, detail: { from: now.origin, quote: heardSaid.quote, turn: heardSaid.n, ...(chainId ? { chain: String(chainId) } : {}) } });
      });
    // A text already on file without a slot: it is the slot's value now, and its history says so (M7-D33).
    if (slot && !now.slot)
      this.archive.transaction(() => {
        this.archive.items.setSlot(now.id, slot);
        this.archive.items.note(now.id, "slot", { by, detail: { from: null, to: slot } });
      });
    await this.setItemStatus(old.id, "superseded", { by, reason: why, replacement: now.id, chainId, twin: c.engineId || null, answering, finder });
    // The person's words of this very turn, quoted correcting a memory the session had been shown before it, push back on
    // the reply that could rest on it: it counts as corrected by the user in how models did (M7-D50, the memory plan's
    // d4), once. A memory the session was never shown is news to it, and marks nothing.
    if (heardSaid && turnId != null && heardSaid.turn === turnId && chainId) {
      const before = this.archive.turnBefore(String(chainId), turnId);
      if (before && this.archive.injections.shownIn(String(chainId), 0, before.id).includes(itemRef(old.id))) this.archive.outcomes.correctTurn(String(chainId), turnId);
    }
    // The user's word taken away by an agent is asked about; by their own newer word, quoted in this chat, it is not.
    if (model && userBacked(old) && !heardSaid) this.#askBringBack(old, { now, reason: said, chainId, finder });
    return { ok: true, id: itemRef(now.id), replaces: itemRef(old.id), status: now.status, ...told };
  }

  /**
   * A memory proved right. The person's or the owner's word makes it confirmed (it never fades, and its line says so);
   * a model's is a use — the memory counts as used where it was last shown, and its history notes it — but only the
   * user's word makes it "user confirmed".
   * @param {string} id @param {{ by?: string }} [o]
   */
  async confirm(id, { by = /** @type {any} */ (undefined) } = {}) {
    whoAsks(by);
    const c = await this.claimOf(id);
    if ("error" in c) return { ok: false, error: c.error };
    const it = c.item;
    // A retired claim is not confirmed back: the user brings it back by saying it again (remember), anyone else cannot.
    if (isRetired(it.status))
      return { ok: false, error: `${itemRef(it.id)} is ${it.status}${it.superseded_by ? ` by ${itemRef(it.superseded_by)}` : ""}; ${speaksForUser(by) ? "remembering its words again brings it back" : "only the user can bring it back"}` };
    // Proved right now: anchored afresh against its files as they are (M3-3), so a change it survived is no longer flagged.
    const root = it.project_id ? this.archive.getProject?.(it.project_id)?.cwd : null;
    if (root) this.archive.anchors.replace(it.id, anchorsFor(it.text, root));
    if (speaksForUser(by)) return this.setItemStatus(it.id, "confirmed", { by, reason: "confirmed" });
    this.archive.items.note(it.id, "verified", { by });
    this.archive.injections.creditLatest(itemRef(it.id));
    return { ok: true, id: itemRef(it.id), status: it.status, note: "noted as proved right; it counts as used" };
  }

  // ---- the curator's verbs (HarnessV3-Memory M4): each action is an event of its pass, so the pass can be undone ----

  /**
   * Where a claim's files stand now (M4-4), checked afresh: the worst state and each anchor with its state now, or null
   * when it names none. An unanchored claim is anchored first, and a state that moved is recorded, as on a recall.
   * @param {any} claim
   */
  filesOf(claim) {
    const check = this.anchorCheck.run();
    const worst = this.#anchorState(claim, check);
    if (!worst) return null;
    return { worst, anchors: this.archive.anchors.of(claim.id).map((a) => ({ ...a, now: check(a) })) };
  }

  /**
   * A project's dossier as a session starting now would read it (M4-7), whole: its text, the version it renders and
   * what wrote that version, how many lines show and how many its retired or held claims hide. Null for no project.
   * @param {string} projectId
   */
  dossierOf(projectId) {
    const project = this.archive.getProject(projectId);
    if (!project) return null;
    const b = this.#dossierBlock({ project, fileCheck: this.anchorCheck.run(), env: null }, Infinity);
    const d = this.archive.dossiers.latest(project.id);
    return {
      project: project.id,
      version: b.version,
      written: d ? { at: d.created_at, model: d.model, run: d.run_id != null ? `r${d.run_id}` : null } : null,
      text: b.text,
      lines: b.lines,
      hidden: b.hidden,
      cites: [...new Set(b.shown.map((c) => c.id))],
      // Its lines by section, each with the claims it rests on (M6-5: the dossier is edited through them, M6-D3).
      sections: b.placed.reduce((/** @type {{ title: string, lines: { text: string, cites: string[], flags: string[] }[] }[]} */ out, row) => {
        if (out.at(-1)?.title !== row.section) out.push({ title: row.section, lines: [] });
        /** @type {any} */ (out.at(-1)).lines.push({ text: row.text, cites: row.cites.map((c) => c.id), flags: row.flags, ...(row.page ? { page: row.page } : {}) });
        return out;
      }, []),
    };
  }

  /**
   * Claims that say the same thing, made one (M4-2): each other one superseded by the survivor — with no erratum, since
   * what it said still holds in the survivor's words — and the sessions that said it moved onto the survivor as
   * evidence. The caller chose the survivor (M4-D1).
   * @param {number} survivorId @param {number[]} others @param {{ by?: string, run?: number | null }} [o]
   */
  async merge(survivorId, others, { by = /** @type {any} */ (undefined), run = null } = {}) {
    whoAsks(by);
    const s = this.archive.items.get(survivorId);
    if (!s || isRetired(s.status)) return { ok: false, error: `${itemRef(survivorId)} does not stand` };
    const merged = [];
    for (const id of others) {
      const o = this.archive.items.get(id);
      if (!o || o.id === s.id || isRetired(o.status)) continue;
      const said = [
        { chainId: o.chain_id, turnId: o.turn_id },
        ...this.archive.items
          .events(o.id)
          .filter((e) => e.action === "evidence" && !e.undone_at && e.detail?.chain)
          .map((e) => ({ chainId: e.detail.chain, turnId: e.detail.turn ?? null })),
      ].filter((x) => x.chainId);
      const r = await this.setItemStatus(o.id, "superseded", { by, replacement: s.id, reason: `${MERGED} ${itemRef(s.id)}`, run, errata: false });
      if (!r.ok) continue;
      for (const x of said) this.#evidence(s, { ...x, text: o.text }, by, run);
      merged.push(itemRef(o.id));
    }
    return { ok: true, id: itemRef(s.id), merged };
  }

  /**
   * Key a standing claim to the slot it gives a value of (M4-3). A `slot` event keeps the slot it had, so the pass can
   * be undone. @param {number} id @param {{ slot: string, value: string, multi: boolean }} slot
   * @param {{ by?: string, run?: number | null }} [o]
   */
  keyClaim(id, slot, { by = /** @type {any} */ (undefined), run = null } = {}) {
    whoAsks(by);
    const it = this.archive.items.get(id);
    if (!it || isRetired(it.status)) return { ok: false, error: `${itemRef(id)} does not stand` };
    const from = it.slot ? { slot: it.slot, value: it.slot_value ?? null, multi: !!it.slot_multi } : null;
    this.archive.transaction(() => {
      this.archive.items.setSlot(it.id, slot);
      this.archive.items.note(it.id, "slot", { by, run, detail: { from, to: slot } });
    });
    return { ok: true, id: itemRef(it.id) };
  }

  /**
   * A claim checked against its files as they are and found to hold (M4-4): anchored afresh, so the change it survived
   * no longer marks it. The `verified` event keeps the anchors it had, so the pass can be undone.
   * @param {number} id @param {{ by?: string, run?: number | null, reason?: string | null }} [o]
   */
  reanchor(id, { by = /** @type {any} */ (undefined), run = null, reason = null } = {}) {
    whoAsks(by);
    const it = this.archive.items.get(id);
    const root = it?.project_id ? this.archive.getProject?.(it.project_id)?.cwd : null;
    if (!it || isRetired(it.status) || !root) return { ok: false, error: `${itemRef(id)} has no files to anchor` };
    const had = this.archive.anchors.of(it.id);
    this.archive.transaction(() => {
      this.archive.anchors.replace(it.id, anchorsFor(it.text, root));
      this.archive.items.note(it.id, "verified", { by, run, reason, detail: { anchors: had } });
    });
    return { ok: true, id: itemRef(it.id) };
  }

  /**
   * Undo a curator pass (M4-1, M4-D6): its actions reversed newest first and marked undone, never deleted; the
   * questions it raised withdrawn; the dossier it wrote set aside. An action whose claim changed since is left as it
   * is, and named; the pass counts as undone once none is left.
   * @param {number} runId @param {{ by?: string }} [o]
   */
  async undoRun(runId, { by = /** @type {any} */ (undefined) } = {}) {
    whoAsks(by);
    const run = this.archive.curator.get(Number(runId));
    if (!run) return { ok: false, error: `no curator pass r${runId}` };
    if (run.undone_at) return { ok: true, run: `r${run.id}`, already: true, undone: 0, skipped: [] };
    let undone = 0;
    const skipped = [];
    for (const e of this.archive.curator.events(run.id)) {
      const r = await this.#undo(e, by);
      if (r.ok) undone++;
      else skipped.push({ event: e.id, id: itemRef(e.item_id), action: e.action, why: r.why });
    }
    for (const q of this.archive.inbox.byRun(run.id)) this.archive.inbox.decide(q.id, { status: "withdrawn", by, outcome: { why: `its pass r${run.id} was undone` } });
    for (const d of this.archive.dossiers.byRun(run.id)) this.archive.dossiers.undone(d.id);
    for (const p of this.archive.pages.byRun(run.id)) this.archive.pages.undone(p.id);
    // Its lookups by meaning (the memory plan's f6) are made again, so a pair it judged distinct is asked again.
    this.archive.curator.undoneNear(run.id);
    if (!skipped.length) this.archive.curator.undone(run.id, by);
    return { ok: true, run: `r${run.id}`, undone, skipped };
  }

  /** Undo one action of a curator pass. @param {number} eventId @param {{ by?: string }} [o] */
  async undoEvent(eventId, { by = /** @type {any} */ (undefined) } = {}) {
    whoAsks(by);
    const e = this.archive.curator.event(Number(eventId));
    if (!e?.run_id) return { ok: false, error: `no curator action ${eventId}` };
    if (e.undone_at) return { ok: true, event: e.id, already: true };
    const r = await this.#undo(e, by);
    return r.ok ? { ok: true, event: e.id } : { ok: false, error: r.why };
  }

  /**
   * One action reversed: a status put back (as a change of its own, with its reason), a slot unkeyed or rekeyed, the
   * anchors a check replaced put back; then the action is marked undone. A status or a slot changed since is not
   * overwritten. @param {any} e @param {string} by @returns {Promise<{ ok: true } | { ok: false, why: string }>}
   */
  async #undo(e, by) {
    const it = this.archive.items.get(e.item_id);
    if (!it) return { ok: false, why: "the claim is gone" };
    const why = `undone: curator pass r${e.run_id}`;
    if (e.action === "status") {
      if (it.status !== e.detail?.to) return { ok: false, why: `it is ${it.status} now, not ${e.detail?.to}` };
      const r = await this.setItemStatus(it.id, e.detail.from, { by, reason: why });
      if (!r.ok) return { ok: false, why: r.error };
    } else if (e.action === "slot") {
      if (it.slot !== e.detail?.to?.slot || (it.slot_value ?? null) !== (e.detail?.to?.value ?? null)) return { ok: false, why: "its slot changed since" };
      this.archive.items.setSlot(it.id, e.detail.from);
    } else if (e.action === "verified") this.archive.anchors.replace(it.id, e.detail?.anchors || []);
    this.archive.transaction(() => {
      this.archive.curator.undoneEvent(e.id);
      // A verdict of two claims undone: both are looked up by meaning again, so the pair is asked again (f6).
      if (e.action === "distinct") this.archive.curator.forgetNear([it.id, Number(e.detail?.other)]);
      if (e.action !== "status") this.archive.items.note(it.id, "undo", { by, reason: why, detail: { event: e.id, action: e.action } });
    });
    return { ok: true };
  }

  /**
   * Memory's questions for the user (M4-6): what the curator would do to their word, asked instead of done — a project's
   * and the global ones, oldest first. @param {string | null} projectId @param {{ status?: string, limit?: number }} [o]
   */
  questions(projectId, { status = "open", limit = 50 } = {}) {
    return this.archive.inbox.list({ projectId, status, limit }).map((q) => this.#questionView(q));
  }
  /**
   * Whether a caller kept to one project (port.js `confined`) reaches a question: none that would keep a claim in every
   * project, which quotes other projects' (the memory plan's f5), nor one about another project's claim.
   * @param {{ kind: string, itemIds: number[] }} q a question as the inbox keeps it @param {string | null} own
   */
  questionReaches(q, own) {
    return q.kind !== "everywhere" && !q.itemIds.some((id) => {
      const p = this.archive.items.get(id)?.project_id;
      return p != null && p !== own;
    });
  }
  /** @param {any} q */
  #questionView(q) {
    return {
      id: `q${q.id}`,
      kind: q.kind,
      project: q.project_id ?? null,
      proposal: q.proposal,
      reason: q.reason,
      claims: q.itemIds.map((id) => this.archive.items.get(id)).filter(Boolean).map(claimView),
      ...(q.run_id ? { run: `r${q.run_id}` } : {}),
      status: q.status,
      created: isoAt(q.created_at),
      ...(q.decided_at ? { decided: isoAt(q.decided_at), by: q.decided_by } : {}),
    };
  }

  /**
   * Answer one of memory's questions (M4-6) — the user's alone. `accept` carries out what it proposes through the
   * verbs, as whoever answers: a retirement with its history, a restore as their own word, their word a model took away
   * brought back (HarnessV3-Launch RD-D3). `reject` closes it for good:
   * the same question is never raised again. A question its claims outran (retired since) is withdrawn.
   * @param {string | number} id @param {string} answer @param {{ by?: string, chainId?: string | null }} [o]
   */
  async decide(id, answer, { by = /** @type {any} */ (undefined), chainId = null } = {}) {
    whoAsks(by);
    if (!speaksForUser(by)) return { ok: false, error: "only the user answers memory's questions" };
    const q = this.archive.inbox.get(Number(String(id).replace(/^q/i, "")));
    if (!q) return { ok: false, error: `no question ${id}` };
    if (q.status !== "open") return { ok: false, error: `q${q.id} is ${q.status} already` };
    if (answer === "reject") {
      this.archive.inbox.decide(q.id, { status: "rejected", by });
      return { ok: true, id: `q${q.id}`, status: "rejected" };
    }
    if (answer !== "accept") return { ok: false, error: "answer accept or reject" };
    const p = q.proposal || {};
    const withdraw = (/** @type {string} */ why) => {
      this.archive.inbox.decide(q.id, { status: "withdrawn", by, outcome: { why } });
      return { ok: false, id: `q${q.id}`, status: "withdrawn", error: why };
    };
    /** @type {any} */
    let r;
    if (p.action === "retire") {
      const it = this.archive.items.get(p.id);
      if (!it || isRetired(it.status)) return withdraw(`${itemRef(p.id)} is no longer standing`);
      const rep = p.replacement ? this.archive.items.get(p.replacement) : null;
      if (p.replacement && (!rep || isRetired(rep.status))) return withdraw(`${itemRef(p.replacement)}, its replacement, no longer stands`);
      r = await this.setItemStatus(it.id, rep ? "superseded" : "dismissed", { by, reason: `${p.reason} (accepted from memory's questions, q${q.id})`, replacement: rep?.id ?? null, chainId, answering: q.id });
      // A thread the user agreed is done (M5-5): closed, not wrong (M5-D5), in the session that finished it.
      if (r.ok && q.kind === "close") this.archive.items.note(it.id, "closed", { by, detail: { chain: p.chain ?? null } });
    } else if (p.action === "restore") r = { ok: true, ...(await this.remember(p.text, { kind: p.kind, projectId: q.project_id, chainId, by })) };
    // A lesson the same correction across sessions suggests (the memory plan's f4): accepted, its words are the user's rule.
    else if (p.action === "adopt") r = { ok: true, ...(await this.remember(p.text, { kind: p.kind || "rule", projectId: q.project_id, chainId, by })) };
    else if (p.action === "everywhere") {
      // A claim about the user projects learned (the memory plan's f5): accepted, its words are the user's in every
      // project — a claim of none, in its slot — in place of each claim it says the same as that still stands. A
      // single-valued slot holds one value everywhere: one the user keeps there already is corrected to these words.
      const pick = p.pick != null ? this.archive.items.get(p.pick) : null;
      if (p.pick != null && (!pick || isRetired(pick.status))) return withdraw(`${itemRef(p.pick)}, the claim it would keep, no longer stands`);
      const standing = (Array.isArray(p.from) ? p.from : []).map((/** @type {number} */ id) => this.archive.items.get(id)).filter((/** @type {any} */ it) => it && !isRetired(it.status));
      if (!standing.length) return withdraw("none of the claims it was drawn from stands any more");
      const had = p.slot
        ? this.archive.items.inSlot(null, p.slot).find((/** @type {any} */ it) => (p.multi ? !!it.slot_multi && holdsValue(it, p.value || p.text) : !it.slot_multi))
        : null;
      if (had && !p.multi && norm(had.text) !== norm(p.text)) {
        r = await this.correct(itemRef(had.id), { text: p.text, reason: `the user keeps it in every project (accepted from memory's questions, q${q.id})`, by, chainId, answering: q.id });
        if (r.ok) r.itemId = Number(String(r.id).slice(1));
      } else r = had ? { ok: true, itemId: had.id, id: itemRef(had.id) } : { ok: true, ...(await this.remember(p.text, { kind: p.kind || "fact", projectId: null, chainId, by })) };
      const kept = r.ok && r.itemId != null ? this.archive.items.get(r.itemId) : null;
      if (kept && p.slot && !kept.slot)
        this.archive.transaction(() => {
          const slot = { slot: p.slot, value: p.value ?? null, multi: !!p.multi };
          this.archive.items.setSlot(kept.id, slot);
          this.archive.items.note(kept.id, "slot", { by, detail: { from: null, to: slot } });
        });
      if (kept)
        for (const it of standing)
          if (it.id !== kept.id) await this.setItemStatus(it.id, "superseded", { by, replacement: kept.id, reason: `the user keeps it in every project (accepted from memory's questions, q${q.id})`, chainId, answering: q.id });
    }
    else if (p.action === "correct") {
      // The user's word a later session said otherwise (M6-D16): accepted, the later words are theirs now — their
      // correction of it, with its history — the learned claim they came from brought back as the user's.
      const it = this.archive.items.get(p.id);
      if (!it || isRetired(it.status)) return withdraw(`${itemRef(p.id)} is no longer standing`);
      r = await this.correct(itemRef(it.id), { text: p.text, reason: `${p.reason} (accepted from memory's questions, q${q.id})`, by, chainId, answering: q.id });
    } else if (p.action === "bring-back") {
      // The user's word a model took away (HarnessV3-Launch RD-D3) comes back as theirs, confirmed, and the correction that
      // replaced it is replaced by it in turn: the sessions shown the correction hear so. Their word back already, or out
      // by other means since, and the question is withdrawn.
      const yours = this.archive.items.get(p.replacement);
      const out = p.id != null ? yours?.status === "superseded" && yours.superseded_by === p.id : yours?.status === "dismissed";
      if (!out) return withdraw(`${itemRef(p.replacement)} is not ${p.id != null ? `replaced by ${itemRef(p.id)}` : "retired"} any more`);
      const accepted = `(accepted from memory's questions, q${q.id})`;
      r = await this.setItemStatus(p.replacement, "confirmed", { by, reason: `brought back${p.id != null ? ` over ${itemRef(p.id)}` : ""} ${accepted}`, chainId });
      if (p.id != null) r = await this.setItemStatus(p.id, "superseded", { by, reason: `the user brought back ${itemRef(p.replacement)} ${accepted}`, replacement: p.replacement, chainId, answering: q.id });
      if (r.ok) r = { ok: true, id: itemRef(p.replacement) };
    } else return { ok: false, error: `q${q.id} proposes nothing memory knows how to do` };
    if (!r.ok) return { ok: false, id: `q${q.id}`, error: r.error };
    this.archive.inbox.decide(q.id, { status: "accepted", by, outcome: { id: r.id } });
    return { ok: true, id: `q${q.id}`, status: "accepted", result: r.id };
  }

  /**
   * Tell the sessions shown a memory in the last `ERRATA_DAYS` that it was retired (M1-7): an entry on each chain's
   * meta, said once at the top of that session's next turn block. The session that retired it was there and is not
   * told. @returns {number} the sessions told
   */
  queueErrata(item, { replacement = null, by, finder = null, exceptChain = null }) {
    const chains = this.archive.injections
      .chainsShown(shownRefs(item), this.now() - ERRATA_DAYS * 86400000)
      .filter((c) => c !== exceptChain);
    if (!chains.length) return 0;
    const now = replacement ? this.archive.items.get(replacement) : null;
    const entry = {
      ref: itemRef(item.id),
      old: clip(item.text, 160),
      ...(now ? { nowRef: itemRef(now.id), now: clip(now.text, 200) } : {}),
      by: retiredBy(by, finder),
      at: this.now(),
    };
    for (const c of chains) this.archive.appendMeta(c, "errata", entry, 10);
    currentTrace()?.step("errata queued", { sessions: chains.length, note: "the sessions shown the retired memory hear of it on their next turn" });
    return chains.length;
  }

  /**
   * What a session was shown that is retired since, or whose files moved since (M1-7, M3-3): its queued errata, taken and
   * said once, as lines, and what replaced each logged as shown to it (`erratum`), so that is followed in turn. A
   * session's turn block says them at its top; an outside agent's session over MCP at the top of its next answer
   * (HarnessV3-Memory M7-D40). `check`: the files as this request sees them (by default, as they are now).
   * @param {string} chainId @param {{ requestId?: string | null, turnId?: number | null, check?: any }} [o]
   * @returns {{ text: string, errata: any[] }}
   */
  sayErrata(chainId, { requestId = null, turnId = null, check = null } = {}) {
    this.#checkShown(chainId, check || this.anchorCheck.run());
    const errata = this.takeErrata(chainId);
    if (!errata.length) return { text: "", errata };
    const text = errata.map(erratumLine).join("\n");
    const now = errata.filter((e) => e.nowRef);
    if (now.length) {
      this.noteInjected(requestId, now.map((e) => [e.nowRef, e.now]));
      this.archive.injections.add({ requestId, chainId, turnId, kind: "erratum", ids: now.map((e) => e.nowRef), tokens: est(text) });
    }
    return { text, errata };
  }
  /**
   * What an outside agent's session over MCP was shown outside a request (HarnessV3-Memory M7-D40): a search's results, a
   * claim's card or history, a reminder, its opening brief, logged as shown to it, so a claim retired later reaches it as
   * an erratum. Never judged for use: it has no request.
   * @param {string} chainId @param {string} kind @param {string[]} ids @param {string} text
   */
  noteShown(chainId, kind, ids, text) {
    if (ids.length) this.archive.injections.add({ requestId: null, chainId, turnId: null, kind, ids, tokens: est(text) });
  }
  /**
   * The chain's queued errata, taken (the queue is emptied), the stale ones dropped. Read as their one key of the meta:
   * every turn block asks, and the meta grows with the chat. @param {string} chainId
   */
  takeErrata(chainId) {
    const list = this.archive.metaOf(chainId, ["errata"])?.errata;
    if (!Array.isArray(list) || !list.length) return [];
    this.archive.mergeMeta(chainId, { errata: undefined });
    const since = this.now() - ERRATA_DAYS * 86400000;
    return list.filter((e) => e && e.ref && Number(e.at) >= since);
  }
  mute(chainId, on) {
    const ch = this.archive.getChain(chainId);
    if (!ch) return false;
    const meta = parse(ch.meta_json) || {};
    meta.muted = !!on;
    this.archive.setMeta?.(chainId, meta);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------------
function parse(s) {
  if (!s) return null;
  if (typeof s === "object") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
function globMatch(pattern, value) {
  if (!pattern) return false;
  const re = new RegExp(
    "^" +
      String(pattern)
        .split("*")
        .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*") +
      "$",
    "i",
  );
  return re.test(String(value || ""));
}
// The tool calls of an assistant message as searchable text: names and inputs in both wire shapes.
/**
 * The tool calls an assistant message made, as name and input: Anthropic's `tool_use` blocks, OpenAI's `tool_calls`
 * (their arguments parsed; text that is not JSON is kept as the command it most likely is), with the id the result answers.
 * @param {any} msg @returns {{ id: string, name: string, input: any }[]}
 */
function toolCallsOf(msg) {
  const out = [];
  if (Array.isArray(msg?.content)) for (const b of msg.content) if (b?.type === "tool_use") out.push({ id: String(b.id ?? ""), name: String(b.name || ""), input: b.input || {} });
  if (Array.isArray(msg?.tool_calls))
    for (const c of msg.tool_calls) {
      const raw = c.function?.arguments ?? c.arguments ?? "";
      let input = raw;
      if (typeof raw === "string") {
        try {
          input = JSON.parse(raw || "{}");
        } catch {
          input = { command: raw };
        }
      }
      out.push({ id: String(c.id ?? ""), name: String(c.function?.name || c.name || ""), input });
    }
  return out;
}
// The fields a file tool names its file or folder in, across clients: Claude Code, Codex, Cursor, Gemini, Filament's hands.
const PATH_FIELDS = ["file_path", "path", "notebook_path", "filePath", "target_file", "absolute_path", "dir_path"];
/**
 * The files and folders a tool call names (M5-5), as absolute paths under the project's folder: a shell call's command
 * read for paths as a claim's words are (`namedPaths`), any other tool's path fields.
 * @param {string} tool @param {any} input @param {string} root @returns {string[]}
 */
function callPaths(tool, input, root) {
  return underRoot(
    triggerTool(tool) === "bash" ? namedPaths(commandOf(input)) : [...PATH_FIELDS.map((f) => input?.[f]), ...(Array.isArray(input?.paths) ? input.paths : [])].filter((p) => typeof p === "string" && p.trim()),
    root,
  );
}
/** Paths as named, absolute, those under the project's folder only, each once. @param {string[]} named @param {string} root */
function underRoot(named, root) {
  /** @type {string[]} */
  const out = [];
  for (const p of named) {
    const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
    if (withinFolder(abs, root) && !out.includes(abs)) out.push(abs);
  }
  return out;
}
// The exit code a shell result's words state ("Exit code 1", "Command exited with code 2", "exit status 127").
const EXIT_CODE = /\bexit(?:ed)?(?: with)? (?:code|status)\b:?\s*(-?\d+)/i;
/**
 * What a tool-result leg says the calls of the assistant message before it did (M5-4), each with its call: Anthropic's
 * `tool_result` blocks, failed when `is_error`; an OpenAI `tool` message, whose words alone say how it ended, so it
 * counts only when they open with its exit code. The error's words are kept for a failure.
 * @param {any} prev  the assistant message @param {any} last  the leg's message
 * @returns {{ id: string, tool: string, input: any, ok: boolean, exitCode: number | null, error: string | null }[]}
 */
function toolResultsOf(prev, last) {
  const calls = new Map(toolCallsOf(prev).map((c) => [c.id, c]));
  // A picture's or an artifact's code is never memory's to read (HarnessV4_Visuals_Plan VC-32, HarnessV4_Artifacts_Plan
  // AFC-52): its call reads in brief, and an artifact a refusal hands back whole, without its files.
  const of = (/** @type {any} */ id, /** @type {boolean} */ ok, /** @type {string} */ text, /** @type {number | null} */ exitCode) => {
    const c = calls.get(String(id ?? ""));
    return c ? [{ id: c.id, tool: c.name, input: inBrief(c.name, c.input), ok, exitCode, error: ok ? null : withoutArtifactFiles(text).slice(0, 2000) }] : [];
  };
  if (last?.role === "tool") {
    const text = textOfContent(last.content);
    const code = /^\s*exit code:?\s*(-?\d+)/i.exec(text);
    return code ? of(last.tool_call_id, Number(code[1]) === 0, text, Number(code[1])) : [];
  }
  return (Array.isArray(last?.content) ? last.content : []).flatMap((b) => {
    if (b?.type !== "tool_result") return [];
    const text = textOfContent(b.content);
    const code = EXIT_CODE.exec(text);
    return of(b.tool_use_id, !b.is_error, text, code ? Number(code[1]) : null);
  });
}
function toolCallsText(msg) {
  const parts = [];
  if (Array.isArray(msg?.content))
    for (const b of msg.content)
      if (b?.type === "tool_use") parts.push(`${b.name} ${JSON.stringify(b.input || {})}`);
  if (Array.isArray(msg?.tool_calls))
    for (const c of msg.tool_calls)
      parts.push(`${c.function?.name || c.name || ""} ${c.function?.arguments || ""}`);
  return parts.join(" ");
}

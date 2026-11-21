// @ts-check
// The curator (HarnessV3-Memory M4; MD-12, MD-13): memory's sleep. Between sessions it goes over one project's memory
// (or the global claims) and keeps it true and small:
// - an open thread memory is no longer sure of has expired (M4-5);
// - a claim whose file has been gone for a day is retired (M4-4);
// - a finding sessions were shown and none used, that no other session said, lapses (the memory plan's d5);
// - an unkeyed value gets the slot it gives a value of, and its slot is settled by M2-5's rule (M4-3);
// - claims that say the same thing become one (M4-2), found by their words or by meaning, in any language (f6);
// - a claim whose file changed is checked against the file as it is (M4-4);
// - the engine rows the fence set aside that are verbatim copies of old items become questions (M2-D14);
// - the project's dossier is written from its standing claims (M4-7);
// - the same correction given in two sessions or more becomes a question: keep its lesson as the user's rule (f4);
// - a claim about the user learned in two projects or more becomes a question: keep it about them in every project (f5);
// - one topic of the project a pass gets its page: its claims folded into fewer lines, each citing them (f7).
// The model judges sameness and truth; rules choose what happens (M4-D1). Every action is an event of its pass, so a pass
// can be undone (M4-D6), and what would retire the user's word is asked instead (M4-6). It never writes a claim's words
// (M4-D3): a lesson it proposes is a question, a claim only in the words the user accepts, and what it keeps
// everywhere a claim's own words. With no model
// (memory.curator.usesModel off, or none memory can call) only the steps that need none run. Its calls go through
// Filament's own front door as purpose `curate`, within a budget per pass, on memory's model for the project (the memory
// plan's m1).
import { readFileSync, statSync } from "node:fs";
import { createHash, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { clip } from "../../core/text.js";
import { textOfMessage } from "../../core/messages.js";
import { redactSecrets, redactUnterminatedSecretTail } from "../../core/redact.js";
import { NO_PROJECT_ID } from "../../core/project-id.js";
import { slotOf, slotNorm, holdsValue, USER_SLOT, aboutUser } from "./slots.js";
import { AGENTS_SAID, apartTurn, isRetired, viewed } from "./archive.js";
import { valuesOf, rivals } from "./values.js";
import { namedSymbols } from "./anchors.js";
import { speaksForUser } from "./port.js";
import { CONFIDENCE_GATE, DOSSIER_SECTIONS, LISTED_KINDS, SECTION_LINES, confidenceOf, dateOf, identifyingWords, itemRef, pageSource, trustOf, userBacked, wordsOfMessage } from "./brain.js";
import { parseJson } from "./learn.js";
import { PROCEDURE_CHARS, procedureHead } from "./procedures.js";

/** The kinds a pass curates: claims, never quotes. */
const CURATED = new Set(["fact", "convention", "decision", "preference", "rule", "procedure", "thread"]);
/** The kinds keyed (M4-3): a value a later one can replace. */
const KEYED = new Set(["fact", "convention", "decision", "preference"]);
/** Kinds that tell how to work: two of them may say one thing in different kinds (M4-2). */
const STANDING = new Set(["rule", "preference", "convention"]);
/** The most model calls each step makes in a pass, within the pass's budget. */
const STEP_CALLS = Object.freeze({ key: 2, merge: 4, reverify: 4, suspicions: 2, ground: 2, dossier: 1, adopt: 2, everywhere: 2, page: 1 });
const KEY_BATCH = 20;
/** The most slots in use the keyer is shown, the user's word first (M7-D71). */
const SLOTS_SHOWN = 40;
const PAIR_BATCH = 24;
// Pairs by meaning (the memory plan's f6): each claim the merge has not looked up yet, the oldest first, at most
// NEAR_QUERIES a pass, is looked up in the engine by its words (NEAR_CHARS); of the NEAR_SCAN rows nearest it, every
// project's, its NEAR_TOP_K nearest claims of the project from a cosine of NEAR_MIN_SIM up are pairs for the model.
// Measured on the engine's multilingual model (paraphrase-multilingual-MiniLM-L12-v2): a claim said again in other words
// 0.59 to 0.95, in another language 0.76 to 0.98, two claims on one topic that say different things 0.30 to 0.59 — and
// two values of one thing 0.62 to 0.93 ("Node 22" and "Node 20"), which the model's "never the same" keeps apart (and
// `mayMerge`, for the values it knows), never the cosine. On the owner's largest project
// (2,308 standing claims, one topic) the three nearest of each gave 3,973 pairs from 0.55, 1,333 from 0.7, 519 from
// 0.75 and 30 from 0.85, the ones under 0.75 mostly two things on one topic: 0.75 keeps translations and close
// rewordings, and a one-off of some 500 pairs to judge.
const NEAR_MIN_SIM = 0.75;
const NEAR_TOP_K = 3;
const NEAR_SCAN = 16;
const NEAR_QUERIES = 100;
/** The lookups a pass makes on an engine without its vector index, each a scan of every vector it holds. */
const NEAR_QUERIES_SLOW = 20;
/** Lookups by meaning that may fail in a row before a pass stops looking: the engine is down, not one claim's text. */
const NEAR_FAILS = 3;
const NEAR_CHARS = 500;
/** The most suspicions one call weighs (M7-D68). */
const SUSPECT_BATCH = 12;
// Patterns across sessions (the memory plan's f4): the corrections of a project's last ADOPT_DAYS, each cut to
// ADOPT_CHARS; a correction and those of other sessions that share at least ADOPT_SHARED of its identifying words and
// half the fewer's are one pattern, given in ADOPT_SESSIONS sessions or more; at most ADOPT_SHOWN of them shown to the
// model.
const ADOPT_DAYS = 90;
const ADOPT_SESSIONS = 2;
const ADOPT_SHARED = 2;
const ADOPT_CHARS = 300;
const ADOPT_SHOWN = 8;
/** The most of the user's rules, and of the lessons they turned down, a pattern is weighed against. */
const ADOPT_NEAR = 3;
/** The newest corrections a pass reads: every two are compared. */
const ADOPT_MOST = 500;
/** The corrections the model found no lesson in, kept so a pattern is put again only once a session more gives it. */
const ADOPT_NONE_KEPT = 1000;
// About the user, everywhere (the memory plan's f5): a thing about the user that the claims of EVERYWHERE_PROJECTS
// projects hold is put to the model, at most EVERYWHERE_SHOWN of its claims.
const EVERYWHERE_PROJECTS = 2;
const EVERYWHERE_SHOWN = 6;
/** The claims judged and kept by no question, so a thing is put again only once a project not judged holds it. */
const EVERYWHERE_NONE_KEPT = 1000;
/** The most claims one grounding call weighs, each under the turn it came from (the memory plan's f2). */
const GROUND_BATCH = 6;
/** A source turn as grounding shows it, each part in its room and around the notes' words: the person's words. */
const GROUND_USER_CHARS = 600;
/** The calls that name a turn's notes shown, the most named first, each its input and what it returned. */
const GROUND_RESULTS = 3;
const GROUND_INPUT_CHARS = 160;
const GROUND_RESULT_CHARS = 300;
/** The answer: this much for one note, more for each other note of the turn, up to the most. */
const GROUND_ANSWER_CHARS = 700;
const GROUND_ANSWER_MORE = 150;
const GROUND_ANSWER_MOST = 1200;
/**
 * Memory's own tools, a note the agent kept or read through them being no proof of itself: Filament's (`filament_memory_*`,
 * `filament_recall`, bare or under an MCP server's name) and `/mcp/memory`'s, as an outside agent names them under the
 * server it gave memory (`mcp__filament-memory__search`).
 */
const MEMORY_TOOL = /(?:^|__)filament_(?:memory_\w+|recall)$|^mcp__.*(?:filament|memory).*__(?:brief|search|claim|history|pitfalls|questions|sessions|load|remember|correct|close|confirm|forget)$/i;
/**
 * What Filament set on a call's result (loop.js): memory's reminder (`[memory i12 · …] …`) and Filament's notices
 * (`[Filament: …]`) - what they said, not what the call returned.
 */
const REMINDER_LINE = /^\[(?:memory i\d+\b|Filament:).*$/gm;
/**
 * What grounding blanks beyond `redactSecrets`, as it sends what calls returned, which nothing else gives memory's model:
 * a secret set in an environment or config line (a value of six characters or more with a letter in it, so a number
 * such as `max_tokens: 4096` stays), a password in an address, a private key, live and test keys.
 */
const MORE_SECRETS = /** @type {[RegExp, string][]} */ ([
  [/((?:^[ \t]*|(?<=[\s,;(]))(?:export\s+)?["']?[A-Za-z0-9_.-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|access[_-]?key|credential|database[_-]?url|dsn)[A-Za-z0-9_.-]*["']?\s*[=:]\s*)["']?(?=[^\s"']*[A-Za-z])[^\s"']{6,}["']?/gim, "$1[redacted]"],
  [/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1[redacted]@"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g, "[a private key, redacted]"],
  [/\b((?:sk|rk|pk)_(?:live|test)_)[A-Za-z0-9]{8,}/g, "$1…"],
  [/\b(AKIA)[0-9A-Z]{16}\b/g, "$1…"],
]);
/** A part of a turn with its secrets blanked, before it is cut: a cut through a secret would leave it unmatched. @param {string} s */
const blanked = (s) => MORE_SECRETS.reduce((t, [re, to]) => t.replace(re, to), redactSecrets(String(s ?? "")));
/** The most of a file's text one re-check shows the model (M4-4). */
const EXCERPT_CHARS = 6000;
/** How long a file must have been gone before its claim is retired (M4-D9): a branch switched away for an hour is not a deletion. */
const GONE_FOR = 86_400_000;
/** Who files a finding: a sub-agent's report or its own memory tools, and an agent outside Filament (M7-D47). */
const FINDING_ORIGINS = new Set(["subagent", "agent"]);
/**
 * A finding lapses once this many showings in a turn's related memory were judged, in at least this many sessions, none
 * used (the memory plan's d5): one session's turns on one task are one look. Only what a report files lapses, a fact or
 * a convention: a procedure comes only when a task names its goal, and a rule, a preference or a decision an agent
 * filed itself is seldom said back in a reply.
 */
const LAPSE_SHOWINGS = 3;
const LAPSE_SESSIONS = 2;
const LAPSE_KINDS = new Set(["fact", "convention"]);
/** The claims the dossier is written from, at most (M4-7). */
const DOSSIER_CLAIMS = 80;
// Topic pages (the memory plan's f7): a topic is one of PAGE_MIN_CLAIMS claims or more, and its page is written from its
// PAGE_CLAIMS surest and most important, at most PAGE_LINES lines that cite PAGE_MIN_CLAIMS claims or more.
const PAGE_MIN_CLAIMS = 3;
const PAGE_CLAIMS = 30;
const PAGE_LINES = 10;
/** A page's sections: the dossier's, but its sessions' work, which is the project's, not a topic's. */
export const PAGE_SECTIONS = Object.freeze(DOSSIER_SECTIONS.filter((t) => t !== "Current work and open threads"));
/** The topics whose page came to nothing, by the basis it was asked from, kept so a topic is asked again only once it moves. */
const PAGE_NONE_KEPT = 500;
/** A topic with a page is written again once this share of the claims it was written from moved: a rank shuffled at its 30th place, or a claim more, is not a new page. */
const PAGE_REWRITE = 1 / 3;
/** How far back re-verify counts a claim's showings to take the most shown first (the memory plan's f1). */
const SHOWN_WINDOW = 30 * 86_400_000;
/** A claim checked this recently waits behind those not checked since: a file that changes every pass never takes every call (f1). */
const RECHECK_AFTER = 7 * 86_400_000;
export const CURATOR_DEFAULTS = Object.freeze({ enabled: true, maxCalls: 20, everyHours: 6 });

/**
 * Who runs a pass, kept on its row while it runs (HarnessV3-Readiness RD1 e): this host, this process, and an id of
 * this process's own — a pid is given out again once its process is gone.
 */
export const PASS_OWNER = Object.freeze({ host: hostname(), pid: process.pid, instance: randomBytes(8).toString("hex") });
/** What the end of a pass says when the Filament that ran it was killed mid-pass. */
const OWNER_GONE = "Filament stopped";

/** Whether a process has this pid: only "no such process" says none (another user's process answers EPERM). @param {number} pid */
const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ e) {
    return e?.code !== "ESRCH";
  }
};

/**
 * Whether the Filament that ran a pass is gone: on this host, either its pid is this process's under another id (an
 * earlier process had the pid), or no process has its pid. Another host's pass and a live pid (a reused one too) are
 * left open: the safe side.
 * @param {{ host: string, pid: number, instance: string }} owner  the row's `detail.owner` @param {{ host: string, pid: number, instance: string }} [me] @param {(pid: number) => boolean} [alive]
 */
export function ownerGone(owner, me = PASS_OWNER, alive = pidAlive) {
  if (owner.host !== me.host) return false;
  if (owner.pid === me.pid) return owner.instance !== me.instance;
  return !alive(Number(owner.pid));
}

/** A pass's end in words, as its operation says it. @param {{ projectId: string | null, actions: number, questions: number, calls: number, cut?: string | null, stopped?: string | null }} o */
const passEndWords = ({ projectId, actions, questions, calls, cut = null, stopped = null }) =>
  `curated ${projectId ? `project ${projectId}` : "the global claims"}${cut ? ` (cut short: ${cut})` : ""}: ${actions} action${actions === 1 ? "" : "s"}, ${questions} question${questions === 1 ? "" : "s"}, ${calls} model call${calls === 1 ? "" : "s"}${stopped ? " (out of budget)" : ""}`;

export const KEY_PROMPT = `You key notes about a software project. For each numbered note that states the current value of one thing — so that a later note giving another value would replace it — name that thing and its value. Return ONLY JSON: {"slots":[{"n":1,"subject":"...","attribute":"...","value":"...","multi":false}]}.
subject: "project" for the project itself, "user" for the user, else the component's name. attribute: a short noun phrase ("package manager", "deploy region", "api port"). value: the value alone, copied exactly as the note writes it ("bun", "eu-west-2", "3000"). multi: true only when the thing holds several values at once.
Leave out every note that does not state one value of one thing (a rule, a reason, a list of steps). Never give a value the note does not write.
Slots in use, when given, come before the notes: when a note speaks of one of those things, use its subject and attribute exactly, whatever the note calls it (the api, the server, the http server, when they are one thing). Notes that speak of the same thing take the same subject and attribute. Give a note one slot at most: a note that states several values, or sums up several things, is left out.`;

export const MERGE_PROMPT = `You decide whether two notes about a software project say the same thing. Return ONLY JSON: {"pairs":[{"n":1,"same":true}]}, one entry per numbered pair.
same: true only when both state the same fact, rule, preference or decision, so that keeping either one loses nothing that matters. A note that adds a condition, a value, a reason, a scope or an exception the other lacks is not the same. Two different values (pnpm and bun, port 3000 and 8080) are never the same. When unsure, false.`;

export const VERIFY_PROMPT = `You check whether a note about a software project still holds, against the project's file as it is now. Return ONLY JSON: {"verdict":"holds","why":"one short sentence"}, where verdict is "holds", "wrong" or "unsure".
holds: the excerpt shows the note is still true. wrong: the excerpt shows it is no longer true (say what the file shows instead). unsure: the excerpt does not settle it. Judge only from the excerpt: a note about something the excerpt does not show is unsure.`;

export const SUSPECT_PROMPT = `A session of an AI coding assistant had been shown a note about the user's project, and something in it may say the note is wrong: a correction the user gave ("Correction"), or what the session showed, as the reader of its transcript put it ("Found"). For each numbered pair, decide whether it says the note is wrong. Return ONLY JSON: {"pairs":[{"n":1,"verdict":"unrelated","why":"one short sentence"}]}, one entry per numbered pair.
wrong: it says the note is no longer true, or never was. unrelated: it is about something else; shared words alone are not enough. unsure: it does not settle it.`;

export const ADOPT_PROMPT = `You read corrections the user gave the assistant in different sessions of one software project, one a line: what the user said pushing back on the assistant's reply, a memory the user corrected (its new words, and what it said before), or a memory a session showed wrong and why.

Do they share one lesson the assistant should follow from now on in this project? If they do, write it as one rule of at most 30 words, in plain imperative words the lines support, naming no session; and say in one sentence what the lines have in common. If they do not share one lesson, or it was a one-off, rule is null.

The user's own rules that bear on them may follow (R1, R2, …), and lessons the user turned down before (D1, D2, …). If your rule says what one of those says, give its id as same. If the corrections show one of the user's rules is wrong or out of date, give its id as replaces, and write rule as that rule should read now.

Answer with JSON only: {"rule": "..." | null, "why": "...", "same": "R1" | "D1" | null, "replaces": "R1" | null}`;

export const EVERYWHERE_PROMPT = `You read notes an assistant learned about its user, each in one of the user's software projects, all on the same thing about them. Which one note is true of the user in every project: about the user, not about one project's work? Pick the one that says it best, by its number, and list the other notes that say the same of the user, which it would replace; leave out a note that says more, or is about one project's work. If none holds beyond its project, or the notes contradict each other, keep is null.

Answer with JSON only: {"keep": 1 | null, "same": [2], "why": "one short sentence"}`;

export const GROUND_PROMPT = `You check notes about a software project against the session turn each was learned from. Each turn is shown in parts, each cut around the notes' words where it is long: what the user said, the calls that name the notes with what they returned, and the assistant's answer; the notes learned from it follow. For each numbered note, decide whether its turn bears it out. Return ONLY JSON: {"notes":[{"n":1,"verdict":"holds","why":"one short sentence"}]}, one entry per numbered note, where verdict is "holds", "wrong" or "unsure".
holds: the turn shows the note is so — the user said it, or what a call returned or the answer bears it out. wrong: the turn shows it is not so — the user said otherwise, or what a call returned shows otherwise. unsure: what is shown does not bear on it, or does not settle it. Judge only from what is shown.`;

export const DOSSIER_PROMPT = `You write a software project's dossier: the short briefing a coding assistant reads at the start of every session in the project. Use ONLY the numbered claims (i<n>) and session states (s:<id>) given. Return ONLY JSON: {"sections":[{"title":"...","lines":[{"text":"...","cites":["i12","s:abc"]}]}]}.
Sections, in this order, each only when it has something: "What it is" (what the project is and does), "Conventions and rules", "How to" (the project's procedures, one line each, as the claim names it: "How to <goal> (n steps)"), "Pitfalls" (the claims marked pitfall: what fails here, and the way that works), "Key decisions" (with their reason when one is given), "Facts", "Current work and open threads" (the open threads ([thread]), each cited by its id, and what the sessions' summaries say is under way).
Each line: one sentence of at most 30 words that cites the claims or sessions it rests on and says nothing they do not say. Fold what overlaps into one line; leave out what is trivial or one-off. At most ${SECTION_LINES} lines a section. Prefer claims more sessions said (✓n) and the user's own word.`;

export const PAGE_PROMPT = `You write one topic page of a software project's memory: what a coding assistant should know of one topic of the project, read when its work comes to that topic. Use ONLY the numbered claims (i<n>) given. Return ONLY JSON: {"sections":[{"title":"...","lines":[{"text":"...","cites":["i12","i14"]}]}]}.
Sections, in this order, each only when it has something: "What it is", "Conventions and rules", "How to" (a procedure, one line, as the claim names it: "How to <goal> (n steps)"), "Pitfalls" (the claims marked pitfall: what fails, and the way that works), "Key decisions" (with their reason when one is given), "Facts".
Each line: one sentence of at most 30 words that cites the claims it rests on and says nothing they do not say; names, values, paths and commands copied exactly as the claims write them. Fold claims that overlap or bear on one thing into one line, so the page is shorter than its claims; leave out what is trivial. At most ${PAGE_LINES} lines in all.`;

/** How much of a claim the merge shows the model: a procedure whole (M5-6), as a step it lacks makes it another way. @param {any} c */
const room = (c) => (c.kind === "procedure" ? PROCEDURE_CHARS : 300);

/** A pass out of model calls: it stops calling and says so. */
class OutOfBudget extends Error {}

const sha1 = (/** @type {string} */ s) => createHash("sha1").update(s).digest("hex");
/** A word for comparing a line with its sources: lower-case, a plural or tense ending set aside. @param {string} w */
const stem = (w) => (w.length > 4 ? w.replace(/(?:ies|es|s|ed|ing)$/, "") : w);
/** The share of the smaller word set the other holds. @param {Set<string>} a @param {Set<string>} b */
const overlap = (a, b) => {
  if (a.size < 2 || b.size < 2) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n++;
  return n / Math.min(a.size, b.size);
};
/** A file's size and time, to tell whether it moved since a check. @param {string} path */
const fileState = (path) => {
  try {
    const st = statSync(path);
    return `${st.size}:${Math.round(st.mtimeMs)}`;
  } catch {
    return "gone";
  }
};

/**
 * Whether a dossier line says only what its sources say (M4-7): most of its identifying words are theirs. A line that
 * brings in words none of its cites holds is the model's, not memory's, and is dropped; a line that cites nothing is
 * grounded in nothing.
 * @param {string} text @param {string[]} sources
 */
export function grounded(text, sources) {
  const want = identifyingWords(text).map(stem);
  if (!want.length) return false;
  const have = new Set(sources.flatMap((s) => identifyingWords(s).map(stem)));
  return want.filter((w) => have.has(w)).length >= Math.ceil(want.length * 0.6);
}

/**
 * The dossier the model wrote, kept to what memory can stand behind (M4-7): the known sections in their order, each
 * line citing at least one of the claims or sessions it was given and grounded in them, at most six a section. A topic
 * page's (f7) is kept the same way, to its own sections (`titles`).
 * @param {any} raw  the model's `sections` @param {Map<string, string>} sources  cite (`i12`, `s:<id>`) → its text
 * @param {readonly string[]} [titles]
 * @returns {{ sections: { title: string, lines: { text: string, cites: string[] }[] }[], cites: number[], dropped: number }}
 */
export function groundDossier(raw, sources, titles = DOSSIER_SECTIONS) {
  const list = Array.isArray(raw) ? raw : [];
  const key = (/** @type {any} */ t) => String(t ?? "").toLowerCase().replace(/[^a-z]+/g, " ").trim();
  const sections = [];
  const cites = new Set();
  let dropped = 0;
  for (const sec of list) if (!titles.some((t) => key(t) === key(sec?.title))) dropped += Array.isArray(sec?.lines) ? sec.lines.length : 0;
  for (const title of titles) {
    const lines = [];
    for (const sec of list.filter((x) => key(x?.title) === key(title)))
      for (const l of Array.isArray(sec?.lines) ? sec.lines : []) {
        const text = clip(String(l?.text ?? "").replace(/\s+/g, " ").trim(), 260);
        const refs = [...new Set((Array.isArray(l?.cites) ? l.cites : []).map((c) => String(c).trim()).filter((c) => sources.has(c)))];
        if (!text || lines.length >= SECTION_LINES || !grounded(text, refs.map((r) => /** @type {string} */ (sources.get(r))))) {
          dropped++;
          continue;
        }
        lines.push({ text, cites: refs });
        for (const r of refs) if (/^i\d+$/.test(r)) cites.add(Number(r.slice(1)));
      }
    if (lines.length) sections.push({ title, lines });
  }
  return { sections, cites: [...cites], dropped };
}

/**
 * A grounded page kept to its caps (the memory plan's f7): at most PAGE_LINES lines; no longer than the claims it cites,
 * as a page that says more than its claims abstracted nothing; and citing PAGE_MIN_CLAIMS claims or more. Lines past a
 * cap are dropped from its end, and counted. Null where too few claims are left.
 * @param {{ title: string, lines: { text: string, cites: string[] }[] }[]} sections  `groundDossier`'s
 * @param {Map<number, string>} claims  id → the words of each claim it was given
 * @returns {{ sections: { title: string, lines: { text: string, cites: string[] }[] }[], cites: number[], dropped: number } | null}
 */
export function capPage(sections, claims) {
  const lines = sections.flatMap((s) => s.lines.map((l) => ({ title: s.title, ...l })));
  const total = lines.length;
  const citesOf = (/** @type {typeof lines} */ ls) => [...new Set(ls.flatMap((l) => l.cites).filter((c) => /^i\d+$/.test(c)).map((c) => Number(c.slice(1))))];
  const chars = (/** @type {typeof lines} */ ls) => ls.reduce((n, l) => n + l.text.length, 0);
  const theirs = (/** @type {number[]} */ ids) => ids.reduce((n, id) => n + (claims.get(id)?.length || 0), 0);
  lines.splice(PAGE_LINES);
  while (lines.length && chars(lines) > theirs(citesOf(lines))) lines.pop();
  const cites = citesOf(lines);
  if (cites.length < PAGE_MIN_CLAIMS) return null;
  /** @type {{ title: string, lines: { text: string, cites: string[] }[] }[]} */
  const out = [];
  for (const { title, ...l } of lines) {
    if (out.at(-1)?.title !== title) out.push({ title, lines: [] });
    /** @type {any} */ (out.at(-1)).lines.push(l);
  }
  return { sections: out, cites, dropped: total - lines.length };
}

/** A topic's name as a page is asked for by (`page:<slug>`): its words in lower case, joined by hyphens. @param {string} title */
export const slugOf = (title) =>
  String(title)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "") || "topic";

/**
 * A file's text around what a claim names (M4-4): windows at the first places its symbols and words appear, merged, at
 * most `room` characters; the file's head when it names nothing the file holds.
 * @param {string} path @param {string} claimText @param {number} room
 */
export function excerptOf(path, claimText, room) {
  let body = "";
  try {
    body = readFileSync(path, "utf8").slice(0, 1024 * 1024);
  } catch {
    return "(the file could not be read)";
  }
  return excerptIn(body, claimText, room);
}
/** What a claim names, to find it by in a text: its symbols as written, its identifying words of four letters or more. @param {string} claimText */
const termsOf = (claimText) => [...namedSymbols(claimText), ...identifyingWords(claimText).filter((w) => w.length >= 4)];
/** Where a text holds a term: a symbol as written, a word in any case; -1 where it does not. @param {string} body @param {string} lower @param {string} t */
const termAt = (body, lower, t) => (/[A-Z_$]/.test(t) ? body.indexOf(t) : lower.indexOf(t.toLowerCase()));
/**
 * The parts of a text around what a claim names, within `room` (excerptOf's, for any text): its first places that hold
 * the claim's terms (`terms`, the claim's by default), at most `most`, else its start.
 * @param {string} body @param {string} claimText @param {number} room @param {number} [most] @param {string[]} [terms]
 */
function excerptIn(body, claimText, room, most = 3, terms = termsOf(claimText)) {
  if (body.length <= room) return body;
  const lower = body.toLowerCase();
  const at = [];
  for (const t of terms) {
    const i = termAt(body, lower, t);
    if (i >= 0) at.push(i);
    if (at.length >= most) break;
  }
  if (!at.length) return `${body.slice(0, room)}\n…`;
  const half = Math.floor(room / (2 * at.length));
  /** @type {[number, number][]} */
  const spans = [];
  for (const i of at.sort((a, b) => a - b)) {
    const s = Math.max(0, i - half),
      e = Math.min(body.length, i + half);
    const last = spans.at(-1);
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else spans.push([s, e]);
  }
  return spans.map(([s, e]) => `${s > 0 ? "…\n" : ""}${body.slice(s, e)}${e < body.length ? "\n…" : ""}`).join("\n");
}

/**
 * Two standing claims the merge may put to the model (M4-2): one kind, or two kinds that both tell how to work; never
 * two holding rival values of one class (M3-2) or of one slot. `values`: how a claim's values are read — a pass that
 * asks of many pairs reads each claim's once.
 * @param {any} a @param {any} b @param {(claim: any) => Map<string, { value: string, project: boolean }>} [values]
 */
export function mayMerge(a, b, values = valuesOf) {
  if (a.kind !== b.kind && !(STANDING.has(a.kind) && STANDING.has(b.kind))) return false;
  const va = values(a),
    vb = values(b);
  for (const [cls, x] of va) {
    const y = vb.get(cls);
    if (y && rivals(cls, x.value, y.value)) return false;
  }
  if (a.slot && a.slot === b.slot && !a.slot_multi && b.slot_value && !holdsValue(a, b.slot_value)) return false;
  return true;
}

/**
 * The pairs of standing claims the merge finds by rule (M4-2): two that may merge (`mayMerge`) whose identifying words
 * the smaller holds half of in the other (`overlap`), or one slot holding the other's value — each `{ a, b, ov }`, `a`
 * the earlier of the two in `claims`, in the order a walk over every pair (i, j) meets them, which the merge's sort by
 * `ov` keeps among equals. Only two that share a word or a slot can pass — two that share none overlap 0 — so each
 * claim's are found in an index of the words and slots of those after it, the words it shares with each counted on
 * the way (the owner's of 11-17: a long memory's pairs are its claims squared, each asked whole).
 * @param {any[]} claims @param {Set<string>[]} words  each claim's identifying words, stemmed, by its place
 * @param {(claim: any) => Map<string, { value: string, project: boolean }>} [values]  as `mayMerge`'s
 * @returns {{ a: any, b: any, ov: number }[]}
 */
export function rulePairs(claims, words, values = valuesOf) {
  const n = claims.length;
  /** Each word, and the claims of two words or more that hold it, in order (`overlap` reads no smaller set). @type {Map<string, number[]>} */
  const holders = new Map();
  /** Each slot, and the claims in it, in order. @type {Map<string, number[]>} */
  const slots = new Map();
  for (let i = 0; i < n; i++) {
    if (words[i].size >= 2)
      for (const w of words[i]) {
        const l = holders.get(w);
        if (l) l.push(i);
        else holders.set(w, [i]);
      }
    const s = claims[i].slot;
    if (s) {
      const l = slots.get(s);
      if (l) l.push(i);
      else slots.set(s, [i]);
    }
  }
  /** The words a claim after the one walked shares with it, and the walk that last met it (its place + 1). */
  const shared = new Int32Array(n);
  const met = new Int32Array(n);
  /** @type {{ a: any, b: any, ov: number }[]} */
  const pairs = [];
  for (let i = 0; i < n; i++) {
    const a = claims[i];
    /** @type {number[]} */
    const near = [];
    const meet = (/** @type {number} */ j) => {
      if (met[j] === i + 1) return;
      met[j] = i + 1;
      shared[j] = 0;
      near.push(j);
    };
    if (words[i].size >= 2)
      for (const w of words[i])
        for (const j of /** @type {number[]} */ (holders.get(w))) {
          if (j <= i) continue;
          meet(j);
          shared[j]++;
        }
    if (a.slot) for (const j of /** @type {number[]} */ (slots.get(a.slot))) if (j > i) meet(j);
    near.sort((x, y) => x - y);
    for (const j of near) {
      const b = claims[j];
      const slotted = !!a.slot && a.slot === b.slot && !!b.slot_value && holdsValue(a, b.slot_value);
      const ov = slotted ? 1 : words[i].size < 2 || words[j].size < 2 ? 0 : shared[j] / Math.min(words[i].size, words[j].size);
      if (ov >= 0.5 && mayMerge(a, b, values)) pairs.push({ a, b, ov });
    }
  }
  return pairs;
}

/**
 * Which of two claims that say the same thing stays (M4-D1): the user's own word (said, corrected or quoted), then a confirmed
 * one, then the one more sessions said, then the oldest.
 * @param {any} a @param {any} b @param {Map<number, { evidence: number }>} counts @returns {number} negative when a stays
 */
export function survivorOrder(a, b, counts) {
  const own = (/** @type {any} */ x) => (speaksForUser(x.origin) || x.origin === "correction" || x.origin === "capture" ? 1 : 0);
  const conf = (/** @type {any} */ x) => (x.status === "confirmed" ? 1 : 0);
  const ev = (/** @type {any} */ x) => counts.get(x.id)?.evidence || 0;
  return own(b) - own(a) || conf(b) - conf(a) || ev(b) - ev(a) || a.created_at - b.created_at || a.id - b.id;
}

export class MemoryCurator {
  /** @type {Promise<any>} */
  #tail = Promise.resolve();
  /** The scopes whose pass is waiting or going ("" the global claims), so a burst of pokes makes one pass. @type {Set<string>} */
  #queued = new Set();
  #stopped = false;
  /** The pass going, which `stop()` cuts (M7-D70). @type {any} */
  #current = null;
  /** The claims whose lookup by meaning failed in this process (the memory plan's f6): looked up last. @type {Set<number>} */
  #nearFailed = new Set();
  /**
   * @param {{ archive: any, brain: any, callModel: (a: any) => Promise<any>, model?: (projectId: string | null) => string, getConfig?: () => any, log?: (level: string, msg: string) => void, now?: () => number }} o
   *   `model`: the route the curator calls for a project (null: the global claims), "" for none; `getConfig`: the memory
   *   section of the config
   */
  constructor({ archive, brain, callModel, model = () => "", getConfig = () => ({}), log = () => {}, now = () => Date.now() }) {
    this.archive = archive;
    this.brain = brain;
    this.callModel = callModel;
    this.model = model;
    this.getConfig = getConfig;
    this.log = log;
    this.now = now;
    /** @type {((title: string, opts: any) => void) | null} */
    this.onOp = null;
    /** The last passes, for the dashboard. @type {any[]} */
    this.recent = [];
  }
  cfg() {
    const c = this.getConfig()?.curator || {};
    const n = (/** @type {any} */ v, /** @type {number} */ d) => (Number.isFinite(Number(v)) && Number(v) >= 0 && v !== null && v !== "" ? Number(v) : d);
    return {
      enabled: c.enabled !== false,
      maxCalls: n(c.maxCalls, CURATOR_DEFAULTS.maxCalls),
      everyMs: n(c.everyHours, CURATOR_DEFAULTS.everyHours) * 3_600_000,
    };
  }
  #op(/** @type {string} */ title, /** @type {any} */ opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break a pass */
    }
  }

  // ---- when it runs ----
  /**
   * The curator may run (the memory plan's m1): a pass runs in the background when memory pokes it — a learning run
   * landed, a chat of the project started a turn — and the scope is due (`due`). No clock: a machine asleep at an hour
   * misses nothing, and a pass never waits on a turn.
   */
  start() {
    this.#stopped = false;
  }
  /**
   * Memory closes. A pass going is cut (M7-D70): its run ends now, while the archive is still open, with the calls it
   * made, and its model call is stopped. Nothing of it writes or logs after the cut, and the passes waiting skip.
   */
  stop() {
    this.#stopped = true;
    this.#queued.clear();
    const ctx = this.#current;
    if (!ctx || ctx.cut) return;
    ctx.life.abort();
    ctx.cut = this.#finish(ctx, null, "memory closed");
  }
  /**
   * Memory opens: a pass an earlier Filament left open — it was killed mid-pass — is ended now, as "Filament stopped",
   * with the calls it counted and the actions it took, and said as an operation (HarnessV3-Readiness RD1 e). A pass
   * whose Filament may still be running is left as it is (`ownerGone`).
   */
  endLeftOpen() {
    for (const row of this.archive.curator.open()) {
      if (!ownerGone(row.detail.owner)) continue;
      const actions = this.archive.curator.events(row.id).length;
      const questions = this.archive.inbox.byRun(row.id).length;
      this.archive.curator.end(row.id, { calls: row.calls, actions, detail: { cut: OWNER_GONE } });
      this.#op(passEndWords({ projectId: row.project_id, actions, questions, calls: row.calls, cut: OWNER_GONE }), {
        sub: "done",
        level: "info",
        detail: { run: row.id, project: row.project_id, reason: row.reason, calls: row.calls, actions, questions, cut: OWNER_GONE },
      });
    }
  }
  /** The projects whose pass is waiting or going ("none" never; the global claims are null). */
  queued() {
    return [...this.#queued].map((k) => k || null);
  }
  /**
   * Whether a scope's pass is due (the memory plan's m1): its standing claims changed since its last pass began, and
   * that was `memory.curator.everyHours` (6) or more ago — before its first pass, its first claim was — so at most
   * four a day, none for a project where nothing was learned, and a new project's claims gather a while first.
   * @param {string | null} projectId
   */
  due(projectId) {
    const last = this.archive.curator.lastStart(projectId);
    const since = last || this.archive.items.firstStandingAt(projectId);
    if (!since || this.now() - since < this.cfg().everyMs) return false;
    // A pass that owes its dossier — a step's last call moved what it is written from (the memory plan's f1) — is due
    // again however little was learned since.
    return this.archive.items.changedSince(projectId, last) || !!this.archive.curator.list({ projectId, limit: 1 })[0]?.detail?.dossierOwed;
  }
  /**
   * Memory pokes the curator: a learning run landed in a project, or a chat of it started a turn. The project's pass
   * and the global claims' run in the background where each is due, one after another, never waited on; a scope
   * already waiting or going is not queued twice. → the scopes queued now ([] for none).
   * @param {string | null} projectId @param {string} [reason]
   */
  poke(projectId, reason = "learned") {
    if (!projectId || projectId === "none" || this.#stopped || !this.cfg().enabled) return [];
    /** @type {(string | null)[]} */
    const out = [];
    for (const scope of [projectId, null]) {
      const key = scope || "";
      if (this.#queued.has(key) || !this.due(scope)) continue;
      this.#queued.add(key);
      out.push(scope);
      this.run(scope, { reason })
        .catch((e) => this.log("warn", `memory curator: the pass over ${scope ? `project ${scope}` : "the global claims"} failed: ${e.message}`))
        .finally(() => this.#queued.delete(key));
    }
    return out;
  }
  /**
   * One pass over a project's memory, or over the global claims (null), after any pass already running.
   * @param {string | null} projectId @param {{ reason?: string }} [o]
   */
  run(projectId, { reason = "manual" } = {}) {
    const p = this.#tail.then(() => this.#pass(projectId, reason));
    this.#tail = p.catch(() => {});
    return p;
  }

  // ---- one pass ----
  /** @param {string | null} projectId @param {string} reason */
  async #pass(projectId, reason) {
    if (this.#stopped) return { skipped: "memory is closed" };
    if (!this.cfg().enabled) return { skipped: "the curator is off (memory.curator.enabled)" };
    const model = this.model(projectId) || null;
    const t0 = this.now();
    const run = this.archive.curator.start({ projectId, reason, model, owner: PASS_OWNER });
    const ctx = {
      run,
      projectId,
      reason,
      model,
      t0,
      root: projectId ? this.archive.getProject(projectId)?.cwd || null : null,
      calls: 0,
      /** @type {Record<string, number>} */ stepCalls: {},
      /** @type {Record<string, any>} */ steps: {},
      /** @type {Record<string, string>} */ errors: {},
      /** @type {string | null} */ stopped: null,
      /** @type {{ in: number, out: number } | null} */ billed: null,
      /** Stops the pass's model call when memory closes. */ life: new AbortController(),
      /** What the pass had done when memory closing cut it (M7-D70). @type {any} */ cut: null,
      /** The dossier is still to come in this pass: the steps before it keep its call (the memory plan's f1). */
      dossierAhead: !!(model && projectId && projectId !== NO_PROJECT_ID),
    };
    this.#op(`curating ${projectId ? `project ${projectId}` : "the global claims"} (${reason})`, { sub: "start", detail: { run, project: projectId, reason, model } });
    this.#current = ctx;
    /** @type {string | null} */
    let error = null;
    try {
      await this.#step(ctx, "expire", () => this.#expire(ctx), false);
      await this.#step(ctx, "gone", () => this.#gone(ctx), false);
      await this.#step(ctx, "lapse", () => this.#lapse(ctx), false);
      if (model) {
        await this.#step(ctx, "key", () => this.#key(ctx));
        await this.#step(ctx, "merge", () => this.#merge(ctx));
        await this.#step(ctx, "reverify", () => this.#reverify(ctx));
        await this.#step(ctx, "suspicions", () => this.#suspicions(ctx));
        await this.#step(ctx, "ground", () => this.#ground(ctx));
      }
      await this.#step(ctx, "restore", () => this.#restore(ctx), false);
      // The sessions that named no folder are no project: they have no dossier to write (M4-7).
      if (ctx.dossierAhead) await this.#step(ctx, "dossier", () => this.#dossier(ctx));
      ctx.dossierAhead = false;
      // A project's corrections are its own; the global claims gather none.
      if (model && projectId && projectId !== NO_PROJECT_ID) await this.#step(ctx, "adopt", () => this.#adopt(ctx));
      // What a project learned about the user is theirs in every project once they say so (the memory plan's f5).
      if (model && projectId && projectId !== NO_PROJECT_ID) await this.#step(ctx, "everywhere", () => this.#everywhere(ctx));
      // One topic of the project gets its page (the memory plan's f7).
      if (model && projectId && projectId !== NO_PROJECT_ID) await this.#step(ctx, "page", () => this.#page(ctx));
    } catch (/** @type {any} */ e) {
      error = String(e?.message || e);
    } finally {
      this.#current = null;
    }
    // Cut by memory closing, the pass was ended then: nothing of it is written after.
    return ctx.cut || this.#finish(ctx, error);
  }
  /**
   * A pass's end: its run written, its row on the dashboard, its operation. `cut`: why memory cut it short.
   * @param {any} ctx @param {string | null} error @param {string | null} [cut]
   */
  #finish(ctx, error, cut = null) {
    const { run, projectId, reason, model, t0 } = ctx;
    const actions = this.archive.curator.events(run).length;
    const questions = this.archive.inbox.byRun(run).length;
    const detail = {
      ...ctx.steps,
      ...(ctx.stopped ? { stopped: ctx.stopped } : {}),
      ...(cut ? { cut } : {}),
      // As they are now: a step cut short still fails after, into the pass's own errors, which nothing reads again.
      ...(Object.keys(ctx.errors).length ? { errors: { ...ctx.errors } } : {}),
      ...(ctx.billed ? { tokensIn: ctx.billed.in, tokensOut: ctx.billed.out } : {}),
    };
    this.archive.curator.end(run, { calls: ctx.calls, actions, error, detail });
    const out = { run: `r${run}`, project: projectId, reason, model, calls: ctx.calls, actions, questions, ...detail, ...(error ? { error } : {}), ms: this.now() - t0 };
    this.recent.unshift({ at: new Date(t0).toISOString(), ...out });
    if (this.recent.length > 50) this.recent.pop();
    this.#op(passEndWords({ projectId, actions, questions, calls: ctx.calls, cut, stopped: ctx.stopped }), {
      sub: error ? "error" : "done",
      level: error ? "error" : "info",
      ms: out.ms,
      detail: { run, project: projectId, reason, calls: ctx.calls, actions, questions, ...countsOnly(detail), ...(cut ? { cut } : {}), ...(error ? { error: clip(error, 160) } : {}) },
    });
    return out;
  }
  /**
   * One step: a failure is its own, the others still run. Out of budget, the steps that call the model stop, and the
   * others (`model` false) run all the same. The dossier runs either way: on the call kept for it where it will write,
   * else to say it stands, which needs none, or that it is owed, where the last call went to a step whose answer moved
   * what it is written from. Cut by memory closing, none runs.
   */
  async #step(/** @type {any} */ ctx, /** @type {string} */ name, /** @type {() => Promise<void>} */ fn, model = true) {
    if (ctx.cut || (model && name !== "dossier" && ctx.stopped && this.#left(ctx, name) <= 0)) return;
    try {
      await fn();
    } catch (/** @type {any} */ e) {
      if (e instanceof OutOfBudget) ctx.stopped = e.message;
      else ctx.errors[name] = clip(String(e?.message || e), 160);
    }
  }
  /**
   * Whether a step may make another call: its own cap, and the pass's budget (`#left`). A step the budget stops says so
   * (`ctx.stopped`) and keeps what it did: its loop ends where it stands, with its counts.
   */
  #room(/** @type {any} */ ctx, /** @type {keyof typeof STEP_CALLS} */ step) {
    if ((ctx.stepCalls[step] || 0) >= STEP_CALLS[step]) return false;
    if (this.#left(ctx, step) > 0) return true;
    ctx.stopped ??= this.#budgetWords(ctx);
    return false;
  }
  /**
   * The calls a step may still make in the pass's budget (the memory plan's f1): what `memory.curator.maxCalls` leaves,
   * less the dossier's call where a step before it would take the last one and the dossier will write (`#keepsCall`) —
   * a step with more to do than the pass has calls for does not starve what every session reads. @param {any} ctx @param {string} step
   */
  #left(ctx, step) {
    const left = this.cfg().maxCalls - ctx.calls;
    return step !== "dossier" && left > 0 && left <= STEP_CALLS.dossier && this.#keepsCall(ctx) ? left - STEP_CALLS.dossier : left;
  }
  /**
   * Whether the steps before the dossier keep its call (f1): the dossier is still to come, and what it is written from
   * moved since its last version. A dossier that would stand keeps none: its call goes to the step that has work, and
   * where that step's answer moves what the dossier is written from, the dossier is owed and the next pass is due
   * (`dossierOwed`, `due`). Read once a pass, where a step would take the last call; a source that cannot be read keeps
   * the call, and the dossier's own step says why. @param {any} ctx
   */
  #keepsCall(ctx) {
    if (!ctx.dossierAhead) return false;
    if (ctx.dossierMoves === undefined) {
      try {
        const src = this.#dossierSource(ctx);
        ctx.dossierMoves = !!src && src.basis !== this.archive.dossiers.latest(ctx.projectId)?.basis;
      } catch {
        ctx.dossierMoves = true;
      }
    }
    return ctx.dossierMoves;
  }
  /** What a pass out of its calls says. @param {any} ctx */
  #budgetWords(ctx) {
    const c = this.cfg();
    return `its budget of ${c.maxCalls} model call${c.maxCalls === 1 ? "" : "s"} a pass (memory.curator.maxCalls)${ctx.calls < c.maxCalls ? ", the dossier's call kept for it" : ""}`;
  }
  /**
   * One model call within the pass's budget. The run counts each call as it is made, and memory closing stops it
   * (M7-D70): an answer that comes after the cut is never read. @returns {Promise<string>}
   */
  async #ask(/** @type {any} */ ctx, /** @type {string} */ step, /** @type {{ system: string, user: string }} */ { system, user }) {
    if (this.#left(ctx, step) <= 0) throw new OutOfBudget(this.#budgetWords(ctx));
    ctx.calls++;
    ctx.stepCalls[step] = (ctx.stepCalls[step] || 0) + 1;
    this.archive.curator.count(ctx.run, ctx.calls);
    const r = await this.callModel({ system, user, model: ctx.model, purpose: "curate", includeUsage: true, signal: ctx.life.signal });
    if (ctx.cut) throw new Error("memory closed under the call");
    if (typeof r === "string") return r;
    if (r?.usage && (r.usage.input != null || r.usage.output != null)) {
      ctx.billed ??= { in: 0, out: 0 };
      ctx.billed.in += r.usage.input || 0;
      ctx.billed.out += r.usage.output || 0;
    }
    return r?.text ?? "";
  }
  /** The scope's standing claims of the curated kinds, as they are now. @param {any} ctx */
  #standing(ctx) {
    return this.archive.items.standing(ctx.projectId).filter((/** @type {any} */ it) => CURATED.has(it.kind));
  }
  /** Whether a claim has a standing event of these actions by the curator. @param {number} id @param {string[]} actions */
  #did(id, actions) {
    return this.archive.items.events(id).some((/** @type {any} */ e) => e.by === "curator" && !e.undone_at && actions.includes(e.action));
  }
  /**
   * Retire a claim for the pass — or, the user's word, ask instead (M4-6). A question is raised once per key, ever.
   * @returns {Promise<"retired" | "asked" | null>}
   */
  async #retire(/** @type {any} */ ctx, /** @type {any} */ it, /** @type {{ reason: string, key: string, replacement?: number | null, errata?: boolean }} */ { reason, key, replacement = null, errata = true }) {
    if (userBacked(it)) {
      const q = this.archive.inbox.add({
        projectId: it.project_id,
        kind: "retire",
        key,
        itemIds: [it.id, ...(replacement ? [replacement] : [])],
        proposal: { action: "retire", id: it.id, ...(replacement ? { replacement } : {}), reason },
        reason,
        run: ctx.run,
      });
      return q.raised ? "asked" : null;
    }
    const r = await this.brain.setItemStatus(it.id, replacement ? "superseded" : "dismissed", { by: "curator", reason, replacement, run: ctx.run, errata });
    return r.ok ? "retired" : null;
  }
  /** @param {Record<string, number>} tally @param {string | null} what */
  #count(tally, what) {
    if (what) tally[what] = (tally[what] || 0) + 1;
  }

  // ---- the steps ----
  /** M4-5: an open thread memory is no longer sure of (its confidence under the gate) has expired. */
  async #expire(/** @type {any} */ ctx) {
    const threads = this.#standing(ctx).filter((/** @type {any} */ it) => it.kind === "thread");
    const counts = this.archive.items.eventCounts(threads.map((/** @type {any} */ t) => t.id));
    /** @type {Record<string, number>} */
    const tally = {};
    for (const t of threads) {
      const rec = counts.get(t.id) || {};
      if (confidenceOf(t, rec, this.now()) >= CONFIDENCE_GATE) continue;
      const last = Math.max(Number(t.created_at) || 0, Number(rec.lastSaid) || 0);
      this.#count(tally, await this.#retire(ctx, t, { reason: `expired: an open thread no session took up since ${dateOf(last)}`, key: `expire:${t.id}`, errata: false }));
    }
    ctx.steps.expired = tally.retired || 0;
    if (tally.asked) ctx.steps.expireAsked = tally.asked;
  }
  /** M4-4: a claim whose file or folder has been gone for a day is retired. */
  async #gone(/** @type {any} */ ctx) {
    if (!ctx.root) return;
    /** @type {Record<string, number>} */
    const tally = {};
    for (const it of this.#standing(ctx)) {
      const f = this.brain.filesOf(it);
      if (f?.worst.state !== "gone") continue;
      const gone = f.anchors.filter((/** @type {any} */ a) => a.now.state === "gone");
      // Gone since when, per file: the first event that saw it gone with none since that saw it back. The earliest counts.
      const events = this.archive.items.events(it.id).filter((/** @type {any} */ e) => e.action === "anchor");
      const sinces = gone.map((/** @type {any} */ a) => {
        let since = null;
        for (const e of events.filter((/** @type {any} */ e) => e.detail?.file === a.name)) since = e.detail?.state === "gone" ? (since ?? e.at) : null;
        return since;
      });
      const since = Math.min(...sinces.map((s) => s ?? Infinity));
      if (!Number.isFinite(since) || this.now() - since < GONE_FOR) {
        this.#count(tally, "recent");
        continue;
      }
      const names = gone.map((/** @type {any} */ a) => a.name).join(", ");
      this.#count(tally, await this.#retire(ctx, it, { reason: `${gone.length === 1 ? "its file" : "its files"} ${names} ${gone.length === 1 ? "is" : "are"} gone (since ${dateOf(since)})`, key: `gone:${it.id}:${names}` }));
    }
    ctx.steps.gone = tally.retired || 0;
    if (tally.asked) ctx.steps.goneAsked = tally.asked;
    if (tally.recent) ctx.steps.goneRecently = tally.recent;
  }
  /**
   * The memory plan's d5: a finding sessions were shown and none used lapses, where no other session said it again and
   * no one confirmed it — its showings in a turn's related memory judged (`LAPSE_SHOWINGS`, in `LAPSE_SESSIONS`
   * sessions) and none used (`injections.judged`). It is retired with no erratum, nor a line in a brief: it was never
   * wrong.
   */
  async #lapse(/** @type {any} */ ctx) {
    const found = this.#standing(ctx).filter((/** @type {any} */ it) => FINDING_ORIGINS.has(it.origin) && LAPSE_KINDS.has(it.kind) && it.status !== "confirmed" && !userBacked(it));
    if (!found.length) return;
    const judged = this.archive.injections.judged(found.map((/** @type {any} */ it) => itemRef(it.id)));
    const ripe = found.filter((/** @type {any} */ it) => {
      const j = judged.get(itemRef(it.id));
      return j && j.used === 0 && j.judged >= LAPSE_SHOWINGS && j.sessions >= LAPSE_SESSIONS;
    });
    const counts = this.archive.items.eventCounts(ripe.map((/** @type {any} */ it) => it.id));
    /** @type {Record<string, number>} */
    const tally = {};
    for (const it of ripe) {
      if ((counts.get(it.id)?.evidence || 0) > 0) continue;
      const j = judged.get(itemRef(it.id)) || { judged: 0, sessions: 0 };
      this.#count(tally, await this.#retire(ctx, it, { reason: `lapsed: ${j.sessions} sessions were shown it ${j.judged} times and none used it, and no other session said it`, key: `lapse:${it.id}`, errata: false }));
    }
    ctx.steps.lapsed = tally.retired || 0;
  }
  /**
   * What the keyer reads (M7-D71): the slots in use in the scope, the user's word first, then the numbered notes. A
   * thing already keyed is then keyed the same, whatever a note calls it, so its values meet in one slot.
   * @param {any} ctx @param {any[]} batch
   */
  #keyText(ctx, batch) {
    /** @type {Map<string, string>} */
    const inUse = new Map();
    const keyed = this.#standing(ctx).filter((/** @type {any} */ it) => it.slot);
    for (const it of [...keyed.filter(userBacked), ...keyed.filter((/** @type {any} */ it) => !userBacked(it))])
      if (!inUse.has(it.slot) && inUse.size < SLOTS_SHOWN)
        inUse.set(it.slot, `- ${it.slot}${it.slot_multi ? " (several values)" : it.slot_value ? ` = ${clip(it.slot_value, 60)}` : ""}${userBacked(it) ? " (the user's word)" : ""}`);
    const notes = batch.map((/** @type {any} */ it, n) => `${n + 1}. ${clip(it.text, 300)}`).join("\n");
    return `${inUse.size ? `Slots in use (subject · attribute = value):\n${[...inUse.values()].join("\n")}\n\n` : ""}Notes:\n${notes}`;
  }
  /**
   * M4-3: unkeyed values get their slot. The model names it; it is kept only when its value is in the claim's own words,
   * and then the slot is settled: in a single-valued slot the user's word holds, else the newer word wins (M2-5, M2-6).
   */
  async #key(/** @type {any} */ ctx) {
    const todo = this.#standing(ctx).filter((/** @type {any} */ it) => KEYED.has(it.kind) && !it.slot && !this.#did(it.id, ["slot", "unkeyed"]));
    let keyed = 0;
    /** @type {Record<string, number>} */
    const tally = {};
    for (let i = 0; i < todo.length && this.#room(ctx, "key"); i += KEY_BATCH) {
      const batch = todo.slice(i, i + KEY_BATCH);
      const got = parseJson(await this.#ask(ctx, "key", { system: KEY_PROMPT, user: this.#keyText(ctx, batch) }));
      if (!got || !Array.isArray(got.slots)) {
        ctx.errors.key = "the model answered no JSON";
        continue;
      }
      /** @type {Map<number, any[]>} */
      const byN = new Map();
      for (const s of got.slots) byN.set(Number(s?.n), [...(byN.get(Number(s?.n)) || []), s]);
      for (const [n, it] of batch.entries()) {
        const named = byN.get(n + 1) || [];
        // A note given more than one slot states several values: left out, never keyed by whichever came last (M7-D71).
        if (named.length > 1) {
          const values = named.map(slotOf).filter(Boolean).map((/** @type {any} */ o) => `${o.slot} = ${clip(o.value, 40)}`);
          this.archive.items.note(it.id, "unkeyed", { by: "curator", run: ctx.run, reason: `it names several values: ${values.join(", ")}` });
          continue;
        }
        const s = slotOf(named[0]);
        if (!s || !holdsValue({ text: it.text }, s.value)) {
          this.archive.items.note(it.id, "unkeyed", { by: "curator", run: ctx.run, ...(s ? { reason: `the value it named (${clip(s.value, 60)}) is not in its words` } : {}) });
          continue;
        }
        if (!this.brain.keyClaim(it.id, s, { by: "curator", run: ctx.run }).ok) continue;
        keyed++;
        await this.#settleSlot(ctx, this.archive.items.get(it.id), s, tally);
      }
    }
    ctx.steps.keyed = keyed;
    if (tally.retired) ctx.steps.slotRetired = tally.retired;
    if (tally.asked) ctx.steps.slotAsked = tally.asked;
  }
  /** A newly keyed claim's slot, settled against the values already in it. */
  async #settleSlot(/** @type {any} */ ctx, /** @type {any} */ it, /** @type {{ slot: string, value: string, multi: boolean }} */ s, /** @type {Record<string, number>} */ tally) {
    if (s.multi) return;
    for (const r of this.archive.items.inSlot(it.project_id, s.slot)) {
      if (r.id === it.id || r.slot_multi || holdsValue(r, s.value)) continue;
      const cur = this.archive.items.get(it.id);
      if (!cur || cur.status === "dismissed" || cur.status === "superseded") return;
      const ua = userBacked(cur),
        ub = userBacked(r);
      const [win, lose] = ua !== ub ? (ua ? [cur, r] : [r, cur]) : this.brain.saidAt(cur) >= this.brain.saidAt(r) ? [cur, r] : [r, cur];
      const users = userBacked(win) && !userBacked(lose);
      const reason = users
        ? `the user's word holds its slot (${s.slot}): ${itemRef(win.id)}, ${trustOf(win)}`
        : `a newer value in its slot (${s.slot}): ${itemRef(win.id)} says ${clip(win.slot_value || win.text, 80)}`;
      this.#count(tally, await this.#retire(ctx, lose, { reason, key: `slot:${lose.id}:${win.id}`, replacement: users ? null : win.id }));
      // A value said after the user's word is held off, and they are asked whether it replaces theirs (M6-D16).
      if (users && this.brain.askLater(win, lose, { value: lose === cur ? s.value : lose.slot_value, run: ctx.run })) this.#count(tally, "asked");
    }
  }
  /**
   * M4-2: claims that say the same thing become one. Candidates are found by rule — the identifying words of one hold
   * half the other's, or one slot holds one value — and by meaning (`#nearPairs`, the memory plan's f6: in other words,
   * or in another language); the model judges each pair, and rules choose the survivor.
   */
  async #merge(/** @type {any} */ ctx) {
    const claims = this.#standing(ctx);
    const words = new Map(claims.map((/** @type {any} */ c) => [c.id, new Set(identifyingWords(c.text).map(stem))]));
    // Each claim's values (values.js `valuesOf`: a dozen patterns over its words) read once for the pass: every pair
    // read them again for both its claims, and a long memory's pairs are its claims squared (the owner's of 11-17: a
    // pass held the server 18.8 s reading them).
    /** @type {Map<any, Map<string, { value: string, project: boolean }>>} */
    const read = new Map();
    const valuesOnce = (/** @type {any} */ c) => {
      let v = read.get(c);
      if (!v) read.set(c, (v = valuesOf(c)));
      return v;
    };
    const key = (/** @type {number} */ x, /** @type {number} */ y) => (x < y ? `${x}:${y}` : `${y}:${x}`);
    // Only the pairs that share a word or a slot are asked (`rulePairs`).
    const pairs = rulePairs(claims, claims.map((/** @type {any} */ c) => /** @type {Set<string>} */ (words.get(c.id))), valuesOnce);
    const near = await this.#nearPairs(ctx, claims, new Set(pairs.map((p) => key(p.a.id, p.b.id))));
    pairs.push(...near.pairs);
    // What is known to be two claims, not one: the "distinct" verdicts of earlier runs not undone, either way round,
    // which are not asked again. No group joins two of them, through any of its pairs (the bug report's P6): a group
    // holds only claims judged the same, each pair of them.
    const distinct = new Set(
      [...new Set(pairs.flatMap((p) => [p.a.id, p.b.id]))].flatMap((id) =>
        this.archive.items
          .events(id)
          .filter((/** @type {any} */ e) => e.action === "distinct" && !e.undone_at && e.detail?.other != null)
          .map((/** @type {any} */ e) => key(id, Number(e.detail.other))),
      ),
    );
    const open = pairs.filter((p) => !distinct.has(key(p.a.id, p.b.id))).sort((x, y) => y.ov - x.ov);
    /** @type {{ a: any, b: any }[]} */
    const same = [];
    let judged = 0;
    for (let i = 0; i < open.length && this.#room(ctx, "merge"); i += PAIR_BATCH) {
      const batch = open.slice(i, i + PAIR_BATCH);
      const user = batch.map((p, n) => `${n + 1}. A: [${p.a.kind}] ${clip(p.a.text, room(p.a))}\n   B: [${p.b.kind}] ${clip(p.b.text, room(p.b))}`).join("\n");
      const got = parseJson(await this.#ask(ctx, "merge", { system: MERGE_PROMPT, user }));
      if (!got || !Array.isArray(got.pairs)) {
        ctx.errors.merge = "the model answered no JSON";
        continue;
      }
      const verdict = new Map(got.pairs.map((/** @type {any} */ p) => [Number(p?.n), p?.same]));
      for (const [n, p] of batch.entries()) {
        const v = verdict.get(n + 1);
        if (typeof v === "boolean") /** @type {any} */ (p).verdict = v;
        if (v === true) same.push(p);
        else if (v === false) {
          this.archive.items.note(p.b.id, "distinct", { by: "curator", run: ctx.run, detail: { other: p.a.id } });
        }
        if (typeof v === "boolean") judged++;
      }
    }
    // One group per set of claims each judged the same as every other, the most alike pairs first: a pair whose join
    // would hold two claims never judged the same — known distinct, or never put to the model together — stays apart,
    // so whichever of a group survives was judged to say what each of the others said.
    const judgedSame = new Set(same.map((p) => key(p.a.id, p.b.id)));
    /** @type {Map<number, number>} */
    const parent = new Map();
    /** Each group's claims, by its root. @type {Map<number, number[]>} */
    const members = new Map();
    const find = (/** @type {number} */ x) => {
      while (parent.has(x) && parent.get(x) !== x) x = /** @type {number} */ (parent.get(x));
      return x;
    };
    for (const { a, b } of same) {
      for (const x of [a.id, b.id])
        if (!parent.has(x)) {
          parent.set(x, x);
          members.set(x, [x]);
        }
      const ra = find(a.id);
      const rb = find(b.id);
      const one = members.get(ra) || [];
      const other = members.get(rb) || [];
      if (ra === rb || !one.every((x) => other.every((y) => judgedSame.has(key(x, y))))) continue;
      parent.set(rb, ra);
      members.set(ra, [...one, ...other]);
      members.delete(rb);
    }
    const byId = new Map(claims.map((/** @type {any} */ c) => [c.id, c]));
    const groups = [...members.values()].filter((ids) => ids.length > 1).map((ids) => ids.map((id) => byId.get(id)));
    const counts = this.archive.items.eventCounts([...parent.keys()]);
    let merged = 0;
    /** The group each merged claim went into. @type {Map<number, number>} */
    const groupOf = new Map();
    for (const [n, g] of groups.entries()) {
      const [keep, ...rest] = g.sort((/** @type {any} */ x, /** @type {any} */ y) => survivorOrder(x, y, counts));
      const r = await this.brain.merge(keep.id, rest.map((/** @type {any} */ x) => x.id), { by: "curator", run: ctx.run });
      merged += r.merged?.length || 0;
      if (r.merged?.length) for (const c of g) groupOf.set(c.id, n);
    }
    // A pair by meaning is settled once judged distinct (now or before) or merged into one: one judged the same that no
    // group could take (a third claim never judged beside it) is found and asked again.
    near.done((p) => distinct.has(key(p.a.id, p.b.id)) || p.verdict === false || (groupOf.has(p.a.id) && groupOf.get(p.a.id) === groupOf.get(p.b.id)));
    ctx.steps.merged = merged;
    ctx.steps.pairsJudged = judged;
  }
  /**
   * Pairs by meaning (the memory plan's f6): the merge found pairs by shared words alone, so a claim said again in other
   * words, or in another language, stood beside the first for good. Each standing claim of the project the merge has
   * not looked up yet (`curator.nearLooked`), the oldest first, NEAR_QUERIES at most, is looked up in the engine by
   * meaning (`store.dense`: its rows nearest the claim's words, every project's, by the cosine of their vectors); of
   * its NEAR_SCAN nearest from NEAR_MIN_SIM up, the first NEAR_TOP_K whose claim is another standing one of the project,
   * that may merge (`mayMerge`) and is no pair yet, pair with it. The newer of two claims finds the older. `done(settled)`,
   * once the pairs are judged and merged: a claim whose pairs are all settled is marked looked up, with the pass
   * (`curator.lookedNear`: undo takes the mark back, a delete takes it with the claim), and one whose pair the pass had
   * no call or no answer for is looked up again next pass. None while the engine makes its vectors again (two models'
   * vectors are never compared) or has none; a lookup that fails is left for next pass, and NEAR_FAILS in a row stop it.
   * @param {any} ctx @param {any[]} claims @param {Set<string>} have
   * @returns {Promise<{ pairs: { a: any, b: any, ov: number }[], done: (settled: (p: any) => boolean) => void }>}
   */
  async #nearPairs(ctx, claims, have) {
    const none = { pairs: [], done: () => {} };
    const store = this.brain?.store;
    const hello = store?.status?.()?.hello;
    if (!ctx.projectId || !this.brain?.storeReady?.() || this.brain.reembedding || typeof store?.dense !== "function" || hello?.embeddings !== true) return none;
    // Pairs no call is left to judge are not looked for: they would only wait.
    if (!this.#room(ctx, "merge")) return none;
    const looked = this.archive.curator.nearLooked(claims.map((c) => c.id));
    // A claim with no copy in the engine yet (its mirror queued) is found by nothing and finds its twin only if that has
    // one: it waits. One whose lookup failed in this process goes last, so it never holds up the rest.
    const failed = this.#nearFailed;
    const due = claims
      .filter((c) => !looked.has(c.id) && c.memory_id)
      .sort((a, b) => Number(failed.has(a.id)) - Number(failed.has(b.id)) || a.id - b.id);
    if (!due.length) return none;
    const byId = new Map(claims.map((c) => [c.id, c]));
    const key = (/** @type {number} */ x, /** @type {number} */ y) => (x < y ? `${x}:${y}` : `${y}:${x}`);
    /** @type {{ a: any, b: any, ov: number }[]} */
    const pairs = [];
    /** The pairs found by meaning this pass, by key: each is both its claims', whichever found it. @type {Map<string, any>} */
    const found = new Map();
    /** Each claim looked up, with every pair by meaning it is in. @type {{ id: number, pairs: any[] }[]} */
    const asked = [];
    let fails = 0;
    for (const c of due.slice(0, hello.vec === false ? NEAR_QUERIES_SLOW : NEAR_QUERIES)) {
      if (ctx.cut) break;
      let rows;
      try {
        rows = await store.dense(clip(String(c.text), NEAR_CHARS), { topK: NEAR_SCAN, minSim: NEAR_MIN_SIM, strict: true });
        fails = 0;
        failed.delete(c.id);
      } catch {
        failed.add(c.id);
        if (++fails >= NEAR_FAILS) break;
        continue;
      }
      const gave = [];
      for (const r of rows || []) {
        if (gave.length >= NEAR_TOP_K) break;
        for (const other of this.archive.items.byMemoryId(String(r.id))) {
          const o = byId.get(other.id);
          if (!o || o.id === c.id || gave.length >= NEAR_TOP_K) continue;
          const k = key(o.id, c.id);
          // A pair an earlier lookup of this pass found is this claim's too; one the words found comes again by them.
          if (found.has(k)) {
            gave.push(found.get(k));
            continue;
          }
          if (have.has(k) || !mayMerge(o, c)) continue;
          have.add(k);
          const [a, b] = o.id < c.id ? [o, c] : [c, o];
          const p = { a, b, ov: Number(r.score) || NEAR_MIN_SIM };
          found.set(k, p);
          pairs.push(p);
          gave.push(p);
        }
      }
      asked.push({ id: c.id, pairs: gave });
    }
    if (asked.length) ctx.steps.nearLooked = asked.length;
    if (pairs.length) ctx.steps.nearPairs = pairs.length;
    return {
      pairs,
      done: (settled) => {
        if (ctx.cut) return;
        const done = asked.filter((l) => l.pairs.every(settled)).map((l) => l.id);
        if (done.length) this.archive.curator.lookedNear(done, ctx.run ?? null);
        const left = due.length - done.length;
        if (left) ctx.steps.nearLeft = left;
      },
    };
  }
  /**
   * M4-4: a claim whose file changed (or lost a name it relies on) is checked against the file as it is. Holds: anchored
   * afresh. Wrong: retired (asked, for the user's word). Unsure: left labelled. Each answer is kept with the files' state,
   * so a file that has not moved since is not asked about again.
   */
  async #reverify(/** @type {any} */ ctx) {
    if (!ctx.root) return;
    /** @type {Record<string, number>} */
    const tally = {};
    /** @type {{ it: any, moved: any[], files: Record<string, any>, recent: boolean }[]} */
    const due = [];
    for (const it of this.#standing(ctx)) {
      const f = this.brain.filesOf(it);
      if (f?.worst.state !== "changed" && f?.worst.state !== "symbol") continue;
      const moved = f.anchors.filter((/** @type {any} */ a) => a.now.state === "changed" || a.now.state === "symbol");
      const files = Object.fromEntries(moved.map((/** @type {any} */ a) => [a.name, fileState(a.path)]));
      const events = this.archive.items.events(it.id).filter((/** @type {any} */ e) => !e.undone_at);
      const last = events.filter((/** @type {any} */ e) => e.action === "checked").at(-1);
      if (last && JSON.stringify(last.detail?.files) === JSON.stringify(files)) continue;
      // Checked lately — found unsure, or holding and anchored afresh — and its file moved again since.
      const checkedAt = Math.max(0, ...events.filter((/** @type {any} */ e) => e.by === "curator" && (e.action === "checked" || e.action === "verified")).map((/** @type {any} */ e) => Number(e.at) || 0));
      due.push({ it, moved, files, recent: this.now() - checkedAt < RECHECK_AFTER });
    }
    // Which first, where a pass has fewer calls than claims due (the memory plan's f1): a claim not checked in a week
    // before one checked since, so a file that changes every pass never takes every call and a backlog drains; then the
    // claims the dossier cites, which every session reads; then the most shown these 30 days; then the oldest.
    const cited = new Set(ctx.projectId ? this.archive.dossiers.latest(ctx.projectId)?.cites || [] : []);
    const shown = due.length > 1 ? this.archive.injections.useCounts(due.map((d) => itemRef(d.it.id)), this.now() - SHOWN_WINDOW) : new Map();
    const times = (/** @type {any} */ it) => shown.get(itemRef(it.id))?.shown || 0;
    due.sort((a, b) => Number(a.recent) - Number(b.recent) || Number(cited.has(b.it.id)) - Number(cited.has(a.it.id)) || times(b.it) - times(a.it) || a.it.id - b.it.id);
    for (const { it, moved, files } of due) {
      if (!this.#room(ctx, "reverify")) {
        this.#count(tally, "left");
        continue;
      }
      const room = Math.floor(EXCERPT_CHARS / moved.length);
      const shown = moved
        .map((/** @type {any} */ a) => `File ${a.name} (${a.now.state === "symbol" ? `it no longer has ${a.now.symbol}` : "changed since the note was recorded"}):\n${excerptOf(a.path, it.text, room)}`)
        .join("\n\n");
      const got = parseJson(
        await this.#ask(ctx, "reverify", {
          system: VERIFY_PROMPT,
          user: `Note (${itemRef(it.id)}, ${trustOf(it)}, recorded ${dateOf(it.created_at)}): ${clip(it.text, 500)}\n\n${shown}`,
        }),
      );
      const verdict = ["holds", "wrong", "unsure"].includes(got?.verdict) ? got.verdict : "unsure";
      const why = clip(String(got?.why ?? "").replace(/\s+/g, " ").trim(), 200);
      if (verdict === "holds" && this.brain.reanchor(it.id, { by: "curator", run: ctx.run, reason: why || "checked against its files: it holds" }).ok) {
        this.#count(tally, "verified");
        continue;
      }
      if (verdict === "wrong") {
        const did = await this.#retire(ctx, it, { reason: `checked against ${Object.keys(files).join(", ")}: ${why || "it no longer holds"}`, key: `wrong:${it.id}:${sha1(JSON.stringify(files)).slice(0, 12)}` });
        this.#count(tally, did === "retired" ? "wrong" : did);
        if (did === "retired") continue;
      } else this.#count(tally, "unsure");
      this.archive.items.note(it.id, "checked", { by: "curator", run: ctx.run, reason: why || null, detail: { verdict, files } });
    }
    for (const [k, v] of Object.entries(tally)) ctx.steps[k === "left" ? "reverifyLeft" : k === "asked" ? "reverifyAsked" : k] = v;
  }
  /**
   * M7-D68: the suspicions cast on a claim judged, each against what cast it — the queue M3-D1 named: a learning pass's
   * finding that its session showed the claim wrong (the memory plan's d4: `detail.why`, the session and the turn), or
   * the correction on record that cast it (M3-5, `detail.correction`). A standing
   * claim's suspicions since it was last judged (its last `cleared` or `weighed`):
   * - unrelated: `cleared`, and they stop counting;
   * - wrong: the claim retired — replaced by the correction, or by nothing for a finding (the user's word asked about
   *   instead); one project's word never retires a claim of every project (M3-5): that one is weighed, and still counted;
   * - unsure: weighed, and still counted.
   * A suspicion whose correction was retired since is cleared with no call; one with neither a correction nor a finding
   * is left.
   * Each is an event of the pass, so undoing it brings the suspicion back.
   */
  async #suspicions(/** @type {any} */ ctx) {
    /** @type {Record<string, number>} */
    const tally = {};
    /** @type {{ it: any, c: any }[]} */
    const pairs = [];
    for (const it of this.#standing(ctx)) {
      const events = this.archive.items.events(it.id).filter((/** @type {any} */ e) => !e.undone_at);
      const since = Math.max(0, ...events.filter((/** @type {any} */ e) => e.action === "cleared" || e.action === "weighed").map((/** @type {any} */ e) => e.id));
      /** @type {Map<number, any>} */
      const cast = new Map();
      /** @type {any[]} */
      const found = [];
      for (const e of events) {
        if (e.action !== "suspected" || e.id <= since) continue;
        const n = Number(/^i(\d+)$/.exec(String(e.detail?.correction ?? ""))?.[1]);
        const c = n ? this.archive.items.get(n) : null;
        if (c) cast.set(c.id, c);
        // A learning pass's finding (d4): what its session showed, in its words — judged as a correction is.
        else if (!n && e.detail?.why)
          found.push({ id: null, ref: `s:${e.detail.chain}`, event: e.id, text: String(e.detail.why), chain_id: e.detail.chain ?? null, project_id: e.detail.project ?? null, n: e.detail.n ?? null, status: "inferred" });
      }
      if (!cast.size && !found.length) continue;
      const live = [...[...cast.values()].filter((c) => !isRetired(c.status)), ...found];
      if (!live.length) {
        const gone = [...cast.values()].map((c) => itemRef(c.id));
        this.archive.items.note(it.id, "cleared", { by: "curator", run: ctx.run, reason: `its correction${gone.length === 1 ? "" : "s"} ${gone.join(", ")} ${gone.length === 1 ? "was" : "were"} retired since`, detail: { corrections: gone, retired: true } });
        this.#count(tally, "cleared");
        continue;
      }
      for (const c of live) pairs.push({ it, c });
    }
    /** @type {Map<number, { it: any, wrong: { c: any, why: string } | null, unsure: number, unrelated: any[] }>} */
    const judged = new Map();
    for (let i = 0; i < pairs.length; i += SUSPECT_BATCH) {
      if (!this.#room(ctx, "suspicions")) break;
      const batch = pairs.slice(i, i + SUSPECT_BATCH);
      const user = batch
        .map(
          (p, n) =>
            `${n + 1}. Note (${itemRef(p.it.id)} · ${p.it.kind} · ${trustOf(p.it)}): ${clip(p.it.text, 300)}\n   ${
              p.c.id != null ? `Correction (${itemRef(p.c.id)}${p.c.chain_id ? `, session ${p.c.chain_id}` : ""})` : `Found (session ${p.c.chain_id ?? "?"}${p.c.n != null ? `, turn ${p.c.n}` : ""})`
            }: ${clip(p.c.text, 300)}`,
        )
        .join("\n");
      const got = parseJson(await this.#ask(ctx, "suspicions", { system: SUSPECT_PROMPT, user }));
      const verdict = new Map((Array.isArray(got?.pairs) ? got.pairs : []).map((/** @type {any} */ p) => [Number(p?.n), p]));
      batch.forEach((p, n) => {
        const v = verdict.get(n + 1);
        const said = ["wrong", "unrelated", "unsure"].includes(v?.verdict) ? v.verdict : null;
        if (!said) return; // not answered: left for the next pass
        const j = judged.get(p.it.id) || { it: p.it, wrong: null, unsure: 0, unrelated: [] };
        const why = clip(String(v?.why ?? "").replace(/\s+/g, " ").trim(), 200);
        if (said === "wrong") j.wrong ??= { c: p.c, why };
        else if (said === "unsure") j.unsure++;
        else j.unrelated.push(p.c);
        judged.set(p.it.id, j);
      });
    }
    for (const j of judged.values()) {
      // A claim judged only in part (a pair the model left out) waits for the next pass whole.
      const answered = (j.wrong ? 1 : 0) + j.unsure + j.unrelated.length;
      if (!j.wrong && answered < pairs.filter((p) => p.it.id === j.it.id).length) continue;
      const corrections = pairs.filter((p) => p.it.id === j.it.id).map((p) => (p.c.id != null ? itemRef(p.c.id) : p.c.ref));
      if (j.wrong) {
        const { c, why } = j.wrong;
        if (!userBacked(j.it) && j.it.project_id !== c.project_id) {
          this.archive.items.note(j.it.id, "weighed", { by: "curator", run: ctx.run, reason: why || null, detail: { verdict: "wrong", corrections } });
          this.#count(tally, "weighed");
          continue;
        }
        // A learned claim is retired, by the correction or by nothing for a finding; the user's word is asked about (or
        // was already), and stands.
        const did =
          c.id != null
            ? await this.#retire(ctx, j.it, { reason: `a correction in session ${c.chain_id ?? "?"} said it is wrong: ${why || clip(c.text, 120)}`, key: `suspect:${j.it.id}:${c.id}`, replacement: c.id })
            : await this.#retire(ctx, j.it, { reason: `session ${c.chain_id ?? "?"} showed it wrong: ${why || clip(c.text, 120)}`, key: `suspect:${j.it.id}:e${c.event}`, replacement: null });
        if (did === "retired") {
          this.#count(tally, "wrong");
          continue;
        }
        this.archive.items.note(j.it.id, "weighed", { by: "curator", run: ctx.run, reason: why || null, detail: { verdict: "wrong", asked: true, corrections } });
        this.#count(tally, did === "asked" ? "asked" : "weighed");
        continue;
      }
      if (j.unsure) {
        this.archive.items.note(j.it.id, "weighed", { by: "curator", run: ctx.run, reason: "not settled", detail: { verdict: "unsure", corrections } });
        this.#count(tally, "weighed");
        continue;
      }
      this.archive.items.note(j.it.id, "cleared", { by: "curator", run: ctx.run, reason: "judged unrelated", detail: { corrections } });
      this.#count(tally, "cleared");
    }
    for (const [k, v] of Object.entries(tally)) ctx.steps[`suspicions${k[0].toUpperCase()}${k.slice(1)}`] = v;
  }
  /**
   * The memory plan's f2: a claim the dossier is about to be written from is checked against the turn it was learned
   * from — what the person said, the calls that name it with what they returned, the answer (`#turnView`); a cheap
   * learner can read two sessions wrong alike, and two sessions earn a dossier line. Not checked: the user's word (their
   * words were held to the turn as they were kept), an open thread (filed on a reading's last turn, and it expires on
   * its own) and a finding (filed on the turn that launched its agent, whose report that turn holds as a call's result).
   * Holds: `grounded`, which adds to its confidence what a session saying it again adds, though it is no session (its
   * ✓n and its lapse count sessions); wrong: retired (`#retire`); unsure: `grounded` unsure, counting nothing; a note
   * the model left unanswered is asked next pass. Each is asked once, the most shown first, `GROUND_BATCH` to a call,
   * a turn shown once for the notes it gave. A turn kept apart, unfinished or rewound, and a chat Memory settings leave
   * out, is never shown.
   */
  async #ground(/** @type {any} */ ctx) {
    if (!ctx.projectId || ctx.projectId === NO_PROJECT_ID) return;
    const src = this.#dossierSource(ctx);
    if (!src) return;
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    /** @type {Map<number, any>} */
    const rows = new Map();
    /** The turn a claim came from, where it can be shown: in its chain, finished, not rewound nor a command, not kept apart. @param {any} c */
    const turnOf = (c) => {
      if (!rows.has(c.turn_id)) rows.set(c.turn_id, this.archive.getTurn(c.turn_id) || null);
      const t = rows.get(c.turn_id);
      return t && t.chain_id === c.chain_id && t.final_hash != null && viewed(t) && !apartTurn(t) ? t : null;
    };
    const todo = src.claims
      .map((x) => x.c)
      .filter(
        (/** @type {any} */ c) =>
          c.kind !== "thread" &&
          !FINDING_ORIGINS.has(c.origin) &&
          c.chain_id &&
          c.turn_id != null &&
          !userBacked(c) &&
          !this.#did(c.id, ["grounded"]) &&
          !this.brain?.keptToItself?.(c.chain_id, keptAside) &&
          turnOf(c),
      );
    const shown = todo.length > 1 ? this.archive.injections.useCounts(todo.map((/** @type {any} */ c) => itemRef(c.id)), this.now() - SHOWN_WINDOW) : new Map();
    const times = (/** @type {any} */ c) => shown.get(itemRef(c.id))?.shown || 0;
    todo.sort((/** @type {any} */ a, /** @type {any} */ b) => times(b) - times(a) || a.id - b.id);
    /** @type {Record<string, number>} */
    const tally = {};
    for (let i = 0; i < todo.length; ) {
      if (!this.#room(ctx, "ground")) {
        tally.groundLeft = todo.length - i;
        break;
      }
      // The batch's claims under the turns they came from, each turn shown once, its notes numbered on through the call.
      const batch = todo.slice(i, i + GROUND_BATCH);
      i += batch.length;
      /** @type {Map<number, any[]>} */
      const byTurn = new Map();
      for (const c of batch) byTurn.set(c.turn_id, [...(byTurn.get(c.turn_id) || []), c]);
      /** @type {{ c: any, n: number }[]} */
      const asked = [];
      const parts = ["Turns, each with the notes learned from it:"];
      for (const [turnId, notes] of byTurn) {
        const t = rows.get(turnId);
        const view = this.#turnView(t, notes);
        if (!view) continue;
        parts.push(
          `\n${view}\nNotes from it:`,
          ...notes.map((c) => {
            asked.push({ c, n: t.n });
            return `${asked.length}. Note (${itemRef(c.id)}, ${c.kind} · ${trustOf(c)}, recorded ${dateOf(c.created_at)}): ${clip(c.text, 500)}`;
          }),
        );
      }
      if (!asked.length) continue;
      const got = parseJson(await this.#ask(ctx, "ground", { system: GROUND_PROMPT, user: parts.join("\n") }));
      if (!got || !Array.isArray(got.notes)) {
        ctx.errors.ground = "the model answered no JSON";
        continue;
      }
      const byN = new Map(got.notes.map((/** @type {any} */ v) => [Number(v?.n), v]));
      for (const [k, { c, n }] of asked.entries()) {
        const v = byN.get(k + 1);
        const verdict = String(v?.verdict ?? "").toLowerCase();
        // Left unanswered, it is asked next pass: no verdict is written for it.
        if (!["holds", "wrong", "unsure"].includes(verdict)) continue;
        const why = clip(String(v?.why ?? "").replace(/\s+/g, " ").trim(), 200);
        const turn = { n };
        const cur = this.archive.items.get(c.id);
        if (!cur || isRetired(cur.status)) continue;
        if (verdict === "wrong") {
          const did = await this.#retire(ctx, cur, { reason: `checked against session ${c.chain_id}, turn ${turn.n}: ${why || "the turn says otherwise"}`, key: `ground:${c.id}` });
          this.#count(tally, did === "retired" ? "groundWrong" : did === "asked" ? "groundAsked" : null);
          if (did === "retired") continue;
        } else this.#count(tally, verdict === "holds" ? "grounded" : "groundUnsure");
        this.archive.items.note(c.id, "grounded", { by: "curator", run: ctx.run, reason: why || null, detail: { verdict, chain: c.chain_id, turn: turn.n } });
      }
    }
    for (const [k, v] of Object.entries(tally)) ctx.steps[k] = v;
  }
  /**
   * A turn as grounding shows it, once for the notes learned from it (f2): the person's words, the calls that name the
   * notes with what they returned (the most named first, `GROUND_RESULTS`), and the answer — each part in its own room
   * and cut around the notes' words, each note's words given a place (`interleaved`), so what bears them out is not cut
   * away. Memory's own calls are left out, and its reminders on a call's result: what memory said is no proof of itself.
   * A call is named by what it returned before what it was given (an edit that writes the note's words returns "done").
   * Every part has its secrets blanked before it is cut (`blanked`). Null where it holds no answer or cannot be read.
   * A turn of another machine's agents' chat (archive `agentsChat`) shows their agents' words as theirs, no "User:" line
   * (the remote-agents plan's fc-word); one whose chat cannot be read is taken as theirs.
   * @param {any} t  the turn's row @param {any[]} notes
   */
  #turnView(t, notes) {
    let body;
    try {
      body = this.archive.turnBodies(t.chain_id, { ns: [t.n], open: "all" })[0];
    } catch {
      return null;
    }
    if (!body?.final) return null;
    const about = notes.map((c) => c.text).join("\n");
    const most = Math.max(3, notes.length);
    const terms = interleaved(notes.map((c) => termsOf(c.text)));
    const part = (/** @type {string} */ s, /** @type {number} */ room) => redactUnterminatedSecretTail(excerptIn(blanked(s), about, room, most, terms));
    const said = wordsOfMessage(body.user).said.trim();
    let agents = true;
    try {
      agents = this.archive.agentsChat?.(String(t.chain_id)) === true;
    } catch {}
    const words = said ? part(said, GROUND_USER_CHARS) : "(no words of their own)";
    const opener = t.meta?.own ? "No user message: the assistant went on by itself." : agents ? `${AGENTS_SAID} ${words}` : `User: ${words}`;
    const calls = callsWithResults(body.work)
      .filter((c) => !MEMORY_TOOL.test(c.name))
      .map((c) => ({ ...c, result: c.result.replace(REMINDER_LINE, "").trim() }));
    const hitsIn = (/** @type {string} */ text) => {
      const lower = text.toLowerCase();
      return terms.filter((w) => termAt(text, lower, w) >= 0).length;
    };
    const named = calls
      .map((c, k) => ({ c, k, hits: hitsIn(c.result) * 10 + hitsIn(c.input) }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits || a.k - b.k)
      .slice(0, GROUND_RESULTS)
      .sort((a, b) => a.k - b.k);
    const lines = [`## Session ${t.chain_id}, turn ${t.n}`, opener];
    if (named.length)
      lines.push(
        `Calls that name these notes (${named.length} of ${calls.length}):`,
        ...named.map(({ c }) => `- ${c.name} ${redactUnterminatedSecretTail(clip(blanked(c.input), GROUND_INPUT_CHARS))}${c.result ? `\n  ${c.failed ? "failed" : "returned"}: ${part(c.result, GROUND_RESULT_CHARS).replace(/\n/g, "\n  ")}` : ""}`),
      );
    else if (calls.length) lines.push(`(${calls.length} call${calls.length === 1 ? "" : "s"}, none naming these notes)`);
    const answer = textOfMessage(body.final).trim();
    const room = Math.min(GROUND_ANSWER_MOST, GROUND_ANSWER_CHARS + GROUND_ANSWER_MORE * (notes.length - 1));
    lines.push(`Assistant: ${answer ? part(answer, room) : "(no text)"}`);
    return lines.join("\n");
  }
  /**
   * The fenced engine rows that are verbatim copies of Filament's old items (M2-D14) become questions: restore candidates
   * the user accepts or rejects, never served until then. Each row is read once.
   */
  async #restore(/** @type {any} */ ctx) {
    if (!this.brain.storeReady?.()) return;
    const fence = this.archive.schemaMetaGet("engineFence") || {};
    const read = new Set(this.archive.schemaMetaGet("curatorFenceRead") || []);
    const ids = [...(fence.working || []), ...(fence.episodic || [])].filter((id) => !read.has(id));
    let raised = 0;
    for (const id of ids) {
      /** @type {any} */
      let row = null;
      try {
        row = await this.brain.store.get(id);
      } catch {
        continue; // read again on the next pass
      }
      read.add(id);
      const m = /^\[filament-([a-z]+)\]\s*([\s\S]+)$/.exec(String(row?.content ?? "").trim());
      if (!m || !CURATED.has(m[1]) || !/^sleep_/.test(String(row?.source ?? "")) || row?.metadata?.llm_used !== false) continue;
      const text = clip(m[2].trim(), 500);
      const q = this.archive.inbox.add({
        projectId: row.metadata?.project ?? null,
        kind: "restore",
        key: `restore:${id}`,
        proposal: { action: "restore", engine: id, kind: m[1], text },
        reason: "the engine's own consolidation moved this note out of recall; it is word for word an old Filament note",
        run: ctx.run,
      });
      if (q.raised) raised++;
    }
    if (ids.length) this.archive.schemaMetaSet("curatorFenceRead", [...read]);
    if (raised) ctx.steps.restoreAsked = raised;
  }
  /**
   * Patterns across sessions (the memory plan's f4): one session sees its own corrections alone, and a correction the
   * user gave in three sessions was three. The project's corrections of the last ADOPT_DAYS (`#corrections`) that share
   * half their identifying words (`overlap`, the merge's measure: token statistics, no list of words) are one, once given
   * in ADOPT_SESSIONS sessions; the model is asked, a call a pattern, whether they share one lesson (ADOPT_PROMPT),
   * weighed against the user's own rules and the lessons they turned down that share its words: one that says what
   * those say is none, one that says a rule of theirs is out of date asks whether its words change (`correct`, as a
   * later session's do, M6-D16), and any other rule its lines bear out (`grounded`) asks whether to keep it, `adopt`:
   * the curator writes no claim's words (M4-D3), and only a text the person accepts becomes theirs (`brain.decide`).
   * A pattern is a correction with those of other sessions that share its words directly (`#patterns`: no chain of
   * look-alikes joins two that share nothing), and its sessions are counted by lineage (a fork and its parent are one).
   * A question keeps the corrections it was drawn from (`from`): a pattern holding one of them is that question's, so
   * it is asked once however it grows, ages or joins another, and one rejected never again. The corrections the model
   * found no lesson in are kept, and a pattern holding them is put again only once a session more gives it. A pass
   * undone withdraws its questions, and their corrections stay asked, as a restore's or a suspicion's do.
   */
  async #adopt(/** @type {any} */ ctx) {
    const found = this.#corrections(ctx.projectId);
    if (found.length < ADOPT_SESSIONS) return;
    // This step's questions, whatever became of them: each keeps the corrections it was drawn from.
    const questions = this.archive.inbox.ofKinds(["adopt", "retire"], ctx.projectId).filter((/** @type {any} */ q) => Array.isArray(q.proposal?.from));
    const asked = new Set(questions.flatMap((/** @type {any} */ q) => q.proposal.from));
    const none = new Set(/** @type {string[]} */ (this.archive.schemaMetaGet("curatorAdoptNone") || []));
    const wordsIn = (/** @type {string} */ s) => new Set(identifyingWords(s).map(stem));
    // What a lesson is weighed against: the user's own rules, and the lessons they turned down.
    const rules = [...this.archive.items.usersWord(ctx.projectId, ["rule", "preference", "convention"]).rows()].map((/** @type {any} */ r) => ({ id: Number(r.id), kind: String(r.kind), text: String(r.text), words: wordsIn(r.text) }));
    const declined = questions
      .filter((/** @type {any} */ q) => q.status === "rejected" && typeof q.proposal?.text === "string")
      .map((/** @type {any} */ q) => ({ id: 0, kind: "", text: String(q.proposal.text), words: wordsIn(q.proposal.text) }));
    const due = this.#patterns(found).filter((p) => {
      if (p.m.some((x) => asked.has(x.ref))) return false;
      // Put again only for a session none of whose corrections the model found no lesson in.
      const judged = new Set(p.m.filter((x) => none.has(x.ref)).map((x) => x.session));
      return p.m.some((x) => !judged.has(x.session));
    });
    let raised = 0;
    for (const [k, p] of due.entries()) {
      if (!this.#room(ctx, "adopt")) {
        ctx.steps.adoptLeft = due.length - k;
        break;
      }
      // The newest of each session first, then the rest, as many as are shown.
      const newest = [...p.m].reverse();
      const seen = new Set();
      const firsts = newest.filter((x) => !seen.has(x.session) && seen.add(x.session));
      const shown = [...firsts, ...newest.filter((x) => !firsts.includes(x))].slice(0, ADOPT_SHOWN);
      // The user's rules and the lessons they turned down that share the pattern's words, the most shared first.
      const said = wordsIn(shown.map((x) => x.text).join(" "));
      const near = (/** @type {typeof rules} */ list) =>
        list
          .map((r) => ({ r, n: [...r.words].filter((w) => said.has(w)).length }))
          .filter((x) => x.n >= ADOPT_SHARED && overlap(x.r.words, said) >= 0.5)
          .sort((a, b) => b.n - a.n)
          .slice(0, ADOPT_NEAR)
          .map((x) => x.r);
      const mine = near(rules);
      const down = near(declined);
      const user = [
        `Corrections, from ${p.sessions} sessions:`,
        ...shown.map((x, i) => `${i + 1}. (session ${String(x.chain).slice(0, 8)}) ${x.text}`),
        ...(mine.length ? ["", "The user's own rules:", ...mine.map((r, i) => `R${i + 1}. (${r.kind}) ${r.text}`)] : []),
        ...(down.length ? ["", "Lessons the user turned down:", ...down.map((r, i) => `D${i + 1}. ${r.text}`)] : []),
      ].join("\n");
      const got = parseJson(await this.#ask(ctx, "adopt", { system: ADOPT_PROMPT, user }));
      if (!got || typeof got !== "object") {
        ctx.errors.adopt = "the model answered no JSON";
        continue;
      }
      const rule = typeof got.rule === "string" ? clip(got.rule.trim(), 300) : "";
      const named = (/** @type {any} */ v, /** @type {string} */ tag, /** @type {typeof rules} */ list) => {
        const m = new RegExp(`^${tag}(\\d+)$`).exec(String(v ?? "").trim());
        return m ? (list[Number(m[1]) - 1] ?? null) : null;
      };
      const same = named(got.same, "R", mine) || named(got.same, "D", down);
      const replaces = same ? null : named(got.replaces, "R", mine);
      // No lesson, one the user has or turned down, or a rule in words its lines do not hold (the model's, not the user's).
      if (!rule || same || !grounded(rule, shown.map((x) => x.text))) {
        // Kept last, so the newest judged are the last let go.
        for (const x of p.m) {
          none.delete(x.ref);
          none.add(x.ref);
        }
        if (rule) ctx.steps.adoptDropped = (ctx.steps.adoptDropped || 0) + 1;
        continue;
      }
      const from = p.m.map((x) => x.ref);
      const why = clip(String(got.why || "").trim(), 200);
      const reason = replaces ? `the same correction in ${p.sessions} sessions says otherwise: ${why}` : `the same correction in ${p.sessions} sessions: ${why}`;
      const q = this.archive.inbox.add({
        projectId: ctx.projectId,
        key: `adopt:${sha1(from.join(" "))}`,
        ...(replaces
          ? // The user's rule the corrections say is out of date: asked whether its words change, as a later session's are
            // (M6-D16, a question that would change their claim); it stands meanwhile, flagged with the words it would take.
            { kind: "retire", itemIds: [replaces.id], proposal: { action: "correct", id: replaces.id, text: rule, sessions: p.sessions, from, reason } }
          : // It doubts none of the claims it was drawn from: none is named, so none is served marked in question.
            { kind: "adopt", itemIds: [], proposal: { action: "adopt", kind: "rule", text: rule, sessions: p.sessions, from } }),
        reason,
        run: ctx.run,
      });
      if (q.raised) {
        if (replaces) ctx.steps.adoptChange = (ctx.steps.adoptChange || 0) + 1;
        else raised++;
      }
      for (const ref of from) asked.add(ref);
    }
    if (none.size) this.archive.schemaMetaSet("curatorAdoptNone", [...none].slice(-ADOPT_NONE_KEPT));
    if (raised) ctx.steps.adoptAsked = raised;
  }
  /**
   * A project's corrections as patterns (f4), the most sessions first, then the newest. Two corrections are alike
   * where they share at least ADOPT_SHARED identifying words and half the fewer's; the correction alike to the most of
   * other sessions is a centre, and a correction no pattern took yet joins it where it is alike to every one there
   * already, the most alike to the centre first; then the next centre. Every two corrections of a pattern share words,
   * so one short line alike to two others joins one of them, never both into one. A pattern holds ADOPT_SESSIONS
   * sessions or more. @param {{ ref: string, chain: string, session: string, at: number, text: string }[]} found
   */
  #patterns(found) {
    const words = found.map((x) => new Set(identifyingWords(x.text).map(stem)));
    // Each correction's alike ones, and how many words each shares with it: every pair compared once.
    /** @type {Map<number, number>[]} */
    const alike = found.map(() => new Map());
    for (let i = 0; i < found.length; i++)
      for (let j = i + 1; j < found.length; j++) {
        let n = 0;
        for (const w of words[i]) if (words[j].has(w)) n++;
        if (n < ADOPT_SHARED || n / Math.min(words[i].size, words[j].size) < 0.5) continue;
        alike[i].set(j, n);
        alike[j].set(i, n);
      }
    const across = found.map((x, i) => [...alike[i].keys()].filter((j) => found[j].session !== x.session).length);
    const taken = new Set();
    const out = [];
    for (const i of found.map((_, i) => i).sort((a, b) => across[b] - across[a] || found[b].at - found[a].at)) {
      if (taken.has(i) || !across[i]) continue;
      const m = [i];
      const next = [...alike[i].keys()].filter((j) => !taken.has(j));
      for (const j of next.sort((a, b) => Number(alike[i].get(b)) - Number(alike[i].get(a)) || found[b].at - found[a].at)) if (m.every((k) => alike[j].has(k))) m.push(j);
      const sessions = new Set(m.map((j) => found[j].session)).size;
      if (sessions < ADOPT_SESSIONS) continue;
      for (const j of m) taken.add(j);
      out.push({ m: m.map((j) => found[j]).sort((a, b) => a.at - b.at || (a.ref < b.ref ? -1 : 1)), sessions });
    }
    return out.sort((a, b) => b.sessions - a.sessions || (b.m.at(-1)?.at ?? 0) - (a.m.at(-1)?.at ?? 0));
  }
  /**
   * A project's corrections of the last ADOPT_DAYS, oldest first, each its session and words, cut and its secrets
   * blanked: what the person said to a reply they pushed back on (a turn the learner, or the agent's quoted correct,
   * marked corrected: the message after it), a claim their word put in place of another, and a claim a session showed
   * wrong. A turn kept apart, and a session Memory settings leave out, give none. @param {string} projectId
   */
  #corrections(projectId) {
    const since = this.now() - ADOPT_DAYS * 86_400_000;
    /** @type {Map<string, boolean>} */
    const keptAside = new Map();
    const open = (/** @type {string | null} */ chain) => !!chain && !this.brain?.keptToItself?.(chain, keptAside);
    const shorn = (/** @type {string} */ s) => clip(blanked(s), ADOPT_CHARS);
    /** @type {Map<string, string>} */
    const roots = new Map();
    /** A session's lineage: the chat a fork was taken from, and its own, back to the first. @param {string} chain */
    const sessionOf = (chain) => {
      if (!roots.has(chain)) {
        let at = chain;
        for (let k = 0; k < 20; k++) {
          const up = this.archive.linksFor(at).find((/** @type {any} */ l) => l.src === at && l.type === "forked")?.dst;
          if (!up || up === at) break;
          at = String(up);
        }
        roots.set(chain, at);
      }
      return /** @type {string} */ (roots.get(chain));
    };
    /** @type {Map<string, { ref: string, chain: string, session: string, at: number, text: string }>} */
    const out = new Map();
    const add = (/** @type {string} */ ref, /** @type {string} */ chain, /** @type {number} */ at, /** @type {string} */ text) => {
      if (!out.has(ref)) out.set(ref, { ref, chain, session: sessionOf(chain), at, text: shorn(text) });
    };
    for (const o of this.archive.outcomes.correctedSince({ since, project: projectId })) {
      if (!open(o.chain_id)) continue;
      const next = this.archive.turnAfter(o.chain_id, o.turn_id);
      if (!next || apartTurn(next)) continue;
      const body = this.archive.turnBodies(o.chain_id, { ns: [next.n], open: "ends" })[0];
      const said = body?.user ? wordsOfMessage(body.user).said.trim() : "";
      if (said) add(`t${next.id}`, o.chain_id, Number(next.started_at) || o.at, said);
    }
    for (const c of this.archive.items.correctionsSince(projectId, since))
      if (c.chain_id && open(c.chain_id)) add(`i${c.id}`, c.chain_id, c.created_at, c.old ? `${c.text} (it said before: ${c.old})` : c.text);
    for (const e of this.archive.items.suspicionsSince(projectId, since))
      if (e.chain && open(e.chain)) add(`e${e.id}`, e.chain, e.at, `${e.text} (shown wrong: ${e.why})`);
    return [...out.values()].sort((a, b) => a.at - b.at).slice(-ADOPT_MOST);
  }
  /**
   * About the user, everywhere (the memory plan's f5): the learner gives a claim about the user a slot of subject
   * "user", but each project keeps its own claims, so who the user is and how they work is learned again in every
   * project and known in none of the others. One thing about the user — a single-valued slot, or one value of a
   * multi-valued one (a language they write: each is its own) — that this project's claims hold, and the claims of
   * EVERYWHERE_PROJECTS projects in all, is put to the model, a call each (EVERYWHERE_PROMPT); the claim it picks as
   * true of the user in every project becomes a question of no project, `everywhere`, which every project's inbox
   * lists, with the shown claims it says the same as (`from`). Accepted, its words are the user's in every project, in
   * place of those claims (`brain.decide`): the curator writes no words of its own (M4-D3). Not put: a thing held
   * everywhere already, one an open question asks about, and one every project of which was judged already — in a
   * question's `from` or judged with it (`curatorEverywhereNone`) — until a project more holds it. A question's key is
   * its slot and the value picked: rejected, that value is never asked again.
   */
  async #everywhere(/** @type {any} */ ctx) {
    const thing = (/** @type {string} */ slot, /** @type {any} */ multi, /** @type {any} */ value) => (multi ? `${slot}\0${slotNorm(value)}` : slot);
    /** @type {Map<string, { slot: string, claims: any[] }>} */
    const things = new Map();
    /** @type {any[]} */
    const everywhere = [];
    for (const it of this.archive.items.inUserSlots(ctx.projectId)) {
      if (it.project_id == null) everywhere.push(it);
      else {
        const k = thing(it.slot, it.slot_multi, it.slot_value || it.text);
        things.set(k, { slot: it.slot, claims: [...(things.get(k)?.claims || []), it] });
      }
    }
    // Held everywhere: a single-valued slot by any claim of no project in it; a value of a multi-valued one by a claim
    // of no project that holds it (`holdsValue`: one set on the Memory page has no value of its own, its words do).
    const held = (/** @type {{ slot: string, claims: any[] }} */ g) =>
      everywhere.some((e) => e.slot === g.slot && (!e.slot_multi || (!!g.claims[0].slot_multi && holdsValue(e, g.claims[0].slot_value || g.claims[0].text))));
    const questions = this.archive.inbox.ofKinds(["everywhere"], null);
    const open = new Set(questions.filter((/** @type {any} */ q) => q.status === "open").map((/** @type {any} */ q) => thing(q.proposal?.slot, q.proposal?.multi, q.proposal?.value || q.proposal?.text)));
    const asked = new Set(questions.flatMap((/** @type {any} */ q) => (Array.isArray(q.proposal?.from) ? q.proposal.from : [])));
    const none = new Set(/** @type {number[]} */ (this.archive.schemaMetaGet("curatorEverywhereNone") || []));
    const due = [...things.entries()]
      .map(([k, { slot, claims }]) => {
        const judged = new Set(claims.filter((c) => asked.has(c.id) || none.has(c.id)).map((c) => c.project_id));
        return { k, slot, claims, judged, projects: new Set(claims.map((c) => c.project_id)).size };
      })
      .filter(
        (g) =>
          g.projects >= EVERYWHERE_PROJECTS &&
          g.claims.some((c) => c.project_id === ctx.projectId) &&
          !held(g) &&
          !open.has(g.k) &&
          g.claims.some((c) => !g.judged.has(c.project_id)),
      );
    /** @type {Map<string, string>} */
    const names = new Map();
    const nameOf = (/** @type {string} */ id) => {
      if (!names.has(id)) names.set(id, String(this.archive.getProject(id)?.name || String(id).slice(0, 8)));
      return names.get(id);
    };
    let raised = 0;
    for (const [k, g] of due.entries()) {
      if (!this.#room(ctx, "everywhere")) {
        ctx.steps.everywhereLeft = due.length - k;
        break;
      }
      // The newest of each project first, then the rest, as many as are shown.
      const newest = [...g.claims].reverse();
      const seen = new Set();
      const firsts = newest.filter((c) => !seen.has(c.project_id) && seen.add(c.project_id));
      const shown = [...firsts, ...newest.filter((c) => !firsts.includes(c))].slice(0, EVERYWHERE_SHOWN);
      const user = [`About the user · ${g.slot.slice(USER_SLOT.length)}, from ${g.projects} projects:`, ...shown.map((c, i) => `${i + 1}. (project ${nameOf(c.project_id)}) ${c.text}`)].join("\n");
      const got = parseJson(await this.#ask(ctx, "everywhere", { system: EVERYWHERE_PROMPT, user }));
      if (!got || typeof got !== "object") {
        ctx.errors.everywhere = "the model answered no JSON";
        continue;
      }
      const at = (/** @type {any} */ v) => {
        const n = Number(v);
        return Number.isInteger(n) && n >= 1 ? (shown[n - 1] ?? null) : null;
      };
      const pick = at(got.keep);
      // What it would replace: the pick and the shown claims the model says the same as it — never one it was not shown,
      // nor one that says otherwise or more.
      const from = pick ? [...new Set([pick.id, ...(Array.isArray(got.same) ? got.same : []).map(at).filter(Boolean).map((/** @type {any} */ c) => c.id)])] : [];
      const q = pick
        ? this.archive.inbox.add({
            projectId: null,
            kind: "everywhere",
            key: `everywhere:${g.slot}=${slotNorm(pick.slot_value || pick.text)}`,
            // The claim it would keep (`pick`): retired meanwhile, the question is withdrawn (archive `inbox.about`).
            itemIds: [pick.id],
            proposal: { action: "everywhere", kind: pick.kind, text: pick.text, slot: g.slot, value: pick.slot_value ?? null, multi: !!pick.slot_multi, pick: pick.id, from, projects: g.projects },
            reason: `learned in ${g.projects} projects: ${clip(String(got.why || "").trim(), 200)}`,
            run: ctx.run,
          })
        : null;
      if (q?.raised) raised++;
      // The rest were judged with it — all of them where no question was raised (none picked, or a value asked before):
      // kept last, so the newest judged are the last let go.
      for (const c of g.claims)
        if (!q?.raised || !from.includes(c.id)) {
          none.delete(c.id);
          none.add(c.id);
        }
    }
    if (none.size) this.archive.schemaMetaSet("curatorEverywhereNone", [...none].slice(-EVERYWHERE_NONE_KEPT));
    if (raised) ctx.steps.everywhereAsked = raised;
  }
  /**
   * What the dossier is written from (M4-7): the project's standing claims that clear the gate, at most `DOSSIER_CLAIMS`
   * by how sure, how important and how used (f3: `brain.dossierUse`'s weight), the user's own rules and the claims left
   * for going unused aside (`unused`: how many), and its last five sessions' end states; and its `basis`
   * — those claims as a set and those sessions as the model reads them (the memory plan's f1), so claims ranked anew
   * among the same and a learning run that left a summary as it was write no version. Null with nothing to write it
   * from. @param {any} ctx
   */
  #dossierSource(ctx) {
    const own = new Set([...this.archive.items.usersWord(ctx.projectId, [...STANDING]).rows()].map((/** @type {any} */ r) => r.id));
    const cands = this.#standing(ctx).filter((/** @type {any} */ it) => it.project_id === ctx.projectId && !own.has(it.id));
    const counts = this.archive.items.eventCounts(cands.map((/** @type {any} */ c) => c.id));
    const pitfall = new Set(cands.filter((/** @type {any} */ c) => this.archive.triggers.of(c.id).length > 0).map((/** @type {any} */ c) => c.id));
    const use = this.brain.dossierUse(cands, (it) => pitfall.has(it.id));
    const sure = cands
      .map((/** @type {any} */ c) => {
        const f = this.brain.filesOf(c);
        const rec = { ...(counts.get(c.id) || {}), changed: f?.worst.state === "changed" };
        const u = use.get(c.id);
        return { c, held: f?.worst.state === "gone" || f?.worst.state === "symbol", sure: confidenceOf(c, rec, this.now()), ev: rec.evidence || 0, pitfall: pitfall.has(c.id), weight: u?.weight ?? 1, unused: !!u?.unused };
      })
      .filter((x) => !x.held && x.sure >= CONFIDENCE_GATE);
    const score = (/** @type {any} */ x) => x.sure * (Number(x.c.importance) || 0.6) * x.weight;
    // The 80 given, the unused passed over; `unused`: those passed over that would have been among them.
    const claims = [];
    let unused = 0;
    for (const x of sure.sort((x, y) => score(y) - score(x) || x.c.id - y.c.id)) {
      if (claims.length >= DOSSIER_CLAIMS) break;
      if (x.unused) unused++;
      else claims.push(x);
    }
    // A chat Memory settings leave out is read for no other (brain.js `keptToItself`), nor one every turn of which was
    // kept apart: its end state is none of this. The learner read no turn kept apart, so an end state holds none.
    const sessions = this.archive
      .chainsForProject(ctx.projectId, { limit: 5, kinds: LISTED_KINDS })
      .map((/** @type {any} */ c) => ({ c, st: c.state_json ? safeJson(c.state_json) : null }))
      .filter((/** @type {any} */ x) => x.st?.summary && !this.brain?.keptToItself?.(x.c.id));
    if (!claims.length && !sessions.length) return null;
    const basis = sha1(
      JSON.stringify([
        claims.map((x) => x.c.id).sort((a, b) => a - b),
        sessions.map((/** @type {any} */ x) => `${x.c.id} ${sha1(sessionText(x.c, x.st))}`).sort(),
      ]),
    );
    return { claims, sessions, basis, unused };
  }
  /**
   * M4-7: the project's dossier, written by the model from its standing claims (the user's own rules aside: the
   * briefing shows them first) and its sessions' end states, grounded line by line. Written again only when what it is
   * written from moved; with no call left for it, owed to the next pass (f1).
   */
  async #dossier(/** @type {any} */ ctx) {
    const src = this.#dossierSource(ctx);
    if (!src) {
      ctx.steps.dossier = "nothing to write it from";
      return;
    }
    const { claims, sessions, basis, unused } = src;
    if (unused) ctx.steps.dossierUnused = unused;
    const last = this.archive.dossiers.latest(ctx.projectId);
    if (last?.basis === basis) {
      ctx.steps.dossier = `v${last.version} unchanged`;
      return;
    }
    if (this.#left(ctx, "dossier") <= 0) {
      ctx.stopped ??= this.#budgetWords(ctx);
      ctx.steps.dossier = "owed: no call left to write it, so the next pass is due";
      ctx.steps.dossierOwed = true;
      return;
    }
    /** @type {Map<string, string>} */
    const sources = new Map();
    // A procedure is given by its goal and step count (M5-6), and a line may say both.
    for (const x of claims) sources.set(itemRef(x.c.id), x.c.kind === "procedure" ? `${procedureHead(x.c.text)} ${x.c.text}` : x.c.text);
    for (const x of sessions) sources.set(`s:${x.c.id}`, sessionText(x.c, x.st));
    const project = this.archive.getProject(ctx.projectId);
    const user = [
      `Project: ${project?.name || ctx.projectId}${project?.cwd ? ` (${project.cwd})` : ""}`,
      "",
      "Claims:",
      ...claims.map((x) => `${itemRef(x.c.id)} [${x.c.kind} · ${trustOf(x.c)}${x.ev ? ` · ✓${x.ev + 1}` : ""}${x.pitfall ? " · pitfall" : ""}] ${x.c.kind === "procedure" ? procedureHead(x.c.text) : clip(x.c.text, 300)}`),
      "",
      "Sessions, newest first:",
      ...sessions.map((/** @type {any} */ x) => `s:${x.c.id} ${sessionText(x.c, x.st)}`),
    ].join("\n");
    const got = parseJson(await this.#ask(ctx, "dossier", { system: DOSSIER_PROMPT, user }));
    if (!got || !Array.isArray(got.sections)) {
      ctx.errors.dossier = "the model answered no JSON";
      return;
    }
    const d = groundDossier(got.sections, sources);
    ctx.steps.dossierDropped = d.dropped;
    if (!d.sections.length) {
      ctx.steps.dossier = "no line was grounded in its cites";
      return;
    }
    const v = this.archive.dossiers.add({ projectId: ctx.projectId, sections: d.sections, cites: d.cites, basis, model: ctx.model, run: ctx.run });
    ctx.steps.dossier = `v${v.version}`;
  }
  /**
   * The project's topics (the memory plan's f7), by rule: its standing claims memory is sure of (not an open thread,
   * which is the project's work, nor one whose file or symbol is gone) grouped by the thing their slot names — a
   * component, not the project itself, the user or a procedure's goal — and by the folder in the project of each file
   * they name (not its top folder: that is the project, which the dossier is about). Each of PAGE_MIN_CLAIMS claims or
   * more, with its PAGE_CLAIMS surest and most important (`claims`), those claims with a hash of their words
   * (`sources`) and its `basis`. @param {any} ctx
   */
  #topics(ctx) {
    const cands = this.#standing(ctx).filter((/** @type {any} */ it) => it.project_id === ctx.projectId && it.kind !== "thread");
    const counts = this.archive.items.eventCounts(cands.map((/** @type {any} */ c) => c.id));
    const root = ctx.root ? String(ctx.root).replace(/\\/g, "/").replace(/\/+$/, "") : null;
    const fold = (/** @type {string} */ p) => (process.platform === "win32" ? p.toLowerCase() : p);
    /** @type {Map<string, { topic: string, title: string, claims: { c: any, score: number, ev: number, pitfall: boolean }[] }>} */
    const groups = new Map();
    const join = (/** @type {string} */ topic, /** @type {string} */ title, /** @type {any} */ x) => {
      let g = groups.get(topic);
      if (!g) groups.set(topic, (g = { topic, title, claims: [] }));
      g.claims.push(x);
    };
    for (const c of cands) {
      const f = this.brain.filesOf(c);
      if (f?.worst.state === "gone" || f?.worst.state === "symbol") continue;
      const rec = { ...(counts.get(c.id) || {}), changed: f?.worst.state === "changed" };
      const sure = confidenceOf(c, rec, this.now());
      if (sure < CONFIDENCE_GATE) continue;
      const x = { c, score: sure * (Number(c.importance) || 0.6), ev: rec.evidence || 0, pitfall: this.archive.triggers.of(c.id).length > 0 };
      const subject = c.slot && c.kind !== "procedure" && !aboutUser(c.slot) ? String(c.slot).split(" · ")[0] : "";
      if (subject && subject !== "project") join(`about:${subject}`, subject, x);
      /** @type {Set<string>} */
      const dirs = new Set();
      for (const a of f?.anchors || []) {
        const p = String(a.path || "").replace(/\\/g, "/");
        if (!root || !fold(p).startsWith(`${fold(root)}/`)) continue;
        const rel = p.slice(root.length + 1).replace(/\/+$/, "");
        const dir = a.kind === "folder" ? rel : rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        if (dir) dirs.add(dir);
      }
      for (const dir of dirs) join(`dir:${dir}`, dir, x);
    }
    return [...groups.values()]
      .filter((g) => g.claims.length >= PAGE_MIN_CLAIMS)
      .map((g) => {
        const claims = g.claims.sort((a, b) => b.score - a.score || a.c.id - b.c.id).slice(0, PAGE_CLAIMS);
        const sources = claims.map((x) => pageSource(x.c)).sort((a, b) => a[0] - b[0]);
        return { ...g, size: g.claims.length, claims, sources, basis: sha1(JSON.stringify(sources)) };
      });
  }
  /**
   * The memory plan's f7: one topic of the project gets its page a pass — a topic with no page first, the larger first;
   * else the one whose claims moved most since its page was written (claims in or out, or their words changed), once a
   * third of them moved (PAGE_REWRITE) — written by the model from those claims, grounded line by line as the dossier
   * is (`groundDossier`) and kept to its caps (`capPage`). A topic whose page came to nothing is asked again only once
   * it moves (`curatorPagesNone`, by project and topic); one the model answered no JSON for, next pass. Pages are read,
   * never learned from: nothing makes a claim of one.
   */
  async #page(/** @type {any} */ ctx) {
    // No call left: the topics are not read for nothing.
    if (!this.#room(ctx, "page")) {
      ctx.steps.page = "owed: no call left to write a page";
      return;
    }
    const topics = this.#topics(ctx);
    if (!topics.length) {
      ctx.steps.page = `no topic of ${PAGE_MIN_CLAIMS} claims or more`;
      return;
    }
    const none = /** @type {Record<string, string>} */ (this.archive.schemaMetaGet("curatorPagesNone") || {});
    const moved = (/** @type {[number, string][]} */ was, /** @type {[number, string][]} */ now) => {
      const left = new Map(was.map(([id, h]) => [Number(id), h]));
      let n = 0;
      for (const [id, h] of now) {
        if (left.get(id) !== h) n++;
        left.delete(id);
      }
      return n + left.size;
    };
    const noneKey = (/** @type {string} */ topic) => `${ctx.projectId}:${topic}`;
    /** @type {any} */
    let pick = null;
    /** @type {[number, number, number]} */
    let best = [0, 0, 0];
    for (const t of topics) {
      const last = this.archive.pages.latest(ctx.projectId, t.topic);
      if (last?.basis === t.basis || none[noneKey(t.topic)] === t.basis) continue;
      const m = last ? moved(last.sources, t.sources) : t.claims.length;
      if (last && m < last.sources.length * PAGE_REWRITE) continue;
      // A topic with no page, then the most moved, then the larger, then by name.
      /** @type {[number, number, number]} */
      const rank = [last ? 0 : 1, m, t.size];
      const c = pick ? rank[0] - best[0] || rank[1] - best[1] || rank[2] - best[2] : 1;
      if (c > 0 || (c === 0 && t.topic < pick.topic)) {
        pick = t;
        best = rank;
      }
    }
    if (!pick) {
      ctx.steps.page = "every topic's page stands";
      return;
    }
    /** @type {Map<string, string>} */
    const sources = new Map();
    for (const x of pick.claims) sources.set(itemRef(x.c.id), x.c.kind === "procedure" ? `${procedureHead(x.c.text)} ${x.c.text}` : x.c.text);
    const project = this.archive.getProject(ctx.projectId);
    const user = [
      `Project: ${project?.name || ctx.projectId}`,
      `Topic: ${pick.topic.startsWith("dir:") ? `the files in ${pick.title}/` : pick.title}`,
      "",
      "Claims:",
      ...pick.claims.map((x) => `${itemRef(x.c.id)} [${x.c.kind} · ${trustOf(x.c)}${x.ev ? ` · ✓${x.ev + 1}` : ""}${x.pitfall ? " · pitfall" : ""}] ${x.c.kind === "procedure" ? procedureHead(x.c.text) : clip(x.c.text, 300)}`),
    ].join("\n");
    const got = parseJson(await this.#ask(ctx, "page", { system: PAGE_PROMPT, user }));
    const grounded = got && Array.isArray(got.sections) ? groundDossier(got.sections, sources, PAGE_SECTIONS) : null;
    const d = grounded ? capPage(grounded.sections, new Map(pick.claims.map((x) => [x.c.id, String(x.c.text)]))) : null;
    if (grounded) ctx.steps.pageDropped = grounded.dropped + (d?.dropped || 0);
    if (!grounded) {
      // A cut or broken answer is no verdict on the topic: asked again next pass.
      ctx.errors.page = "the model answered no JSON";
      ctx.steps.page = `"${pick.title}": no page`;
      return;
    }
    if (!d) {
      // Kept with its basis, by project and topic: asked again once its claims move. The newest kept, a topic once.
      delete none[noneKey(pick.topic)];
      none[noneKey(pick.topic)] = pick.basis;
      const keys = Object.keys(none);
      for (const k of keys.slice(0, Math.max(0, keys.length - PAGE_NONE_KEPT))) delete none[k];
      this.archive.schemaMetaSet("curatorPagesNone", none);
      ctx.steps.page = `"${pick.title}": no page of ${PAGE_MIN_CLAIMS} claims or more was grounded in its cites and its caps`;
      return;
    }
    const slug = this.archive.pages.slugFor(ctx.projectId, pick.topic, slugOf(pick.title));
    const v = this.archive.pages.add({ projectId: ctx.projectId, topic: pick.topic, slug, title: pick.title, sections: d.sections, cites: d.cites, sources: pick.sources, basis: pick.basis, model: ctx.model, run: ctx.run });
    ctx.steps.page = `page:${slug} v${v.version}`;
  }
}

/** Lists of terms taken in turn, one of each list at a time, each term once: every note's words get a place. @param {string[][]} lists */
function interleaved(lists) {
  /** @type {string[]} */
  const out = [];
  for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (k < l.length && !out.includes(l[k])) out.push(l[k]);
  return out;
}
/**
 * A turn's calls with what each returned, in any wire shape the archive keeps (Anthropic blocks, OpenAI `tool_calls`
 * and role `tool`, Responses items), oldest first: each call's name, its input as text, its result's text, and whether
 * its result said it failed (Anthropic's `is_error`).
 * @param {any[]} work @returns {{ name: string, input: string, result: string, failed: boolean }[]}
 */
function callsWithResults(work) {
  /** @type {{ name: string, input: string, result: string, failed: boolean }[]} */
  const order = [];
  /** @type {Map<string, { name: string, input: string, result: string, failed: boolean }>} */
  const byId = new Map();
  const add = (/** @type {unknown} */ id, /** @type {unknown} */ name, /** @type {unknown} */ input) => {
    const c = { name: String(name || "?"), input: typeof input === "string" ? input : JSON.stringify(input ?? {}), result: "", failed: false };
    order.push(c);
    if (id != null) byId.set(String(id), c);
  };
  const answer = (/** @type {unknown} */ id, /** @type {any} */ content, failed = false) => {
    const c = byId.get(String(id));
    if (!c) return;
    c.result += textOfMessage(content);
    if (failed) c.failed = true;
  };
  for (const m of Array.isArray(work) ? work : []) {
    if (m?.type === "function_call") add(m.call_id, m.name, m.arguments);
    else if (m?.type === "function_call_output") answer(m.call_id, m.output);
    else if (m?.role === "tool") answer(m.tool_call_id, m.content);
    for (const c of Array.isArray(m?.tool_calls) ? m.tool_calls : []) add(c?.id, c?.function?.name, c?.function?.arguments);
    for (const b of Array.isArray(m?.content) ? m.content : []) {
      if (b?.type === "tool_use") add(b.id, b.name, b.input);
      else if (b?.type === "tool_result") answer(b.tool_use_id, b.content, !!b.is_error);
    }
  }
  return order;
}
/** @param {string} s */
function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
/**
 * A session as the dossier reads it: its title, when, and its summary. Not what it left open or next (M7-D66): its end
 * state is frozen when it is learned, and that work lives on as open threads, which close. No title a turn kept apart
 * named (`meta.namedApart`, brain.js `titleFor`): the dossier rides every chat's briefing.
 * @param {any} c @param {any} st
 */
function sessionText(c, st) {
  const title = c.meta?.namedApart ? null : c.title;
  return [title ? `"${clip(title, 60)}"` : "untitled", dateOf(c.last_at || c.started_at), clip(st?.summary || "", 240)]
    .filter(Boolean)
    .join(" — ");
}
/** A pass's detail for the op log: numbers and short words only, never a claim's text. @param {Record<string, any>} d */
function countsOnly(d) {
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "number" || (typeof v === "string" && k !== "errors" && v.length <= 60)) out[k] = v;
  return out;
}

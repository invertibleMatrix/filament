// Learning at boundaries (docs/memory-architecture.md §9): when a session compacts, goes idle, or is asked to, the
// cheap model reads the turns since the last boundary, in passes oldest first with each turn's calls, and returns a
// title, an end state (summary, done, and the open threads: open, next) and typed items (decision, rule, convention,
// preference, fact, procedure), each with the slot it gives a value of when it has one (a procedure's is its goal's),
// the turns whose person pushed back on the reply before (`corrected`), and its judgement of the claims memory showed the
// session (`contradicted`, `held`: the memory plan's d4). The session's cursor moves past each pass that lands, never past a turn no pass read (HarnessV3-Memory M7-D28).
// The brain files each against the record (HarnessV3-Memory M2-5): what is on file already is
// evidence for it, a new value in a slot replaces the old one, and the rest is a new claim, `inferred` until confirmed,
// mirrored to the engine with turn pointers, and capped per day. A run that filed something queues the curator's pass
// over the project (curator.js), which keeps it one claim a fact and writes the project's dossier. The engine is never
// asked to consolidate on its own: what it wrote that way is not Filament's to serve (HarnessV3-Memory MD-0). The cheap
// model is called through Filament's own front door, so its cost is visible in Usage and its requests are never captured
// (`x-filament-memory: off`).
import { clip, looksLikeCode } from "../../core/text.js";
import { slotOf } from "./slots.js";
import { asProcedure, procedureSlot } from "./procedures.js";
import { tokensForChars } from "../../core/tokens.js";
import { redactSecrets } from "../../core/redact.js";
import { callsRead, textOfMessage } from "../../core/messages.js";
import { wordsOfMessage } from "./brain.js";
import { apartTurn } from "./archive.js";
const KINDS = new Set(["decision", "rule", "convention", "preference", "fact", "procedure", "thread"]);
// What a sub-agent's report may file (HarnessV3-Memory M7-D18): what it found by reading or running. Never a rule, a
// preference or a decision (the user's word, M2-6), never a thread (its session keeps its own open work).
const FINDING_KINDS = new Set(["fact", "convention", "procedure"]);
// The most a report files, its most important first (the memory plan's d5: a finding was used by a third as many of the
// sessions shown it as a learned claim or the agent's own note, and findings were most of memory), and how much of its
// exchange the model reads (M7-D18).
export const FINDINGS_MAX = 3;
const FINDINGS_TASK_CHARS = 4000;
const FINDINGS_REPORT_CHARS = 16000;
const FINDINGS_CALLS = 40;
// How a learning run reads a session (HarnessV3-Memory M7-D28, M7-D29): in passes, oldest first, each at most this many
// tokens and turns; a turn longer than a pass keeps both ends of this many characters, and the newest of its calls;
// the passes one run reads before it leaves the rest for the session's next boundary; the output a pass is priced at
// when a learning model is chosen (app/models.js) — a guess, never a cap (HarnessV3-FailurePoints §13).
export const PASS_TOKENS = 12_000;
export const PASS_TURNS = 16;
export const TURN_CHARS = 24_000;
const TURN_CALLS = 40;
export const MAX_PASSES = 12;
export const LEARN_OUTPUT_TOKENS = 3_000;
// A secret's shape: no learning run files one.
const SECRET = /\b(sk-[a-z0-9]{8,}|bearer [a-z0-9._-]{16,}|api[_ -]?key\s*[:=]\s*\S{8,}|password\s*[:=])/i;
const dayKey = (t) => new Date(t).toISOString().slice(0, 10);
/**
 * The project's open threads as the learner's model reads them, after the session's words (HarnessV3-Memory M5-5): by
 * id, so it can say which the session finished or worked on. "" for none.
 * @param {{ id: string, text: string }[]} shown
 */
const threadList = (shown) =>
  shown.length ? `\n\nThe project's open threads, said in earlier sessions or earlier in this one (by id):\n${shown.map((t) => `- ${t.id}: ${clip(t.text, 200)}`).join("\n")}` : "";
/**
 * The goals of the project's procedures as the learner's model reads them (M5-6), so a session that did one again
 * files it under the same goal. "" for none.
 * @param {string[]} goals
 */
const goalList = (goals) => (goals.length ? `\n\nThe project's procedures, by goal: ${goals.map((g) => clip(g, 120)).join("; ")}.` : "");
/**
 * The claims memory showed the session, as the learner's model reads them (the memory plan's d4): by id, so it can say
 * which the session showed wrong and which it relied on and found true. "" for none.
 * @param {{ id: number, kind: string, text: string }[]} notes
 */
const noteList = (notes) =>
  notes.length ? `\n\nThe notes memory showed this session (by id):\n${notes.map((c) => `- i${c.id} (${c.kind}): ${clip(c.text, 200)}`).join("\n")}` : "";
/** How much of the reply before a pass's first turn its reading carries (d4): a correction answers the reply's end. */
export const REPLY_BEFORE_CHARS = 400;
// The importance of an open thread the learner files from the session's end state (M5-5).
const THREAD_IMPORTANCE = 0.6;
// ~4 characters per token. The learner never sees real usage — `callModel` returns text, not a token block — so this
// is an estimate of the size of what was handed to the model, and it is named `estTokens` everywhere so nobody reads
// it as a billed count. The billed numbers are on the child request records, correlated by chain since W9 Phase A.
const estTokens = tokensForChars;
// Truncate to a character cap keeping the beginning AND the end, with a marker for the middle. Cutting only the
// tail off would silently discard the newest material, which is what a learner most needs.
const bothEnds = (s, cap) => {
  const t = String(s ?? "");
  if (t.length <= cap) return t;
  const headLen = Math.floor(cap * 0.6),
    tailLen = cap - headLen;
  const dropped = t.length - headLen - tailLen;
  return `${t.slice(0, headLen)}\n[…${dropped.toLocaleString()} characters of the middle were left out to fit the model…]\n${t.slice(t.length - tailLen)}`;
};
/**
 * A learning run's reading in passes (HarnessV3-Memory M7-D28): the turns in order, each kept to TURN_CHARS (both ends),
 * grouped while a pass holds at most PASS_TOKENS and PASS_TURNS. A turn is never split, so a pass holds one at least.
 * @template {{ text: string }} T @param {T[]} turns @returns {T[][]}
 */
export function passesOf(turns) {
  /** @type {T[][]} */
  const passes = [];
  /** @type {T[]} */
  let pass = [];
  let tokens = 0;
  for (const turn of turns) {
    const t = { ...turn, text: bothEnds(turn.text, TURN_CHARS) };
    const cost = estTokens(t.text.length);
    if (pass.length && (tokens + cost > PASS_TOKENS || pass.length >= PASS_TURNS)) {
      passes.push(pass);
      pass = [];
      tokens = 0;
    }
    pass.push(t);
    tokens += cost;
  }
  if (pass.length) passes.push(pass);
  return passes;
}

export const LEARN_PROMPT = `You extract durable knowledge from a coding session between a user and an AI assistant. Later sessions with this user start from what memory holds: keep there what they could not re-read from the code or git — the user's rules, corrections and decisions with their reason, and the pitfalls the session hit. Return ONLY a JSON object:
{"title": "3-8 word title of the session",
 "state": {"summary": "1-2 sentences: what the session was about and where it ended", "done": ["short completed items"], "open": ["unfinished work or an unanswered question a later session should pick up: one self-contained sentence, naming the file it concerns when there is one"], "next": ["what the user or assistant said would come next, in the same form"], "closed": [{"id": "the id of a listed open thread", "because": "what in this session finished it"}], "still": ["the id of a listed open thread this session worked on that is still unfinished"]},
 "turns": [{"n": <turn number>, "summary": "one line: what the user asked and what happened"}],
 "items": [{"kind": "decision|rule|convention|preference|fact|procedure", "text": "one or two sentences, self-contained, present tense (a procedure: How to <goal>: 1. <step> 2. <step>)", "importance": 0.0-1.0, "turn": <turn number>, "slot": {"subject": "what it is about", "attribute": "what about it", "value": "its value as said", "multi": false}}],
 "corrected": [<turn number>],
 "contradicted": [{"id": "i12", "turn": <turn number>, "why": "one sentence: what in the session shows the note wrong"}],
 "held": ["i12"]}
Rules for items: only things that will still matter in future sessions: decisions and their reason, rules and corrections the user gave the assistant, conventions of the project (commands, layout, style), stable facts about the user or the project, preferences, procedures. Unfinished work goes in state.open, not in items. No transient task steps, no file contents, no secrets or tokens, no restating the code. Prefer fewer, better items (0 to 8). Corrections from the user are rules with importance 0.9. Empty arrays are fine.
Rules for whose words: a rule, a correction or a preference is the user's only when the user said it, in a line that starts "User:". What the tool the session ran in set for it is not theirs: its permission mode (a read-only session), a rule or a limit of the session, a tool that is switched off, an output style, the model or route it runs on. Never file one of those as an item of any kind — not from a notice said to be Filament's, not from a call marked failed, not from the assistant saying what it may not do here.
Rules for calls: a turn may list the calls the assistant made, oldest first, a failed one marked. A procedure's steps and a convention's command are calls that worked; a call marked failed proves only that it failed. The calls are the assistant's, never the user's words.
Rules for the end state: the session may come with what its earlier turns established ("The session so far"). Then the summary, done, open and next are the whole session's as it stands after the turns you read, not only theirs.
Rules for slots: give an item a slot only when it states the current value of one thing, so a later value can replace it. subject: "project" for the project itself, "user" for the user, else the component's name; attribute: a short noun phrase ("package manager", "deploy region", "test command"); value: the value alone ("bun", "eu-west-2", "npm test"). multi: true only when the thing holds several values at once (languages the user writes). Leave the slot out of anything else.
Rules for procedures: when the session carried out a multi-step task that worked and is likely to be done again in this project (a release, a deploy, a migration, a setup, a way to run or debug something), file it as one procedure: "How to <goal>: 1. <step> 2. <step>", the goal in the words a user would ask for it with, each step the exact command or action that worked (never one that failed), in order, at most 12 steps, no slot. Not for a one-off task or a single command (that is a convention). The session may come with the goals of the project's procedures: one it carried out again is filed under that same goal, with its steps as they were done this time.
Rules for threads: the session may come with the project's open threads, by id (i12). Put in state.closed only a listed thread this session finished or made moot, saying what did it; in state.still a listed thread it worked on that is not finished. Never repeat a listed thread in state.open. With no list, closed and still are empty.
Rules for corrected: the numbers of the turns whose User: line pushes back on the assistant's reply just before it, in any language: says it was wrong, undoes it, or asks for it done another way. An answer to a question that reply asked, a new request or thanks is no correction. How the reply before the first turn you read ended may be given.
Rules for shown notes: the session may come with the notes memory showed it, by id (i12). In contradicted, a listed note the session showed to be wrong (the user said otherwise, or a call that worked proved otherwise), with the turn that shows it and why; in held, a listed note the session relied on and found true. Leave out a note the session did not bear on. With no list, both are empty.`;

export const FINDINGS_PROMPT = `A coding session had an AI assistant working in the same project do one task (a sub-agent it launched), and it has reported. You read its task, the calls it made and its report, and file what it established about the project. Later sessions in this project start from what memory holds: keep there only what they could not re-read from the code or git in a moment — a command that fails here and the way that works, a place or a behaviour the assistant had to search for, how the project is built, run or tested as its calls showed. Return ONLY a JSON object:
{"items": [{"kind": "fact|convention|procedure", "text": "one or two sentences, self-contained, present tense (a procedure: How to <goal>: 1. <step> 2. <step>)", "importance": 0.0-1.0, "slot": {"subject": "what it is about", "attribute": "what about it", "value": "its value as said", "multi": false}}]}
Rules for items: only what the assistant found to be so in this project by reading its files or running its commands, and what will still hold in a later session: where a thing is, how it works, how the project is built, run or tested, a command that fails here and the way that works. A convention is how this project does a thing (a command, a layout, a style). A procedure is a multi-step task the assistant carried out that worked and is likely to be done again: "How to <goal>: 1. <step> 2. <step>", each step the exact command or action that worked, at most 12 steps. A fact is anything else that holds. Never what its task asserted, what it guessed, planned, recommended or left to do, its own progress, or what the user wants: the assistant cannot speak for the user, so no rules, preferences or decisions. A call marked failed proves only that it failed. No secrets or tokens, no file contents, no restating the code, nothing a file says plainly where its name tells a later session to look. At most 3 items, the ones a later session would miss most; an empty list is fine.
Rules for slots: give an item a slot only when it states the current value of one thing, so a later value can replace it. subject: "project" for the project itself, else the component's name; attribute: a short noun phrase ("package manager", "test command"); value: the value alone ("pnpm", "npm test"). multi: true only when the thing holds several values at once. Leave the slot out of anything else. The project's procedures may come by goal: one the assistant carried out again is filed under that same goal.`;

/**
 * What the learning model reads of a sub-agent's exchange (M7-D18): who it is, its task, the calls it made (the newest
 * `FINDINGS_CALLS`, a failed one marked) and its report (both ends), then the project's procedure goals. Secrets are
 * redacted before anything leaves.
 * @param {import("./observe.js").SubagentReport} e @param {string} project @param {string[]} goals
 */
const findingsText = (e, project, goals) => {
  const all = Array.isArray(e.calls) ? e.calls : [];
  const calls = callsRead(all, FINDINGS_CALLS);
  const text = [
    `Project: ${project}. Sub-agent ${e.id} (${e.agentType || "general"}, on ${e.model || "an unnamed model"}) of session ${e.chain}.`,
    "",
    "Its task:",
    clip(String(e.task ?? ""), FINDINGS_TASK_CHARS),
    "",
    all.length ? `The calls it made, oldest first (${calls.count}):` : "It made no calls.",
    ...calls.lines,
    "",
    "Its report:",
    bothEnds(String(e.report ?? ""), FINDINGS_REPORT_CHARS),
  ].join("\n");
  return redactSecrets(text) + goalList(goals);
};

/**
 * Why the learner may not read a chain, or null when it may: the session opted out (`meta.noLearn`, the mirror of
 * `memory.learn` / `privacy.learn`), memory is off for it (`meta.muted` — `@mem off`, or `memory.enabled` off; the
 * muted state promises nothing is learned), or Memory settings keep its turns its own alone (`leftOut`, in their
 * words: memory brain's `turnsAsideWhy` — the chat left out, or turn capture off in a chat Filament composes) — its
 * turns are kept as its own record, and read by nothing of memory's. One rule for every way in — the idle pass, a
 * compaction, a forced run, a sub-agent's report — and for the trace that says whether learning was queued at all.
 * @param {any} meta  the chain's meta @param {string | null} [leftOut]
 * @returns {string | null}
 */
export function learningOptOut(meta, leftOut = null) {
  if (meta?.noLearn) return "the session opted out of learning (memory.learn or privacy.learn is off)";
  if (meta?.muted) return "memory is off for this chat (@mem off, or memory.enabled off): nothing is learned from it";
  if (leftOut) return `${leftOut}: nothing is learned from this chat`;
  return null;
}
/**
 * The keys of a chain's meta `learningOptOut` reads: a caller with no meta in hand reads these alone (the archive's
 * `metaOf`), not the chain whole, whose meta grows with the chat.
 */
export const OPT_OUT_KEYS = Object.freeze(["noLearn", "muted"]);

/** A run's short reasons for leaving its session unread, as a person reads them. */
const UNREAD_WORDS = Object.freeze({
  "bad json": "the model did not answer in the form memory reads",
  "no model": "no model can read now",
  "no chain": "the session is gone",
  running: "memory was reading it already",
  "memory closed": "memory was closed",
});
/**
 * Why a learning run left its session unread, in words: a failure's own, a refusal's own, the short reasons put
 * plainly. Null when the run read it, or found nothing in it to read.
 * @param {any} r  what `learnChain` resolved with @returns {string | null}
 */
export function unreadWhy(r) {
  if (!r) return "the reader gave no answer";
  if (r.error) return String(r.error);
  if (!r.skipped || r.skipped === "nothing new") return null;
  return UNREAD_WORDS[/** @type {keyof typeof UNREAD_WORDS} */ (r.skipped)] || String(r.skipped);
}

export class MemoryLearner {
  /** The findings line (M7-D17): each sub-agent's report is read after the one before it. @type {Promise<any>} */
  #findingsLine = Promise.resolve();
  /** The learning runs going now, for `settled`. @type {Set<Promise<any>>} */
  #going = new Set();
  /** A compaction's run that came while a run was going on its session, to run once that one ends (M7-D30). @type {Map<string, { reason: string, door: string | null }>} */
  #again = new Map();
  /** Whether the learning model has answered JSON since this learner started: only then is a span it cannot answer the span's fault (M7-D28). */
  #answered = false;
  /** Whether memory closed this learner (M7-D70), and the stop its model calls hear. */
  #closed = false;
  #life = new AbortController();
  // callModel: async ({ system, user }) => text. brain: files each learned item against the record and
  // queues its engine copy (HarnessV3-Memory M2-5). model: (chainId) => the model memory learns that chat with ("" for
  // none, the memory plan's m1), or null when the caller does not say (callModel then answers for itself). whyNoModel:
  // (chainId) => why `model` names none, in words.
  constructor({
    archive,
    brain = null,
    callModel,
    model = null,
    whyNoModel = () => "no learning model",
    getConfig = () => ({}),
    log = () => {},
    now = () => Date.now(),
  } = {}) {
    Object.assign(this, { archive, brain, callModel, model, whyNoModel, getConfig, log, now });
    this.pending = new Set();
    this.running = new Set();
    this.daily = { day: dayKey(now()), count: 0 };
    this.timer = null;
    this.stats = { runs: 0, items: 0, skipped: 0, errors: 0, lastRun: null, lastError: null };
    this.recent = []; // the last runs, for the dashboard: { at, chain, reason, ms, modelCalls, items, dedupedItems, turns, title, state, skipped, error }
  }
  cfg() {
    const m = this.getConfig() || {};
    return {
      learn: m.capture?.learn !== false,
      idleMinutes: Number(m.capture?.idleMinutes) || 30,
      dailyCap: Number(m.capture?.dailyCap) || 200,
    };
  }
  // Learning runs as durable operations, injected through MemoryService as `learner.onOp` — the same pattern as
  // `memory.onJobEvent` and `bridge.onOp`, so this module never imports the op log and keeps working with
  // observability off. `recent` is in-RAM and rolls over at 100 runs, so "what did the learner do last Tuesday, and
  // why did it write nothing" has no other answer anywhere.
  #op(title, opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break a learning run */
    }
  }

  // One end operation per run, built from the SAME row the dashboard's Activity list shows, so the durable log and the
  // in-RAM feed can never disagree about what happened. The detail is assembled field by field rather than spread from
  // the result, and that is load-bearing: a learning run's result still carries the session's end-state SUMMARY TEXT
  // and its title, and ops.jsonl is durable and shown in the UI. Spreading it would put conversation content into a file
  // that is kept for weeks. Counts and booleans only.
  // `from`: what the run read, when it is not the session's turns (a sub-agent's report, M7-D21).
  #opEnd(row, chainId, reason, extra = null, from = null) {
    const skipped = row?.skipped || null;
    const error = row?.error ? String(row.error).slice(0, 160) : null;
    const items = Number(row?.items) || 0;
    const sub = error ? "error" : skipped ? "skip" : "done";
    const what = from || `session ${chainId}`;
    const title = error
      ? `learning from ${what} failed: ${error}`
      : skipped
        ? `learning from ${what} skipped — ${skipped}`
        : `learned from ${from || `session ${chainId} (${reason})`}: ${items} note${items === 1 ? "" : "s"}`;
    this.#op(title, {
      sub,
      level: error ? "error" : "info",
      ms: typeof row?.ms === "number" ? row.ms : null,
      detail: {
        reason,
        chain: chainId,
        modelCalls: Number(row?.modelCalls) || 0,
        items,
        deduped: Number(row?.dedupedItems) || 0,
        turnSummaries: Number(row?.turns) || 0,
        titled: !!row?.title,
        state: !!row?.state,
        capped: !!row?.capped,
        // Whether the session's cursor moved. A capped run deliberately leaves the chain for the next pass, and a
        // skipped or failed one never had anything to advance — the difference between "learned nothing" and
        // "learned nothing and will not try again" is the whole diagnosis.
        advanced: !skipped && !error && !row?.capped,
        // BILLED tokens when the model reported them — the start op's estTokens is a prompt-size estimate; these are
        // what the run actually cost. Absent (not zero) when no usage came back, so the two can never be confused.
        ...(row?.tokensIn != null
          ? { tokensIn: Number(row.tokensIn), tokensOut: Number(row.tokensOut) || 0 }
          : {}),
        skipped,
        error,
        ...(extra || {}),
      },
      ref: { chainId },
    });
  }

  // A run filed what it learned: the curator hears of it (`onLearned`, set by the service), and queues its pass over the
  // project. A hook that throws must not fail the run that already wrote.
  #learned(projectId) {
    try {
      this.onLearned?.(projectId);
    } catch (e) {
      this.log("warn", `memory: the curator could not be told of a learning run (${e.message})`);
    }
  }

  // ---- scheduling ----
  start(intervalMs = 60_000) {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(
      () => this.tick().catch((e) => this.log("warn", `memory learning tick failed: ${e.message}`)),
      intervalMs,
    );
    this.timer.unref?.();
  }
  /**
   * Memory closes (M7-D70): the model calls going are stopped, and a run or a reading they belonged to ends "memory
   * closed", what landed before kept. A learner closed is never started again: memory builds a new one when it opens.
   */
  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.#closed = true;
    this.#life.abort();
  }
  note(chainId) {
    if (chainId) this.pending.add(chainId);
  } // a turn finished on this chain
  async tick() {
    const { learn, idleMinutes } = this.cfg();
    if (!learn || !this.archive) return;
    const cutoff = this.now() - idleMinutes * 60_000;
    for (const id of [...this.pending]) {
      if (this.#closed) return; // the sessions left wait for the learner memory builds when it opens
      // When it was last active is all the wait reads of a chat: not its row whole, every minute, for each one waiting.
      const lastAt = this.archive.lastAt(id);
      if (lastAt == null) {
        this.pending.delete(id);
        continue;
      }
      if (lastAt <= cutoff) {
        this.pending.delete(id);
        await this.learnChain(id, { reason: "idle" });
      }
    }
  }

  // ---- learning one chain ----
  /**
   * A session's turns read and filed (HarnessV3-Memory M7-D28): the turns after its cursor (from turn 1 when forced), up
   * to the newest finished one when the run starts, each with its calls (M7-D29), in passes oldest first. The cursor
   * moves past each pass that lands, and never back. A run reads at most MAX_PASSES: with more left, the session is
   * noted for its next boundary. A compaction's run that comes while one is going on the session runs once that one
   * ends (M7-D30). Resolves with what the run did: its totals, or why it skipped or failed.
   * @param {string} chainId
   * @param {{ reason?: string, force?: boolean, uncapped?: boolean, door?: string | null }} [o]
   * @returns {Promise<any>}
   */
  learnChain(chainId, { reason = "manual", force = false, uncapped = false, door = null } = {}) {
    if (this.running.has(chainId)) {
      if (reason !== "compaction") return Promise.resolve({ skipped: "running" });
      this.#again.set(chainId, { reason, door });
      return Promise.resolve({ skipped: "running", queued: true });
    }
    this.running.add(chainId);
    const run = this.#learnChain(chainId, { reason, force, uncapped, door }).finally(() => {
      this.running.delete(chainId);
      this.#going.delete(run);
      const again = this.#again.get(chainId);
      if (again) {
        this.#again.delete(chainId);
        void this.learnChain(chainId, again);
      }
    });
    this.#going.add(run);
    return run;
  }
  /** learnChain's run, once the session is its own. @param {string} chainId @param {{ reason: string, force: boolean, uncapped: boolean, door: string | null }} o */
  async #learnChain(chainId, { reason, force, uncapped, door }) {
    const t0 = this.now();
    /** What the run did, pass by pass (#readSpan adds to it). */
    const run = {
      reason,
      uncapped,
      modelCalls: 0,
      billedIn: /** @type {number | null} */ (null),
      billedOut: /** @type {number | null} */ (null),
      passes: 0,
      items: 0,
      dedupedItems: 0,
      junk: 0,
      turns: 0,
      title: /** @type {string | null} */ (null),
      state: /** @type {any} */ (null),
      threads: /** @type {any} */ (null),
      capped: false,
      noJson: false,
      passedOver: /** @type {number[]} */ ([]),
      // The cursor when the run started, and where it stands now.
      cursor: 0,
      through: 0,
    };
    /** @param {any} a */
    const model = async (a) => {
      run.modelCalls++;
      const r = await this.callModel({ ...a, purpose: "learn", chainId, includeUsage: true, signal: this.#life.signal });
      if (typeof r === "string") return r; // a callModel that answers with the text alone: no usage to add
      run.modelCalls += Math.max(1, Number(r?.calls) || 1) - 1; // asked again with more room (M7-D69)
      if (r?.usage && (r.usage.input != null || r.usage.output != null)) {
        run.billedIn = (run.billedIn || 0) + (r.usage.input || 0);
        run.billedOut = (run.billedOut || 0) + (r.usage.output || 0);
      }
      return r?.text ?? "";
    };
    /** The run's Activity row, its end operation and the session's `lastLearn`, from what it did (`r`). @param {any} r */
    const done = (r) => {
      const advanced = run.through > run.cursor;
      const row = {
        at: new Date(this.now()).toISOString(),
        chain: chainId,
        reason,
        ...(door ? { door } : {}),
        ms: this.now() - t0,
        modelCalls: run.modelCalls,
        ...(run.billedIn != null ? { tokensIn: run.billedIn, tokensOut: run.billedOut } : {}),
        ...(r || {}),
      };
      this.recent.unshift(row);
      if (this.recent.length > 100) this.recent.pop();
      this.#opEnd(row, chainId, reason, {
        advanced,
        ...(door ? { door } : {}),
        ...(run.passes ? { passes: run.passes } : {}),
        ...(run.passedOver.length ? { passedOver: run.passedOver } : {}),
        ...(row.left ? { left: row.left } : {}),
      });
      try {
        if (this.archive.getChain(chainId))
          this.archive.mergeMeta(chainId, {
            lastLearn: {
              at: row.at,
              reason,
              ms: row.ms,
              modelCalls: run.modelCalls,
              items: row.items ?? 0,
              ...(run.passes ? { passes: run.passes } : {}),
              ...(advanced ? { through: run.through } : {}),
              ...(run.passedOver.length ? { passedOver: run.passedOver } : {}),
              ...(row.left ? { left: row.left } : {}),
              skipped: row.skipped,
              error: row.error ? String(row.error).slice(0, 120) : undefined,
            },
          });
      } catch {}
      return r;
    };
    /** What the passes did, for the caller (the end state and title as written). */
    const totals = () => ({
      title: run.title,
      state: run.state,
      turns: run.turns,
      items: run.items,
      dedupedItems: run.dedupedItems,
      junk: run.junk,
      reason,
      threads: run.threads,
      passes: run.passes,
      through: run.through,
      ...(run.passedOver.length ? { passedOver: run.passedOver } : {}),
      ...(run.capped ? { capped: true } : {}),
    });
    try {
      const ch = this.archive.getChain(chainId);
      if (!ch) return done({ skipped: "no chain" });
      // The session said no, memory is off for it, or Memory settings leave it out: not even a forced run reads it — the
      // flag is the developer's word, the force is the operator's.
      const optedOut = learningOptOut(ch.meta || {}, this.brain?.turnsAsideWhy?.(chainId) ?? null);
      if (optedOut) return done({ skipped: optedOut });
      run.cursor = run.through = Number(ch.meta?.learnedThrough) || 0;
      const reading = this.archive.turnsToRead(chainId, { fromTurn: force ? 1 : run.cursor + 1, calls: TURN_CALLS, words: wordsOfMessage });
      const turns = reading?.turns ?? [];
      if (!reading || !turns.length) {
        // Past the cursor, only turns no view carries (Filament's own answers, rewound ones): nothing to read in them.
        if (reading && reading.through > run.cursor) run.through = this.#advance(chainId, reading.through);
        return done({ skipped: "nothing new" });
      }
      if (!this.callModel || (this.model && !this.model(chainId))) return done({ skipped: "no model" });
      const passes = passesOf(turns);
      const now = passes.slice(0, MAX_PASSES);
      const left = passes.slice(MAX_PASSES).flat().length;
      const day = dayKey(this.now());
      if (this.daily.day !== day) this.daily = { day, count: 0 };
      const chars = now.flat().reduce((n, t) => n + t.text.length, 0);
      const first = now[0][0].n;
      const last = now[now.length - 1].at(-1)?.n ?? first;
      // Start is emitted only once the run is definitely going to call the model — after the "no chain", "nothing
      // new" and "no model" guards. A start op for a run that immediately skips would double every skip in the log and
      // bury the runs that actually did work.
      this.#op(`learning from session ${chainId} (${reason}): turns ${first}–${last}`, {
        sub: "start",
        detail: {
          reason,
          ...(door ? { door } : {}),
          chain: chainId,
          fromTurn: first,
          toTurn: last,
          passes: now.length,
          ...(left ? { left } : {}),
          chars,
          estTokens: estTokens(chars),
          dailyUsed: this.daily.count,
          dailyCap: this.cfg().dailyCap,
        },
        ref: { chainId },
      });
      let whole = true;
      for (const pass of now)
        if (!(await this.#readSpan(chainId, pass, run, model))) {
          whole = false;
          break;
        }
      // A model that has never answered JSON may be at fault rather than these turns: they are read again next time.
      if (run.noJson) return done({ skipped: "bad json" });
      if (whole && !left) run.through = this.#advance(chainId, reading.through);
      // The passes past this run's: the session's next boundary reads them.
      if (whole && left) this.note(chainId);
      this.#learned(ch.project_id);
      this.stats.runs++;
      this.stats.lastRun = new Date(this.now()).toISOString();
      this.log(
        "info",
        `memory: learned from session ${chainId} (${reason}): ${run.items} item${run.items === 1 ? "" : "s"} in ${run.passes} pass${run.passes === 1 ? "" : "es"}${run.title ? ", title set" : ""}${run.state ? ", end state" : ""}${left ? `; ${left} turn${left === 1 ? "" : "s"} left for the next run` : ""}`,
      );
      const out = { ...totals(), ...(left ? { left } : {}) };
      return done({ ...out, title: out.title ? true : undefined, state: out.state ? true : undefined }) && out;
    } catch (/** @type {any} */ e) {
      // What landed before the failure stays filed, the cursor past it; the rest is read next time.
      const out = totals();
      const said = { ...out, title: out.title ? true : undefined, state: out.state ? true : undefined };
      // Memory closed under the run, its call stopped (M7-D70): nothing went wrong.
      if (this.#closed) {
        done({ ...said, skipped: "memory closed" });
        return { ...out, skipped: "memory closed" };
      }
      this.stats.errors++;
      this.stats.lastError = e.message.slice(0, 200);
      this.log("warn", `memory: learning from ${chainId} failed: ${e.message.slice(0, 160)}`);
      done({ ...said, error: e.message });
      return { ...out, error: e.message };
    }
  }
  /**
   * One span of a run's turns read and filed (M7-D28): the model's JSON (one firmer retry), filed by `ingest`, and the
   * cursor moved to the span's last turn. A span the model cannot answer in JSON is split in two and each half read in
   * turn; a single turn it still cannot answer is passed over (`run.passedOver`, said in a warning) and the cursor moves
   * past it, so a session never sticks on it. Only a model that has answered JSON before splits or passes over: one
   * that never has may be the fault, so the run stops (`run.noJson`) and the turns wait. False when the run stops
   * before this span: the daily cap cut it, or no JSON. A model error rejects.
   * @param {string} chainId @param {{ n: number, id: number, startedAt: number | null, text: string }[]} span
   * @param {any} run @param {(a: any) => Promise<string>} model
   * @returns {Promise<boolean>}
   */
  async #readSpan(chainId, span, run, model) {
    // Read again for every span: an earlier one may have titled the session or moved its end state.
    const ch = this.archive.getChain(chainId);
    const first = span[0].n;
    const last = span[span.length - 1].n;
    const shown = this.brain?.openThreads(ch.project_id) ?? [];
    const goals = this.brain?.procedureGoals(ch.project_id) ?? [];
    const notes = this.brain?.shownClaims(chainId, { through: span[span.length - 1].id }) ?? [];
    const sofar = first > 1 && ch.state?.summary ? ` The session so far, as learned from its earlier turns: ${clip(ch.state.summary, 400)}` : "";
    const user = `Project: ${this.archive.getProject(ch.project_id)?.name || "unknown"}.${sofar} Session turns ${first} to ${last}:\n\n${redactSecrets(this.#replyBefore(chainId, span[0]) + span.map((t) => t.text).join("\n\n"))}${threadList(shown)}${goalList(goals)}${noteList(notes)}`;
    let parsed = parseJson(await model({ system: LEARN_PROMPT, user }));
    let retried = false;
    if (!parsed) {
      // one retry with a firmer instruction; small models sometimes answer in prose first
      retried = true;
      parsed = parseJson(await model({ system: LEARN_PROMPT, user: `Return ONLY the JSON object described, nothing else.\n\n${user}` }));
    }
    if (!parsed) {
      this.stats.errors++;
      this.stats.lastError = "model returned no JSON";
      if (!this.#answered) {
        run.noJson = true;
        return false;
      }
      if (span.length > 1) {
        const half = Math.ceil(span.length / 2);
        return (await this.#readSpan(chainId, span.slice(0, half), run, model)) && this.#readSpan(chainId, span.slice(half), run, model);
      }
      run.passedOver.push(first);
      run.through = this.#advance(chainId, first);
      this.#op(`session ${chainId}: turn ${first} passed over — the model answered it twice with no JSON`, {
        sub: "milestone",
        level: "warn",
        detail: { reason: run.reason, chain: chainId, fromTurn: first, toTurn: first, passedOver: true, modelCalls: run.modelCalls },
        ref: { chainId },
      });
      return true;
    }
    this.#answered = true;
    // Milestone: the model answered and its JSON parsed, before anything is written. This is where a run that
    // produces nothing becomes diagnosable — "the model proposed 0 items" and "the model proposed 6 and dedupe ate
    // all 6" end in the same `items: 0` row but are completely different problems.
    this.#op(`session ${chainId}: turns ${first}–${last}: the model proposed ${Array.isArray(parsed.items) ? parsed.items.length : 0} note(s)`, {
      sub: "milestone",
      detail: {
        reason: run.reason,
        chain: chainId,
        fromTurn: first,
        toTurn: last,
        proposed: Array.isArray(parsed.items) ? parsed.items.length : 0,
        turnSummaries: Array.isArray(parsed.turns) ? parsed.turns.length : 0,
        titled: !!parsed.title,
        state: !!parsed.state,
        retried,
        modelCalls: run.modelCalls,
      },
      ref: { chainId },
    });
    const out = await this.ingest(parsed, ch, chainId, { reason: run.reason, uncapped: run.uncapped, through: last, shown: shown.map((t) => t.id), notes: notes.map((c) => c.id), span });
    run.passes++;
    run.items += out.items;
    run.dedupedItems += out.dedupedItems;
    run.junk += out.junk;
    run.turns += out.turns;
    if (out.title) run.title = out.title;
    if (out.state) run.state = out.state;
    if (out.threads) run.threads = out.threads;
    if (out.capped) {
      run.capped = true;
      return false;
    }
    run.through = Math.max(run.through, out.through ?? 0);
    return true;
  }
  /**
   * How the assistant's reply before a pass's first turn ended (the memory plan's d4): its last `REPLY_BEFORE_CHARS`, so
   * a turn that pushes back on it reads as a correction at a pass's or a run's boundary too. "" for the session's first
   * turn, a reply with no words, or one kept apart (`apartTurn`: no summarizer is sent it).
   * @param {string} chainId @param {{ n: number, id: number }} turn
   */
  #replyBefore(chainId, turn) {
    const before = turn.n > 1 ? this.archive.turnBefore(chainId, turn.id) : null;
    if (!before || apartTurn(before)) return "";
    const said = before?.final_hash ? textOfMessage(this.archive.getMessage(before.final_hash)?.message).replace(/\s+/g, " ").trim() : "";
    return said ? `(How the assistant's reply before turn ${turn.n} ended: "${said.length > REPLY_BEFORE_CHARS ? "…" : ""}${said.slice(-REPLY_BEFORE_CHARS)}")\n\n` : "";
  }
  /** Move the session's cursor to turn `n`, never back (M7-D28); where it stands after. @param {string} chainId @param {number} n */
  #advance(chainId, n) {
    // Merged onto the meta as it is now: a goal that landed while the model read must not be written away.
    const at = Math.max(Number(this.archive.getChain(chainId)?.meta?.learnedThrough) || 0, n);
    this.archive.mergeMeta(chainId, { learnedThrough: at, learnedAt: this.now() });
    return at;
  }

  /**
   * A sub-agent's report, read on the learner's findings line (HarnessV3-Memory M7-D17): one at a time, in the order
   * they came; the bus hands it over and never waits. Resolves with what the reading did.
   * @param {import("./observe.js").SubagentReport} e
   */
  findings(e) {
    const run = this.#findingsLine.then(() => this.#readFindings(e));
    this.#findingsLine = run;
    return run;
  }
  /**
   * Resolves once every report handed over so far has been read and every learning run going has ended, a compaction's
   * run queued behind one included (M7-D30).
   */
  async settled() {
    for (;;) {
      await this.#findingsLine;
      if (!this.#going.size) return;
      await Promise.allSettled([...this.#going]);
    }
  }
  /**
   * One report read (M7-D18..D21): its task, its calls and its report go to the learning model, and what it established
   * is filed as its finder's (`fileLearned`: inferred, origin `subagent`, the finder named) in the session and on the
   * turn that launched the sub-agent. Nothing is filed where the session does not learn, with no learning model, or from
   * an empty report; the run's operation and its Activity row say why. Never rejects.
   * @param {import("./observe.js").SubagentReport} e
   */
  async #readFindings(e) {
    const t0 = this.now();
    const chainId = String(e?.chain ?? "");
    const reason = "subagent";
    const agent = e?.id ? String(e.id) : null;
    const from = `sub-agent ${agent ?? "?"}'s report (session ${chainId || "?"})`;
    let modelCalls = 0;
    /** @type {{ in: number, out: number } | null} */
    let billed = null;
    const counts = { items: 0, dedupedItems: 0, junk: 0, refused: 0, secrets: 0, over: 0 };
    /** @param {any} r */
    const end = (r) => {
      const row = { at: new Date(this.now()).toISOString(), chain: chainId, reason, agent, ms: this.now() - t0, modelCalls, ...(billed ? { tokensIn: billed.in, tokensOut: billed.out } : {}), ...r };
      this.recent.unshift(row);
      if (this.recent.length > 100) this.recent.pop();
      this.#opEnd(row, chainId, reason, { source: reason, agent, refused: row.refused || 0, junk: row.junk || 0, secrets: row.secrets || 0, ...(row.over ? { over: row.over } : {}), advanced: false }, from);
      return r;
    };
    try {
      const ch = chainId ? this.archive?.getChain(chainId) : null;
      if (!ch) return end({ skipped: "no chain" });
      if (!this.cfg().learn) return end({ skipped: "learning is off (memory.capture.learn)" });
      const optedOut = learningOptOut(ch.meta, this.brain?.turnsAsideWhy?.(chainId) ?? null);
      if (optedOut) return end({ skipped: optedOut });
      if (!this.callModel || (this.model && !this.model(chainId))) return end({ skipped: this.whyNoModel(chainId) });
      if (!String(e.report ?? "").trim()) return end({ skipped: "the report is empty" });
      const goals = this.brain?.procedureGoals(ch.project_id) ?? [];
      const user = findingsText(e, this.archive.getProject(ch.project_id)?.name || "unknown", goals);
      this.#op(`learning from ${from}`, {
        sub: "start",
        detail: { reason, chain: chainId, agent, calls: Array.isArray(e.calls) ? e.calls.length : 0, chars: user.length, estTokens: estTokens(user.length) },
        ref: { chainId },
      });
      /** @param {string} text */
      const ask = async (text) => {
        modelCalls++;
        const r = await this.callModel({ system: FINDINGS_PROMPT, user: text, purpose: "learn", chainId, includeUsage: true, signal: this.#life.signal });
        if (typeof r === "string") return r; // a callModel that answers with the text alone: no usage to add
        if (r?.usage && (r.usage.input != null || r.usage.output != null)) billed = { in: (billed?.in || 0) + (r.usage.input || 0), out: (billed?.out || 0) + (r.usage.output || 0) };
        return r?.text ?? "";
      };
      const parsed = parseJson(await ask(user)) || parseJson(await ask(`Return ONLY the JSON object described, nothing else.\n\n${user}`));
      if (!parsed) {
        this.stats.errors++;
        this.stats.lastError = "model returned no JSON";
        return end({ skipped: "bad json" });
      }
      this.#answered = true;
      const items = Array.isArray(parsed.items) ? parsed.items : [];
      this.#op(`${from}: the model proposed ${items.length} note(s)`, {
        sub: "milestone",
        detail: { reason, chain: chainId, agent, proposed: items.length, modelCalls },
        ref: { chainId },
      });
      const day = dayKey(this.now());
      if (this.daily.day !== day) this.daily = { day, count: 0 };
      const { dailyCap } = this.cfg();
      const finder = { agent: String(agent), type: e.agentType || null, model: e.model || null };
      let capped = false;
      // The most important first, as the model weighed them; past `FINDINGS_MAX` filed, the rest are over (d5).
      const weight = (/** @type {any} */ it) => Number(it?.importance) || 0.6;
      for (const it of items.map((it, i) => ({ it, i })).sort((a, b) => weight(b.it) - weight(a.it) || a.i - b.i).map((x) => x.it)) {
        if (counts.items >= FINDINGS_MAX) {
          counts.over++;
          continue;
        }
        if (!it || !it.text || String(it.text).length < 8) {
          counts.junk++;
          continue;
        }
        if (!FINDING_KINDS.has(it.kind)) {
          counts.refused++;
          continue;
        }
        // A fragment of code is no finding, and a procedure must read as one, of two steps or more (M5-6).
        const p = it.kind === "procedure" ? asProcedure(String(it.text), { least: 2 }) : null;
        if (it.kind === "procedure" ? !p : looksLikeCode(it.text)) {
          counts.junk++;
          continue;
        }
        if (SECRET.test(it.text)) {
          counts.secrets++;
          continue;
        }
        if (this.daily.count >= dailyCap) {
          capped = true;
          break;
        }
        const filed = await this.brain.fileLearned(
          {
            projectId: ch.project_id,
            chainId,
            turnId: e.turn ?? null,
            kind: it.kind,
            text: p ? p.text : clip(it.text, 500),
            importance: Math.max(0.3, Math.min(1, Number(it.importance) || 0.6)),
            slot: p ? procedureSlot(p) : slotOf(it.slot),
          },
          { via: `filament-${reason}`, origin: reason, finder },
        );
        if (filed.filed !== "added") {
          counts.dedupedItems++;
          continue;
        }
        counts.items++;
        this.daily.count++;
        this.stats.items++;
      }
      if (counts.items) this.#learned(ch.project_id);
      this.stats.runs++;
      this.stats.lastRun = new Date(this.now()).toISOString();
      this.log("info", `memory: learned from ${from}: ${counts.items} item${counts.items === 1 ? "" : "s"}`);
      return end({ ...counts, ...(capped ? { capped: true } : {}) });
    } catch (/** @type {any} */ err) {
      if (this.#closed) return end({ ...counts, skipped: "memory closed" }); // its call stopped (M7-D70): no fault
      const why = String(err?.message || err);
      this.stats.errors++;
      this.stats.lastError = why.slice(0, 200);
      this.log("warn", `memory: learning from ${from} failed: ${why.slice(0, 160)}`);
      return end({ ...counts, error: why });
    }
  }

  // The parsed-JSON → archive/engine half of a learning pass. `shown`: the ids of the open threads the model was shown,
  // the only ones it may close or say it worked on (M5-5). `span`: the turns the pass read; its last is the turn the
  // session's end state settles threads on, a thread it leaves open is filed on, and an item with no turn of its own is
  // said at (M7-D28), the session's newest without one. `through`: the turn the cursor moves to once everything is
  // filed, never back (`out.through`, where it stands); null leaves it. `notes`: the ids of the claims the session was
  // shown that the model was given (d4), the only ones it may say were contradicted or held.
  async ingest(parsed, ch, chainId, { reason = "manual", uncapped = false, through = null, shown = [], notes = [], span = null } = {}) {
    const out = { title: null, state: null, turns: 0, items: 0, dedupedItems: 0, junk: 0, reason, threads: null, corrected: 0, contradicted: 0, held: 0 };
    const turns = this.archive.getTurns(chainId);
    const tail = (span?.length && turns.find((t) => t.n === span[span.length - 1].n)) || turns.at(-1);
    if (parsed.title && !ch.title) {
      this.archive.setTitle(chainId, clip(parsed.title, 80));
      out.title = clip(parsed.title, 80);
    }
    if (parsed.state && typeof parsed.state === "object") {
      const st = {
        status: (parsed.state.open || []).length ? "open" : "done",
        summary: clip(parsed.state.summary, 400),
        done: arr(parsed.state.done, 60, 8),
        open: arr(parsed.state.open, 60, 8),
        next: arr(parsed.state.next, 60, 8),
        learnedAt: this.now(),
        reason,
      };
      this.archive.setState(chainId, st);
      out.state = st;
      // The open threads the session finished close, and the ones it worked on are said again (M5-5).
      out.threads = await this.brain.settleThreads({ projectId: ch.project_id, chainId, turnId: tail?.id ?? null, shown, closed: parsed.state.closed, still: parsed.state.still });
    }
    const byN = new Map(turns.map((t) => [t.n, t]));
    for (const t of Array.isArray(parsed.turns) ? parsed.turns : []) {
      const row = byN.get(Number(t?.n));
      if (row && t.summary && !row.summary) {
        this.archive.setTurnSummary(row.id, clip(t.summary, 300));
        out.turns++;
      }
    }
    // The turns whose person pushed back on the reply before (d4): that reply's outcome counts as corrected by the user
    // (M7-D50) — a turn this pass read, never one Filament began, nor one answering a reply kept apart, which the model
    // never read, nor any of another machine's agents' chat, whose pushing back is theirs (archive `agentsChat`, the
    // remote-agents plan's fc-word; one whose chat cannot be read is taken as theirs); the archive marks the reply the
    // turn answers, once.
    const read = new Set((span ?? turns).map((t) => t.n));
    let theirs = true;
    try {
      theirs = this.archive.agentsChat?.(chainId) === true;
    } catch {}
    for (const n of theirs ? [] : new Set(Array.isArray(parsed.corrected) ? parsed.corrected.map(Number) : [])) {
      const row = read.has(n) ? byN.get(n) : null;
      const before = row && !row.meta?.own ? this.archive.turnBefore(chainId, row.id) : null;
      if (before && !apartTurn(before)) out.corrected += this.archive.outcomes.correctTurn(chainId, row.id);
    }
    // What the session showed of the claims it was shown (d4): a suspicion for the curator to judge, or said again.
    const judged = this.brain?.judgeShown({ chainId, projectId: ch.project_id, notes, contradicted: parsed.contradicted, held: parsed.held, turnOf: (/** @type {number} */ n) => (read.has(n) ? byN.get(n) : null) ?? tail ?? null });
    if (judged) Object.assign(out, { contradicted: judged.suspected, held: judged.held });
    const { dailyCap } = this.cfg();
    // Unfinished work, and what comes next, are open threads (M5-5): claims a later session picks up, closes, or meets
    // again on the file they name.
    const unfinished = parsed.state && typeof parsed.state === "object" ? [...arr(parsed.state.open, 300, 8), ...arr(parsed.state.next, 300, 8)] : [];
    const last = tail?.n ?? null;
    const items = [...(Array.isArray(parsed.items) ? parsed.items.slice(0, 12) : []), ...unfinished.map((text) => ({ kind: "thread", text, importance: THREAD_IMPORTANCE, turn: last }))];
    for (const it of items) {
      if (!it || !KINDS.has(it.kind) || !it.text || String(it.text).length < 8) continue;
      // A fragment of code or markup is not a fact about the project (HarnessV2 F11: canon once held `a2.fw.res; }`
      // and entity-escaped text promoted from such items); it is counted and left out. A procedure's commands are its
      // steps (M5-6): it is kept as it reads, under its goal, and one that does not read as one, or has one step (a
      // convention says that), is left out as junk.
      const p = it.kind === "procedure" ? asProcedure(String(it.text), { least: 2 }) : null;
      if (it.kind === "procedure" ? !p : looksLikeCode(it.text)) {
        out.junk++;
        continue;
      }
      if (SECRET.test(it.text)) continue; // never learn a secret
      if (!uncapped && this.daily.count >= dailyCap) {
        out.capped = true;
        break;
      }
      const turn = byN.get(Number(it.turn)) || null;
      const importance = Math.max(
        0.3,
        Math.min(
          1,
          Number(it.importance) || (it.kind === "rule" ? 0.9 : it.kind === "decision" ? 0.75 : 0.6),
        ),
      );
      const filed = await this.brain.fileLearned(
        {
          projectId: ch.project_id,
          chainId,
          turnId: turn?.id || null,
          // When the session said it, so a session learned late does not overrule a newer one in a slot.
          saidAt: turn?.started_at ?? tail?.started_at ?? null,
          kind: it.kind,
          text: p ? p.text : clip(it.text, 500),
          importance,
          slot: p ? procedureSlot(p) : slotOf(it.slot),
        },
        { via: `filament-${reason}` },
      );
      if (filed.filed !== "added") {
        out.dedupedItems++;
        continue;
      }
      out.items++;
      this.daily.count++;
      this.stats.items++;
    }
    // A capped pass leaves the cursor for the next run.
    if (through != null && !out.capped) out.through = this.#advance(chainId, through);
    return out;
  }

}

/** The JSON object a model answered with, fences and prose around it set aside, or null. @param {string} text */
export function parseJson(text) {
  if (!text) return null;
  const s = String(text).trim();
  const m = /\{[\s\S]*\}/.exec(s.replace(/^```(?:json)?/i, "").replace(/```$/, ""));
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}
function arr(v, n, max) {
  return (Array.isArray(v) ? v : [])
    .map((x) => clip(typeof x === "string" ? x : JSON.stringify(x), n))
    .filter(Boolean)
    .slice(0, max);
}

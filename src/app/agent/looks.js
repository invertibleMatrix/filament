// @ts-check
// A lead reads along with its workers (HarnessV3-TaskGraph-v2 §12, V2-0): while they run, Filament shows their lead a
// look at them — each one's plan as it said it, what it has done so far in a line, and every round since the last
// look whole: what it said, called and read, never what it thought (TG2-D60) — due at once on a sign (core/signs.js),
// else at the pace the developer set. The lead answers with a line to the worker that is heading wrong, read at that
// worker's next step.
//
// Three parts live here, apart from the registry and the loop that call them:
//   - the marks: per running worker, the run log's event its lead last saw, and its signs since (`newMark`, `noted`);
//   - a turn's looks: when one is due, its words, and its marks taken and put back (`createLooks`);
//   - the lead's conversation (TG2-D24): only the newest look stays whole — the one before becomes a line, a wait the
//     lead answered a look with leaves with its answer, and a finished turn keeps none (`tidyLooks`, `withoutLooks`).
// The words are a look's, not a model's digest: Filament clips no words. A worker's thinking is in no look and no trail
// (HarnessV3-TaskGraph-v2 TG2-D60): a lead reads what its workers say and do, as a senior lead would, and gives no
// model another's reasoning. A call is its target and a result the run log's head of it, as everything read off a run
// log (core/run-work.js).
import { createRunReader, trailOfLog } from "../../core/run-work.js";
import { newSignState, signStep } from "../../core/signs.js";
import { estimateTokens } from "../../core/tokens.js";
import { durationWords } from "../../core/text.js";

/**
 * Whom a look shows, in its reader's own word (TG2-D31): a team's lead reads of its workers, the session's agent of the
 * sub-agents of its task graph.
 * @typedef {"workers" | "sub-agents"} Crewed
 */
const CREWED = /** @type {const} */ (["workers", "sub-agents"]);
/** How every look opens, and the line an older one becomes: the conversation is read by these words. */
const LOOK_AT = "[Filament: a look at your ";
export const LOOK_OPEN = `${LOOK_AT}workers`;
/** Where a look was, once a newer one stands (§12.6). @param {Crewed} [who] */
export const lookStub = (who = "workers") => `${LOOK_AT}${who} was here. The newest one replaces it.]`;
export const LOOK_STUB = lookStub();
/** Where a look was, in what a finished turn keeps: the reports are what the session's later turns read. @param {Crewed} [who] */
export const lookGone = (who = "workers") => `${LOOK_AT}${who} was here, while they ran. Their reports are what is kept.]`;
export const LOOK_GONE = lookGone();
/** Whom a text that is a look, or the line one became, shows; null for any other text. @param {unknown} text @returns {Crewed | null} */
export const lookOf = (text) => (typeof text === "string" && text.startsWith(LOOK_AT) ? CREWED.find((w) => text.startsWith(`${LOOK_AT}${w}`)) || null : null);
/** Whose a message to a worker is, as the one who reads along with it sees it: its own — a lead's, or the agent's that planned the task. @param {unknown} from */
export const ownMessage = (from) => from === "lead" || from === "agent";
/**
 * Whose word a note to a worker is when Filament itself speaks — a stuck worker sent to its lead (HarnessV3-TaskGraph-v2
 * TG2-D59), why a coding agent's call was refused: neither its lead's nor the developer's.
 */
export const FILAMENT = "filament";
/**
 * Whose stop ended a run, and what it ended, as the run's last words say ("your team's lead stopped this task"): the
 * developer's turn; or a task that was another's to end — a team worker's lead's, the agent's whose task graph dropped
 * it (HarnessV3-TaskGraph G2), Filament's own once another attempt at its brief passed first (TG2-D53). The loop's and a
 * coding agent's turn say it alike. @param {string | null | undefined} from
 */
export const whoseStop = (from) =>
  from === "lead" ? { who: "your team's lead", what: "task" } : from === "agent" ? { who: "the agent", what: "task" } : from === FILAMENT ? { who: "Filament", what: "task" } : { who: "the developer", what: "turn" };
/** How a worker's whole trail and its change so far open, when the lead asked for one: its id follows. */
const TRAIL_OPEN = "[Filament: the trail of ";
const PATCH_OPEN = "[Filament: the change so far of ";
/**
 * What such a head ends on where Filament keeps the reader's conversation, and the newest one alone stays whole in it
 * (TG2-D24). A coding agent's conversation is its own: nothing is replaced there, and the head says nothing of it.
 * @param {boolean} replaced
 */
const stays = (replaced) => (replaced ? " It stays until you ask for it again." : "");
/**
 * When a look comes between signs, in a wait's words (TG2-D48): at the pace the session says now — or, at pace 0,
 * whenever something is new.
 * @param {number | null | undefined} seconds
 */
export const paceWords = (seconds) => (Number(seconds) > 0 ? `at once on a sign, else every ${durationWords(Number(seconds) * 1000)} while something is new` : "whenever something is new");

/**
 * @typedef {object} Mark  what a running worker's lead has seen of it, kept with its run so a later turn of the lead's
 *   goes on from it
 * @property {number} event  the run log's newest event a look showed
 * @property {number} round  the newest round a look showed anything of
 * @property {import("../../core/signs.js").SignState} signs
 * @property {import("../../core/signs.js").Sign[]} fresh  its signs since the last look
 * @property {import("../../core/signs.js").Sign[]} shown  the signs earlier looks named
 * @property {boolean} stirred  its trail gained something since the last look
 * @property {boolean} said  it said something its run has not gone on from yet: new to a look once it does
 * @property {{ round: number, text: string } | null} plan  its first words, kept once seen: a look says them whole
 *   however far the log's start is by then
 * @property {Map<string, string>} sent  the messages queued for it and not read yet, by id: whose each is
 * @property {{ read: number, unread: number }} lead  how many of its lead's messages it has read, and not yet
 */
/** @returns {Mark} */
export const newMark = () => ({ event: 0, round: 0, signs: newSignState(), fresh: [], shown: [], stirred: false, said: false, plan: null, sent: new Map(), lead: { read: 0, unread: 0 } });

/** The events that add to a trail while its run goes on: a look has something new to show after one. */
const TRAIL_EVENTS = new Set(["tool-start", "tool-end", "steer-read", "ask"]);
/**
 * A reply's words add to a trail too, and stir it once the run goes on from them — a call, or its next round. A reply
 * the run ends on is the worker's report: it reaches the lead by itself, and a look that rang for it would say it
 * twice. Its thinking adds nothing: no look shows it (TG2-D60).
 */
const REPLY_EVENT = "round-text";

/**
 * One event of a worker's run, noted on its mark: its signs, the messages it was sent and read, and whether its trail
 * gained something. → whether anything a look or the worker's progress shows has changed.
 * @param {Mark} mark @param {any} e  the run's event, as the run log numbers it
 * @param {import("../../core/signs.js").WorkerFiles | null} [files]
 */
export function noted(mark, e, files = null) {
  if (!e || typeof e !== "object") return false;
  const signs = signStep(mark.signs, e, files);
  mark.fresh.push(...signs);
  let moved = signs.length > 0;
  if (e.type === "steer" && e.kind === "note" && e.id != null) {
    mark.sent.set(String(e.id), String(e.from || ""));
    if (ownMessage(e.from)) mark.lead.unread++;
    moved = true;
  } else if (e.type === "steer-read") {
    for (const id of Array.isArray(e.ids) ? e.ids : []) {
      const from = mark.sent.get(String(id));
      if (from === undefined) continue;
      mark.sent.delete(String(id));
      if (ownMessage(from)) {
        mark.lead.unread = Math.max(0, mark.lead.unread - 1);
        mark.lead.read++;
      }
    }
  }
  if (e.type === REPLY_EVENT) mark.said = true;
  else if (TRAIL_EVENTS.has(e.type) || (e.type === "round-start" && mark.said)) {
    mark.stirred = true;
    mark.said = false;
    moved = true;
  }
  return moved;
}

// ---- a look's words ------------------------------------------------------------------------------------------------

/** A count in a look's words. @param {number} n @param {string} one @param {string} [many] */
const count = (n, one, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
/** How often, in words. @param {number} n */
const times = (n) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
/** Some lines set in under what they belong to. @param {string} s */
const indented = (s) => s.split(/\r?\n/).map((l) => `  ${l}`).join("\n");

/** The most of a change's own line a look says. */
const LINE_SHOWN = 160;

/**
 * How a call ended, in a look's words: one that went well in a line — ok, and how much it read or printed; a write's or
 * an edit's by the first line of its tool's own result, which says what it did (that line's size read as the file's) —
 * and one that did not by the head of its result as the log holds it.
 * @param {import("../../core/run-work.js").TrailCall} c
 */
function endWords(c) {
  const change = c.kind === "write" || c.kind === "edit";
  const size = !change && c.chars != null && c.chars > 0 ? `, ${count(c.chars, "character")}` : "";
  switch (c.ended) {
    case "running":
      return "still running";
    case "ok": {
      if (!change) return `${c.exit != null ? `exit ${c.exit}` : "ok"}${size}`;
      const line = c.preview.trim().split(/\r?\n/)[0].trim();
      return line ? `ok: ${line.length > LINE_SHOWN ? `${line.slice(0, LINE_SHOWN)}…` : line}` : "ok";
    }
    case "refused":
      return "refused: it never ran";
    case "declined":
      return "declined by the developer: it never ran";
    case "vetoed":
      return "vetoed by the developer: it never ran";
    case "not-run":
      return "not run: its turn was stopped first";
    case "stopped":
      return "stopped while it ran";
    default: {
      const how = c.exit != null ? `exit ${c.exit}` : "failed";
      return c.preview.trim() ? `${how}:\n${indented(c.preview.trimEnd())}` : `${how} (the log kept none of its output)`;
    }
  }
}

/** Whose a message a worker read is, as its lead's look says it. @param {{ from: string }} m */
const whose = (m) => (ownMessage(m.from) ? "your message" : m.from === FILAMENT ? "Filament's word" : "the developer's message");

/**
 * One round of a trail, with what is new in it: what it said, called and read.
 * @param {import("../../core/run-work.js").TrailRound} r
 */
function roundWords(r) {
  const lines = [`Round ${r.n}${r.continued ? ", continued" : ""}`];
  if (r.said.length) lines.push(`Said: ${r.said.join("\n\n")}`);
  for (const c of r.calls) lines.push(`Called ${c.name}${c.args ? ` \`${c.args}\`` : ""} → ${endWords(c)}`);
  for (const m of r.read) lines.push(`Read ${whose(m)} at the end of this round: "${m.text}"`);
  return lines.join("\n");
}

/**
 * What a trail held before the part a look shows, in a line: its rounds, the files it read and changed, each command
 * with its newest exit, the messages it read, and the signs earlier looks named.
 * @param {import("../../core/run-work.js").TrailBefore} b @param {readonly import("../../core/signs.js").Sign[]} signs
 * @returns {string}  "" where there was nothing before
 */
export function soFarWords(b, signs) {
  if (!b.to) return "";
  const parts = [
    b.reads > 0 && `read ${count(b.reads, "file")}`,
    b.changed.length > 0 && `changed ${b.changed.join(", ")}`,
    ...b.commands.map((c) => `ran \`${c.command}\` ${times(c.runs)}${c.exit != null ? `, newest exit ${c.exit}` : ""}`),
    b.others > 0 && `${count(b.others, "other call")}`,
    b.read.lead > 0 && `read ${count(b.read.lead, "message")} of yours`,
    b.read.developer > 0 && `read ${count(b.read.developer, "message")} of the developer's`,
    // Its plan is said whole above: the sign that named it adds nothing here.
    ...signs.filter((s) => s.kind !== "plan").map((s) => `sign, round ${s.round}: ${s.words}`),
  ].filter(Boolean);
  return `So far (${b.from === b.to ? `round ${b.to}` : `rounds ${b.from} to ${b.to}`}): ${parts.length ? parts.join(" · ") : "no calls yet"}`;
}

/**
 * @typedef {object} Watched  a running worker, as a look reads it
 * @property {string} id
 * @property {string} role  what it is to its lead: its team's role, or "sub-agent"
 * @property {string} description
 * @property {string | null} task  the graph task it does, or reviews
 * @property {string | null} run  its run in the run log; null before that exists
 * @property {string[]} head  how it stands now, part by part: its round, the call or the wait it is in, its context
 * @property {Mark} mark
 */

/** A worker's heading in a look: who it is, and its task — named once, though a graph task's description opens with its id. @param {Watched} w */
const titleOf = (w) => `## ${w.role} ${w.id} — ${w.task ? `task ${w.task}: ` : ""}"${w.task && w.description.startsWith(`${w.task}: `) ? w.description.slice(w.task.length + 2) : w.description}"`;

/**
 * The messages a worker was sent and has not read, in its head line's words.
 * @param {readonly import("../../core/run-work.js").LoggedNote[]} unread @param {number} at  now, by the run log's clock
 */
function unreadWords(unread, at) {
  const ago = (/** @type {import("../../core/run-work.js").LoggedNote} */ m) => (m.sentAt > 0 ? ` of ${durationWords(Math.max(0, at - m.sentAt))} ago` : "");
  const lead = unread.filter((m) => ownMessage(m.from));
  // Filament's own word to it (TG2-D59) is neither: the sign that sent it is the look's.
  const other = unread.filter((m) => !ownMessage(m.from) && m.from !== FILAMENT).length;
  return [
    lead.length === 1 && `your message${ago(lead[0])} is not read yet`,
    lead.length > 1 && `${lead.length} messages of yours are not read yet (the oldest${ago(lead[0])})`,
    other === 1 && "a message of the developer's is not read yet",
    other > 1 && `${other} messages of the developer's are not read yet`,
  ].filter(Boolean);
}

/**
 * One worker's part of a look: its head line, its plan, what it did before in a line, and each round since the last
 * look, whole. `lean`: the new part only (a coding agent's lead).
 * @param {Watched} w @param {import("../../core/run-work.js").Trail} t @param {{ at: number, lean: boolean, whole?: boolean }} o
 *   `whole`: a trail the lead asked for — its rounds from where it asked, with no plan and no line before them
 */
function workerWords(w, t, { at, lean, whole = false }) {
  const m = w.mark;
  const head = [...w.head, ...unreadWords(t.unread, at), ...m.fresh.map((s) => `sign: ${s.words}`)].join(" · ");
  const lines = [titleOf(w), head || "starting"];
  if (!lean && !whole) {
    const plan = m.plan;
    lines.push(plan ? `Its plan (round ${plan.round}): ${plan.text}` : "It has said no plan yet.");
    const before = soFarWords(t.before, m.shown);
    if (before) lines.push(before);
  }
  if (t.firstRound > 1) lines.push(`Filament's log holds its work from round ${t.firstRound} on.`);
  if (!t.rounds.length) lines.push(whole ? "Its log shows no round from there on." : "Nothing new since your last look.");
  return [lines.join("\n"), ...t.rounds.map(roundWords)].join("\n\n");
}

/**
 * A look's opening line (§12.6).
 * @param {{ first: boolean, lean: boolean, running: number, moved: number, who: Crewed }} o
 */
function lookHead({ first, lean, running, moved, who }) {
  if (first) return `${LOOK_AT}${who}. ${running === 1 ? "1 is" : `${running} are`} running.]`;
  return `${LOOK_AT}${who}${lean ? "" : ", in place of the one before"}. Since ${lean ? "the last" : "it"}: ${moved} moved, ${running - moved} did not.]`;
}

// ---- a turn's looks ------------------------------------------------------------------------------------------------

/**
 * @typedef {object} LookMeta  what a look showed, as its run event says it and a look handed back restores it (TG2-D22)
 * @property {{ id: string, run: string | null, fromEvent: number, toEvent: number, fromRound: number, toRound: number, signs: string[] }[]} workers
 * @property {number} tokens  the look's size, estimated
 * @property {{ id: string, mark: Mark, event: number, round: number, fresh: import("../../core/signs.js").Sign[], stirred: boolean }[]} restore
 * @property {{ at: number, count: number, asked: boolean }} before
 */

/**
 * The looks of one lead's turn (TG2-D15): whether one is due, its words when the turn reads it, and its marks. A look
 * is made when it is read and never kept for later: one handed back puts its marks back, so the next shows that part
 * again.
 * @param {object} o
 * @param {() => number} o.now  the run log's clock
 * @param {(fn: () => void, ms: number) => void} o.later  runs a function once that long has passed
 * @param {() => number} o.seconds  the pace now (`engine.lookSeconds`), read at each look
 * @param {boolean} o.lean  the lead keeps its own conversation (a coding agent): each look is the new part only
 * @param {() => Watched[]} o.workers  the workers the turn waits for that run now, oldest first
 * @param {(run: string, since: number) => readonly any[]} o.eventsOf  a run's events after its event `since`, oldest
 *   first (0: from the oldest the log holds)
 * @param {() => void} o.wake  rings the turn: a look is due
 * @param {Crewed} [o.who]  whom its looks show, in the reader's word
 */
export function createLooks({ now, later, seconds, lean, workers, eventsOf, wake, who = "workers" }) {
  let lastAt = now();
  let taken = 0;
  let asked = false;
  let timed = false;
  const paceMs = () => Math.max(0, Number(seconds()) || 0) * 1000;
  /** A look is due: the lead asked, a sign fired, or something is new and the pace has passed. */
  const due = () => {
    const ws = workers();
    if (!ws.length) return false;
    if (asked || ws.some((w) => w.mark.fresh.length)) return true;
    return ws.some((w) => w.mark.stirred) && now() - lastAt >= paceMs();
  };
  /** A worker's trail moved: the turn is rung now when a look is due, else once the pace has passed. */
  const ring = () => {
    if (due()) return wake();
    if (timed || !workers().some((w) => w.mark.stirred)) return;
    timed = true;
    later(() => {
      timed = false;
      ring();
    }, Math.max(1, lastAt + paceMs() - now()));
  };
  /**
   * Each worker's run as read so far, by its run, and the newest event read: a look reads only what the log gained
   * since. Read from its first event at every look, a worker's run cost its lead the square of its length.
   * @type {Map<string, { reader: ReturnType<typeof createRunReader>, n: number }>}
   */
  const read = new Map();
  /** @param {string} run */
  const logOf = (run) => {
    let r = read.get(run);
    if (!r) read.set(run, (r = { reader: createRunReader(), n: 0 }));
    const gained = eventsOf(run, r.n);
    r.reader.feed(gained);
    for (const e of gained) r.n = Math.max(r.n, Number(e?.n) || 0);
    return r.reader.log();
  };
  /** @param {Watched} w */
  const trail = (w, since = w.mark.event) => trailOfLog(w.run ? logOf(w.run) : createRunReader().log(), { since });
  return {
    due,
    ring,
    /** The lead keeps its own conversation, where Filament replaces nothing. */
    lean: !!lean,
    /** The lead asks for a look with its next read, whatever is new: its wait is over, or a fold took the one it held. */
    ask() {
      asked = true;
    },
    /**
     * The look, as the turn reads it now: every running worker's part, and each mark moved to what it showed. Null
     * with no worker running.
     * @returns {{ text: string, meta: LookMeta } | null}
     */
    take() {
      const ws = workers();
      // A worker that no longer runs is read no more.
      for (const run of [...read.keys()]) if (!ws.some((w) => w.run === run)) read.delete(run);
      if (!ws.length) {
        asked = false;
        return null;
      }
      const at = now();
      /** @type {LookMeta} */
      const meta = { workers: [], tokens: 0, restore: [], before: { at: lastAt, count: taken, asked } };
      let moved = 0;
      const parts = ws.map((w) => {
        const m = w.mark;
        const t = trail(w);
        if (!m.plan && t.plan) m.plan = t.plan;
        if (t.rounds.length) moved++;
        const words = workerWords(w, t, { at, lean });
        meta.restore.push({ id: w.id, mark: m, event: m.event, round: m.round, fresh: [...m.fresh], stirred: m.stirred });
        meta.workers.push({ id: w.id, run: w.run, fromEvent: m.event, toEvent: t.event, fromRound: t.rounds[0]?.n ?? t.round, toRound: t.round, signs: m.fresh.map((s) => s.kind) });
        m.event = t.event;
        m.round = t.round;
        m.shown.push(...m.fresh);
        m.fresh = [];
        m.stirred = false;
        return words;
      });
      const text = [lookHead({ first: taken === 0, lean, running: ws.length, moved, who }), ...parts].join("\n\n");
      meta.tokens = estimateTokens(text);
      lastAt = at;
      taken++;
      asked = false;
      return { text, meta };
    },
    /** A look the turn took and never gave its model: its marks go back, so the next look shows that part again. @param {LookMeta} meta */
    back(meta) {
      for (const r of meta.restore) {
        const m = r.mark;
        m.event = r.event;
        m.round = r.round;
        m.shown = m.shown.filter((s) => !r.fresh.includes(s));
        m.fresh = [...r.fresh, ...m.fresh];
        m.stirred = r.stirred || m.stirred || r.fresh.length > 0;
      }
      lastAt = meta.before.at;
      taken = meta.before.count;
      asked = meta.before.asked;
    },
    /**
     * One running worker's rounds whole, from `fromRound` on or from its start, for the lead that asked (`show_trail`).
     * It moves no mark: the next look still shows what is new.
     * @param {Watched} w @param {number} [fromRound]
     */
    trail(w, fromRound = 0) {
      const all = trail(w, 0);
      const from = Math.max(1, Math.floor(Number(fromRound) || 0), all.firstRound);
      const t = { ...all, rounds: all.rounds.filter((r) => r.n >= from || (from === 1 && r.n === 0)) };
      return `${TRAIL_OPEN}${w.id}, whole from round ${from}.${stays(!lean)}]\n\n${workerWords({ ...w, mark: { ...w.mark, fresh: [] } }, t, { at: now(), lean: false, whole: true })}`;
    },
  };
}

/**
 * A worker's change, in the words its lead reads (`show_changes`, TG2-D17): so far while it runs, or — `reported` —
 * the change that waits to be applied. `replaced`: Filament keeps the newest one alone in the reader's conversation,
 * which the head says — never to a coding agent in the lead's seat, whose conversation is its own.
 * @param {{ id: string, role: string }} w @param {{ files: { path: string, added: number, removed: number }[], diff: string }} c
 * @param {{ reported?: boolean, replaced?: boolean }} [o]
 */
export function patchWords(w, c, { reported = false, replaced = true } = {}) {
  const head = `${PATCH_OPEN}${w.id}, against where it started: ${count(c.files.length, "file")}${reported ? ", as it stood when it reported" : ""}.${stays(replaced)}]`;
  if (!c.files.length) return `${head}\n\n${w.role} ${w.id} ${reported ? "changed nothing in its worktree." : "has changed nothing in its worktree yet."}`;
  return `${head}\n\n${c.files.map((f) => `- ${f.path} (+${f.added} −${f.removed})`).join("\n")}\n\n${c.diff}`;
}

/**
 * The same for a worker that works in the session's folder, where no git measures its change: the files its calls
 * wrote, as its run log names them.
 * @param {{ id: string, role: string }} w @param {{ paths: readonly string[], why: string }} c  `why`: why it has no worktree
 * @param {{ replaced?: boolean }} [o]
 */
export function wroteWords(w, c, { replaced = true } = {}) {
  const head = `${PATCH_OPEN}${w.id}: it works in your folder${c.why ? ` (no worktree: ${c.why})` : ""}, so no git measures its change.${stays(replaced)}]`;
  if (!c.paths.length) return `${head}\n\n${w.role} ${w.id} has written no file yet.`;
  return `${head}\n\nThe files its calls wrote, which your own tools can read:\n${c.paths.map((p) => `- ${p}`).join("\n")}`;
}

// ---- the lead's conversation (TG2-D24) -----------------------------------------------------------------------------

/** A text block where a look is or was. @param {any} b */
const isLookPlace = (b) => b?.type === "text" && lookOf(b.text) !== null;
/** A text block that is a look, whole. @param {any} b */
export const isLook = (b) => isLookPlace(b) && !b.text.startsWith(`${LOOK_AT}${lookOf(b.text)} was here`);
/** The words of a tool result, where it is words. @param {any} b */
const resultText = (b) => (b?.type !== "tool_result" ? "" : typeof b.content === "string" ? b.content : Array.isArray(b.content) && b.content.length === 1 && b.content[0]?.type === "text" ? String(b.content[0].text || "") : "");
/** Whether the reply before a message called tasks under this id: the one tool whose answer holds a change so far after other words. @param {any} reply @param {unknown} id */
const calledTasks = (reply, id) => reply?.role === "assistant" && Array.isArray(reply.content) && reply.content.some((/** @type {any} */ c) => c?.type === "tool_use" && c.id === id && c.name === "tasks");
/**
 * What a tool result holds of a worker the lead asked for, whole: `[kind, worker, ahead]`, or null. A lead's worker
 * answers with it alone; the agent's tasks show of one task answers with the task first and the change so far after
 * it (TG2-D33) — `ahead` is what stands before it, which stays. `reply`: the model's reply the result answers, where
 * that call is named: no other tool's result is read past its first words.
 * @param {any} b @param {any} reply @returns {["trail" | "patch", string, string] | null}
 */
const askedOf = (b, reply) => {
  const s = resultText(b);
  const within = s.startsWith(TRAIL_OPEN) || s.startsWith(PATCH_OPEN) ? 0 : calledTasks(reply, b?.tool_use_id) ? s.indexOf(`\n\n${PATCH_OPEN}`) : -1;
  if (within < 0) return null;
  const at = within ? within + 2 : 0;
  const open = s.startsWith(TRAIL_OPEN, at) ? TRAIL_OPEN : PATCH_OPEN;
  const id = /^[^\s,]+/.exec(s.slice(at + open.length))?.[0] || "";
  return id && !s.slice(at + open.length + id.length).startsWith(" was here") ? [open === TRAIL_OPEN ? "trail" : "patch", id, s.slice(0, at)] : null;
};
/** The line a trail or a patch the lead asked for becomes, after what stood before it. @param {["trail" | "patch", string, string]} asked @param {boolean} ended */
const askedStub = ([kind, id, ahead], ended) => `${ahead}${kind === "trail" ? TRAIL_OPEN : PATCH_OPEN}${id} was here${ended ? ", while it ran" : ". A newer one replaces it"}.]`;
/** A message with some of its blocks replaced, itself untouched. @param {any} m @param {(b: any) => any} swap */
const remade = (m, swap) => {
  if (!Array.isArray(m?.content)) return m;
  let changed = false;
  const content = m.content.map((/** @type {any} */ b) => {
    const to = swap(b);
    if (to !== b) changed = true;
    return to;
  });
  return changed ? { ...m, content } : m;
};

/**
 * Whether a reply answered a look with nothing but a wait, and its answer holds nothing but that wait's result and a
 * look: such a round leaves the conversation when the next look arrives (TG2-D24, "quiet watching leaves nothing").
 * @param {any} a  the reply @param {any} u  the message that answers it
 */
function quietWait(a, u) {
  if (a?.role !== "assistant" || u?.role !== "user" || !Array.isArray(a.content) || !Array.isArray(u.content)) return false;
  /** @type {Set<string>} */
  const waits = new Set();
  for (const b of a.content) {
    if (b?.type === "thinking" || b?.type === "redacted_thinking") continue;
    if (b?.type === "text" && !String(b.text || "").trim()) continue;
    if (b?.type === "tool_use" && b.name === "wait") waits.add(String(b.id));
    else return false;
  }
  return u.content.every((/** @type {any} */ b) => (b?.type === "tool_result" && waits.has(String(b.tool_use_id))) || isLookPlace(b));
}

/**
 * The lead's conversation, put right before its next model call (TG2-D24): of the looks in it only the newest stays
 * whole, each older one becomes its line (`LOOK_STUB`); a round in which the lead answered a look with nothing but a
 * wait leaves, with the newest look in the place of the one it had answered — and so does a quiet wait before it that
 * only ran out of time, with no look (TG2-D48); and of a worker's trail or change so far
 * the lead asked for twice, the older becomes its line. Message by message, so nothing shared with the turn's record
 * is changed in place. Twice in a row it changes nothing.
 * @param {any[]} convo  the conversation, changed in place
 * @param {{ from: number, own: number }} o  `from`: where the client's messages end; `own`: where the turn's own work
 *   starts — only rounds from there on leave
 * @returns {{ lined: number, left: number }}  the looks that became a line, and the rounds that left (the newest ones)
 */
export function tidyLooks(convo, { from, own }) {
  let lined = 0;
  let left = 0;
  // Of a worker's trail or patch asked for more than once, the newest stays.
  /** @type {Set<string>} */
  const kept = new Set();
  let newest = -1;
  for (let i = convo.length - 1; i >= Math.max(0, from); i--) {
    const m = convo[i];
    if (m?.role !== "user" || !Array.isArray(m.content)) continue;
    const hasLook = m.content.some(isLook);
    const older = hasLook && newest >= 0;
    if (hasLook && newest < 0) newest = i;
    /** A message's own blocks are read newest first too: a later block of the same kind wins. */
    const swaps = new Map();
    let lookSeen = false;
    for (let k = m.content.length - 1; k >= 0; k--) {
      const b = m.content[k];
      if (isLook(b)) {
        if (older || lookSeen) swaps.set(b, { type: "text", text: lookStub(lookOf(b.text) || undefined) });
        lookSeen = true;
        continue;
      }
      const asked = askedOf(b, convo[i - 1]);
      if (!asked) continue;
      const key = `${asked[0]} ${asked[1]}`;
      if (kept.has(key)) swaps.set(b, { ...b, content: askedStub(asked, false) });
      else kept.add(key);
    }
    if (!swaps.size) continue;
    lined += [...swaps.keys()].filter(isLook).length;
    convo[i] = remade(m, (b) => swaps.get(b) ?? b);
  }
  // Quiet watching leaves nothing: while the newest look answers a round that was only a wait, and the message before
  // that round holds the look it answered, the round leaves and the newest look takes that place. Waits between the two
  // that only ran out of time, with no look due (TG2-D48), answered nothing: their rounds leave with it. So the rounds
  // that leave are always the newest — before the turn's first look such a wait stays, as nothing takes its place.
  for (;;) {
    const q = convo.length - 1;
    const u = convo[q];
    const look = u?.role === "user" && Array.isArray(u.content) ? u.content.find(isLook) : null;
    if (!look) break;
    const first = Math.max(0, own);
    /** Whether the round answered into convo[at + 2] was only a wait, and the message before it is one of the client's side. @param {number} at */
    const quietFrom = (at) => at >= first && quietWait(convo[at + 1], convo[at + 2]) && convo[at]?.role === "user" && Array.isArray(convo[at].content);
    let at = q - 2;
    while (quietFrom(at) && !convo[at].content.some(isLookPlace)) at -= 2;
    if (!quietFrom(at)) break;
    const p = convo[at];
    let placed = false;
    convo[at] = { ...p, content: p.content.flatMap((/** @type {any} */ b) => (!isLookPlace(b) ? [b] : placed ? [] : ((placed = true), [look]))) };
    convo.splice(at + 1, q - at);
    left += (q - at) / 2;
  }
  return { lined, left };
}

/** Whether a conversation holds a look whole. @param {readonly any[]} convo @param {number} [from] */
export const holdsLook = (convo, from = 0) => convo.slice(Math.max(0, from)).some((m) => m?.role === "user" && Array.isArray(m.content) && m.content.some(isLook));

/**
 * A turn's work as the session keeps it (TG2-D24): no look, no trail and no change so far whole — each a line where
 * it was. They showed workers while they ran; the reports are what later turns read. The messages handed in are not
 * changed.
 * @param {readonly any[]} messages
 * @returns {any[]}
 */
export function withoutLooks(messages) {
  return messages.map((m, i) =>
    m?.role === "user"
      ? remade(m, (b) => {
          if (isLook(b)) return { type: "text", text: lookGone(lookOf(b.text) || undefined) };
          const asked = askedOf(b, messages[i - 1]);
          return asked ? { ...b, content: askedStub(asked, true) } : b;
        })
      : m,
  );
}

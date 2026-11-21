// @ts-check
// A turn's work as its run log holds it (HarnessV4_Tasks A2). A turn's conversation reaches the archive at its end. One
// that a restart or a crash cut off has no end, and its run log is all that is left of what it did: each round's words,
// each call by name with its target and the head of its result, the person's notes it read and — a coding agent's —
// what its context held. `workOfRun` rebuilds that as the archive keeps a turn's work: messages that alternate, every
// call answered.
//
// It is a record, not the conversation. A call's input is the target the log kept (`input`: the run log never holds a
// call's own arguments), and its result is the log's preview of it. So a turn rebuilt this way is never sent raw
// (app/sessions/shapes.js `trajectoryProblem`): it folds, a line for each call.

/** The archive's answer for a call the log shows no end of. */
export const CALL_CUT = "(Filament stopped before this call finished: its result was never recorded.)";
/** The same call in a turn that still runs, for a reader beside it: it has not ended, it did not fail. */
export const CALL_OPEN = "(still running when Filament read the turn's log.)";
/**
 * The same call where a question of it waits for the developer's answer — a permission, or what the agent asks: it
 * goes no further until they give it. `question`: what is asked, where the call does not say it itself.
 * @param {string} question
 */
export const callWaits = (question) => `(waiting for the developer's answer when Filament read the turn's log${question ? `: ${question}` : "."})`;

/** A call's result where the log kept no preview of it. @param {boolean} ok */
const unsaid = (ok) => (ok ? "(done: the run log kept none of its output.)" : "(failed: the run log kept none of its output.)");

/**
 * What a call's log says ended it without a result of its own, in words; "" where it ran.
 * @param {any} e  the call's `tool-end`
 */
const endedBy = (e) =>
  e.refused ? "(refused: it never ran.)" : e.declined ? "(declined by the developer: it never ran.)" : e.vetoed ? "(vetoed by the developer: it never ran.)" : e.notRun ? "(the turn was stopped before it ran.)" : e.stopped ? "(stopped while it ran.)" : "";

/**
 * How a sub-agent's run ended, from its own log, in the fields the registry gives an exchange it holds
 * (HarnessV4_Tasks U1). The registry keeps a session's newest sub-agents and none across a restart, so the card of
 * the call that launched one it lost had no end to show; its run's log still has it. The report is what its last
 * round that said anything said, clipped as a card's is — for a run cut short, its newest words, as the registry
 * keeps them for one it holds. Null where the log shows no end (it still runs, or it is not a run's log). Pure.
 * @param {readonly any[]} events  the run's events in order (services/runs.js `RUN_EVENT_FIELDS`)
 * @param {{ chars?: number }} [o]  the report's cap
 * @returns {{ status: string, startedAt: number, endedAt: number, ms: number, rounds: number, toolCalls: number,
 *   tokensIn: number, tokensOut: number, report: string, error: string | null, failure: any | null } | null}
 */
export function exchangeOfRun(events, { chars = 4000 } = {}) {
  const list = (events || []).filter((e) => e && typeof e === "object");
  const start = list.find((e) => e.type === "run-start");
  const end = list.findLast((e) => e.type === "run-end");
  if (!start || !end) return null;
  const s = end.summary && typeof end.summary === "object" ? end.summary : {};
  const count = (/** @type {string} */ type) => list.filter((e) => e.type === type).length;
  const said = String(list.findLast((e) => e.type === "round-text" && String(e.text || "").trim())?.text || "");
  const startedAt = Number(start.ts) || 0;
  const endedAt = Number(end.ts) || startedAt;
  return {
    // A run's end says "error" where an exchange's says "failed" (app/agent/turn.js `closeRun`).
    status: end.status === "error" ? "failed" : String(end.status || "failed"),
    startedAt,
    endedAt,
    ms: Math.max(0, endedAt - startedAt),
    rounds: Number.isFinite(Number(s.rounds)) ? Number(s.rounds) : count("round-start"),
    toolCalls: Number.isFinite(Number(s.toolCalls)) ? Number(s.toolCalls) : count("tool-start"),
    tokensIn: Number(s.inputTokens) || 0,
    tokensOut: Number(s.outputTokens) || 0,
    report: said.length > chars ? `${said.slice(0, chars)}…` : said,
    error: s.error ? String(s.error) : null,
    failure: s.failure && typeof s.failure === "object" ? s.failure : null,
  };
}

/**
 * @typedef {object} RunWork
 * @property {any[]} work  the turn's work as messages: each round's words and calls, then their results and the notes read
 * @property {number} rounds  the rounds the log shows
 * @property {number} tools  the turn's own calls (a sub-agent's are its own run's)
 * @property {{ tokens: number, window: number | null, exact: boolean } | null} held  a coding agent's newest count of
 *   what its context holds; null where the log says none
 */

/**
 * @typedef {{ text: string, at: number }} LoggedWords  something a round thought or said, and the event that logged it
 * @typedef {{ text: string, from: string, at: number, sentAt: number }} LoggedNote  a message a run was sent: whose
 *   (`from`: `lead`, else the developer's), `at`: the event it was read at (the event that queued it, while it waits),
 *   `sentAt`: when it was sent, by the log's clock
 * @typedef {{ texts: string[], calls: string[], notes: string[], moved: number, thinking: LoggedWords[], said: LoggedWords[], read: LoggedNote[] }} LoggedRound
 *   a round as its log holds it: its words, its calls by id, the notes it read, and `moved`: the newest event that
 *   changed any of them (a call's end counts for the round that made the call). For a trail (`trailOf`), each part
 *   with the event that logged it: its `thinking`, its words again (`said`) and the messages it `read`
 * @typedef {{ id: string, name: string, args: string, round: number, end: any | null, waits: string | null, at: number, endAt: number, kind: string, subject: string }} LoggedCall
 *   `waits`: the question it waits on the developer's answer to ("" where the call is the question itself); null
 *   where none waits; `at`, `endAt`: the events that started and ended it (0: not ended); `kind`, `subject`: its
 *   card's — what it does (read, write, edit, shell, …) and to what, in whatever vocabulary its name speaks
 */

/**
 * @typedef {{ rounds: Map<number, LoggedRound>, calls: Map<string, LoggedCall>, held: RunWork["held"], event: number, first: number, unread: LoggedNote[] }} RunLog
 *   a run's rounds and calls as its events tell them: `event`, the newest event's number; `first`, the oldest's (past 1
 *   where the log no longer holds the run's start); `unread`, the notes sent to the run that it has not read
 */

/**
 * A run's rounds and calls, read off its events in order.
 * @param {readonly any[]} events
 * @returns {RunLog}
 */
function readRun(events) {
  const reader = createRunReader();
  reader.feed(events);
  return reader.log();
}

/**
 * A run read as its log grows (TG2-D15): each event once, in order, whatever the batches it comes in — the reading of
 * `readRun` is a fold over the events, so a reader that has read a run's first events and is handed the ones after
 * holds what reading them all at once gives. A lead that reads along with its workers looks at each again and again
 * while it runs; read from its first event every time, a look cost the square of the worker's run. `log` is the
 * reading as it stands, its rounds and calls the reader's own: read them, never change them.
 * @returns {{ feed: (events: readonly any[]) => void, log: () => RunLog }}  `feed`: the events after those it was
 *   handed before
 */
export function createRunReader() {
  /** @type {Map<number, LoggedRound>} */
  const rounds = new Map();
  /** @type {Map<string, LoggedCall>} */
  const calls = new Map();
  /** The notes queued for the turn, by id: only the ones it read joined its conversation. @type {Map<string, LoggedNote>} */
  const queued = new Map();
  /** The questions that wait in the run, by id: the call each stands on. @type {Map<string, string>} */
  const asked = new Map();
  /** @type {RunWork["held"]} */
  let held = null;
  let current = 0;
  let event = 0;
  let first = 0;
  /** The round an event belongs to, made on first sight. @param {unknown} n @returns {[number, LoggedRound]} */
  const roundOf = (n) => {
    const k = Number.isFinite(Number(n)) && n != null ? Number(n) : current;
    current = Math.max(current, k);
    let r = rounds.get(k);
    if (!r) rounds.set(k, (r = { texts: [], calls: [], notes: [], moved: 0, thinking: [], said: [], read: [] }));
    return [k, r];
  };
  /** The events read so far: a list that carries no numbers is numbered by its order. */
  let i = 0;
  /** @param {readonly any[]} events */
  const feed = (events) => {
    for (const e of events || []) {
      i++;
      if (!e || typeof e !== "object") continue;
      // The run log numbers its events; a list that carries none is numbered by its order.
      const at = Number(e.n) > 0 ? Number(e.n) : i;
      event = Math.max(event, at);
      first = first ? Math.min(first, at) : at;
      switch (e.type) {
        case "round-start":
          roundOf(e.round);
          break;
        case "round-text":
          if (String(e.text || "").trim()) {
            const [, r] = roundOf(e.round);
            r.texts.push(String(e.text));
            r.said.push({ text: String(e.text), at });
            r.moved = Math.max(r.moved, at);
          }
          break;
        case "round-thinking":
          // A trail's alone: a round that only thought has shown nothing a reader beside the turn is told (`runningWork`).
          if (String(e.thinking || "").trim()) roundOf(e.round)[1].thinking.push({ text: String(e.thinking), at });
          break;
        case "tool-start": {
          const id = String(e.id ?? "");
          if (!id || calls.has(id)) break;
          const [k, r] = roundOf(e.round);
          calls.set(id, { id, name: String(e.name || "tool"), args: String(e.args ?? ""), round: k, end: null, waits: null, at, endAt: 0, kind: String(e.card?.kind || ""), subject: String(e.card?.subject ?? "") });
          r.calls.push(id);
          r.moved = Math.max(r.moved, at);
          break;
        }
        case "tool-end": {
          const c = calls.get(String(e.id ?? ""));
          if (!c) break;
          c.end = e;
          c.endAt = at;
          const r = rounds.get(c.round);
          if (r) r.moved = Math.max(r.moved, at);
          break;
        }
        case "ask": {
          // A question that waits in its run (a coding agent's, app/agent-run.js `onAsk`): on the agent's own call, or
          // on a call of its own, begun just before, whose target is the question.
          const id = String(e.id ?? "");
          if (e.waits !== true || !id) break;
          const c = calls.get(e.call == null ? `ask:${id}` : String(e.call));
          if (!c) break;
          c.waits = e.call == null ? "" : String(e.question || "");
          asked.set(id, c.id);
          const r = rounds.get(c.round);
          if (r) r.moved = Math.max(r.moved, at);
          break;
        }
        case "ask-end": {
          const c = calls.get(asked.get(String(e.id ?? "")) ?? "");
          if (!c) break;
          asked.delete(String(e.id));
          c.waits = null;
          const r = rounds.get(c.round);
          if (r) r.moved = Math.max(r.moved, at);
          break;
        }
        case "steer":
          if (e.kind === "note" && e.id != null && String(e.text || "").trim()) queued.set(String(e.id), { text: String(e.text), from: String(e.from || ""), at, sentAt: Number(e.at) || Number(e.ts) || 0 });
          break;
        // The developer changed a note that still waited, or took it back (HarnessV4_Tasks C34).
        case "steer-edit": {
          const note = queued.get(String(e.id ?? ""));
          if (note) note.text = String(e.text || "");
          break;
        }
        case "steer-drop":
          for (const id of Array.isArray(e.ids) ? e.ids : []) queued.delete(String(id));
          break;
        case "steer-read":
          for (const id of Array.isArray(e.ids) ? e.ids : []) {
            const note = queued.get(String(id));
            if (note === undefined) continue;
            queued.delete(String(id));
            const [, r] = roundOf(null);
            r.notes.push(note.text);
            r.read.push({ ...note, at });
            r.moved = Math.max(r.moved, at);
          }
          break;
        case "held":
          if (Number(e.tokens) > 0) held = { tokens: Number(e.tokens), window: Number(e.window) > 0 ? Number(e.window) : null, exact: e.exact !== false };
          break;
      }
    }
  };
  // A waiting note's words can still change (`steer-edit`): the reading hands out each as it stands now.
  return { feed, log: () => ({ rounds, calls, held, event, first, unread: [...queued.values()].map((note) => ({ ...note })) }) };
}

/**
 * Some rounds as messages: each round's words and calls, then their results and the notes it read; the messages
 * alternate, every call answered. `open`: what answers a call the log shows no end of — null where that is a cut
 * turn's (`CALL_CUT`, a failure), words where the turn still runs; there, a call a question of which waits for the
 * developer says so (`callWaits`).
 * @param {readonly number[]} ns  the rounds, in order
 * @param {{ rounds: Map<number, LoggedRound>, calls: Map<string, LoggedCall> }} log @param {string | null} open
 */
function roundsWork(ns, { rounds, calls }, open) {
  /** @type {any[]} */
  const work = [];
  /**
   * A message of `role`, joined to the one before it where that is the same role's: the work alternates.
   * @param {"assistant" | "user"} role @param {any[]} blocks
   */
  const say = (role, blocks) => {
    if (!blocks.length) return;
    const last = work[work.length - 1];
    if (last?.role === role) last.content.push(...blocks);
    else work.push({ role, content: [...blocks] });
  };
  const text = (/** @type {string} */ t) => ({ type: "text", text: t });
  for (const n of ns) {
    const r = /** @type {LoggedRound} */ (rounds.get(n));
    const own = r.calls.map((id) => /** @type {LoggedCall} */ (calls.get(id)));
    say("assistant", [...r.texts.map(text), ...own.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: c.args ? { input: c.args } : {} }))]);
    say("user", [
      ...own.map((c) => {
        if (!c.end) return open == null ? { type: "tool_result", tool_use_id: c.id, content: CALL_CUT, is_error: true } : { type: "tool_result", tool_use_id: c.id, content: c.waits == null ? open : callWaits(c.waits) };
        const ok = c.end.ok === true;
        const said = String(c.end.preview ?? "").trim() ? String(c.end.preview) : endedBy(c.end) || unsaid(ok);
        return { type: "tool_result", tool_use_id: c.id, content: said, ...(ok ? {} : { is_error: true }) };
      }),
      ...r.notes.map(text),
    ]);
  }
  return work;
}

/**
 * The work of a run, from its events in order (services/runs.js `RUN_EVENT_FIELDS`). Pure.
 * @param {readonly any[]} events
 * @returns {RunWork}
 */
export function workOfRun(events) {
  const log = readRun(events);
  const ns = [...log.rounds.keys()].sort((a, b) => a - b);
  return { work: roundsWork(ns, log, null), rounds: ns.filter((n) => n > 0).length, tools: log.calls.size, held: log.held };
}

/**
 * @typedef {object} TrailCall  a call in a trail
 * @property {string} id
 * @property {string} name
 * @property {string} args  its target, as the log kept it (never its content)
 * @property {string} kind  what it does: read, write, edit, shell, …; "" where the log does not say
 * @property {string} subject  what it does it to: a file's path, a command
 * @property {boolean} fresh  it started in the part shown; false: the look before showed it running, and it ended since
 * @property {"running" | "ok" | "failed" | "refused" | "declined" | "vetoed" | "not-run" | "stopped"} ended
 * @property {number | null} exit  a command's exit code
 * @property {number | null} chars  its result's size, where the log says it
 * @property {string} preview  the head of its result, as the log holds it; "" where it kept none
 */
/**
 * @typedef {object} TrailRound  a round in a trail, with what is new in it: never its thinking (HarnessV3-TaskGraph-v2
 *   TG2-D60)
 * @property {number} n
 * @property {boolean} continued  the look before showed part of it already
 * @property {string[]} said  whole
 * @property {TrailCall[]} calls
 * @property {LoggedNote[]} read  the messages it read
 */
/**
 * @typedef {object} TrailBefore  what a trail held up to the mark, counted: a look says it in a line
 * @property {number} from  its first round with anything in it; 0 where there is none
 * @property {number} to
 * @property {number} reads  the files it read
 * @property {string[]} changed  the files it wrote or edited, by name
 * @property {{ command: string, runs: number, exit: number | null }[]} commands  each command it ran, how often, and
 *   its newest exit
 * @property {number} others  its other calls
 * @property {{ lead: number, developer: number }} read  the messages it read
 */
/**
 * @typedef {object} Trail
 * @property {TrailRound[]} rounds  the rounds with something new since the mark, oldest first
 * @property {TrailBefore} before
 * @property {{ round: number, text: string } | null} plan  its first words, whole: what the first round that said
 *   anything said — null while it has said nothing, whatever it thought
 * @property {LoggedNote[]} unread  the messages sent to it that it has not read
 * @property {number} round  the newest round the log shows
 * @property {number} firstRound  the oldest round the log shows (past 1 where the log lost the run's start)
 * @property {number} event  the log's newest event: the next look's mark
 */

/** What a call does where its event carried no card: Filament's own hands, by name. */
const KIND_BY_NAME = Object.freeze({ read: "read", write: "write", edit: "edit", bash: "shell", powershell: "shell", bash_background: "shell" });
/** @param {LoggedCall} c */
const kindOf = (c) => c.kind || /** @type {Record<string, string>} */ (KIND_BY_NAME)[c.name] || "";
/** A command a call ran, where it is one: not a read of a background shell's output, nor its stop. @param {LoggedCall} c */
const isCommand = (c) => kindOf(c) === "shell" && !/_(output|kill)$/.test(c.name);
/** How a call's log says it ended. @param {LoggedCall} c @returns {TrailCall["ended"]} */
const endOf = (c) => {
  const e = c.end;
  if (!e) return "running";
  return e.refused ? "refused" : e.declined ? "declined" : e.vetoed ? "vetoed" : e.notRun ? "not-run" : e.stopped ? "stopped" : e.ok === true ? "ok" : "failed";
};

/**
 * A run's trail (HarnessV3-TaskGraph-v2 §12, TG2-D14): what a worker said, called and read, round by round, for the
 * lead that reads along with it — never what it thought (TG2-D60): no lead reads a worker's thinking, so a round that
 * only thought is no round of a trail. `since`: the mark of the look before — the rounds come with only what the log
 * gained after that event, so nothing is shown twice: a round's words once, a call that was running then by its end
 * alone. What came before the mark is counted (`before`), and its first words are kept whole (`plan`), so a look stands
 * without the one before it. Pure; as everything read off a run log, a call is its target and a result the log's
 * preview of it.
 * @param {readonly any[]} events  the run's events in order (services/runs.js `RUN_EVENT_FIELDS`)
 * @param {{ since?: number }} [o]
 * @returns {Trail}
 */
export function trailOf(events, { since = 0 } = {}) {
  return trailOfLog(readRun(events), { since });
}

/**
 * A run's trail (`trailOf`) from its reading so far (`createRunReader`): a look's, whose reader has read each event once.
 * @param {RunLog} log @param {{ since?: number }} [o]
 * @returns {Trail}
 */
export function trailOfLog(log, { since = 0 } = {}) {
  const ns = [...log.rounds.keys()].sort((a, b) => a - b);
  const fresh = (/** @type {{ at: number }} */ x) => x.at > since;
  /** @type {TrailRound[]} */
  const rounds = [];
  /** @type {TrailBefore} */
  const before = { from: 0, to: 0, reads: 0, changed: [], commands: [], others: 0, read: { lead: 0, developer: 0 } };
  const reads = new Set();
  const changed = new Set();
  /** @type {Map<string, { command: string, runs: number, exit: number | null }>} */
  const commands = new Map();
  /** @type {Trail["plan"]} */
  let plan = null;
  for (const n of ns) {
    const r = /** @type {LoggedRound} */ (log.rounds.get(n));
    const own = r.calls.map((id) => /** @type {LoggedCall} */ (log.calls.get(id)));
    if (!plan && r.said.length) plan = { round: n, text: r.said.map((s) => s.text).join("\n\n") };
    // What the mark already covers, counted.
    const old = [...r.said, ...own, ...r.read].some((x) => !fresh(x));
    if (old) {
      before.from ||= n;
      before.to = n;
    }
    for (const c of own) {
      if (fresh(c)) continue;
      const kind = kindOf(c);
      const done = c.endAt > 0 && c.endAt <= since;
      if (kind === "read") reads.add(c.subject || c.args);
      else if (kind === "write" || kind === "edit") {
        if (done && c.end.ok === true) changed.add(c.subject || c.args);
      } else if (isCommand(c)) {
        const k = c.args || c.subject;
        const was = commands.get(k) || { command: k, runs: 0, exit: null };
        commands.set(k, { command: k, runs: was.runs + 1, exit: done && typeof c.end.exitCode === "number" ? c.end.exitCode : was.exit });
      } else before.others++;
    }
    // Filament's own word to it (HarnessV3-TaskGraph-v2 TG2-D59) is neither its lead's nor the developer's.
    for (const m of r.read) if (!fresh(m) && m.from !== "filament") before.read[m.from === "lead" || m.from === "agent" ? "lead" : "developer"]++;
    // What is new since it, whole.
    const calls = own
      .filter((c) => fresh(c) || c.endAt > since)
      .map((c) => ({
        id: c.id,
        name: c.name,
        args: c.args,
        kind: kindOf(c),
        subject: c.subject || c.args,
        fresh: fresh(c),
        ended: endOf(c),
        exit: typeof c.end?.exitCode === "number" ? c.end.exitCode : null,
        chars: Number.isFinite(Number(c.end?.chars)) && c.end?.chars != null ? Number(c.end.chars) : null,
        preview: String(c.end?.preview ?? ""),
      }));
    const round = { n, continued: old, said: r.said.filter(fresh).map((s) => s.text), calls, read: r.read.filter(fresh) };
    if (round.said.length || round.calls.length || round.read.length) rounds.push(round);
  }
  before.reads = reads.size;
  before.changed = [...changed];
  before.commands = [...commands.values()];
  const shown = ns.filter((n) => n > 0);
  return { rounds, before, plan, unread: log.unread, round: shown.at(-1) ?? 0, firstRound: log.first > 1 ? (shown[0] ?? 0) : 1, event: log.event };
}

/** How many of its calls a cut run's report names: its newest. */
export const CUT_CALLS = 20;
/** How a call ended, in a cut run's report. @type {Readonly<Record<TrailCall["ended"], string>>} */
const ENDED_WORDS = Object.freeze({ running: "still running when its run ended", ok: "done", failed: "failed", refused: "refused", declined: "declined", vetoed: "vetoed", "not-run": "never ran", stopped: "stopped" });

/**
 * What a sub-agent's run had done when it ended without a report (the transcript audit, 2026-10-23): a restart or a
 * crash cut it, its loop threw, or it failed before its last round said anything. Its words, every round's that said
 * any, then its newest calls, each by name, target and how it ended: what the main agent reads in place of a report,
 * so the work is not lost with the run. Long words keep their end. "" where the log shows neither. Pure.
 * @param {readonly any[]} events  the run's events in order @param {{ chars?: number }} [o]  the words' cap
 */
export function cutReportOfRun(events, { chars = 24_000 } = {}) {
  const t = trailOf(events);
  const words = t.rounds.flatMap((r) => r.said).map((s) => s.trim()).filter(Boolean).join("\n\n");
  const calls = t.rounds.flatMap((r) => r.calls);
  if (!words && !calls.length) return "";
  const shown = calls.slice(-CUT_CALLS);
  const line = (/** @type {TrailCall} */ c) => {
    const what = String(c.subject || c.args || "").replace(/\s+/g, " ").trim();
    return `- ${c.name}${what ? ` ${what.length > 160 ? `${what.slice(0, 160)}…` : what}` : ""}: ${ENDED_WORDS[c.ended]}${c.exit != null && c.exit !== 0 ? ` (exit ${c.exit})` : ""}`;
  };
  const said = words.length > chars ? `…${words.slice(-chars)}` : words;
  const head = calls.length > shown.length ? `Its newest ${shown.length} calls, of ${calls.length}:` : `Its call${calls.length === 1 ? "" : "s"}:`;
  return [said, calls.length ? `${head}\n${shown.map(line).join("\n")}` : ""].filter(Boolean).join("\n\n");
}

/**
 * A turn that still runs, for a reader beside it (HarnessV4_Tasks E13-1, BW-6): a side agent asked "what is it doing?"
 * while the main agent works. The same rebuild as `workOfRun`, in two parts: the newest round, to be shown whole, and
 * the rounds before it, to be folded by the caller (a line for each result). A call the log shows no end of still
 * runs (`CALL_OPEN`), or waits for the developer's answer (`callWaits`); it did not fail. `since`: a later look (BW-7) — only the rounds something was said, called,
 * answered or read in after that event, so nothing is shown twice; none, where nothing moved. Pure.
 *
 * As everything read off a run log, a call's input is its target and its result the log's preview of it.
 * @param {readonly any[]} events @param {{ since?: number }} [o]
 * @returns {{ older: any[], newest: any[], rounds: number, tools: number, event: number }}  `rounds` and `tools`: what
 *   the two parts show; `event`: the log's newest event, where the next look starts
 */
export function runningWork(events, { since = 0 } = {}) {
  const log = readRun(events);
  // A round that has begun and shown nothing yet (its model call is in flight) is no round to show: the newest is the
  // newest that said, called or read something.
  const all = [...log.rounds.keys()].sort((a, b) => a - b).filter((n) => /** @type {LoggedRound} */ (log.rounds.get(n)).moved > 0);
  const shown = all.filter((n) => /** @type {LoggedRound} */ (log.rounds.get(n)).moved > since);
  const last = all.length && shown.at(-1) === all.at(-1) ? [/** @type {number} */ (shown.at(-1))] : [];
  const before = shown.slice(0, shown.length - last.length);
  return {
    older: roundsWork(before, log, CALL_OPEN),
    newest: roundsWork(last, log, CALL_OPEN),
    rounds: shown.filter((n) => n > 0).length,
    tools: shown.reduce((sum, n) => sum + /** @type {LoggedRound} */ (log.rounds.get(n)).calls.length, 0),
    event: log.event,
  };
}

/**
 * @typedef {{ at: number, own: boolean, round: number, fromRound: number, toRound: number, by: string | null, summary: string }} RunCompaction
 *   `at`: its event's number; `own`: a coding agent compacted its own context, else Filament's loop folded rounds
 *   `fromRound`–`toRound` of the turn (0 and 0 for an agent's own); `summary`: what the log kept of it, "" for none
 */
/**
 * The newest compaction a run's log shows that took anything out of the agent's window (the owner's words of 10-19:
 * "the context window only contains the content since last compaction"): Filament's loop folding the turn's own rounds
 * into a summary, or a coding agent compacting its own context. What the log logged before it is gone from the
 * window, and its summary stands for it. The session's earlier turns giving way (`earlier`) leaves the turn's rounds
 * whole; a compaction that failed, folded nothing or stood down took nothing; the overflow recovery's own mark rides
 * beside its fold's. Null with none. Pure.
 * @param {readonly any[]} events @returns {RunCompaction | null}
 */
export function newestCompaction(events) {
  /** @type {RunCompaction | null} */
  let out = null;
  let i = 0;
  for (const e of events || []) {
    i++;
    if (!e || typeof e !== "object" || e.type !== "compaction") continue;
    if (e.earlier || e.stoodDown || e.why || e.error || (e.result != null && e.result !== "compacted")) continue;
    const own = e.own === true;
    if (!own && !(Number(e.toRound) > 0)) continue;
    out = {
      at: Number(e.n) > 0 ? Number(e.n) : i,
      own,
      round: Number(e.round) || 0,
      fromRound: own ? 0 : Number(e.fromRound) || 1,
      toRound: own ? 0 : Number(e.toRound),
      by: e.by ? String(e.by) : null,
      summary: String(e.summary || "").trim(),
    };
  }
  return out;
}

/**
 * A compaction in the turn running now, as a reader beside the turn reads it in place of what it took: who made room,
 * and the summary that stands for what went — or that the log kept none.
 * @param {RunCompaction} c
 */
export function compactionWords(c) {
  const what = c.own
    ? `${c.by || "The agent"} compacted its own context here${c.round ? `, in round ${c.round} of this turn` : ", before this turn's first model call"}: the earlier turns and this turn's work before this point are gone from its window`
    : `Filament summarized this turn's rounds up to round ${c.toRound} here to make room${c.by ? ` (${c.by} wrote it)` : ""}: they are gone from the agent's window`;
  return c.summary ? `[${what}, and this summary stands for them:]\n\n${c.summary}` : `[${what}; the run's log kept no summary of them.]`;
}

/** How much of a lead's newest words its board shows: their end. */
export const LEAD_WORDS_CHARS = 600;

/**
 * Where a team's lead is in its running turn, for its board on the main chat's Teams tab (team_v2_plan §10 O2): how
 * many rounds it has begun, its newest words (their end), and the calls of its newest round that made any — each by
 * name and target, and whether it still runs (a wait on its workers runs while they do). Pure.
 * @param {readonly any[]} events  the run's events in order
 * @returns {{ rounds: number, words: string, calls: { name: string, subject: string, open: boolean }[] }}
 */
export function leadNow(events) {
  const log = readRun(events);
  const ns = [...log.rounds.keys()].filter((n) => n > 0).sort((a, b) => b - a);
  let words = "";
  for (const n of ns) {
    const said = String(/** @type {LoggedRound} */ (log.rounds.get(n)).said.at(-1)?.text || "").trim();
    if (said) {
      words = said.length > LEAD_WORDS_CHARS ? `…${said.slice(-LEAD_WORDS_CHARS)}` : said;
      break;
    }
  }
  const called = ns.find((n) => /** @type {LoggedRound} */ (log.rounds.get(n)).calls.length > 0);
  const calls = called == null ? [] : /** @type {LoggedRound} */ (log.rounds.get(called)).calls
    .map((id) => log.calls.get(id))
    .filter((c) => !!c)
    .map((c) => ({ name: /** @type {LoggedCall} */ (c).name, subject: /** @type {LoggedCall} */ (c).subject || /** @type {LoggedCall} */ (c).args, open: !(/** @type {LoggedCall} */ (c).end) }));
  return { rounds: ns.length, words, calls };
}

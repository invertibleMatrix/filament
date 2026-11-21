// @ts-check
// What Filament's sub-agents send a coding agent whose harness turn launched them: a team's lead's workers
// (agent-lead.js), a plain chat's sub-agents and the saved agents it asked (agent-launch.js). The door the turn opened
// in the registry holds their reports; here they are taken as the agent's messages, each said on its run as the loop
// says it, Filament's own words for the agent beside them, and the agent's wait answers with what came — never past the
// time the agent lets one of its calls run. The turns that hold such a door now are found by their session
// (`createAgentTurns`): Filament's MCP server finds the turn a call is for there, as the loop's door is found by its run
// (HarnessV3-AtHome AH-O10). Another agent's result that lands while the agent works reaches it sealed, as the loop's
// does (HarnessV4_Envelopes_Plan EN3): its line, the report kept with the session until the agent opens it with
// Filament's envelope tool — opened at once in its wait and its wake, and whole for an agent Filament's tools reach not.
import { WAIT_DEFAULT_SECONDS, WAIT_MAX_SECONDS } from "./agent/tools.js";
import { paceWords } from "./agent/looks.js";
import { envelopeAnswer, openedText, pictureAnswer, sealedReminder, writesLetter } from "./agent/envelopes.js";
import { commandsNamed } from "./agent/commands.js";

/** How long an agent lets one of Filament's calls run, where its bridge says nothing: 50 s, until drives measure it. */
export const MCP_PATIENCE_MS = 50_000;
/** A held call answers this much before the agent's patience runs out, so its answer arrives in time. */
const PATIENCE_MARGIN_MS = 5_000;
/** How long Filament may hold one of the agent's calls. @param {number} patienceMs */
export const heldFor = (patienceMs) => Math.max(1_000, patienceMs - PATIENCE_MARGIN_MS);

/** @typedef {import("./agent-run.js").OwnCall} OwnCall */

/**
 * @typedef {object} AgentTurn  a coding agent's harness turn, as Filament's sub-agent tools reach it
 * @property {(name: string, input: any, o?: { patienceMs?: number }) => Promise<{ text: string, isError?: boolean }>} call
 *   one of Filament's tools, as the agent called it
 * @property {(o?: { seal?: boolean, end?: boolean }) => string[]} take  what the agent has not heard yet — its
 *   sub-agents' reports, Filament's own words for it, and last, where it reads along with its workers, a look at them —
 *   in words, each said on the run as the loop says it. `seal`: the agent works, so another agent's result comes as its
 *   envelope's line (EN-D1); without it the agent waits, and what is sealed opens first, oldest first. `end`: its turn
 *   would end — a result that came is opened, the sealed ones ahead of it; with none they stay sealed (EN-D13)
 * @property {() => void} unheard  what the newest take handed out never reached the agent: it goes with the next prompt
 *   — but a look, which is never kept for later: its marks go back, and the next look shows that part again
 * @property {() => Promise<void> | null} owes  what the turn may not end before
 * @property {() => string | null} [why]  what its wait waits for, where a flow its agent drives In place is of it
 *   (HarnessV4_OneAgent_Plan OA4); else null
 * @property {() => Promise<string | void>} arrival  resolves when something waits to be heard (at once when it already
 *   does) — with "look" when what woke it is a look that is due
 * @property {() => Promise<void> | null} waiting  while the agent waits on its wait tool, its end: what lands goes there
 * @property {() => number} spentUsd  what the sub-agents whose reports the agent got spent
 * @property {() => void} close  the turn is over: its door closes — the reports it never took wait on the session, and
 *   so do the words it took and never heard (HarnessV4_Tasks B12), said so on the record
 * @property {() => { text: string, workers: number } | null} [teamNow]  a lead's agent compacted its own context during
 *   the turn: how its team stands now (HarnessV3-TaskGraph-v2 TG2-D56), for the block that comes back after it
 *   (acp-turn.js `backNow`)
 * @property {() => string | null} [remind]  the turn would end with envelopes still sealed: the words that say so,
 *   once a turn (EN-D5) — null after, with none, and for an agent that cannot open one
 */

/**
 * @typedef {object} AgentInbox
 * @property {AgentTurn["take"]} take
 * @property {AgentTurn["unheard"]} unheard
 * @property {AgentTurn["arrival"]} arrival
 * @property {AgentTurn["waiting"]} waiting
 * @property {AgentTurn["spentUsd"]} spentUsd
 * @property {AgentTurn["close"]} close
 * @property {(input: any, id?: string | null) => string} open  the agent's envelope tool: the oldest sealed ones, whole
 *   (`count`, `all`), each said on the run by its call's id; the tool's answer
 * @property {() => string | null} remind
 * @property {() => boolean} seals  another agent's result reaches the agent sealed while it works now: it can open one,
 *   and its session says so
 * @property {(text: string, description: string, o?: { now?: boolean }) => void} say  words of Filament's own for the
 *   agent, heard as a report is. `now`: they say how things stand now, so a turn that ends before the agent heard them
 *   drops them — by the session's next turn they would be out of date
 * @property {(seconds: unknown, patienceMs: number, o: { who: string }) => Promise<{ said: string, look: string | null } | null>} wait
 *   the agent's wait: it ends the moment something reaches the agent — a look that is due counts, and a command's end —
 *   a command it waits for is stopped, a message of the developer's waits for the agent, the turn stops, or the seconds
 *   pass, never past the agent's patience, and answers with what came (`said`) — null where there is nothing to wait
 *   for: none owed, no command running (`commands`), nothing pending. `look`: where the agent reads along, a look at
 *   its workers as they stand now — when a report, a message or a look ended the wait, and after a wait that only ran
 *   out of time where one is due (TG2-D48). `who`: the ones still running, as its words name them
 */
/**
 * @typedef {object} WaitedCommands  the chat's background commands the agent's wait waits for (agent/commands.js
 *   `waitedCommands`)
 * @property {() => import("./agent/commands.js").CommandRow[]} running  those still running, the oldest first
 * @property {(ids: readonly string[]) => { ended: Promise<string[]>, off: () => void }} ended  resolves once one of `ids`
 *   runs no more — its end handed in first, or stopped — with those that run no more; `off` lets go of it
 */
/**
 * @typedef {"step" | "reply" | null} Reach  how a message of the developer's reaches the agent, as its turn says
 *   (HarnessV3-TaskGraph-v2 TG2-D43): at its next step — the agent takes queued words, and they are on their way to
 *   it — or only as its next message, once its reply ends; null where a wait has no word for it: the agent's own
 *   command, held for the turn's end, or words that wait for the turn's end whatever the agent does
 */

/**
 * @param {{
 *   door: { inbox: import("./agent/subagents.js").Inbox, close: () => any },
 *   emit: (evt: any) => void,
 *   note: (text: string) => void,
 *   mailbox: () => import("../services/runs.js").Mailbox | null,
 *   reach: (m: import("../services/runs.js").SteerMessage) => Reach,
 *   handOver?: (m: import("../services/runs.js").SteerMessage) => Promise<void>,
 *   wrote?: (writes?: import("./turn-tree.js").Writes | null) => void,
 *   signal: AbortSignal,
 *   reader: string,
 *   opens?: () => boolean,
 *   onTask?: (() => string | null) | null,
 *   commands?: WaitedCommands | null,
 * }} o  `door`: what the turn opened in the registry; `emit`: an event on the turn's run, at its round; `note`: the
 *   record's line; `reach`: how a message queued on the run reaches the agent, which says whether it ends a wait and
 *   in which words; `handOver`: a message that ends a wait at the agent's next step goes to it before the wait answers
 *   — the developer's words wait in Filament for the agent's next call (HarnessV4_Tasks C34), and a wait is one already
 *   running; `wrote`: a report tells of a change to the folder, which the run snapshots with the files it
 *   names (HarnessV4_Tasks B12);
 *   `signal`: the turn's stop or hang-up; `reader`: who hears, as the record names it ("the lead"); `opens`: whether
 *   the agent can open an envelope now — Filament's tools reach its session, the envelope tool beside its wait. One
 *   that cannot gets every result whole, the sealed ones first (EN-D10); `onTask`: the line behind what lands while a
 *   task of the agent's own runs on its graph — an envelope's line, a background command's end — which says which task
 *   and how to take it up first (HarnessV4_TaskGraphPlus_Plan E41 P1 case 7), null with none; `commands`: the chat's
 *   background commands its wait waits for too, and names, as it does its sub-agents — whose ends come in through the
 *   door — null for an agent whose wait waits for none
 * @returns {AgentInbox}
 */
export function createAgentInbox({ door, emit, note, mailbox, reach, handOver = async () => {}, wrote = () => {}, signal, reader, opens = () => false, onTask = null, commands = null }) {
  /** The agent reads along with its workers: its door makes looks (HarnessV3-TaskGraph-v2 §12, V2-0b). */
  const reads = !!door.inbox.reads;
  let spent = 0;
  /** The looks the agent was shown. */
  let looks = 0;
  /**
   * Words the agent has not heard, each as the message of the registry's it is: Filament's own (`say`), and reports
   * taken unread.
   * @type {import("./agent/subagents.js").Taken[]}
   */
  const pending = [];
  /** What the newest take handed out, until the next: `unheard` puts it back. @type {import("./agent/subagents.js").Taken[]} */
  let handed = [];
  /** The words of Filament's own that say how things stand now (`say`'s `now`): never kept past the turn. */
  const fleeting = new WeakSet();
  /** The lines that said which task what landed came during (`onTask`): one a take. */
  const onTaskLines = new WeakSet();
  /** The turn said its envelopes still sealed as it would end: once a turn (EN-D5). */
  let reminded = false;
  /** Who waits for something to be heard. @type {Set<() => void>} */
  const bell = new Set();
  const ring = () => {
    for (const w of [...bell]) w();
  };
  /** The agent's wait while it runs: its end. @type {Promise<void> | null} */
  let waitEnds = null;
  /**
   * The developer's messages that ended a wait, by id: each ends one, and a later wait the agent makes with it still
   * queued runs its course and then says the message waits — so a wait never spins on a message the agent is yet to
   * read (TG2-D43).
   * @type {Set<string>}
   */
  const told = new Set();
  /** A message that ends the agent's wait. @param {import("../services/runs.js").SteerMessage} m */
  const ends = (m) => !told.has(m.id) && reach(m) != null;

  /** @param {number} ms @returns {Promise<string>} */
  const pause = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms, "time");
      t.unref?.();
    });
  /**
   * "stopped" once the signal aborts, and how to stop listening: a wait that ended otherwise lets go of its listener,
   * or the turn's signal — made with AbortSignal.any, which Node itself holds while it has a listener and may still
   * abort — kept each wait's, and the whole turn with them, after the turn was over (the crashes of 11-14).
   * @param {AbortSignal} s @returns {{ stopped: Promise<string>, off: () => void }}
   */
  const aborted = (s) => {
    if (s.aborted) return { stopped: Promise.resolve("stopped"), off: () => {} };
    /** @type {() => void} */
    let on = () => {};
    const stopped = new Promise((resolve) => {
      on = () => resolve("stopped");
      s.addEventListener("abort", on, { once: true });
    });
    return { stopped, off: () => s.removeEventListener("abort", on) };
  };

  /** What one message reads as: an envelope opened carries its number and sender ahead of its report. @param {import("./agent/subagents.js").Taken} d */
  const textOf = (d) => (d.opened ? openedText(d) : d.text);

  /** @type {AgentInbox["take"]} */
  const take = ({ seal = false, end = false } = {}) => {
    // An agent that cannot open an envelope takes every result whole, the sealed ones first (EN-D10).
    const due = door.inbox.take(opens() ? { seal, end } : {});
    let sealedNow = 0;
    let openedNow = 0;
    for (const d of due) {
      // A look at its workers is no report: it is said on the run with what it showed, so a page rebuilds it from the
      // workers' own logs (TG2-D22).
      if (d.kind === "look") {
        looks++;
        emit({ type: "look", workers: d.look?.workers || [], tokens: d.look?.tokens || 0 });
        continue;
      }
      // A worker's question to its lead (TG2-D58) is no report: its lead's timeline has it from when it was asked.
      if (d.kind === "ask") continue;
      // A background command's end (HarnessV4_Background_Plan BG-D10): the shells' row, which says where the agent heard it.
      if (d.kind === "shell") {
        emit({ type: "shell-exit", shells: [{ id: d.from, command: d.description, code: d.code ?? null }] });
        continue;
      }
      // One opened as the agent waited: its sealing counted what it spent and wrote.
      if (d.opened) {
        openedNow++;
        emit({ type: "envelope-opened", envelope: d.envelope, agentId: d.from, description: d.description, sender: d.sender || "", ...(d.via ? { via: d.via } : {}), by: "wait" });
        emit({ type: "subagent-report", agentId: d.from, description: d.description, kind: d.kind, envelope: d.envelope });
        continue;
      }
      spent += d.spentUsd;
      if (d.wrote) wrote(d.writes || null);
      // A result sealed (EN3): its line is what the agent hears; its report waits with the session until it opens it.
      if (d.kind === "envelope") {
        sealedNow++;
        emit({ type: "envelope-sealed", envelope: d.envelope, agentId: d.from, description: d.description, sender: d.sender || "", subject: d.subject || "", ...(d.via ? { via: d.via } : {}) });
        continue;
      }
      emit({ type: "subagent-report", agentId: d.from, description: d.description, kind: d.kind, ...(d.task ? { task: d.task, state: d.state } : {}), ...(d.sent ? { sent: true } : {}) });
    }
    const said = due.filter((d) => d.kind !== "look" && d.kind !== "envelope" && d.kind !== "shell" && !d.opened).length;
    if (said) note(`agent: ${said} sub-agent message${said === 1 ? "" : "s"} delivered to ${reader}`);
    const ends = due.filter((d) => d.kind === "shell").length;
    if (ends) note(`agent: ${ends === 1 ? "a background command's end" : `${ends} background commands' ends`} delivered to ${reader}, whole`);
    if (sealedNow) note(`agent: ${sealedNow} result${sealedNow === 1 ? "" : "s"} sealed for ${reader}: ${sealedNow === 1 ? "its line" : "their lines"} delivered, ${sealedNow === 1 ? "its report waits" : "their reports wait"} for the envelope tool`);
    if (openedNow) note(`agent: ${openedNow} sealed result${openedNow === 1 ? "" : "s"} opened for ${reader}, as it waited`);
    // A take that opens opens every one sealed but the letters from other chats: the lines said of those opened and not
    // yet heard are out of date, and a letter's still stands.
    const still = openedNow ? door.inbox.sealed?.() || [] : null;
    const kept = pending.splice(0).filter((d) => !still || d.kind !== "envelope" || still.some((e) => e.n === Number(d.envelope)));
    // What landed while a task of its own runs: the line that says which, once a take, after them (E41 P1 case 7). Not
    // for its own commands' ends, which it started for its work (FabeleHelper's of 11-10).
    const line = sealedNow && !kept.some((d) => onTaskLines.has(d)) ? onTask?.() || null : null;
    /** @type {import("./agent/subagents.js").Taken[]} */
    const after = [];
    if (line) {
      /** @type {import("./agent/subagents.js").Taken} */
      const d = { text: line, from: "", description: "your task graph", kind: "task", wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] };
      fleeting.add(d);
      onTaskLines.add(d);
      after.push(d);
      note(`agent: what landed came while a task of ${reader === "the lead" ? "the lead's" : "the agent's"} own ran — Filament said which, and how to take it up first`);
    }
    handed = [...kept, ...due, ...after];
    return handed.map(textOf);
  };
  /** @type {AgentInbox["arrival"]} */
  const arrival = () =>
    pending.length
      ? Promise.resolve(undefined)
      : new Promise((resolve) => {
          const w = (/** @type {string | void} */ what) => {
            bell.delete(w);
            resolve(what === "look" ? "look" : undefined);
          };
          bell.add(w);
          door.inbox.arrival().then(w);
        });

  return {
    take,
    unheard() {
      const back = handed.splice(0);
      // A look is "now": never kept for the next prompt. Its marks go back, and the next look shows that part again.
      const looked = back.filter((d) => d.kind === "look");
      if (looked.length) {
        looks -= looked.length;
        door.inbox.back(looked);
      }
      pending.unshift(...back.filter((d) => d.kind !== "look"));
    },
    arrival,
    waiting: () => waitEnds,
    spentUsd: () => spent,
    say(text, description, { now = false } = {}) {
      /** @type {import("./agent/subagents.js").Taken} */
      const d = { text, from: "", description, kind: "task", wrote: false, spentUsd: 0, toolCalls: 0, roundIds: [] };
      if (now) fleeting.add(d);
      pending.push(d);
      ring();
    },
    async wait(seconds, patienceMs, { who }) {
      const owed = door.inbox.owed();
      // The chat's background commands it waits for as for its sub-agents: an end comes in through the door (the gap of
      // 11-10, where a wait with only `npm install` running answered at once).
      const running = commands?.running() || [];
      // Nothing runs, yet envelopes are sealed: the agent waits, so they open here, oldest first, as the loop's next
      // step opens them after its wait (HarnessV4_Envelopes_Plan case 6) — another chat's letter stays sealed for it.
      const sealed = !owed && !running.length && !pending.length && opens() ? door.inbox.waitOpens?.() || 0 : 0;
      if (sealed) {
        const all = take();
        const look = handed.at(-1)?.kind === "look" ? (all.at(-1) ?? null) : null;
        const texts = look == null ? all : all.slice(0, -1);
        return { said: `Nothing to wait for: nothing you launched is still running. ${sealed === 1 ? "The envelope still sealed opens" : `The ${sealed} envelopes still sealed open`} here, oldest first:\n\n${texts.join("\n\n")}`, look };
      }
      if (!owed && !running.length && !pending.length) return null;
      const asked = (Number(seconds) > 0 ? Math.min(WAIT_MAX_SECONDS, Number(seconds)) : WAIT_DEFAULT_SECONDS) * 1000;
      const limitMs = Math.min(asked, heldFor(patienceMs));
      const t0 = Date.now();
      // What it waits on, as its words say it: those `who` names while they owe, and the commands by id.
      const on = !running.length ? who : owed ? `${who} and ${commandsNamed(running)}` : commandsNamed(running);
      const one = running.length === 1 && !owed;
      const ending = commands && running.length ? commands.ended(running.map((r) => r.id)) : null;
      /** The commands that ran no more as the wait ended. @type {string[]} */
      let gone = [];
      /** @type {() => void} */
      let done = () => {};
      const stop = aborted(signal);
      waitEnds = new Promise((resolve) => (done = () => resolve(undefined)));
      try {
        const mb = mailbox();
        const got = await Promise.race([
          arrival().then((what) => (what === "look" ? "look" : "report")),
          ...(owed ? [owed.then(() => "settled")] : []),
          // One that ends hands its end in first, which the take below says; one stopped hands in nothing.
          ...(ending ? [ending.ended.then((ids) => ((gone = ids), "command"))] : []),
          // A message of the developer's ends the wait — one queued before it began too, which reaches the agent no
          // sooner for the wait (TG2-D43); the agent's own command, held for the turn's end, never does. The mailbox's
          // wait ends at the run's end too, with no message: then the turn's stop or the time ends this one.
          ...(mb ? [mb.next(ends).then(() => (mb.peek(ends) ? "message" : new Promise(() => {})))] : []),
          stop.stopped,
          pause(limitMs),
        ]);
        // An agent that reads along is shown its workers when a report, a message or a look ends its wait (§12.7). A wait
        // that only ran out of time shows one where one is due — on a sign, or at the pace (TG2-D48) — and a stop none.
        if (reads && got !== "stopped" && got !== "time") door.inbox.look?.();
        const all = take();
        const look = handed.at(-1)?.kind === "look" ? (all.at(-1) ?? null) : null;
        const texts = look == null ? all : all.slice(0, -1);
        const took = `${Math.round((Date.now() - t0) / 1000)} s`;
        const nothing = reads ? "no report arrived" : "nothing arrived";
        // The message that ended it, said in the words of how it reaches the agent — unless reports came with it, which
        // are said now: the message then ends the agent's next wait.
        const typed = got === "message" && !texts.length && mb ? mb.peek(ends) : null;
        if (typed) told.add(typed.id);
        const how = typed ? reach(typed) : null;
        if (typed && how === "step") await handOver(typed);
        const stopped = got === "command" && !texts.length ? running.filter((r) => gone.includes(r.id)) : [];
        const said = texts.length
          ? `Waited ${took}: ${texts.length === 1 ? "one message" : `${texts.length} messages`} from Filament:\n\n${texts.join("\n\n")}`
          : how === "reply"
            ? `Waited ${took}: the developer sent you a message, and it reaches you only as your next message: end your reply now — ${on} ${one ? "keeps" : "keep"} running, and Filament wakes you with it.`
            : how === "step"
              ? `Waited ${took}: the developer sent you a message — Filament hands it to you next.`
              : got === "stopped"
                ? `Waited ${took}: the turn is being stopped.`
                : stopped.length
                  ? `Waited ${took}: ${commandsNamed(stopped)} ${stopped.length === 1 ? "was stopped, so its result" : "were stopped, so their results"} will not come.`
                  : got === "look" && look != null
                    ? `Waited ${took}: your workers moved.`
                    : reads && look == null && got === "time"
                      ? `Waited ${took}: no report arrived, and no look is due. End your turn now: ${who} keep running, and Filament wakes you with each report, and with a look ${paceWords(door.inbox.pace?.())}.`
                      : limitMs < asked
                        ? `Waited ${took} and ${nothing}; ${on} ${one ? "is" : "are"} still running. A wait answers within ${Math.round(limitMs / 1000)} s here: end your turn when only waiting is left — Filament wakes you with ${!running.length ? "the reports" : owed ? "the reports and the commands' ends" : one ? "its end" : "their ends"}${reads ? ", and with a look when one is due" : ""}.`
                        : `Waited ${took} and ${nothing}; ${on} ${one ? "is" : "are"} still running. Call wait again, or carry on with other work.`;
        // A message that ended an earlier wait and still waits for the agent: said once more, at the end.
        const still = !typed && got !== "stopped" && !!mb?.peek((m) => told.has(m.id));
        return { said: still ? `${said} The developer's message still waits for you: end your reply to read it.` : said, look };
      } finally {
        ending?.off();
        stop.off();
        waitEnds = null;
        done();
      }
    },
    open(input, id = null) {
      // A letter to another chat or to a sub-agent of the session's, or an answer to one (letters.js, the owner's of
      // 11-04): sent, or refused in words.
      if (writesLetter(input)) {
        const r = door.inbox.letter?.(input) ?? null;
        if (!r) return "Not sent: this session sends no letters.";
        if (r.sent) emit({ type: "letter-sent", letter: r.sent.id, to: r.sent.to, title: r.sent.title, subject: r.sent.subject, reply: r.sent.reply, answer: input?.answer != null && String(input.answer).trim() !== "", ...(id ? { id } : {}) });
        note(r.sent ? `agent: letter ${r.sent.id} to ${r.sent.title} (${r.sent.to})` : `agent: a letter not sent — ${r.text}`);
        return r.text;
      }
      // A picture another agent drew, by its name (HarnessV4_DesignPass_Plan UX1): its code whole; the sealed results
      // stay sealed.
      if (typeof input?.picture === "string" && input.picture.trim()) {
        const p = door.inbox.picture?.(input.picture) || null;
        note(p?.found ? `agent: picture ${p.found.title} (${p.found.id}) opened` : `agent: no picture "${input.picture}" to open`);
        return pictureAnswer(input.picture, p, input?.all === true || Number(input?.count) > 0);
      }
      // The agent's own pick of when (EN-D2): the oldest sealed ones, whole, in the order they arrived.
      const opened = door.inbox.open?.({ count: input?.count, all: input?.all === true }) || [];
      for (const d of opened) {
        emit({ type: "envelope-opened", envelope: d.envelope, agentId: d.from, description: d.description, sender: d.sender || "", ...(d.via ? { via: d.via } : {}), by: "tool", ...(id ? { id } : {}) });
        emit({ type: "subagent-report", agentId: d.from, description: d.description, kind: d.kind, envelope: d.envelope });
      }
      if (opened.length) {
        note(`agent: envelope opened ${opened.map((d) => d.envelope).join(", ")}`);
        // Their lines not yet heard are out of date.
        const n = new Set(opened.map((d) => d.envelope));
        for (let i = pending.length - 1; i >= 0; i--) if (pending[i].kind === "envelope" && n.has(pending[i].envelope)) pending.splice(i, 1);
      }
      return envelopeAnswer(opened, door.inbox.sealed?.().length || 0);
    },
    seals: () => opens() && door.inbox.seals?.() !== false,
    remind() {
      if (reminded || !opens()) return null;
      const list = door.inbox.sealed?.() || [];
      const r = sealedReminder(list);
      if (!r) return null;
      reminded = true;
      emit({ type: "envelope-reminder", envelopes: list.map((e) => e.n) });
      note(`agent: ${list.length} envelope${list.length === 1 ? " was" : "s were"} still sealed as the turn would end — said once`);
      return r;
    },
    close() {
      // Words taken for the agent that its turn ended before it heard are the session's again: its next turn hears
      // them, as it does a report that never was taken (HarnessV4_Tasks B12) — but words on how things stood, which
      // that turn would read out of date.
      const unheard = pending.splice(0);
      const back = unheard.filter((d) => !fleeting.has(d));
      const dropped = unheard.length - back.length;
      door.inbox.back(back);
      door.close();
      if (back.length) note(`agent: ${back.length} message${back.length === 1 ? "" : "s"} from Filament never reached ${reader} — its turn ended first — and wait${back.length === 1 ? "s" : ""} for the session's next turn`);
      if (dropped) note(`agent: ${dropped} message${dropped === 1 ? "" : "s"} from Filament on how things stood never reached ${reader} — its turn ended first — and ${dropped === 1 ? "is" : "are"} dropped: by its next turn ${dropped === 1 ? "it" : "they"} would be out of date`);
      if (looks) note(`agent: ${reader} was shown ${looks} look${looks === 1 ? "" : "s"} at its workers; each stays in its own conversation, so each held only what was new since the one before`);
      ring();
    },
  };
}

/**
 * The sessions whose coding agent's turn holds a door into the registry now, by chain: a team's lead's, or a plain
 * chat's that launches Filament's sub-agents.
 * @returns {{ open: (chainId: string, turn: AgentTurn) => () => void, get: (chainId: string | null) => AgentTurn | null }}
 */
export function createAgentTurns() {
  /** @type {Map<string, AgentTurn>} */
  const turns = new Map();
  return {
    open(chainId, turn) {
      turns.set(chainId, turn);
      return () => {
        if (turns.get(chainId) === turn) turns.delete(chainId);
      };
    },
    get: (chainId) => (chainId ? turns.get(chainId) || null : null),
  };
}

// @ts-check
// The forked steer (the owner's of 11-04): a note the person types into the agent loop's running turn goes first to a
// fork of that turn — its context window as it stands: its system prompt and tools as sent, its messages up to its
// newest request read from the provider's cache, and what came back since — which weighs it while the agent works on. A correction of the work at hand goes into the mailbox as any note; a question the
// fork answers for the person, under their message; more work it plans as tasks proposed on the agent's graph, none
// started, with a letter the agent opens when it chooses. One note is weighed at a time, in the order they came. A note
// no fork can weigh — none could start, or the fork came to no verdict — goes straight in, as it would have unweighed.

import { clip } from "../../core/text.js";

/** @typedef {import("../../services/runs.js").SteerMessage} SteerMessage */
/** @typedef {import("../../services/runs.js").Mailbox} Mailbox */
/** @typedef {import("./subagents.js").Outcome} Outcome */
/**
 * @typedef {{ as: "correction" }
 *   | { as: "question", answer: string, letter: string }
 *   | { as: "work", plan: { goal: string, tasks: Record<string, unknown>[] } | null, letter: string }} Verdict
 *   a fork's final message as Filament reads it (`readVerdict`)
 */

/** The line a verdict starts with (subagents.js STEER_FORK_NOTE), bold or not. */
const VERDICT_LINE = /^[ \t]*(?:[*_#>]+[ \t]*)?verdict(?:[*_]+)?[ \t]*:[ \t]*(?:[*_]+[ \t]*)?(correction|question|work)\b[^\n]*$/im;
/** The line a letter to the agent starts with, its words after it on the line or below. */
const LETTER_LINE = /^[ \t]*(?:[*_#>]+[ \t]*)?letter(?:[*_]+)?[ \t]*:[ \t]*(?:[*_]+[ \t]*)?/im;
/** A fenced block of the plan, json or not said. */
const FENCED = /```[ \t]*(?:json)?[ \t]*\n([\s\S]*?)\n[ \t]*```/i;
/** What a proposed task may carry (core/task-graph.js PROPOSE_FIELDS), and its id. */
const TASK_KEYS = ["id", "name", "needs", "writes", "acceptance"];
/** The most a plan proposes in one message. */
const MOST_TASKS = 20;
/** How much of the person's message a letter's subject quotes. */
const QUOTED = 80;
/** How much of the person's message a graph it starts takes as its goal. */
const GOAL_CHARS = 300;

/**
 * A fork's final message read for its verdict (subagents.js STEER_FORK_NOTE): its kind, the answer for the person or
 * the letter for the agent, and the tasks it planned. Null where it gave none Filament can read — a question without an
 * answer, work with neither a plan nor a letter.
 * @param {string} report @returns {Verdict | null}
 */
export function readVerdict(report) {
  const text = String(report || "");
  const head = VERDICT_LINE.exec(text);
  if (!head) return null;
  const as = /** @type {"correction" | "question" | "work"} */ (head[1].toLowerCase());
  if (as === "correction") return { as };
  const body = text.slice(head.index + head[0].length);
  const at = LETTER_LINE.exec(body);
  const main = (at ? body.slice(0, at.index) : body).trim();
  const letter = at ? body.slice(at.index + at[0].length).trim() : "";
  if (as === "question") return main ? { as, answer: main, letter } : null;
  const plan = planOf(main);
  return plan || letter ? { as, plan, letter } : null;
}

/**
 * The tasks a work verdict planned, from its fenced block: a list of tasks, or `{ goal, tasks }`. Each keeps only what
 * a proposed task carries. Null where none can be read.
 * @param {string} words @returns {{ goal: string, tasks: Record<string, unknown>[] } | null}
 */
function planOf(words) {
  const block = FENCED.exec(words);
  if (!block) return null;
  /** @type {any} */
  let got;
  try {
    got = JSON.parse(block[1]);
  } catch {
    return null;
  }
  const list = Array.isArray(got) ? got : Array.isArray(got?.tasks) ? got.tasks : null;
  if (!list) return null;
  const tasks = list
    .filter((/** @type {unknown} */ t) => t && typeof t === "object" && !Array.isArray(t))
    .slice(0, MOST_TASKS)
    .map((/** @type {Record<string, unknown>} */ t) => Object.fromEntries(TASK_KEYS.filter((k) => t[k] !== undefined && t[k] !== null).map((k) => [k, t[k]])));
  if (!tasks.length) return null;
  return { goal: typeof got?.goal === "string" ? got.goal.trim() : "", tasks };
}

/**
 * The letter a weighed note becomes for the agent: what the person wrote, what the fork made of it — the tasks it
 * proposed, by id and name, or why the graph took none — and the fork's own words to the agent.
 * @param {string} said  the person's message
 * @param {Verdict} v
 * @param {{ ok: true, ids: string[] } | { ok: false, error: string } | null} proposed
 */
export function letterText(said, v, proposed) {
  const asked = `While you worked, the person wrote: "${said}"`;
  if (v.as === "question") return `${asked}\nIt was a question, and I answered it for them under their message:\n${v.answer}\n\n${v.letter}`;
  if (v.as !== "work") return asked;
  const tasks = v.plan?.tasks || [];
  const named = (/** @type {readonly string[]} */ ids) => ids.map((id) => `- ${id}: ${String(tasks.find((t) => String(t.id ?? "").toLowerCase() === id)?.name ?? "")}`).join("\n");
  const plan = !v.plan
    ? "It asks for more work, and I planned none of it as tasks."
    : proposed?.ok
      ? `It asks for more work. I planned it as tasks proposed on your graph — none started, none offered to run side by side — for you to take on when you reach a stopping point: start a task, or change it, to take it on; drop one that is not to be done.\n${named(proposed.ids)}`
      : `It asks for more work. I planned it as tasks, and your graph took none of them (${proposed ? proposed.error : "this chat keeps no graph"}): add them yourself if they are to be done.\n${tasks.map((t) => `- ${JSON.stringify(t)}`).join("\n")}`;
  return `${asked}\n${plan}${v.letter ? `\n\n${v.letter}` : ""}`;
}

/**
 * Whether the conversation a fork copies still starts with the newest request's messages, each the one sent — the loop
 * replaces a message, never edits one: a fold, or a result cleared since, replaced some, and the provider's cache then
 * holds none of the conversation as it is now, though that request was read from it.
 * @param {readonly unknown[] | null | undefined} sent  the newest request's messages, as it sent them
 * @param {readonly unknown[] | null | undefined} live  the loop's conversation as it stands
 */
export const startsWithSent = (sent, live) => !!sent && !!live && sent.length <= live.length && sent.every((m, i) => live[i] === m);

/**
 * Whether a fork may weigh a note of a running turn now (`weighAside`'s `can`): true, or why not in words — false
 * where the chat's switch is off and the person did not ask for a fork, which they are not told of note by note.
 * @param {{ off: boolean, lead: boolean, sent: readonly unknown[] | null, live: readonly unknown[] | null, pays: () => boolean }} s
 *   `sent`: the turn's newest request's messages, null before one came back whole; `pays`: it was read from the cache or
 *   wrote to it, within the cache's lifetime, and a fork of it carries at most half its line (subagents.js `forkPays`)
 * @returns {boolean | string}
 */
export function steerGate({ off, lead, sent, live, pays }) {
  if (off) return false;
  // As no task of a lead's graph starts as its fork.
  if (lead) return "a team's lead weighs no message aside";
  if (!sent) return "the turn's first request has not come back yet";
  if (!startsWithSent(sent, live)) return "the conversation was compacted since its newest request, and the provider's cache holds none of it as it is now";
  return pays() || "the provider's cache has gone cold, or a fork would carry more than half its line";
}

/**
 * A running turn's notes, weighed aside (the owner's forked steer of 11-04): set on the run's mailbox, which holds each
 * note it takes out of the loop's reads until its fork ends. `can` says whether a fork may start now — true where the
 * switch is on or the person asked for a fork (`asked`, the owner's of 11-05), the turn's newest request was read from
 * the cache or wrote to it, the conversation still starts with what that request sent, and the fork would carry at most
 * half its line; else false, or why not in words. It is asked as a note comes, and again as its turn in line comes: one
 * that waited behind another may find the cache gone cold, and goes in unweighed, saying why. A note the person asked a
 * fork for is held whatever it says as it comes, so the same words say why none weighed it. `close` — the turn's end —
 * stops the fork at work: the run's end marks what is still held unread, as any note it never read.
 * @param {object} d
 * @param {string} d.chainId
 * @param {Mailbox} d.mailbox
 * @param {{ launch: (spec: import("./subagents.js").LaunchSpec) => { ok: true, id: string, done: Promise<Outcome> } | { ok: false, error: string }, stop: (id: string, o: { from: string }) => unknown, letter: (chainId: string, l: { text: string, from: string, description: string, sender: string, subject: string, via?: "chat" | "steer" }) => unknown }} d.registry
 * @param {{ propose: (chainId: string, input: { goal?: string, tasks: unknown[] }) => { ok: true, ids: string[] } | { ok: false, error: string } } | null} d.graphs
 * @param {(o: { asked: boolean }) => boolean | string} d.can
 * @param {(level: string, msg: string) => void} [d.log]
 * @returns {{ close: () => void }}
 */
export function weighAside({ chainId, mailbox, registry, graphs, can, log = () => {} }) {
  /** The notes held, oldest first: the first is the one its fork weighs. @type {SteerMessage[]} */
  const line = [];
  /** The fork at work, and the note it weighs. @type {{ m: SteerMessage, agent: string } | null} */
  let now = null;
  let closed = false;
  /** The notes the person asked a fork for. @type {WeakSet<SteerMessage>} */
  const asked = new WeakSet();

  /** A note that goes in unweighed, or weighed to no end, with why. @param {SteerMessage} m @param {string} why @param {string | null} [agent] */
  const straight = (m, why, agent = null) => {
    mailbox.pass(m, { as: "straight", why, ...(agent ? { agent } : {}) });
    log("info", `steer fork: ${m.id} in ${chainId} went straight in — ${why}`);
  };
  /** Whether a fork may start now on a note: true, or why not in words — what cannot be read is a no. @param {SteerMessage} m */
  const gate = (m) => {
    try {
      const v = can({ asked: asked.has(m) });
      return v === true ? true : typeof v === "string" && v ? v : "no fork can start now";
    } catch (/** @type {any} */ e) {
      log("warn", `steer fork: whether a fork may start in ${chainId} could not be read (${e?.message || e})`);
      return `whether a fork may start could not be read: ${clip(String(e?.message || e), 200)}`;
    }
  };
  /** The next note held, to its fork — one at a time, each gated as its turn comes. */
  const next = () => {
    if (closed || now || !line.length) return;
    const m = line[0];
    const may = gate(m);
    if (may !== true) {
      line.shift();
      straight(m, may);
      return next();
    }
    /** @type {ReturnType<typeof registry.launch>} */
    let r;
    try {
      r = registry.launch({ origin: "self", chainId, view: "fork", may: "read", weighs: m.id, prompt: `The person's message, sent while the agent worked:\n\n${m.text}`, description: "Weighing your message", why: "you sent a message while the agent worked" });
    } catch (/** @type {any} */ e) {
      r = { ok: false, error: String(e?.message || e) };
    }
    if (!r.ok) {
      line.shift();
      straight(m, `no fork could weigh it: ${r.error}`);
      return next();
    }
    const agent = r.id;
    now = { m, agent };
    mailbox.weighs(m, { as: "weighing", agent });
    void r.done.then(
      (o) => ended(m, agent, o),
      (/** @type {any} */ e) => ended(m, agent, { status: "failed", ok: false, report: "", error: String(e?.message || e) }),
    );
  };
  /** A fork's end: what it made of the note, done — unless the note moved on without it (taken back, changed). @param {SteerMessage} m @param {string} agent @param {Pick<Outcome, "status" | "ok" | "report" | "error">} o */
  const ended = (m, agent, o) => {
    if (closed || now?.agent !== agent) return;
    now = null;
    const at = line.indexOf(m);
    if (at >= 0) line.splice(at, 1);
    try {
      verdict(m, agent, o);
    } catch (/** @type {any} */ e) {
      // A verdict Filament could not act on leaves no note held: the turn would wait for it to the end.
      log("warn", `steer fork: acting on ${agent}'s verdict on ${m.id} failed (${e?.message || e})`);
      straight(m, `Filament could not act on its fork's verdict: ${clip(String(e?.message || e), 200)}`, agent);
    } finally {
      next();
    }
  };
  /** @param {SteerMessage} m @param {string} agent @param {Pick<Outcome, "status" | "ok" | "report" | "error">} o */
  const verdict = (m, agent, o) => {
    if (o.status !== "done") return straight(m, `its fork ${o.status === "failed" ? "failed" : "did not finish"}${o.error ? `: ${clip(String(o.error), 200)}` : ""}`, agent);
    const v = readVerdict(o.report);
    if (!v) return straight(m, "its fork gave no verdict Filament could read", agent);
    if (v.as === "correction") {
      mailbox.pass(m, { as: "correction", agent });
      return;
    }
    // The tasks first, then the note off the queue, then the letter — in one step, so a turn that waited for the note
    // reads the letter at its next one. A chat with no graph open starts one, for the plan's goal, else the person's words.
    const plan = v.as === "work" && v.plan ? { goal: v.plan.goal || clip(m.text.replace(/\s+/g, " ").trim(), GOAL_CHARS), tasks: v.plan.tasks } : null;
    const proposed = plan ? (graphs ? graphs.propose(chainId, plan) : { ok: /** @type {const} */ (false), error: "this chat keeps no graph" }) : null;
    const tasks = proposed?.ok && v.as === "work" ? proposed.ids.map((id) => ({ id, name: String(v.plan?.tasks.find((t) => String(t.id ?? "").toLowerCase() === id)?.name ?? "") })) : [];
    const writes = v.as === "work" || !!v.letter;
    const letter = writes ? letterText(m.text, v, proposed) : "";
    const said = v.as === "question" ? { as: v.as, agent, answer: v.answer, ...(v.letter ? { letter } : {}) } : { as: v.as, agent, letter, ...(tasks.length ? { tasks } : {}) };
    if (!mailbox.settle(m, said)) return;
    if (!writes) return;
    const quoted = clip(m.text.replace(/\s+/g, " "), QUOTED);
    const subject = v.as === "work" ? `the person's message "${quoted}" asks for more work${tasks.length ? `: ${tasks.length === 1 ? "a task" : `${tasks.length} tasks`} proposed on your graph (${tasks.map((t) => t.id).join(", ")}), none started` : ""}` : `the person asked "${quoted}" and was answered under their message — what it changes for your work`;
    registry.letter(chainId, { text: letter, from: agent, description: "Weighing your message", sender: "the fork that weighed the person's message", subject, via: "steer" });
  };

  const off = mailbox.aside({
    take: (m, { asked: wants } = { asked: false }) => {
      if (closed) return false;
      // Whether a fork may start reads the session and the cache: a note no fork can weigh goes in as ever — one the
      // person asked a fork for is held, and its turn in line says why none could.
      if (wants) asked.add(m);
      else if (gate(m) !== true) return false;
      line.push(m);
      // Once the note is queued and said: its fork starts on the next step.
      queueMicrotask(next);
      return true;
    },
    changed: (m, how) => {
      // The fork on the old words stops; a note changed is weighed again, on its new words, in its place in line.
      if (now?.m === m) {
        const agent = now.agent;
        now = null;
        registry.stop(agent, { from: "filament" });
      }
      if (how === "drop") {
        const at = line.indexOf(m);
        if (at >= 0) line.splice(at, 1);
      }
      queueMicrotask(next);
    },
  });

  return {
    close() {
      if (closed) return;
      closed = true;
      off();
      if (now) registry.stop(now.agent, { from: "filament" });
      now = null;
      line.length = 0;
    },
  };
}

// @ts-check
// Letters between chats (the owner's of 11-04: "agents should be able to send a message to other threads … in form of
// an envelope so that agent decides to open that whenever it wants and main agent should be able to reply back to that
// envelope letter if reply is requested"): a chat's agent writes another chat a letter with its envelope tool; that
// chat's agent finds it sealed among its envelopes — at its next step while it works, or woken for it while it rests
// (subagents.js `letter`) — opens it when it chooses, and answers it where the letter asks for a reply. An agent writes
// without asking only to a chat the person tagged in its own chat, or one that wrote to it (the owner's pick of 11-04),
// or a thread that links the two (core/threads.js, the owner's of 11-11), or the chat a watcher of its own may guide
// while the person has it switched on (app/watchers/guidance.js); and a chat sends at most LETTERS_ALONE letters
// while its person says nothing in it — a thread's person is its starter's too —, so two agents never write each other
// on and on. What the rules read is kept on each chat's meta (`letters`): the chats its person tagged, the chats
// that wrote to it, its letters since its person last wrote, and the letters to it that wait for its reply. Whether a
// letter waits sealed is the registry's to say, from its chat's agent and settings.
// Inside a chat (the owner's of 11-04: "main agent and sub agent can talk to each other based on the problem and
// scenario"), its agent writes a sub-agent of its own that runs, by its id — the letter reaches it whole at its next
// step, as a message does — and a sub-agent writes the agent that launched it, `lead`, which finds it sealed among its
// envelopes as another chat's letter. Each answers the other's letter that asks for a reply; a sub-agent writes no
// other chat and no other sub-agent, and the chat's letters count against its LETTERS_ALONE whoever writes them. A
// sub-agent may wait in its letter's call for the reply (`wait`, at most LETTER_WAIT_MOST seconds): the reply is the
// call's result, and reaches it no other way.
import { randomBytes } from "node:crypto";
import { CHAT_LINK, codeBlanked } from "../services/agent-cards.js";
import { SUBJECT_CHARS, chatNamed } from "./agent/envelopes.js";

/** The most letters a chat sends while its person says nothing in it. Replies are not counted. */
export const LETTERS_ALONE = 20;
/** The longest letter, in characters. */
export const LETTER_CHARS = 20_000;
/** The longest a sub-agent waits in its letter's call for the reply, in seconds: as long as the wait tool's. */
export const LETTER_WAIT_MOST = 600;
/** The most chats each list of a chat's record keeps, and the most letters waiting for its reply: the newest. */
const KEPT = 100;

/**
 * A chat's record, as its meta keeps it. A letter that waits for a reply (`asks`) names the chat that wrote it; one
 * written inside the chat names its writer (`by`) and whom it went to (`for`), each a sub-agent's id — none for the
 * chat's own agent.
 * `threads`: the threads its agent started since its person last wrote in it (core/threads.js `THREAD_LIMITS`).
 * `guides`: the guidance its watchers sent it since its person last wrote in it (core/watchers.js `GUIDES_PER_MESSAGE`).
 * @typedef {{ from: string, subject: string, at: number, by?: string, for?: string }} Ask
 * @typedef {{ tagged: string[], wrote: string[], alone: number, threads: number, guides: number, asks: Record<string, Ask> }} LetterRecord
 */
/**
 * A sub-agent as letters reads it: the registry's view (subagents.js `get`).
 * @typedef {{ id: string, chainId: string, status: string, description: string, team: { role: string } | null }} AgentSeen
 */
/**
 * What the envelope tool asks of letters: a letter (`to`, `subject`, `text`, `reply`, and a sub-agent's `wait`) or an
 * answer to one (`answer`, `text`).
 * @typedef {{ to?: unknown, subject?: unknown, text?: unknown, reply?: unknown, answer?: unknown, wait?: unknown }} LetterInput
 */
/**
 * A sub-agent's wait in its letter's call for the reply: the letter, the seconds it waits, the reply once it comes —
 * signed, as its run would have read it — and `cancel`, which ends the wait, so a reply after goes into its run: false
 * where the reply was taken already.
 * @typedef {{ id: string, seconds: number, reply: Promise<string>, cancel: () => boolean }} ReplyWait
 */

/** @param {any} v @returns {LetterRecord} */
const recordOf = (v) => ({
  tagged: Array.isArray(v?.tagged) ? v.tagged.map(String) : [],
  wrote: Array.isArray(v?.wrote) ? v.wrote.map(String) : [],
  alone: Number.isInteger(v?.alone) && v.alone > 0 ? v.alone : 0,
  threads: Number.isInteger(v?.threads) && v.threads > 0 ? v.threads : 0,
  guides: Number.isInteger(v?.guides) && v.guides > 0 ? v.guides : 0,
  asks: v?.asks && typeof v.asks === "object" ? { ...v.asks } : {},
});
/** A list with `id` last, each once, the newest KEPT. @param {string[]} list @param {string} id */
const withNewest = (list, id) => [...list.filter((x) => x !== id), id].slice(-KEPT);

/**
 * The chats a person's message tags (`[title](chat:<id>)`), each once — never a tag inside code they pasted.
 * @param {unknown} text @returns {string[]}
 */
export function chatsTagged(text) {
  const out = new Set();
  for (const m of codeBlanked(text).matchAll(CHAT_LINK)) out.add(m[2]);
  return [...out];
}
/** A chat as a letter's words name it. @param {string} id @param {string} title */
export const chatWords = (id, title) => `the chat "${title || "untitled"}" (${id})`;
/** The most characters of a chat's name a letter's words carry. */
const NAME_CHARS = 60;
/**
 * A chat's name as the left bar has it: its title, else its first message's words — a chat tagged in them by its title
 * — on one line, cut to NAME_CHARS.
 * @param {{ title?: unknown, preview?: unknown }} c
 */
const nameOf = (c) => {
  const words = String(c.title || c.preview || "").replace(CHAT_LINK, (_, title) => String(title).replace(/\\(.)/g, "$1")).replace(/\s+/g, " ").trim();
  return words.length > NAME_CHARS ? `${words.slice(0, NAME_CHARS - 1)}…` : words;
};

/**
 * @param {{ archive: () => any, registry: () => any, guides?: (from: string, to: string) => boolean, log?: (level: string, msg: string) => void, now?: () => number, newId?: () => string }} deps
 *   `archive`: memory's, read at each call (chains' meta and titles); `registry`: the sub-agents' registry, which
 *   delivers (subagents.js `letter`, and `message` to a sub-agent) and knows a chat's sub-agents (`get`); `guides`:
 *   whether `from` is the chat a watcher wakes, or a run of it, and `to` the chat that watcher may guide now
 *   (app/watchers/guidance.js `mayWrite`)
 */
export function createLetters(deps) {
  const now = deps.now || Date.now;
  const newId = deps.newId || (() => `lt_${randomBytes(4).toString("hex")}`);
  const log = deps.log || (() => {});
  /** @param {string} chainId @returns {LetterRecord} */
  const read = (chainId) => recordOf(deps.archive()?.metaOf?.(chainId, ["letters"])?.letters);
  /** A chat's threads, as the archive links them (core/threads.js): its starter and those it started. @param {string} chainId @returns {string[]} */
  const threadsOf = (chainId) => {
    const t = deps.archive()?.threadsOf?.(chainId);
    return t ? [...(t.from ? [t.from] : []), ...t.started] : [];
  };
  /** Whether a thread links the two chats, either way. @param {string} a @param {string} b */
  const linked = (a, b) => threadsOf(a).includes(b);
  /** The letters whose writers wait in their call for the reply, by the letter's id: what takes the reply. @type {Map<string, (text: string) => void>} */
  const waiting = new Map();
  /** @param {string} chainId @param {(r: LetterRecord) => void} fn */
  const update = (chainId, fn) =>
    deps.archive()?.updateMeta?.(chainId, (/** @type {any} */ meta) => {
      const r = recordOf(meta.letters);
      fn(r);
      meta.letters = r;
    });
  /** @param {string} id @returns {{ title: string } | null} */
  const chainOf = (id) => {
    const c = deps.archive()?.getChain?.(id);
    return c ? { title: nameOf(c) } : null;
  };
  /** A letter that waits for a reply, kept on its chat's record: the newest KEPT. @param {LetterRecord} r @param {string} id @param {Ask} a */
  const keepAsk = (r, id, a) => {
    r.asks[id] = a;
    const ids = Object.keys(r.asks);
    for (const x of ids.slice(0, Math.max(0, ids.length - KEPT))) delete r.asks[x];
  };
  /** A sub-agent of the chat's, by its id; null where the chat has none of that id. @param {string} chainId @param {string} id @returns {AgentSeen | null} */
  const agentOf = (chainId, id) => {
    const sa = id ? deps.registry()?.get?.(id) : null;
    return sa && sa.chainId === chainId ? sa : null;
  };

  /**
   * One letter delivered: as the registry takes it, and recorded on the chat it went to — who wrote, and whether it
   * waits for a reply.
   * @param {{ id: string, from: string, to: string, subject: string, text: string, reply: boolean }} l
   */
  const deliver = (l) => {
    const sender = chatWords(l.from, chainOf(l.from)?.title || "");
    const got = deps.registry()?.letter?.(l.to, { text: l.text, from: l.from, description: chainOf(l.from)?.title || "a chat", sender, subject: l.subject });
    if (!got?.ok) return null;
    update(l.to, (r) => {
      r.wrote = withNewest(r.wrote, l.from);
      if (l.reply) keepAsk(r, l.id, { from: l.from, subject: l.subject, at: now() });
    });
    // A chat that has had no turn is woken by nothing (sessions/service.js): its first turn finds the letter.
    if (got.at !== "turn" && !(Number(deps.archive()?.newestTurnN?.(l.to)) > 0)) return "unstarted";
    return /** @type {"turn" | "sealed" | "queue"} */ (got.at);
  };
  /** How a letter went, in the sender's words. @param {"turn" | "sealed" | "queue" | "unstarted"} at */
  const wentWords = (at) =>
    at === "turn"
      ? "Its agent is at work: the letter reaches it at its next step."
      : at === "sealed"
        ? "Its agent was at rest: Filament wakes it, and it opens the letter when it chooses."
        : at === "queue"
          ? "Its agent was at rest, and its chat takes letters whole: Filament wakes it with the letter."
          : "That chat has had no turn yet: nothing wakes it, and its agent finds the letter once its person first writes there.";

  /** A sub-agent in a letter's words: `sub-agent sa_1 ("Audit")`, a team's worker by its role. @param {AgentSeen} sa */
  const agentWords = (sa) => `${sa.team ? sa.team.role : "sub-agent"} ${sa.id}${sa.description ? ` ("${sa.description}")` : ""}`;
  /** The agent that launched a sub-agent, as the sub-agent is told of it. @param {AgentSeen} sa */
  const leadWords = (sa) => (sa.team ? "your team's lead" : "the main agent");
  /** Whether a letter asks for a reply: true, or the words "true". @param {LetterInput} input */
  const replyOf = (input) => input.reply === true || String(input.reply).trim().toLowerCase() === "true";
  /** A letter's or a reply's words past the most a letter holds, said so; else "". @param {string} body @param {string} what */
  const tooLong = (body, what) => (body.length > LETTER_CHARS ? `Not sent: ${what} is ${body.length.toLocaleString("en-US")} characters, past the ${LETTER_CHARS.toLocaleString("en-US")} a letter holds. Say it shorter.` : "");
  /**
   * A letter's subject — its first line — and its words, or why it goes not.
   * @param {LetterInput} input @returns {{ subject: string, body: string, error?: undefined } | { error: string }}
   */
  const lettered = (input) => {
    const subject = String(input.subject ?? "").split("\n")[0].trim().slice(0, SUBJECT_CHARS);
    if (!subject) return { error: "Not sent: a letter needs a subject, in one line." };
    const body = String(input.text ?? "").trim();
    if (!body) return { error: "Not sent: the letter has no text." };
    const long = tooLong(body, "the letter");
    return long ? { error: long } : { subject, body };
  };
  /**
   * Why the chat sends no more letters now — LETTERS_ALONE since its person last wrote, whoever in it wrote them — or "".
   * @param {string} chainId @param {string} instead  what the writer does instead
   */
  const alone = (chainId, instead) => (read(chainId).alone >= LETTERS_ALONE ? `Not sent: this chat has sent ${LETTERS_ALONE} letters since the developer last wrote in it, the most it sends without them. ${instead}` : "");

  /**
   * The chat's agent writes one of its sub-agents that runs: the letter reaches it whole at its next step, as a message
   * does (subagents.js `message`) — sealing would only add a round trip to a run that ends with its report.
   * @param {string} chainId @param {AgentSeen} sa @param {LetterInput} input
   */
  const toAgent = (chainId, sa, input) => {
    if (sa.status !== "running") return { ok: false, text: `Not sent: ${agentWords(sa)} is not running, so nothing reaches it now. To tell it more, follow it up with Filament's agent tool, agent_id "${sa.id}".` };
    // Only one whose report comes to this agent (subagents.js `letterBar`).
    const bar = deps.registry()?.letterBar?.(sa.id) || "";
    if (bar === "weighs") return { ok: false, text: `Not sent: ${agentWords(sa)} weighs the developer's message apart from your work, and what it finds comes to you by itself.` };
    if (bar === "aside") return { ok: false, text: `Not sent: ${agentWords(sa)} is not one you launched — its report goes to the developer.` };
    if (bar === "waits") return { ok: false, text: `Not sent: you wait for ${agentWords(sa)}'s report now.` };
    const w = lettered(input);
    if (w.error !== undefined) return { ok: false, text: w.error };
    const many = alone(chainId, "Tell the developer what you would write, and wait for their word.");
    if (many) return { ok: false, text: many };
    const id = newId();
    const reply = replyOf(input);
    const footer = reply
      ? `[Filament: letter ${id}, "${w.subject}", from ${leadWords(sa)}. It asks for a reply: once you have one, send it with Filament's envelope tool — answer: "${id}", text: your reply.]`
      : `[Filament: letter ${id}, "${w.subject}", from ${leadWords(sa)}. It asks for no reply.]`;
    const m = toRun(chainId, sa, `${w.body}\n\n${footer}`);
    if (!m.ok) return { ok: false, text: `Not sent: ${m.error}.` };
    update(chainId, (r) => {
      r.alone += 1;
      if (reply) keepAsk(r, id, { from: chainId, subject: w.subject, at: now(), for: sa.id });
    });
    log("info", `letters: chat ${chainId}'s agent wrote letter ${id} to its sub-agent ${sa.id}${reply ? ", asking for a reply" : ""}`);
    const waits = reply ? " You asked for a reply: it comes back to you as a letter. Carry on meanwhile; its report still arrives when it finishes." : "";
    return { ok: true, text: `Sent: letter ${id} to ${agentWords(sa)}: ${readsWhen(m, "your letter")}.${waits}`, sent: { id, to: sa.id, title: sa.description || sa.id, subject: w.subject, reply } };
  };
  /**
   * Words into a running sub-agent's run, as its lead's (subagents.js `message`): read whole at its next step.
   * @param {string} chainId @param {AgentSeen} sa @param {string} text
   * @returns {{ ok: true, asking?: string | null, ask?: number | null, lead?: boolean } | { ok: false, error: string }}
   */
  const toRun = (chainId, sa, text) => deps.registry()?.message?.(sa.id, { chainId, text, from: sa.team ? "lead" : "agent" }) ?? { ok: false, error: "Filament is stopping" };
  /**
   * When a sub-agent reads what went into its run: at its next step, or after the answer its call waits for.
   * @param {{ asking?: string | null, ask?: number | null, lead?: boolean }} m @param {string} what
   */
  const readsWhen = (m, what) =>
    !m.asking
      ? `it reads ${what} whole at its next step, while it works`
      : m.lead
        ? `it waits for your answer to its question (ask ${m.ask}) now — give it with the worker tool's answer and ask — and reads ${what} whole at its next step after that`
        : `it waits for the developer's answer on a ${m.asking} call now, and reads ${what} whole at its next step after that answer`;

  /**
   * A sub-agent writes the agent that launched it: a letter into the chat's running turn, sealed among its envelopes, or
   * kept sealed for it at rest and the chat woken (subagents.js `letter`, via "agent").
   * @param {string} chainId @param {AgentSeen} sa  the writer @param {{ id: string, subject: string, text: string }} l
   */
  const deliverToLead = (chainId, sa, l) => {
    const got = deps.registry()?.letter?.(chainId, { text: l.text, from: sa.id, description: sa.description || sa.id, sender: `your ${agentWords(sa)}`, subject: l.subject, via: "agent" });
    return got?.ok ? /** @type {"turn" | "sealed" | "queue"} */ (got.at) : null;
  };
  /** How a sub-agent's letter went, in its words. @param {"turn" | "sealed" | "queue"} at */
  const wentLeadWords = (at) =>
    at === "turn"
      ? "It is at work: the letter reaches it at its next step, and it opens it when it chooses."
      : at === "sealed"
        ? "It was at rest: Filament wakes it, and it opens the letter when it chooses."
        : "It was at rest, and takes letters whole: Filament wakes it with the letter.";
  /**
   * @param {string} chainId @param {AgentSeen} sa  the writer @param {LetterInput} input
   * @param {boolean} canWait  its call can wait for the reply (the loop's own envelope call)
   */
  const toLead = (chainId, sa, input, canWait) => {
    const w = lettered(input);
    if (w.error !== undefined) return { ok: false, text: w.error };
    const many = alone(chainId, "Put what you would write in your report.");
    if (many) return { ok: false, text: many };
    const id = newId();
    const reply = replyOf(input);
    const seconds = reply && canWait && Number(input.wait) > 0 ? Math.min(LETTER_WAIT_MOST, Math.ceil(Number(input.wait))) : 0;
    const footer = seconds
      ? `[Filament: letter ${id}, from your ${agentWords(sa)}. It asks for a reply, and waits for it up to ${seconds} s: send it with Filament's envelope tool — answer: "${id}", text: your reply. Past its wait, your reply reaches it whole at its next step.]`
      : reply
        ? `[Filament: letter ${id}, from your ${agentWords(sa)}. It asks for a reply: once you have one, send it with Filament's envelope tool — answer: "${id}", text: your reply. Your reply reaches it whole at its next step, while it works.]`
        : `[Filament: letter ${id}, from your ${agentWords(sa)}. It asks for no reply.]`;
    const at = deliverToLead(chainId, sa, { id, subject: w.subject, text: `${w.body}\n\n${footer}` });
    if (!at) return { ok: false, text: `Not sent: Filament is stopping, and ${leadWords(sa)} takes no letter now.` };
    update(chainId, (r) => {
      r.alone += 1;
      if (reply) keepAsk(r, id, { from: chainId, subject: w.subject, at: now(), by: sa.id });
    });
    log("info", `letters: sub-agent ${sa.id} wrote letter ${id} to chat ${chainId}'s agent${seconds ? `, waiting up to ${seconds} s for a reply` : reply ? ", asking for a reply" : ""} (${at})`);
    const lead = leadWords(sa);
    const sent = { id, to: "lead", title: lead, subject: w.subject, reply };
    if (seconds) {
      /** @type {(text: string) => void} */
      let take = () => {};
      /** @type {Promise<string>} */
      const got = new Promise((r) => (take = r));
      waiting.set(id, take);
      /** @type {ReplyWait} */
      const hold = { id, seconds, reply: got, cancel: () => waiting.delete(id) };
      return { ok: true, text: `Sent: letter ${id} to ${lead}. ${wentLeadWords(at)}`, sent, waiting: hold };
    }
    const waits = reply ? " You asked for a reply: it reaches you whole at your next step, and may take a while. Carry on meanwhile — a reply that comes once you have reported reaches you no more." : "";
    return { ok: true, text: `Sent: letter ${id} to ${lead}. ${wentLeadWords(at)}${waits}`, sent };
  };

  /**
   * @param {string} from @param {LetterInput} input @param {string | null} agent  the sub-agent that writes; null for the chat's agent
   * @param {boolean} canWait  its call can wait for the reply
   */
  const letter = (from, input, agent, canWait) => {
    const named = String(input.to ?? "").trim();
    const writer = agent ? agentOf(from, agent) : null;
    if (agent && !writer) return { ok: false, text: `Not sent: ${agent} is no sub-agent of this chat's now.` };
    if (named.toLowerCase() === "lead")
      return writer ? toLead(from, writer, input, canWait) : { ok: false, text: 'Not sent: "lead" is the agent that launched a sub-agent, and you are this chat\'s own agent. Write a sub-agent of yours by its id, or another chat by its id.' };
    if (writer) return { ok: false, text: `Not sent: as ${agentWords(writer)} you write only to the agent that launched you — to: "lead".` };
    const sa = agentOf(from, named);
    if (sa) return toAgent(from, sa, input);
    if (/^sa_[0-9a-f]+$/i.test(named)) return { ok: false, text: `Not sent: this chat has no sub-agent ${named}.` };
    const to = chatNamed(input.to);
    if (!to) return { ok: false, text: "Not sent: `to` names no chat. Give the chat's id, as its tag [title](chat:<id>) carries it." };
    if (to === from) return { ok: false, text: "Not sent: that is this chat." };
    const target = chainOf(to);
    if (!target) return { ok: false, text: `Not sent: there is no chat ${to}.` };
    const w = lettered(input);
    if (w.error !== undefined) return { ok: false, text: w.error };
    const { subject, body } = w;
    const mine = read(from);
    if (!mine.tagged.includes(to) && !mine.wrote.includes(to) && !linked(from, to) && !deps.guides?.(from, to))
      return { ok: false, text: `Not sent: you write only to a chat the developer tagged in this chat, one that wrote to you, the chat your watcher may guide while it is switched on, or a thread linked to it, and ${chatWords(to, target.title)} is none of them. Ask the developer to tag it here with @.` };
    const many = alone(from, "Tell the developer what you would write, and wait for their word.");
    if (many) return { ok: false, text: many };
    const id = newId();
    const reply = replyOf(input);
    const footer = reply
      ? `[Filament: letter ${id}, from ${chatWords(from, chainOf(from)?.title || "")}. It asks for a reply: once you have one, send it with Filament's envelope tool — answer: "${id}", text: your reply. Your reply goes back to that chat as a letter.]`
      : `[Filament: letter ${id}, from ${chatWords(from, chainOf(from)?.title || "")}. It asks for no reply.]`;
    const at = deliver({ id, from, to, subject, text: `${body}\n\n${footer}`, reply });
    if (!at) return { ok: false, text: `Not sent: Filament is stopping, and ${chatWords(to, target.title)} takes no letter now.` };
    update(from, (r) => {
      r.alone += 1;
    });
    log("info", `letters: chat ${from} wrote ${to} letter ${id}${reply ? ", asking for a reply" : ""} (${at})`);
    const waits = reply ? " You asked for a reply: it comes to you as a letter, sealed like an envelope, and may take a while. Carry on meanwhile; with nothing else to do, end your turn — Filament wakes you with it." : "";
    return { ok: true, text: `Sent: letter ${id} to ${chatWords(to, target.title)}. ${wentWords(at)}${waits}`, sent: { id, to, title: target.title, subject, reply } };
  };

  /**
   * A reply to a letter that asked for one, by its addressee alone — the sub-agent it went to, or the chat's agent for
   * one to it, another chat's among them — back to whoever wrote it.
   * @param {string} from @param {LetterInput} input @param {string | null} agent  the sub-agent that answers; null for the chat's agent
   */
  const answer = (from, input, agent) => {
    const id = String(input.answer ?? "").trim();
    const asked = read(from).asks[id];
    if (!asked || (asked.for || null) !== agent) return { ok: false, text: `Not sent: no letter ${id || "of that id"} waits for your reply. Answer a letter that asked for one, by the id its last line gives.` };
    const body = String(input.text ?? "").trim();
    if (!body) return { ok: false, text: "Not sent: the reply has no text." };
    const long = tooLong(body, "the reply");
    if (long) return { ok: false, text: long };
    const subject = `Re: ${asked.subject}`.slice(0, SUBJECT_CHARS);
    const signed = (/** @type {string} */ by) => `${body}\n\n[Filament: the reply to your letter ${id} ("${asked.subject}"), from ${by}.]`;
    const answered = () =>
      update(from, (r) => {
        delete r.asks[id];
      });
    // A letter written inside the chat: back to its writer — the chat's agent, or the sub-agent while it runs.
    if (asked.from === from) {
      const writer = agent ? agentOf(from, agent) : null;
      if (writer) {
        const at = deliverToLead(from, writer, { id: newId(), subject, text: signed(`your ${agentWords(writer)}`) });
        if (!at) return { ok: false, text: `Not sent: Filament is stopping, and ${leadWords(writer)} takes no letter now.` };
        answered();
        log("info", `letters: sub-agent ${agent} answered letter ${id} from chat ${from}'s agent (${at})`);
        return { ok: true, text: `Sent: your reply to letter ${id}, to ${leadWords(writer)}. ${wentLeadWords(at)}`, sent: { id, to: "lead", title: leadWords(writer), subject, reply: false } };
      }
      const sa = agent ? null : agentOf(from, asked.by || "");
      if (!sa) return { ok: false, text: `Not sent: the sub-agent that wrote letter ${id} is gone.` };
      // It waits for it in its letter's call: the reply is that call's result.
      const take = waiting.get(id);
      if (take) {
        waiting.delete(id);
        answered();
        take(signed(leadWords(sa)));
        log("info", `letters: chat ${from}'s agent answered letter ${id} from its sub-agent ${sa.id}, which waited for it`);
        return { ok: true, text: `Sent: your reply to letter ${id}, to ${agentWords(sa)}: it waited for it, and reads it now.`, sent: { id, to: sa.id, title: sa.description || sa.id, subject, reply: false } };
      }
      if (sa.status !== "running") return { ok: false, text: `Not sent: ${agentWords(sa)} has finished, so nothing reaches it now. To tell it more, follow it up with Filament's agent tool, agent_id "${sa.id}".` };
      const m = toRun(from, sa, signed(leadWords(sa)));
      if (!m.ok) return { ok: false, text: `Not sent: ${m.error}.` };
      answered();
      log("info", `letters: chat ${from}'s agent answered letter ${id} from its sub-agent ${sa.id}`);
      return { ok: true, text: `Sent: your reply to letter ${id}, to ${agentWords(sa)}: ${readsWhen(m, "your reply")}.`, sent: { id, to: sa.id, title: sa.description || sa.id, subject, reply: false } };
    }
    const target = chainOf(asked.from);
    if (!target) return { ok: false, text: `Not sent: the chat that wrote letter ${id} is gone.` };
    const at = deliver({ id: newId(), from, to: asked.from, subject, text: signed(chatWords(from, chainOf(from)?.title || "")), reply: false });
    if (!at) return { ok: false, text: `Not sent: Filament is stopping, and ${chatWords(asked.from, target.title)} takes no letter now.` };
    answered();
    log("info", `letters: chat ${from} answered letter ${id} to ${asked.from} (${at})`);
    return { ok: true, text: `Sent: your reply to letter ${id}, to ${chatWords(asked.from, target.title)}. ${wentWords(at)}`, sent: { id, to: asked.from, title: target.title, subject, reply: false } };
  };

  return {
    /**
     * A message of the person's reached their chat — one that begins a turn, or one steered into a turn that runs: the
     * chats it tags are the agent's to write to, and its letters since they last wrote start again from none — as do
     * the threads its agent started and the guidance its watchers sent it.
     * @param {string} chainId @param {unknown} typed
     */
    heard(chainId, typed) {
      const tags = chatsTagged(typed).filter((id) => id !== chainId);
      const r = read(chainId);
      // The threads its agent started work for this chat, where the person is: their letters count from none again too.
      for (const id of deps.archive()?.threadsOf?.(chainId)?.started || [])
        if (read(id).alone > 0)
          update(id, (x) => {
            x.alone = 0;
          });
      if (!tags.length && r.alone === 0 && r.threads === 0 && r.guides === 0) return;
      update(chainId, (x) => {
        for (const id of tags) x.tagged = withNewest(x.tagged, id);
        x.alone = 0;
        x.threads = 0;
        x.guides = 0;
      });
    },
    /** The threads a chat's agent started since its person last wrote in it. @param {string} chainId */
    threadsAlone: (chainId) => read(chainId).threads,
    /**
     * A thread its agent starts, counted until its person writes again — where it has started fewer than `most` since
     * they last did: looked at and counted in one step, so starts that run side by side take a slot each and none past
     * the last. False where none is left: nothing is counted.
     * @param {string} chainId @param {number} most
     */
    threadStarted(chainId, most) {
      let took = false;
      update(chainId, (x) => {
        if (x.threads >= most) return;
        x.threads += 1;
        took = true;
      });
      return took;
    },
    /** A thread counted that did not start after all (app/threads.js): its slot is given back. @param {string} chainId */
    threadDropped(chainId) {
      if (read(chainId).threads > 0)
        update(chainId, (x) => {
          x.threads -= 1;
        });
    },
    /** The guidance a chat's watchers sent it since its person last wrote in it. @param {string} chainId */
    guidesAlone: (chainId) => read(chainId).guides,
    /**
     * A watcher's guidance sent to a chat, counted until its person writes there again — where fewer than `most` were
     * sent since they last did, whoever sent them: looked at and counted in one step, as a thread's start is. False
     * where none is left: nothing is counted.
     * @param {string} chainId @param {number} most
     */
    guideSent(chainId, most) {
      let took = false;
      update(chainId, (x) => {
        if (x.guides >= most) return;
        x.guides += 1;
        took = true;
      });
      return took;
    },
    /** A guidance counted that did not go after all (app/watchers/guidance.js): its slot is given back. @param {string} chainId */
    guideDropped(chainId) {
      if (read(chainId).guides > 0)
        update(chainId, (x) => {
          x.guides -= 1;
        });
    },
    /**
     * The envelope tool's letter, or its answer to one: sent, or refused in words. `waits`: the call can wait for the
     * reply — a sub-agent's own envelope call, whose letter's `wait` then gives `waiting`, which its caller ends.
     * @param {string} from  the writing chat @param {LetterInput} input
     * @param {{ agent?: string | null, waits?: boolean }} [o]  `agent`: the sub-agent of the chat that writes; none for the chat's agent
     * @returns {{ ok: boolean, text: string, sent?: { id: string, to: string, title: string, subject: string, reply: boolean }, waiting?: ReplyWait }}
     */
    send(from, input, { agent = null, waits = false } = {}) {
      const by = agent ? String(agent) : null;
      return input.answer != null && String(input.answer).trim() ? answer(from, input, by) : letter(from, input, by, waits === true);
    },
  };
}

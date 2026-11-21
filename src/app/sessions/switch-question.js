// @ts-check
// The question a switch asks before its first message (HarnessV4_Tasks A7). The chat's last turn ran on another
// upstream — another account of the same coding agent, or another model — so this message starts the agent's fresh
// session from Filament's copy of the chat: the newest compaction's summary, then the turns since, in the form the
// person chooses on the card (`context.carry`'s forms). Back on an agent whose session of the chat is still up, it goes
// on in that session instead, handed the turns it missed in that form. It is asked every time: what the session will
// hold is the person's to see before it is sent. Where the account changed, on the same model or another, the turns go
// whole unless the card says less — what the session on the other account held, every call one of the same agent's
// tools, but its thinking, which Filament never keeps (the owner's of 11-08, G7).
// A switch into a model Filament calls — from a coding agent, or from another model — asks too (`loop`; the owner's of
// 11-08): its instructions and tools are built for the model now, and it reads the conversation from Filament's copy.
// Where the model that answered last can write a summary first (`handoff`), the card offers it: from its cache while it
// is warm, for the new one to start from — only where that summary would leave the chat smaller (the owner's of 11-09).

/**
 * What the model that answered last can write before the chat moves on, the head Filament's copy starts from:
 * Filament's summary by the loop's model (`summary`), or written by a coding agent in the session it holds (`self`);
 * `by` its name, `cache` its cache's clock as the message was sent (null where nothing says).
 * @typedef {{ way: "summary" | "self", by: string,
 *   cache: { state: "warm" | "cold" | "none", idleMs: number, ttlMs: number, leftMs: number } | null }} Handoff
 */

/**
 * One side of the switch: the upstream, its name as the page says it, and the model it was sent (the turn's facts'
 * `model`; for the side switched to, the name its route renders).
 * @typedef {{ upstream: string, name: string, model: string | null }} SwitchSide
 */

/**
 * The question. `account`: both sides are logins of the same agent (`agentKey`); `sameModel`: and the model sent is
 * the same. `resumes`: the side switched to still has its session of the chat, and goes on in it. `compacted`: a
 * compaction stands, so the copy starts from its summary. `suggested`: the form the card chooses first, and the turn's
 * own where the message goes without the card (Send as it is); `session`: the session's choice (`context.carry`).
 * `window`/`usable`: the window of the side switched to and the session's line in it; `own`: what that agent's own
 * prompt and tools take, as a turn of it measured last — the card weighs each form with it. `handoff`: what the model
 * that answered last can write first, or null — none where its summary would leave the chat no smaller.
 * `loop`: the side switched to is a model Filament calls, which reads the copy as composed — no form to choose —,
 * `held` what that weighs, `fromAgent` where a coding agent answered last, `answeredBefore` where the model switched to
 * answered an earlier turn of the chat (what it cached then may still be warm); asked only where a handoff can be
 * written, `suggested` is then "send", or "handoff" where the copy does not fit under the line. `handed`: from a coding
 * agent, what the handover will carry (`handedOf`), read from the handover itself.
 * @typedef {{ from: SwitchSide, to: SwitchSide, account: boolean, sameModel: boolean, resumes: boolean, compacted: boolean,
 *   suggested: string, session: string, window: number | null, usable: number | null, own: number | null,
 *   handoff?: Handoff | null, loop?: boolean, fromAgent?: boolean, answeredBefore?: boolean, held?: number | null, handed?: Handed[] }} SwitchQuestion
 */

/**
 * A part of what the model the chat moves to is handed (sessions/reattach.js `handoverFor`).
 * @typedef {"files" | "plan" | "graph" | "open" | "letters" | "skills"} Handed
 */

/** Each part in the card's words, in the handover's order. @type {Record<Handed, string>} */
const HANDED_WORDS = {
  files: "the files the work used most recently",
  plan: "the plan",
  graph: "the task graph",
  open: "what is still open",
  letters: "the letters opened before the move",
  skills: "the names of the skills loaded before the move",
};

/**
 * What a handover carries (`handoverFor`'s), part by part: the card says that, and nothing it does not (the bug hunt of
 * 11-09: it said the plan, the task graph and what is still open whatever the handover held, and never its files or skills).
 * @param {{ files: readonly unknown[], plan: boolean, graph: boolean, open: number, letters: number, skills: number }} h
 * @returns {Handed[]}
 */
export const handedOf = (h) => {
  /** @type {[Handed, unknown][]} */
  const parts = [["files", h.files.length], ["plan", h.plan], ["graph", h.graph], ["open", h.open], ["letters", h.letters], ["skills", h.skills]];
  return parts.filter(([, on]) => !!on).map(([part]) => part);
};

/**
 * What a handover carries in the words of its turn's record: each part `handedOf` names, with how many where it counts
 * them (the bug hunt of 11-09: a handover with no file, plan, task graph or open line was "the skills loaded", letters
 * alone among them).
 * @param {Parameters<typeof handedOf>[0]} h
 */
export const handedNote = (h) => {
  const many = (/** @type {number} */ n, /** @type {string} */ what) => `${n} ${what}${n === 1 ? "" : "s"}`;
  /** @type {Record<Handed, string>} */
  const said = { files: many(h.files.length, "file"), plan: "the plan", graph: "the task graph", open: `${h.open} open`, letters: many(h.letters, "letter"), skills: many(h.skills, "skill") };
  return handedOf(h).map((p) => said[p]).join(", ");
};

/** A side with its model, where its name does not say it already. @param {SwitchSide} s */
const withModel = (s) => (s.model && s.model !== s.name ? `${s.name} on ${s.model}` : s.name);

/**
 * The question in words: what the refusal says, and what the card opens with — the switch, then what happens now.
 * @param {SwitchQuestion} q
 */
export function switchWords(q) {
  const to = q.to.name;
  const copy = q.compacted ? "the summary of the newest compaction, then every turn since" : "every turn so far";
  const h = q.handoff;
  const handoff = h ? ` ${h.by} can write a summary of it first${h.cache?.state === "warm" ? ", from its cache while it is still warm" : ""}, for ${to} to start from.` : "";
  if (q.loop) {
    // Filament's loop builds its instructions and tools for the model; a model it calls without its loop takes none, and
    // a coding agent's calls reach it with their results, in whatever form its request carries them.
    const loop = q.to.upstream === "agent-loop";
    const parts = (q.handed || []).map((p) => HANDED_WORDS[p]);
    const handed = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts.join("");
    const reads = q.fromAgent
      ? `it reads the conversation from Filament's copy: ${copy}, ${loop ? `${q.from.name}'s tool calls in its own tools` : `${q.from.name}'s tool calls with their results`}${handed ? `, and is handed ${handed}` : ""}. ${q.from.name}'s thinking stays behind.`
      : `it reads the conversation from Filament's copy as it stands: ${copy}, every call with its result.`;
    const cached = q.answeredBefore ? "" : ` Nothing of the chat is cached on ${to} yet.`;
    return `You switched to ${withModel(q.to)} from ${withModel(q.from)}. ${loop ? `Its instructions and tools are built for it now, and ${reads}` : reads.replace(/^./, (c) => c.toUpperCase())}${cached}${handoff}`;
  }
  const what = q.account
    ? q.sameModel
      ? `You switched accounts: ${to} takes over from ${q.from.name}, on the same model${q.to.model ? ` (${q.to.model})` : ""}.`
      : `You switched accounts and models: ${withModel(q.to)} takes over from ${withModel(q.from)}.`
    : `You switched to ${withModel(q.to)} from ${withModel(q.from)}.`;
  const form = q.account ? "whole unless you choose less below: your words, the agent's, and every tool call with its result" : "in the form you choose below";
  if (q.resumes) return `${what} ${to} still has its own session of this chat from before: it goes on in it now, and Filament hands it the turns it missed from its own copy, ${form}.${handoff}`;
  return `${what} It starts a new session of this chat now, and Filament hands it the conversation from its own copy: ${copy}, ${form}. The agent's thinking stays behind, and nothing of the chat is cached on ${q.account ? "this account" : to} yet.${handoff}`;
}

// @ts-check
// What Filament gives a coding agent's session besides the person's words (HarnessV3-ACP AC4-1, AC-D10), as each
// bridge hands it over. The blocks that stand for the whole session go through the agent's own system channel where it
// has one — Claude's `_meta.systemPrompt.append`, Codex's developer instructions — when the session opens, else ahead
// of its first prompt. What changes later goes ahead of the next prompt as an update, said once. The blocks for one
// prompt (memory's recall) go after the person's words, where memory places them for every model. A prompt that is the
// agent's own command is never wrapped: what waits goes with the next prompt.
import { createHash } from "node:crypto";
import { estimateTokens } from "../../core/tokens.js";

/**
 * @typedef {object} ContextBlock  one thing Filament gives a session
 * @property {string} id  what it is, the same from turn to turn: `briefing`, `goal`, `tasks`, `skills`
 * @property {string} text  the block as the agent reads it
 * @property {string} [gone]  what the agent is told when it leaves the session
 * @property {string} [tool]  the Filament tool it is about: it stands only in a session given that tool
 * @property {string} [held]  its text where the agent's own sub-agent tool is held back beside Filament's: a bridge
 *   says it where the agent's adapter holds it, which the agent declares as it starts, after the turn built its blocks
 * @property {string[]} [sameAs]  a prompt block's: texts that say what it says, so a history that goes with the same
 *   prompt — a fresh session's seed, the turns it catches up on — and holds one says it already (`notHeldIn`)
 * @property {string[]} [allIn]  a prompt block's: texts that say it between them, so a history that holds every one says
 *   it already — a list whose lines another block of the history names one by one
 */
/**
 * @typedef {object} AgentContext  what one turn gives the agent: the blocks that stand for the session, and the ones
 *   for its prompt alone
 * @property {ContextBlock[]} standing
 * @property {ContextBlock[]} prompt
 * @property {ContextBlock[]} [seeded]  the blocks for its prompt where that prompt opens a new session from Filament's
 *   copy of the chat (the bridge's seed), in place of `prompt`: what is said to a session that goes on may be untrue of
 *   one that begins — that it compacted its context —, and the seed may say the rest already (`promptFor`)
 */
/** @typedef {{ hash: string, gone: string }} Had */
/**
 * @typedef {object} ContextState  what a session has of Filament's context, kept on its conversation
 * @property {Record<string, Had>} sys  what its system channel has carried since it opened
 * @property {Record<string, Had>} said  what was said ahead of its prompts since
 */
/**
 * @typedef {object} ContextUpdate  what a prompt says of the standing context
 * @property {string} text
 * @property {string[]} added  the blocks it says in full: new to the session, or changed
 * @property {string[]} removed  the blocks it says are gone
 * @property {boolean} whole  the session had none of the context, so it says all of it
 */
/**
 * @typedef {object} GivenRecord  what a turn gave the session of Filament's context, on its record
 * @property {string[]} [system]  the blocks the agent's system channel took as the session opened this turn
 * @property {{ added: string[], removed: string[], whole: boolean }} [said]  the update ahead of the prompt
 * @property {string[]} [recall]  the blocks after the person's words
 * @property {string[]} [held]  the blocks the prompt went without, as the seed or catch-up it carried says them
 *   already (`notHeldIn`): heard with it all the same
 * @property {number} tokens  their weight, estimated
 */

/** The task graph's tool, whose words stand in the context of a session given it (AC4-5). */
export const GRAPH_TOOL = "tasks";
/** Filament's agent tool in a plain chat (HarnessV4_Tasks E12 step 2): its words stand where the session was given it. */
export const LAUNCH_TOOL = "agent";
/**
 * Filament's envelope tool (HarnessV4_Envelopes_Plan EN3), beside a plain chat's wait and a lead's: the list of the
 * envelopes still sealed goes with a prompt where the session was given it.
 */
export const ENVELOPES_TOOL = "envelope";
/** Filament's skill tool (HarnessV4_Skills_Plan S1-1): the chat's skills, named where the session was given it. */
export const SKILLS_TOOL = "skill";

/**
 * The words ahead of the standing context: whose it is, how to read its blocks, and that the person's messages are the
 * instructions. Its memory blocks are claims to check, save where one says otherwise — the goal the person set, their
 * own rules in the briefing — and its context blocks its instructions (the owner's prompt pass of 11-08: "background
 * unless a block says otherwise" made the task graph's block background, as only the agents block said otherwise).
 */
export const CONTEXT_HEAD =
  "Filament, the harness the person works with you through, keeps their memory, their skills and this session's task graph. What it gives this session follows: its memory blocks are background, leads to check before you act on them, save where a block says otherwise, and its context blocks are its instructions for this session. The person's messages are your instructions, over all of it. A sub-agent you start sees none of it: tell it what it needs.";
/** The words ahead of a change to it. */
export const UPDATE_HEAD = "Filament's context for this session changed since your last message:";

/** @param {string} text */
const hashOf = (text) => createHash("sha256").update(text).digest("hex").slice(0, 16);
/** @param {ContextBlock} b @returns {Had} */
const had = (b) => ({ hash: hashOf(b.text), gone: String(b.gone || `No longer in force: ${b.id}.`) });

/** A session that has none of the context yet. @returns {ContextState} */
export const contextState = () => ({ sys: {}, said: {} });

/**
 * The state a conversation keeps, read back from wherever it was kept (the sessions file holds it across a restart).
 * @param {any} v @returns {ContextState}
 */
export function stateOf(v) {
  /** @param {any} m @returns {Record<string, Had>} */
  const map = (m) =>
    Object.fromEntries(
      Object.entries(m && typeof m === "object" ? m : {}).filter(([, x]) => x && typeof x.hash === "string").map(([k, x]) => [k, { hash: x.hash, gone: String(x.gone || "") }]),
    );
  return { sys: map(v?.sys), said: map(v?.said) };
}

/**
 * Whether a session was given the Filament tool a block is about: the task graph's, a plain chat's agent tool, the
 * envelope tool — a plain chat's or a team's lead's (`team`) — or the skill tool.
 * @param {{ graph: boolean, launch: boolean, team?: boolean, skills?: boolean }} has
 * @returns {(tool: string) => boolean}
 */
export const givenTools = (has) => (tool) =>
  tool === GRAPH_TOOL ? has.graph : tool === LAUNCH_TOOL ? has.launch : tool === ENVELOPES_TOOL ? has.launch || has.team === true : tool === SKILLS_TOOL ? has.skills === true : false;

/**
 * The standing blocks a session takes: one about a Filament tool stands only where the session was given the tool, in
 * its `held` words where the agent's own sub-agent tool is held back (`held`).
 * @param {AgentContext | null | undefined} context @param {(tool: string) => boolean} given @param {boolean} [held]
 * @returns {ContextBlock[]}
 */
export const standingFor = (context, given, held = false) =>
  (context?.standing || []).filter((b) => !b.tool || given(b.tool)).map((b) => (held && b.held ? { ...b, text: b.held } : b));
/**
 * The blocks for one prompt a session takes, by the same rule — those for a session that begins from Filament's copy
 * of the chat where this prompt carries its seed (`seeded`) and the turn gave any. @param {AgentContext | null | undefined} context
 * @param {(tool: string) => boolean} given @param {boolean} [seeded]
 */
export const promptFor = (context, given, seeded = false) => ((seeded && context?.seeded) || context?.prompt || []).filter((b) => !b.tool || given(b.tool));
/**
 * The prompt's blocks less those the history that goes with it says already (`sameAs`): where the agent stands on its
 * task graph, which a summary's block at the head of a fresh session's seed brought back — said once, as the loop's
 * turn start says it after a summary's head (loop.js `whereHeld`) — and those it says line by line (`allIn`): the
 * skills a coding agent had loaded, where a summary's block in the seed names every one. `held`: the ids left out.
 * @param {ContextBlock[]} blocks @param {string} history  the history's text, "" for none
 */
export const notHeldIn = (blocks, history) => {
  const holds = (/** @type {ContextBlock} */ b) => !!history && ((b.sameAs || []).some((s) => !!s && history.includes(s)) || (!!b.allIn?.length && b.allIn.every((s) => !!s && history.includes(s))));
  return { blocks: blocks.filter((b) => !holds(b)), held: blocks.filter(holds).map((b) => b.id) };
};

/** The standing context as one text: its head, then each block. "" for none. @param {ContextBlock[]} blocks */
export const standingText = (blocks) => (blocks.length ? [CONTEXT_HEAD, ...blocks.map((b) => b.text.trim())].join("\n\n") : "");

/**
 * A session opened with the standing context in its system channel (`_meta.systemPrompt.append`, Codex's developer
 * instructions): the channel carries all of it now, and nothing said ahead of a prompt is needed any more.
 * @param {ContextState} state @param {ContextBlock[]} blocks
 */
export function openedWith(state, blocks) {
  state.sys = Object.fromEntries(blocks.map((b) => [b.id, had(b)]));
  state.said = {};
}

/**
 * The agent compacted its own context: what was said ahead of its prompts may be summarised away, so it is said
 * again; what its system channel carries stays.
 * @param {ContextState} state
 */
export function compacted(state) {
  state.said = {};
}

/**
 * An agent session compacted its own context (HarnessV3-ACP AC4-1, AC-R4): Filament's context said ahead of its prompts
 * is said again, and so is steering, said once per session — the summary may have dropped either.
 * @param {{ given?: ContextState | null, steerSaid?: boolean }} conv
 */
export function agentCompacted(conv) {
  if (conv.given) compacted(conv.given);
  conv.steerSaid = false;
}

/**
 * What the next prompt says of the standing context, against what the session has: all of it when it has none (the
 * first prompt of an agent with no system channel), else the blocks new or changed since, whole, and a line for each
 * that went — in the words it came with. Null when nothing changed.
 * @param {ContextState} state @param {ContextBlock[]} blocks
 * @returns {ContextUpdate | null}
 */
export function contextUpdate(state, blocks) {
  const known = { ...state.sys, ...state.said };
  const added = blocks.filter((b) => known[b.id]?.hash !== hashOf(b.text));
  const removed = Object.keys(known).filter((id) => !blocks.some((b) => b.id === id));
  if (!added.length && !removed.length) return null;
  const whole = !Object.keys(known).length;
  const text = whole
    ? standingText(blocks)
    : [UPDATE_HEAD, ...added.map((b) => b.text.trim()), ...removed.map((id) => known[id].gone)].join("\n\n");
  return { text, added: added.map((b) => b.id), removed, whole };
}

/**
 * The update reached the agent: its blocks are the session's now, said ahead of a prompt; the ones it said went are
 * gone from both. Where the agent compacted its context after the prompt (`compactedSince`), its summary may have
 * dropped the blocks, so they are not the session's: the next prompt says them again (HarnessV3-ACP AC-R4).
 * @param {ContextState} state @param {ContextBlock[]} blocks @param {ContextUpdate} update @param {boolean} [compactedSince]
 */
export function said(state, blocks, update, compactedSince = false) {
  for (const id of update.removed) {
    delete state.sys[id];
    delete state.said[id];
  }
  if (compactedSince) return;
  for (const b of blocks) if (update.added.includes(b.id)) state.said[b.id] = had(b);
}

/**
 * What a turn gave the session, for its record: the blocks its system channel took as the session opened (`opened`,
 * null when no open took any), the update said ahead of the prompt, and the recall after the person's words. Null
 * when it gave nothing. `held`: the ids of the blocks its seed or catch-up held already (`notHeldIn`).
 * @param {{ opened: ContextBlock[] | null, update: ContextUpdate | null, recall: ContextBlock[], held?: readonly string[] }} o
 * @returns {GivenRecord | null}
 */
export function givenRecord({ opened, update, recall, held = [] }) {
  if (!opened?.length && !update && !recall.length && !held.length) return null;
  const tokens = estimateTokens([...(opened || []).map((b) => b.text), update?.text || "", ...recall.map((b) => b.text)].join("\n\n"));
  return {
    ...(opened?.length ? { system: opened.map((b) => b.id) } : {}),
    ...(update ? { said: { added: update.added, removed: update.removed, whole: update.whole } } : {}),
    ...(recall.length ? { recall: recall.map((b) => b.id) } : {}),
    ...(held.length ? { held: [...held] } : {}),
    tokens,
  };
}

/** Whether the turn said any of it itself — not only blocks its seed held — which its record's line says. @param {GivenRecord} g */
export const givenSays = (g) => !!(g.system || g.said || g.recall);

/**
 * The record's line for it. @param {string} who  the bridge's name @param {GivenRecord} g
 * @param {string} [channel]  the agent's system channel, in words: none for an agent without one
 */
export function givenNote(who, g, channel = "") {
  const parts = [];
  if (g.system) parts.push(`${g.system.join(", ")} in ${channel}`);
  if (g.said)
    parts.push(
      g.said.whole
        ? `${g.said.added.join(", ")} ahead of the prompt`
        : `ahead of the prompt: ${[...g.said.added.map((id) => `${id} new or changed`), ...g.said.removed.map((id) => `${id} gone`)].join(", ")}`,
    );
  if (g.recall) parts.push(`memory's ${g.recall.join(", ")} after the person's words`);
  return `${who}: Filament's context — ${parts.join("; ")} (~${g.tokens} tokens)`;
}

/**
 * The name the person's words give as a command (`/compact fast` → "compact"): their first word is a slash and a name.
 * Null for other words (`/usr/bin is broken`), and for none. Whether the agent has the command is `isAgentCommand`'s.
 * @param {string | null | undefined} text
 * @returns {string | null}
 */
export function commandNameOf(text) {
  const m = /^\/([A-Za-z][\w:.-]*)(?:\s|$)/.exec(String(text || "").trimStart());
  return m ? m[1] : null;
}

/**
 * Whether the person's words are one of the agent's own commands (`/compact`): the first word is a slash and a name the
 * agent published. An agent that published none has none, and `/usr/bin is broken` is words.
 * @param {string} text @param {readonly (string | { name?: string })[] | null | undefined} commands
 */
export function isAgentCommand(text, commands) {
  const name = commandNameOf(text);
  if (!name || !Array.isArray(commands)) return false;
  return commands.some((c) => (typeof c === "string" ? c : c?.name) === name);
}

/**
 * The prompt's blocks after the person's words, as memory places them for every model. @param {string} text
 * @param {ContextBlock[]} blocks
 */
export const withPromptBlocks = (text, blocks) => (blocks.length ? [text, ...blocks.map((b) => b.text.trim())].join("\n\n") : text);

/**
 * Words ahead of the prompt, set apart from it as Filament's other wrappers are. @param {string} words @param {string} text
 */
export const ahead = (words, text) => (words ? `${words}\n\n---\n${text}` : text);

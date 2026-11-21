// @ts-check
// An agent's profile (HarnessV3-ACP AC0-1) in the page's words: each capability, whether the agent declared it, and
// what that means in Filament today, said for the agent that has it and for the one that lacks it. DOM-free; the
// cheat sheet on Destinations and the Agents tab draw it.

/**
 * A profile as the server sends it (an offer's `profile`, `GET /api/acp/profiles`): the fields the rows read.
 * @typedef {{
 *   sessions: { load: boolean, list: boolean, resume: boolean, fork: boolean, close: boolean, delete: boolean,
 *     additionalDirectories: boolean, subagents: boolean },
 *   prompt: { image: boolean, audio: boolean, embeddedContext: boolean },
 *   mcp: { http: boolean },
 *   steering: boolean,
 *   cancelKeepsWork?: boolean,
 *   promptQueueing: boolean,
 *   rawMessages: boolean,
 *   reportsCompaction?: boolean,
 *   account?: boolean,
 * }} AgentProfile
 */
/** @typedef {{ key: string, word: string, has: boolean, means: string }} SupportRow */

/**
 * Each row: its key, its word on a chip, whether a profile has it, and what it means when it has it and when not.
 * @type {[string, string, (p: AgentProfile) => boolean, (p: AgentProfile) => string, string][]}
 */
const ROWS = [
  [
    "reopen",
    "reopens chats",
    (p) => p.sessions.load || p.sessions.resume,
    (p) =>
      `A chat goes on in the same agent session after Filament restarts or the model changes: the session is reopened ${p.sessions.resume ? "without sending its history again" : "by sending its history again"}.`,
    "After Filament restarts or the model changes, a new agent session starts, seeded with the earlier messages.",
  ],
  [
    "list",
    "lists chats",
    (p) => p.sessions.list,
    () => "A Filament chat's /sessions lists the chats it knows, and /resume picks one up; a client's chat continues one by the #id model suffix.",
    "It does not list its chats: a Filament chat's /sessions and /resume by title are not available.",
  ],
  [
    "close",
    "closes sessions",
    (p) => p.sessions.close,
    () => "When Filament lets go of a session (a Filament chat's /new, a chat idle past its limit, a replaced session), the agent closes it at once.",
    "A session Filament lets go of stays open in the agent until its process ends.",
  ],
  [
    "steering",
    "mid-turn messages",
    (p) => p.steering || !!p.cancelKeepsWork,
    (p) =>
      p.steering
        ? "It takes a message in the middle of a turn: what is typed while it works goes into its running turn."
        : "It takes a message at its next step: once its current call is done, Filament stops the turn there and it carries on with what you typed, keeping what it did.",
    "It takes messages between turns only: what is typed while it works waits for the turn's end.",
  ],
  [
    "queueing",
    "queues messages",
    (p) => p.promptQueueing,
    () => "It queues a message sent while a turn runs; Filament holds such a message itself for now.",
    "It does not queue a message sent while a turn runs; Filament holds it.",
  ],
  [
    "raw",
    "whole tool calls",
    (p) => p.rawMessages,
    () => "It sends the model's own messages beside its updates: each tool call's whole input and the result the model read reach its card and the session's archive.",
    "Its tool calls are drawn from its updates: their titles, their kinds, any input it sends, and what it showed of their results.",
  ],
  [
    "account",
    "says its account",
    (p) => !!p.account,
    () => "It says which account it runs on, and its plan's windows as it works: the session's Account instrument and Home → Health show them.",
    "It doesn't say which account it runs on: Filament shows none.",
  ],
  [
    "compaction",
    "its own compaction",
    (p) => !!p.reportsCompaction,
    () => "It compacts its own context when asked and says how it went: a session can make room its way (context.compaction.agent: own, or /compact typed in the harness), listed in the session's compactions with Undo.",
    "Its own compaction is not offered: Filament makes room for it by a summary — the agent's own, or Filament's on its copy — and a fresh session starts from it.",
  ],
  [
    "fork",
    "forks sessions",
    (p) => p.sessions.fork,
    () => "It can copy a session into a new one: it writes Filament's summary in a copy, which leaves the session as it was, and a copy keeps the session from before its own compaction, for Undo.",
    "It cannot copy a session: it writes Filament's summary in the session itself, and Undo of its own compaction starts a fresh session from Filament's copy of the chat.",
  ],
  [
    "delete",
    "deletes sessions",
    (p) => p.sessions.delete,
    () => "It can delete a session from its history: Filament deletes only the copies it made itself, once it is done with them.",
    "It cannot delete a session through ACP: a copy Filament made is closed instead, and stays in its history.",
  ],
  [
    "folders",
    "extra folders",
    (p) => p.sessions.additionalDirectories,
    () => "It can work in more folders than the project's; Filament does not hand it any yet.",
    "It works in the project folder only.",
  ],
  [
    "subagents",
    "sessions for its own agents",
    (p) => p.sessions.subagents,
    () => "It runs its own agents as sessions of their own: each has a card in the conversation, with its calls and its report.",
    "It offers no sessions for its own agents; any it runs show under the chat that started them.",
  ],
  ["images", "images", (p) => p.prompt.image, () => "Pasted images go through.", "Images are dropped, with a note."],
  ["audio", "audio", (p) => p.prompt.audio, () => "It takes audio; Filament sends none yet.", "It takes no audio."],
  [
    "files",
    "files",
    (p) => p.prompt.embeddedContext,
    () => "Attached files go through as files.",
    "Attached text files are pasted into the prompt; a binary one is named, for the agent to read by its path.",
  ],
  [
    "tools",
    "Filament's tools",
    (p) => p.mcp.http,
    () => "It takes MCP servers over HTTP, so Filament's tools and memory reach it.",
    "It takes no MCP servers over HTTP: Filament's tools and memory reach it over stdio, through Filament's relay.",
  ],
];

/** What a profile supports, row by row. @param {AgentProfile} profile @returns {SupportRow[]} */
export const supportsRows = (profile) =>
  ROWS.map(([key, word, has, yes, no]) => {
    const on = has(profile);
    return { key, word, has: on, means: on ? yes(profile) : no };
  });

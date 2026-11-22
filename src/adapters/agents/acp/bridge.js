// ACP bridge: drive an Agent Client Protocol agent (Cursor CLI `agent acp`, Claude Code, Antigravity, Qoder CLI…)
// as if it were a chat model. Filament plays the editor role: it spawns the agent, opens one session per
// conversation, forwards the newest user message, auto-answers permission requests, and streams the agent's
// text back. The agent runs its own tools (read/edit/shell/MCP) inside the working directory.
//
// Protocol: JSON-RPC 2.0, newline-delimited, over the agent's stdin/stdout. https://agentclientprotocol.com
import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";
import { ClientToolset } from "../client-bridge.js";
import { terminalLine } from "../../tools/shell.js";
import { fromAgentPlan, fromCursorPlan, fromCursorQuestion, fromElicitation, toCursorPlan, toCursorQuestion, toElicitation, toPermission } from "../asks.js";
import { LiveTurn, TurnBridge, alwaysOf, askingPolicy, describeToolCall, choosePermission, isPolicy, loopCalls, noteUnanswerable, optionFor, policyRefused } from "../turn-bridge.js";
import { pushNote, appendNotes, cwdSourceText } from "../../../core/notes.js";
import { mainCounted } from "../../../core/answering-model.js";
import { agentArgs, agentKey, agentLaunchEnv, agentTitle, catalogueSignIn, confirmedOf, signInAdvice, signsInInTerminal } from "../../../core/catalogues.js";
import { accountRecord, claudeExtra, claudeIdentity, claudeUsageExtra, claudeUsageWindows, claudeWindow, mergeWindows, sameIdentity } from "../../../core/agent-limits.js";
import { classifyFailure, saysSignedOut } from "./failures.js";
import { flattenMessages, isUserTurn, textOf } from "../../../core/wire/flatten.js";
import { conversationKey } from "../../../core/conversation.js";
import { tookWords } from "../../../core/routines.js";
import { AcpProcess, clientCapabilitiesFor } from "./process.js";
import { agentEnv, resolveAgentCommand, PROBE_WAIT_MS } from "../agent-process.js";
import { readSessionOffer, modelSelection, listedModels, matchOffered, modelLabels, typedName } from "./negotiate.js";
import { KEY_MODELS_MS, keyAccess, keyListWords, keyModels } from "./key-models.js";
import { SessionMap, givenAgain, resumedConversation, newConversation } from "./sessions.js";
import { authenticateMethod, promptIn, readProfile, ProfileStore, withPrompt } from "./profile.js";
import { claudeCompactWindow, claudeLaunchEnv, claudeSessionHeaders, claudeSettingsVar, configuredMcpServers, filamentsDoor, planToolset, noteToolset, withSettingsHeaders } from "./toolset.js";
import { ownAgentsOff, ownOffAtStart } from "./own-agents.js";
import { chatKeyOf } from "../chat-servers.js";
import { applySessionSettings, askingMode } from "./configure.js";
import { composePrompt, countTaken, DEFAULT_STEERING_PROMPT, steerPrompt, told, unheard } from "./prompt.js";
import { createTextReader, createUpdateReader, turnUsage, diffLineCounts, CURSOR_ANSWERS, isProgressFrame, ledgerSpend, readingOf, growth } from "./updates.js";
import { createNextStep, nextStepPrompt } from "./next-step.js";
import { createQueued } from "./queued.js";
import { createOpenEnd } from "./open-end.js";
import { LIST_WAIT_MS, leftRunning, leftRunningWords, startedSince } from "../left-running.js";
import { ENVELOPES_TOOL, agentCompacted, commandNameOf, contextUpdate, givenNote, givenRecord, givenSays, givenTools, isAgentCommand, openedWith, promptFor, said, standingFor, standingText, stateOf } from "../context.js";
import { compactionOf, earlierTriesOf, lineOf, moveFor, owes, seenOf } from "../compactions.js";
import { idleDropOp } from "../idle.js";
import { widenFor } from "../../git/worktree.js";
// Re-exported for the Cursor SDK bridge and the old import path; both live in their own modules now.
export { DEFAULT_STEERING_PROMPT, diffLineCounts };
/** How many sub-agent sessions the bridge remembers the launching session of (the newest). */
const MAX_SUBAGENT_SESSIONS = 1000;
/** How many calls the bridge remembers the session of (the newest): Cursor's extensions name only their call. */
const MAX_CALL_SESSIONS = 2000;
/** How long an agent stays quiet on a session it loaded before its replay counts as over. */
const REPLAY_QUIET_MS = 150;
/** The longest a load waits for its replay to end. */
const REPLAY_MAX_MS = 5000;
/**
 * How long Claude Code may take to exit once its session is closed, writing the session's running totals as it goes:
 * Claude's SDK ends its input, waits 2 s, and ends it then — 5 s after that on Windows.
 */
const CLOSE_SAVES_MS = 7000;
/** How many pieces a harness chat's session says while no turn reads it are held for the turn that shows them (the newest). */
const HELD_BETWEEN = 2000;
/** The services the agent asks of its client that a turn judges (`permitLocal`): one asked between turns draws a turn. */
const JUDGED_SERVICES = new Set(["fs/read_text_file", "fs/write_text_file", "terminal/create"]);
/** How many of the background tasks that ended a cycle of the agent's own names (the newest). */
const OWN_TASKS = 20;
/** A task's statuses that are over (the SDK's `task_updated`): it is no longer running. */
const TASK_OVER = new Set(["completed", "failed", "killed"]);
/**
 * How long a task whose status said it ended is owed its end (`task_notification`), which comes after it in another
 * write — the end Claude's own cycle answers: past it, no end is coming.
 */
const TASK_NOTICE_MS = 10_000;
/**
 * A task Claude runs beside its work, while it runs (its SDK's `task_started`, HarnessV3-FailurePoints §5.1 item 2): a
 * sub-agent, a shell, a workflow — `kind` as the SDK names it (`local_agent`, `local_bash`…); `call` the tool call that
 * started it; `tokens`, `tools`, `lastTool` and `summary` from its progress, null before any; `stop` where Filament can
 * stop it alone (HarnessV4_Tasks E6: a sub-agent whose session its agent lets Filament cancel).
 * @typedef {{ id: string, kind: string, description: string, background: boolean, call: string | null,
 *   subagent: string | null, since: number, tokens: number | null, tools: number | null, lastTool: string | null,
 *   summary: string | null, stop?: boolean }} AgentTask
 */
/**
 * A coding agent's tasks that are agents at work, by the kinds Claude's SDK names (`local_agent`, `local_workflow`,
 * `remote_agent`): a stop kills the agent's process and its work with it, so an idle-only stop waits for them, and a
 * worktree they work in is not removed under them (HarnessV4_Git_Plan GW-D39). A shell (`local_bash`) is not counted:
 * it may serve for ever (a dev server), as Filament's own background shells may.
 */
export const AGENT_WORK = new Set(["local_agent", "local_workflow", "remote_agent"]);
/**
 * The longest a session opened just now is waited on for its commands, where the person's first words in it name one
 * and Filament has not yet seen whether its agent says any (`#saysCommands`): the agent publishes them a moment after
 * the session opens, once it has asked its CLI for them.
 */
const COMMANDS_WAIT_MS = 5000;
/** The variable that names Claude Code one model beyond those it lists (`#customModel`). */
const CUSTOM_MODEL_VAR = "ANTHROPIC_CUSTOM_MODEL_OPTION";
/** What a model from an account's API key says of itself in a picker, where an agent's own description would be. */
const KEYED_SAYS = "Anthropic lists it for this account's API key; Claude Code does not list it itself";
/**
 * The folders a session was opened with (`additionalDirectories`, HarnessV4_Overnight_Plan OV-D23), for a fork of it,
 * which opens with the same.
 * @param {any} opened
 */
const dirsOf = (opened) => {
  const dirs = opened?.sessionMeta?.additionalDirectories;
  return Array.isArray(dirs) && dirs.length ? { additionalDirectories: dirs } : {};
};
/**
 * How long the plan's usage, read last (Claude's `/usage`, `#askUsage`), stands before it is asked for again: at a
 * turn's end, and while a turn runs (`#usageWhile`).
 */
const USAGE_EVERY_MS = 10 * 60_000;
/**
 * How long an ask that read nothing stands before the next: a usage service that didn't answer is asked again soon,
 * and not at every turn.
 */
const USAGE_RETRY_MS = 2 * 60_000;
/** The longest a `/usage` ask takes, its throwaway agent's start included: the agent is let go of then. */
const USAGE_WAIT_MS = 30_000;
/** The longest a throwaway agent's word on who it runs as is waited for: Claude's adapter says it as it starts. */
const USAGE_WHO_MS = 8000;
/** The longest the agent's mode is waited for once its plan is under way (`#modeMoved`): its note holds the request
 *  that read the turn until then (`sayer`), and an agent that never answers would hold it for the process's life. */
const MODE_BACK_MS = 30_000;
/** What a `/usage` session asks of Claude's adapter: the raw message that carries the report, and no transcript kept. */
const USAGE_SESSION = { claudeCode: { emitRawSDKMessages: [{ type: "assistant" }], options: { persistSession: false } } };
/**
 * What Check now says of a reading of Claude's plan (`AccountCheck`'s `said`): the plan as it was, an answer without it
 * (Claude Code's while its usage service doesn't answer), an ask that failed.
 */
const USAGE_SAID = Object.freeze({
  same: "Checked just now: Claude's plan is as it was.",
  empty: "Claude didn't give its plan's usage just now: its usage service didn't answer. It's asked again at a turn's end.",
  /** @param {string} why */
  failed: (why) => `Couldn't read Claude's plan's usage: ${why}.`,
});
/**
 * A check that had nothing to read or say: the agent's own word on who it runs as says it all.
 * @type {import("../../../core/ports.js").AccountCheck}
 */
const NOTHING_ASKED = Object.freeze({ read: false, said: null });
/** What a reading of the plan is compared by, to say it was as it was: its windows and its extra usage. @param {any} a */
const usageKey = (a) => JSON.stringify([a?.windows ?? [], a?.extra ?? null]);
/**
 * A prompt's failure in which the agent says its session is gone from it: its process ended under the session —
 * Claude's adapter then lets the session go, or keeps it ended, and asks for a new one — or it holds no session of
 * that id. The agent's own words, at the start of the failure: the same words further on are another's (an MCP
 * server's, in the details). The chat's next turn opens the session again from what the agent saved (`#establish`).
 */
const SESSION_LOST = /^(?:Internal error:\s*)?(?:session not found|no such session|the claude agent (?:process exited unexpectedly|session has ended))/i;
/**
 * The modes a session writes Filament's summary in (HarnessV3-ACP AC5-4), the first the agent offers: one that changes
 * nothing — Cursor's ask, Claude's plan — else the one in which it asks before it acts, where Filament refuses it all.
 */
const READ_ONLY_MODES = ["ask", "plan", "default"];
/** @param {{ availableModes?: string[] }} c */
const readOnlyMode = (c) => READ_ONLY_MODES.find((m) => c.availableModes?.includes(m)) || null;

/**
 * A background task that ended, as Claude's SDK says it (`task_notification`).
 * @typedef {{ id: string, status: string, summary: string }} OwnTask
 */
/**
 * A piece of what a session said while no turn read it (HarnessV3-ACP AC3-9): how the turn that takes it reads it, and
 * whether it begins a model cycle of the main thread (`starts`), ends one (`ends`), or is work a cycle of the agent's
 * own draws (`draws`).
 * @typedef {{ read: (reader: any) => void, starts: boolean, ends: boolean, draws: boolean }} HeldPiece
 */
/**
 * What the bridge says when a cycle of the agent's own wants a turn (AC3-9): the session, the harness chat it shows in
 * and the model its turns there ran on, and the background tasks that ended which the cycle reads.
 * @typedef {{ upstreamId: string, sessionId: string, chain: string, model: string, tasks: OwnTask[] }} OwnCycle
 */

/**
 * Whether an update is work a turn draws (AC3-9): words or a thought that say something, a call, a plan — the agent's
 * own, not a sub-agent's call its adapter reports on the parent's session (`parentToolUseId`).
 * @param {any} u
 */
function drawsWork(u) {
  if (u?._meta?.claudeCode?.parentToolUseId) return false;
  const k = u?.sessionUpdate;
  if (k === "agent_message_chunk" || k === "agent_thought_chunk") return u.content?.type === "text" && !!u.content.text;
  return k === "tool_call" || k === "plan";
}

/**
 * What a plan the agent proposes through a permission request says (HarnessV3-ACP AC3-3): the words the agent put with
 * its call. The session's switch answers every other permission in a harness session (AC3-2).
 * @param {any} tc  the permission's tool call
 */
function planWords(tc) {
  return (Array.isArray(tc?.content) ? tc.content : [])
    .filter((c) => c?.type === "content" && c.content?.type === "text")
    .map((c) => String(c.content.text || ""))
    .join("\n");
}

// Where should the agent work? Header hint > pattern found in the client's SYSTEM prompt > fixed default > home.
// User messages are not searched unless `cwdFromUserMessages` is on: an auto-approving agent must not be aimed at a
// folder by text that merely appeared in the conversation. An optional allowlist confines the result further.
export function determineCwd(acp, flat, hint) {
  const ok = (p) => {
    if (!p) return null;
    const s = String(p)
      .trim()
      .replace(/^["'`]|["'`.,;]+$/g, "");
    try {
      return s && existsSync(s) && statSync(s).isDirectory() ? s : null;
    } catch {
      return null;
    }
  };
  const rawAllow = (acp?.cwdAllowlist || [])
    .map((x) =>
      String(x)
        .trim()
        .replace(/[\\/]+$/, ""),
    )
    .filter(Boolean);
  // Only full folder paths count. A stray word here (someone typing the permissions value "allow-all" into the
  // allowlist) must not silently block every folder and park an auto-approving agent in the home directory.
  const badAllow = rawAllow.filter((x) => !isAbsolute(x)),
    allow = rawAllow.filter((x) => isAbsolute(x));
  const permitted = (p) =>
    !allow.length ||
    allow.some((a) => {
      const A = a.toLowerCase(),
        P = String(p).toLowerCase();
      return P === A || P.startsWith(A + "\\") || P.startsWith(A + "/");
    });
  let found = null,
    source = null,
    blocked = null;
  const h = ok(hint);
  if (h) {
    found = h;
    source = "header";
  }
  if (!found && (acp?.cwdSource || "client") !== "fixed") {
    const pattern = acp?.cwdPattern || "Working directory:\\s*(.+)";
    let re;
    try {
      re = new RegExp(pattern, "i");
    } catch {
      re = /Working directory:\s*(.+)/i;
    }
    for (const m of flat) {
      if (m.role !== "system" && !(acp?.cwdFromUserMessages === true && m.role === "user")) continue;
      const mt = re.exec(m.text || "");
      const c = mt && ok(mt[1] || mt[0]);
      if (c) {
        found = c;
        source = m.role === "system" ? "system prompt" : "message";
        break;
      }
    }
  }
  if (found && !permitted(found)) {
    blocked = found;
    found = null;
  }
  const at = (cwd, where) => ({
    cwd,
    where,
    blocked,
    ignored: badAllow,
    source: cwdSourceText({ where, blocked, ignored: badAllow }),
  });
  if (found) return at(found, source);
  const d = ok(acp?.cwdDefault);
  if (d && permitted(d)) return at(d, "default");
  if (allow.length && ok(allow[0])) return at(ok(allow[0]), "first allowlisted folder");
  return at(homedir(), "home");
}

/**
 * A mode change an agent says as a line of its reply, as the mode update it is (the review of 11-10): Gemini CLI tells
 * its approval mode's change as reply text, `[MODE_UPDATE] <mode>`, which drew in the person's reply. Any other update
 * as it came.
 * @param {any} params  a `session/update`'s
 */
export function modeSaidAsText(params) {
  const u = params?.update;
  if (u?.sessionUpdate !== "agent_message_chunk" || u.content?.type !== "text") return params;
  const m = /^\[MODE_UPDATE\] (\S+)\s*$/.exec(String(u.content.text || ""));
  return m ? { ...params, update: { sessionUpdate: "current_mode_update", currentModeId: m[1] } } : params;
}

/**
 * An image the client gave by its address, as an ACP block: a link to it (the review of 11-10). ACP's image block
 * requires its data, and an agent that checks — Gemini CLI — refused the whole prompt for one with an address alone;
 * every agent takes a resource link.
 * @param {string} uri
 */
const imageLink = (uri) => ({ type: "resource_link", uri, name: uri.split(/[?#]/)[0].split("/").filter(Boolean).pop() || "image" });

// Image parts of the newest user message, as ACP content blocks (Anthropic base64 blocks or OpenAI data: URLs).
export function extractImages(format, body) {
  const msgs = body.messages || [];
  let last = null;
  for (let i = msgs.length - 1; i >= 0; i--)
    if (msgs[i]?.role === "user") {
      last = msgs[i];
      break;
    }
  if (!last || !Array.isArray(last.content)) return [];
  const out = [];
  for (const b of last.content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "image" && b.source?.type === "base64" && b.source.data)
      out.push({ type: "image", mimeType: b.source.media_type || "image/png", data: b.source.data });
    else if (b.type === "image_url") {
      const m = /^data:([^;]+);base64,(.+)$/s.exec(b.image_url?.url || "");
      if (m) out.push({ type: "image", mimeType: m[1], data: m[2] });
      else if (b.image_url?.url) out.push(imageLink(b.image_url.url));
    }
  }
  return out;
}

// Everything attached to the LAST user message, shaped for the agent: images as ACP image blocks (when the agent
// accepts images), files as ACP embedded resources when the agent accepts `embeddedContext`, otherwise text files
// are inlined into the prompt and binary files are announced but dropped. Earlier turns already reached the agent.
export function extractAttachments(format, body, caps = {}) {
  const msgs = body.messages || [];
  let last = null;
  for (let i = msgs.length - 1; i >= 0; i--)
    if (msgs[i]?.role === "user") {
      last = msgs[i];
      break;
    }
  const out = { blocks: [], inlineText: "", notes: [], structured: [] };
  if (!last || !Array.isArray(last.content)) return out;
  let images = 0,
    imgDropped = 0,
    files = 0,
    inlined = 0,
    dropped = 0,
    n = 0;
  const dataUri = (u) => /^data:([^;]+);base64,(.+)$/s.exec(u || "");
  const file = (name, mime, { blob, text, uri }) => {
    n++;
    const nm =
      name ||
      `attachment-${n}${mime === "application/pdf" ? ".pdf" : mime?.startsWith("text/") ? ".txt" : ""}`;
    if (caps.embeddedContext) {
      out.blocks.push({
        type: "resource",
        resource: {
          uri: uri || `file:///${nm}`,
          mimeType: mime || "application/octet-stream",
          ...(text != null ? { text } : { blob }),
        },
      });
      files++;
    } else if (text != null) {
      out.inlineText += `\n\n--- Attached file: ${nm} ---\n${text}\n--- end of ${nm} ---`;
      inlined++;
    } else if (uri && !blob) {
      out.inlineText += `\n\n[Attached file: ${nm} at ${uri}]`;
      inlined++;
    } else {
      out.inlineText += `\n\n[The user attached a file "${nm}" (${mime || "binary"}) that this agent cannot receive; ask them to paste its contents or refer to it by path.]`;
      dropped++;
    }
  };
  for (const b of last.content) {
    if (!b || typeof b !== "object") continue;
    if (b.type === "image" && b.source) {
      if (!caps.image) {
        imgDropped++;
        continue;
      }
      if (b.source.type === "base64" && b.source.data) {
        out.blocks.push({ type: "image", mimeType: b.source.media_type || "image/png", data: b.source.data });
        images++;
      } else if (b.source.type === "url" && b.source.url) {
        out.blocks.push(imageLink(b.source.url));
        images++;
      }
    } else if (b.type === "image_url") {
      if (!caps.image) {
        imgDropped++;
        continue;
      }
      const m = dataUri(b.image_url?.url);
      if (m) {
        out.blocks.push({ type: "image", mimeType: m[1], data: m[2] });
        images++;
      } else if (b.image_url?.url) {
        out.blocks.push(imageLink(b.image_url.url));
        images++;
      }
    } else if (b.type === "document" && b.source) {
      const sc = b.source;
      const mime = sc.media_type || (sc.type === "text" ? "text/plain" : "application/pdf");
      if (sc.type === "text") file(b.title, mime, { text: sc.data || "" });
      else if (sc.type === "base64") {
        const asText = mime.startsWith("text/") || /json|xml|csv|markdown|yaml/i.test(mime);
        file(
          b.title,
          mime,
          asText ? { text: Buffer.from(sc.data || "", "base64").toString("utf8") } : { blob: sc.data },
        );
      } else if (sc.type === "url") file(b.title, mime, { uri: sc.url });
      else if (sc.type === "content") file(b.title, "text/plain", { text: textOf(sc.content) });
    } else if (b.type === "file" && b.file) {
      const m = dataUri(b.file.file_data);
      const mime = m ? m[1] : "application/octet-stream";
      if (m) {
        const asText = mime.startsWith("text/") || /json|xml|csv|markdown|yaml/i.test(mime);
        file(
          b.file.filename,
          mime,
          asText ? { text: Buffer.from(m[2], "base64").toString("utf8") } : { blob: m[2] },
        );
      } else if (b.file.file_id) file(b.file.filename || b.file.file_id, mime, {});
    }
  }
  if (images) out.notes.push(`acp: ${images} image(s) attached`);
  if (imgDropped) pushNote(out.notes, out.structured, { kind: "images-dropped", count: imgDropped });
  if (files) out.notes.push(`acp: ${files} file(s) attached as embedded resources`);
  if (inlined)
    out.notes.push(`acp: ${inlined} file(s) inlined as text (agent does not accept embedded files)`);
  if (dropped) pushNote(out.notes, out.structured, { kind: "files-undelivered", count: dropped });
  return out;
}

// Find one of the agent's sessions by id, id prefix, or distinctive words from its title (case-insensitive).
export function findSession(sessions, query) {
  const q = String(query || "").trim();
  if (!q) return { found: null, candidates: [] };
  const byId =
    sessions.find((x) => x.sessionId === q) || sessions.find((x) => String(x.sessionId || "").startsWith(q));
  if (byId) return { found: byId, candidates: [byId] };
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const byTitle = sessions.filter((x) => {
    const t = String(x.title || "").toLowerCase();
    return words.every((w) => t.includes(w));
  });
  if (byTitle.length === 1) return { found: byTitle[0], candidates: byTitle };
  return { found: null, candidates: byTitle };
}

// ---------------------------------------------------------------------------------------------------
// The bridge: processes per (upstream, model), sessions per conversation
// ---------------------------------------------------------------------------------------------------
/**
 * Whether the agent takes the person's words queued while it works and says when it took them (HarnessV3-FailurePoints
 * §7.2): it declares prompt queueing, and Filament reads its raw messages, whose echo of the words says it. Qoder
 * declares queueing too, but says nothing of what it took.
 * @param {{ promptQueueing: boolean, rawMessages: boolean }} profile
 */
const queuesWords = (profile) => profile.promptQueueing && profile.rawMessages;

/**
 * Where the agent's session makes room by itself, for a turn's result (HarnessV4_Tasks U3-2): the line it was opened
 * with (HarnessV4_Tasks A3) and the point that window gives Claude Code — the line, but 67,000 under it and 967,000 over
 * it. Nothing where the session was handed no line: the agent compacts at a point of its own, not drawn until known.
 * @param {{ line?: number | null }} conv
 * @returns {{ point?: { at: number, line: number } }}
 */
const pointOf = (conv) => (conv.line != null ? { point: { at: claudeCompactWindow(conv.line).at, line: conv.line } } : {});
/**
 * What an agent can do with a session it holds, as its process says: fork it, open one again (`session/resume` or
 * `/load`), and say how its own compaction went. Kept on the chat's record as the session opens (`opened.can`), for
 * the ways asked of it while no process holds it (HarnessV4_Tasks C33).
 * @param {any} proc @returns {{ fork: boolean, reopen: boolean, reportsCompaction: boolean }}
 */
const sessionCan = (proc) => {
  const p = readProfile(proc.initResult);
  return { fork: !!p.sessions.fork, reopen: !!(p.sessions.resume || p.sessions.load), reportsCompaction: !!p.reportsCompaction };
};

/**
 * The agent's own commands among the person's words sent while it works (`/compact`), by its session's word: one is
 * held for the turn's end, to go as typed as the next message — taken into the running turn, Claude ran it there, and
 * the turn ended without the answer its prompt asked for. Words shaped like a command, sent before the agent said its
 * commands, wait for its word: the promise the session's `available_commands_update` keeps, or its first answer
 * without them (`answered`: it has none to say yet), whichever comes first (`SessionMap.absorbUpdate`,
 * HarnessV3-FailurePoints, the early-command race).
 * @param {{ commands?: any, answered?: boolean, commandsSaid?: { promise: Promise<void>, resolve: () => void } }} conv
 * @returns {import("../turn-bridge.js").AgentCommands}
 */
export const ownCommands = (conv) => ({
  holds: (text) => (isAgentCommand(text, conv.commands) ? String(text).trim().split(/\s/)[0] : null),
  unsure: (text) => {
    if (Array.isArray(conv.commands) || conv.answered || !commandNameOf(text)) return null;
    if (!conv.commandsSaid) {
      /** @type {() => void} */
      let resolve = () => {};
      const promise = new Promise((r) => (resolve = () => r(undefined)));
      conv.commandsSaid = { promise, resolve };
    }
    return conv.commandsSaid.promise;
  },
});

/**
 * The model that answered a turn, as its agent says it (the turn's `agentModel`): the one Claude's own messages name
 * (`mainModel`), else the counted model that read the most (`mainCounted`). The session keeps it with the model it was
 * set to then (`conv.answered`), and a turn that names none — a command of the agent's, one that ended before a
 * message, one that has not begun — is answered by it while the session's model stands. An agent whose turns name
 * none: the model its model option states (`modelConfig`: its answer to a set, an offer it restated). Null where it
 * says none.
 * @param {{ mainModel?: () => string } | null} reader @param {any} out @param {any} conv
 */
function answeringModel(reader, out, conv) {
  const named = reader?.mainModel?.() || mainCounted(out.modelUsage)?.model || null;
  if (named) conv.answered = { model: String(named), under: conv.modelId ?? null };
  if (conv.answered && conv.answered.under === (conv.modelId ?? null)) return conv.answered.model;
  return conv.modelConfig && conv.modelId ? String(conv.modelId) : null;
}

/** How many raw messages a session keeps (`acp.rawMessages`): the default 50, 0 for none. @param {any} acp */
const rawKept = (acp) => {
  const n = Number(acp?.rawMessages ?? 50);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 50;
};

/**
 * Whether a reading of a session's running totals by model fell below an earlier one for a model that one counted:
 * totals that did not go on from it.
 * @param {Record<string, { input: number, output: number, cacheRead: number, cacheWrite: number }>} reading
 * @param {Record<string, { input: number, output: number, cacheRead: number, cacheWrite: number }>} base
 */
function fellBelow(reading, base) {
  for (const [model, b] of Object.entries(base)) {
    const t = reading[model];
    if (!t || t.input < b.input || t.output < b.output || t.cacheRead < b.cacheRead || t.cacheWrite < b.cacheWrite) return true;
  }
  return false;
}

/**
 * What a spend the session made between turns was, in the log's words: its tokens, and its cost at the API's prices
 * where its agent said one.
 * @param {any} spent  a turn's facts in the bridge's shape
 */
function spentWords(spent) {
  const u = spent?.usage || {};
  /** @param {unknown} x */
  const n = (x) => (Number(x) || 0).toLocaleString("en-US");
  const cost = typeof spent?.context?.cost === "number" ? `$${spent.context.cost} at the API's prices` : "its cost not known";
  return `${n(u.input)} input, ${n(u.output)} output, ${n(u.cacheRead)} cache-read and ${n(u.cacheWrite)} cache-write tokens, ${cost}`;
}

/**
 * What the session spent between turns (`from`, a turn's facts in the bridge's shape), added to what `into` spent: its
 * tokens and the models that counted them, and its run's cost where `into` has a figure of its own — where either's
 * share of the agent's running total is not known, neither's is (`costUnseen`). One with no figure of its own is
 * priced at the card with its tokens, these among them. → `into`.
 * @param {any} into @param {any} from
 */
function addSpent(into, from) {
  const both = turnUsage([], [
    { usage: into.usage ?? null, modelUsage: into.modelUsage ?? null },
    { usage: from.usage ?? null, modelUsage: from.modelUsage ?? null },
  ]);
  if (both.usage) into.usage = both.usage;
  if (both.modelUsage) into.modelUsage = both.modelUsage;
  if (typeof into.context?.cost !== "number") return into;
  if (typeof from.context?.cost === "number") into.context.cost = Math.round((into.context.cost + from.context.cost) * 1e6) / 1e6;
  else {
    into.context.cost = null;
    into.costUnseen = from.costUnseen || "what its agent spent between turns came with no figure of its own";
  }
  return into;
}

export class AcpBridge extends TurnBridge {
  /** @param {{ log?: (...a: any[]) => void, stateFile?: string | null, profilesFile?: string | null, taskNoticeMs?: number }} [o]  `taskNoticeMs`: a test's TASK_NOTICE_MS */
  constructor({ log = () => {}, stateFile = null, profilesFile = null, taskNoticeMs = TASK_NOTICE_MS } = {}) {
    super({ log });
    this.#noticeMs = taskNoticeMs;
    this.procs = new Map(); // key -> AcpProcess
    this.profiles = new ProfileStore({ file: profilesFile, log }); // upstream id -> what its agent declared, last read
    this.convs = new SessionMap({ stateFile, log }); // convKey -> { sessionId, procKey, cwd, turns, lastUsed, modelId, mode, idleMs }
    this.modelCache = new Map(); // upstream id -> { at, names, labels, caps?, keyed?, keyLabels?, keyNote? }: its own list, the levels it offered, and its key's (`#keyOffers`)
    this.stateFile = stateFile; // conversations survive a restart; the agent reopens their sessions
    this.permissionLog = []; // last 200 permission decisions, for the UI
    this.pendingMcp = new Map(); // MCP token -> { cwd, upstream, at } while the agent is still opening the session (Claude Code connects to the toolset during session/new)
    /** @type {Map<string, Set<string>>} MCP token -> the tools Filament's server listed at its address: Filament's own hand (`loopCalls`) */
    this.ownListed = new Map();
    this.accounts = new Map(); // upstream id -> { identity, windows, extra, at }: the account its agent last said (AC3-6)
    this.usageEveryMs = USAGE_EVERY_MS; // how long the plan's usage, read last, stands before `/usage` is asked again
    this.usageRetryMs = USAGE_RETRY_MS; // how long an ask that read nothing stands before the next
    this.usageWaitMs = USAGE_WAIT_MS; // the longest a `/usage` ask waits for its answer
    this.usageWhoMs = USAGE_WHO_MS; // the longest a `/usage` ask's throwaway agent's word on who it runs as is waited for
    this.keyModelsMs = KEY_MODELS_MS; // the longest Anthropic's Models API is waited on for what an account's key can use
    this.commandsWaitMs = COMMANDS_WAIT_MS; // the longest a session opened just now is waited on for its commands
    this.processesWaitMs = LIST_WAIT_MS; // the longest a stopped turn waits on each read of the system's process table (`left-running.js`)
    this.publishes = new Set(); // `<upstream id>\n<way>`: an agent seen to say its commands as a session opens so (`#saysCommands`)
    /**
     * A cycle the agent began by itself on a harness chat's session wants a turn (HarnessV3-ACP AC3-9; the server's
     * hook). Without it, what the session says meanwhile waits for the chat's next turn.
     * @type {((cycle: OwnCycle) => void) | null}
     */
    this.onOwnCycle = null;
    /**
     * A harness chat's session's running tasks changed (HarnessV3-FailurePoints §5.1 item 2; the server's hook): the
     * whole list, empty once none runs, and the upstream whose session runs them (null where none says). Without it,
     * nobody hears them.
     * @type {((said: { chain: string, sessionId: string, upstream: string | null, tasks: AgentTask[] }) => void) | null}
     */
    this.onTasks = null;
    /**
     * What a harness chat kept of its sessions' spend between turns, which no turn showed, left as the chat is let go
     * of unused past its keep limit (`#settleLeft`; the server's hook): booked on the chat's own record where it can
     * be, → whether it was. Without it, or where it was not, the log names what went.
     * @type {((left: { chain: string, facts: any, why: string }) => boolean) | null}
     */
    this.onSpentLeft = null;
    /**
     * The models an account's API key offers beyond its agent's own list, as the server keeps them across restarts
     * (the server's hook, app/models.js `keyedFor`): read where this bridge has not listed the account's models
     * itself (`#keyedOf`). Without it, a bridge started afresh knows none until its first listing.
     * @type {((upstreamId: string) => { names: string[], labels?: Record<string, import("../../../core/ports.js").ModelLabel> } | null) | null}
     */
    this.keyedOf = null;
    /**
     * Where Filament is reached (the server's hook, its `ownPlaces`): every port it listens on, this machine's names and
     * addresses, where Tailscale serves it. Claude Code's model calls that go there ask Filament to add nothing, and no
     * other does (toolset.js `filamentsDoor`). Without it, only a turn's own address of Filament's server is known.
     * @type {(() => { ports: number[], names: string[], origins: string[] }) | null}
     */
    this.ownPlaces = null;
    /**
     * The names an account's agent listed itself when it was last asked, as the server keeps them across restarts
     * (the server's hook, app/models.js `ownNames`): read where this bridge has not listed the account's models
     * itself (`#customModel`). Without it, a bridge started afresh takes every typed name for one its agent does not
     * list until its first listing.
     * @type {((upstreamId: string) => string[] | null) | null}
     */
    this.listedOf = null;
    this.convs.load();
    this.timer = setInterval(() => this.sweep(), 60000);
    this.timer.unref?.();
  }

  status() {
    const now = Date.now();
    return {
      permissions: this.permissionLog.slice(-50).reverse(),
      processes: [...this.procs.values()].map((p) => ({
        key: p.key,
        command: p.spec.resolved,
        args: p.spec.args.slice(-4),
        pid: p.child?.pid,
        startedAt: p.startedAt,
        idleMs: now - p.lastUsed,
        exited: p.exited,
        stderr: p.stderr.slice(-8).map((l) => String(l).trim().slice(0, 300)),
      })),
      // The bridge mode is joined in from the conversation's live turn, because what is IN FORCE is a property of a
      // turn (it depends on whether the agent honoured `disableBuiltInTools` and on what tools the client declared),
      // not of the stored conversation. Both the effective and the configured value are reported: showing only the
      // configured one would claim a `native` guarantee the turn may not have got.
      // The bridge mode IN FORCE on this conversation's last turn, plus the configured one and — when they differ —
      // the note that says why. Showing only the configured value would claim a guarantee the turn did not get:
      // `native` needs an agent that can switch its built-in tools off, and on any other agent it behaves as `full`.
      conversations: [...this.convs.entries()].map(([key, c]) => {
        const t = c.sessionId ? this.turns.get(c.sessionId) : null;
        // Matched against the notes the bridge actually writes (see the `native`/`fullBridge` branch below): the
        // two cases where what the turn got is not what the upstream asked for. Spelling either one wrong here is
        // silent — the column just stops explaining itself — so both are pinned by a test.
        const divergence = (t?.notes || []).find((n) =>
          /clientBridge native is only for|client bridge full \(client has no tools|no client tools: Filament's own hands|declares no HTTP MCP support/.test(
            String(n),
          ),
        );
        return {
          key,
          sessionId: c.sessionId,
          upstreamId: c.upstreamId,
          cwd: c.cwd,
          turns: c.turns,
          idleMs: now - c.lastUsed,
          modelId: c.modelId,
          mode: c.mode,
          title: c.title || null,
          commands: (c.commands || []).map((x) => (typeof x === "string" ? x : x.name)),
          raw: (c.raw || []).length,
          live: !!c.procKey && this.procs.has(c.procKey),
          bridge: t?.bridgeEffective || null,
          bridgeConfigured: t?.bridge || null,
          bridgeNote: divergence ? String(divergence).replace(/^acp:\s*/, "") : null,
          steering: !!c.steering,
          clientTools: t?.clientTools?.summary?.() || null,
        };
      }),
      turns: [...this.turns.values()].map((t) => t.describe()),
    };
  }
  // Agent lifecycle as durable operations, injected by the server as `bridge.onOp` — the same pattern as
  // `memory.onJobEvent`, so this module stays independent of the op log and keeps working when observability is off.
  // `/api/acp/status` is a snapshot with no history, so without these the Agents tab can only show what is true right
  // now, and "which agent asked for permission an hour ago, and what did Filament decide" has no answer anywhere.
  #op(title, opts) {
    try {
      this.onOp?.(title, opts);
    } catch {
      /* observability must never break an agent turn */
    }
  }
  // The session new/resume operation, shared by the three paths that can start or reopen one (a fresh session,
  // an auth retry, and a same-session reopen after a model switch or restart) so no path can silently skip the history.
  #sessionOp(upstream, method, sessionId, extra = null) {
    const sid = sessionId || null;
    this.#op(
      `${method === "session/new" ? "started" : "resumed"} an agent session on ${upstream.id}${sid ? ` (${String(sid).slice(0, 12)})` : ""}`,
      {
        sub: method === "session/new" ? "new" : "resume",
        detail: { upstream: upstream.id, method, sessionId: sid, ...(extra || {}) },
        ref: { upstreamId: upstream.id, sessionId: sid },
      },
    );
  }
  #watchProc(p, key, upstreamId) {
    try {
      p.on?.("exit", (info) =>
        this.#op(
          `agent process ${key} exited (code ${info?.code ?? "?"}${info?.signal ? ", signal " + info.signal : ""})`,
          {
            sub: "exit",
            level: info?.code === 0 || info?.code == null ? "info" : "warn",
            // stderrLines, not the last line: an agent CLI writes paths and tracebacks to stderr, and this op is
            // durable. The server log already has the text; the operation records how much there was, never what it said.
            detail: {
              key,
              code: info?.code ?? null,
              signal: info?.signal || null,
              stderrLines: (p.stderr || []).length,
            },
            ref: { upstreamId },
          },
        ),
      );
    } catch {
      /* a process that cannot be watched is not a reason to fail the turn */
    }
    return p;
  }
  killProcess(key) {
    const p = this.procs.get(key);
    if (!p) return false;
    p.kill();
    this.procs.delete(key);
    this.#op(`agent process ${key} was killed from the console`, {
      sub: "kill",
      level: "warn",
      detail: { key },
      ref: { upstreamId: String(key).split("|")[0] },
    });
    return true;
  }
  /**
   * The raw messages a conversation's session kept (`acp.rawMessages`, AC1-7), oldest first; null for no such
   * conversation.
   * @param {string} key
   */
  rawOf(key) {
    const c = this.convs.get(key);
    return c ? c.raw || [] : null;
  }
  forgetConversation(key) {
    const c = this.convs.get(key);
    if (!this.convs.delete(key)) return false;
    this.convs.save();
    this.#closeSession(c.procKey, c.sessionId);
    if (!this.#sessionKept(c.sessionId)) this.#forgetBetween(c.sessionId, { proc: c.procKey ? this.procs.get(c.procKey) : null, chat: c });
    return true;
  }
  // The handshake, and what the agent declared in it kept as its profile (HarnessV3-ACP AC0-1), with what drives saw:
  // a probe's wait for it bounded (`PROBE_WAIT_MS`), a turn's ended by its stop alone.
  async #initialize(p, upstream, { waitMs = PROBE_WAIT_MS, signal = null } = {}) {
    const init = await p.initialize({ waitMs, signal });
    this.profiles.put(upstream.id, readProfile(init, confirmedOf(upstream)));
    return init;
  }
  // Let go of a session in the process that holds it (AC0-4): best effort, only where the agent declares `close`, and
  // never while another conversation still holds that session there. Settled once the agent answered, or at once.
  #closeSession(procKey, sessionId) {
    const p = procKey ? this.procs.get(procKey) : null;
    if (!p || p.exited || !sessionId || !readProfile(p.initResult).sessions.close) return Promise.resolve();
    for (const c of this.convs.values()) if (c.sessionId === sessionId && c.procKey === procKey) return Promise.resolve();
    const upstreamId = String(procKey).split("|")[0];
    return p.request("session/close", { sessionId }, 15000).then(
      () => {
        this.#savedAtClose(p, sessionId);
        this.#op(`closed an agent session on ${upstreamId} (${String(sessionId).slice(0, 12)})`, {
          sub: "close",
          detail: { upstream: upstreamId, method: "session/close", sessionId },
          ref: { upstreamId, sessionId },
        });
      },
      (e) => {
        this.#unsaved(sessionId);
        this.log("debug", `[acp] session/close ${String(sessionId).slice(0, 8)} failed: ${e.message}`);
      },
    );
  }
  /**
   * The sessions closed in each agent process, and when their close was answered: Claude Code goes on exiting after
   * it, writing their totals as it goes (`CLOSE_SAVES_MS`).
   * @type {WeakMap<object, Map<string, number>>}
   */
  #closedIn = new WeakMap();
  /**
   * A process that ends while Claude Code may still be exiting from a close it answered, ending it too: what that
   * close saved is not known.
   * @param {any} p
   */
  #closesCut(p) {
    const now = Date.now();
    for (const [sessionId, at] of this.#closedIn.get(p) || []) if (now - at < CLOSE_SAVES_MS) this.#unsaved(sessionId);
  }
  /**
   * What a session's transcript saved is not known — its close failed, or was cut short — to the conversations that
   * hold it in no process; and — opened again where it was open (`held`) — to those that hold it in one too.
   * @param {string} sessionId @param {{ held?: boolean }} [o]
   */
  #unsaved(sessionId, { held = false } = {}) {
    for (const c of this.convs.values()) if (c.sessionId === sessionId && (held || !c.procKey)) c.saved = null;
    this.convs.save();
  }
  /**
   * A session closed in its process: Claude's adapter ends its query, and Claude Code's process exits on its own,
   * writing the session's running totals into its transcript, where the query that resumes it goes on from them. A
   * conversation that holds it in no process knows what that transcript saved: the totals it had (`saved`), by model
   * and, where a figure of it is known in the process `p` held it in, its cost, the newest total said there; one that
   * holds it in another process, a query there going on from older ones, knows none.
   * @param {any} p @param {string} sessionId
   */
  #savedAtClose(p, sessionId) {
    let closed = this.#closedIn.get(p);
    if (!closed) this.#closedIn.set(p, (closed = new Map()));
    closed.set(sessionId, Date.now());
    const f = this.#figuresOf(p, sessionId);
    const cost = f.heard ?? f.from;
    for (const c of this.convs.values())
      if (c.sessionId === sessionId) c.saved = !c.procKey && !c.lost && c.usageSaid ? { usage: c.usageSaid, ...(cost != null ? { cost } : {}) } : null;
    this.convs.save();
  }
  /**
   * A chat's turn ended, however it ended: the chat is idle from now, and the map says so for a restart (the bug
   * report's H8: a failed turn left it idle from before the turn, so a sweep took the session a "continue" goes on in).
   * @param {any} conv
   */
  #used(conv) {
    conv.lastUsed = Date.now();
    this.convs.save();
  }
  /**
   * What the turn's own run cost, from the figure the agent said of its session (`out.context.cost`): Claude's adapter
   * says its query's running total — Claude Code's `total_cost_usd`, every model call since the session opened in its
   * process. The turn's is that total's growth since the figure the same total said last, a turn of any chat that
   * holds the session in `proc` (`#costSaid`, kept for the next turn); a figure below it is a total begun again (a
   * /clear, a new query): the turn's whole. What a query restarted in a fresh context had spent past that figure
   * before its restart joins it (`carried`). A session that opened again starts from what Claude Code saved before,
   * which Filament never sees (no figure kept): its turn's share is not known (`costUnseen`, why), until a figure of
   * that total has been said. A figure of nothing is none of that total: Claude's SDK says a crashed run's result may
   * carry zeroed values, and the total goes on from its last real figure, which stays the next turn's start.
   * @param {any} proc @param {string} sessionId @param {any} out
   */
  #ownCost(proc, sessionId, out) {
    const said = out.context?.cost;
    if (typeof said !== "number") return;
    if (said === 0) {
      out.context.cost = null;
      out.costUnseen = "it said its session had cost nothing, as a crashed run's result says it, and the session's total goes on from its last real figure";
      return;
    }
    const { from: before, carried, why } = this.#figuresOf(proc, sessionId);
    this.#countFrom(proc, sessionId, said);
    if (before == null || carried == null) {
      out.context.cost = null;
      out.costUnseen = why || "its session opened again in this agent process, where its running total goes on from what it saved before, out of Filament's sight";
    } else out.context.cost = Math.round((carried + (said < before ? said : said - before)) * 1e6) / 1e6;
  }
  /**
   * A prompt's answer, or a Force stop's end of the wait for it (`force`, HarnessV4_Tasks A5): the turn stops waiting
   * for an agent that does not end it, so the chat's queue and the session's lock are free. The session then holds a
   * prompt its agent has not ended (`unended`, a count) until the answer comes after all or the agent's process ends:
   * the chat's next turn lets such a session go (`#runTurn`), and what it says meanwhile is no one's (`#hold`). Never
   * kept across a restart (`kept`, sessions.js): the prompt ends with its process.
   * @param {Promise<any>} answer @param {AbortSignal | null} force @param {any} conv @param {any} upstream
   * @returns {Promise<any>}
   */
  #orLetGo(answer, force, conv, upstream) {
    if (!force) return answer;
    return new Promise((resolve, reject) => {
      const letGo = () => {
        conv.unended = (conv.unended || 0) + 1;
        const ended = () => void (conv.unended = Math.max(0, (conv.unended || 0) - 1));
        answer.then(ended, ended);
        reject(Object.assign(new Error(`Filament stopped waiting for ${agentTitle(upstream)} to end its turn (a Force stop)`), { letGo: true }));
      };
      if (force.aborted) return letGo();
      force.addEventListener("abort", letGo, { once: true });
      const settled = () => force.removeEventListener("abort", letGo);
      answer.then(
        (v) => (settled(), resolve(v)),
        (e) => (settled(), reject(e)),
      );
    });
  }
  /**
   * A harness chat idle past its limit (`idleStep`, HarnessV4_Tasks C25): the process that holds its session open lets
   * go of it — closed where the agent closes one, unless another chat holds it there — and what the session held
   * between turns goes once no process holds it, as when a process exits, what it spent there kept for the chat's next
   * turn (`#forgetBetween`). The chat keeps the session, and its next message opens it again. Settled once the agent
   * answered the close, or at once.
   * @param {any} c
   */
  #rest(c) {
    const from = c.procKey;
    c.procKey = null;
    const closed = this.#closeSession(from, c.sessionId);
    for (const other of this.convs.values()) if (other.sessionId === c.sessionId && other.procKey) return closed;
    this.#forgetBetween(c.sessionId, { proc: this.procs.get(from), chat: c });
    return closed;
  }
  // A conversation set to a session; the one it held before, when another, is let go of (AC0-4).
  #replace(convKey, conv) {
    const before = this.convs.get(convKey);
    this.convs.set(convKey, conv);
    if (before && before.sessionId !== conv.sessionId) this.#closeSession(before.procKey, before.sessionId);
  }
  /**
   * A session the agent already has, opened in this process (AC0-4): `session/resume` where the agent declares it,
   * which leaves out the history replay of `session/load` (Filament reads none of it), and `session/load` otherwise.
   * ACP has the replay come before the load's answer; an agent that goes on with it after (Gemini CLI answers at once)
   * is waited out, so no turn on the session reads the replay as its own. Only between the session's turns: two chats
   * can share one (each resumed it), and a load under the other's running turn would take that turn's updates for its
   * replay (the bug report's H9). A stop while it waits (`signal`) ends the wait, and the session is not opened.
   * No clock on a turn's (`timeoutMs` 0): its stop ends the wait (HarnessV3-FailurePoints §4 B); the attach, a probe,
   * names its own (FP-D2). A session lost under a prompt in this process by a chat that holds it there (`#lostUnder`)
   * is closed first where the agent closes one, as one it kept ended answers a resume as it stands; once open, it is
   * lost for none of the chats that hold it there (`#foundAgain`). Both under the session's lock: of two chats waiting
   * to open it again, the first closes and opens it, and the other opens it as it stands. A probe (`probe`: the attach,
   * which opens it only to know it opens, without Filament's tools) closes it first all the same, and opens it for none
   * of them: they still open it themselves. Opened again, the session's running total in the process goes on from a
   * figure out of Filament's sight — what its transcript saved, where its agent restarts its query — for every chat that
   * holds it there (`#costSaid`). One open there already may be torn down and opened again with what it is given now,
   * as Claude's adapter does with a session opened with other settings, Claude Code's exit writing its totals as it
   * goes: what its transcript saved is not known (`saved`) to any conversation that holds it.
   * @param {any} proc @param {any} params @param {number} timeoutMs @param {AbortSignal | null} [signal]
   * @param {{ probe?: boolean }} [o]
   */
  async #reattach(proc, params, timeoutMs, signal = null, { probe = false } = {}) {
    const sid = String(params.sessionId);
    const release = await this.lockSession(sid, signal);
    try {
      if (signal?.aborted) throw new Error(`stopped before session ${sid.slice(0, 8)} was opened`);
      this.#countFrom(proc, sid, null);
      if ([...this.convs.values()].some((c) => c.sessionId === sid && c.procKey === proc.key)) this.#unsaved(sid, { held: true });
      // Opened again, the session may run on another model than the one it names (configure.js `setAgain`): for every
      // chat that holds it, the one that goes on in it as it stands too.
      for (const c of this.convs.values()) if (c.sessionId === sid) c.modelUnproven = true;
      const lost = [...this.convs.values()].some((c) => c.sessionId === sid && c.procKey === proc.key && c.lost);
      if (lost && readProfile(proc.initResult).sessions.close) await proc.request("session/close", { sessionId: sid }, 15000, signal).catch(() => {});
      const method = readProfile(proc.initResult).sessions.resume ? "session/resume" : "session/load";
      if (method === "session/resume") {
        const res = await proc.request(method, params, timeoutMs, signal);
        if (!probe) this.#foundAgain(sid, proc.key);
        return { method, res };
      }
      this.#replaying.set(sid, 0);
      try {
        const res = await proc.request(method, params, timeoutMs, signal);
        await this.#replayed(sid);
        if (!probe) this.#foundAgain(sid, proc.key);
        return { method, res };
      } finally {
        this.#replaying.delete(sid);
      }
    } finally {
      release();
    }
  }
  /** The sessions being loaded, each with when the agent last sent it an update. */
  #replaying = new Map();
  /**
   * A loaded session's replay is over: the agent has been quiet on it for REPLAY_QUIET_MS since the load's answer, or
   * REPLAY_MAX_MS have passed. @param {string} sid
   */
  async #replayed(sid) {
    const answered = Date.now();
    const limit = answered + REPLAY_MAX_MS;
    for (;;) {
      const quiet = Date.now() - Math.max(answered, this.#replaying.get(sid) || 0);
      const left = limit - Date.now();
      if (quiet >= REPLAY_QUIET_MS || left <= 0) return;
      await new Promise((r) => setTimeout(r, Math.min(REPLAY_QUIET_MS - quiet, left)));
    }
  }
  // What is known about the running agent process(es) for an upstream: agent name/version, how it is signed in.
  processInfo(upstreamId) {
    const procs = [...this.procs.values()].filter((p) => p.key.startsWith(`${upstreamId}|`));
    const p = procs[0];
    if (!p) return null;
    return {
      agent: p.initResult?.agentInfo || null,
      identity: this.accounts.get(upstreamId)?.identity ?? null,
      processes: procs.length,
      pid: p.child?.pid ?? null,
      models: procs.map((x) => x.key.split("|")[1] || "default"),
    };
  }
  // Who the agent runs as, as it says it (`_auth/status_update`, Claude's adapter, HarnessV3-ACP AC3-6): pushed when
  // it starts and whenever it changes, never asked for. Another login takes the last one's windows with it; windows
  // heard before the agent said who it runs as are this login's (its check of the login runs beside the first turns).
  #heardIdentity(upstream, authStatus) {
    const identity = claudeIdentity(authStatus);
    if (!identity) return;
    const was = this.accounts.get(upstream.id);
    const keep = !!was && (!was.identity || sameIdentity(was.identity, identity));
    this.accounts.set(upstream.id, { identity, windows: keep ? was.windows : [], extra: keep ? was.extra : null, at: Date.now() });
    const keyed = identity.kind === "api-key" ? "An Anthropic API key has no plan windows: it is billed by the token" : null;
    this.heardAccount(upstream.id, {
      source: "_auth/status_update",
      identity,
      noWindows: keyed || (identity.kind === "gateway" || identity.kind === "external" ? `${identity.label} has no plan windows` : null),
    });
  }
  // One of the plan's windows, as Claude's SDK says it when it changes (`rate_limit_event`): forwarded raw, and beside
  // the context's size once the turn has used some (`usage_update`'s `_claude/rateLimit`). The same word twice is one.
  #heardLimits(upstream, info, source) {
    const w = claudeWindow(info);
    this.#heardWindows(upstream, w ? [w] : [], claudeExtra(info), source);
  }
  // Windows of the plan and its extra usage, as the agent said them: kept with its account, and handed to the server's
  // store. Each of Claude's channels says its own part of the extra usage, so what one says joins what the other said.
  #heardWindows(upstream, windows, extra, source) {
    if (!windows.length && !extra) return;
    const a = this.accounts.get(upstream.id) || { identity: null, windows: [], extra: null, at: 0 };
    if (windows.length) a.windows = mergeWindows(a.windows, windows);
    if (extra) a.extra = { ...a.extra, ...extra };
    a.at = Date.now();
    this.accounts.set(upstream.id, a);
    this.heardAccount(upstream.id, { source, windows, extra });
  }
  /** upstream id -> the `/usage` ask under way (`#askUsage`), and its stop: its upstream let go of (`letGo`) */
  #usageAsks = new Map();
  /**
   * upstream id -> the sign-in the agent carries out under way (`signIn`): the process asked, and the stop of its wait.
   * @type {Map<string, { proc: any, stop: AbortController }>}
   */
  #signIns = new Map();
  /** upstream id -> when its plan's usage was last read */
  #usageAt = new Map();
  /** upstream id -> when its plan's usage was last asked for, read or not */
  #usageTried = new Map();
  /** The throwaway agents a `/usage` ask runs now: the bridge's shutdown ends them. */
  #usageProcs = new Set();
  /**
   * Claude's account and its plan's usage, read by a throwaway agent in the account's folder (`#usageReport`), as the
   * model list is (HarnessV3-ACP AC3-6): who it runs as, which it says as it starts, and on a plan's login the plan's
   * windows and extra usage as Claude Code's `/usage` says them — the rate-limit info says a window's share only as the
   * window nears its end, and `/usage` reads claude.ai's own figures at any level. One ask at a time per upstream. What
   * it came to, for Check now to say: the plan read — as it was, or moved, which its meters show — an answer without
   * it, or an ask that failed (a debug line too); nothing to say where the login has no plan.
   * @param {any} upstream
   * @returns {Promise<import("../../../core/ports.js").AccountCheck>}
   */
  #askUsage(upstream) {
    const id = upstream.id;
    const asking = this.#usageAsks.get(id);
    if (asking) return asking.ask;
    this.#usageTried.set(id, Date.now());
    const was = usageKey(this.accounts.get(id));
    /**
     * An ask its upstream let go of meanwhile (`letGo`: a sign-in, a sign-out) asked in the old login: it ends then, its
     * throwaway agent heard no more, and says nothing — to whoever joined it too — nor lets go of the one after it.
     */
    const stop = new AbortController();
    const goneBy = () => stop.signal.aborted;
    /** @type {Promise<import("../../../core/ports.js").AccountCheck>} */
    const ask = this.#usageReport(upstream, stop.signal)
      .then(({ plan, report }) => {
        if (!plan || goneBy()) return NOTHING_ASKED;
        const windows = claudeUsageWindows(report);
        const extra = claudeUsageExtra(report);
        if (!windows.length && !extra) return { read: false, said: USAGE_SAID.empty };
        this.#usageAt.set(id, Date.now());
        this.#heardWindows(upstream, windows, extra, "/usage");
        return { read: true, said: usageKey(this.accounts.get(id)) === was ? USAGE_SAID.same : null };
      })
      .catch((e) => {
        if (goneBy()) return NOTHING_ASKED;
        const why = String(e?.message || e).replace(/[.\s]+$/, "");
        this.log("debug", `[acp] ${id}: its plan's usage could not be read (${why})`);
        return { read: false, said: USAGE_SAID.failed(why) };
      })
      .finally(() => {
        if (!goneBy()) this.#usageAsks.delete(id);
      });
    this.#usageAsks.set(id, { ask, stop });
    return ask;
  }
  /**
   * What a throwaway agent says, its session keeping no transcript: who it runs as, which Claude's adapter says as it
   * starts (`_auth/status_update`, kept as any start's is), and on a plan's login Claude Code's `/usage` report, which no
   * model reads — the raw message that carries its answer has the figures (`usage_report`); null where it gave none: a
   * login whose plan it can't read, or an answer that leaves the plan's figures out, as Claude Code's does while its
   * usage service doesn't answer. The report ends the ask, the prompt's answer trailing it by seconds at times; the
   * agent is let go of then, or after `usageWaitMs` at the latest. Stopped (`signal`: its upstream let go of), the ask
   * ends at once, its agent's kill landing when it does.
   * @param {any} upstream @param {AbortSignal} signal
   * @returns {Promise<{ plan: boolean, report: any }>}
   */
  async #usageReport(upstream, signal) {
    const acp = upstream.acp || {};
    const p = new AcpProcess({ command: acp.command || "agent", args: [...agentArgs(acp)], env: agentLaunchEnv(upstream), envRemove: acp.envRemove, log: this.log }).start();
    this.#usageProcs.add(p);
    /** @type {(report: any) => void} */
    let reported = () => {};
    /** @type {Promise<any>} */
    const report = new Promise((resolve) => (reported = resolve));
    const onNotif = (method, params) => {
      // An ask stopped holds the old login: what its agent writes until its kill lands is read, and heard by nobody.
      if (signal.aborted) return;
      const m = params?.message;
      if (method === "_auth/status_update" && params?.authStatus) this.#heardIdentity(upstream, params.authStatus);
      else if (method === "_claude/sdkMessage" && m?.usage_report) reported(m.usage_report);
    };
    p.on("notification", onNotif);
    let late = false;
    const timer = setTimeout(() => {
      late = true;
      p.kill();
    }, this.usageWaitMs);
    try {
      await p.initialize({ signal });
      // The session opens while the agent says who it runs as, and is read once it has: nobody signed in, the open
      // fails, as Claude's adapter's does — and the login is what Check now is to say.
      const opening = p.request("session/new", { cwd: determineCwd(acp, [], null).cwd, mcpServers: [], _meta: USAGE_SESSION }, 0, signal);
      opening.catch(() => {});
      await p.waitFor(p.heardWho(this.usageWhoMs), { signal, what: "its word on who it runs as" });
      const kind = this.accounts.get(upstream.id)?.identity?.kind;
      if (!kind) {
        // It never said who it runs as: its time ran out, it ended — how, its end says — or it kept quiet.
        if (late) throw new Error("let go of at its limit");
        if (p.exited) {
          // Its end is told once what it wrote before it is read (`close`).
          if (!p.lastError) await p.waitFor(new Promise((resolve) => p.once("close", resolve)), { signal, what: "its end" });
          throw p.lastError;
        }
        throw new Error(`it didn't say who it runs as in ${Math.round(this.usageWhoMs / 1000)} s`);
      }
      if (kind !== "account") return { plan: false, report: null };
      const s = await opening;
      const answered = p.request("session/prompt", { sessionId: s.sessionId, prompt: [{ type: "text", text: "/usage" }] }, 0, signal).then(() => null);
      // Let go of before it answers, the agent fails the prompt: nobody waits on that any more.
      answered.catch(() => {});
      return { plan: true, report: await Promise.race([report, answered]) };
    } catch (e) {
      throw late ? new Error(`it gave no answer in ${Math.round(this.usageWaitMs / 1000)} s`) : e;
    } finally {
      clearTimeout(timer);
      p.off("notification", onNotif);
      this.#usageProcs.delete(p);
      p.kill();
    }
  }
  /**
   * How long until the plan's usage is due to be read again, 0 once it is: what was read last `usageEveryMs` old, and
   * an ask that read nothing `usageRetryMs` old. Null where there is no plan to read: any agent but Claude's adapter,
   * and a login that is no plan's.
   * @param {string} id @returns {number | null}
   */
  #usageDueIn(id) {
    if (!this.profiles.all()[id]?.rawMessages || this.accounts.get(id)?.identity?.kind !== "account") return null;
    const due = Math.max((this.#usageAt.get(id) ?? -Infinity) + this.usageEveryMs, (this.#usageTried.get(id) ?? -Infinity) + this.usageRetryMs);
    return Math.max(0, due - Date.now());
  }
  /**
   * A turn's end reads the plan's usage again (`#askUsage`), once it is due (`#usageDueIn`).
   * @param {any} upstream
   */
  #usageAfterTurn(upstream) {
    if (this.#usageDueIn(upstream.id) === 0) void this.#askUsage(upstream);
  }
  /**
   * While a turn runs its plan's usage is read each time it is due (HarnessV4_Tasks A4): a turn may run for hours, and
   * the plan's meter stood still to its end. The same throwaway agent reads it, beside the turn's own, and an answer
   * without the figures changes nothing (`#askUsage`). An ask that read nothing waits `usageRetryMs` from its end
   * where it took longer than that, so a usage service that hangs is not asked without pause. → ends it.
   * @param {any} upstream @returns {() => void}
   */
  #usageWhile(upstream) {
    const id = upstream.id;
    if (!this.profiles.all()[id]?.rawMessages) return () => {};
    /** @type {ReturnType<typeof setTimeout> | null} */
    let timer = null;
    let over = false;
    const wake = (/** @type {number} */ ms) => {
      timer = setTimeout(look, ms);
      timer.unref?.();
    };
    const look = (asked = false) => {
      if (over) return;
      const due = this.#usageDueIn(id);
      // No plan's login, or none said yet (Claude's adapter learns who it runs as in the background): looked at again.
      if (due == null) return wake(this.usageRetryMs);
      if (due > 0 || asked) return wake(due || this.usageRetryMs);
      void this.#askUsage(upstream).finally(() => look(true));
    };
    look();
    return () => {
      over = true;
      if (timer) clearTimeout(timer);
    };
  }
  // The account as a turn's record keeps it: null until the agent says who it runs as, and where nobody is signed in.
  #accountRecord(upstreamId) {
    const a = this.accounts.get(upstreamId);
    if (!a?.identity || a.identity.kind === "none") return null;
    return accountRecord(a.identity, a.windows, a.at, { extra: a.extra });
  }
  /**
   * The account at the person's word (*Check now*), where the agent says who it runs as, and what the check came to.
   * Claude's adapter, as its last start declared it: its throwaway agent says who it runs as and, on a plan's login,
   * reads the plan with `/usage` (`#askUsage`) — nothing else starts. Any other agent, or one not started since Filament
   * runs it, whose start tells: a running one has said it, and says it again as each prompt starts; one that isn't
   * running is started, and its first word waited for, eight seconds at most — then, Claude's on a plan's login, the plan
   * read as above. An agent's that has no `/usage` come with its turns.
   * @param {any} upstream
   * @returns {Promise<import("../../../core/ports.js").AccountCheck>}
   */
  async checkAccount(upstream) {
    const declared = this.profiles.all()[upstream.id];
    if (declared?.account === false) return NOTHING_ASKED;
    if (declared?.rawMessages) return this.#askUsage(upstream);
    if (![...this.procs.values()].some((p) => p.key.startsWith(`${upstream.id}|`) && !p.exited && p.authStatus)) {
      const p = await this.getProcess(upstream, null);
      if (readProfile(p.initResult).account) await p.heardWho(8000);
    }
    return this.profiles.all()[upstream.id]?.rawMessages && this.accounts.get(upstream.id)?.identity?.kind === "account" ? this.#askUsage(upstream) : NOTHING_ASKED;
  }
  /**
   * The agent's ways to sign in (HarnessV3-ACP AC3-7), as it declared them at its last start — one not started since
   * Filament runs them, or whose kept answer predates its ways of each kind, is started to say (`start`): its terminal
   * sign-ins, the configured agent program with the way's arguments (or, in Zed's older form, the program the way
   * names), in its account's folder, with the way's variables; a way it carries out itself (`authenticate`, the review of
   * 11-10), a page it opens of its own; a key it reads from a variable, which the account's environment keeps. Where it
   * names no terminal sign-in of its own, its CLI's, as the catalogue knows it, comes first: the way it signed in by
   * before its other ways were read.
   * @param {any} upstream @param {{ start?: boolean }} [o]
   * @returns {Promise<import("../../../core/ports.js").SignInWay[]>}
   */
  async signInWays(upstream, { start = false } = {}) {
    const kept = this.profiles.all()[upstream.id];
    /** @type {import("./profile.js").OwnWay[] | undefined} */
    let named = kept?.ways || (kept?.signIns && !start ? kept.signIns.map((w) => ({ kind: /** @type {const} */ ("terminal"), ...w })) : undefined);
    if (!named && start)
      named = await this.getProcess(upstream, null).then(
        (p) => readProfile(p.initResult).ways,
        (e) => {
          this.log("warn", `[acp] ${upstream.id} could not start to name its ways to sign in (${String(e?.message || e).slice(0, 160)}): its CLI's sign-in instead`);
          return (kept?.signIns || []).map((w) => ({ kind: /** @type {const} */ ("terminal"), ...w }));
        },
      );
    const acp = upstream.acp || {};
    /** @type {import("../../../core/ports.js").SignInWay[]} */
    const ways = (named || []).map((w) =>
      w.kind === "agent"
        ? { id: w.id, name: w.name, description: w.description, kind: /** @type {const} */ ("browser") }
        : w.kind === "key"
          ? { id: w.id, name: w.name, description: w.description, kind: /** @type {const} */ ("key"), label: w.label, variable: w.variable }
          : {
              id: w.id,
              name: w.name,
              description: w.description,
              kind: /** @type {const} */ ("terminal"),
              command: w.command || acp.command || "agent",
              args: w.command ? w.args : [...agentArgs(acp), ...w.args],
              env: { ...agentLaunchEnv(upstream), ...w.env },
            },
    );
    // An account with a folder of its own that the agent's pages can't reach signs in in a terminal alone (Antigravity's
    // added accounts: `agy acp --login`, its sign-in kept in that folder) — the agent's own terminal way where it names
    // one (agy 1.5.14's `terminal-login`, its arguments after the account's), else its CLI's.
    const reached = signsInInTerminal(upstream) ? ways.filter((w) => w.kind !== "browser") : ways;
    if (ways.some((w) => w.kind === "terminal")) return reached;
    const own = catalogueSignIn(upstream);
    return [...(own ? [{ id: "cli", description: "Its own CLI's sign-in, in a terminal", kind: /** @type {const} */ ("terminal"), ...own }] : []), ...reached];
  }
  /**
   * A way the agent carries out itself, at the person's word (the review of 11-10): `authenticate` with the way's id, on
   * its process — the agent opens its own page, or whatever its sign-in is, and answers once it is done; no clock but
   * the sign-in's own (`signal`, and Cancel). Ended well, its other processes are let go of, as they hold the old login;
   * the one it signed in stays. One sign-in an account at a time: a new one takes the last one's place.
   * @param {any} upstream @param {{ way: string, signal?: AbortSignal | null }} o
   * @returns {Promise<{ url: null, code: null, done: Promise<{ ok: boolean, error: string | null }> }>}
   */
  async signIn(upstream, { way, signal = null }) {
    await this.cancelSignIn(upstream);
    const p = await this.getProcess(upstream, null);
    if (!readProfile(p.initResult).ways.some((w) => w.kind === "agent" && w.id === way))
      throw new Error(`${agentTitle(upstream)} names no way "${way}" that it carries out itself any more: Check now, then sign in again`);
    const stop = new AbortController();
    const both = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    this.#signIns.set(upstream.id, { proc: p, stop });
    const done = p.request("authenticate", { methodId: way }, 0, both).then(
      () => {
        if (this.#signIns.get(upstream.id)?.proc === p) this.#signIns.delete(upstream.id);
        this.letGo(upstream.id, { keep: p });
        return { ok: true, error: null };
      },
      (/** @type {any} */ e) => {
        if (this.#signIns.get(upstream.id)?.proc === p) this.#signIns.delete(upstream.id);
        return both.aborted ? { ok: false, error: null } : { ok: false, error: String(e?.message || e).replace(/^Internal error\s*/i, "").slice(0, 300) || "the agent's sign-in failed" };
      },
    );
    return { url: null, code: null, done };
  }
  /**
   * The sign-in under way stopped at the person's word: its wait ends, and its process is let go of — the agent may
   * still wait on its page, which a new process never holds.
   * @param {any} upstream @returns {Promise<boolean>}
   */
  async cancelSignIn(upstream) {
    const s = this.#signIns.get(upstream.id);
    if (!s) return false;
    this.#signIns.delete(upstream.id);
    s.stop.abort();
    this.letGo(upstream.id);
    return true;
  }
  /** Whether the agent signs out of its own (ACP's `logout`), as it declared at its last start. @param {any} upstream */
  signsOut(upstream) {
    return !!this.profiles.all()[upstream.id]?.logout;
  }
  /**
   * Sign the agent out at the person's word, where it declares ACP's `logout`: Claude's adapter clears its own login in
   * its folder, and says who it runs as after. Its processes are let go of, so the next turn starts in the login as it
   * now stands (HarnessV3-ACP AC3-7).
   * @param {any} upstream
   */
  async signOut(upstream) {
    const p = await this.getProcess(upstream, null);
    if (!readProfile(p.initResult).logout)
      throw Object.assign(new Error("this agent has no sign-out of its own: sign out in its own CLI"), { code: "NO_SIGN_OUT" });
    await p.request("logout", {}, 60000);
    this.letGo(upstream.id);
  }
  /**
   * Let go of an upstream's agent processes, so its next turn starts one in its login as it now stands (HarnessV3-ACP
   * AC3-7: the account signed in or out outside them). One with no turn running stops now; one whose turn runs is taken
   * off the list — nothing new goes to it — and stops when its turns end. Their chats reopen their sessions in the
   * next. `keep`: the one process that stays — the agent signed in in it (`signIn`).
   * @param {string} upstreamId @param {{ keep?: any }} [o]
   */
  letGo(upstreamId, { keep = null } = {}) {
    for (const [key, p] of [...this.procs]) {
      if (!key.startsWith(`${upstreamId}|`) || p === keep) continue;
      this.procs.delete(key);
      for (const c of this.convs.values()) if (c.procKey === key) c.procKey = null;
      if (this.runsOn(p)) p.retire = true;
      else p.kill();
    }
    // A `/usage` ask under way holds the old login too: it ends now, saying nothing, and its throwaway agent goes, heard
    // no more however long its kill takes to land; the next ask starts afresh.
    this.#usageAsks.get(upstreamId)?.stop.abort();
    this.#usageAsks.delete(upstreamId);
  }
  // Claude Code's refusals are verbose JSON-RPC errors; give the person the sentence they need.
  static explainLoadError(msg) {
    const m = String(msg || "");
    if (/running as a background session/i.test(m)) {
      const id = /Session (\S+?) is running/i.exec(m)?.[1] || "";
      return `that chat is still open in a Claude Code terminal, and Claude Code refuses to run one chat in two places. Close it there first (or run \`claude stop ${id.slice(0, 8) || "<id>"}\`), then try again.`;
    }
    if (/not found|no such session|does not exist/i.test(m)) return "the agent no longer has that session.";
    return m.replace(/^Internal error\s*/i, "").slice(0, 300) || "unknown error";
  }
  // Attach the conversation this request belongs to, to an agent session that already exists (from /resume), standing
  // on the chat's newest compaction as the command's request names it (AC5-1).
  async attach({ upstream, modelId, format, body, cwdHint, conversationId, sessionId, headers = {} }) {
    const acp = upstream.acp || {};
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(acp, flat, cwdHint);
    const convKey = conversationKey(upstream.id, cwd, flat, conversationId);
    const proc = await this.getProcess(upstream, modelId);
    const list = await proc.request("session/list", {}, 30000);
    const sessions = Array.isArray(list?.sessions) ? list.sessions : Array.isArray(list) ? list : [];
    const { found: listed, candidates } = findSession(sessions, sessionId);
    const mine = this.convs.get(convKey);
    // The session the chat holds, named by its id or the id's start, is found where its agent lists it no longer: the
    // chat's next turn opens it by its id.
    const found = listed || (mine && findSession([{ sessionId: mine.sessionId }], sessionId).found ? { sessionId: mine.sessionId, cwd: mine.cwd, title: mine.title } : null);
    if (!found)
      return {
        ok: false,
        error:
          candidates.length > 1
            ? `"${sessionId}" matches ${candidates.length} sessions: ${candidates
                .slice(0, 6)
                .map((x) => `“${x.title || "untitled"}” (${String(x.sessionId).slice(0, 8)})`)
                .join(", ")}. Use the id, or more words from the title.`
            : `no session matches "${sessionId}" (${sessions.length} known; type /sessions to list them by name)`,
      };
    // The session the chat holds already is attached already: its next turn opens it as a turn opens one — closed
    // first where its agent lost it, let go of for a new one where a force-stopped prompt its agent has not ended holds
    // it, or on in it as it stands — once another chat's turn on it has ended, as any turn takes the session. Where the
    // chat was compacted since onto a compaction neither the session nor one from before it stands on (`moveFor`:
    // fresh), it stands on that one from here, as a session from elsewhere does: the person's turns it counted were the
    // copy's from before, so it counts them on this one from its next prompt, and it holds less than the chat where the
    // chat had turns (`owes`). Where one of them stands on it, the turn's move takes the chat there: back to the session
    // from before where an undo brought the chat back to it — the one the command names, with the one let go (`undone`).
    if (mine?.sessionId === found.sessionId) {
      const base = compactionOf(headers, upstream.id);
      const step = moveFor(mine, base);
      if (step.move === "fresh") {
        mine.basedOn = base;
        delete mine.seenUserTurns;
        delete mine.heard;
        if (flat.filter(isUserTurn).length > 1) mine.partial = true;
        this.convs.save();
      }
      if (step.move === "back") {
        const to = step.to;
        const session = sessions.find((x) => x?.sessionId === to.sessionId) || { sessionId: to.sessionId, cwd: to.cwd, title: to.title || null };
        return { ok: true, session, cwd: to.cwd || session.cwd || cwd, undone: found.sessionId };
      }
      return { ok: true, session: found, cwd: mine.cwd || found.cwd || cwd };
    }
    // A session a turn runs on opens once that turn has ended (the bug report's H9): the command says so at once,
    // where it would wait with no word.
    if (this.sessionLocks.has(found.sessionId))
      return { ok: false, error: `a turn runs on that session now; send \`/resume ${sessionId}\` again once it has ended` };
    const useCwd = found.cwd || cwd;
    const mcpServers = configuredMcpServers(acp);
    try {
      // Opened to know it opens (one the agent refuses says why now), then let go of: the chat's next turn opens it
      // with what a turn opens a session with, Filament's instructions and tools, which the fork Filament's summary is
      // written in copies (the bug report's L25); another chat that holds it in that process keeps it open.
      const { res } = await this.#reattach(proc, { sessionId: found.sessionId, cwd: useCwd, mcpServers }, 120000, null, { probe: true });
      const offer = readSessionOffer(res || {});
      // A session from elsewhere holds none of a chat that had turns before it (`owes`).
      const conv = { ...resumedConversation({ found, proc, upstream, acp, cwd: useCwd, offer }), basedOn: compactionOf(headers, upstream.id) ?? 0, procKey: null, ...(flat.filter(isUserTurn).length > 1 ? { partial: true } : {}) };
      this.#replace(convKey, conv);
      await this.#closeSession(proc.key, found.sessionId);
      this.convs.save();
      return { ok: true, session: found, cwd: useCwd };
    } catch (e) {
      return { ok: false, error: AcpBridge.explainLoadError(e.message), raw: e.message };
    }
  }
  /**
   * The commands an agent published in one of its sessions (`available_commands_update`), for the composer's menu
   * (HarnessV3-ACP AC1-6). None when no conversation of this bridge holds that session.
   * @param {string} upstreamId @param {string} sessionId
   * @returns {{ name: string, description: string, hint: string }[]}
   */
  commandsOf(upstreamId, sessionId) {
    for (const c of this.convs.values())
      if (c.upstreamId === upstreamId && c.sessionId === sessionId)
        return (c.commands || []).map((x) => (typeof x === "string" ? { name: x, description: "", hint: "" } : x));
    return [];
  }
  // Same key derivation as run(): lets a chat command drop the mapping for the conversation it was sent from.
  peekByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    return this.convs.get(conversationKey(upstream.id, cwd, flat, conversationId)) || null;
  }
  forgetByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    return this.forgetConversation(conversationKey(upstream.id, cwd, flat, conversationId));
  }
  /**
   * A sub-agent's exchange ended (HarnessV4_Tasks E15, step 1): its agent lets go of the session, as a chat idle past
   * its limit does (`#rest`). What the agent ran for it ends — Claude Code keeps a process of its own per open
   * session, standing in the sub-agent's worktree, which no one can remove meanwhile — and the record stays: a
   * follow-up opens the same session again. Only where the agent closes a session: one it would hold open anyway is
   * left as it is, for the idle sweep. Settled once the agent answered.
   * @param {any} args
   */
  async restByRequest({ upstream, format, body, cwdHint, conversationId }) {
    const flat = flattenMessages(format, body);
    const { cwd } = determineCwd(upstream.acp || {}, flat, cwdHint);
    const c = this.convs.get(conversationKey(upstream.id, cwd, flat, conversationId));
    const p = c?.procKey ? this.procs.get(c.procKey) : null;
    if (!p || p.exited || !readProfile(p.initResult).sessions.close) return;
    await this.#rest(c);
  }

  static selection(acp) {
    return modelSelection(acp);
  }
  #procKey(upstream, modelId, full = false, own = false, at = null) {
    // A model named on the command line has its process; so has a name Claude Code is named by its variable
    // (`#customModel`), one for every effort Filament leaves on its id.
    const custom = AcpBridge.selection(upstream.acp) === "arg" ? null : this.#customModel(upstream, modelId, at);
    return (
      (AcpBridge.selection(upstream.acp) === "arg" ? `${upstream.id}|${modelId || ""}` : `${upstream.id}|${custom || ""}`) +
      (full ? "|bridge" : "") +
      (own && ownOffAtStart(upstream) ? "|own" : "")
    );
  }
  /**
   * A name typed on a Claude Code card that Claude Code does not list (the owner's of 11-10: `claude-fable-5-2[1m]`, the
   * one id it runs Fable 5.2 in 1M by, was never run): Claude Code takes only the models it lists, and one more that
   * `ANTHROPIC_CUSTOM_MODEL_OPTION` names. Such a name runs in a process of its own, started with the variable naming it
   * (`getProcess`), as Cursor's models each run in theirs: Claude Code takes one such name, and a card may type several.
   * Where the card's own environment sets the variable, its value stays the model of the process every listed one runs
   * in, and runs there; any other name is the more specific word, and its own process — which Filament starts — is
   * started with the variable naming it instead. Never for a name its last listing holds: this bridge's own
   * (`listModels`), else — none since it started — the one the server kept (`listedOf`: the re-read of 11-11, a typed
   * name Claude Code lists got a process of its own after every restart); with neither, a typed name gets its process.
   * A chat whose session is open in a process started naming it (`at`) stays there whatever was listed since, so a
   * Refresh moves no running chat; once that process is gone, its session opens where the list says. The name as the
   * card holds it
   * (`typedName`), whatever effort Filament left on the id: "claude-fable-5-2[1m]-xhigh" is named to Claude Code as
   * "claude-fable-5-2[1m]", its effort set on the session. A model the account's API key offers beyond Claude Code's
   * list (`#keyOffers`) is started the same way, under Anthropic's id for it. Null where none.
   * @param {any} upstream @param {string | null | undefined} modelId
   * @param {string | null} [at]  the key of the process the asking chat's session is open in
   * @returns {string | null}
   */
  #customModel(upstream, modelId, at = null) {
    const name = String(modelId || "").trim();
    if (!name || name === "auto" || name === "default" || agentKey(upstream) !== "claude-code") return null;
    const card = typedName(name, upstream.models) ?? typedName(name, this.#keyedOf(upstream.id).names);
    if (!card) return null;
    const own = upstream.acp?.env?.[CUSTOM_MODEL_VAR];
    if (own != null && String(own).trim().toLowerCase() === card.toLowerCase()) return null;
    const held = at ? this.procs.get(at) : null;
    if (held && !held.exited && String(held.custom || "").toLowerCase() === card.toLowerCase()) return card;
    const listed = (this.modelCache.get(upstream.id)?.names ?? this.listedOf?.(upstream.id) ?? []).map((x) => String(x).toLowerCase());
    return listed.includes(card.toLowerCase()) || listed.includes(name.toLowerCase()) ? null : card;
  }

  /**
   * The models an account's API key offers beyond its agent's own list, with Anthropic's names for them: as this
   * bridge's last listing of the account found them, else — none yet since it started — as the server kept them
   * (`keyedOf`).
   * @param {string} upstreamId
   * @returns {{ names: string[], labels: Record<string, import("../../../core/ports.js").ModelLabel> }}
   */
  #keyedOf(upstreamId) {
    const mine = this.modelCache.get(upstreamId);
    if (mine) return { names: mine.keyed || [], labels: mine.keyLabels || {} };
    const kept = this.keyedOf?.(upstreamId);
    return { names: Array.isArray(kept?.names) ? kept.names : [], labels: kept?.labels || {} };
  }
  /**
   * What a Claude Code account's API key can use beyond the list Claude Code just gave (`names`, with its words for
   * them), asked of Anthropic's Models API (key-models.js) where the account runs on a key — as the listing's own
   * process says while it starts, else as its account last said. Of what the API lists, the ids no turn would find
   * among Claude Code's own (`matchOffered`: "claude-sonnet-5" is its `sonnet`): `keyed`, each started as a typed
   * name is (`#customModel`), with Anthropic's name for it (`keyLabels`). `keyNote`: why none was asked for or
   * came, for the account's card — the key not Filament's to read, the one place for such a name held by Claude Code's
   * own settings, which it puts above the variables Filament starts it with (claude-agent-acp 0.93 acp-agent.js: "Claude
   * Code applies env from settings.json after the subprocess env"), or an ask that failed, named by the address it went
   * to (`keyListWords`), what the key gave before (`was`) kept. Nothing at all for an account on no key, or an agent
   * that is not Claude Code: nobody is asked.
   * @param {any} upstream @param {any} proc  the listing's process @param {any} init  its handshake's answer
   * @param {string[]} names @param {Record<string, import("../../../core/ports.js").ModelLabel>} labels
   * @param {{ names: string[], labels: Record<string, import("../../../core/ports.js").ModelLabel> }} was
   * @returns {Promise<{ keyed?: string[], keyLabels?: Record<string, import("../../../core/ports.js").ModelLabel>, keyNote?: string }>}
   */
  async #keyOffers(upstream, proc, init, names, labels, was) {
    if (agentKey(upstream) !== "claude-code") return {};
    const acp = upstream.acp || {};
    const said = readProfile(init).account ? claudeIdentity(await proc.heardWho(this.usageWhoMs)) : null;
    const access = keyAccess(upstream, said || this.accounts.get(upstream.id)?.identity);
    if (!access) return {};
    /** @param {string} why */
    const notAsked = (why) => ({ keyNote: `Anthropic was not asked what else this account's API key can use: ${why}.` });
    if ("why" in access) return notAsked(access.why);
    const env = agentEnv(agentLaunchEnv(upstream), acp.envRemove).env;
    if (claudeSettingsVar(CUSTOM_MODEL_VAR, { env })?.trim())
      return notAsked(
        `Claude Code's own settings (settings.json in ${env.CLAUDE_CONFIG_DIR ? "the account's folder" : "your .claude folder"}) set ${CUSTOM_MODEL_VAR}, which Claude Code puts above the variables Filament starts it with, so no other model it does not list can be named to it; take ${CUSTOM_MODEL_VAR} out of that file's "env" to have the key's models offered`,
      );
    const got = await keyModels(access, { deadlineMs: this.keyModelsMs });
    if ("failed" in got) {
      const stay = was.names.filter((x) => !names.some((own) => String(own).toLowerCase() === String(x).toLowerCase()));
      return {
        ...(stay.length ? { keyed: stay, keyLabels: Object.fromEntries(Object.entries(was.labels).filter(([id]) => stay.includes(id))) } : {}),
        keyNote: `${keyListWords(access.base)} ${got.failed}: ${stay.length ? `the ${stay.length} it gave before stay${stay.length === 1 ? "s" : ""}` : "only the models Claude Code lists itself are offered"}.`,
      };
    }
    const more = got.models.filter((m) => m.id.toLowerCase() !== "default" && !matchOffered(m.id, names, labels));
    this.log("debug", `[acp] ${upstream.id}: Anthropic lists ${got.models.length} model${got.models.length === 1 ? "" : "s"} for its API key, ${more.length} beyond Claude Code's own list`);
    return more.length ? { keyed: more.map((m) => m.id), keyLabels: modelLabels(more.map((m) => ({ id: m.id, name: m.name, description: KEYED_SAYS }))) } : {};
  }
  /**
   * A kept listing as `listModels` answers it: the agent's own names, then those its account's key offers beyond
   * them (`keyed`), each with its words, the thinking levels its session offered (`caps`), and what the card says of
   * the key's (`keyNote`) — none of them where there is none.
   * @param {any} kept @param {string} source
   */
  #listed(kept, source) {
    const keyed = kept.keyed || [];
    return {
      names: keyed.length ? [...kept.names, ...keyed] : kept.names,
      labels: keyed.length ? { ...kept.labels, ...kept.keyLabels } : kept.labels,
      source,
      ...(kept.caps ? { caps: kept.caps } : {}),
      ...(keyed.length ? { keyed } : {}),
      ...(kept.keyNote ? { keyNote: kept.keyNote } : {}),
    };
  }

  /**
   * The upstream's agent process for the model, its handshake done: the one running, or one started. A turn asking
   * (`turn`) runs on it from now, before the handshake and its session open, and keeps to it to its end, a second
   * attempt of it included, even once it is let go of (the bug report's H11). `own`: the turn hands its agent
   * Filament's agent tool or its team, so an agent that takes its own sub-agents' switch only as it starts runs in a
   * process started without them (own-agents.js).
   * @param {any} upstream @param {string | null | undefined} modelId
   * @param {{ full?: boolean, own?: boolean, turn?: LiveTurn | null }} [o]
   */
  async getProcess(upstream, modelId, { full = false, own = false, turn = null, signal = null } = {}) {
    // A turn waits for the handshake until its stop; anyone else is a probe (`PROBE_WAIT_MS`). A turn names the wait
    // while the agent starts (HarnessV3-FailurePoints §5.1 item 2).
    const waiting = turn ? { waitMs: 0, signal } : { waitMs: PROBE_WAIT_MS };
    /** @param {any} proc */
    const starting = (proc) => {
      if (turn && !proc.initResult) turn.emit({ type: "step", step: "starting" });
    };
    if (turn?.proc && !turn.proc.exited) {
      starting(turn.proc);
      await turn.proc.initialize(waiting);
      return turn.proc;
    }
    // The process the turn's chat has its session open in: a model it was started naming keeps it (`#customModel`).
    const at = turn ? (this.convs.get(turn.convKey)?.procKey ?? null) : null;
    const key = this.#procKey(upstream, modelId, full, own, at);
    let p = this.procs.get(key);
    if (p && !p.exited) {
      p.lastUsed = Date.now();
      if (turn) turn.proc = p;
      starting(p);
      await p.initialize(waiting);
      return p;
    } // a second caller waits for the handshake the first one started
    const acp = upstream.acp || {};
    const args = [...agentArgs(acp)];
    if (modelId && modelId !== "auto" && AcpBridge.selection(acp) === "arg") {
      const i = args.indexOf("acp");
      if (i >= 0) args.splice(i, 0, "--model", modelId);
      else args.push("--model", modelId);
    } // Cursor wants global options before the `acp` subcommand; scripts take them after
    // A name typed on a Claude Code card that it does not list: its process names it to Claude Code (`#customModel`).
    const custom = this.#customModel(upstream, modelId, at);
    // Its own sub-agent tool off where the agent takes that switch only as it starts and the turn hands it Filament's
    // (own-agents.js): Qoder's.
    const off = own ? ownAgentsOff(upstream) : { held: false, args: [], env: {}, words: "" };
    const launch = { ...agentLaunchEnv(upstream), ...off.env, ...(custom ? { [CUSTOM_MODEL_VAR]: custom } : {}) };
    p = this.#watchProc(
      new AcpProcess({
        command: acp.command || "agent",
        args: [...args, ...off.args],
        // Claude Code's model calls that go to Filament's door ask it to add nothing (proxy-twice, toolset.js
        // `claudeLaunchEnv`): where the person's own settings send them through Filament, its turn here has Filament's
        // additions already. Sent anywhere else — Anthropic, their own gateway — they carry nothing of Filament's.
        env: agentKey(upstream) === "claude-code" ? claudeLaunchEnv(launch, { remove: acp.envRemove, door: filamentsDoor(this.ownPlaces) }) : launch,
        envRemove: acp.envRemove,
        cwd: undefined,
        log: this.log,
        clientCapabilities: clientCapabilitiesFor({ full }),
      }).start(),
      key,
      upstream.id,
    );
    p.key = key;
    p.custom = custom;
    p.full = full;
    p.ownOff = off.held;
    p.ownOffWords = off.words;
    this.latestAcp.set(upstream.id, acp);
    const agentName = (upstream.name || upstream.id).replace(" (agent via ACP)", "");
    // In a harness session the session's switch answers (HarnessV3-ACP AC3-2): the request is read as the loop's calls
    // and judged as the loop judges its own; a plan the agent proposes alone waits for the person, with the agent's own
    // choices, whatever the switch says. A harness chat's request no turn of the chat will judge is refused. Otherwise
    // the upstream's policy answers, read at request time from its latest saved settings, not frozen at process start:
    // `ask` puts the question to the person through the chat client's own question tool when the current turn has one,
    // and otherwise behaves like allow-once, which the record says; a word that is none of the policies asks the same
    // way, and is refused where nobody can be asked.
    /** @param {any} params @param {{ signal: AbortSignal }} ctx */
    const permission = async (params, { signal }) => {
      const policy = this.policyOf(this.latestAcp.get(upstream.id) || acp, upstream.id);
      const tc = params?.toolCall || {};
      const title = tc.title || tc.kind || "";
      /** @type {any[]} */
      const options = params?.options || [];
      const callId = tc.toolCallId ? String(tc.toolCallId) : null;
      const onlyAlways = !optionFor(options, true) && !!alwaysOf(options);
      // The call it is for, as the request describes it: an agent that asks before a call runs may announce the call
      // only here (Gemini CLI, Qoder), so the turn draws its card from it, and the question stands on that card. One
      // asked between turns waits for the agent's own turn, whose switch judges it (AC3-9).
      this.#toTurn(params?.sessionId, (read, from) => read.asked(params?.toolCall, from), { work: true, asks: true });
      // A session writing Filament's summary (HarnessV3-ACP AC5-4) reads only: whatever it asks is refused.
      const writing = this.#writing.has(this.#rootOf(String(params?.sessionId || "")));
      const turn = writing ? null : await this.#turnFor(params?.sessionId);
      /** @param {any} o */
      const pick = (o) => (o ? { outcome: { outcome: "selected", optionId: o.optionId } } : { outcome: { outcome: "cancelled" } });
      let d = null,
        how = policy,
        asked = false;
      /** How a call the answer keeps from running ends: the person's no declines it, a refusal refuses it, saying what
       *  refused it, and the switch's question a stop or a hang-up left unanswered stops it with the turn.
       *  @type {{ how: "declined" | "refused" | "stopped", why: string } | null} */
      let kept = null;
      // Filament's own hand is what its server listed at the session's own address, never a server's name alone.
      const calls = turn?.permits && !turn.done ? loopCalls(tc, upstream.id, process.platform, this.ownListed.get(String(turn.conv?.mcpToken || ""))) : null;
      if (writing) {
        // Its reject for this once: an "always" would stay in a session the summary leaves behind.
        d = pick(options.find((o) => String(o?.kind || "").toLowerCase() === "reject_once"));
        how = "refused: the agent writes Filament's summary, which reads only";
        kept = { how: "refused", why: "Filament, as the agent writes its summary" };
      } else if ((!turn || turn.done) && this.#inChat(params?.sessionId)) {
        // Asked between the chat's turns, and no turn of the agent's own took it (P1's sibling, the bug report):
        // nothing stands for the person's switch, and the upstream's policy is not theirs. Its reject for this once;
        // the agent can ask again in a turn.
        d = pick(optionFor(options, false));
        how = "refused: no turn of the harness chat runs to judge it";
        kept = { how: "refused", why: "Filament, as no turn of the chat ran to judge it" };
      } else if (calls === "hand") {
        // Filament's own tool judges each call where it acts, so an "always" the agent keeps grants it nothing past that.
        d = pick(optionFor(options, true) || (onlyAlways ? alwaysOf(options) : null));
        how = "the session's switch: Filament's own hand, judged where it acts";
      } else if (calls && calls !== "plan") {
        // Claude titles a command by its description: the record names the command itself.
        const command = calls.length === 1 && (calls[0].name === "bash" || calls[0].name === "powershell") ? String(calls[0].input.command || "") : "";
        const what = describeToolCall(command ? { kind: "execute", title: command } : tc);
        // Its notes go to the request that read the turn as it was judged, should the turn end meanwhile (`sayer`).
        const say = turn.sayer();
        // One that offers no allow-once but an always is asked about whatever the mode, its card saying so: the grant
        // would stay in the agent, past the switch's later verdicts, so only a yes takes it.
        const j = await this.judged(turn, calls, { agent: agentName, what, call: callId, signal, always: onlyAlways });
        const option = j.outcome === "cancelled" ? null : optionFor(options, j.outcome === "run") || (j.outcome === "run" && onlyAlways && j.asked ? alwaysOf(options) : null);
        d = pick(option);
        how = `the session's switch (${j.mode}): ${j.outcome}`;
        // A request the agent withdrew is the agent's to end.
        if (j.outcome === "refused" || j.outcome === "declined") kept = { how: j.outcome, why: j.outcome === "refused" ? String(j.why || "") : "" };
        else if (j.outcome === "cancelled" && !signal?.aborted) kept = { how: "stopped", why: "" };
        else if (j.outcome === "run" && !option) {
          kept = { how: "refused", why: "Filament, as the agent offered no allow it could take" };
          say({ type: "note", text: `permission: ${agentName} offered no allow Filament could take — not run` });
        } else if (j.outcome === "run" && String(option?.kind || "").toLowerCase() === "allow_always")
          say({ type: "note", text: `permission: ${agentName} keeps this always-allow for the rest of its session, on ${j.by === "lead" ? "its lead's" : "the person's"} yes` });
      } else if (calls === "plan") {
        asked = true;
        // Claude asks it in its own words ("Ready to code?"); another agent's plan is said by what it asks to do.
        const ask = String(params?._meta?.permission?.title || "") || `${agentName} wants to ${describeToolCall(tc)}`;
        const form = fromAgentPlan({ title: ask, plan: planWords(tc), call: callId, options, agent: agentName });
        d = toPermission(await this.askPerson(turn, form, { signal }));
        how = d.outcome.outcome === "selected" ? "asked on the page" : "asked on the page (no answer)";
        if (d.outcome.outcome === "selected") this.#planAnswered(turn, options.find((o) => o?.optionId === d.outcome.optionId));
      } else if (askingPolicy(policy) && turn && !turn.done && turn.bridge !== "off" && turn.clientTools.has("ask")) {
        asked = true;
        const question = `${agentName} wants to ${describeToolCall(params.toolCall)}. Allow it?`;
        const call = turn.clientTools.buildAsk({ question, header: "Permission", options });
        try {
          const optionId = await this.askClient(turn, {
            kind: "permission",
            call,
            parse: (text) => ClientToolset.parseAskAnswer(text, options, question, turn.clientTools.askShown(options)),
          });
          d = optionId
            ? { outcome: { outcome: "selected", optionId } }
            : { outcome: { outcome: "cancelled" } };
          how = optionId ? "asked the user" : "asked the user (no clear answer)";
        } catch (e) {
          d = { outcome: { outcome: "cancelled" } };
          how = `asked the user (${e.message})`;
        }
      }
      if (!d) {
        // A word that is none of the policies, with nobody to ask, is refused as `reject` refuses (`choosePermission`).
        d = choosePermission(policy === "ask" ? "allow-once" : policy, params);
        // An agent that offers only to always allow it is allowed nothing, and nothing is said as allowed once.
        if (policy === "ask" && d.outcome.outcome === "selected") {
          how = "ask (client has no question tool; allowed once)";
          if (turn && !turn.done) noteUnanswerable(turn);
        } else if (!isPolicy(policy)) how = `"${policy}", none of the policies: nobody to ask, refused`;
      }
      // A call the person's or the policy's answer keeps from running: a reject declines it when the person chose it
      // and refuses it when the policy did (as does the policy's cancel, when the option it wants isn't offered). A
      // question nobody answered is the turn's to end. A refusal of Filament's own above has said its why.
      if (!kept && !Array.isArray(calls) && calls !== "hand") {
        const chosen = d.outcome.outcome === "selected" ? options.find((o) => o?.optionId === d.outcome.optionId) : null;
        if (chosen ? /^reject/i.test(String(chosen.kind || "")) : !asked) kept = asked ? { how: "declined", why: "" } : { how: "refused", why: policyRefused(policy) };
      }
      this.log("info", `[acp] permission (${how}) ${title} -> ${d.outcome.optionId || d.outcome.outcome}`);
      this.permissionLog.push({
        at: Date.now(),
        upstream: upstream.id,
        policy: how,
        title: params?.toolCall?.title || "",
        kind: params?.toolCall?.kind || "",
        decision: d.outcome.optionId || d.outcome.outcome,
      });
      if (this.permissionLog.length > 200) this.permissionLog.shift();
      this.#op(
        `agent permission on ${upstream.id}: ${params?.toolCall?.kind || "action"} → ${d.outcome.optionId || d.outcome.outcome}`,
        {
          // Durable, so content-free: the KIND and the DECISION, not the agent-supplied title. The title (a file path or a
          // whole command) stays in the in-RAM permissionLog, which is what the dashboard reads live; it does not persist here.
          sub: "permission",
          detail: {
            upstream: upstream.id,
            policy: how,
            kind: params?.toolCall?.kind || null,
            decision: d.outcome.optionId || d.outcome.outcome,
          },
          ref: { upstreamId: upstream.id },
        },
      );
      const end = kept;
      if (end && callId) this.#toTurn(params.sessionId, (read, from) => read.notRun(callId, end.how, end.why, from));
      return d;
    };
    p.onRequest("session/request_permission", (/** @type {any} */ params, /** @type {{ signal: AbortSignal }} */ ctx) => this.#answering(params?.sessionId, () => permission(params, ctx)));
    for (const method of [
      "fs/read_text_file",
      "fs/write_text_file",
      "terminal/create",
      "terminal/output",
      "terminal/wait_for_exit",
      "terminal/kill",
      "terminal/release",
    ])
      p.onRequest(method, (params) => (JUDGED_SERVICES.has(method) ? this.#answering(params?.sessionId, () => this.#clientService(p, upstream, method, params || {})) : this.#clientService(p, upstream, method, params || {})));
    // Cursor's own extensions (CURSOR_ANSWERS) name only their call: the turn that drew the call reads them.
    for (const method of Object.keys(CURSOR_ANSWERS)) p.onRequest(method, (params) => this.#callExtension(method, params || {}));
    // What an agent asks the person (HarnessV3-ACP AC2-4): ACP's elicitation (a form, or a link to open), Cursor's
    // questions and the plan it proposes. The signal ends the wait when the agent withdraws its question.
    p.onRequest("elicitation/create", (params, { signal }) => this.#elicit(agentName, params || {}, signal));
    p.onRequest("cursor/ask_question", async (params, { signal }) => {
      const turn = this.#callTurn(params?.toolCallId);
      const form = fromCursorQuestion(params || {}, { agent: agentName });
      if (typeof form !== "string") return toCursorQuestion(form, await this.askPerson(turn, form, { signal }));
      this.unaskable(turn, String(params?.title || "a question"), form, "Skipped");
      return { outcome: { outcome: "skipped", reason: `Filament could not ask it: ${form}` } };
    });
    p.onRequest("cursor/create_plan", async (params, { signal }) =>
      toCursorPlan(await this.askPerson(this.#callTurn(params?.toolCallId), fromCursorPlan(params || {}, { agent: agentName }), { signal })),
    );
    p.on("notification", (method, params) => {
      if (method === "session/update") {
        this.#onUpdate(modeSaidAsText(params));
        const u = params?.update;
        if (u?.sessionUpdate === "usage_update" && u._meta?.["_claude/rateLimit"]) this.#heardLimits(upstream, u._meta["_claude/rateLimit"], "usage_update");
      }
      // Claude's raw SDK messages, asked for when its session opened (HarnessV3-ACP AC1-2), for the turn's reader and
      // for the model cycles they mark (AC3-9). The adapter sends a turn's under the session it prompted, its
      // sub-agents' too (marked by `parent_tool_use_id`). A window of the plan is the account's, not the turn's.
      else if (method === "_claude/sdkMessage") {
        const m = params?.message;
        if (m?.type === "rate_limit_event") this.#heardLimits(upstream, m.rate_limit_info, "rate_limit_event");
        else if (m && typeof m === "object") {
          const sid = String(params?.sessionId || "");
          this.#heardCycle(sid, m);
          if (m.type === "result") this.#heardRun(p, sid, m);
          else if (m.type === "conversation_reset") this.#heardReset(p, sid);
          // Work while it runs is the running turn's alone: between turns the session's tasks say it.
          if (isProgressFrame(m)) this.#listeners.get(this.#rootOf(sid))?.raw(m);
          else
            this.#toTurn(sid, (read) => read.raw(m), {
              starts: m.type === "system" && m.subtype === "status" && m.status === "requesting",
              ends: m.type === "result",
            });
        }
      } else if (method === "_auth/status_update" && params?.authStatus) this.#heardIdentity(upstream, params.authStatus);
      // The person followed a link the agent asked them to open through (HarnessV3-ACP AC2-4): its wait ends, opened.
      else if (method === "elicitation/complete") this.#links.get(String(params?.elicitationId || ""))?.abort({ outcome: "accepted" });
    });
    // A close Claude Code may still be saving as it exits is cut short with the process that ends it: as Filament ends
    // the process, before its exit comes, and as it exits by itself.
    p.on("ended", () => this.#closesCut(p));
    p.on("exit", () => {
      // The commands Filament runs for the agent end with it: nobody would read them, or stop them (the bug report's
      // L23).
      this.#endTerminals(p);
      this.#closesCut(p);
      if (this.procs.get(key) === p) this.procs.delete(key);
      // A newer process under the same key holds its chats now (this one was let go of, `letGo`): they stay with it.
      if (this.procs.has(key)) return;
      for (const c of this.convs.values())
        if (c.procKey === key) {
          c.procKey = null;
          // An agent that exited on its own may have ended Claude Code's process so too, which writes totals Filament
          // never read: what the session's transcript saved is not known. One Filament ended had its tree killed.
          if (!p.ended) c.saved = null;
          this.#forgetBetween(c.sessionId, { proc: p, chat: c });
        }
    });
    this.procs.set(key, p);
    if (turn) turn.proc = p;
    starting(p);
    this.log("info", `[acp] started ${p.spec.resolved} ${args.join(" ")}`);
    const init = await this.#initialize(p, upstream, waiting);
    // `authenticate` is opt-in: agents use the login they already have, and some (Gemini) open a browser login
    // page when asked, which must never happen as a side effect of listing models.
    const auth = authenticateMethod(init);
    if (auth && acp.authenticate === true) {
      try {
        await p.request("authenticate", { methodId: auth }, turn ? 0 : 15000, signal);
      } catch (e) {
        this.log("debug", `[acp] authenticate (${auth}) skipped: ${e.message}`);
      }
    }
    return p;
  }

  // session/new (or load) with the one retry ACP asks for: on "authentication required" call `authenticate` with the
  // agent's first non-terminal method (it uses the login the CLI already has) and try again; if that fails too, the
  // error names the command that logs in, instead of a bare JSON-RPC code. No clock: the turn's stop (`signal`) ends
  // the wait (HarnessV3-FailurePoints §4 B).
  async newSession(proc, upstream, method, params, { signal = null } = {}) {
    // A session the agent opens after a stop cut the wait for it is held by nothing: let go of (HarnessV4_Tasks B9).
    const late = (/** @type {any} */ res) => void this.#closeSession(proc.key, String(res?.sessionId || ""));
    try {
      const res = await proc.request(method, params, 0, signal, late);
      this.#sessionOp(upstream, method, res?.sessionId);
      return res;
    } catch (e) {
      if (!(
        e.code === -32000 ||
        /auth(entication)? required|not (logged|signed) in|unauthori[sz]ed/i.test(e.message)
      ))
        throw e;
      const m = authenticateMethod(proc.initResult);
      // `authenticate` can open a browser or start a device flow (Gemini's does): only when the upstream opted in.
      if (m && upstream.acp?.authenticate === true) {
        try {
          await proc.request("authenticate", { methodId: m }, 0, signal);
          const res = await proc.request(method, params, 0, signal, late);
          this.#sessionOp(upstream, method, res?.sessionId, { afterAuth: true });
          return res;
        } catch (e2) {
          if (signal?.aborted) throw e2;
          throw Object.assign(
            new Error(
              `${agentTitle(upstream)} is not signed in (${e2.message.replace(/^Internal error\s*/i, "").slice(0, 120)}). ${signInAdvice(upstream, process.platform)}, then try again.`,
            ),
            { code: "ACP_AUTH" },
          );
        }
      }
      throw Object.assign(
        new Error(
          `${agentTitle(upstream)} is not signed in. ${signInAdvice(upstream, process.platform)}, then send your message again.`,
        ),
        { code: "ACP_AUTH" },
      );
    }
  }

  #listeners = new Map(); // sessionId -> fn
  /** The sessions writing Filament's summary (HarnessV3-ACP AC5-4): what they ask is refused, nothing written or run. */
  #writing = new Set();
  /** How many of each session's requests the agent waits on are being answered now (`#answering`), by its root session. @type {Map<string, number>} */
  #asking = new Map();
  /**
   * A request the agent waits on, answered: while it is, the turn reading its session does not take the agent for idle
   * (`waitsOn`) — a sub-agent's question waits for the person while Claude's main thread rests — and once it is, the
   * quiet while starts from the answer (`touch`).
   * @template T @param {unknown} sessionId @param {() => Promise<T>} work @returns {Promise<T>}
   */
  async #answering(sessionId, work) {
    const root = this.#rootOf(String(sessionId || ""));
    this.#asking.set(root, (this.#asking.get(root) || 0) + 1);
    try {
      return await work();
    } finally {
      const n = (this.#asking.get(root) || 1) - 1;
      if (n > 0) this.#asking.set(root, n);
      else this.#asking.delete(root);
      this.#listeners.get(root)?.touch();
    }
  }
  /**
   * Each session's model cycles, as Claude's raw messages say them (HarnessV3-ACP AC3-9): whether one of the main
   * thread runs, Claude's word for its state, and the background tasks that ended — those no model call has read
   * yet, and those the running cycle reads; the tasks running now (HarnessV3-FailurePoints §5.1 item 2), and the chat
   * last told of them; and those whose status said they ended while their end (`task_notification`), which Claude's
   * own cycle answers, had not come yet (`unnoticed`, from when), for a sub-agent's turn that waits for them.
   * @type {Map<string, { running: boolean, state: string, unread: OwnTask[], reads: OwnTask[], tasks: Map<string, AgentTask>, unnoticed: Map<string, { task: AgentTask, at: number }>, chain: string | null }>}
   */
  #cycles = new Map();
  /**
   * Who waits for a session's running tasks to start or end (`#tasksOwed`), by the session: each rung once the tasks
   * that run change. @type {Map<string, Set<() => void>>}
   */
  #taskBells = new Map();
  /** How long a task whose status said it ended is owed its end (TASK_NOTICE_MS). */
  #noticeMs = TASK_NOTICE_MS;
  /**
   * What a harness chat's session said while no turn read it (AC3-9), for the turn that shows it: the pieces, whether
   * the agent's own turn was asked for and the tasks it names, whether the word to ask again came while a reader held
   * the session (`again`), and the requests that wait for a turn to judge them.
   * @type {Map<string, { items: HeldPiece[], asked: boolean, again: boolean, tasks: OwnTask[] | null, waiting: ((turn: LiveTurn | null | undefined) => void)[] }>}
   */
  #between = new Map();
  /**
   * What a harness chat's session spent between turns that no turn showed (`#keepUnshown`), by the chat, added up: the
   * chat's next turn books it, whoever's (`#bookUnshown`), or the agent's own turn that finds the session gone fails
   * with it. Kept with the session map (`SessionMap.unshown`), so a restart before that turn loses none of it.
   */
  get #unshown() {
    return this.convs.unshown;
  }
  /**
   * The figure of each session's running total its turns count from (`#ownCost`), by the agent process that holds the
   * session open: Claude's adapter says one total for a session in its process, whichever chat's turn ran on it, so
   * every chat that holds the session there (each resumed it) counts from the same figure (`from`: null where the
   * total goes on from a figure out of Filament's sight). With it, the newest total a result of the session's query
   * said since (`heard`, `#heardRun`), and what a query before it spent past the figure, which Claude's adapter
   * restarted in a fresh context before a turn booked it (`carried`: null where its start was not known), and why the
   * figure is not known where another reason than the session's opening again says it (`why`). It goes with its
   * process.
   * @type {WeakMap<object, Map<string, { from: number | null, heard: number | null, carried: number | null, why: string | null }>>}
   */
  #costSaid = new WeakMap();
  /** The session's figures in `proc`, none known before any is set, nor for no process. @param {any} proc @param {string} sessionId */
  #figuresOf(proc, sessionId) {
    if (!proc) return { from: null, heard: null, carried: 0, why: null };
    let said = this.#costSaid.get(proc);
    if (!said) this.#costSaid.set(proc, (said = new Map()));
    let f = said.get(sessionId);
    if (!f) said.set(sessionId, (f = { from: null, heard: null, carried: 0, why: null }));
    return f;
  }
  /**
   * The session's turns in `proc` count from `figure` from here: what its total said before it is booked.
   * @param {any} proc @param {string} sessionId @param {number | null} figure
   */
  #countFrom(proc, sessionId, figure) {
    Object.assign(this.#figuresOf(proc, sessionId), { from: figure, heard: null, carried: 0, why: null });
  }
  /**
   * A session opened again in `proc` for `conv`, its query going on from what its transcript saved (`queryFrom`): its
   * turns count from the total that saved (`saved.cost`), where Filament knows it and no other chat held the session
   * open there, whose query it goes on in.
   * @param {any} proc @param {any} conv
   */
  #countFromSaved(proc, conv) {
    if (conv.queryFrom !== "saved" || typeof conv.saved?.cost !== "number") return;
    for (const c of this.convs.values()) if (c !== conv && c.sessionId === conv.sessionId && c.procKey === proc.key) return;
    this.#countFrom(proc, conv.sessionId, conv.saved.cost);
  }
  /** A sub-agent's own session -> the session that launched it (HarnessV3-ACP AC1-2). */
  #childOf = new Map();
  /**
   * The sub-agents' sessions their agent lets Filament cancel alone while they work (ACP's sub-agents RFD, `cancel`;
   * HarnessV4_Tasks E6), the newest last: a Stop of that sub-agent, and nothing else of its agent's.
   * @type {Set<string>}
   */
  #cancellable = new Set();
  /** The session a sub-agent's session belongs to: the one whose turn launched it, through any nesting. */
  #rootOf(sessionId) {
    let s = sessionId;
    for (let i = 0; i < 16 && this.#childOf.has(s); i++) s = this.#childOf.get(s);
    return s;
  }
  /** The turn running on a session, or on the session that launched it: a sub-agent asks through its parent's turn. */
  #turnOf(sessionId) {
    return this.turns.get(sessionId) || this.turns.get(this.#rootOf(sessionId));
  }
  /** Whether a session, or the one that launched it, is a harness chat's: a turn of the chat ran in it. @param {string} sessionId */
  #inChat(sessionId) {
    const root = this.#rootOf(String(sessionId || ""));
    for (const c of this.convs.values()) if (c.sessionId === root && c.chain) return true;
    return false;
  }
  /** A call's session, from the update that announced it. */
  #callSession = new Map();
  /**
   * One of Cursor's extensions, read by the turn whose call it names; one for a call no turn is reading is answered
   * as Cursor's page documents.
   * @param {string} method @param {any} params
   */
  #callExtension(method, params) {
    const sid = this.#callSession.get(String(params.toolCallId || ""));
    const reader = sid ? this.#listeners.get(this.#rootOf(sid)) : null;
    if (reader) return reader.ext(method, params);
    this.log("debug", `[acp] ${method} for a call no turn is reading`);
    return { outcome: { outcome: CURSOR_ANSWERS[method] } };
  }
  /** The turn a call belongs to, by the session that announced it: Cursor's questions name only their call. */
  #callTurn(toolCallId) {
    const sid = this.#callSession.get(String(toolCallId || ""));
    return sid ? this.#turnOf(sid) : null;
  }
  /** The links an agent asked the person to open, by their elicitation's id, until the agent says one completed. */
  #links = new Map();
  /**
   * ACP's `elicitation/create` (HarnessV3-ACP AC2-4), put to the person on its session's turn: a form, or a link to
   * open, which the agent's `elicitation/complete` settles as opened. One asked outside a session (while one opens)
   * has nobody to ask, and is declined.
   * @param {string} agent @param {any} params @param {AbortSignal} signal
   */
  async #elicit(agent, params, signal) {
    const turn = await this.#turnFor(params.sessionId);
    const form = fromElicitation(params, { agent });
    if (typeof form === "string") {
      this.unaskable(turn, String(params.message || "a question"), form, "Declined");
      return { action: "decline" };
    }
    const id = form.link?.id;
    if (!id) return toElicitation(form, await this.askPerson(turn, form, { signal }));
    const opened = new AbortController();
    this.#links.set(id, opened);
    try {
      return toElicitation(form, await this.askPerson(turn, form, { signal: AbortSignal.any([signal, opened.signal]) }));
    } finally {
      if (this.#links.get(id) === opened) this.#links.delete(id);
    }
  }
  #onUpdate(params) {
    const sid = params?.sessionId;
    const u = params?.update || {};
    // A sub-agent's session is announced on the session that launched it; from then on its updates reach that turn's
    // reader, marked as the sub-agent's. Claude's adapter says it in ACP's sub-agents RFD from 0.93 (`subagent_update`,
    // the child's id its `sessionId`, which reports its state there too), where it said `subagent_spawned` before.
    const child = u.sessionUpdate === "subagent_spawned" ? u.subagentSessionId : u.sessionUpdate === "subagent_update" && u.sessionId !== sid ? u.sessionId : null;
    if (typeof child === "string" && child) {
      this.#childOf.set(child, sid);
      if (this.#childOf.size > MAX_SUBAGENT_SESSIONS) this.#childOf.delete(this.#childOf.keys().next().value);
      if (u.sessionUpdate === "subagent_update") this.#heardChild(child, u);
    }
    if (u.sessionUpdate === "tool_call" && u.toolCallId) {
      this.#callSession.set(String(u.toolCallId), sid);
      if (this.#callSession.size > MAX_CALL_SESSIONS) this.#callSession.delete(this.#callSession.keys().next().value);
    }
    this.convs.absorbUpdate(sid, u, { replay: this.#replaying.has(sid) });
    if (u.sessionUpdate === "current_mode_update") this.#modeMoved(sid, String(u.currentModeId || u.modeId || ""));
    // A loaded session's replay is its history, no turn's (`#reattach`).
    if (this.#replaying.has(sid)) this.#replaying.set(sid, Date.now());
    else this.#toTurn(sid, (read, from) => read(u, from), { work: drawsWork(u) });
  }
  /**
   * The person's answer to the plan an agent proposes (HarnessV3-ACP AC3-3), as the agent acts on it. A way to keep
   * planning: Claude's adapter ends the turn, which isn't a cancel (`out.planBack`), and the agent stays in its plan
   * mode through the turns that follow (`conv.keepPlan`, which configure.js reads). A yes leaves plan mode: Claude's
   * plain yes for `default`, which its adapter doesn't publish; another yes for a mode the agent says, which
   * `#modeMoved` turns back to the turn's asking mode where it differs.
   * @param {LiveTurn} turn @param {any} option  the agent's option the person chose
   */
  #planAnswered(turn, option) {
    const conv = turn.conv;
    if (/^reject/i.test(String(option?.kind || ""))) {
      turn.planBack = true;
      conv.keepPlan = true;
      return;
    }
    conv.keepPlan = false;
    if (option?.optionId === "exit-plan-default") conv.mode = "default";
    else turn.planMode = askingMode(conv);
  }
  /**
   * The agent moved its own mode while a harness turn runs on its session (HarnessV3-ACP AC3-3). Into plan mode —
   * Claude's own EnterPlanMode — it plans on through the turns that follow, until its plan is accepted. Moved on by a
   * yes to its plan into a mode other than the turn's asking one (Claude's fresh context starts in its own mode that
   * decides by itself), it is turned back, on the record: the session's switch still answers what it asks to do.
   * @param {string} sessionId @param {string} mode
   */
  #modeMoved(sessionId, mode) {
    const turn = this.turns.get(sessionId);
    if (!turn?.permits || turn.done || !turn.conv || !mode) return;
    const conv = turn.conv;
    if (mode === "plan") {
      conv.keepPlan = true;
      return;
    }
    const back = turn.planMode;
    turn.planMode = null;
    if (!back || mode === back) return;
    // Its note goes to the request that read the turn as the mode moved, should the turn end meanwhile (`sayer`).
    const say = turn.sayer();
    turn.proc.request("session/set_mode", { sessionId: conv.sessionId, modeId: back }, MODE_BACK_MS).then(
      () => {
        conv.mode = back;
        say({ type: "note", text: `acp: mode ${back} again: the agent started on its plan in its own ${mode} mode; in a harness session it asks before it acts, and the session's switch answers` });
      },
      (/** @type {any} */ e) => say({ type: "note", text: `acp: mode ${back} not applied after the agent started on its plan (${e.message}): it runs in its own ${mode} mode until this turn ends` }),
    );
  }
  /**
   * The reader of the turn a session's word belongs to, handed to `fn` with whose word it is: a sub-agent's session
   * reaches the turn that launched it. With no turn reading, a harness chat's session holds the word for the turn that
   * shows it (`#hold`, HarnessV3-ACP AC3-9): `starts` and `ends` say it begins or ends a model cycle of the main
   * thread, `work` that it is work a turn draws. Another session's work between turns is nobody's, and logged.
   * An own turn reads its one cycle: from the model cycle that begins after it is over, the session holds what it says
   * as it would between turns (`#pastOwn`), for a turn of its own that the own turn's end asks for (`ownAgain`).
   * A request the agent waits on (`asks`) draws a turn whoever asked and whether or not a cycle runs: a sub-agent Claude
   * launched in the background asks after the turn that launched it ended, with no cycle of Claude's running, and only
   * a turn's switch may answer it (the owner's list of 11-08).
   * @param {string} sessionId @param {(read: any, from: { subagent: string } | null) => void} fn
   * @param {{ starts?: boolean, ends?: boolean, work?: boolean, asks?: boolean }} [o]
   */
  #toTurn(sessionId, fn, { starts = false, ends = false, work = false, asks = false } = {}) {
    const root = this.#rootOf(sessionId);
    const from = root === sessionId ? null : { subagent: sessionId };
    const read = this.#listeners.get(root);
    if (read && !this.#pastOwn(root, starts)) return void fn(read, from);
    const draws = (asks && !this.#writing.has(root)) || (work && !from && !!this.#cycles.get(root)?.running);
    if (!this.#hold(root, { read: (r) => fn(r, from), starts, ends, draws }) && work)
      this.log("debug", `[acp] ${String(root).slice(0, 8)}: the agent worked between turns; no harness chat shows this session's own turns`);
  }
  /**
   * Whether what a harness chat's session says now is past the one cycle the own turn reading it shows (AC3-9): that
   * cycle is over (`ownOver`), and the session holds something past it already — once it holds, it holds all that comes
   * after — or this word begins a model cycle (`starts`) that is not the turn's to read on into for words it queued
   * (`readsOn`). Such a word is held for the next turn, and a request that comes with it waits for that turn
   * (`#turnFor`).
   * @param {string} root @param {boolean} [starts]
   */
  #pastOwn(root, starts = false) {
    const read = this.#listeners.get(root);
    if (!read?.ownOver?.()) return false;
    return !!this.#between.get(root)?.items.length || (starts && !read.readsOn());
  }
  /**
   * One of Claude's raw messages, as it moves the session's model cycles (AC3-9): a background task that ended, a model
   * call of the main thread beginning (it reads every task that ended before it), Claude's state, a cycle's result —
   * messages the SDK never marks as a sub-agent's, which it does only for assistant and user messages.
   * @param {string} sessionId @param {any} m
   */
  #heardCycle(sessionId, m) {
    let c = this.#cycles.get(sessionId);
    if (!c) this.#cycles.set(sessionId, (c = { running: false, state: "", unread: [], reads: [], tasks: new Map(), unnoticed: new Map(), chain: null }));
    const sys = m.type === "system" ? String(m.subtype || "") : "";
    const had = c.tasks.size;
    const owed = c.unnoticed.size;
    if (sys.startsWith("task_") && this.#heardTask(sessionId, c, sys, m)) this.#saidTasks(sessionId, c);
    // A waiter goes on once this message's handler is done, its turn's reader having read it (the caller hands it on at
    // once): it reads Claude as it is then.
    if (c.tasks.size !== had || c.unnoticed.size !== owed) for (const ring of [...(this.#taskBells.get(sessionId) || [])]) ring();
    if (sys === "task_notification" && !m.skip_transcript && !m.ambient)
      c.unread = [...c.unread, { id: String(m.task_id || ""), status: String(m.status || ""), summary: String(m.summary || "").trim().slice(0, 600) }].slice(-OWN_TASKS);
    else if (sys === "status" && m.status === "requesting") {
      c.reads = (c.running ? [...c.reads, ...c.unread] : c.unread).slice(-OWN_TASKS);
      c.unread = [];
      c.running = true;
    } else if (sys === "session_state_changed") {
      c.state = String(m.state || "");
      // Idle is the turn's end as Claude's adapter reads it, a result or none (its issue #825: a model stream dropped
      // mid-turn ends with no result): no cycle runs on, and none is on its way for the chat (`ownComing`).
      if (c.state === "idle") c.running = false;
    } else if (m.type === "result") c.running = false;
  }
  /**
   * One of Claude's results in a session the process `p` holds (AC1-2), read against the session's running totals on
   * each conversation that holds it there. The Claude session it names is its run's (`runOf`): a result that names
   * another than the run before it comes from a fresh conversation — Claude's adapter restarts the session's query in a
   * fresh context, as when a plan is accepted with one, under a Claude session of its own — whose running total began
   * from nothing: the figure the session's turns count from (`#costSaid`) is nothing, and so is the reading, and what
   * the query before spent past that figure — up to the newest total its results said — is carried to the next figure
   * a turn books. Its `total_cost_usd` is the newest total of the session's (`heard`), a crashed run's zeroed one none.
   * Its `modelUsage` is the totals by model (`usageSaid`), and what it grew by over the reading before is the result's
   * own, every call's (`ledgerSpend`). A query whose first result this is (`queryFrom`, said as the session opened, or
   * a place among its run's results, `result_index`, not past the newest heard) began from nothing where the session is
   * new, else from what its transcript saved, which Claude Code writes as its process exits on its own (`saved`): where
   * the session opened again outside this process, what the conversation knows of that (null where nothing tells it),
   * and where Claude's adapter restarted the query itself, the totals of the one it closed, which that close wrote.
   * Totals below what the transcript saved, by model or in cost, did not go on from it — Claude Code ended before it
   * wrote them at the close Filament knows of — and where they began is not known (`unsaved`).
   * Claude's adapter lists the rows of such a first result as its main loop's alone (`mainOnly`); a fresh one's it
   * counts from nothing, as Filament does.
   * @param {any} p @param {string} sessionId @param {any} m
   */
  #heardRun(p, sessionId, m) {
    const of = typeof m.session_id === "string" ? m.session_id : "";
    const at = typeof m.result_index === "number" ? m.result_index : null;
    const reading = readingOf(m.modelUsage);
    const total = typeof m.total_cost_usd === "number" && m.total_cost_usd > 0 ? m.total_cost_usd : null;
    /** @type {{ grew: any, mainOnly: boolean } | null} */
    let seen = null;
    let restarted = false;
    let unsaved = false;
    for (const c of this.convs.values()) {
      if (c.sessionId !== sessionId || c.procKey !== p.key) continue;
      const fresh = !!(of && c.runOf && c.runOf !== of);
      if (fresh) Object.assign(c, { usageSaid: {}, saved: null, queryFrom: "" });
      restarted ||= fresh;
      const from = c.queryFrom || "";
      const anew = !!from || (at != null && c.runAt != null && at <= c.runAt);
      const below = from === "saved" && !!c.saved && ((!!reading && fellBelow(reading, c.saved.usage || {})) || (total != null && typeof c.saved.cost === "number" && total < c.saved.cost));
      unsaved ||= below;
      const base = below ? null : from === "new" ? {} : from === "saved" ? (c.saved?.usage ?? null) : (c.usageSaid ?? null);
      if (below) c.saved = null;
      seen ||= { grew: reading && base ? growth(reading, base) : null, mainOnly: anew && !fresh && from !== "new" };
      if (reading) c.usageSaid = reading;
      if (of) c.runOf = of;
      if (at != null) c.runAt = at;
      c.queryFrom = "";
    }
    if (!seen) return;
    ledgerSpend.set(m, seen);
    if (restarted) this.#totalAnew(p, sessionId);
    const f = this.#figuresOf(p, sessionId);
    if (unsaved) Object.assign(f, { from: null, why: "its session opened again from a running total below the one its close was to save, which Claude Code did not write, and where that total began is out of Filament's sight" });
    if (total != null) f.heard = total;
  }
  /**
   * Claude Code began the conversation of a session the process `p` holds again (its raw `conversation_reset`: a
   * /clear, a plan's way on with a fresh context): its running totals begin again from nothing, by model and in cost,
   * for each conversation that holds it there, and its run goes on under the Claude session its next result names —
   * whose count of results, too, begins again — even where no result had named the one before, as in a session just
   * opened again.
   * @param {any} p @param {string} sessionId
   */
  #heardReset(p, sessionId) {
    let held = false;
    for (const c of this.convs.values()) {
      if (c.sessionId !== sessionId || c.procKey !== p.key) continue;
      Object.assign(c, { usageSaid: {}, saved: null, queryFrom: "", runOf: "", runAt: null });
      held = true;
    }
    if (held) this.#totalAnew(p, sessionId);
  }
  /**
   * The session's running total in `p` began again from nothing: its turns count from nothing, and what its query
   * spent past the figure they counted from — up to the newest total its results said — is carried to the next figure
   * a turn books, unknown where that figure was.
   * @param {any} p @param {string} sessionId
   */
  #totalAnew(p, sessionId) {
    const f = this.#figuresOf(p, sessionId);
    const spent = f.heard == null ? 0 : f.from == null || f.carried == null ? null : f.heard < f.from ? f.heard : f.heard - f.from;
    Object.assign(f, { from: 0, heard: null, carried: spent == null || f.carried == null ? null : f.carried + spent });
  }
  /**
   * A task Claude runs beside its work, as its SDK says it (HarnessV3-FailurePoints §5.1 item 2): kept from its start
   * until it ends — its end (`task_notification`), or a change to a status that is over, which keeps it owed its end a
   * while (`unnoticed`, TASK_NOTICE_MS). A housekeeping task is nobody's to see (the SDK's `skip_transcript`,
   * `ambient`). → whether the session's running tasks changed.
   * @param {string} sessionId @param {any} c  the session's cycles @param {string} sys @param {any} m
   */
  #heardTask(sessionId, c, sys, m) {
    const id = String(m.task_id || "");
    if (!id) return false;
    if (sys === "task_started") {
      if (m.skip_transcript || m.ambient) return false;
      c.tasks.set(id, {
        id,
        kind: String(m.task_type || ""),
        description: String(m.description || "").trim().slice(0, 300),
        background: m.is_backgrounded === true,
        call: m.tool_use_id ? String(m.tool_use_id) : null,
        subagent: m.subagent_type ? String(m.subagent_type) : null,
        since: Date.now(),
        tokens: null,
        tools: null,
        lastTool: null,
        summary: null,
      });
      return true;
    }
    if (sys === "task_notification") {
      c.unnoticed.delete(id);
      return c.tasks.delete(id);
    }
    const t = c.tasks.get(id);
    if (!t) return false;
    if (sys === "task_updated") {
      const p = m.patch || {};
      if (TASK_OVER.has(String(p.status || ""))) {
        const now = Date.now();
        for (const [k, u] of c.unnoticed) if (now - u.at >= this.#noticeMs) c.unnoticed.delete(k);
        c.unnoticed.set(id, { task: t, at: now });
        return c.tasks.delete(id);
      }
      if (typeof p.description === "string") t.description = p.description.trim().slice(0, 300);
      if (typeof p.is_backgrounded === "boolean") t.background = p.is_backgrounded;
      return true;
    }
    if (sys === "task_progress") {
      const u = m.usage || {};
      if (typeof u.total_tokens === "number") t.tokens = u.total_tokens;
      if (typeof u.tool_uses === "number") t.tools = u.tool_uses;
      if (m.last_tool_name) t.lastTool = String(m.last_tool_name);
      if (m.summary) t.summary = String(m.summary).trim().slice(0, 300);
      return true;
    }
    return false;
  }
  /**
   * A session's running tasks, said to the harness chat that shows it (`onTasks`): the whole list at every change, so a
   * missed one is never stale for long. The chat is kept, so their end reaches it when the session is let go.
   * @param {string} sessionId @param {any} c  the session's cycles
   */
  #saidTasks(sessionId, c) {
    const conv = this.#chatOf(sessionId);
    const chain = conv?.chain || c.chain;
    if (!chain || !this.onTasks) return;
    c.chain = chain;
    // Whose session runs them, kept as the chat is: a chat moved off the agent is not the agent's to wake for them.
    c.upstream = conv?.upstreamId || c.upstream || null;
    try {
      this.onTasks({ chain, sessionId, upstream: c.upstream, tasks: [...c.tasks.values()].map((t) => ({ ...t, ...(this.#cancellableOf(t.id) ? { stop: true } : {}) })) });
    } catch (/** @type {any} */ e) {
      this.log("debug", `[acp] ${sessionId.slice(0, 8)}: its tasks could not be said (${e.message})`);
    }
  }
  /**
   * A sub-agent's state, as its agent says it in ACP's sub-agents RFD (`subagent_update`): one granted `cancel` can be
   * stopped alone while it works (HarnessV4_Tasks E6), until it goes idle. Its task's row says so at once.
   * @param {string} child  the sub-agent's session @param {any} u
   */
  #heardChild(child, u) {
    const state = String(u.state?.state || "");
    const had = this.#cancellable.has(child);
    if (state === "idle" || state === "unknown") this.#cancellable.delete(child);
    else if (u.capabilities && typeof u.capabilities.cancel === "object" && u.capabilities.cancel !== null) {
      this.#cancellable.delete(child);
      this.#cancellable.add(child);
      if (this.#cancellable.size > MAX_SUBAGENT_SESSIONS) this.#cancellable.delete(this.#cancellable.values().next().value);
    }
    if (had === this.#cancellable.has(child)) return;
    const root = this.#rootOf(child);
    const c = this.#cycles.get(root);
    if (c?.tasks.size) this.#saidTasks(root, c);
  }
  /**
   * The session of a task's sub-agent that its agent lets Filament cancel: Claude's adapter names a sub-agent's session
   * by its task's id, with `:generation:<n>` after the task was taken up again. Null for a task no such session is.
   * @param {string} taskId
   */
  #cancellableOf(taskId) {
    let found = null;
    for (const s of this.#cancellable) if (s === taskId || s.startsWith(`${taskId}:generation:`)) found = s;
    return found;
  }
  /**
   * Stop one task a harness chat's coding agent runs beside its work (HarnessV4_Tasks E6): a sub-agent whose session
   * its agent lets Filament cancel alone — the agent's turn, if one runs, and its other work go on. Its end comes as
   * its agent says it, in the tasks' list. A shell or a workflow its agent stops only for the clients it knows (Claude's
   * adapter: JetBrains AIR's), so these are not stopped here.
   * @param {string} chain  the harness chat @param {string} taskId
   * @returns {{ ok: true } | { ok: false, why: string }}
   */
  stopTask(chain, taskId) {
    for (const [sid, c] of this.#cycles) {
      const task = c.chain === chain ? c.tasks.get(taskId) : null;
      if (!task) continue;
      const child = this.#cancellableOf(taskId);
      if (!child) return { ok: false, why: `its agent lets Filament stop only a sub-agent of its own, and this is its ${task.kind === "local_bash" ? "shell" : task.kind === "local_workflow" ? "workflow" : "task"}: ask the agent to stop it` };
      const conv = this.#chatOf(sid);
      const proc = conv?.procKey ? this.procs.get(conv.procKey) : null;
      if (!proc || proc.exited) return { ok: false, why: "its agent's process is gone" };
      proc.notify("session/cancel", { sessionId: child });
      this.log("info", `[acp] ${sid.slice(0, 8)}: the person stopped its task ${taskId} (the sub-agent's session ${child})`);
      return { ok: true };
    }
    return { ok: false, why: "no such task runs in this chat now" };
  }
  /**
   * The harness chat a session's turns ran in (AC3-9), while its agent runs and marks its cycles in its raw messages
   * (Claude's adapter): the chat that shows the agent's own turns. Null for any other session.
   * @param {string} sessionId
   */
  #chatOf(sessionId) {
    for (const c of this.convs.values()) {
      if (c.sessionId !== sessionId || !c.chain || !c.procKey) continue;
      const p = this.procs.get(c.procKey);
      if (p && !p.exited && readProfile(p.initResult).rawMessages) return c;
    }
    return null;
  }
  /**
   * Hold what a harness chat's session says while no turn reads it, or past the one cycle an own turn reads (AC3-9),
   * the newest HELD_BETWEEN pieces: the first piece of work a cycle of the agent's own draws asks for its own turn —
   * past an own turn's cycle, that turn's end asks for it (`ownAgain`). False for a session no harness chat shows.
   * @param {string} sessionId @param {HeldPiece} piece
   */
  #hold(sessionId, piece) {
    // What a session still says of a turn a Force stop let go of is no one's (`#orLetGo`): no turn is asked for it.
    if (this.#chatOf(sessionId)?.unended) return true;
    let h = this.#between.get(sessionId);
    if (!h) {
      if (!this.#chatOf(sessionId)) return false;
      this.#between.set(sessionId, (h = { items: [], asked: this.#listeners.has(sessionId), again: false, tasks: null, waiting: [] }));
    }
    h.items.push(piece);
    if (h.items.length > HELD_BETWEEN) h.items.splice(0, h.items.length - HELD_BETWEEN);
    if (piece.draws && !h.asked) this.#askOwn(sessionId, h);
    return true;
  }
  /**
   * Ask the server for the agent's own turn (`onOwnCycle`, AC3-9), naming the background tasks the cycle reads — the
   * same ones again when it asks again for the same pieces. Without the hook, the pieces wait for the chat's next turn.
   * @param {string} sessionId @param {{ asked: boolean, tasks: OwnTask[] | null }} h
   */
  #askOwn(sessionId, h) {
    const conv = this.#chatOf(sessionId);
    if (!conv || !this.onOwnCycle) return;
    h.asked = true;
    h.tasks ||= this.#cycles.get(sessionId)?.reads.splice(0) || [];
    try {
      this.onOwnCycle({ upstreamId: conv.upstreamId, sessionId, chain: conv.chain, model: conv.chainModel, tasks: h.tasks });
    } catch (/** @type {any} */ e) {
      this.declineOwn(sessionId, `its turn could not be asked for: ${e.message}`);
    }
  }
  /**
   * What a harness chat's session said while no turn read it (AC3-9), read by the turn that took the session: a
   * person's turn takes it all, and shows a cycle the agent began by itself before its own answer, as AC1's rest of
   * the turn does; the agent's own turn takes it up to the model cycle after the first that ended (`cycle`), as a cycle
   * on its heels draws a turn of its own (`ownAgain`). The requests that wait for a turn are the turn's once nothing is
   * left held.
   * @param {string} sessionId @param {any} reader @param {LiveTurn} turn @param {{ cycle?: boolean }} [o]
   */
  #takeHeld(sessionId, reader, turn, { cycle = false } = {}) {
    const h = this.#between.get(sessionId);
    if (!h) return;
    let cut = h.items.length;
    if (cycle) {
      const ended = h.items.findIndex((p) => p.ends);
      const next = ended < 0 ? -1 : h.items.findIndex((p, i) => i > ended && p.starts);
      if (next >= 0) cut = next;
    }
    h.tasks = null;
    for (const piece of h.items.splice(0, cut)) piece.read(reader);
    if (h.items.length) return;
    this.#between.delete(sessionId);
    for (const w of h.waiting) w(turn);
  }
  /**
   * The turn a session's request is for (AC3-9): the one running on it — unless the request comes past the one cycle
   * that turn shows, its own (`#pastOwn`) — else, while the agent's own turn is asked for and the session's words wait
   * for it, the turn that takes them, or none when nobody will.
   * @param {string} sessionId
   * @returns {Promise<LiveTurn | null | undefined>}
   */
  async #turnFor(sessionId) {
    const root = this.#rootOf(sessionId);
    const turn = this.#turnOf(sessionId);
    if (turn && !turn.done && !this.#pastOwn(root)) return turn;
    const h = this.#between.get(root);
    if (!h?.asked) return turn;
    return new Promise((resolve) => h.waiting.push(resolve));
  }
  /**
   * The server could not show the agent's own turn (AC3-9): what the session said meanwhile is let go of, logged, and
   * the requests waiting for a turn get none; what it spent there is the chat's next turn's to book (`#keepUnshown`).
   * @param {string} sessionId @param {string} why
   */
  declineOwn(sessionId, why) {
    const conv = this.#chatOf(sessionId);
    if (conv) this.#keepUnshown(conv, this.procs.get(conv.procKey));
    this.#letHeldGo(sessionId, why);
  }
  /** What the session said while no turn read it, let go of and logged, why its own turn was not shown with it. @param {string} sessionId @param {string} why */
  #letHeldGo(sessionId, why) {
    const n = this.#dropHeld(sessionId);
    this.log("info", `[acp] ${String(sessionId).slice(0, 8)}: the agent's own turn was not shown (${why})${n ? `; the ${n} piece(s) its session said meanwhile were let go of` : ""}`);
  }
  /**
   * The agent's own turn ended, or the session it waited for came free (AC3-9): work its session held since — a cycle
   * that came on the turn's heels — asks for the next. Said while a reader still holds the session — the turn's reply
   * cut short, a summary or a compaction there first — it waits for that reader to let go (`#unlisten`): it is said
   * once for each ask.
   * @param {string} sessionId
   */
  ownAgain(sessionId) {
    const h = this.#between.get(sessionId);
    if (!h) return;
    if (this.#listeners.has(sessionId)) return void (h.again = true);
    h.asked = false;
    h.again = false;
    if (h.items.some((p) => p.draws)) this.#askOwn(sessionId, h);
  }
  /**
   * Whether a harness chat's coding agent goes on by itself now, which shows as a turn of its own (AC3-9): a cycle it
   * began between the chat's turns runs, a background task of its ended that no model call has read — its own cycle
   * comes for it —, or work its session said while no turn read it waits for that turn. What else a session says
   * between turns — its state gone idle after the turn's answer, a usage line — asks for no turn: held, it waits for
   * the chat's next, and kept the chat's work stretch going for good once a command outlived the turn (the owner's of
   * 11-05: a chat stood under Working an hour after its last command was stopped). The chat's work stretch goes on
   * meanwhile (sessions/stretch.js). @param {string} chain
   */
  ownComing(chain) {
    for (const [sid, c] of this.#cycles) {
      if ((c.chain || this.#chatOf(sid)?.chain) !== chain) continue;
      if (this.#between.get(sid)?.items.some((p) => p.draws) || c.unread.length || (c.running && !this.#listeners.has(sid))) return true;
    }
    return false;
  }
  /**
   * A sub-agent's turn owes what its agent left running past its answer (the owner's D3 of 11-09): Claude's own
   * background tasks — its Monitor, and its background commands where its session could not be opened without them —
   * end after its prompt was answered, and no harness chat shows the cycle Claude then begins by itself (`#chatOf`):
   * the sub-agent reported "running in the background", and Claude's answer to their end was no one's. The turn waits
   * for them while they run, Claude's answer to each end read into it (`followup`), for `heldMs` at most, as Filament's
   * own background commands hold a sub-agent's run (commands.js COMMANDS_HELD_MS): past it they run on in its session,
   * and the record says so. A task whose status said it ended is waited for until its end comes, which Claude's cycle
   * answers (`unnoticed`, TASK_NOTICE_MS at most). The turn's waits share one bound (`bound`), from its first. The run
   * hears it waits (`waiting`) while the bound is ahead, and whether words still go into the turn (`closed`: not once
   * the words queued at the agent were answered). A stop ends the wait; Claude's process ending fails the turn (`gone`).
   * @param {string} sessionId @param {any} reader  the turn's update reader
   * @param {{ signal?: AbortSignal | null, heldMs: number, bound: { until: number | null }, closed?: boolean, gone: Promise<never>, notes: string[], onEvent: (ev: any) => void }} o
   * @returns {Promise<"answered" | "idle" | "stopped" | null>}  how Claude's last answer went; null where nothing was left running
   */
  async #tasksOwed(sessionId, reader, { signal = null, heldMs, bound: turnBound, closed = false, gone, notes, onEvent }) {
    /** The tasks the turn waits for — running, or owed their end — and when the next owed one stops being owed. */
    const owing = () => {
      const c = this.#cycles.get(sessionId);
      const now = Date.now();
      let until = Infinity;
      const ended = [];
      for (const [id, u] of c?.unnoticed || []) {
        if (now - u.at >= this.#noticeMs) {
          c?.unnoticed.delete(id);
          if (named.has(id)) lapsed = true;
        } else {
          ended.push(u.task);
          until = Math.min(until, u.at + this.#noticeMs);
        }
      }
      return { tasks: [...(c?.tasks.values() || []), ...ended], until };
    };
    /** The tasks waited for, by id → how the record names each. @type {Map<string, string>} */
    const named = new Map();
    /** Whether one waited for said it ended only as its status: no end came for Claude to answer. */
    let lapsed = false;
    if (!owing().tasks.length || signal?.aborted) return null;
    const since = Date.now();
    const bound = (turnBound.until ??= since + heldMs);
    /** @type {"answered" | "idle" | "stopped" | null} */
    let how = null;
    for (let o = owing(); o.tasks.length; o = owing()) {
      const now = o.tasks;
      for (const t of now) named.set(t.id, t.description || t.kind || t.id);
      const one = String(now[0].description || now[0].kind || "a task");
      // Said at every change while the bound is ahead: Claude's answer to an end between shows the sub-agent at work
      // again. Past it the wait ends at once, and words typed meanwhile wait for the next message.
      if (Date.now() < bound)
        onEvent({ type: "waiting", why: now.length === 1 ? `waiting for its own background task “${one.length > 60 ? `${one.slice(0, 59)}…` : one}” to end` : `waiting for its ${now.length} own background tasks to end`, ...(closed ? { closed } : {}) });
      let cancel = () => {};
      /** @type {"moved" | "held" | "stopped"} */
      let moved;
      try {
        moved = await Promise.race([
          /** @type {Promise<"moved" | "held" | "stopped">} */ (
            new Promise((resolve) => {
              const bells = this.#taskBells.get(sessionId) || new Set();
              this.#taskBells.set(sessionId, bells);
              /** @param {"moved" | "held" | "stopped"} x */
              const done = (x) => {
                clearTimeout(timer);
                bells.delete(ring);
                if (!bells.size && this.#taskBells.get(sessionId) === bells) this.#taskBells.delete(sessionId);
                signal?.removeEventListener("abort", stop);
                resolve(x);
              };
              const ring = () => done("moved");
              const stop = () => done("stopped");
              // The hold's bound, or sooner the moment an owed end stops being owed.
              const timer = setTimeout(() => done(Date.now() >= bound ? "held" : "moved"), Math.max(0, Math.min(bound, o.until) - Date.now()));
              timer.unref?.();
              cancel = () => done("stopped");
              bells.add(ring);
              signal?.addEventListener("abort", stop, { once: true });
              if (signal?.aborted) stop();
            })
          ),
          gone,
        ]);
      } finally {
        cancel();
      }
      if (moved === "stopped") return "stopped";
      if (moved === "held") {
        const still = owing().tasks;
        const list = still.map((t) => `“${t.description || t.kind || t.id}”`).join(", ");
        notes.push(`acp: the sub-agent's turn waited ${tookWords(Date.now() - since)} for Claude's own background task${still.length === 1 ? "" : "s"} ${list} and ends without ${still.length === 1 ? "it: it runs on in Claude's session, its end" : "them: they run on in Claude's session, their ends"} no one's to read`);
        return how;
      }
      how = await Promise.race([reader.followup(signal), gone]);
      if (how === "stopped") return how;
    }
    const all = [...named.values()].map((d) => `“${d}”`).join(", ");
    const ends = named.size === 1 ? "its end" : "their ends";
    const after = lapsed
      ? `${named.size === 1 ? "its status said it ended" : "the status of one said it ended"}, but no end came for Claude to answer`
      : how === "idle"
        ? `Claude stayed idle past ${ends} without an answer`
        : `read Claude's answer to ${ends}`;
    notes.push(`acp: Claude left ${named.size === 1 ? "a background task of its own" : `${named.size} background tasks of its own`} running as it answered (${all}): the sub-agent's turn waited ${tookWords(Date.now() - since)} for ${named.size === 1 ? "it" : "them"}, and ${after}`);
    return how;
  }
  /**
   * A reader lets go of the session it read: the word to ask again that came meanwhile is heard now (`ownAgain`).
   * @param {string} sessionId @param {any} reader
   */
  #unlisten(sessionId, reader) {
    if (this.#listeners.get(sessionId) !== reader) return;
    this.#listeners.delete(sessionId);
    if (this.#between.get(sessionId)?.again) this.ownAgain(sessionId);
  }
  /**
   * What a harness chat's session spent in what it held between turns, read as a turn reads what it takes: its cycles'
   * results, the models they ran on, and the cost of their run by the newest figure of the session's (`#ownCost`).
   * Null where it held nothing spent.
   * @param {any} conv @param {any} proc  the process that held the session open
   */
  #heldSpend(conv, proc) {
    const h = this.#between.get(conv.sessionId);
    if (!h?.items.length) return null;
    /** @type {any} */
    const out = { tools: [] };
    const reader = createUpdateReader({ out, conv, turn: { bridgePlan: () => null }, onEvent: () => {}, notes: [] });
    for (const piece of h.items) piece.read(reader);
    const spent = turnUsage([], [...reader.resultsSince(0), ...reader.followups(true)]);
    if (!spent.usage) return null;
    const facts = { sessionId: conv.sessionId, usage: spent.usage, ...(spent.modelUsage ? { modelUsage: spent.modelUsage } : {}), ...(out.context ? { context: out.context } : {}) };
    this.#ownCost(proc, conv.sessionId, facts);
    return facts;
  }
  /**
   * What a harness chat's session spent in what it held between turns, which no turn will show — what it held goes
   * (`#forgetBetween`), or the agent's own turn was not shown (`declineOwn`) — kept for the chat (`#unshown`, added to
   * what it kept before): the agent's own turn that finds the session gone fails with it (`#listenTurn`), and where
   * none comes, the chat's next turn books it (`#bookUnshown`).
   * @param {any} conv @param {any} proc  the process that held the session open
   */
  #keepUnshown(conv, proc) {
    const facts = conv.chain ? this.#heldSpend(conv, proc) : null;
    if (!facts) return;
    const before = this.#unshown.get(conv.chain);
    this.#unshown.set(conv.chain, before ? addSpent(before, facts) : facts);
    this.convs.save();
  }
  /**
   * What a harness chat's session spent between turns that no turn showed (`#unshown`), booked with the chat's next
   * turn, whoever's, which says so: its tokens and the models that counted them join the turn's, and so does its cost.
   * The map is written at once without it, so a restart never books it again.
   * @param {string | null | undefined} chain @param {any} out @param {string[]} notes @param {any} upstream
   */
  #bookUnshown(chain, out, notes, upstream) {
    const u = this.#takeUnshown(chain);
    if (!u) return;
    addSpent(out, u);
    notes.push(`acp: what ${agentTitle(upstream)} spent in a cycle of its own between turns, which no turn showed, is booked with this turn`);
  }
  /**
   * What a harness chat kept of its sessions' spend between turns (`#unshown`), taken for the one booking it gets: the
   * map is written without it at once. Null where it kept none.
   * @param {string | null | undefined} chain
   */
  #takeUnshown(chain) {
    const u = chain ? this.#unshown.get(chain) : null;
    if (!u || !chain) return null;
    this.#unshown.delete(chain);
    this.convs.flush();
    return u;
  }
  /**
   * What a harness chat kept of its sessions' spend between turns (`#unshown`) as the chat goes, and no turn of it
   * will book it: booked on the chat's own record where it has one to book on (`onSpentLeft`) — never where it was
   * deleted, which leaves none — else let go of with a line in the log naming it. Nothing of it is left behind.
   * @param {string} chain @param {string} why  how the chat went @param {{ book?: boolean }} [o]
   */
  #settleLeft(chain, why, { book = true } = {}) {
    const u = this.#takeUnshown(chain);
    if (!u) return;
    let booked = false;
    try {
      booked = book && !!this.onSpentLeft?.({ chain, facts: u, why });
    } catch (/** @type {any} */ e) {
      this.log("warn", `[acp] ${chain}: what its agent spent between turns could not be booked on the chat (${e.message})`);
    }
    if (booked) return void this.log("info", `[acp] ${chain}: what its agent spent between turns, which no turn showed, is booked on the chat as it goes (${why}): ${spentWords(u)}`);
    this.log("info", `[acp] ${chain}: what its agent spent between turns, which no turn showed, goes with the chat (${why}), booked nowhere: ${spentWords(u)}`);
  }
  /**
   * A harness chat deleted (the server's word): its conversations go, each session let go of in the process that holds
   * it, and what the chat kept of their spend between turns goes with them (`#settleLeft`), the chat left with no record
   * to book it on.
   * @param {string} chain
   */
  chatGone(chain) {
    for (const [key, c] of [...this.convs]) if (c.chain === chain) this.forgetConversation(key);
    this.#settleLeft(chain, "its chat was deleted", { book: false });
  }
  /** Let go of what a session held between turns: its waiting requests get no turn. → how many pieces. @param {string} sessionId */
  #dropHeld(sessionId) {
    const h = this.#between.get(sessionId);
    if (!h) return 0;
    this.#between.delete(sessionId);
    for (const w of h.waiting) w(null);
    return h.items.length;
  }
  /**
   * The agent lost the session under a prompt — a turn's, a summary's, its own compaction's, its own turn's — when the
   * failure says so at its start (`SESSION_LOST`): every prompt after it to that session would fail the same, so it is
   * opened again before the next — by a chat's turn (`#establish`), a summary or a compaction (`#openAgain`), never
   * by an attach's probe — and the first to open it again in this process opens it for every chat that holds it there
   * (`#foundAgain`), which goes on in it as it stands; what it held between turns — its tasks — ended with it,
   * and the chat that showed them hears so.
   * @param {any} conv @param {unknown} e
   */
  #lostUnder(conv, e) {
    const why = String(/** @type {any} */ (e)?.message || e);
    if (!SESSION_LOST.test(why)) return;
    const lost = { why: why.replace(/^Internal error:\s*/i, "").slice(0, 160), at: Date.now() };
    // Claude Code's process that ended under it may have written the session's totals as it went: what its transcript
    // saved is not known.
    for (const c of this.convs.values()) if (c.sessionId === conv.sessionId && c.procKey === conv.procKey) Object.assign(c, { lost, saved: null });
    Object.assign(conv, { lost, saved: null });
    this.#forgetBetween(conv.sessionId, { proc: conv.procKey ? this.procs.get(conv.procKey) : null, chat: conv });
  }
  /**
   * A session open again in `procKey`'s process: lost for none of the chats that hold it there, so a chat that shares
   * it goes on in it as it stands, and a way of its own opens nothing first (`closed`).
   * @param {string} sessionId @param {string} procKey
   */
  #foundAgain(sessionId, procKey) {
    for (const c of this.convs.values()) if (c.sessionId === sessionId && c.procKey === procKey) delete c.lost;
  }
  /**
   * A session nobody shows any longer — its process exited, the chat let go of it, lost it, rested, or no chat holds
   * it: its cycles and what it held go, what it spent there kept first for the harness chat that held it (`chat`,
   * `#keepUnshown`), priced by the figures of the process it was open in (`proc`), so the chat's next turn books it.
   * Where the conversation handed over is no harness chat's (a client's that shares the session), it is kept for the
   * one that shows the session's own turns (`#showsOwn`).
   * @param {string} sessionId @param {{ proc?: any, chat?: any }} [o]
   */
  #forgetBetween(sessionId, { proc = null, chat = null } = {}) {
    if (this.#between.has(sessionId)) {
      const shows = chat?.sessionId === sessionId && chat.chain ? chat : this.#showsOwn(sessionId, proc);
      if (shows) this.#keepUnshown(shows, proc);
    }
    this.#dropHeld(sessionId);
    // Its tasks end with it: the chat that showed them hears so.
    const c = this.#cycles.get(sessionId);
    if (c?.tasks.size) {
      c.tasks.clear();
      this.#saidTasks(sessionId, c);
    }
    this.#cycles.delete(sessionId);
  }
  /**
   * The harness chat that shows a session's own turns, as `#chatOf` finds it while its process runs: the first that
   * holds it in `proc`, or in no process now that `proc` is gone. Null where none does.
   * @param {string} sessionId @param {any} proc
   */
  #showsOwn(sessionId, proc) {
    for (const c of this.convs.values()) if (c.sessionId === sessionId && c.chain && (!c.procKey || c.procKey === proc?.key)) return c;
    return null;
  }
  /** Whether a conversation still holds an agent session. @param {string} sessionId */
  #sessionKept(sessionId) {
    for (const c of this.convs.values()) if (c.sessionId === sessionId) return true;
    return false;
  }
  /**
   * A session the chat left behind at a compaction (AC5-1): let go of in its process, with what it held between turns.
   * One Filament made — the fork its agent's own compaction kept for Undo (AC5-5) — is deleted where the agent deletes
   * one, through the chat's process (`proc`).
   * @param {{ procKey?: string | null, sessionId: string, made?: boolean }} c @param {any} proc
   */
  #leave(c, proc) {
    if (c.made) return this.#dropFork(proc, String(proc.key).split("|")[0], c.sessionId, true);
    this.#closeSession(c.procKey ?? null, c.sessionId);
    if (!this.#sessionKept(c.sessionId)) this.#forgetBetween(c.sessionId, { proc: c.procKey ? this.procs.get(c.procKey) : null, chat: c });
  }

  // Run one turn. onEvent receives {type:'text'|'thought'|'tool'|'tool_update'|'plan'|'info', ...}.
  // Turns on the same conversation are serialized: two concurrent prompts would otherwise share one update stream.
  // P7 (§11.1–11.2): the archived version of this conversation, for seeding a NEW agent session.
  //
  // The client's `history` is what it happened to resend — already compacted, and carrying the narration it was shown
  // — while the archive holds the whole cross-model conversation byte-exact, with tool noise dropped and a token
  // budget applied. Returns null whenever there is nothing to seed from (memory off, this chat never archived, or the
  // only archived turn is the one in flight), and the caller then falls back to the request body. Never throws: a
  // memory failure must not stop an agent turn.
  #archivedSeed({ format, body, headers, cwdHint, model }, acp, newestText) {
    if (typeof this.archivedTranscript !== "function") return null;
    try {
      return (
        this.archivedTranscript(
          {
            format,
            body,
            headers: headers || {},
            cwdHint: cwdHint || "",
            model: model || "",
            newestText,
          },
          {
            view: acp.seedView || "chat",
            budgetTokens: Number(acp.seedBudgetTokens) > 0 ? Number(acp.seedBudgetTokens) : 0,
          },
        ) || null
      );
    } catch (e) {
      this.log("warn", `[acp] archived seed unavailable (${e.message.slice(0, 120)})`);
      return null;
    }
  }
  // Resolves with the finished turn, or with { clientAction, turn } when the agent needs the client's hands first
  // (the server then ends the reply with that tool call and continues the turn from the client's next request).
  async run(opts) {
    const acp = opts.upstream.acp || {};
    const flat = flattenMessages(opts.format, opts.body);
    const { cwd } = determineCwd(acp, flat, opts.cwdHint);
    const convKey = conversationKey(opts.upstream.id, cwd, flat, opts.conversationId);
    const turn = new LiveTurn({
      convKey,
      upstreamId: opts.upstream.id,
      clientTools: opts.clientTools || ClientToolset.from(opts.format, opts.body),
      bridge: acp.clientBridge || "prompts",
      onEvent: opts.onEvent || (() => {}),
      log: this.log,
      clientWaitMs: Math.max(1, Number(acp.clientWaitMinutes) || 60) * 60000,
      asker: opts.asker || null,
      permits: opts.permits || null,
      toolsAt: opts.toolsAt || null,
      asks: opts.asks || null,
    });
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const at = { flat, convKey, cwd, turn };
    const mine = prev
      .catch(() => {})
      .then(() => this.#runTurn({ ...opts, onEvent: turn.emit }, at))
      .catch((e) =>
        this.retrySeed(e, opts, turn, {
          session: "session",
          drop: () => {
            const conv = this.convs.get(convKey);
            if (!conv) return;
            this.convs.delete(convKey);
            this.#closeSession(conv.procKey, conv.sessionId);
            this.convs.save();
          },
          again: (o) => this.#runTurn({ ...opts, onEvent: turn.emit, ...o }, "body" in o ? { ...at, flat: flattenMessages(opts.format, o.body) } : at),
        }),
      );
    this.turnQueues.set(convKey, mine);
    return this.trackTurn(turn, mine, () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    });
  }
  /**
   * The agent's own turn (HarnessV3-ACP AC3-9): a cycle it began by itself on a harness chat's session, read as a turn
   * of that chat's conversation — what the session said while no turn read it first, then what it says until the
   * cycle's result. No prompt goes out. Resolves as `run` does.
   * `place`: the cycle's user turn in the chat's history (`#listenTurn`).
   * @param {{ upstream: any, sessionId: string, onEvent?: (ev: any) => void, signal?: AbortSignal | null,
   *   asker?: import("../turn-bridge.js").Asker | null, permits?: any, place?: number | null, asks?: { n: number } | null }} opts
   */
  listen(opts) {
    const entry = [...this.convs.entries()].find(([, c]) => c.sessionId === opts.sessionId && c.upstreamId === opts.upstream.id && c.chain);
    if (!entry) return Promise.reject(Object.assign(new Error(`${agentTitle(opts.upstream)}'s session is no harness chat's now`), { code: "ACP_OWN_GONE" }));
    const [convKey, conv] = entry;
    const acp = opts.upstream.acp || {};
    const turn = new LiveTurn({
      convKey,
      upstreamId: opts.upstream.id,
      bridge: acp.clientBridge || "prompts",
      onEvent: opts.onEvent || (() => {}),
      log: this.log,
      clientWaitMs: Math.max(1, Number(acp.clientWaitMinutes) || 60) * 60000,
      toolsAt: opts.toolsAt || null,
      asker: opts.asker || null,
      permits: opts.permits || null,
      asks: opts.asks || null,
    });
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const mine = prev
      .catch(() => {})
      .then(() => this.#listenTurn({ ...opts, onEvent: turn.emit }, { convKey, conv, turn }));
    this.turnQueues.set(convKey, mine);
    return this.trackTurn(turn, mine, () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    });
  }

  /**
   * Whether the bridge keeps a session for a harness chat (HarnessV4_Tasks C26): the one the chat's next turn goes on
   * in, open in a process or reopened by its id. False where it keeps none — the chat never ran on this agent, its
   * record is gone, or the chat was compacted under it since (`base`) — so that turn opens a new session, seeded from
   * the harness's composition of the chat. One whose prompts were the agent's own commands alone (`heard`) is held: its
   * next prompt goes on in it with its seed (the hunt of 11-08: a switch's first `/review` read as a session lost).
   * @param {import("../../../core/ports.js").AgentChat} where
   */
  holds(where) {
    const conv = this.#goesOn(where);
    return !!conv && (!conv.fresh || !!conv.heard?.length) && moveFor(conv, where.base ?? null).move !== "fresh";
  }
  /**
   * The session a harness chat's next turn could go on in, as the bridge keeps it: none where the chat holds none, or
   * where the model's provider refused its last turn there (`refused`), which the next turn lets go.
   * @param {import("../../../core/ports.js").AgentChat} where
   */
  #goesOn(where) {
    const conv = this.convs.get(this.#chatKey(where));
    return conv && !conv.refused ? conv : null;
  }
  /**
   * How the agent can write Filament's summary of a harness chat (HarnessV3-ACP AC5-4), from the session the chat holds
   * open in an agent process: a fork of it, where the agent forks a session and can open the fork (`session/resume` or
   * `/load`) — the session itself stays as it was, for Undo — else the session itself. Null with no such session:
   * nothing warm to write from.
   * @param {import("../../../core/ports.js").AgentChat} where
   * @returns {"fork" | "session" | null}
   */
  summarizes(where) {
    const conv = this.#goesOn(where);
    const can = conv?.opened ? this.#ownCan(conv) : null;
    if (!conv || !can || moveFor(conv, where.base ?? null).move !== "stay") return null;
    return can.fork && can.reopen ? "fork" : "session";
  }
  /**
   * Whether a way of the agent's own opens the chat's session first (HarnessV4_Tasks C33): no process holds it now —
   * Filament restarted, or its idle agent was let go — or the agent lost it under a prompt (`conv.lost`), and its agent
   * opens a session again (`reopen`: the process holding it says so, else its record). False while a process holds it
   * as it stands, or where there is nothing to open.
   * @param {import("../../../core/ports.js").AgentChat} where
   */
  closed(where) {
    const conv = this.#goesOn(where);
    return !!conv && (!!conv.lost || !this.#liveProc(conv)) && !!this.#ownCan(conv)?.reopen && moveFor(conv, where.base ?? null).move === "stay";
  }
  /** The process that holds the chat's session open now, or null. @param {any} conv */
  #liveProc(conv) {
    const proc = conv?.procKey ? this.procs.get(conv.procKey) : null;
    return proc && !proc.exited ? proc : null;
  }
  /**
   * What the chat's agent can do with its session for a way of its own: as the process holding it says, else — no
   * process — as its record kept it from when it was last open, where the agent opens a session again. Null where
   * neither says.
   * @param {any} conv @returns {{ fork: boolean, reopen: boolean, reportsCompaction: boolean } | null}
   */
  #ownCan(conv) {
    const proc = this.#liveProc(conv);
    if (proc) return sessionCan(proc);
    return conv?.opened?.can?.reopen && !conv.fresh ? conv.opened.can : null;
  }
  /**
   * The chat's session opened again in a process started for it, with what it was last opened with (`opened`), so its
   * agent reads the cache that session wrote: as a turn opens it again (`#establish`), outside one. A stop ends the
   * wait and nothing is opened; a session its agent no longer has fails in the agent's words.
   * @param {any} upstream @param {any} conv @param {AbortSignal | null} signal
   */
  async #openAgain(upstream, conv, signal) {
    const proc = await this.getProcess(upstream, conv.opened.modelId, { full: conv.opened.full === true, own: conv.opened.own === true, signal });
    const from = conv.procKey;
    const lost = !!conv.lost;
    // The model and effort it ran on, set again once it is open: its agent's word as it reopens proves nothing
    // (configure.js `setAgain`), and what follows — `/compact`, Filament's summary — is prompted on it.
    const ranOn = { modelId: conv.modelId, effort: conv.effort };
    // What the record on disk leaves out is given again before the agent reaches it: the upstream's own servers, from
    // the configuration, and a new token for Filament's own.
    givenAgain(conv, configuredMcpServers(upstream.acp || {}));
    // And the person's own headers its settings carried, which the record keeps none of, as their settings read now:
    // Filament's ask after them where its model calls go to Filament's door now — known by Filament's places, else by
    // the address its own server was given the session at.
    if (agentKey(upstream) === "claude-code" && conv.opened.sessionMeta) {
      const own = conv.opened.mcpServers?.find((/** @type {any} */ s) => s?.name === "filament" && typeof s.url === "string")?.url ?? null;
      const says = claudeSessionHeaders({ cwd: conv.cwd, env: agentEnv(agentLaunchEnv(upstream), upstream.acp?.envRemove).env, door: filamentsDoor(this.ownPlaces, own), started: proc.env });
      conv.opened = { ...conv.opened, sessionMeta: withSettingsHeaders(conv.opened.sessionMeta, says.ownHeaders, says.atDoor) };
    }
    // A session lost under a prompt is opened again so, as a turn opens it (`#establish`): closed first where it was
    // lost in this process.
    const { method, res } = await this.#reattach(proc, { sessionId: conv.sessionId, cwd: conv.cwd, mcpServers: conv.opened.mcpServers, ...conv.opened.sessionMeta }, 0, signal);
    delete conv.lost;
    this.#sessionOp(upstream, method, conv.sessionId);
    conv.procKey = proc.key;
    // Its query goes on from what its transcript saved, where it was open in no process here (`#heardRun`).
    Object.assign(conv, { openedAs: "reopened", openedAt: Date.now(), runOf: "", queryFrom: from === proc.key && !lost ? "" : "saved", modelUnproven: true });
    this.#countFromSaved(proc, conv);
    if (from && from !== proc.key) this.#closeSession(from, conv.sessionId);
    const o = readSessionOffer(res || {});
    if (o.models.length || o.modelConfig || o.efforts.length)
      Object.assign(conv, {
        availableModels: o.models,
        modelLabels: o.modelLabels,
        modelConfig: o.modelConfig,
        modelConfigId: o.modelConfigId,
        modelId: o.currentModel ?? conv.modelId,
        paramOptions: o.params,
        effortOptions: o.efforts,
        effortConfigId: o.effortConfigId,
        effort: o.currentEffort ?? conv.effort,
      });
    if (o.modes.length) Object.assign(conv, { availableModes: o.modes, mode: o.currentMode || conv.mode });
    conv.opened = { ...conv.opened, can: sessionCan(proc) };
    if (ranOn.modelId) {
      /** @type {string[]} */
      const notes = [];
      await applySessionSettings({ proc, conv, acp: upstream.acp || {}, modelId: ranOn.modelId, effort: ranOn.effort, mode: conv.mode, modeOverride: null, notes, structured: [], signal });
      for (const n of notes) if (/not applied/.test(n)) this.log("warn", `[acp] ${upstream.id}: session ${String(conv.sessionId).slice(0, 8)} opened again, ${n.replace(/^acp: /, "")}`);
    }
    this.convs.save();
    return proc;
  }
  /** A harness chat's conversation, keyed as `run` keys its turns. @param {{ upstream: any, cwdHint?: string | null, conversationId: string }} where */
  #chatKey({ upstream, cwdHint, conversationId }) {
    return conversationKey(upstream.id, determineCwd(upstream.acp || {}, [], cwdHint).cwd, [], conversationId);
  }
  /**
   * The agent writes Filament's summary of a harness chat (HarnessV3-ACP AC5-4), prompted with `instruction`, after the
   * chat's turns: in a fork of its session (`summarizes`), opened as the session was — its MCP servers and its opening
   * context, so the agent reads its warm cache — on the session's model, then deleted where the agent can delete one;
   * else in the session itself, which goes back to its mode after. Read-only either way: in a mode that changes nothing
   * where the agent has one, whatever it asks refused, nothing written or run for it, and Filament's own tools refusing
   * their calls. No clock ends it (HarnessV3-FailurePoints §4 B): a stop does.
   * @param {{ upstream: any, cwdHint?: string | null, conversationId: string, instruction: string, signal?: AbortSignal | null }} o
   * @returns {Promise<import("../../../core/ports.js").AgentSummary>}
   */
  summarize(o) {
    const convKey = this.#chatKey(o);
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const mine = prev.catch(() => {}).then(() => this.#summarize(o, convKey));
    this.turnQueues.set(convKey, mine);
    const done = () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    };
    mine.then(done, done);
    return mine;
  }
  /**
   * @param {{ upstream: any, instruction: string, signal?: AbortSignal | null }} o
   * @param {string} convKey
   * @returns {Promise<import("../../../core/ports.js").AgentSummary>}
   */
  async #summarize({ upstream, instruction, signal = null }, convKey) {
    const conv = this.convs.get(convKey);
    if (!conv?.opened || !this.#ownCan(conv)) throw new Error(`${agentTitle(upstream)} holds no open session of this chat to write the summary in`);
    const proc = (!conv.lost && this.#liveProc(conv)) || (await this.#openAgain(upstream, conv, signal));
    const acp = upstream.acp || {};
    const can = readProfile(proc.initResult).sessions;
    const fork = can.fork && (can.resume || can.load);
    /** @type {string[]} */
    const notes = [];
    let sid = conv.sessionId;
    /** @type {(() => void) | null} */
    let release = null;
    /** The mode the session goes back to, when the summary moved it. @type {string | null} */
    let back = null;
    const reader = createTextReader();
    const onAbort = () => {
      try {
        proc.notify("session/cancel", { sessionId: sid });
      } catch {}
    };
    // The agent is not let go of while it writes (the bug report's P3).
    const free = this.working(proc, upstream.id);
    conv.writing = true;
    try {
      if (fork) {
        const made = await proc.request("session/fork", { sessionId: conv.sessionId, cwd: conv.cwd, mcpServers: conv.opened.mcpServers, ...dirsOf(conv.opened) }, 0, signal, this.#lateFork(proc, upstream.id));
        sid = String(made?.sessionId || "");
        if (!sid) throw new Error(`${agentTitle(upstream)} forked no session (its session/fork answered without one)`);
        this.#writing.add(sid);
        this.#op(`forked an agent session on ${upstream.id} for Filament's summary (${sid.slice(0, 12)})`, {
          sub: "fork",
          detail: { upstream: upstream.id, method: "session/fork", sessionId: sid, from: conv.sessionId },
          ref: { upstreamId: upstream.id, sessionId: sid },
        });
        const { res } = await this.#reattach(proc, { sessionId: sid, cwd: conv.cwd, mcpServers: conv.opened.mcpServers, ...conv.opened.sessionMeta }, 0, signal);
        const offer = readSessionOffer(res || {});
        const f = { ...resumedConversation({ found: { sessionId: sid }, proc, upstream, acp, cwd: conv.cwd, offer }), paramOptions: offer.params };
        // The session's model and effort, so the fork reads the session's cache, in a mode that changes nothing.
        await applySessionSettings({ proc, conv: f, acp, modelId: conv.modelId, effort: conv.effort, mode: readOnlyMode(f), modeOverride: readOnlyMode(f), notes, structured: [], signal });
      } else {
        // Another chat's turn on the session (each resumed it) ends first; a stop while it waits ends it there,
        // nothing asked: that turn still holds the session (the bug report's X5).
        release = await this.lockSession(sid, signal);
        if (signal?.aborted) throw new Error("stopped before the agent was asked");
        this.#writing.add(sid);
        // Only from a mode the session said it is in: the one it goes back to.
        const mode = readOnlyMode(conv);
        if (mode && conv.mode && mode !== conv.mode) {
          await proc.request("session/set_mode", { sessionId: sid, modeId: mode }, 0, signal);
          notes.push(`acp: mode ${conv.mode} -> ${mode}`);
          back = conv.mode;
          conv.mode = mode;
        }
      }
      if (signal?.aborted) throw new Error("stopped before the agent was asked");
      // A stop cancels the summary's own prompt, never what ran on the session before it: another chat's turn.
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#listeners.set(sid, reader);
      const res = await proc.request("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: instruction }] }, 0);
      if (signal?.aborted || res?.stopReason === "cancelled") throw new Error("stopped while the agent wrote the summary");
      if (reader.apiError()) notes.push(`acp: Claude met an API error while it wrote the summary: ${reader.apiError()}`);
      // What the summary cost is its own, booked with it: the session's next turn counts its own from the figure it left.
      if (!fork && typeof reader.cost() === "number") this.#countFrom(proc, sid, reader.cost());
      return { text: reader.text(), how: fork ? "fork" : "session", usage: turnUsage([res], [], readProfile(proc.initResult, confirmedOf(upstream))).usage };
    } catch (e) {
      // A fork the agent lost is the fork's alone: the session it was forked from lives on.
      if (sid === conv.sessionId) this.#lostUnder(conv, e);
      const met = reader.apiError();
      if (met && e instanceof Error && !e.message.includes(met)) e.message = `${e.message}: ${met}`;
      throw e;
    } finally {
      // After a stop the mode stays the summary's: the session's next turn sets the one it wants.
      if (back && !proc.exited && !signal?.aborted)
        await proc.request("session/set_mode", { sessionId: sid, modeId: back }, 0, signal).then(
          () => {
            notes.push(`acp: mode ${conv.mode} -> ${back}`);
            conv.mode = back;
          },
          (/** @type {any} */ e) => this.log("warn", `[acp] ${String(sid).slice(0, 8)}: the mode is not set back to ${back} after Filament's summary (${e.message})`),
        );
      if (notes.length) this.log("debug", `[acp] ${String(sid).slice(0, 8)} summary: ${notes.join("; ")}`);
      conv.writing = false;
      this.#writing.delete(sid);
      this.#unlisten(sid, reader);
      release?.();
      signal?.removeEventListener("abort", onAbort);
      // An agent let go of meanwhile stops once the fork it wrote in is let go of.
      void (sid !== conv.sessionId ? this.#dropFork(proc, upstream.id, sid) : Promise.resolve()).finally(free);
    }
  }
  /**
   * What takes a fork's answer that a stop no longer waited for (HarnessV4_Tasks B9): the agent forked the session
   * after the stop, and the fork, held by nothing and never opened, is let go of as one made is (`#dropFork`).
   * @param {any} proc @param {string} upstreamId
   * @returns {(made: any) => void}
   */
  #lateFork(proc, upstreamId) {
    return (made) => {
      const id = String(made?.sessionId || "");
      if (id) void this.#dropFork(proc, upstreamId, id, true);
    };
  }
  /**
   * A fork Filament made, let go of: deleted where the agent deletes a session, its transcript with it, else closed — a
   * summary's (AC5-4), opened to write in; one the agent's own compaction kept for Undo (`made`, AC5-5) was never
   * opened, and only a delete lets go of it. Settled once the agent answered, or at once.
   * @param {any} proc @param {string} upstreamId @param {string} sessionId @param {boolean} [made]
   */
  #dropFork(proc, upstreamId, sessionId, made = false) {
    this.#forgetBetween(sessionId);
    const can = readProfile(proc.initResult).sessions;
    const method = can.delete ? "session/delete" : can.close && !made ? "session/close" : null;
    if (!method || proc.exited) return Promise.resolve();
    const what = made ? "the session kept from before its own compaction" : "the fork Filament's summary was written in";
    return proc.request(method, { sessionId }, 15000).then(
      () =>
        this.#op(`${method === "session/delete" ? "deleted" : "closed"} ${what}, on ${upstreamId} (${sessionId.slice(0, 12)})`, {
          sub: method === "session/delete" ? "delete" : "close",
          detail: { upstream: upstreamId, method, sessionId },
          ref: { upstreamId, sessionId },
        }),
      (/** @type {any} */ e) => this.log("debug", `[acp] ${method} ${sessionId.slice(0, 8)} failed: ${e.message}`),
    );
  }

  /**
   * Whether the agent compacts a harness chat's session itself when asked (HarnessV3-ACP AC5-5), from the session the
   * chat holds open in an agent process: where it publishes `/compact` for the session and says how its compaction went
   * (`reportsCompaction`: Claude's adapter). "fork" where it forks a session and can open the fork, which keeps the
   * session from before for Undo; else "session". Null with no such session, one the chat's next turn leaves (`base`),
   * or no compaction of its own.
   * @param {import("../../../core/ports.js").AgentChat} where
   * @returns {"fork" | "session" | null}
   */
  compacts(where) {
    const conv = this.#goesOn(where);
    const can = conv ? this.#ownCan(conv) : null;
    if (!conv || !can || moveFor(conv, where.base ?? null).move !== "stay") return null;
    const offered = (conv.commands || []).some((/** @type {any} */ c) => (typeof c === "string" ? c : c?.name) === "compact");
    if (!can.reportsCompaction || !offered) return null;
    return can.fork && can.reopen ? "fork" : "session";
  }
  /**
   * The agent compacts a harness chat's session itself (HarnessV3-ACP AC5-5), queued after the chat's turns: forked
   * first where it forks one and `fork` asks — the copy, never opened, is the session from before — then its
   * `/compact`, with what to keep, in the session. Once the agent says it compacted, `record` lists it and names the
   * row the session stands on from then on, and the fork stays on the record as the session from before it, for Undo;
   * a failure, a stop or a refusal from `record` deletes the fork. No clock ends it (HarnessV3-FailurePoints §4 B): a
   * stop does.
   * @param {import("../../../core/ports.js").AgentOwnAsk} o
   * @returns {Promise<import("../../../core/ports.js").AgentOwnCompaction>}
   */
  compactOwn(o) {
    const convKey = this.#chatKey(o);
    const prev = this.turnQueues.get(convKey) || Promise.resolve();
    const mine = prev.catch(() => {}).then(() => this.#compactOwn(o, convKey));
    this.turnQueues.set(convKey, mine);
    const done = () => {
      if (this.turnQueues.get(convKey) === mine) this.turnQueues.delete(convKey);
    };
    mine.then(done, done);
    return mine;
  }
  /**
   * @param {import("../../../core/ports.js").AgentOwnAsk} o @param {string} convKey
   * @returns {Promise<import("../../../core/ports.js").AgentOwnCompaction>}
   */
  async #compactOwn({ upstream, keep, fork, record, base = null, signal = null, onEvent = null }, convKey) {
    const conv = this.convs.get(convKey);
    if (!conv || !this.#ownCan(conv)) throw new Error(`${agentTitle(upstream)} holds no open session of this chat to compact`);
    if (moveFor(conv, base).move !== "stay") throw new Error("the chat's next message leaves this session (a compaction was undone, or made since): nothing to compact in it");
    const proc = (!conv.lost && this.#liveProc(conv)) || (await this.#openAgain(upstream, conv, signal));
    // Opened again, it says for itself whether it still has a compaction of its own.
    if (!sessionCan(proc).reportsCompaction) throw new Error(`${agentTitle(upstream)} has no compaction of its own that Filament can ask for now`);
    const can = readProfile(proc.initResult).sessions;
    const sid = conv.sessionId;
    let forkId = "";
    const reader = createTextReader(onEvent || undefined);
    const onAbort = () => {
      try {
        proc.notify("session/cancel", { sessionId: sid });
      } catch {}
    };
    // The agent is not let go of while it compacts (the bug report's P3).
    const free = this.working(proc, upstream.id);
    // Another chat's turn on the session (each resumed it) ends first; a stop while it waits ends it there, nothing
    // forked or asked (the bug report's X5).
    const release = await this.lockSession(sid, signal);
    const started = Date.now();
    try {
      if (signal?.aborted) throw new Error("stopped before the agent was asked");
      if (fork && can.fork && (can.resume || can.load)) {
        const made = await proc.request("session/fork", { sessionId: sid, cwd: conv.cwd, mcpServers: conv.opened?.mcpServers || [], ...dirsOf(conv.opened) }, 0, signal, this.#lateFork(proc, upstream.id));
        forkId = String(made?.sessionId || "");
        if (!forkId) throw new Error(`${agentTitle(upstream)} forked no session (its session/fork answered without one)`);
        this.#op(`forked an agent session on ${upstream.id}: the session from before its own compaction (${forkId.slice(0, 12)})`, {
          sub: "fork",
          detail: { upstream: upstream.id, method: "session/fork", sessionId: forkId, from: sid },
          ref: { upstreamId: upstream.id, sessionId: forkId },
        });
      }
      if (signal?.aborted) throw new Error("stopped before the agent was asked");
      // A stop cancels the /compact, never what ran on the session before it.
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#listeners.set(sid, reader);
      const res = await proc.request("session/prompt", { sessionId: sid, prompt: [{ type: "text", text: keep ? `/compact ${keep}` : "/compact" }] }, 0);
      const said = reader.compaction();
      // A compaction the agent finished stands, even with a stop that came too late for it.
      if (said?.state !== "completed") {
        if (signal?.aborted || res?.stopReason === "cancelled") throw new Error("stopped while the agent compacted");
        if (said?.state === "failed") throw new Error(String(said.error || "its compaction failed"));
        const words = reader.text().trim();
        throw new Error(`its /compact ended without a compaction${words ? `: ${words.slice(0, 200)}` : ""}`);
      }
      // What the compaction cost is its own, booked with it: the session's next turn counts its own from the figure it left.
      if (typeof reader.cost() === "number") this.#countFrom(proc, sid, reader.cost());
      // Its summary is the chat's where its session held the whole chat (`owes`).
      const summary = owes(conv) ? "" : String(said.summary || "").trim();
      /** @type {import("../../../core/ports.js").AgentOwnCompaction} */
      const facts = { tokensBefore: Number(said.tokensBefore) || 0, tokensAfter: Number(said.tokensAfter) || 0, ms: Number(said.ms) || Date.now() - started, usage: turnUsage([res], [], readProfile(proc.initResult, confirmedOf(upstream))).usage, forked: !!forkId, instructed: !!keep, ...(summary ? { summary } : {}) };
      // The session as it stood before, with what it had of Filament's context then.
      const was = forkId ? { ...conv, sessionId: forkId, procKey: null, given: conv.given ? stateOf(conv.given) : conv.given, before: conv.before ?? null, made: true } : null;
      // What Filament said ahead of its prompts may be summarised away, steering too: the next prompt says it again
      // (AC4-1, AC-R4).
      agentCompacted(conv);
      if (facts.tokensAfter) conv.context = { ...(conv.context || {}), used: facts.tokensAfter };
      const id = record(facts);
      if (was) conv.before = was;
      conv.basedOn = id;
      this.convs.save();
      forkId = "";
      return facts;
    } catch (e) {
      this.#lostUnder(conv, e);
      const met = reader.apiError();
      if (met && e instanceof Error && !e.message.includes(met)) e.message = `${e.message}: ${met}`;
      throw e;
    } finally {
      this.#unlisten(sid, reader);
      release();
      signal?.removeEventListener("abort", onAbort);
      // An agent let go of meanwhile stops once the fork it made is let go of.
      void (forkId ? this.#dropFork(proc, upstream.id, forkId, true) : Promise.resolve()).finally(free);
    }
  }

  /**
   * Whether the upstream's agent goes without its own sub-agent tool beside Filament's: Claude's adapter, whose session
   * options carry the tools it blocks (toolset.js `CLAUDE_OWN_AGENTS`), and an agent whose process started with it off
   * (`procOff`, own-agents.js).
   * @param {string | null | undefined} upstreamId @param {boolean | undefined} procOff
   */
  #ownHeld(upstreamId, procOff) {
    return this.profiles.all()[String(upstreamId || "")]?.rawMessages === true || procOff === true;
  }
  /**
   * The MCP toolset (src/http/mcp.js) finds the conversation behind a token here.
   * @param {string | null | undefined} token @returns {import("../../../core/ports.js").McpContext | null}
   */
  contextForMcpToken(token) {
    if (!token) return null;
    // What the server lists at this address, kept by it: a permission request of the session's is Filament's own hand
    // only for one of these (`loopCalls`).
    const listed = (/** @type {string[]} */ names) => void this.ownListed.set(token, new Set(names));
    // A call finds its turn as the session's own requests do (`#turnFor`, the bug report's P1): while the agent's own
    // turn is asked for, the turn that takes the session judges it, not the one before it, ended.
    for (const c of this.convs.values())
      if (c.mcpToken === token)
        return { ...this.#mcpAt(c, token, this.turns.get(c.sessionId) || null), listed, settled: async () => this.#mcpAt(c, token, (await this.#turnFor(c.sessionId)) || null) };
    const p = this.pendingMcp.get(token);
    if (p) return { conv: null, turn: null, cwd: p.cwd, upstream: p.upstream, native: p.native !== false, chain: p.chain, turnId: null, graph: p.graph === true, report: p.report === true, asksLead: p.asksLead || null, team: p.team === true, reads: p.reads === true, launch: p.launch === true, held: p.launch === true && this.#ownHeld(p.upstream?.id, p.ownOff), visuals: p.visuals === true, artifacts: p.artifacts === true, beside: p.beside === true, thread: p.thread === true, flow: p.flow === true, browser: p.browser === true, skills: p.skills === true, leftOut: p.leftOut === true, confined: p.confined === true, by: p.by ?? null, ...(p.space === false ? { space: false } : {}), emit: null, listed };
    return null;
  }
  /**
   * Where Filament's tools stand for a conversation behind an MCP token, `turn` its turn (AC4-2, AC4-5): the session the
   * newest turn ran in, and that turn while it runs; the graph's tool where the session was given it. Only a
   * conversation whose own flag says so is native (`=== true`): anything else would hand the six file tools to every
   * bridge mode — including `off`, whose whole promise is that the chat client is never involved. The pending token is
   * consulted too, because it is set before the session is opened and so covers the window where the agent connects
   * while this turn is still establishing the session.
   * @param {any} c @param {string} token @param {LiveTurn | null} turn
   * @returns {import("../../../core/ports.js").McpContext}
   */
  #mcpAt(c, token, turn) {
    const live = turn && !turn.done ? turn : null;
    return {
      conv: c,
      turn,
      cwd: c.cwd,
      upstream: { id: c.upstreamId, name: c.upstreamId, acp: this.latestAcp.get(c.upstreamId) || {} },
      native: c.mcpNative === true || this.pendingMcp.get(token)?.native === true,
      // The chat, as the turn opening the session names it where Filament holds no turn of the session yet (after a
      // restart): the agent lists its tools as the session opens, and the graph's and the launch's are the chat's.
      chain: turn?.toolsAt?.chain ?? this.pendingMcp.get(token)?.chain ?? null,
      turnId: live?.toolsAt?.turn ?? null,
      graph: c.toolsGraph === true || this.pendingMcp.get(token)?.graph === true,
      report: c.toolsReport === true || this.pendingMcp.get(token)?.report === true,
      asksLead: c.toolsAsksLead || this.pendingMcp.get(token)?.asksLead || null,
      team: c.toolsTeam === true || this.pendingMcp.get(token)?.team === true,
      launch: !!c.toolsLaunch || this.pendingMcp.get(token)?.launch === true,
      // Its agent's own sub-agent tool held back beside Filament's (`#ownHeld`), so the words say so plainly (the owner's
      // prompt pass of 11-08). A chat at rest holds no process: the one its session opens in again starts as it was
      // opened (`#openAgain`), so the words say what that one will hold (the bug hunt of r-map).
      held: (!!c.toolsLaunch || this.pendingMcp.get(token)?.launch === true) && this.#ownHeld(c.upstreamId, (c.procKey ? this.procs.get(c.procKey)?.ownOff : undefined) ?? this.pendingMcp.get(token)?.ownOff ?? (c.opened?.own === true && ownOffAtStart({ id: c.upstreamId, acp: this.latestAcp.get(c.upstreamId) || {} }))),
      reads: c.toolsReads === true || this.pendingMcp.get(token)?.reads === true,
      visuals: c.toolsVisuals === true || this.pendingMcp.get(token)?.visuals === true,
      artifacts: c.toolsArtifacts === true || this.pendingMcp.get(token)?.artifacts === true,
      beside: c.toolsBeside === true || this.pendingMcp.get(token)?.beside === true,
      thread: c.toolsThread === true || this.pendingMcp.get(token)?.thread === true,
      flow: c.toolsFlow === true || this.pendingMcp.get(token)?.flow === true,
      browser: c.toolsBrowser === true || this.pendingMcp.get(token)?.browser === true,
      skills: c.toolsSkills === true || this.pendingMcp.get(token)?.skills === true,
      // The sub-agent, and a card without the Space, as its newest turn says them, or the turn opening the session where
      // none runs yet — not that alone, which the sweep lets go of 30 minutes on, a longer turn's calls left as nobody's
      // (the bug hunt of 11-08).
      by: turn?.toolsAt?.by ?? this.pendingMcp.get(token)?.by ?? null,
      ...(turn?.toolsAt?.space === false || this.pendingMcp.get(token)?.space === false ? { space: false } : {}),
      // A chat Memory settings leave out, as its newest turn says, or the turn opening its session: none of memory's tools.
      leftOut: turn?.toolsAt?.leftOut === true || this.pendingMcp.get(token)?.leftOut === true,
      // A caller that reaches its own project's sessions alone, as its newest turn says, or the turn opening its session;
      // with neither to place the caller (a restart, a turn ended long ago), unsaid: Filament's server keeps memory's
      // tools to the project then.
      ...(turn || this.pendingMcp.has(token) ? { confined: turn?.toolsAt?.confined === true || this.pendingMcp.get(token)?.confined === true } : {}),
      // What the call says once it is done goes to the request it came in under, should the turn end meanwhile (`sayer`).
      emit: live ? live.sayer() : null,
      // A call of Filament's own that acts for the agent — the browser — judged by the chat's switch (AT-D7).
      permit: (/** @type {any[]} */ calls, /** @type {string} */ what) => this.permitCalls(live, { id: c.upstreamId, name: c.upstreamId }, calls, what),
      judgeNow: (/** @type {any[]} */ calls) => this.judgeNow(live, calls),
      modeNow: () => this.modeNow(live),
      // A command's ask on another machine, put to the person on the turn's card (the remote-agents plan's c-tools), and
      // the session's rule that asks first for one.
      askPerson: (/** @type {any} */ form, /** @type {any} */ o) => this.askPerson(live, form, o),
      rulesAsk: (/** @type {any[]} */ calls) => this.rulesAsk(live, calls),
      // The session, or a fork of it, writes Filament's summary (AC5-4): Filament's tools refuse their calls.
      writing: c.writing === true,
      // A harness chat's session: with no turn of it running, Filament's hands do nothing for it (P1).
      chat: !!c.chain,
    };
  }
  /**
   * A terminal of the agent's let go of: a command Filament's hands run for it ends where it still runs; the client's
   * own ends with the client. @param {any} p @param {string} id
   */
  #endTerminal(p, id) {
    const term = p.terminals.get(id);
    p.terminals.delete(id);
    if (term && !term.viaClient) this.hands.kill(term);
  }
  /** Every terminal of the agent's let go of, as it ends. @param {any} p */
  #endTerminals(p) {
    for (const id of [...p.terminals.keys()]) this.#endTerminal(p, id);
  }
  // File and terminal services the agent delegates to its client: through the chat client's own tools when the
  // current turn has them (bridge "full"), otherwise Filament's own hands under the permission policy.
  async #clientService(p, upstream, method, params) {
    // The agent's request is activity, as its words are: Claude owing a background task's answer is not idle (L23).
    this.#listeners.get(this.#rootOf(String(params.sessionId || "")))?.touch();
    if ((method === "fs/write_text_file" || method === "terminal/create") && this.#writing.has(this.#rootOf(String(params.sessionId || ""))))
      throw Object.assign(new Error("Filament writes nothing and runs nothing while the agent writes its summary, which reads only"), { code: -32000 });
    // One a turn judges draws a turn where none reads the session, as a permission's question does (`#toTurn`).
    if (JUDGED_SERVICES.has(method)) this.#toTurn(params.sessionId, (read) => read.touch(), { asks: true });
    const turn = await this.#turnFor(params.sessionId);
    const viaClient = !!(turn && !turn.done && (turn.bridge === "full" || turn.bridge === "native"));
    const note = (s) => {
      if (turn && !turn.done) turn.emit({ type: "note", text: s });
    };
    /**
     * A helper's sparse copy brings in the folder of a file read or written outside its cone before it is read or
     * written (worktree.js `widenFor`, the owner's plan of 11-09 for big repos): the read finds it, the write lands
     * beside its folder's other files. Filament's own hands are permitted first, so a call refused brings nothing in;
     * the client's own tools ask their own way, so the folder comes in before the client is asked, or the file is not
     * there for it. The service answers the agent nothing to say it in: the turn's record says it.
     * @param {unknown} path
     */
    const widen = async (path) => {
      const w = await widenFor(String(path || "")).catch(() => null);
      if (w) note(w.ok ? `acp: Filament brought ${w.added.map((f) => `${f}/`).join(", ")} into the agent's sparse copy for ${w.rel}` : `acp: ${w.rel} lies outside the agent's sparse copy, and ${w.folder}/ could not be brought in (${w.error})`);
    };
    switch (method) {
      case "fs/read_text_file": {
        if (viaClient && turn.clientTools.has("read")) {
          await widen(params.path);
          const text = await this.askClient(turn, {
            kind: "read",
            call: turn.clientTools.buildRead({ path: params.path, line: params.line, limit: params.limit }),
            parse: (t, isErr) => {
              if (isErr)
                throw Object.assign(new Error(t.slice(0, 300) || "the client could not read the file"), {
                  code: -32002,
                });
              return ClientToolset.parseReadResult(t);
            },
          });
          return { content: text };
        }
        // A session writing Filament's summary reads as it needs to: the summary is Filament's own work, which changes
        // nothing — nor does its widen, which checks out committed files alone.
        if (!this.#writing.has(this.#rootOf(String(params.sessionId || ""))))
          await this.permitLocal(turn, upstream, "read", params.path, { chat: this.#inChat(params.sessionId) });
        await widen(params.path);
        return this.hands.readTextFile(params);
      }
      case "fs/write_text_file": {
        if (viaClient && turn.clientTools.has("write")) {
          await widen(params.path);
          await this.askClient(turn, {
            kind: "write",
            call: turn.clientTools.buildWrite({ path: params.path, content: params.content }),
            parse: (t, isErr) => {
              if (isErr)
                throw Object.assign(new Error(t.slice(0, 300) || "the client could not write the file"), {
                  code: -32000,
                });
              return t;
            },
          });
          return null;
        }
        await this.permitLocal(turn, upstream, "edit", params.path, { chat: this.#inChat(params.sessionId) });
        await widen(params.path);
        note(`acp: Filament wrote ${params.path} for the agent`);
        return this.hands.writeTextFile(params);
      }
      case "terminal/create": {
        const id = `term_${randomBytes(4).toString("hex")}`;
        const term = {
          id,
          output: "",
          exit: null,
          truncated: false,
          promise: null,
          child: null,
          viaClient: false,
        };
        if (viaClient && turn.clientTools.has("bash")) {
          term.viaClient = true;
          term.promise = this.askClient(turn, {
            kind: "terminal",
            call: turn.clientTools.buildBash({
              command: params.command,
              args: params.args || [],
              cwd: params.cwd && params.cwd !== turn.conv?.cwd ? params.cwd : null,
              timeoutMs: 600000,
            }),
            parse: (t, isErr) => ClientToolset.parseBashResult(t, isErr),
          }).then(
            (r) => {
              term.output = r.output;
              term.exit = { exitCode: r.exitCode, signal: null };
            },
            (e) => {
              term.output = `Filament: ${e.message}`;
              term.exit = { exitCode: 1, signal: null };
            },
          );
        } else {
          // The person is asked about each argument whole, as the terminal runs it (the bug report's H16).
          const args = Array.isArray(params.args) ? params.args.map(String) : [];
          const line = args.length ? terminalLine(String(params.command), args) : String(params.command);
          await this.permitLocal(turn, upstream, "execute", line, { chat: this.#inChat(params.sessionId) });
          term.promise = this.hands.runTerminal({ ...params, cwd: params.cwd || turn?.conv?.cwd || null }, term);
          note(`acp: Filament ran \`${line.slice(0, 120)}\` for the agent`);
        }
        p.terminals.set(id, term);
        // Past 200, the oldest is let go of: it ends where it still runs, since nothing could read it or stop it (L23).
        if (p.terminals.size > 200) this.#endTerminal(p, p.terminals.keys().next().value);
        return { terminalId: id };
      }
      case "terminal/output": {
        const term = p.terminals.get(params.terminalId);
        if (!term) throw Object.assign(new Error("unknown terminal"), { code: -32602 });
        return {
          output: term.output,
          truncated: !!term.truncated,
          ...(term.exit ? { exitStatus: term.exit } : {}),
        };
      }
      case "terminal/wait_for_exit": {
        const term = p.terminals.get(params.terminalId);
        if (!term) throw Object.assign(new Error("unknown terminal"), { code: -32602 });
        await term.promise;
        return term.exit || { exitCode: null, signal: null };
      }
      case "terminal/kill": {
        const term = p.terminals.get(params.terminalId);
        if (term && !term.viaClient) this.hands.kill(term);
        return {};
      }
      case "terminal/release": {
        this.#endTerminal(p, params.terminalId);
        return {};
      }
    }
    throw Object.assign(new Error(`method not supported by Filament: ${method}`), { code: -32601 });
  }

  // The session this turn runs in: resumed by id or title (`#session`), the conversation's own session loaded into
  // this process (model switch, restart), or a new one — a harness chat's seeded from the harness's composition (AC5-1,
  // AC-R1), an outside client's from the archive or the client's history. Returns the conversation record and what
  // happened, plus the cwd (a resumed session brings its own) and, for a harness chat's fresh session, the compaction
  // its seed stands on (`composed`, 0 before any). A stop while a session it opens waits for another chat's turn on it
  // (`signal`) ends it, thrown. `kept`: the session was opened again with the system prompt it was opened with before.
  async #establish({
    upstream,
    acp,
    proc,
    modelId,
    resumeSessionId,
    mcpServers,
    sessionMeta,
    cwd,
    convKey,
    history,
    last,
    notes,
    onEvent,
    format,
    body,
    headers,
    cwdHint,
    reopen = null,
    keepOpening = false,
    bare = false,
    signal = null,
  }) {
    let conv = this.convs.get(convKey);
    // What the chat's session published as it came in: the commands a session that takes its place is read against
    // until it says its own (`#commandsFor`).
    const commandsWas = Array.isArray(conv?.commands) ? conv.commands : null;
    let reused = false,
      seeded = false,
      resumed = false;
    let archSeed = null; // P7: the archived transcript, when there is one — computed once, at session creation
    // The compaction this agent's session of the chat stands on, as a harness turn names it (AC5-1, HarnessV4_Tasks
    // A8): the chat's newest, or a newer one of Filament's copy alone that moved it; null for anyone else's request.
    const base = compactionOf(headers, upstream.id);
    // Whether THIS turn actually handed the agent its MCP servers. Only opening a session (session/new, /load or
    // /resume) carries `mcpServers`; a plain reuse of a live session passes nothing, so enabling steering
    // mid-conversation cannot retro-offer the toolset. Every claim about what the agent has is keyed on this, not on
    // the current config.
    let offeredNow = false;
    // `claude-code/sonnet#3716601d`: continue a session the agent already has (started in its own terminal, or an
    // earlier Filament conversation). Looked up with session/list, reopened here; the agent keeps the history.
    if (resumeSessionId && !(conv && conv.sessionId.startsWith(resumeSessionId))) {
      try {
        onEvent({ type: "step", step: "resuming" });
        const list = await proc.request("session/list", {}, 0, signal);
        const sessions = Array.isArray(list?.sessions) ? list.sessions : Array.isArray(list) ? list : [];
        const { found, candidates } = findSession(sessions, resumeSessionId);
        if (!found) {
          notes.push(
            `acp: no agent session matches "${resumeSessionId}" (${sessions.length} known${candidates.length > 1 ? `, ${candidates.length} ambiguous title matches` : ""}); starting a new one`,
          );
          onEvent({
            type: "text",
            text: `⚠ No ${upstream.id} session matches "${resumeSessionId}"${candidates.length > 1 ? ` uniquely (${candidates.length} titles match)` : ""} (Home → Agents lists them). Continuing in a new session.\n\n`,
          });
        } else {
          const useCwd = found.cwd || cwd;
          const { method, res } = await this.#reattach(proc, { sessionId: found.sessionId, cwd: useCwd, mcpServers, ...sessionMeta }, 0, signal);
          offeredNow = true;
          this.#sessionOp(upstream, method, found.sessionId);
          const offer = readSessionOffer(res || {});
          conv = { ...resumedConversation({ found, proc, upstream, acp, cwd: useCwd, offer }), basedOn: base ?? 0, openedAs: "reopened", openedAt: Date.now(), queryFrom: "saved" };
          this.#replace(convKey, conv);
          resumed = true;
          reused = true;
          cwd = useCwd;
          notes.push(
            `acp: resumed agent session ${found.sessionId.slice(0, 8)}${found.title ? ` “${String(found.title).slice(0, 60)}”` : ""} in ${useCwd}; its own history is kept`,
          );
        }
      } catch (e) {
        if (signal?.aborted) throw e;
        const why = AcpBridge.explainLoadError(e.message);
        notes.push(`acp: could not resume session "${resumeSessionId}": ${e.message}; continuing without it`);
        onEvent({ type: "text", text: `⚠ Could not attach to session "${resumeSessionId}": ${why}\n\n` });
        conv = this.convs.get(convKey) || null;
      }
    }
    // A session standing on a compaction other than the chat's newest gives way (AC5-1): to the session from before,
    // where an undo brought the chat back to it, else to a fresh one. Once a turn runs on the compacted session, those
    // from before can no longer come back.
    if (conv && !resumed) {
      const step = moveFor(conv, base);
      if (step.move === "back") {
        notes.push(`acp: back to session ${step.to.sessionId.slice(0, 8)}, from before the compaction undone (session ${conv.sessionId.slice(0, 8)} let go)`);
        conv = { ...step.to, procKey: null, made: false };
        this.convs.set(convKey, conv);
      } else if (step.move === "fresh") {
        notes.push(`acp: the chat was compacted since session ${conv.sessionId.slice(0, 8)} started: it is let go, and a fresh session starts from the compaction`);
        this.convs.delete(convKey);
        conv = null;
      } else if (step.gone.length) conv.before = null;
      for (const c of step.gone) this.#leave(c, proc);
    }
    const lost = conv?.lost || null;
    let kept = false;
    if (conv && (conv.procKey !== proc.key || reopen || lost)) {
      // model switched, or Filament restarted: reopen the same session in this agent process, and let go of it in the
      // process it was in (AC0-4). Whether it has the task graph, or whether the agent leads its team, flipped since the
      // session opened (AC4-5, AC6-3), or its chat's compaction line is no longer the one it was opened with
      // (HarnessV4_Tasks A3): reopened in its own process, with what it now takes — `reopen` says which, in words.
      // One the agent lost under the last turn (`lost`: its process ended) is opened again from what it saved, and
      // stays lost until it is (a stop while it waits leaves it so).
      // Its tools as they were (`keepOpening`): its system prompt as it was opened too, so its agent reads the cache
      // that session wrote — what changed of Filament's context since goes ahead of the prompt, as in a session that
      // stayed open (the owner's of 11-07: nothing per message breaks the cache).
      const was = keepOpening ? promptIn(conv.opened?.sessionMeta) : null;
      kept = !!was && (!was.prompt.append || Object.keys(stateOf(conv.given).sys).length > 0);
      const meta = kept && was ? withPrompt(sessionMeta, was.prompt, was.at) : sessionMeta;
      const from = conv.procKey;
      try {
        onEvent({ type: "step", step: "resuming" });
        const { method, res } = await this.#reattach(proc, { sessionId: conv.sessionId, cwd, mcpServers, ...meta }, 0, signal);
        delete conv.lost;
        offeredNow = true;
        this.#sessionOp(upstream, method, conv.sessionId);
        conv.procKey = proc.key;
        // Its query goes on from what its transcript saved, where it was open in no process here; open in this one, from
        // the totals it had, whether its agent kept that query or closed and resumed it (`#heardRun`).
        Object.assign(conv, { openedAs: "reopened", openedAt: Date.now(), runOf: "", queryFrom: from === proc.key && !lost ? "" : "saved", modelUnproven: true });
        this.#countFromSaved(proc, conv);
        if (from !== proc.key) this.#closeSession(from, conv.sessionId);
        const o = readSessionOffer(res || {});
        // A session that reopened on another model than the one kept says so: the model it is on is the agent's word,
        // which the turn's settings set again where the turn asks for another.
        if (o.currentModel && conv.modelId && String(o.currentModel) !== String(conv.modelId) && (o.models.length || o.modelConfig || o.efforts.length))
          notes.push(`acp: the reopened session is on model ${o.currentModel}, not ${conv.modelId} as kept`);
        if (o.models.length || o.modelConfig || o.efforts.length)
          Object.assign(conv, {
            availableModels: o.models,
            modelLabels: o.modelLabels,
            modelConfig: o.modelConfig,
            modelConfigId: o.modelConfigId,
            modelId: o.currentModel ?? conv.modelId,
            paramOptions: o.params,
            effortOptions: o.efforts,
            effortConfigId: o.effortConfigId,
            effort: o.currentEffort ?? conv.effort,
          });
        // Its modes as it reopened, where it names them, whatever it says of its models (the bug report's L26).
        if (o.modes.length) Object.assign(conv, { availableModes: o.modes, mode: o.currentMode || conv.mode });
        notes.push(
          from === proc.key
            ? `acp: session ${conv.sessionId.slice(0, 8)} ${method === "session/resume" ? "resumed" : "loaded"} again: ${[reopen, lost && `${agentTitle(upstream)} had lost it under the last turn (${lost.why})`].filter(Boolean).join("; ")}`
            : `acp: session ${conv.sessionId.slice(0, 8)} ${method === "session/resume" ? "resumed" : "loaded"} into ${proc.key.split("|")[1] || "default"} process`,
        );
        reused = true;
      } catch (e) {
        if (signal?.aborted) throw e;
        this.log("debug", `[acp] reopening session ${conv.sessionId.slice(0, 8)} failed (${e.message}); starting a new session`);
        notes.push(`acp: could not open session ${conv.sessionId.slice(0, 8)} again (${String(e.message).slice(0, 120)}); starting a new one`);
        this.convs.delete(convKey);
        this.#closeSession(from, conv.sessionId);
        conv = null;
        kept = false;
      }
    } else if (conv) reused = true;
    let created = false;
    if (!conv) {
      onEvent({ type: "step", step: "opening" });
      const res = await this.newSession(proc, upstream, "session/new", { cwd, mcpServers, ...sessionMeta }, { signal });
      offeredNow = true;
      const offer = readSessionOffer(res);
      // Fresh until a prompt of the person's goes out in it: a turn stopped before then leaves the next to seed it (the
      // bug report's L21).
      // Its running totals begin from nothing, and its transcript saves none until its agent's process exits on its own.
      conv = { ...newConversation({ res, proc, upstream, acp, cwd, offer, modelId, lastText: last.text }), basedOn: base ?? 0, fresh: true, openedAs: "new", openedAt: Date.now(), usageSaid: {}, saved: { usage: {}, cost: 0 }, queryFrom: "new" };
      this.#countFrom(proc, conv.sessionId, 0);
      this.convs.set(convKey, conv);
      created = true;
      if (mcpServers.length) notes.push(`acp: ${mcpServers.length} MCP server(s) passed to the agent`);
    }
    // What a seed carries of the chat: all of it but what the session heard as typed (the bug report's L20).
    const owed = unheard(history, conv.heard).filter((m) => m.role !== "system");
    if (conv.fresh) {
      // P7 (§11.1–11.2): an outside client's fresh session asks the archive FIRST, and lets it decide whether there is
      // anything to seed at all. A client that compacted down to just the newest message has an empty `history` (it
      // excludes that message), so a body-only check would seed nothing — which is precisely the case the archive
      // exists for: a session swept, or a chat picked up days later. The archive is byte-exact, has the turns other
      // models handled, and drops tool noise. A harness chat's seed is the request's own history instead (AC5-1,
      // AC-R1): the harness composed the whole chat for this model, as its line and any compaction left it, where the
      // archive would send a budget's worth of it.
      archSeed =
        !bare && base == null && acp.seedHistory !== false && acp.seedFromArchive !== false
          ? this.#archivedSeed(
              { format, body, headers, cwdHint, model: body?.model || "" },
              acp,
              last.text || "",
            )
          : null;
      seeded = !bare && acp.seedHistory !== false && (archSeed != null || owed.length > 0);
      if (bare) notes.push("acp: the earlier conversation was too long for the agent (overflow): this new session goes on without it");
    }
    const seed = seeded ? (archSeed ? `, seeded from Filament's archive (${archSeed.turns} turn${archSeed.turns === 1 ? "" : "s"})` : `, seeded with ${owed.length} earlier messages`) : "";
    if (created) notes.push(`acp: new session ${conv.sessionId.slice(0, 8)}${seed}`);
    else if (!resumed) notes.push(`acp: session ${conv.sessionId.slice(0, 8)} reused (turn ${conv.turns + 1})${seed}`);
    return { conv, reused, seeded, resumed, archSeed, offeredNow, kept, cwd, composed: seeded && base != null ? base : null, commandsWas };
  }

  /**
   * Whether an upstream's agent says its commands as a session opens `way` — "new", or "reopened" (resumed or
   * loaded) — as Filament has seen it (HarnessV4_Tasks B6). True once a session opened so said them, which is kept.
   * False while none has, and one of those it holds has answered a prompt and still said none `commandsWaitMs` after
   * its open: read off the sessions as they stand, so commands that come in late count. Undefined until either.
   * @param {{ id: string }} upstream @param {string} way
   * @returns {boolean | undefined}
   */
  #saysCommands(upstream, way) {
    const key = `${upstream.id}\n${way}`;
    const opened = [...this.convs.values()].filter((c) => c.upstreamId === upstream.id && c.openedAs === way);
    if (opened.some((c) => Array.isArray(c.commands))) this.publishes.add(key);
    if (this.publishes.has(key)) return true;
    return opened.some((c) => c.turns > 0 && Date.now() - c.openedAt > this.commandsWaitMs) ? false : undefined;
  }

  /**
   * The agent's commands the person's words are read against (`composePrompt`): the session's own. A session opened
   * just now has said none yet — its agent publishes them a moment after the open — so words that name one
   * (`/autocompact 400k`, the first message after a compaction started the session) would go to it wrapped in its
   * seed, as words. Its word is waited for then, and the turn says so (the step `commands`; HarnessV4_Tasks B6):
   * with no clock where the agent is known to say its commands (`#saysCommands`) — they come — and `commandsWaitMs`
   * at most where Filament has not seen yet; a stop or the agent's end cuts the wait. An agent known to say none is
   * waited on for nothing. Without its word, the commands the chat's session from before published stand in
   * (`was`), else another of the upstream's sessions', the newest used — said in a note either way.
   * @param {{ proc: any, conv: any, upstream: any, words: string | undefined, was: any[] | null, offeredNow: boolean,
   *   signal?: AbortSignal | null, notes: string[], onEvent: (ev: any) => void }} o
   * @returns {Promise<any[] | undefined>}
   */
  async #commandsFor({ proc, conv, upstream, words, was, offeredNow, signal = null, notes, onEvent }) {
    const name = commandNameOf(words);
    if (Array.isArray(conv.commands) || !name || !offeredNow) return conv.commands;
    const says = this.#saysCommands(upstream, conv.openedAs);
    if (says !== false) onEvent({ type: "step", step: "commands" });
    if (says !== false) await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        proc.off("notification", heard);
        proc.off("exit", done);
        signal?.removeEventListener("abort", done);
        resolve(undefined);
      };
      // The process's own listener has kept the commands on the conversation by the time this one hears them.
      const heard = () => Array.isArray(conv.commands) && done();
      const timer = says ? undefined : setTimeout(done, this.commandsWaitMs);
      proc.on("notification", heard);
      proc.on("exit", done);
      signal?.addEventListener("abort", done, { once: true });
      if (signal?.aborted || proc.exited) done();
    });
    if (Array.isArray(conv.commands) || signal?.aborted) return conv.commands;
    const waited = this.commandsWaitMs >= 1000 ? `${Math.round(this.commandsWaitMs / 1000)} s` : `${this.commandsWaitMs} ms`;
    const session = `session ${conv.sessionId.slice(0, 8)}`;
    const why = says === false ? `${agentTitle(upstream)} said no commands in the sessions it opened before` : says ? `${session}'s agent ended before it said its commands` : `${session} published no commands in ${waited}`;
    /** @type {any} */
    let other = null;
    for (const c of this.convs.values())
      if (c !== conv && c.upstreamId === upstream.id && Array.isArray(c.commands) && c.commands.length && (!other || (c.lastUsed || 0) > (other.lastUsed || 0))) other = c;
    const standIn = was?.length ? was : other?.commands;
    if (!standIn) {
      notes.push(`acp: ${why}, so /${name} goes to it as words`);
      return conv.commands;
    }
    notes.push(`acp: ${why}: /${name} is read against the ones ${was?.length ? "the chat's session before it" : `session ${other.sessionId.slice(0, 8)}`} published`);
    return standIn;
  }

  async #runTurn(
    {
      upstream,
      modelId,
      format,
      body,
      cwdHint,
      headers = {},
      onEvent = () => {},
      signal,
      force = null,
      mode: modeOverride = null,
      conversationId = null,
      effort = null,
      resumeSessionId = null,
      mcpBase = null,
      chain = null,
      context = null,
      bare = false,
      tasksHeldMs = 0,
    },
    { flat, convKey, cwd, turn = null },
  ) {
    const acp = upstream.acp || {};
    this.latestAcp.set(upstream.id, acp);
    if (!turn)
      turn = new LiveTurn({
        convKey,
        upstreamId: upstream.id,
        clientTools: ClientToolset.from(format, body),
        bridge: acp.clientBridge || "prompts",
        onEvent,
        log: this.log,
      });
    onEvent = turn.emit;
    const fullBridge = turn.bridge === "full" || turn.bridge === "native";
    const lastIdx = flat.map((m) => m.role).lastIndexOf("user");
    const last = lastIdx >= 0 ? flat[lastIdx] : { role: "user", text: "Continue." };
    const history = flat.slice(0, lastIdx >= 0 ? lastIdx : flat.length);
    const where = determineCwd(acp, flat, cwdHint);
    const notes = [],
      structured = [];
    pushNote(notes, structured, {
      kind: "cwd",
      cwd,
      where: where.where,
      blocked: where.blocked,
      ignored: where.ignored,
    });
    notes.push(
      `acp: conversation ${convKey} (${conversationId ? "client session id" : "fingerprint of the first message"})`,
    );
    const reminders = flat.reduce((n, m) => n + (m.reminders || 0), 0);
    if (reminders)
      notes.push(
        `acp: ${reminders} <system-reminder> block(s) from the client removed (they address the client's own model, not the agent)`,
      );
    // A stop while the agent starts ends the turn there; its start goes on, for the chat's next turn. One handing its
    // agent Filament's agent tool or its team runs where the agent's own sub-agents are off, where only a start can.
    const ownWanted = !!turn.toolsAt?.team || !!turn.toolsAt?.launch;
    const proc = await this.getProcess(upstream, modelId, { full: fullBridge, own: ownWanted, turn, signal }).catch((e) => {
      if (!signal?.aborted) throw e;
      notes.push(`acp: ${e.message}`);
      return null;
    });
    if (!proc) return { tools: [], stopReason: "cancelled", sessionId: null, reused: false, seeded: false, resumed: false, cwd, notes, structured, bridge: turn.bridgeEffective ?? null, steering: false };
    // Said once per agent process, on the first turn that uses it: which inherited variables it was NOT given.
    if (proc.scrubbed?.length && !proc.scrubNoted) {
      proc.scrubNoted = true;
      notes.push(
        `acp: ${proc.scrubbed.length} inherited environment variable(s) withheld from the agent (${proc.scrubbed.join(", ")}): they describe the terminal Filament was started from, not the agent`,
      );
    }
    // And whether its own sub-agent tool is off in it (own-agents.js).
    if (proc.ownOffWords && !proc.ownOffNoted) {
      proc.ownOffNoted = true;
      notes.push(proc.ownOffWords);
    }
    // Memory's tools: never for a call of Filament's own, nor a chat Memory settings leave out (D4 of 11-01). They reach a
    // session as it opens: their coming or going since — the chat left out or taken back in, memory's tools switched —
    // reopens it, as the task graph's does.
    const memoryWanted = !turn.toolsAt?.none && !turn.toolsAt?.leftOut && !!this.agentTools?.memoryOn();
    // The task graph's tool reaches a session as it opens (AC4-5): its coming or going since reopens the session where the
    // agent can, at a new MCP address — Claude's adapter keeps a session's query while its servers stay as they were.
    const graphWanted = !!turn.toolsAt?.graph;
    // A graph task's sub-agent's report (AC6-1): its session is its own, opened for it, so the tool is there from the
    // start.
    const reportWanted = !!turn.toolsAt?.report;
    // A team's worker whose lead reads along asks it with ask_lead (HarnessV3-TaskGraph-v2 TG2-D49), by its id. A
    // follow-up may run where its lead reads along no more, or now does: its session is opened again with its tools.
    const asksLeadWanted = String(turn.toolsAt?.asksLead || "");
    // A team's tools for an agent that leads the session's team (AC6-3), which a switch of the session's engine gives
    // or takes away.
    const teamWanted = !!turn.toolsAt?.team;
    // What the session offers its agent of Filament's sub-agents (HarnessV4_Tasks E12 step 2, E15 step 3), as one word:
    // a plain chat's agent tool, and whom a lead may ask. A changed word is a changed tool, which reaches the agent as
    // any changed tool does — its session opened again.
    const launchWanted = String(turn.toolsAt?.launch || "");
    // A lead that reads along with its workers (HarnessV3-TaskGraph-v2 V2-0b) has the worker and the wait that say so:
    // an agent reads its tool list as its session opens, so a flip of that switch reopens the session too.
    const readsWanted = teamWanted && !!turn.toolsAt?.reads;
    // A harness chat shows the agent's visuals (HarnessV4_Visuals_Plan E16): its session switching them off or on is
    // opened again with its tools.
    const visualsWanted = !!turn.toolsAt?.visuals;
    // So does one making its artifacts (HarnessV4_Artifacts_Plan E18).
    const artifactsWanted = !!turn.toolsAt?.artifacts;
    // And one whose own agent fires teams beside its chat (team_v2_plan §5.5), designs flows beside it (OA3), or starts
    // threads of it (app/threads.js).
    const besideWanted = !!turn.toolsAt?.beside;
    const threadWanted = !!turn.toolsAt?.thread;
    const flowWanted = !!turn.toolsAt?.flow;
    // And one whose agents drive the chat's browser (HarnessV4_AgentTools_Plan AT-D7).
    const browserWanted = !!turn.toolsAt?.browser;
    // And one whose chat offers skills (HarnessV4_Skills_Plan S1-1): which ones is read at each call.
    const skillsWanted = !!turn.toolsAt?.skills;
    // And one whose chat's project has its Space, made and switched on (the owner's of 11-08, h3): a Space made partway
    // through reaches the session at its next message, and one switched off or deleted goes from it the same way.
    const spaceWanted = !!turn.toolsAt?.spaceOn;
    // A session its agent has not ended the last turn in, which a Force stop let go of (`#orLetGo`, HarnessV4_Tasks
    // A5), takes no prompt: one sent now would wait behind that turn, at an agent that did not hear its cancel. The
    // chat lets the session go — closed where its agent closes one — and this turn opens a new one from Filament's copy
    // of the conversation, saying so.
    const can = readProfile(proc.initResult, confirmedOf(upstream));
    const left = this.convs.get(convKey);
    if (left?.unended) {
      this.convs.delete(convKey);
      this.#between.delete(left.sessionId);
      void this.#closeSession(left.procKey, left.sessionId);
      this.convs.save();
      notes.push(`acp: ${agentTitle(upstream)} had not ended the turn that was force-stopped, so its session was let go; this turn starts a new one from Filament's copy of the conversation`);
      onEvent({ type: "text", own: true, text: `_filament: ${agentTitle(upstream)} had not ended the turn you force-stopped, so this turn starts a new ${agentTitle(upstream)} session from Filament's copy of the conversation._\n\n` });
    } else if (left?.refused) {
      // A session whose turn the model's provider refused (`refused`) holds what was refused, and the provider refuses
      // every prompt sent after it there: the chat lets it go, and this turn opens a new one from Filament's copy, which
      // leaves the refused turn out (`modelTurnsOf`). The refusal's own line said so. The session from before a compaction
      // goes with it: an undo has nothing to go back to once the chat's agent starts over.
      this.convs.delete(convKey);
      for (let c = left; c; c = c.before) this.#leave(c, proc);
      this.convs.save();
      notes.push(`acp: ${agentTitle(upstream)} refused the chat's last turn, so its session was let go; this turn starts a new one from Filament's copy of the conversation`);
    } else if (left && left.opened?.fenced !== true && turn.toolsAt?.agentsChat === true && !(left.procKey === proc.key && (can.sessions.resume || can.sessions.load))) {
      // Another machine's agents' chat fenced again (app/acp-turn.js `fenced`: its Full control switched off) on an agent
      // that cannot open its session again: that session holds the person's MCP servers and settings it opened with, so
      // the chat lets it go, and this turn opens a new one, fenced, from Filament's copy of the conversation (the
      // fc-review's). One fenced from the start, or opened again where its agent can, keeps its session.
      this.convs.delete(convKey);
      for (let c = left; c; c = c.before) this.#leave(c, proc);
      this.convs.save();
      notes.push(`acp: this chat of another machine's agents runs fenced again, and ${agentTitle(upstream)} cannot open its session again (session/load or session/resume): the session opened under Full control was let go, and this turn starts a new one from Filament's copy of the conversation`);
    }
    const prior = this.convs.get(convKey);
    // The chat's own MCP servers and added folders as the session holds them (HarnessV4_Overnight_Plan OV-D18): a
    // change of either opens it again, whatever MCP transport the agent takes — folders only where it takes them.
    const mcpKey = chatKeyOf(turn.toolsAt?.mcp);
    const dirsKey = can.sessions.additionalDirectories ? (turn.toolsAt?.dirs || []).join("\n") : "";
    /** Filament's own tools whose switch moved since the session opened, by name. */
    const switched = !prior
      ? []
      : /** @type {[unknown, unknown, string][]} */ ([
          [prior.toolsGraph === true, graphWanted, "the task graph's tool"],
          [prior.toolsMemory === true, memoryWanted, "memory's tools"],
          [prior.toolsTeam === true, teamWanted, "its team's tools"],
          [prior.toolsReads === true, readsWanted, "reading along with its workers"],
          [prior.toolsVisuals === true, visualsWanted, "the visual tools"],
          [prior.toolsArtifacts === true, artifactsWanted, "the artifact tool"],
          [prior.toolsBeside === true, besideWanted, "the team tool"],
          [prior.toolsThread === true, threadWanted, "the thread tool"],
          [prior.toolsFlow === true, flowWanted, "the flow tool"],
          [prior.toolsBrowser === true, browserWanted, "the browser"],
          [prior.toolsSkills === true, skillsWanted, "the skill tool"],
          [prior.toolsSpace === true, spaceWanted, "the project's Space"],
          [String(prior.toolsLaunch || ""), launchWanted, "Filament's agent tool"],
          [String(prior.toolsAsksLead || ""), asksLeadWanted, "ask_lead"],
          // Another machine's agents' chat whose Full control was switched since it opened (app/acp-turn.js `fenced`):
          // the card's servers go and come with it, which the chat's key alone does not say.
          [prior.opened?.fenced === true, turn.toolsAt?.agentsChat === true, "another machine's agents' fence"],
        ])
          .filter(([had, wants]) => had !== wants)
          .map(([, , name]) => name);
    const flipped = switched.length > 0;
    const chatMoved = !!prior && (String(prior.toolsMcp || "") !== mcpKey || String(prior.toolsDirs || "") !== dirsKey);
    const canReopen = !!prior && prior.procKey === proc.key && (can.sessions.resume || can.sessions.load);
    const toolsFlip = flipped && canReopen;
    const chatReopen = chatMoved && canReopen;
    // The chat's compaction line (HarnessV4_Tasks A3), which a harness turn names beside its chat's newest compaction
    // (AC5-1), or a side agent's own, which its run names alone (acp-turn.js). An outside client's request says nothing
    // of the chat: the session keeps the line it has.
    const side = !!headers?.["x-filament-subagent"];
    const line = compactionOf(headers) == null && !(side && lineOf(headers) != null) ? (prior?.line ?? null) : lineOf(headers);
    // The variables its process starts with: what its own settings read from — an added account's folder among them.
    const launchEnv = agentEnv(agentLaunchEnv(upstream), acp.envRemove).env;
    const plan = planToolset({
      acp,
      upstream,
      proc,
      profile: can,
      turn,
      fullBridge,
      cwd,
      mcpBase,
      memoryWanted,
      // Memory works in the chat, its tools switched off or not: Claude Code's own memory goes off all the same.
      memoryWorks: !turn.toolsAt?.none && turn.toolsAt?.memoryWorks === true,
      graphWanted,
      reportWanted,
      asksLeadWanted,
      teamWanted,
      launchWanted: !!launchWanted && !teamWanted,
      readsWanted,
      visualsWanted,
      artifactsWanted,
      besideWanted,
      threadWanted,
      flowWanted,
      browserWanted,
      skillsWanted,
      spaceWanted,
      existingToken: toolsFlip || chatReopen ? null : prior?.mcpToken,
      notes,
      line,
      side,
      modelConfig: !!launchEnv.CLAUDE_MODEL_CONFIG,
      // Filament's co-author line on, as the turn read the switch (app/acp-turn.js): Claude Code's attribution carries it.
      trailer: turn.toolsAt?.trailer === true,
      // The person's own headers the session's settings say for Claude Code, and whether its model calls go to Filament's
      // door from this folder, where Filament's ask to add nothing rides after them — and nowhere else. Read where its
      // process reads them (the review of c04dd3507: an added account's own folder, not the person's).
      ...(agentKey(upstream) === "claude-code" ? claudeSessionHeaders({ cwd, env: launchEnv, door: filamentsDoor(this.ownPlaces, mcpBase), started: proc.env }) : {}),
    });
    // One that cannot be opened again keeps what it opened with until a new session — Filament's own tools as the
    // chat's servers and folders; said once for each change, and again for a change made again. Filament's tools never
    // reach an agent that takes no MCP server over HTTP, so a switch of them moves nothing there.
    const kept = [flipped && plan.mcpOk && `Filament's tools for it (${switched.join(", ")})`, chatMoved && "the chat's own MCP servers or added folders"].filter(Boolean);
    if (prior && kept.length && !canReopen && prior.procKey === proc.key) {
      const told = JSON.stringify([kept, mcpKey, dirsKey]);
      if (prior.keptTold !== told)
        notes.push(`acp: ${kept.join(" and ")} changed, and ${agentTitle(upstream)} cannot open its session again (session/load or session/resume): it keeps what it opened with until a new session`);
      prior.keptTold = told;
    } else if (prior) delete prior.keptTold;
    // A session opened with another window than its chat's line asks now is opened again, where its agent takes a
    // line and can reopen a session: Claude's adapter gives its Claude Code the settings a session is opened with.
    // Two lines that ask the same window (both under the least Claude Code takes) are one to it.
    const was = prior?.line ?? null;
    const sameWindow = (was == null ? null : claudeCompactWindow(was).window) === plan.compactWindow;
    const lineMoved = !!prior && can.compactWindow && prior.procKey === proc.key && (can.sessions.resume || can.sessions.load) && !sameWindow;
    // The options its adapter takes, as the session was last opened and as this turn gives them: a newer Filament's
    // that no switch above moved (the owner's list of 11-08) reach a session opened again outside a turn too, as after a
    // restart its agent's own compaction opens it with what its record kept (`#openAgain`).
    /** @param {any} m */
    const optionsOf = (m) => JSON.stringify(m?._meta?.claudeCode?.options ?? null);
    const optionsMoved = canReopen && !!prior?.opened && optionsOf(prior.opened.sessionMeta) !== optionsOf(plan.sessionMeta);
    const changed = [
      toolsFlip && plan.mcpOk && "the task graph, memory's tools, the team it leads, what Filament's agent tool offers it, or the project's Space, changed the tools it takes",
      chatReopen && "the chat's own MCP servers or added folders changed what it opens with",
    ].filter(Boolean);
    const reopen =
      changed.length > 0
        ? changed.join("; ")
        : !lineMoved
          ? optionsMoved
            ? `what ${agentTitle(upstream)} is opened with changed since this session opened`
            : null
          : plan.line == null
            ? `its chat names no compaction line now (it was ${Number(was).toLocaleString()} tokens), so Claude Code compacts at its own point`
            : was == null
              ? `${side ? "its own compaction line" : "its chat's compaction line"} is ${plan.line.toLocaleString()} tokens`
              : `its compaction line moved from ${was.toLocaleString()} to ${plan.line.toLocaleString()} tokens`;
    const { native, steering, toolsetOffered, wantMcp, mcpServers, mcpToken } = plan;
    // An agent that takes no MCP server cannot lead (AC6-D5): its team's tools would never reach it.
    if (teamWanted && !wantMcp)
      throw Object.assign(new Error(`${upstream.name || upstream.id} cannot lead a team: it takes no MCP server over HTTP (mcpCapabilities.http) and Filament's relay over stdio is missing from its install, so Filament's team tools cannot reach it — lead on another agent, or on a model on the agent loop`), { data: { errorKind: "filament_unfit" } });
    turn.bridgeEffective = plan.bridgeEffective;
    if (plan.pending) this.pendingMcp.set(mcpToken, { ...plan.pending, ...(proc.ownOff === true ? { ownOff: true } : {}) });
    // The context that stands for the session (AC4-1), in Claude's system prompt where its adapter takes it, or
    // Antigravity's through its own channel (the trial of 11-11, signed in): whole at every open — new, loaded, resumed.
    // `snapshot: false`: Claude Code records a conversation's system prompt at its
    // first request and sends that record at every later one, a resume with other words included; Filament's words
    // change with the session (the task graph, the team it leads, the model its sub-agents run on), and a session
    // opened again must read them as they stand (HarnessV4_Tasks E15 step 3, AG-77) — with its tools moved; one opened
    // again with the same tools keeps the words it was opened with, and reads what changed ahead of its prompt
    // (`#establish`'s `kept`), so its cache holds.
    // In the words for an agent whose own sub-agent tool its adapter holds back beside Filament's (toolset.js
    // `CLAUDE_OWN_AGENTS`), as it declared on starting, or its process started without (own-agents.js): the words and
    // the tools say the same from its first turn.
    const ownHeld = can.rawMessages === true || proc.ownOff === true;
    const opening = standingFor(context, givenTools({ graph: wantMcp && graphWanted, launch: wantMcp && !!launchWanted, skills: wantMcp && skillsWanted }), ownHeld);
    // What the session opens with besides its folder and its servers: Filament's `_meta`, and the folders it may read
    // (`additionalDirectories`, OV-D23), which every open carries whole — a load or resume without them has none.
    const sessionMeta = {
      // Antigravity's own channel takes no `snapshot`: an append a session opens again with replaces the one it kept.
      ...(can.systemPrompt
        ? withPrompt(plan.sessionMeta, { ...(opening.length ? { append: standingText(opening) } : {}), ...(can.systemPromptAt === "antigravity" ? {} : { snapshot: false }) }, can.systemPromptAt)
        : plan.sessionMeta),
      ...(plan.dirs.length ? { additionalDirectories: plan.dirs } : {}),
    };
    const mode = modeOverride || acp.mode || "agent";

    const established = await this.#establish({
      upstream,
      acp,
      proc,
      modelId,
      resumeSessionId,
      mcpServers,
      sessionMeta,
      cwd,
      convKey,
      history,
      last,
      notes,
      onEvent,
      format,
      body,
      headers,
      cwdHint,
      reopen,
      keepOpening: !flipped && !chatMoved,
      bare,
      signal,
    }).catch((e) => {
      // A stop while the session waited for another chat's turn on it (the bug report's H9), or as it opened: the turn
      // ends there.
      if (!signal?.aborted) throw e;
      notes.push(`acp: ${e.message}`);
      return null;
    });
    if (!established)
      return { tools: [], stopReason: "cancelled", sessionId: prior?.sessionId ?? null, reused: false, seeded: false, resumed: false, cwd, notes, structured, bridge: turn.bridgeEffective ?? null, steering: false };
    let { conv, reused, seeded, resumed, archSeed, offeredNow, kept: keptPrompt, cwd: cwdNow, composed, commandsWas } = established;
    cwd = cwdNow;
    turn.sessionId = conv.sessionId;
    turn.conv = conv;
    // A process let go of while the session opened (`letGo`) holds it for this turn only: the chat opens it in the
    // next one, as a chat whose turn runs when its process is let go of does (the bug report's H11).
    if (proc.retire) conv.procKey = null;
    turn.notes = notes;
    turn.structured = structured;
    // The harness chat the turn runs in, and the model it names: the agent's own turns show there (AC3-9).
    if (chain) {
      conv.chain = chain;
      conv.chainModel = body.model;
    }
    // A harness chat's, whose turns name its compaction: its record outlives idleness (`idleStep`).
    if (compactionOf(headers) != null) conv.harness = true;
    // What the session was opened with, while its process holds it: the fork Filament's summary is written in opens
    // with the same (AC5-4).
    // `chat`: which of its servers are the chat's own, which its record on disk leaves out (OV-D18). `fenced`: another
    // machine's agents' chat's, opened again with none of its upstream's servers (`givenAgain`).
    const chatNames = (turn.toolsAt?.mcp || []).map((m) => m.name).filter((n) => mcpServers.some((/** @type {any} */ s) => s.name === n));
    // One opened again with its system prompt as it was (`keptPrompt`) keeps that.
    const keptAt = keptPrompt ? promptIn(conv.opened.sessionMeta) : null;
    const openedMeta = keptAt ? withPrompt(sessionMeta, keptAt.prompt, keptAt.at) : sessionMeta;
    if (offeredNow) conv.opened = { mcpServers, sessionMeta: openedMeta, modelId: modelId ?? null, full: fullBridge === true, ...(ownWanted ? { own: true } : {}), can: sessionCan(proc), ...(chatNames.length ? { chat: chatNames } : {}), ...(turn.toolsAt?.agentsChat === true ? { fenced: true } : {}) };
    // The line the session stands on (HarnessV4_Tasks A3): the one it was opened with, said then, or a later one that
    // asks the same window. A session that could not be opened again keeps the line it has.
    if (offeredNow && plan.lineWords) notes.push(plan.lineWords);
    if (offeredNow || sameWindow) conv.line = plan.line;
    noteToolset({ plan, conv, turn, offeredNow, memoryWanted, pendingMcp: this.pendingMcp, notes });

    // What the session has of Filament's context (AC4-1): an open just now gave it the graph's tool or not, and Claude's
    // system prompt the standing context whole. What changed since goes ahead of the prompt, and the session has it
    // once the prompt is taken.
    conv.given = stateOf(conv.given);
    if (offeredNow) {
      conv.toolsGraph = wantMcp && graphWanted;
      conv.toolsMemory = wantMcp && memoryWanted;
      conv.toolsReport = wantMcp && reportWanted;
      conv.toolsAsksLead = wantMcp ? asksLeadWanted : "";
      conv.toolsTeam = wantMcp && teamWanted;
      conv.toolsLaunch = wantMcp ? launchWanted : "";
      conv.toolsReads = wantMcp && readsWanted;
      conv.toolsVisuals = wantMcp && visualsWanted;
      conv.toolsArtifacts = wantMcp && artifactsWanted;
      conv.toolsBeside = wantMcp && besideWanted;
      conv.toolsThread = wantMcp && threadWanted;
      conv.toolsFlow = wantMcp && flowWanted;
      conv.toolsBrowser = wantMcp && browserWanted;
      conv.toolsSkills = wantMcp && skillsWanted;
      conv.toolsSpace = wantMcp && spaceWanted;
      conv.toolsMcp = mcpKey;
      conv.toolsDirs = dirsKey;
      if (can.systemPrompt && !keptPrompt) openedWith(conv.given, opening);
    }
    const has = givenTools({ graph: conv.toolsGraph === true, launch: !!conv.toolsLaunch, team: conv.toolsTeam === true, skills: conv.toolsSkills === true });
    const standing = standingFor(context, has, ownHeld);
    const recall = promptFor(context, has, seeded);
    const update = context ? contextUpdate(conv.given, standing) : null;
    const commands = await this.#commandsFor({ proc, conv, upstream, words: last.text, was: commandsWas, offeredNow, signal, notes, onEvent });
    let { promptText, userTurns, command, steered, skipped, held: heldIds } = composePrompt({
      acp,
      flat,
      history,
      last,
      conv,
      reused,
      resumed,
      seeded,
      archSeed,
      notes,
      composed,
      context: context ? { update, prompt: recall } : null,
      commands,
      tried: earlierTriesOf(headers),
      seen: seenOf(headers),
      // A harness chat's history whole, for its seed and its catch-up (HarnessV4_Tasks A7).
      whole: compactionOf(headers) != null ? () => flattenMessages(format, body, { whole: true }).slice(0, history.length) : null,
    });
    // The agent's own command leaves the seed for the next prompt, with the rest the session is owed (the bug report's
    // L20).
    if (command) seeded = false;
    const given = givenRecord({ opened: offeredNow && can.systemPrompt && !keptPrompt ? opening : null, update: command ? null : update, recall: command ? [] : recall.filter((b) => !heldIds.includes(b.id)), held: command ? [] : heldIds });
    if (given && givenSays(given)) notes.push(givenNote("acp", given, can.systemPromptAt === "antigravity" ? "Antigravity's system prompt" : "Claude's system prompt"));

    // `bridge` is the mode actually in force for this turn, not the configured one — see `turn.bridgeEffective`.
    // `opensEnvelopes`: Filament's envelope tool reached the session (HarnessV4_Envelopes_Plan EN3) — without it another
    // agent's result comes whole (EN-D10). `ownTools`: the session holds Filament's MCP server at all, recall's tool among
    // its own, so the words after its compaction name recall's list only there (the owner's of 11-08).
    const out = {
      tools: [],
      stopReason: null,
      sessionId: conv.sessionId,
      reused,
      seeded,
      resumed,
      cwd,
      notes,
      structured,
      bridge: turn.bridgeEffective ?? null,
      steering: !!conv.steering,
      opensEnvelopes: has(ENVELOPES_TOOL),
      ownTools: !!conv.mcpToken,
      ...(given ? { given } : {}),
      ...pointOf(conv),
    };
    // Listeners are keyed by the session, and two chats can share one (each resumed it): the turn takes the session
    // once the one running on it has ended. The agent's requests on it, its cancel and its settings are this turn's
    // from then, never before (the bug report's H9 and L22); a stop while it waits ends it there.
    const releaseSession = await this.lockSession(conv.sessionId, signal);
    if (signal?.aborted) {
      releaseSession();
      out.stopReason = "cancelled";
      return out;
    }
    // From here on the agent may ask for the client's hands.
    this.takeSession(conv.sessionId, turn, onEvent);
    /** The agent is told to cancel the session's turn. */
    const cancel = () => {
      try {
        proc.notify("session/cancel", { sessionId: conv.sessionId });
      } catch {}
    };
    /** The agent has ended the turn: a stop still reading the system's table has nothing left to cancel. */
    let ended = false;
    /**
     * The stop, and what the turn's commands had started when it came (`#startedAtStop`): what the agent's own shell
     * still runs of them once its cancel is answered is ended, or said (`#leftRunning`, HarnessV4_Tasks B13).
     * @type {{ seen: Promise<{ was: import("../left-running.js").Proc[] | null, alone: boolean } | null> } | null}
     */
    let stopped = null;
    /**
     * The turn's stop, however it comes: the request's signal, or the turn's own cancel (a hang-up of the request that
     * resumed it, a message that takes its place). The agent hears its cancel once the system's table is read: an
     * agent may end the shell it ran a command in and leave what the shell ran, which is nobody's child from then —
     * at once where no command of its own shell runs.
     */
    const onAbort = () => {
      stopped ||= { seen: this.#startedAtStop(proc, turn, out.tools) };
      return stopped.seen.then(() => void (ended || cancel()));
    };
    turn.cancel = onAbort;
    const profile = readProfile(proc.initResult, confirmedOf(upstream));
    // The person's words queued at the agent while it works (HarnessV3-FailurePoints §7.2), where it declares prompt
    // queueing and Filament reads its raw messages, whose echo of the words says it took them.
    // A prompt the adapter failed over calls left unanswered, though the agent had ended its turn, is answered as
    // ended (`open-end.js`, HarnessV4_Tasks B15).
    const openEnd = createOpenEnd({ notes, who: agentTitle(upstream) });
    /** One prompt of the turn's to its session: its answer, or a Force stop's end of the wait (`#orLetGo`). @param {any[]} prompt */
    /**
     * How many of the turn's own cycles' results had come as each answer came, by the answer: read as the answer is,
     * before what the agent said after it, in the same read, reaches the reader.
     * @type {WeakMap<object, number>}
     */
    const heardBy = new WeakMap();
    const prompted = (prompt) =>
      this.#orLetGo(
        proc
          .request("session/prompt", { sessionId: conv.sessionId, prompt }, 0, null, null, (a) => {
            if (a && typeof a === "object") heardBy.set(a, reader.resultsHeard());
          })
          .catch(openEnd.answer),
        force,
        conv,
        upstream,
      );
    const queued = queuesWords(profile) ? createQueued((text, images) => prompted(steerPrompt(text, images))) : null;
    /** Settles once: whether the turn's prompt went out (true), or the turn ended before it did (false). */
    let promptWent = /** @type {(out: boolean) => void} */ (() => {});
    const promptOut = new Promise((r) => (promptWent = r));
    /**
     * The person's words into the turn, and the pictures they carry, sent once its prompt is out; refused (not taken)
     * where it never went. `by`: whose they are, for the next step's prompt (next-step.js).
     * @template {(text: string, images?: import("./prompt.js").SteerImage[], by?: "person" | "filament") => Promise<any>} F @param {F} send @returns {F}
     */
    const afterPrompt = (send) =>
      /** @type {F} */ (async (/** @type {string} */ text, /** @type {import("./prompt.js").SteerImage[]} */ images = [], /** @type {"person" | "filament" | undefined} */ by = undefined) => ((await promptOut) ? send(text, images, by) : false));
    // The person's words at the agent's next step (AC-D6), where it takes none into its running turn but keeps what a
    // turn it cancels did: once a call ends with none still running, the turn is cancelled there and goes on with them.
    const next =
      !profile.steering && profile.cancelKeepsWork
        ? createNextStep({
            cancel,
            running: () => out.tools.some((t) => t.status !== "completed" && t.status !== "failed"),
          })
        : null;
    const toReply = next ? next.watch(onEvent) : onEvent;
    let answered = false;
    /** @param {any} ev */
    const heard = (ev) => {
      if (ev?.type === "text" || ev?.type === "thought" || ev?.type === "tool") answered = true;
      openEnd.heard(ev);
      // Words queued at the agent that its echo says it took: said before the echo goes on, so the run reads them
      // where it took them.
      const took = ev?.type === "raw" ? queued?.heard(ev.message) : null;
      if (took) toReply({ type: "taken", ...took });
      return toReply(ev);
    };
    const reader = createUpdateReader({ out, conv, turn, onEvent: heard, notes, keepRaw: rawKept(acp), carried: (m) => !!queued?.carries(m), waitsOn: () => this.#asking.has(conv.sessionId) });
    this.#listeners.set(conv.sessionId, reader);
    /** The answers of the turn's prompts, as they come. @type {any[]} */
    const results = [];
    /** How many of the turn's cycle results had come by the newest answer `results` holds: those after it no answer reports. */
    let resultsAt = 0;
    /**
     * How many of those came with what the session held, read first (`#takeHeld`): cycles the agent began by itself,
     * which no answer reports, their results every call's.
     */
    let heldAt = 0;
    /** How many results had come as `a` came (`heardBy`), else by now. @param {any} a */
    const heardAt = (a) => (a && typeof a === "object" && heardBy.has(a) ? /** @type {number} */ (heardBy.get(a)) : reader.resultsHeard());
    /** The answers of the words queued at the agent are among `results`: what the cycles that took them in spent with them. */
    let queuedIn = false;
    signal?.addEventListener("abort", onAbort, { once: true });
    const onUnhandled = (method) => {
      notes.push(`acp: agent requested unsupported method ${method} (answered "not supported")`);
      onEvent({ type: "unhandled", method });
    };
    proc.on("unhandled", onUnhandled);
    const att = extractAttachments(
      format,
      body,
      proc.initResult?.agentCapabilities?.promptCapabilities || {},
    );
    appendNotes(notes, structured, att);
    if (att.inlineText) promptText += att.inlineText;
    // The plan's usage, read while the turn runs (HarnessV4_Tasks A4).
    const usageOver = this.#usageWhile(upstream);
    try {
      // A stop that ended a switch's wait ends the turn below, as a stop while the session was readied does.
      await applySessionSettings({ proc, conv, acp, modelId, typed: upstream.models || [], keyed: this.#keyedOf(upstream.id).names, effort, mode, modeOverride, asks: !!turn.permits, notes, structured, signal, step: (s) => onEvent({ type: "step", ...s }), facts: out }).catch((e) => {
        if (!signal?.aborted) throw e;
      });
      // The model the session is on as the agent says it, before any reply: what its answer to the set named, or the
      // one its last turn was answered by.
      out.agentModel = answeringModel(null, out, conv);
      // A stop or a hang-up while the session was being readied: the prompt never goes out (an agent forgets a cancel
      // that comes before its prompt).
      if (signal?.aborted) {
        out.stopReason = "cancelled";
        return out;
      }
      // The turn's run starts here (HarnessV3-ACP AC1-1): the session is up, a stop reaches it, and nothing the agent
      // says of this prompt has come yet. Its facts go with it, as they stand: a turn that fails keeps them (AC2-5).
      turn.rawMessages = profile.rawMessages;
      // The person's words into the running turn: queued at the agent (`queued`), as Claude Code takes what is typed
      // while it works — at its next step, or as its next prompt when the turn ends first (HarnessV3-FailurePoints
      // §7.2). Where the agent declares live steering (Claude's adapter) the words can interrupt it instead (FP-D8),
      // and where it declares no queueing that is how they go (AC3-1): a turn that has just ended hands them back
      // (`promptRequired`) instead of starting one of its own, which Filament would never see, and they go as the next
      // message. Else at its next step, where it keeps a cancelled turn. What it takes, the session has (`countTaken`):
      // the next prompt counts it as seen where the chat's history holds it, so it is never handed back as missed.
      // The agent's own command is held for the turn's end (`ownCommands`, the session's word, with or without a way in).
      // The words go after the turn's prompt (`afterPrompt`): the way in is handed over as the session opens, and the
      // prompt waits for the folder's snapshot — words sent first would reach the agent ahead of it, Claude running them
      // as its first prompt. A turn that ends before its prompt went out hands them back: they go as the next message.
      // Pictures go with the words where the agent declares image prompts (HarnessV4_Tasks C22): in the same prompt,
      // queued or interrupting. At its next step they never go — those words wait in Filament, as text.
      const interrupt = profile.steering
        ? // No clock, and a stop does not end the wait: the words went, and whether the agent took them is its answer
          // (HarnessV3-FailurePoints §4 B).
          countTaken(conv, userTurns, afterPrompt(async (text, images = []) => {
            const r = await proc.request("_session/steering", { sessionId: conv.sessionId, prompt: steerPrompt(text, images), _meta: { steering: { idleBehavior: "promptRequired" } } });
            return r?.outcome === "injected";
          }))
        : null;
      const pictures = proc.initResult?.agentCapabilities?.promptCapabilities?.image === true ? { images: true } : {};
      /** @type {import("../turn-bridge.js").Steer | null} */
      const steer = queued
        ? { at: "queued", send: countTaken(conv, userTurns, afterPrompt(queued.send)), ...(interrupt ? { interrupt } : {}), ...pictures }
        : interrupt
          ? { at: "live", send: interrupt, ...pictures }
          : next
            ? { at: "next", send: countTaken(conv, userTurns, afterPrompt((text, _images, by) => next.send(text, by))) }
            : null;
      // Who the agent runs as and its plan's windows, as they stand now and again at the end (AC3-6).
      out.account = this.#accountRecord(upstream.id);
      // The reader notes where the working tree stands before the agent hears the prompt; a stop meanwhile ends here.
      await onEvent({ type: "session", sessionId: conv.sessionId, cwd, rawMessages: turn.rawMessages, facts: out, steer, ownCommands: ownCommands(conv) });
      if (signal?.aborted) {
        out.stopReason = "cancelled";
        return out;
      }
      // What the session said while no turn read it comes first: a cycle the agent began by itself (AC3-9).
      this.#takeHeld(conv.sessionId, reader, turn);
      heldAt = resultsAt = reader.resultsHeard();
      // A prompt's whole answer: the prompt's, then Claude's answer to a background task that ended while it ran. A
      // stop that cuts that answer stops the turn.
      // The answer's wait has no clock: Claude's process ending ends it, as it fails the prompt.
      /** When the turn's wait for Claude's own tasks ends, from its first: one bound, whichever answer waits. */
      const tasksBound = { until: /** @type {number | null} */ (null) };
      /** @param {any} r  the prompt's answer @param {{ closed?: boolean }} [o]  `closed`: no words go into the turn now */
      const andFollowup = async (r, { closed = false } = {}) => {
        reader.flush();
        const exit = proc.ending("the turn");
        let how;
        try {
          how = await Promise.race([reader.followup(signal), exit.gone]);
          // A sub-agent's turn (`tasksHeldMs`) owes what Claude left running past its answer: no chat shows a cycle of its
          // own (`#tasksOwed`).
          if (how !== "stopped" && tasksHeldMs > 0) how = (await this.#tasksOwed(conv.sessionId, reader, { signal, heldMs: tasksHeldMs, bound: tasksBound, closed, gone: exit.gone, notes, onEvent })) ?? how;
        } finally {
          exit.unhook();
        }
        if (how === "stopped") {
          const stopped = { ...r, stopReason: "cancelled" };
          if (heardBy.has(r)) heardBy.set(stopped, /** @type {number} */ (heardBy.get(r)));
          return stopped;
        }
        if (how === "idle")
          notes.push(`acp: Claude went idle without answering a background task that ended during the turn; the turn ended without its answer${chain && this.onOwnCycle ? ", which comes as a turn of its own when Claude gives it" : ""}`);
        return r;
      };
      /** @param {any[]} prompt */
      const ask = (prompt) => prompted(prompt).then(andFollowup);
      // The session has what the prompt carries once it goes out: a turn stopped before this told it nothing, and the
      // next tells it again (the bug report's L21).
      told(conv, { userTurns, command, skipped });
      const first = ask([{ type: "text", text: promptText }, ...att.blocks]);
      promptWent(true);
      // The prompt is out: the turn says so until the agent's first word (HarnessV3-FailurePoints §5.1 item 2).
      onEvent({ type: "step", step: "sent" });
      const answer = await first;
      results.push(answer);
      resultsAt = heardAt(answer);
      // A turn cancelled at its next step for the words waiting goes on with them, as its next prompt (AC-D6): each one
      // sent by then, in its order, under whose it is.
      while (next && results.at(-1)?.stopReason === "cancelled" && !signal?.aborted) {
        const words = next.take();
        if (words == null) break;
        const carried = await ask([{ type: "text", text: nextStepPrompt(words) }]);
        results.push(carried);
        resultsAt = heardAt(carried);
      }
      // The person's words queued at the agent meanwhile: the turn reads on until each is answered, those it took in
      // its work or after it (HarnessV3-FailurePoints §7.2), and words sent later go as the next message. Words it never
      // took may have failed for a session it lost after the turn's own prompt was answered.
      const taken = queued ? await queued.drained((e) => this.#lostUnder(conv, e)) : [];
      if (taken.length) results.push(...taken.slice(0, -1).map((t) => t.answer), await andFollowup(taken.at(-1)?.answer, { closed: true }));
      queuedIn = true;
      if (taken.length) resultsAt = heardAt(results.at(-1));
      const res = results.at(-1);
      out.stopReason = res?.stopReason || "end_turn";
      // A plan sent back ends Claude's turn with its adapter's cancel (AC3-3): the turn did as the person said.
      if (out.stopReason === "cancelled" && turn.planBack) out.planBack = true;
      // Refused by the model's provider: the session holds what was refused, and the chat's next turn lets it go.
      if (out.stopReason === "refusal") conv.refused = true;
      // An API error Claude met while the turn still ended well (its answer to a background task failed): its words,
      // kept off the reply, are the turn's note.
      const met = reader.apiError();
      if (met) notes.push(`acp: Claude met an API error during this turn: ${met}`);
      // What the prompts' answers report, what Claude's answers to background tasks spent, which none does, the cycles
      // it began by itself that the turn took from what the session held, by their results, and the calls an answer
      // left out of its rows, where it listed a resumed query's first cycle as its main loop's alone.
      const { usage, modelUsage } = turnUsage(results, [...reader.followups(), ...reader.resultsSince(0).slice(0, heldAt), ...reader.unlisted(undefined, heldAt)], profile);
      if (usage) out.usage = usage;
      if (modelUsage) out.modelUsage = modelUsage;
      out.agentModel = answeringModel(reader, out, conv);
      this.#ownCost(proc, conv.sessionId, out);
      this.#bookUnshown(chain, out, notes, upstream);
      if (out.context) conv.context = out.context; // last known context fill, shown by the /compact chat command
      if (out.title) conv.title = out.title;
      // What the prompt said is the session's — unless the agent compacted after it, and its summary may have dropped
      // it (AC-R4).
      if (update && !command) said(conv.given, standing, update, reader.compacted());
      if (steered && !reader.compacted()) conv.steerSaid = true;
      conv.turns++;
      this.#used(conv);
      return out;
    } catch (e) {
      this.#used(conv);
      this.#lostUnder(conv, e);
      // What the agent reported the turn spent before it failed: what the prompts it answered spent, the cycles of
      // Claude's whose results came after the newest answer — the failed prompt's own, which its error never carries —
      // and Claude's answers to background tasks, those that took in queued words too while those words' answers are
      // not among the prompts' — the cycles it took from what the session held, and the calls an answer left out of its
      // rows (`unlisted`, of the cycles it answered).
      const spent = turnUsage(results, [...reader.resultsSince(0).slice(0, heldAt), ...reader.resultsSince(resultsAt), ...reader.followups(!queuedIn), ...reader.unlisted(resultsAt, heldAt)], profile);
      if (spent.usage) out.usage = spent.usage;
      if (spent.modelUsage) out.modelUsage = spent.modelUsage;
      out.agentModel = answeringModel(reader, out, conv);
      this.#ownCost(proc, conv.sessionId, out);
      this.#bookUnshown(chain, out, notes, upstream);
      // The failure says Claude's words for the API error it met (kept off the reply): the adapter puts them in its
      // error, and they are added where it did not.
      const met = reader.apiError();
      if (met && e instanceof Error && !e.message.includes(met)) e.message = `${e.message}: ${met}`;
      // A seeded first prompt refused before any answer may go again, its seed compacted or none (`retrySeed`).
      if (seeded && !answered && !bare && e && typeof e === "object") /** @type {any} */ (e).seededUnanswered = true;
      // A plan that stopped the turn before the agent said who it runs as — Claude's adapter learns its login in the
      // background, five seconds at most, and a quick refusal can come first: its word is waited for, so the turn's
      // record names whose plan ran out.
      if (classifyFailure(e)?.kind === "limit" && readProfile(proc.initResult).account) await proc.heardWho(5000);
      throw e;
    } finally {
      // The agent's answer is in — unless a Force stop let go of it, and its agent works on: the stop's cancel
      // still goes then. Else it would reach the session's next prompt.
      ended = !force?.aborted;
      // Words that waited for a prompt that never went out are handed back (`afterPrompt`).
      promptWent(false);
      // A turn that failed with words still queued at the agent lets them go: they never ran, and go as the next
      // message.
      await queued?.letGo(cancel);
      reader.flush();
      next?.end();
      if (stopped) await this.#leftRunning({ stopped, upstream, notes, onEvent });
      // The windows as the turn left them, a failed turn's too: one stopped by the plan shows the window that ran out.
      if (out.account !== undefined) out.account = this.#accountRecord(upstream.id);
      // The plan's usage is read by the clock no longer, and asked for once more where what was asked last has stood
      // a while (`/usage`).
      usageOver();
      this.#usageAfterTurn(upstream);
      this.#unlisten(conv.sessionId, reader);
      releaseSession();
      proc.off("unhandled", onUnhandled);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * What a turn's commands had started on the agent's process when its stop came, read from the system's table
   * before the agent hears its cancel (`left-running.js`, HarnessV4_Tasks B13) — and whether they ran alone there:
   * from the first of them on, in the order the process announced its calls, no other call began before the table
   * was read. (The order, not the clock: a call that ended just before can share the command's millisecond.) The
   * commands are read as the stop comes, the table after. A command Filament's own terminal ran for the agent is no
   * child of the agent's process: it is the agent's to end (`terminal/kill`), and none of this.
   * → null where the turn had no command of the agent's own open at the stop.
   * @param {any} proc @param {LiveTurn} turn @param {{ id: string, kind: string, status: string }[]} tools
   * @returns {Promise<{ was: import("../left-running.js").Proc[] | null, alone: boolean } | null>}
   */
  async #startedAtStop(proc, turn, tools) {
    const open = tools.filter((t) => t.kind === "execute" && t.status !== "completed" && t.status !== "failed").map((t) => t.id);
    /** @type {{ at: number, turn: string, id: string }[]} */
    const calls = proc.calls;
    const began = calls.filter((c) => c.turn === turn.id && open.includes(c.id));
    const agentPid = proc.child?.pid;
    if (!agentPid || proc.exited || !began.length) return null;
    const was = await startedSince({ agentPid, since: began[0].at, log: this.log, waitMs: this.processesWaitMs });
    return { was, alone: calls.slice(Math.max(calls.indexOf(began[0]), 0)).every((c) => began.includes(c)) };
  }

  /**
   * A stopped turn's commands that the agent's own shell ran: what they had started when the stop came
   * (`#startedAtStop`) and still runs now that the agent's cancel is answered — or a Force stop let go of it — is
   * ended where they were the one thing the process was doing, and said on the turn either way (`left-running.js`,
   * HarnessV4_Tasks B13).
   * @param {{ stopped: { seen: Promise<{ was: import("../left-running.js").Proc[] | null, alone: boolean } | null> },
   *   upstream: any, notes: string[], onEvent: (ev: any) => void }} o
   */
  async #leftRunning({ stopped, upstream, notes, onEvent }) {
    const seen = await stopped.seen;
    if (!seen) return;
    const words = leftRunningWords(await leftRunning({ ...seen, log: this.log, waitMs: this.processesWaitMs }), agentTitle(upstream));
    if (!words) return;
    // The log has it too: a Force stop's turn is over by now, and reads none of this.
    this.log("info", `[acp] ${upstream.id}: ${words}`);
    notes.push(`acp: ${words}`);
    onEvent({ type: "text", own: true, text: `\n\n_filament: ${words}_\n\n` });
  }

  /**
   * The agent's own turn, once its conversation's queue lets it run (AC3-9): the session's lock is taken as a prompt's
   * is, the turn opens, and its reader reads what the session held, then what it says, until the cycle's result
   * (`ownEnd`) or a stop. A turn stopped before it opened lets what the session held go with it, as the stop cancels the
   * agent's cycle.
   * `place`: the cycle's user turn in the chat's history, counted as a prompt's catch-up counts them; null where unknown.
   * @param {{ upstream: any, onEvent: (ev: any) => void, signal?: AbortSignal | null, place?: number | null }} opts
   * @param {{ convKey: string, conv: any, turn: LiveTurn }} at
   */
  async #listenTurn({ upstream, onEvent, signal = null, force = null, place = null }, { convKey, conv, turn }) {
    const acp = upstream.acp || {};
    const proc = conv.procKey ? this.procs.get(conv.procKey) : null;
    if (this.convs.get(convKey) !== conv || !proc || proc.exited) {
      // What the cycle spent before its process ended, read from what the session held (`#keepUnshown`): the failure
      // carries it, for the turn's record.
      const facts = this.#takeUnshown(conv.chain);
      throw Object.assign(new Error(`${agentTitle(upstream)}'s session closed before its own turn could show it`), { code: "ACP_OWN_GONE", ...(facts ? { facts } : {}) });
    }
    const notes = [],
      structured = [];
    // What the session's last turn had in force: no prompt goes out to change it.
    turn.bridgeEffective = this.turns.get(conv.sessionId)?.bridgeEffective;
    const out = {
      tools: [],
      stopReason: null,
      sessionId: conv.sessionId,
      reused: true,
      seeded: false,
      resumed: false,
      cwd: conv.cwd,
      notes,
      structured,
      bridge: turn.bridgeEffective ?? null,
      steering: !!conv.steering,
      ...pointOf(conv),
    };
    const releaseSession = await this.lockSession(conv.sessionId);
    // The person's words queued at the agent while its cycle runs, as in a turn of theirs (HarnessV3-FailurePoints
    // §7.2): Claude Code adds them to the running turn, or runs them next.
    const openEnd = createOpenEnd({ notes, who: agentTitle(upstream) });
    const queued = queuesWords(readProfile(proc.initResult, confirmedOf(upstream)))
      ? createQueued((text) => this.#orLetGo(proc.request("session/prompt", { sessionId: conv.sessionId, prompt: [{ type: "text", text }] }).catch(openEnd.answer), force, conv, upstream))
      : null;
    /** @param {any} ev */
    const heard = (ev) => {
      openEnd.heard(ev);
      const took = ev?.type === "raw" ? queued?.heard(ev.message) : null;
      if (took) onEvent({ type: "taken", ...took });
      return onEvent(ev);
    };
    const reader = createUpdateReader({ out, conv, turn, onEvent: heard, notes, keepRaw: rawKept(acp), own: true, state: this.#cycles.get(conv.sessionId)?.state || "", readsOn: () => !!queued?.waiting(), waitsOn: () => this.#asking.has(conv.sessionId) });
    const onAbort = () => {
      try {
        proc.notify("session/cancel", { sessionId: conv.sessionId });
      } catch {}
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      if (signal?.aborted) {
        onAbort();
        // What the session held was this turn's to show: what it spent there is the stopped turn's, its facts say it.
        const held = this.#heldSpend(conv, proc);
        if (held) Object.assign(out, held);
        this.#letHeldGo(conv.sessionId, "stopped before it opened");
        out.stopReason = "cancelled";
        return out;
      }
      turn.sessionId = conv.sessionId;
      turn.conv = conv;
      turn.proc = proc;
      turn.notes = notes;
      turn.structured = structured;
      turn.rawMessages = true;
      turn.cancel = onAbort;
      out.account = this.#accountRecord(upstream.id);
      // The words it takes are the cycle's, the user turn the chat's history holds for it (counted as seen below). Words
      // sent once the session holds what came past the cycle (`#pastOwn`) are no longer the turn's: handed back, they
      // go as the next message.
      const takes = (/** @type {string} */ text, /** @type {import("./prompt.js").SteerImage[]} */ images = []) => (queued && !this.#pastOwn(conv.sessionId) ? queued.send(text, images) : Promise.resolve(/** @type {const} */ (false)));
      const steer = queued ? { at: /** @type {const} */ ("queued"), send: countTaken(conv, (conv.seenUserTurns ?? 0) + 1, takes) } : null;
      onEvent({ type: "session", sessionId: conv.sessionId, cwd: conv.cwd, rawMessages: true, facts: out, steer, ownCommands: ownCommands(conv) });
      // From here the turn reads the session, what it held first: nothing the agent says comes in between.
      this.turns.set(conv.sessionId, turn);
      this.#listeners.set(conv.sessionId, reader);
      this.#takeHeld(conv.sessionId, reader, turn, { cycle: true });
      // The cycle is the agent's, never the person's: a later turn's catch-up counts it as seen (`composePrompt`). It
      // comes right after what the session saw — or past turns the chat had with another model since (`place`), which
      // the session never saw: those stay owed, and the cycle is one it heard (the review of cb2d2d1f0: the count took
      // the other model's turn for seen, and the catch-up handed the session its own cycle instead). A count that is
      // unknown stays unknown: the next prompt counts the person's turns (`told`).
      if (conv.seenUserTurns != null) {
        if (place != null && place > conv.seenUserTurns + 1) conv.heard = [...(conv.heard || []), place];
        else conv.seenUserTurns += 1;
      }
      // No clock ends the cycle's wait (HarnessV3-FailurePoints §4 B): its result, a stop, or the agent's process
      // ending, which fails the turn with the process's own words.
      const exit = proc.ending("its own turn");
      let how;
      try {
        how = await Promise.race([reader.ownEnd(signal), exit.gone]);
      } finally {
        exit.unhook();
      }
      // The person's words queued meanwhile: the turn reads on until each is answered. Those it took after the cycle
      // ended ran cycles of their own, which spent apart from it; taken into it, they share its result. Words it never
      // took may have failed for a session it lost.
      const taken = queued ? await queued.drained((e) => this.#lostUnder(conv, e)) : [];
      out.stopReason = taken.length ? taken.at(-1)?.answer?.stopReason || "end_turn" : how === "stopped" ? "cancelled" : "end_turn";
      if (out.stopReason === "refusal") conv.refused = true;
      if (how === "idle" && reader.cycled()) notes.push(`acp: ${agentTitle(upstream)} went idle before its cycle's result; the turn ended without it`);
      const met = reader.apiError();
      if (met) notes.push(`acp: Claude met an API error during this turn: ${met}`);
      // What the cycle spent, by its result — its tokens and the models that counted them — and what the words taken
      // after it spent, by their answers.
      const own = reader.ownSpend();
      const { usage, modelUsage } = turnUsage(taken.filter((t) => t.took === "after").map((t) => t.answer), own ? [own] : [], readProfile(proc.initResult, confirmedOf(upstream)));
      if (usage) out.usage = usage;
      if (modelUsage) out.modelUsage = modelUsage;
      out.agentModel = answeringModel(reader, out, conv);
      this.#ownCost(proc, conv.sessionId, out);
      this.#bookUnshown(conv.chain, out, notes, upstream);
      if (out.context) conv.context = out.context;
      if (out.title) conv.title = out.title;
      conv.turns++;
      this.#used(conv);
      return out;
    } catch (e) {
      this.#used(conv);
      this.#lostUnder(conv, e);
      // What the agent reported the turn spent before it failed, which its facts keep: the cycle's, by its result, and
      // that of the words it took once the cycle ended, by their cycles' results — their answers never all came.
      const own = reader.ownSpend();
      const spent = turnUsage([], [...(own ? [own] : []), ...reader.resultsAfterOwn()]);
      if (spent.usage) out.usage = spent.usage;
      if (spent.modelUsage) out.modelUsage = spent.modelUsage;
      out.agentModel = answeringModel(reader, out, conv);
      this.#ownCost(proc, conv.sessionId, out);
      this.#bookUnshown(conv.chain, out, notes, upstream);
      const met = reader.apiError();
      if (met && e instanceof Error && !e.message.includes(met)) e.message = `${e.message}: ${met}`;
      throw e;
    } finally {
      await queued?.letGo(onAbort);
      reader.flush();
      if (out.account !== undefined) out.account = this.#accountRecord(upstream.id);
      this.#unlisten(conv.sessionId, reader);
      releaseSession();
      signal?.removeEventListener("abort", onAbort);
    }
  }
  // Model names for the picker, and each one's name and description in the agent's own words (HarnessV3-ACP AF2).
  // Cursor: `agent --list-models` prints "id - name" lines (acp.listModelsArgs); every other agent: the models a
  // throwaway session offers, with the thinking levels it offers for the model it opened on (`caps`). That session
  // says of the agent's sign-in what a turn's does (`heardSignIn`): opened, someone is signed in; refused asking for
  // a sign-in, nobody is. A Claude Code account on an Anthropic API key: after them, the models its key can use
  // that Claude Code does not list (`keyed`, `#keyOffers`), asked of Anthropic with each listing — a Refresh's too,
  // whatever the hour's cache holds — and `keyNote` where they could not be.
  async listModels(upstream, { force = false } = {}) {
    const acp = upstream.acp || {};
    const cached = this.modelCache.get(upstream.id);
    if (!force && cached && Date.now() - cached.at < 3600_000) return this.#listed(cached, "cache");
    const listArgs = Array.isArray(acp.listModelsArgs) && acp.listModelsArgs.length ? acp.listModelsArgs : null;
    const none = { names: [], labels: {} };
    const listed = !listArgs
      ? none
      : await new Promise((resolve) => {
          const spec = resolveAgentCommand(acp.command || "agent", listArgs);
          let outText = "";
          let done = false;
          const finish = (v) => {
            if (!done) {
              done = true;
              resolve(v);
            }
          };
          try {
            const child = spawn(spec.file, spec.args, {
              env: agentEnv({ NO_COLOR: "1", FORCE_COLOR: "0", ...agentLaunchEnv(upstream) }, acp.envRemove).env,
              stdio: ["ignore", "pipe", "ignore"],
              windowsHide: true,
            });
            child.stdout.on("data", (d) => (outText += d));
            child.stdout.on("error", () => {});
            const killTimer = setTimeout(() => {
              try {
                child.kill();
              } catch {}
              finish(none);
            }, 60000);
            child.on("error", () => {
              clearTimeout(killTimer);
              finish(none);
            });
            child.on("close", () => {
              clearTimeout(killTimer);
              finish(listedModels(outText));
            });
          } catch {
            finish(none);
          }
        });
    if (listed.names.length) {
      this.modelCache.set(upstream.id, { at: Date.now(), ...listed });
      return { ...listed, source: "discovered" };
    }
    // Generic ACP: agents advertise models in the session/new response. Open a throwaway session and read them.
    const p = new AcpProcess({
      command: acp.command || "agent",
      args: [...agentArgs(acp)],
      env: agentLaunchEnv(upstream),
      envRemove: acp.envRemove,
      log: this.log,
    }).start();
    try {
      const init = await this.#initialize(p, upstream);
      const auth = authenticateMethod(init);
      if (auth && acp.authenticate === true) {
        try {
          await p.request("authenticate", { methodId: auth }, 15000);
        } catch {}
      }
      const s = await p
        .request("session/new", { cwd: determineCwd(acp, [], null).cwd, mcpServers: [] }, 120000)
        .catch((/** @type {any} */ e) => {
          if (saysSignedOut(e)) this.heardSignIn(upstream.id, false, String(e?.message || e));
          throw e;
        });
      this.heardSignIn(upstream.id, true);
      const offer = readSessionOffer(s);
      const names = offer.models.filter((m) => m !== "default");
      if (names.length) {
        const labels = Object.fromEntries(Object.entries(offer.modelLabels).filter(([id]) => names.includes(id)));
        // The levels are an option of the session (`thought_level`), said of the model it opened on: another of its
        // models may take others, or none (Claude's Haiku), so nothing is said of those.
        const on = String(offer.currentModel ?? "");
        const caps = offer.efforts.length && names.includes(on) ? { [on]: { efforts: offer.efforts.map(String) } } : null;
        // A Claude Code account on an API key: what the key can use beyond this list, asked of Anthropic (`#keyOffers`).
        // Whatever fails there, the agent's own list stands; the failure is named by its kind alone.
        const more = await this.#keyOffers(upstream, p, init, names, labels, this.#keyedOf(upstream.id)).catch((e) => {
          this.log("debug", `[acp] ${upstream.id}: what its API key can use was not read (${e?.name || "an error"})`);
          return {};
        });
        const kept = { at: Date.now(), names, labels, ...(caps ? { caps } : {}), ...more };
        this.modelCache.set(upstream.id, kept);
        return this.#listed(kept, "discovered");
      }
      // A session it opened with no model to choose: one row that runs the model it picks itself (`default` switches
      // nothing), so the picker has it to offer (the review of 11-10: an agent that lists none was in no picker).
      const own = { names: ["default"], labels: { default: { label: "Its own model", note: "The model the agent runs by itself: it lists none to choose from" } } };
      this.modelCache.set(upstream.id, { at: Date.now(), ...own });
      return { ...own, source: "discovered" };
    } catch (e) {
      // Why it could not list them is the models list's to say (app/models.js), not a debug line's.
      return cached ? { ...this.#listed(cached, "cache"), error: e.message } : { names: [], labels: undefined, source: "none", error: e.message };
    } finally {
      p.kill();
    }
  }

  // Everything the agent has to offer, for the per-agent cheat sheet: capabilities, modes, models, effort levels,
  // other session settings and published commands. Throwaway session; cached for ten minutes per upstream.
  async offer(upstream, { force = false } = {}) {
    this.offerCache ||= new Map();
    const cached = this.offerCache.get(upstream.id);
    if (!force && cached && Date.now() - cached.at < 600000) return cached.value;
    const acp = upstream.acp || {};
    const p = new AcpProcess({
      command: acp.command || "agent",
      args: [...agentArgs(acp)],
      env: agentLaunchEnv(upstream),
      envRemove: acp.envRemove,
      log: this.log,
    }).start();
    let commands = [];
    const onNotif = (method, params) => {
      if (method === "session/update" && params?.update?.sessionUpdate === "available_commands_update")
        commands = (params.update.availableCommands || []).map((c) => ({
          name: c.name,
          description: c.description || "",
        }));
    };
    p.on("notification", onNotif);
    try {
      const profile = readProfile(await this.#initialize(p, upstream));
      const s = await p.request(
        "session/new",
        { cwd: determineCwd(acp, [], null).cwd, mcpServers: [] },
        120000,
      );
      await new Promise((r) => setTimeout(r, 1200)); // commands arrive as a notification shortly after session/new
      const o = readSessionOffer(s);
      let sessions = null;
      if (profile.sessions.list) {
        try {
          const l = await p.request("session/list", {}, 15000);
          sessions = Array.isArray(l?.sessions) ? l.sessions.length : null;
        } catch {}
      }
      const value = {
        ok: true,
        profile,
        modes: o.modeDetails,
        currentMode: o.currentMode,
        models: o.models,
        currentModel: o.currentModel,
        modelConfig: o.modelConfig,
        efforts: o.efforts,
        currentEffort: o.currentEffort,
        configOptions: o.configOptions,
        commands,
        sessionsKnown: sessions,
        at: Date.now(),
      };
      this.offerCache.set(upstream.id, { at: Date.now(), value });
      return value;
    } catch (e) {
      return { ok: false, error: e.message };
    } finally {
      p.off("notification", onNotif);
      p.kill();
    }
  }

  // Sessions the agent itself knows about (Claude Code lists every chat started in its terminal). Reuses a running
  // process for this upstream when there is one, otherwise starts a throwaway one.
  async listSessions(upstream) {
    const acp = upstream.acp || {};
    const running = [...this.procs.values()].find((p) => p.key.startsWith(`${upstream.id}|`));
    const p =
      running ||
      new AcpProcess({
        command: acp.command || "agent",
        args: [...agentArgs(acp)],
        env: agentLaunchEnv(upstream),
        envRemove: acp.envRemove,
        log: this.log,
      }).start();
    try {
      if (!running) await this.#initialize(p, upstream);
      const r = await p.request("session/list", {}, 30000);
      const sessions = (Array.isArray(r?.sessions) ? r.sessions : Array.isArray(r) ? r : [])
        .map((x) => ({
          sessionId: x.sessionId,
          cwd: x.cwd || null,
          title: x.title || null,
          updatedAt: x.updatedAt || null,
        }))
        .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
      this.convs.adoptTitles(sessions);
      return { ok: true, sessions };
    } catch (e) {
      return { ok: false, error: e.message, sessions: [] };
    } finally {
      if (!running) p.kill();
    }
  }

  // Connection test: start the agent, initialize, open a throwaway session, report what it offers.
  async test(upstream) {
    const t0 = performance.now();
    const acp = upstream.acp || {};
    const p = new AcpProcess({
      command: acp.command || "agent",
      args: [...agentArgs(acp)],
      env: agentLaunchEnv(upstream),
      envRemove: acp.envRemove,
      log: this.log,
    }).start();
    try {
      const init = await this.#initialize(p, upstream);
      const auth = authenticateMethod(init);
      const signIns = readProfile(init).signIns;
      let authed = signIns.length ? `uses the agent's own login (it signs in through ${signIns.map((w) => w.name).join(" or ")})` : "not required";
      if (auth && acp.authenticate !== true)
        authed = `uses the agent's own login (${auth}; Filament does not call authenticate unless the upstream setting is on)`;
      else if (auth) {
        try {
          await p.request("authenticate", { methodId: auth }, 15000);
          authed = `ok (${auth})`;
        } catch (e) {
          authed = `failed (${auth}): ${e.message}`;
        }
      }
      const cwd = determineCwd(acp, [], null).cwd;
      const s = await p.request("session/new", { cwd, mcpServers: [] }, 120000);
      const offer = readSessionOffer(s);
      const models = offer.models;
      return {
        ok: true,
        ms: Math.round(performance.now() - t0),
        command: p.spec.resolved,
        profile: readProfile(init, confirmedOf(upstream)),
        auth: authed,
        modes: offer.modes,
        currentModel: offer.currentModel,
        models: models.length || null,
        sample: models.slice(0, 12).join(", "),
        efforts: offer.efforts,
        cwd,
      };
    } catch (e) {
      return {
        ok: false,
        ms: Math.round(performance.now() - t0),
        command: p.spec.resolved,
        error: `${e.message}${p.stderr.length ? " | stderr: " + p.stderr.slice(-2).join(" ").trim().slice(0, 300) : ""}`,
      };
    } finally {
      p.kill();
    }
  }

  sweep(now = Date.now()) {
    this.sweepTurns(now);
    for (const [tok, p] of this.pendingMcp) if (now - p.at > 30 * 60_000) this.pendingMcp.delete(tok);
    const { dropped, resting } = this.convs.sweep(now, (k) => this.inUse(k));
    // An address no session holds any more lists nothing to anyone.
    const held = new Set([...this.convs.values()].map((c) => c.mcpToken));
    for (const tok of this.ownListed.keys()) if (!held.has(tok) && !this.pendingMcp.has(tok)) this.ownListed.delete(tok);
    // Chats that shared one agent session (`#id`, `/resume`) let go of it once.
    const sessions = new Map(dropped.map((c) => [`${c.procKey}\n${c.sessionId}`, c]));
    for (const c of sessions.values()) {
      this.#closeSession(c.procKey, c.sessionId);
      const chat = dropped.find((d) => d.sessionId === c.sessionId && d.procKey === c.procKey && d.chain) || c;
      if (!this.#sessionKept(c.sessionId)) this.#forgetBetween(c.sessionId, { proc: c.procKey ? this.procs.get(c.procKey) : null, chat });
    }
    // A harness chat let go of past its keep limit takes what it kept with it: no turn of it will come here to book it.
    for (const chain of new Set(dropped.map((c) => c.chain).filter(Boolean)))
      if (![...this.convs.values()].some((c) => c.chain === chain)) this.#settleLeft(chain, "its chat went unused past its keep limit");
    for (const c of dropped) this.#op(...idleDropOp(c, now));
    for (const c of resting) if (c.procKey) this.#rest(c);
    // An agent process stops once it has gone 90 minutes unasked and none of its chats has work queued or running, or
    // was used in the last 30.
    for (const [k, p] of this.procs)
      if (
        now - p.lastUsed > 90 * 60_000 &&
        ![...this.convs].some(([key, c]) => c.procKey === k && (this.inUse(key) || now - c.lastUsed < 30 * 60_000))
      ) {
        p.kill();
        this.procs.delete(k);
      }
    return dropped.length;
  }

  shutdown() {
    clearInterval(this.timer);
    // The map is written as it stands, the chats with work running used until now, and kept whole: it outlives the
    // process for the next start (the bug report's H10: the shutdown emptied it, and the save still waiting wrote the
    // empty map over every chat's session).
    this.usedUntilNow(this.convs);
    // Its agents end below, and a close Claude Code may still be saving as it exits with them (`ended`): before the map
    // is written.
    for (const p of this.procs.values()) this.#closesCut(p);
    this.convs.flush();
    for (const p of this.procs.values()) p.kill();
    this.procs.clear();
    for (const p of this.#usageProcs) p.kill();
    this.stopLetGo();
    for (const sid of [...this.#between.keys()]) this.#dropHeld(sid);
    this.#cycles.clear();
  }
}

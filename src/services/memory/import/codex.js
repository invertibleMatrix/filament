// @ts-check
// Codex's chats: ~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-<time>-<id>.jsonl, one file per chat → one chain per chat.
//
// Format observed on disk (keys and shapes only; Codex 0.154 to 0.160). A line is { timestamp, type, payload, ordinal }.
// Types: session_meta { id, cwd, originator, cli_version, source, git { branch }, forked_from_id,
// forked_from_ordinal_exclusive, history_base }, turn_context { model, cwd }, response_item — message { role:
// developer | user | assistant, content [input_text | output_text | input_image], phase }, reasoning { summary [],
// encrypted_content }, function_call { name, arguments, call_id }, custom_tool_call { name, input, call_id },
// function_call_output / custom_tool_call_output { call_id, output: string | [input_text] } — event_msg (task_started,
// task_complete, turn_aborted { reason }, token_count { info { total_token_usage, last_token_usage } }, item_completed
// { item: UserMessage | AgentMessage | Reasoning | CommandExecution | FileChange | McpToolCall | ContextCompaction },
// thread_settings_applied), compacted { message, replacement_history }, world_state, token_usage_record.
// An older file has no envelope: its first line is the session ({ id, timestamp }), each other line a response item.
//
// A chat is translated, not copied (the plan's §7; `codexReader` says each rule). The model's own tool is a script
// (`exec`) that runs commands, patches files and calls MCP tools; what it did comes beside it as items. The chat is
// written as what Codex did, in the calls Filament's bridge draws for the same items of a Codex turn it runs
// (core/codex-items.js), so a chat brought in shows the cards a chat run here shows.
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { changeInput, commandCall, fileCall, itemCall, itemFailed, itemResult } from "../../../core/codex-items.js";
import { ownTurnText, textOfMessage } from "../../../core/messages.js";
import { Sink, breather, expandHome, noop, parseJson, pct, previewOf, readLines, scrub, shapeTurn, summary, throwIfStopped, toMs, turnFacts, unansweredLine } from "./sink.js";

export const CODEX_ROOT = join(homedir(), ".codex", "sessions");
/** The agent, as Filament names it on a turn it began by itself, on a compaction it made, and in a fork's title (IM-61). */
const AGENT = "Codex";
/** The agent's id where a turn was stopped in it (`stopped.by`); the chat and its turns are the harness's (IM-58). */
const CLIENT = "codex";
/** What Codex writes as the originator of a chat Filament's bridge runs: that chat is a session of Filament's already. */
const OWN_ORIGINATOR = "filament";
/** The session's id, as a rollout file's name ends. */
const ID_IN_NAME = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

/** Rollout files under the root, however deep its dated folders go (four levels at most). @param {string} root */
export function listCodexFiles(root) {
  /** @type {{ path: string, name: string, id: string, mtime: number, size: number }[]} */
  const out = [];
  const walk = (/** @type {string} */ dir, /** @type {number} */ depth) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const path = join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < 4) walk(path, depth + 1);
        continue;
      }
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      out.push({ path, name: e.name, id: ID_IN_NAME.exec(e.name)?.[1] ?? e.name.slice(0, -6), mtime: st.mtimeMs, size: st.size });
    }
  };
  walk(root, 0);
  return out;
}

/**
 * A line as { type, p, at }, whichever shape the file is in: the envelope's, or the older bare one (the session's
 * first line, then response items). Null for a line that is neither (a state record).
 * @param {any} o
 */
function lineOf(o) {
  if (o.payload && typeof o.payload === "object" && typeof o.type === "string") return { type: o.type, p: o.payload, at: toMs(o.timestamp) };
  if (o.record_type) return null;
  if (typeof o.type === "string") return { type: "response_item", p: o, at: toMs(o.timestamp) };
  if (typeof o.id === "string" && o.timestamp != null) return { type: "session_meta", p: o, at: toMs(o.timestamp) };
  return null;
}

/** A part that is one tagged block (`<environment_context>…</environment_context>`): what Codex tells its model, not the person's words. */
const TAGGED = /^\s*<([A-Za-z_][\w-]*)>[\s\S]*<\/\1>\s*$/;
/** The marks Codex puts around a picture in a message. */
const IMAGE_MARK = /^\s*<\/?image\b[^>]*>\s*$/;
/** What stands between a tag's two ends, or null. @param {string} text @param {string} tag */
const inTag = (text, tag) => new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text)?.[1] ?? null;

/** A picture Codex kept as an address (its bytes inline, or a link) as the block Filament keeps. @param {unknown} url @returns {any} */
function imageBlock(url) {
  const s = String(url || "");
  const data = /^data:([^;,]+);base64,(.+)$/s.exec(s);
  if (data) return { type: "image", source: { type: "base64", media_type: data[1], data: data[2] } };
  return /^https?:\/\//.test(s) ? { type: "image", source: { type: "url", url: s } } : null;
}
/**
 * What of a user message the person typed: its parts that are no tagged block and no picture's mark, a picture with
 * them. A string for words alone, blocks where a picture rides along, null where none of it is the person's.
 * @param {unknown} content
 */
function typedOf(content) {
  /** @type {any[]} */
  const blocks = [];
  for (const c of Array.isArray(content) ? content : typeof content === "string" ? [{ type: "input_text", text: content }] : []) {
    if ((c?.type === "input_text" || c?.type === "text") && typeof c.text === "string") {
      if (c.text.trim() && !TAGGED.test(c.text) && !IMAGE_MARK.test(c.text)) blocks.push({ type: "text", text: c.text });
    } else if (c?.type === "input_image") {
      const img = imageBlock(c.image_url);
      if (img) blocks.push(img);
    }
  }
  if (!blocks.length) return null;
  return blocks.every((b) => b.type === "text") ? blocks.map((b) => b.text).join("\n") : blocks;
}
/** A message's words alone. @param {any} content */
const wordsOf = (content) => (typeof content === "string" ? content : textOfMessage({ role: "user", content })).trim();

/** What Rust's shlex leaves outside quotes: the characters no shell reads more into. */
const PLAIN_WORD = /^[A-Za-z0-9_+\-./:@\],=%^]+$/;
/**
 * A command's words as one line, each quoted as a POSIX shell would need it: how Codex itself words a command to
 * its app, so the line reads here as it does in a turn Filament runs. @param {readonly unknown[]} argv
 */
export function shellWords(argv) {
  return argv
    .map((w) => {
      const s = String(w ?? "");
      if (PLAIN_WORD.test(s)) return s;
      return s.includes("'") ? `"${s.replace(/(["\\$`])/g, "\\$1")}"` : `'${s}'`;
    })
    .join(" ");
}

const camel = (/** @type {string} */ k) => k.replace(/_([a-z])/g, (_, /** @type {string} */ c) => c.toUpperCase());
/** An object's own fields under camelCase names. @param {any} o */
const camelKeys = (o) => Object.fromEntries(Object.entries(o && typeof o === "object" ? o : {}).map(([k, v]) => [camel(k), v]));
/** A status word as the app-server spells it. @param {unknown} s */
const statusOf = (s) => {
  const w = String(s ?? "");
  return w.charAt(0).toLowerCase() + w.slice(1);
};
/**
 * An item as the rollout keeps it (its type capitalised, its fields in snake_case) → as Codex's app-server words the
 * same item, which is what core/codex-items.js reads. @param {any} raw
 */
function itemOf(raw) {
  const name = String(raw?.type || "");
  const type = name.charAt(0).toLowerCase() + name.slice(1);
  const id = String(raw?.id || "");
  if (type === "commandExecution")
    return {
      type,
      id,
      command: Array.isArray(raw.command) ? shellWords(raw.command) : String(raw.command ?? ""),
      commandActions: (Array.isArray(raw.parsed_cmd) ? raw.parsed_cmd : []).map((/** @type {any} */ a) => ({ ...camelKeys(a), type: a?.type === "list_files" ? "listFiles" : a?.type })),
      aggregatedOutput: String(raw.aggregated_output ?? ""),
      exitCode: raw.exit_code ?? null,
      status: statusOf(raw.status),
    };
  if (type === "fileChange")
    return {
      type,
      id,
      status: statusOf(raw.status),
      // The rollout keys a change by its file; the app-server lists them, each with its kind and its text.
      changes: Array.isArray(raw.changes)
        ? raw.changes
        : Object.entries(raw.changes && typeof raw.changes === "object" ? raw.changes : {}).map(([path, c]) => ({
            path,
            kind: { type: String(/** @type {any} */ (c)?.type || "update"), move_path: /** @type {any} */ (c)?.move_path ?? null },
            diff: String(/** @type {any} */ (c)?.unified_diff ?? /** @type {any} */ (c)?.content ?? ""),
          })),
    };
  return { ...camelKeys(raw), type, id, status: statusOf(raw?.status) };
}

/** A call and its answer, as the archive keeps the pair. @param {string} id @param {string} name @param {any} input @param {any} content @param {boolean} failed */
const pair = (id, name, input, content, failed) => ({
  use: { type: "tool_use", id, name, input },
  result: { type: "tool_result", tool_use_id: id, content, ...(failed ? { is_error: true } : {}) },
});
/**
 * What one item did, as calls with their answers: a command is one, a file change one for each file, an MCP tool,
 * a web search or a picture one. None for an item that is no call. @param {any} item
 */
function itemCalls(item) {
  if (item.type === "commandExecution") {
    const c = commandCall(item);
    const ok = item.status === "completed" && (item.exitCode == null || Number(item.exitCode) === 0);
    return [pair(item.id, c.toolName, c.rawInput, item.aggregatedOutput, !ok)];
  }
  if (item.type === "fileChange") {
    const ok = item.status === "completed";
    return item.changes.map((/** @type {any} */ ch, /** @type {number} */ i) => pair(`${item.id}#${i}`, fileCall(ch).toolName || "delete", changeInput(ch), ok ? "" : "The change could not be applied.", !ok));
  }
  const c = itemCall(item);
  if (!c) return [];
  const said = itemResult(item)
    .map((/** @type {any} */ b) => (b?.type === "text" ? String(b.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
  return [pair(item.id, c.toolName || item.type, c.rawInput, said, itemFailed(item))];
}

/** How Codex begins the output of a script that failed: the file says a script's failure nowhere else (its call's status reads completed). */
const SCRIPT_FAILED = /^Script failed\b/;
/** The names older Codex gave its shell tool. */
const SHELLS = new Set(["shell", "local_shell", "container.exec", "exec_command", "shell_command"]);
/**
 * A call of the model's own, where the file keeps no item of what it did (an older Codex's, or a script that ran
 * nothing), under the name and fields Filament's cards read: a shell tool is a command line, a patch names its
 * first file, a plan is a list of steps, a picture looked at is a file read. Any other keeps its own name and what
 * it was given. @param {{ name: string, raw: unknown }} call
 * @returns {{ name: string, input: any }}
 */
function ownCall({ name, raw }) {
  const parsed = typeof raw === "string" ? parseJson(raw) : raw;
  const o = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? /** @type {Record<string, any>} */ (parsed) : null;
  if (SHELLS.has(name)) {
    const c = o?.command ?? o?.cmd;
    const command = Array.isArray(c) ? shellWords(c) : typeof c === "string" ? c : null;
    if (command != null) return { name: "bash", input: { command } };
  }
  if (name === "apply_patch") {
    const patch = String(o?.input ?? o?.patch ?? (typeof raw === "string" ? raw : ""));
    const path = /^\*\*\* (?:Update|Add|Delete) File: (.+)$/m.exec(patch)?.[1]?.trim() ?? "";
    return { name, input: { path, patch } };
  }
  if (name === "update_plan" && Array.isArray(o?.plan))
    return { name, input: { items: o.plan.map((/** @type {any} */ p) => ({ text: String(p?.step ?? ""), status: String(p?.status ?? "pending") })), ...(o.explanation ? { explanation: String(o.explanation) } : {}) } };
  if (name === "view_image" && typeof o?.path === "string") return { name: "read", input: { file_path: o.path } };
  return { name: name || "tool", input: o ?? (raw != null && raw !== "" ? { input: String(raw) } : {}) };
}
/**
 * What a call returned, as the file keeps it: a list of parts, a string, an older Codex's JSON of a command's output
 * with its exit code, or { content, success }. → what the archive keeps (words, or blocks where a picture is among
 * them), and whether the call failed. @param {unknown} output
 * @returns {{ content: string | any[], failed: boolean }}
 */
function outputOf(output) {
  if (Array.isArray(output)) {
    const blocks = output.flatMap((/** @type {any} */ c) => (typeof c?.text === "string" ? [{ type: "text", text: c.text }] : c?.type === "input_image" ? [imageBlock(c.image_url)].filter(Boolean) : []));
    return { content: blocks.every((b) => b.type === "text") ? blocks.map((b) => b.text).join("\n") : blocks, failed: false };
  }
  if (output && typeof output === "object") return { content: String(/** @type {any} */ (output).content ?? /** @type {any} */ (output).output ?? ""), failed: /** @type {any} */ (output).success === false };
  const s = String(output ?? "");
  const j = s.startsWith("{") ? parseJson(s) : undefined;
  if (j && typeof j === "object" && typeof j.output === "string") return { content: j.output, failed: j.metadata?.exit_code != null && Number(j.metadata.exit_code) !== 0 };
  return { content: s, failed: false };
}
/** Several outputs of one call as one. @param {(string | any[])[]} outputs */
function joined(outputs) {
  if (outputs.every((o) => typeof o === "string")) return outputs.join("\n");
  return outputs.flatMap((o) => (typeof o === "string" ? (o ? [{ type: "text", text: o }] : []) : o));
}

/**
 * A turn's steps, in the order Codex took them, as the messages the archive keeps: the model's words and thoughts
 * and the calls they led to in one message, the calls' answers in the next, and so on in turn.
 * @param {readonly any[]} steps @returns {{ msg: any, at: number | null }[]}
 */
function messagesOf(steps) {
  /** @type {{ msg: any, at: number | null }[]} */
  const out = [];
  const say = (/** @type {"assistant" | "user"} */ role, /** @type {any[]} */ blocks, /** @type {number | null} */ at) => {
    if (!blocks.length) return;
    const last = out.at(-1);
    if (last?.msg.role === role) {
      last.msg.content.push(...blocks);
      last.at = at ?? last.at;
    } else out.push({ msg: { role, content: [...blocks] }, at });
  };
  for (const st of steps) {
    if (st.said) {
      say("assistant", [st.said], st.at);
      continue;
    }
    // What it did, where the file says: the script that asked for it is not kept beside its own effects.
    const pairs = st.items.flatMap(itemCalls);
    if (pairs.length) {
      say("assistant", pairs.map((/** @type {any} */ p) => p.use), st.at);
      say("user", pairs.map((/** @type {any} */ p) => p.result), st.endAt ?? st.at);
      continue;
    }
    if (!st.name) continue;
    const call = ownCall(st);
    say("assistant", [{ type: "tool_use", id: st.id, name: call.name, input: call.input }], st.at);
    if (st.outputs.length) say("user", [{ type: "tool_result", tool_use_id: st.id, content: joined(st.outputs), ...(st.failed ? { is_error: true } : {}) }], st.endAt ?? st.at);
  }
  return out;
}

/**
 * A rollout's lines, taken one at a time: `push(line)` gives the turns that line closed (none, or one), `end()` the
 * turn still open. `s` is what the file has told so far: sessionId, cwd, originator, version, gitBranch, whether
 * Filament ran the chat itself (`own`) or it is a sub-agent's (`subagent`), what it was forked from (`forkedFrom`,
 * and `forkedAt`: the line of that chat it starts after, where this file holds its own turns alone), firstAt, lastAt,
 * compactions[], and the count of turns, lines and skipped lines. `before`: lines from that place on are left unread
 * (how far a fork's source had come).
 *
 * A turn is `{ user, work, final?, at, workAt, endAt, model, cut?, meta }`, as every importer's (sink.js `writer`).
 *
 *   The person's words open a turn. Codex writes them twice — in the request it sent its model, among the blocks it
 *   added itself, and as an item of their own — and they are one message: the parts that are no tagged block, said
 *   exactly by the item where there is one. What Codex told its model beside them (its instructions, the folder, the
 *   date, its plugins) is no message of the person's.
 *   The model's words are the turn's; its last are the answer. A summary of its reasoning is a thought; the reasoning
 *   itself is sealed by OpenAI and is not in the file.
 *   Its calls are written as what they did (`messagesOf`): the items between a script and its output are that
 *   script's, and so are those that end while it waits on the same script (`wait`).
 *   The end of Codex's task ends the turn. One the person stopped is marked so (`meta.stopped`); one the service
 *   failed, with its words (`meta.failed`), unless Codex went on in it. A turn that is over and never answered (its
 *   last word a call) keeps all it did as work and answers with Filament's line of how it ended (sink.js `shapeTurn`).
 *   A compaction's summary stands for the turns before it, between two turns or inside one, as Claude Code's. Codex
 *   0.15x seals its summary: between two turns the row then says the turns were compacted and keeps no summary, and
 *   inside one the turn is marked as Filament marks a turn of an agent that handed none over (`meta.ownCompaction`).
 *   An assistant line that follows nobody's message opens a turn the agent began by itself.
 * @param {{ before?: number | null }} [o]
 */
export function codexReader({ before = null } = {}) {
  /** @type {{ sessionId: string | null, cwd: string | null, title: string | null, originator: string | null, version: string | null, gitBranch: string | null, own: boolean, subagent: boolean, forkedFrom: string | null, forkedAt: number | null, firstAt: number | null, lastAt: number | null, compactions: any[], turns: number, lines: number, skipped: number }} */
  const s = {
    sessionId: null,
    cwd: null,
    title: null,
    originator: null,
    version: null,
    gitBranch: null,
    own: false,
    subagent: false,
    forkedFrom: null,
    forkedAt: null,
    firstAt: null,
    lastAt: null,
    compactions: [],
    turns: 0,
    lines: 0,
    skipped: 0,
  };
  /** @type {any[]} the turns closed since the caller last took them */
  const closed = [];
  /** @type {any} the open turn */
  let cur = null;
  /** The newest model a turn's context named. @type {string | null} */
  let model = null;
  /** The thread's token counts so far, as Codex last said them (running totals). @type {any} */
  let total = null;
  const open = (/** @type {any} */ user, /** @type {number | null} */ at, extra = {}) => {
    close();
    cur = { user, at, typed: false, steps: [], byCall: new Map(), openCall: null, lastExec: null, model, calls: 0, base: total, total: null, last: null, failed: null, failedAt: null, stopped: null, own: null, ownCompaction: null, endAt: null, ...extra };
  };
  /** The turn the agent's line belongs to: the open one, or one it began by itself. @param {number | null} at */
  const mine = (at) => {
    if (!cur) open({ role: "user", content: [{ type: "text", text: ownTurnText(AGENT, []) }] }, at, { own: { agent: AGENT } });
    return cur;
  };
  const tokensOf = (/** @type {any} */ t) => {
    const d = (/** @type {string} */ k) => Math.max(0, (Number(t.total?.[k]) || 0) - (Number(t.base?.[k]) || 0));
    return { input: Math.max(0, d("input_tokens") - d("cached_input_tokens")), output: d("output_tokens"), cacheRead: d("cached_input_tokens"), cacheWrite: d("cache_write_input_tokens") };
  };
  /** `over`: no more of the turn will come (its task ended, or a next message closed it); false where the file simply ends. */
  const close = (over = true) => {
    if (!cur) return;
    const t = cur;
    cur = null;
    s.turns++;
    const items = messagesOf(t.steps);
    const ends = items.map((i) => i.at).filter((v) => typeof v === "number");
    const facts =
      t.calls || t.failed
        ? turnFacts({
            calls: t.calls,
            model: t.model ?? null,
            tokens: tokensOf(t),
            held: Number(t.last?.input_tokens) || null,
            startedAt: t.at ?? null,
            endedAt: t.failedAt ?? t.endAt ?? (ends.length ? Math.max(.../** @type {number[]} */ (ends)) : (t.at ?? null)),
            error: t.failed || null,
          })
        : null;
    const meta = {
      format: "anthropic",
      ...(t.own ? { own: t.own } : {}),
      ...(t.stopped ? { stopped: t.stopped } : {}),
      ...(t.failed ? { failed: { cause: t.failed } } : {}),
      ...(t.ownCompaction ? { ownCompaction: t.ownCompaction } : {}),
      ...(facts ? { facts } : {}),
    };
    // A failed turn has no answer: what it did is its work, whole.
    const shaped = t.failed
      ? { user: t.user, at: t.at, model: t.model ?? null, work: items.map((i) => i.msg), workAt: items.at(-1)?.at ?? t.at, final: undefined, endAt: t.failedAt ?? t.at }
      : shapeTurn({ user: t.user, at: t.at, model: t.model, items, closing: over || t.stopped ? unansweredLine(AGENT, !!t.stopped) : null });
    closed.push({ ...shaped, ...(t.endAt != null && !t.failed ? { endAt: t.endAt } : {}), meta });
  };
  /** The id of the last call the open turn made, as the archive keeps it, or null. */
  const lastCall = () => {
    const st = cur?.steps.findLast((/** @type {any} */ x) => !x.said);
    if (!st) return null;
    const pairs = st.items.flatMap(itemCalls);
    return String(pairs.length ? pairs.at(-1).use.id : st.id);
  };
  /** The person's words, said by the item of their own. @param {string} text @param {number | null} at */
  const person = (text, at) => {
    if (!text.trim()) return;
    // The request's own line opened this turn already: the item says its words exactly.
    if (cur?.typed && !cur.steps.length && wordsOf(cur.user.content) === text.trim()) return;
    open({ role: "user", content: text }, at, { typed: true });
  };
  const said = (/** @type {any} */ block, /** @type {number | null} */ at) => {
    const t = mine(at);
    t.steps.push({ said: block, at });
    // It went on after a failure: the turn did not fail.
    t.failed = null;
    t.failedAt = null;
  };
  const call = (/** @type {any} */ p, /** @type {number | null} */ at) => {
    const t = mine(at);
    const id = String(p.call_id || p.id || `call-${t.steps.length}`);
    const name = p.type === "local_shell_call" ? "local_shell" : String(p.name || "");
    // A wait on the script still running is that script going on: what ends meanwhile is the script's, and so is
    // what the wait returns.
    if (name === "wait" && t.lastExec) {
      t.byCall.set(id, t.lastExec);
      t.openCall = t.lastExec;
      return;
    }
    const st = { id, name: name || "tool", raw: p.type === "local_shell_call" ? p.action : (p.arguments ?? p.input ?? null), items: [], outputs: [], failed: false, at, endAt: null };
    t.steps.push(st);
    t.byCall.set(id, st);
    t.openCall = st;
    if (p.type === "custom_tool_call" && name === "exec") t.lastExec = st;
    t.failed = null;
    t.failedAt = null;
  };
  const output = (/** @type {any} */ p, /** @type {number | null} */ at) => {
    const st = cur?.byCall.get(String(p.call_id));
    if (!st) return void s.skipped++;
    const o = outputOf(p.output);
    st.outputs.push(o.content);
    st.failed ||= o.failed || (st.name === "exec" && typeof o.content === "string" && SCRIPT_FAILED.test(o.content));
    st.endAt = at;
    if (cur.openCall === st) cur.openCall = null;
  };
  /** Something Codex did, as an item: the open script's, else the newest script's, else a call of its own. @param {any} item @param {number | null} at */
  const effect = (item, at) => {
    if (!cur) return void s.skipped++;
    const host = cur.openCall || cur.lastExec;
    if (host) {
      host.items.push(item);
      host.endAt = at;
    } else cur.steps.push({ id: item.id, name: "", raw: null, items: [item], outputs: [], failed: false, at, endAt: at });
  };
  const take = (/** @type {string} */ raw) => {
    if (!raw.trim()) return;
    const o = parseJson(raw);
    if (!o || typeof o !== "object") {
      s.lines++;
      s.skipped++;
      return;
    }
    if (before != null && typeof o.ordinal === "number" && o.ordinal >= before) return;
    s.lines++;
    const l = lineOf(o);
    if (!l) return;
    const p = l.p;
    if (l.at != null) {
      s.firstAt = s.firstAt == null ? l.at : Math.min(s.firstAt, l.at);
      s.lastAt = s.lastAt == null ? l.at : Math.max(s.lastAt, l.at);
    }
    // An older file dates its first line alone: its other lines stand at the newest time said.
    const at = l.at ?? s.lastAt;
    switch (l.type) {
      case "session_meta":
        if (typeof p.id === "string" && !s.sessionId) s.sessionId = p.id;
        if (typeof p.cwd === "string" && p.cwd && !s.cwd) s.cwd = p.cwd;
        if (typeof p.originator === "string") s.originator = p.originator;
        if (typeof p.cli_version === "string") s.version = p.cli_version;
        if (typeof p.git?.branch === "string") s.gitBranch = p.git.branch;
        s.own = s.originator === OWN_ORIGINATOR;
        s.subagent = !!(p.source && typeof p.source === "object" && p.source.subagent) || p.source === "subagent";
        if (typeof p.forked_from_id === "string" && p.forked_from_id) {
          s.forkedFrom = p.forked_from_id;
          s.forkedAt = typeof p.forked_from_ordinal_exclusive === "number" ? p.forked_from_ordinal_exclusive : null;
        }
        return;
      case "turn_context":
        if (typeof p.model === "string" && p.model) model = p.model;
        if (typeof p.cwd === "string" && p.cwd && !s.cwd) s.cwd = p.cwd;
        if (cur && !cur.steps.length) cur.model = model;
        return;
      case "compacted": {
        const text = typeof p.message === "string" && p.message.trim() ? p.message.trim() : null;
        // A turn whose last step is its words has had its answer: the summary comes after it, not inside it.
        if (cur && cur.steps.at(-1)?.said?.type === "text") close();
        if (cur) {
          if (text) s.compactions.push({ during: s.turns + 1, cutAfter: lastCall(), toTurn: s.turns, text, at });
          else cur.ownCompaction = { by: AGENT, left: "unsaid" };
        } else if (s.turns) s.compactions.push({ toTurn: s.turns, text, at });
        else if (text) s.compactions.push({ during: 1, cutAfter: null, toTurn: 0, text, at });
        return;
      }
      case "event_msg":
        switch (p.type) {
          case "task_complete":
            if (cur) {
              cur.endAt = at;
              close();
            }
            return;
          case "turn_aborted":
            if (cur) {
              if (p.reason === "interrupted") cur.stopped = { by: CLIENT, at: at ?? cur.at ?? null };
              cur.endAt = at;
              close();
            }
            return;
          case "token_count":
            if (!p.info) return;
            total = p.info.total_token_usage || total;
            if (cur) {
              cur.calls++;
              cur.total = total;
              cur.last = p.info.last_token_usage || cur.last;
            }
            return;
          case "error":
            if (cur && typeof p.message === "string") {
              cur.failed = p.message.trim().slice(0, 500) || "the service failed the request";
              cur.failedAt = at;
            }
            return;
          case "user_message":
            return person(typeof p.message === "string" ? p.message : "", at);
          case "item_completed": {
            const it = p.item || {};
            if (it.type === "UserMessage") return person((Array.isArray(it.content) ? it.content : []).map((/** @type {any} */ c) => (typeof c?.text === "string" ? c.text : "")).join(""), at);
            // The model's words and thoughts are response items too; a compaction is the `compacted` line.
            if (it.type === "AgentMessage" || it.type === "Reasoning" || it.type === "ContextCompaction") return;
            return effect(itemOf(it), at);
          }
          default:
            return; // task_started, thread_settings_applied, the agent's words said again: bookkeeping
        }
      case "response_item":
        switch (p.type) {
          case "message": {
            if (p.role === "assistant") {
              const text = (Array.isArray(p.content) ? p.content : []).map((/** @type {any} */ c) => (typeof c?.text === "string" ? c.text : "")).join("");
              if (text) said({ type: "text", text }, at);
              return;
            }
            if (p.role !== "user") return; // developer: Codex's instructions to its model
            if (!s.cwd) {
              const told = (Array.isArray(p.content) ? p.content : []).map((/** @type {any} */ c) => (typeof c?.text === "string" ? c.text : "")).join("\n");
              const cwd = /<environment_context>/.test(told) ? inTag(told, "cwd") : null;
              if (cwd?.trim()) s.cwd = cwd.trim();
            }
            const typed = typedOf(p.content);
            if (typed == null) return;
            // The item of the person's own words came first: this is the same message, with its pictures.
            if (cur?.typed && !cur.steps.length && wordsOf(cur.user.content) === wordsOf(typed)) {
              if (Array.isArray(typed)) cur.user = { role: "user", content: typed };
              return;
            }
            return open({ role: "user", content: typed }, at, { typed: true });
          }
          case "reasoning": {
            const text = (Array.isArray(p.summary) ? p.summary : [])
              .map((/** @type {any} */ x) => (typeof x?.text === "string" ? x.text : ""))
              .filter(Boolean)
              .join("\n\n");
            if (text) said({ type: "thinking", thinking: text }, at);
            return;
          }
          case "function_call":
          case "custom_tool_call":
          case "local_shell_call":
            return call(p, at);
          case "function_call_output":
          case "custom_tool_call_output":
            return output(p, at);
          default:
            return; // a sealed compaction, a snapshot: nothing a reader can open
        }
      default:
        return; // world_state, token_usage_record: bookkeeping
    }
  };
  return {
    s,
    /** @param {string} line @returns {any[]} */
    push(line) {
      take(String(line));
      return closed.splice(0);
    },
    /** @returns {any[]} */
    end() {
      close(false);
      return closed.splice(0);
    },
  };
}
/** A whole rollout's text at once → what the reader tells, with `turns` as the list of them. @param {string} text */
export function parseCodexSession(text) {
  const r = codexReader();
  const turns = [];
  for (const raw of String(text).split("\n")) turns.push(...r.push(raw));
  turns.push(...r.end());
  return { ...r.s, turns };
}

/**
 * A rollout's head, for a list: who ran the chat, where, when it began, what it was forked from and where, and the first words
 * the person typed. Read a block at a time until those are known (its first line holds Codex's own instructions and
 * can be long), two megabytes at most. @param {string} file
 */
export function peekCodex(file) {
  /** @type {{ cwd: string | null, firstAt: number | null, preview: string | null, own: boolean, subagent: boolean, forkedFrom: string | null, forkedAt: number | null, sessionId: string | null }} */
  const out = { cwd: null, firstAt: null, preview: null, own: false, subagent: false, forkedFrom: null, forkedAt: null, sessionId: null };
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return out;
  }
  try {
    const r = codexReader();
    const buf = Buffer.alloc(262144);
    let rest = "";
    let pos = 0;
    while (out.preview == null && pos < 2 << 20) {
      const n = readSync(fd, buf, 0, buf.length, pos);
      if (!n) break;
      pos += n;
      const lines = (rest + buf.toString("utf8", 0, n)).split("\n");
      rest = lines.pop() ?? "";
      for (const line of lines) {
        const turns = r.push(line);
        const first = turns[0]?.user ?? null;
        // A turn is known as its first message is: closed, or still open with the reader.
        const typed = first && !turns[0].meta?.own ? wordsOf(first.content) : "";
        if (typed) out.preview = String(scrub(previewOf(typed), true));
        if (out.preview != null) break;
      }
      // A chat too short to close a turn in the block read: its open turn is the one.
      if (out.preview == null && n < buf.length) {
        const [t] = r.end();
        const typed = t && !t.meta?.own ? wordsOf(t.user.content) : "";
        if (typed) out.preview = String(scrub(previewOf(typed), true));
        break;
      }
    }
    const s = r.s;
    Object.assign(out, { cwd: s.cwd, firstAt: s.firstAt, own: s.own, subagent: s.subagent, forkedFrom: s.forkedFrom, forkedAt: s.forkedAt, sessionId: s.sessionId });
  } catch {
  } finally {
    closeSync(fd);
  }
  return out;
}

/**
 * Every chat under the root, for a list: no file is read past its head. A sub-agent's own thread is no chat of the
 * person's and is left out; one Filament ran itself says so (`own`). `mark` is the file's size, the number that grows
 * when the chat does. @param {string} root
 */
export function codexChats(root) {
  return listCodexFiles(expandHome(root)).flatMap((f) => {
    const p = peekCodex(f.path);
    if (p.subagent) return [];
    return [
      {
        id: f.id,
        key: `cx:${f.id}`,
        agentSession: f.id,
        file: f.name,
        cwd: p.cwd,
        preview: p.preview,
        startedAt: p.firstAt ?? f.mtime,
        lastAt: f.mtime,
        bytes: f.size,
        mark: f.size,
        ...(p.own ? { own: true } : {}),
      },
    ];
  });
}

/**
 * How many turns a chat's file had closed before a place in it: where a chat forked from it there stands.
 * @param {string} file @param {number} ordinal
 */
async function turnsBefore(file, ordinal) {
  const r = codexReader({ before: ordinal });
  for await (const { line } of readLines(file)) if (line != null) r.push(line);
  return r.s.turns;
}
/** How many of a chain's turns stand ahead of its file's own: a fork's, from its source (Filament's fork, or taken from the source's file). @param {any} chain */
const aheadOf = (chain) => Number(chain?.meta?.fork?.atTurn ?? chain?.meta?.taken) || 0;
/**
 * The turns a chat had closed before a place in its file (`before`: a line's number), in order, behind those it
 * took itself from the chat it was forked from: what a fork whose file holds its own turns alone stands on, read
 * from the files. The compactions among them go to `places`, each place a count of the turns given.
 * @param {ReadonlyMap<string, { path: string }>} byId  every rollout under the root, by its session's id
 * @param {string} id @param {number} before @param {any[]} places @param {Set<string>} seen
 * @returns {AsyncGenerator<any>}
 */
async function* historyOf(byId, id, before, places, seen) {
  const f = byId.get(id);
  if (!f || seen.has(id)) return;
  seen.add(id);
  const head = peekCodex(f.path);
  let base = 0;
  if (head.forkedFrom && head.forkedAt != null)
    for await (const t of historyOf(byId, head.forkedFrom, head.forkedAt, places, seen)) {
      base++;
      yield t;
    }
  const r = codexReader({ before });
  for await (const { line } of readLines(f.path)) if (line != null) yield* r.push(line);
  // One inside a turn still open at that place belongs to no turn given.
  for (const c of r.s.compactions) if ((c.during ?? c.toTurn) <= r.s.turns) places.push({ ...c, toTurn: base + c.toTurn, ...(c.during ? { during: base + c.during } : {}) });
}

// `only` (a set of chat ids: the session's id) keeps only those. A chat Filament ran itself and a sub-agent's thread
// are passed over, and counted (`passed`). Files import in session-start order, so a chat is in place before one
// forked from it. A missing root is simply nothing to import. A file is read a line at a time and written a turn at a
// time, the server answering other requests in between; `signal` stops it after the turn in hand.
//
// A fork whose file holds its own turns alone (Codex 0.15x) reads whole here, as it does in Codex: where Filament has
// the chat it was forked from, it is Filament's fork of that chat (the same turns, none written twice); where it has
// not, the turns it took are read from that chat's file and written as its own (`meta.taken` says how many), so a
// fork chosen by itself is no chat that begins mid-way. With that file gone too, it is its own turns.
/** @param {{ archive?: any, root?: string, onProgress?: (p: any) => void, only?: Set<string> | null, signal?: AbortSignal | null, dryRun?: boolean, redact?: boolean }} [o] */
export async function importCodex({ archive, root = CODEX_ROOT, onProgress = noop, only = null, signal = null, dryRun = false, redact = true } = {}) {
  if (!archive && !dryRun) throw new Error("importCodex: an archive is required");
  root = expandHome(root);
  const every = listCodexFiles(root);
  /** @type {Map<string, { path: string }>} */
  const byId = new Map(every.map((f) => [f.id, f]));
  const files = every.filter((f) => !only || only.has(f.id)).map((f) => ({ ...f, ...peekCodex(f.path) }));
  files.sort((a, b) => (a.firstAt ?? a.mtime) - (b.firstAt ?? b.mtime) || a.name.localeCompare(b.name));
  const sink = new Sink(archive, { dryRun, redact, agent: AGENT });
  const out = summary({ source: "codex", root, files: files.length, passed: 0, dryRun });
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  onProgress({ step: "codex", message: `${files.length} session file(s)`, percent: 0, done: 0, total: files.length });
  const breathe = breather();
  let done = 0,
    bytesDone = 0;
  for (const f of files) {
    throwIfStopped(signal);
    if (f.own || f.subagent) out.passed++;
    else
      try {
        const r = codexReader();
        const s = r.s;
        const key = `cx:${f.id}`;
        /** @type {any} */
        let chain = null;
        /** @type {ReturnType<Sink["writer"]> | null} */
        let writer = null;
        /** The chain's turns up to this number are its source's, in Filament's fork of it. */
        let after = 0;
        /** How many turns were written ahead of the file's own: those taken from its source's file. */
        let taken = 0;
        /** @type {any[]} the compactions among the turns taken, each place a count of the turns written */
        const places = [];
        /** The first words of the turns taken: what the fork is named after, as Filament names a fork of its own. */
        let opening = "";
        const metaOf = () => ({ import: "codex", sessionId: f.id, file: f.name, gitBranch: s.gitBranch, version: s.version, ...(s.forkedFrom ? { forkedFrom: s.forkedFrom } : {}) });
        const open = async () => {
          const forked = s.forkedFrom != null && s.forkedAt != null;
          if (forked && !sink.known(key)) {
            const source = sink.known(`cx:${s.forkedFrom}`);
            const file = byId.get(String(s.forkedFrom));
            if (source && file) sink.fork(key, source, aheadOf(source) + (await turnsBefore(file.path, Number(s.forkedAt))), { meta: metaOf(), at: s.firstAt ?? f.mtime });
          }
          chain = sink.chain(key, { cwd: s.cwd, meta: metaOf(), startedAt: s.firstAt ?? f.mtime });
          after = Number(sink.known(key)?.meta?.fork?.atTurn) || 0;
          const w = (writer = sink.writer(chain, { after }));
          if (forked && !after)
            for await (const t of historyOf(byId, String(s.forkedFrom), Number(s.forkedAt), places, new Set([f.id]))) {
              w.put(t);
              if (!taken++) opening = wordsOf(t.user.content);
              await breathe();
              throwIfStopped(signal);
            }
        };
        const write = async (/** @type {any[]} */ turns) => {
          for (const t of turns) {
            if (!writer) await open();
            /** @type {ReturnType<Sink["writer"]>} */ (/** @type {unknown} */ (writer)).put(t);
          }
        };
        let read = 0,
          said = 0;
        for await (const { line, pos, long } of readLines(f.path)) {
          if (long) out.long.push({ file: f.name, ...long });
          if (line != null) await write(r.push(line));
          read = pos;
          if (pos - said >= 8 << 20) {
            said = pos;
            onProgress({ step: "codex", message: f.name, percent: pct(bytesDone + pos, totalBytes), done, total: files.length });
          }
          await breathe();
          throwIfStopped(signal);
        }
        await write(r.end());
        out.skipped += s.skipped;
        if (chain && writer) {
          // A place is a count of the turns written; the chat says it as a turn's number.
          const ns = /** @type {ReturnType<Sink["writer"]>} */ (/** @type {unknown} */ (writer)).end();
          const numberOf = (/** @type {number} */ count) => (count ? ns[count - 1] : after);
          const own = s.compactions.map((/** @type {any} */ c) => ({ ...c, toTurn: taken + c.toTurn, ...(c.during ? { during: taken + c.during } : {}) }));
          for (const c of [...places, ...own])
            sink.compaction(chain, {
              fromTurn: 1,
              toTurn: numberOf(c.toTurn),
              text: c.text,
              kind: "plain",
              method: "own",
              detail: { ...(c.during ? { during: numberOf(c.during), cutAfter: c.cutAfter } : {}), by: AGENT, exact: true, how: "agent-own" },
              at: c.at,
            });
          // Named once, as it is made: a name the person gave it since is theirs.
          const title = taken && chain.isNew ? `${opening.slice(0, 48) || "untitled"} (fork at turn ${taken})` : null;
          sink.close(chain, { at: s.lastAt ?? f.mtime, title, mark: read, taken: taken || null });
        } else if (!dryRun) out.empty.push({ key, mark: read });
      } catch (e) {
        if (/** @type {any} */ (e)?.aborted) throw e;
        out.errors.push({ file: f.name, error: String(/** @type {any} */ (e)?.message || e) });
      }
    done++;
    bytesDone += f.size;
    onProgress({ step: "codex", message: f.name, percent: pct(bytesDone, totalBytes), done, total: files.length });
  }
  return Object.assign(out, sink.stats);
}

/** Codex as one of the agents chats come from (sources.js lists them). */
export const codexSource = Object.freeze({
  id: "codex",
  label: AGENT,
  prefix: "cx:",
  /** @param {string} home */
  where: (home) => join(home, ".codex", "sessions"),
  /** @param {string} where */
  found: (where) => {
    try {
      return statSync(where).isDirectory();
    } catch {
      return false;
    }
  },
  /** @param {string} where */
  chats: (where) => codexChats(where),
  /** @param {{ archive: any, where: string, only: Set<string> | null, onProgress?: (p: any) => void, signal?: AbortSignal | null }} o */
  run: ({ archive, where, only, onProgress, signal }) => importCodex({ archive, root: where, only, onProgress, signal }),
});

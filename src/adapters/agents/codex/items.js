// @ts-check
// Codex's side of a turn, read (HarnessV3-ACP AC2-1): the app-server's notifications — items started and completed,
// their deltas, the plan, the token usage — become the agent events every bridge speaks (`text`, `thought`, `tool`,
// `plan`, `subagent`), so app/agent-run.js draws a Codex turn as it draws Claude's and Cursor's. A sub-agent is a
// thread of its own (`collabAgentToolCall`): the child thread's items reach the card of the call that spawned it.

import { isAbsolute, join } from "node:path";
import { changeInput, commandCall, fileCall, itemCall, itemFailed, itemResult } from "../../../core/codex-items.js";
import { saysCache } from "../../../core/cache-facts.js";

/** A plan step's status, in the agent events' words. */
const STEP_STATUS = Object.freeze({ pending: "pending", inProgress: "in_progress", completed: "completed" });
/** The collaboration calls that are not a sub-agent's own work, by the words their card reads. */
const COLLAB_TITLES = Object.freeze({
  wait: "Wait for agents",
  closeAgent: "Close agent",
  interruptAgent: "Interrupt agent",
  listAgents: "List agents",
  sendInput: "Message agent",
  sendMessage: "Message agent",
  followupTask: "Follow-up task",
  resumeAgent: "Resume agent",
});
/** The collaboration calls that hand a sub-agent more work: a card of their own once its last one has ended. */
const NEW_WORK = new Set(["sendInput", "sendMessage", "followupTask", "resumeAgent"]);
/** A child thread's turn's end, in the agent events' words for a sub-agent's end. */
const CHILD_END = Object.freeze({ completed: "completed", interrupted: "cancelled", failed: "failed" });
/** A sub-agent's state as a wait reports it, in the same words; the states of one still running say nothing. */
const AGENT_END = Object.freeze({ completed: "completed", interrupted: "cancelled", errored: "failed", shutdown: "cancelled", notFound: "failed" });
/** Items that are not the agent's work: the person's own message, a hook's prompt, a tool's output on its own, and the
 *  marks of a review, which only `review/start` begins (Filament never sends it). */
const QUIET = new Set(["userMessage", "hookPrompt", "functionCallOutput", "enteredReviewMode", "exitedReviewMode"]);
/** The token counts Codex reports, each a running total for its thread. */
const FIELDS = /** @type {const} */ (["totalTokens", "inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens", "reasoningOutputTokens"]);

/** @typedef {Record<(typeof FIELDS)[number], number>} Breakdown */

/** @param {any} a @param {any} b @returns {Breakdown} */
const minus = (a, b) => /** @type {Breakdown} */ (Object.fromEntries(FIELDS.map((k) => [k, Math.max(0, (Number(a?.[k]) || 0) - (Number(b?.[k]) || 0))])));
/** @param {Breakdown} a @param {Breakdown} b @returns {Breakdown} */
const plus = (a, b) => /** @type {Breakdown} */ (Object.fromEntries(FIELDS.map((k) => [k, (a[k] || 0) + (b[k] || 0)])));

/**
 * Added and removed lines of one file change: a new file's are all added, a deleted one's all removed, an update's
 * are its unified diff's own. @param {any} change
 */
export function changeLines(change) {
  const diff = String(change?.diff ?? "");
  const kind = String(change?.kind?.type || "");
  const lines = diff ? diff.replace(/\n$/, "").split("\n").length : 0;
  if (kind === "add") return { added: lines, removed: 0 };
  if (kind === "delete") return { added: 0, removed: lines };
  let added = 0;
  let removed = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  return { added, removed };
}

/**
 * One file change as a unified diff a reader can draw: an update's is Codex's own; a new or deleted file's is its
 * content, every line added or removed. @param {any} change
 */
export function changeDiff(change) {
  const path = String(change?.kind?.move_path || change?.path || "");
  const diff = String(change?.diff ?? "");
  const kind = String(change?.kind?.type || "");
  if (kind !== "add" && kind !== "delete") return diff;
  const mark = kind === "add" ? "+" : "-";
  const body = diff ? diff.replace(/\n$/, "").split("\n").map((l) => mark + l).join("\n") : "";
  return `${kind === "add" ? "--- /dev/null" : `--- ${path}`}\n${kind === "add" ? `+++ ${path}` : "+++ /dev/null"}\n${body}`;
}

/** What Codex's wording leaves outside quotes: the characters no shell reads more into. */
const PLAIN_WORD = /[A-Za-z0-9_+\-./:@\],=%^]/;

/**
 * The words of a command as Codex ran it, read back from how Codex words it: its argv joined as a POSIX shell would
 * quote it (Rust's shlex) — a word in '…' as it is, in "…" with a backslash before `"`, `\`, `$` and a backtick, bare
 * when it holds plain characters alone, the pieces of one word side by side. Null for any other wording: a line some
 * shell is to read is not an argv, and reading it as one would guess at that shell.
 * @param {string} command @returns {string[] | null}
 */
function argvOf(command) {
  /** @type {string[]} */
  const out = [];
  /** @type {string | null} */
  let w = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === " ") {
      if (w !== null) out.push(w);
      w = null;
    } else if (c === "'") {
      const j = command.indexOf("'", i + 1);
      if (j < 0) return null;
      w = (w ?? "") + command.slice(i + 1, j);
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      let inner = "";
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === "\\" && /["\\$`]/.test(command[j + 1] ?? "")) j++;
        inner += command[j];
      }
      if (j >= command.length) return null;
      w = (w ?? "") + inner;
      i = j;
    } else if (PLAIN_WORD.test(c)) w = (w ?? "") + c;
    else return null;
  }
  if (w !== null) out.push(w);
  return out;
}

/** PowerShell's own switches Codex may put before its script: the bare ones, and the one that takes a value. */
const PS_BARE = new Set(["-noprofile", "-nop", "-nologo", "-nol", "-noninteractive", "-noni"]);
const PS_VALUED = new Set(["-executionpolicy", "-ep", "-ex"]);

/**
 * The script of a command Codex runs through PowerShell, and the program it names (HarnessV4_Tasks C10): on Windows
 * Codex wraps every command as `powershell.exe -Command <script>`, and judged as that line each was a call to one
 * program named PowerShell — none read as only reading, and an always-allow learned from it covered them all. `-Command`
 * takes every word after it, joined by spaces, as PowerShell itself joins them. Null when the command is no such
 * wrapper: a script file, an encoded one, a script read from input, or a switch not known here.
 * @param {string} command @returns {{ program: string, script: string } | null}
 */
export function powershellCommand(command) {
  const argv = argvOf(String(command ?? ""));
  if (!argv || argv.length < 3 || !/^(powershell|pwsh)(\.exe)?$/i.test(argv[0].split(/[\\/]/).pop() || "")) return null;
  for (let k = 1; k < argv.length; k++) {
    const word = argv[k].toLowerCase();
    if (word === "-command" || word === "-c") {
      const script = argv.slice(k + 1).join(" ");
      return script.trim() && script.trim() !== "-" ? { program: argv[0], script } : null;
    }
    if (PS_VALUED.has(word)) k++;
    else if (!PS_BARE.has(word)) return null;
  }
  return null;
}

/**
 * Whether every action of a command only reads (a file, a folder's listing, a search): what a read-only policy lets
 * Codex run. A command Codex cannot read for what it does is not one. @param {any} actions
 */
export function readsOnly(actions) {
  const list = Array.isArray(actions) ? actions : [];
  return list.length > 0 && list.every((a) => a?.type === "read" || a?.type === "listFiles" || a?.type === "search");
}

/**
 * The files a command reads, as Codex reads it (its `read` actions), each where the command ran: Codex reads files
 * with its shell, and a command that reads more than one, or does more besides, is a command's card, which names none
 * (c-news: the turn sees each once the command completed). @param {any} item @returns {string[]}
 */
function readsOf(item) {
  const cwd = typeof item?.cwd === "string" ? item.cwd : "";
  const actions = Array.isArray(item?.commandActions) ? item.commandActions : [];
  return actions.filter((a) => a?.type === "read" && typeof a.path === "string" && a.path).map((a) => (cwd && !isAbsolute(a.path) ? join(cwd, a.path) : String(a.path)));
}

/** A thread's token counts for a turn: where they stood when the turn began, and where they are now; `said`: a report of its carried a cache count. */
/** @typedef {{ base: Breakdown, total: Breakdown, last: Breakdown, window: number | null, said: boolean }} ThreadUsage */

/**
 * The reader for one Codex turn. `read(method, params)` takes every notification of the turn's thread and of the
 * sub-agent threads it spawned (`owns` says which those are); `ended` settles with the turn as Codex completed it.
 * @param {object} o
 * @param {string} o.threadId  the turn's own thread
 * @param {any} o.out  the turn's result being built: its text, tools, lines, usage, context, title, model
 * @param {(ev: any) => void} o.onEvent
 * @param {string[]} o.notes  the turn's record notes
 * @param {{ bridgePlan: (entries: any[]) => boolean }} o.turn  the live turn: a plan also goes to the client's task list
 * @param {string} [o.version]  the app-server's version, named where Codex sent something Filament does not draw
 * @param {() => void} [o.onCompacted]  the thread compacted its context: what was said ahead of its prompts may be
 *   summarised away (HarnessV3-ACP AC4-1)
 */
export function createCodexReader({ threadId, out, onEvent, notes, turn, version = "", onCompacted = () => {} }) {
  /** The turn's id, once Codex has said it (`turn/start`'s answer, or `turn/started`). @type {string | null} */
  let turnId = null;
  /** What each item is, by id: its type, the words that came as deltas, and for a file change its cards and its
   *  files, each as the loop's call that writes it — `write` a new file, `edit` any other — which the session's switch
   *  judges, its input what the change does (`changeInput`). */
  /** @type {Map<string, { type: string, streamed: string, said: string, calls: string[], files: { path: string, tool: "write" | "edit", input: any }[] }>} */
  const items = new Map();
  /** @param {string} id @param {string} type @param {string[]} [calls] */
  const keep = (id, type, calls = []) => items.set(id, { type, streamed: "", said: "", calls, files: [] });
  /** The items an approval's answer kept from running, by id, and how (`notRun`). @type {Map<string, { how: string, why: string }>} */
  const kept = new Map();
  /** Each child thread's sub-agent card: the call that spawned it (or the last that gave it work), and its newest
   *  message's words, which are what it reports. */
  /** @type {Map<string, { card: string, ended: boolean, words: string, message: string }>} */
  const children = new Map();
  /** The sub-agent calls whose thread is not known yet, oldest first. @type {string[]} */
  const unmatched = [];
  /** A child thread's events that came before the call that spawned it was matched to it. */
  /** @type {Map<string, { method: string, params: any }[]>} */
  const early = new Map();
  /** @type {Map<string, ThreadUsage>} */
  const usage = new Map();
  const said = new Set();
  /** @type {(turn: any) => void} */
  let settle = () => {};
  /** @type {Promise<any>} */
  const ended = new Promise((resolve) => (settle = resolve));

  /** @param {string} key @param {string} note */
  const sayOnce = (key, note) => {
    if (said.has(key)) return;
    said.add(key);
    notes.push(note);
  };

  /** The sub-agent card whose thread this is, or null for the turn's own. @param {string} tid */
  const subOf = (tid) => (tid === threadId ? null : children.get(tid)?.card || null);

  /** @param {string | null} sub @param {any} ev */
  const emit = (sub, ev) => onEvent(sub ? { ...ev, subagent: sub } : ev);

  /** @param {string | null} sub @param {any} call @param {string} id @param {Record<string, unknown>} [more] */
  const callEvent = (sub, call, id, more = {}) => {
    const rec = { id, title: call.title, kind: call.kind, status: "in_progress" };
    if (!sub) out.tools.push(rec);
    emit(sub, { type: "tool", phase: "call", id, toolName: call.toolName, title: call.title, kind: call.kind, status: "in_progress", rawInput: call.rawInput, locations: call.locations || [], ...more });
  };
  /**
   * How a declined item's card ends: as the approval's answer kept it from running, the bridge's word, which the run
   * says in its words; else Codex declined it alone. @param {string} id @param {string} words
   */
  const declined = (id, words) => {
    const k = kept.get(id);
    return k ? { notRun: k.how, ...(k.why ? { why: k.why } : {}) } : { content: [{ type: "content", content: { type: "text", text: words } }] };
  };
  /** @param {string | null} sub @param {string} id @param {boolean} ok @param {Record<string, unknown>} [more] */
  const endEvent = (sub, id, ok, more = {}) => {
    const status = ok ? "completed" : "failed";
    const rec = out.tools.find((/** @type {any} */ t) => t.id === id);
    if (rec) rec.status = status;
    emit(sub, { type: "tool", phase: "update", id, status, ...more });
  };

  /** A sub-agent card that starts for a child thread. @param {string} card @param {any} item @param {string} words */
  const openSub = (card, item, words) => {
    emit(subOf(String(item.senderThreadId || threadId)), { type: "subagent", state: "spawned", id: card, name: String(item.model || ""), description: words });
  };
  /** A child's card ends, once. @param {string} tid @param {string} how @param {string} [report] */
  const endChild = (tid, how, report) => {
    const c = children.get(tid);
    if (!c || c.ended) return;
    c.ended = true;
    if (report && !c.words) emit(c.card, { type: "text", text: report });
    onEvent({ type: "subagent", state: how, id: c.card });
  };
  /** A child thread is known: its card, and the events that came before. @param {string} tid @param {string} card */
  const match = (tid, card) => {
    children.set(tid, { card, ended: false, words: "", message: "" });
    const waiting = early.get(tid) || [];
    early.delete(tid);
    for (const m of waiting) read(m.method, m.params);
  };

  /** @param {any} item @param {string} tid */
  const collabStarted = (item, tid) => {
    const tool = String(item.tool || "");
    const receivers = (Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []).map(String);
    if (tool === "spawnAgent" || (NEW_WORK.has(tool) && receivers.length === 1 && children.get(receivers[0])?.ended)) {
      keep(item.id, "subagent");
      openSub(item.id, item, String(item.prompt || ""));
      if (receivers.length) match(receivers[0], item.id);
      else unmatched.push(item.id);
      return;
    }
    keep(item.id, "collab");
    const n = receivers.length;
    const title = /** @type {Record<string, string>} */ (COLLAB_TITLES)[tool] || tool || "Agents";
    callEvent(subOf(tid), { toolName: "", kind: "other", title: n > 1 ? `${title} (${n})` : title, rawInput: item.prompt ? { prompt: String(item.prompt) } : {} }, item.id);
  };
  /** @param {any} item @param {string} tid */
  const collabCompleted = (item, tid) => {
    const own = items.get(item.id);
    const receivers = (Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds : []).map(String);
    if (own?.type === "subagent") {
      const at = unmatched.indexOf(item.id);
      if (at >= 0 && receivers.length) {
        unmatched.splice(at, 1);
        match(receivers[0], item.id);
      }
      // A spawn that failed left no thread to wait for: its card ends with it, and no thread is matched to it.
      if (String(item.status) === "failed" && !receivers.length) {
        if (at >= 0) unmatched.splice(at, 1);
        onEvent({ type: "subagent", state: "failed", id: item.id });
      }
      return;
    }
    // A wait reports how each agent it waited for stands: the ones that ended end their cards, with their words.
    for (const [child, state] of Object.entries(item.agentsStates || {})) {
      const how = /** @type {Record<string, string>} */ (AGENT_END)[String(/** @type {any} */ (state)?.status || "")];
      if (how) endChild(child, how, String(/** @type {any} */ (state)?.message || ""));
    }
    if (own) endEvent(subOf(tid), item.id, !itemFailed(item));
  };

  /**
   * A file change's files, a card each: those without one get it, and each file's change is its newest. Codex names
   * them as the item starts, as its patch grows (`item/fileChange/patchUpdated`) and as it ends.
   * @param {string | null} sub @param {string} id @param {any} changes
   */
  const addChanges = (sub, id, changes) => {
    const own = items.get(id);
    const list = Array.isArray(changes) ? changes : [];
    if (!own) return;
    for (let i = 0; i < list.length; i++) {
      if (i < own.files.length) {
        own.files[i].input = changeInput(list[i]);
        continue;
      }
      own.calls.push(`${id}#${i}`);
      own.files.push({ path: String(list[i]?.kind?.move_path || list[i]?.path || ""), tool: list[i]?.kind?.type === "add" ? "write" : "edit", input: changeInput(list[i]) });
      callEvent(sub, fileCall(list[i]), `${id}#${i}`);
    }
  };

  /** @param {any} item @param {string} tid */
  const started = (item, tid) => {
    const sub = subOf(tid);
    const id = String(item?.id || "");
    if (!id || items.has(id)) return;
    const type = String(item.type || "");
    if (QUIET.has(type)) return;
    if (type === "agentMessage" || type === "reasoning" || type === "plan" || type === "contextCompaction") {
      keep(id, type);
      if (type === "contextCompaction" && !sub) onEvent({ type: "compaction", id, state: "started" });
      return;
    }
    if (type === "commandExecution") {
      keep(id, type, [id]);
      const reads = readsOf(item);
      return callEvent(sub, commandCall(item), id, reads.length ? { reads } : {});
    }
    if (type === "fileChange") {
      keep(id, type);
      return addChanges(sub, id, item.changes);
    }
    if (type === "collabAgentToolCall") return collabStarted(item, tid);
    if (type === "subAgentActivity") return;
    const call = itemCall(item);
    if (call) {
      keep(id, type, [id]);
      return callEvent(sub, call, id);
    }
    keep(id, type);
    sayOnce(`item:${type}`, `codex: Codex sent an item Filament does not draw yet ("${type}", app-server ${version || "?"}); its work is not on the turn's cards`);
  };

  /** @param {any} item @param {string} tid */
  const completed = (item, tid) => {
    const sub = subOf(tid);
    const id = String(item?.id || "");
    if (!id) return;
    const type = String(item.type || "");
    if (QUIET.has(type)) return;
    if (!items.has(id) && type !== "subAgentActivity") started(item, tid);
    const own = items.get(id);
    if (type === "agentMessage") {
      // Words that came whole, without deltas.
      if (own && !own.streamed && item.text) words(sub, "text", String(item.text), id);
      return;
    }
    if (type === "reasoning") {
      const summary = (Array.isArray(item.summary) ? item.summary : []).join("\n\n");
      if (own && !own.streamed && summary) words(sub, "thought", summary, id);
      return;
    }
    if (type === "plan") {
      if (own && !own.streamed && item.text) words(sub, "text", String(item.text), id);
      return;
    }
    if (type === "commandExecution") {
      const output = String(item.aggregatedOutput ?? "");
      const ok = item.status === "completed" && (item.exitCode == null || Number(item.exitCode) === 0);
      endEvent(sub, id, ok, {
        ...(item.exitCode != null ? { exitCode: Number(item.exitCode) } : {}),
        ...(item.status === "declined" && !output ? declined(id, "Declined: Codex did not run it.") : { content: [{ type: "content", content: { type: "text", text: output } }] }),
      });
      return;
    }
    if (type === "fileChange") {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const ok = item.status === "completed";
      addChanges(sub, id, changes);
      const calls = own?.calls || [];
      changes.forEach((/** @type {any} */ c, /** @type {number} */ i) => {
        const call = calls[i] || `${id}#${i}`;
        if (ok && !sub) {
          const n = changeLines(c);
          out.linesAdded = (out.linesAdded || 0) + n.added;
          out.linesRemoved = (out.linesRemoved || 0) + n.removed;
        }
        endEvent(sub, call, ok, {
          diffText: changeDiff(c),
          ...(ok ? {} : item.status === "declined" ? declined(id, "Declined: Codex did not change it.") : { content: [{ type: "content", content: { type: "text", text: "The change could not be applied." } }] }),
        });
      });
      return;
    }
    if (type === "collabAgentToolCall") return collabCompleted(item, tid);
    if (type === "subAgentActivity") {
      const child = String(item.agentThreadId || "");
      if (!children.has(child) && unmatched.length) match(child, /** @type {string} */ (unmatched.shift()));
      if (item.kind === "completed") endChild(child, "completed");
      else if (item.kind === "interrupted") endChild(child, "cancelled");
      return;
    }
    // Codex compacted its own context: said once on the record, and the run's mark each time. Codex also sends the
    // deprecated `thread/compacted` for it, which is not read: one compaction, one mark.
    if (type === "contextCompaction") {
      if (!sub) {
        sayOnce("compacted", "codex: Codex compacted its context during this turn");
        onCompacted();
        onEvent({ type: "compaction", id, state: "completed" });
      }
      return;
    }
    if (own?.calls.length) endEvent(sub, id, !itemFailed(item), { content: itemResult(item), ...(type === "imageGeneration" && item.savedPath ? { file: String(item.savedPath) } : {}) });
  };

  /**
   * Words or thoughts, the turn's own or a sub-agent's. Codex names no model call, so the turn's own carry none and
   * a round opens where words follow calls; they name their item, so words steered in (AC3-1) split the message
   * Codex was saying from the next one. A sub-agent's name their message, whose words are what it reports.
   * @param {string | null} sub @param {"text" | "thought"} kind @param {string} text @param {string} item
   */
  const words = (sub, kind, text, item) => {
    if (!text) return;
    if (!sub) {
      if (kind === "text") out.text += text;
      return onEvent({ type: kind, text, itemId: item });
    }
    const c = [...children.values()].find((x) => x.card === sub);
    if (c && kind === "text") {
      if (c.message !== item) c.words = "";
      c.message = item;
      c.words += text;
    }
    emit(sub, { type: kind, text, messageId: item });
  };

  /** @param {any} params */
  const tokens = (params) => {
    const tid = String(params.threadId || "");
    const t = params.tokenUsage || {};
    const was = usage.get(tid);
    // A thread's first report this turn says where it stood before the turn's first model call: its total less that
    // call's own.
    const base = was ? was.base : minus(t.total, t.last);
    // Whether a report carried a cache count (core/cache-facts.js): one of the thread's that did says its counts are counted.
    const saidBy = (/** @type {any} */ b) => saysCache(b?.cachedInputTokens, b?.cacheWriteInputTokens);
    const now = { base, total: minus(t.total, {}), last: minus(t.last, {}), window: Number(t.modelContextWindow) || was?.window || null, said: !!was?.said || saidBy(t.total) || saidBy(t.last) };
    usage.set(tid, now);
    // The turn's own thread as its newest model call left it: the meter while Codex works (HarnessV3-ACP AC3-5), and
    // that call's prompt as the provider counted it — its input holds what it read from the cache, as the turn's does —
    // where its report carried a cache count: a call that said none is no request of the Cache instrument's.
    if (tid === threadId)
      onEvent({
        type: "usage",
        usage: { used: now.last.totalTokens, size: now.window },
        ...(saidBy(t.last) ? { call: { input: Math.max(0, now.last.inputTokens - now.last.cachedInputTokens), cacheRead: now.last.cachedInputTokens, cacheWrite: now.last.cacheWriteInputTokens } } : {}),
      });
  };

  /**
   * One notification of the turn's threads.
   * @param {string} method @param {any} params
   */
  function read(method, params) {
    const p = params || {};
    const tid = String(p.threadId || p.thread?.id || "");
    if (tid !== threadId && !children.has(tid)) {
      // A child thread heard before its spawn call was matched: kept until it is, or matched now when Codex names
      // its parent and one spawn waits for its thread.
      if (method === "thread/started" && String(p.thread?.parentThreadId || "") && unmatched.length === 1) {
        match(tid, /** @type {string} */ (unmatched.shift()));
        return;
      }
      const list = early.get(tid) || [];
      list.push({ method, params });
      early.set(tid, list);
      return;
    }
    const sub = subOf(tid);
    switch (method) {
      case "turn/started":
        if (!sub) turnId ||= String(p.turn?.id || "");
        return;
      case "item/started":
        return started(p.item, tid);
      case "item/completed":
        return completed(p.item, tid);
      case "item/agentMessage/delta": {
        const own = items.get(String(p.itemId || ""));
        if (own) own.streamed += String(p.delta || "");
        return words(sub, "text", String(p.delta || ""), String(p.itemId || ""));
      }
      case "item/reasoning/summaryTextDelta":
      case "item/reasoning/textDelta": {
        const own = items.get(String(p.itemId || ""));
        const kind = method.endsWith("summaryTextDelta") ? "summary" : "text";
        // An item's reasoning comes as its summary or as its whole text: the first kind heard is the one drawn.
        if (own && own.said && own.said !== kind) return;
        if (own) {
          own.said = kind;
          own.streamed += String(p.delta || "");
        }
        return words(sub, "thought", String(p.delta || ""), String(p.itemId || ""));
      }
      case "item/reasoning/summaryPartAdded": {
        const own = items.get(String(p.itemId || ""));
        if (own && own.streamed && own.said !== "text") words(sub, "thought", "\n\n", String(p.itemId || ""));
        return;
      }
      case "item/commandExecution/outputDelta":
        return emit(sub, { type: "tool", phase: "update", id: String(p.itemId || ""), status: "in_progress", terminalOutput: { output: String(p.delta || "") } });
      case "item/fileChange/patchUpdated":
        return addChanges(sub, String(p.itemId || ""), p.changes);
      case "turn/plan/updated": {
        const entries = (Array.isArray(p.plan) ? p.plan : [])
          .filter((/** @type {any} */ s) => s && typeof s.step === "string" && s.step.trim())
          .map((/** @type {any} */ s) => ({ content: s.step, status: /** @type {Record<string, string>} */ (STEP_STATUS)[s.status] || "pending", priority: "medium" }));
        if (!entries.length) return;
        // A sub-agent's plan is its own, never the turn's checklist or the client's.
        return emit(sub, sub ? { type: "plan", entries } : { type: "plan", entries, bridged: turn.bridgePlan(entries) || undefined });
      }
      case "thread/tokenUsage/updated":
        return tokens(p);
      case "thread/name/updated":
        if (!sub && typeof p.threadName === "string" && p.threadName.trim()) {
          out.title = p.threadName.trim().slice(0, 120);
          onEvent({ type: "info", title: out.title });
        }
        return;
      case "model/rerouted":
        if (!sub) {
          out.agentModel = String(p.toModel || out.agentModel || "");
          // Why another model answers, for whoever says so (app/acp-turn.js `weighModel`).
          if (p.toModel) out.rerouted = true;
          sayOnce(`reroute:${p.toModel}`, `codex: Codex moved this turn from ${p.fromModel} to ${p.toModel}${p.reason ? ` (${p.reason})` : ""}`);
        }
        return;
      case "error":
        if (p.willRetry) sayOnce(`retry:${p.error?.message}`, `codex: ${String(p.error?.message || "an error")} — Codex is trying again`);
        else if (!sub) out.error = p.error || null;
        return;
      case "warning":
        sayOnce(`warn:${p.message}`, `codex: ${String(p.message || "")}`);
        return;
      case "turn/completed": {
        if (sub) {
          const how = /** @type {Record<string, string>} */ (CHILD_END)[String(p.turn?.status || "")];
          if (how) endChild(tid, how, p.turn?.error?.message ? String(p.turn.error.message) : "");
          return;
        }
        // Only this turn's end: an earlier turn of the thread (one a stop left behind) may still end after it began.
        if (!turnId || String(p.turn?.id || "") !== turnId) return;
        settle(p.turn || {});
        return;
      }
      default:
        return;
    }
  }

  return {
    read,
    ended,
    threadId,
    /** The turn's id, once known. @param {string} [id] */
    turnId(id) {
      if (id) turnId ||= id;
      return turnId;
    },
    /** Whether a notification is this turn's: its thread's, or a sub-agent thread's it spawned. @param {string} tid @param {any} params */
    owns(tid, params) {
      if (!tid) return false;
      if (tid === threadId || children.has(tid) || early.has(tid)) return true;
      const parent = String(params?.thread?.parentThreadId || "");
      return !!parent && (parent === threadId || children.has(parent));
    },
    /** The items a file change approval is for, as their cards say them. @param {string} itemId */
    itemOf(itemId) {
      return items.get(itemId) || null;
    },
    /**
     * An item the approval's answer keeps from running (HarnessV3-ACP AC3-2): Codex ends it as declined, and its card
     * then says how — the person declined it, something refused it (`why`), or the turn stopped while it was asked.
     * @param {string} itemId @param {"declined" | "refused" | "stopped"} how @param {string} why
     */
    notRun(itemId, how, why) {
      kept.set(itemId, { how, why });
    },
    /**
     * The turn's usage, every thread's together (what was billed), and its context: the turn's own thread's last
     * model call against its window. Null when Codex reported none.
     */
    usage() {
      if (!usage.size) return { usage: null, context: null };
      /** @type {Breakdown} */
      let sum = minus({}, {});
      for (const u of usage.values()) sum = plus(sum, minus(u.total, u.base));
      const own = usage.get(threadId);
      return {
        usage: {
          input: Math.max(0, sum.inputTokens - sum.cachedInputTokens),
          output: sum.outputTokens,
          cacheRead: sum.cachedInputTokens,
          cacheWrite: sum.cacheWriteInputTokens,
          total: sum.totalTokens || null,
          ...([...usage.values()].some((u) => u.said) ? { cacheSeen: true } : {}),
        },
        context: own ? { used: own.last.totalTokens, size: own.window, cacheRead: own.last.cachedInputTokens } : null,
      };
    },
    /** Sub-agent work that never reached a card: a child thread no spawn call was matched to. */
    unmatched() {
      return early.size;
    },
    /** Whether a sub-agent call waits for its thread: a thread nobody owns may be its. */
    expecting() {
      return unmatched.length > 0;
    },
  };
}

// @ts-check
// Claude Code's chats: ~/.claude/projects/<slug>/<sessionId>.jsonl, one file per chat → one chain per chat.
//
// Format observed on disk (keys and shapes only). Line types: user, assistant, system, attachment, queue-operation,
// file-history-snapshot, file-history-delta, mode, permission-mode, cost-state, atis-latch, agent-name, last-prompt
// {lastPrompt, leafUuid}, ai-title {aiTitle}, custom-title {customTitle}, continued-in {continuedInSessionId}, summary
// {summary, leafUuid} (older). user/assistant lines: uuid, parentUuid, sessionId (the file's name; a chat resumed
// from another begins with that chat's lines, its id still on them), timestamp (ISO), cwd,
// gitBranch, version, isSidechain, isMeta, isCompactSummary, isVisibleInTranscriptOnly, isApiErrorMessage, requestId,
// toolUseResult, message { role, content, id, model, stop_reason, usage, … }. Assistant content arrives one block per
// line (text | thinking | tool_use); lines of one API response share message.id and its usage. User content is a
// string or [text | image | tool_result] blocks. Sub-agent transcripts live in nested <uuid>/ folders. A file can be
// gigabytes: it is read a line at a time (sink.js).
//
// A chat is translated, not copied: what Claude Code keeps as a user line is often not what the person typed, and
// each such line becomes what Filament keeps for the same thing in a chat of its own, so the chat reads in the
// harness as one made there (the plan's §7; `claudeCodeReader` says each rule).
import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { desktopVisualOf, messageKind, ownTurnText, textOfMessage } from "../../../core/messages.js";
import { Sink, breather, expandHome, inTag, noop, parseJson, pct, previewOf, readLines, scrub, shapeTurn, summary, taskOfNotice, throwIfStopped, toMs, turnFacts, unansweredLine } from "./sink.js";

export const CONTINUATION_PREFIX = "This session is being continued from a previous conversation";
export const CLAUDE_CODE_ROOT = join(homedir(), ".claude", "projects");
/** The agent, as Filament names it on a turn it began by itself, on a compaction it made, and in a fork's title (IM-61). */
const AGENT = "Claude Code";
/** The agent's id where a turn was stopped in it (`stopped.by`); the chat and its turns are the harness's (IM-58). */
const CLIENT = "claude-code";

// Session files directly under <root>/<slug>/ (nested <uuid>/ folders hold sub-agent transcripts and are not sessions).
export function listClaudeCodeFiles(root) {
  const out = [];
  let slugs;
  try {
    slugs = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const d of slugs) {
    if (!d.isDirectory()) continue;
    const dir = join(root, d.name);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".jsonl")) continue;
      const path = join(dir, e.name);
      let st;
      try {
        st = statSync(path);
      } catch {
        continue;
      }
      out.push({
        path,
        name: e.name,
        stem: e.name.slice(0, -6),
        slug: d.name,
        mtime: st.mtimeMs,
        size: st.size,
      });
    }
  }
  return out;
}
/** Is this user line a message the model was sent (and no sub-agent's)? @param {any} o */
const spoken = (o) =>
  !o.isSidechain && !o.isMeta && !(o.isVisibleInTranscriptOnly && !o.isCompactSummary) && o.message && typeof o.message === "object";

/** What stands between a tag's two ends, or null. @param {string} text @param {string} tag */
/** The line Claude Code writes where the person stopped a turn. */
const INTERRUPTED = /^\[Request interrupted by user[^\]]*\]$/;

/**
 * What a user line that is no tool result is, by what Claude Code wrapped its text in:
 *   summary — the summary a compaction left (flagged, or by its opening words);
 *   command — a slash command the person typed (`<command-name>`, its arguments beside it): `text` is it as typed;
 *   output  — what a command Claude Code ran itself printed (`<local-command-stdout>`);
 *   task    — a background task's end, which Claude Code hands its model as a message (`<task-notification>`);
 *   stopped — the person stopped the turn (the bracketed line, alone);
 *   typed   — the person's own words.
 * @param {any} o  the line @param {any} msg  its message
 * @returns {{ kind: "summary" | "command" | "output" | "typed", text: string } | { kind: "task", task: { id: string, status: string, summary: string } } | { kind: "stopped" }}
 */
function userLineKind(o, msg) {
  const text = textOfMessage(msg).trim();
  if (o.isCompactSummary === true || text.startsWith(CONTINUATION_PREFIX)) return { kind: "summary", text };
  if (/^<command-(?:name|message)>/.test(text)) {
    const name = (inTag(text, "command-name") || "").trim();
    const args = (inTag(text, "command-args") || "").trim();
    if (name) return { kind: "command", text: `${name.startsWith("/") ? "" : "/"}${name}${args ? ` ${args}` : ""}` };
  }
  if (/^<local-command-std(?:out|err)>/.test(text))
    return { kind: "output", text: (inTag(text, "local-command-stdout") ?? inTag(text, "local-command-stderr") ?? "").trim() };
  if (text.startsWith("<task-notification>")) return { kind: "task", task: taskOfNotice(text) };
  const blocks = Array.isArray(msg.content) ? msg.content : null;
  if (blocks ? blocks.length > 0 && blocks.every((/** @type {any} */ b) => b?.type === "text" && INTERRUPTED.test(String(b.text).trim())) : INTERRUPTED.test(text))
    return { kind: "stopped" };
  return { kind: "typed", text };
}

// The first 128 KB of a session file: cwd, the first timestamp and the first words the person typed — enough to
// order sessions by start and to name one on a list without reading it.
/** @param {string} file */
export function peekClaudeCode(file) {
  /** @type {{ cwd: string | null, firstAt: number | null, preview: string | null }} */
  const out = { cwd: null, firstAt: null, preview: null };
  let fd;
  try {
    fd = openSync(file, "r");
  } catch {
    return out;
  }
  try {
    const buf = Buffer.alloc(131072);
    const n = readSync(fd, buf, 0, buf.length, 0);
    for (const line of buf.toString("utf8", 0, n).split("\n")) {
      const o = parseJson(line);
      if (!o || typeof o !== "object") continue;
      if (typeof o.cwd === "string" && !out.cwd) out.cwd = o.cwd;
      const at = toMs(o.timestamp);
      if (at != null && (out.firstAt == null || at < out.firstAt)) out.firstAt = at;
      if (out.preview == null && o.type === "user" && spoken(o) && messageKind(o.message, "user") !== "tool_result") {
        const said = userLineKind(o, o.message);
        const text = said.kind === "typed" || said.kind === "command" ? previewOf(said.text) : "";
        if (text) out.preview = String(scrub(text, true));
      }
      if (out.cwd && out.firstAt != null && out.preview != null) break;
    }
  } catch {
  } finally {
    closeSync(fd);
  }
  return out;
}

/** An assistant message as the archive keeps one: its role and its blocks, none of the response's envelope. @param {any[]} content */
const reply = (content) => ({ role: "assistant", content });

/**
 * A turn's numbers, as the file tells them (sink.js `turnFacts`). The last request held what it read: its input and
 * both sides of the cache. Null for a turn no response was written for.
 * @param {any} t  the reader's open turn
 */
function factsOf(t) {
  if (!t.calls && !t.failed) return null;
  const last = t.last || {};
  const ends = t.items.map((/** @type {any} */ i) => i.at).filter((/** @type {any} */ v) => typeof v === "number");
  return turnFacts({
    calls: t.calls,
    model: t.model ?? null,
    tokens: t.tokens,
    held: (Number(last.input_tokens) || 0) + (Number(last.cache_read_input_tokens) || 0) + (Number(last.cache_creation_input_tokens) || 0),
    startedAt: t.at ?? null,
    endedAt: t.failedAt ?? (ends.length ? Math.max(...ends) : (t.at ?? null)),
    stopReason: t.stop ?? null,
    error: t.failed || null,
  });
}

/**
 * A session file's lines, taken one at a time: `push(line)` gives the turns that line closed (none, or one), `end()`
 * the turn still open. `s` is what the file has told so far: sessionId (the id on its first lines: its own, or that
 * of the chat it was resumed from), cwd, gitBranch, version, firstAt, lastAt, continuedIn[],
 * startsFromSummary, compactions[], the count of turns, lines and skipped lines, and (after `end`) its title.
 *
 * A turn is `{ user, work, final?, at, workAt, endAt, model, cut?, meta, visuals? }`, where `meta` is what Filament
 * keeps on a turn of its own: the client it ran in, its wire format, its numbers (`facts`), and what kind of turn it
 * is; and `visuals` the pictures Claude desktop drew in it (its Code tab's `show_widget`), each by its call's id.
 *
 *   The person's words open a turn. Assistant lines of one response (same message.id) are merged back into one
 *   message; tool results and tool-calling assistant messages are the turn's work; a closing text-only assistant
 *   message is its final.
 *   A slash command opens a turn as the person typed it (`/model sonnet`). What Claude Code printed for it is the
 *   turn's answer, and the turn is a command's (`meta.command`, and who answered it: `commandBy`): no model saw it,
 *   and none is sent it. A command it printed nothing for is answered all the same, with no words: a command's turn
 *   is never one left open. A command a model answered (a skill's) is a turn like any other.
 *   A background task's end opens a turn the agent began by itself (`meta.own`, the tasks it answered), with the
 *   message Filament writes for such a turn; several ends in a row are one turn. So does an assistant line that
 *   follows nobody's message.
 *   The line Claude Code writes where the person stopped a turn marks that turn stopped (`meta.stopped`).
 *   A reply that is the service's error fails its turn: the error's words are the turn's (`meta.failed`, `facts.error`),
 *   unless the agent went on in the same turn.
 *   A compaction's summary is never a turn's message. Inside a turn the turn goes on, and the summary is kept as the
 *   agent's own compaction during it (`during`, `cutAfter`: the last call before it), as Filament keeps one of a coding
 *   agent it runs; between turns it stands for the turns before; first in the file it stands for the chat before.
 *   Sidechain, meta and transcript-only lines are skipped, as is a line that does not parse (a file still being
 *   written).
 */
export function claudeCodeReader() {
  /** @type {{ sessionId: string | null, cwd: string | null, title: string | null, gitBranch: string | null, version: string | null, firstAt: number | null, lastAt: number | null, continuedIn: string[], startsFromSummary: boolean, compactions: any[], turns: number, lines: number, skipped: number }} */
  const s = {
    sessionId: null,
    cwd: null,
    title: null,
    gitBranch: null,
    version: null,
    firstAt: null,
    lastAt: null,
    continuedIn: [],
    startsFromSummary: false,
    compactions: [],
    turns: 0,
    lines: 0,
    skipped: 0,
  };
  const titles = {};
  /** @type {any[]} the turns closed since the caller last took them */
  const closed = [];
  /** @type {any} the open turn */
  let cur = null;
  /** @type {any} the response whose lines are still coming */
  let pending = null;
  /** Whether the message line before this one was `/compact`: the summary beside it was asked for. */
  let askedToCompact = false;
  /** @type {any} the compaction the message line before this one left */
  let justCompacted = null;
  const open = (/** @type {string} */ kind, /** @type {any} */ user, /** @type {number | null} */ at, extra = {}) => {
    cur = { kind, user, at, items: [], model: null, calls: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, last: null, stop: null, failed: null, failedAt: null, stopped: null, own: null, ...extra };
    return cur;
  };
  const flush = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    // An assistant message after nobody's: the agent went on by itself.
    if (!cur) open("own", { role: "user", content: [{ type: "text", text: ownTurnText(AGENT, []) }] }, p.at, { own: { agent: AGENT } });
    // A command a model answers is a prompt of the person's (a skill's), no command of Claude Code's own.
    if (cur.kind === "command") cur.kind = "typed";
    cur.items.push({ msg: reply(p.content), at: p.at, model: p.model });
    cur.model = p.model ?? cur.model;
    cur.calls++;
    const u = p.usage || {};
    cur.tokens.input += Number(u.input_tokens) || 0;
    cur.tokens.output += Number(u.output_tokens) || 0;
    cur.tokens.cacheRead += Number(u.cache_read_input_tokens) || 0;
    cur.tokens.cacheWrite += Number(u.cache_creation_input_tokens) || 0;
    cur.last = u;
    cur.stop = p.stop ?? null;
    // It went on after a failure: the turn did not fail.
    cur.failed = null;
    cur.failedAt = null;
  };
  /** `over`: no more of the turn will come (a next message closed it); false where the file simply ends. */
  const close = (over = true) => {
    flush();
    if (!cur) return;
    const t = cur;
    cur = null;
    s.turns++;
    if (t.kind === "command" && !t.items.length) t.items.push({ msg: reply([{ type: "text", text: "" }]), at: t.at });
    const facts = factsOf(t);
    const meta = {
      format: "anthropic",
      ...(t.kind === "command" ? { command: true, commandBy: AGENT } : {}),
      ...(t.own ? { own: t.own } : {}),
      ...(t.stopped ? { stopped: t.stopped } : {}),
      ...(t.failed ? { failed: { cause: t.failed } } : {}),
      ...(facts ? { facts } : {}),
    };
    // A failed turn has no answer: what it did is its work, whole.
    const shaped = t.failed ? { user: t.user, at: t.at, model: t.model ?? null, work: t.items.map((/** @type {any} */ i) => i.msg), workAt: t.items.at(-1)?.at ?? t.at, final: undefined, endAt: t.failedAt ?? t.at } : shapeTurn({ ...t, closing: over || t.stopped ? unansweredLine(AGENT, !!t.stopped) : null });
    // The pictures Claude desktop drew in it, kept on the turn as Filament keeps its own (Visuals plan VS-D15).
    const visuals = t.items.flatMap((/** @type {any} */ i) => (i.msg.role === "assistant" ? i.msg.content.map(desktopVisualOf).filter(Boolean) : []));
    closed.push({ ...shaped, meta, ...(visuals.length ? { visuals } : {}) });
  };
  /** The id of the last tool call the open turn made, or null. */
  const lastCall = () => {
    for (let i = (cur?.items.length || 0) - 1; i >= 0; i--) {
      const calls = (cur.items[i].msg?.content || []).filter((/** @type {any} */ b) => b?.type === "tool_use" && b.id);
      if (calls.length) return String(calls.at(-1).id);
    }
    return null;
  };
  const take = (raw) => {
    if (!raw.trim()) return;
    s.lines++;
    const o = parseJson(raw);
    if (!o || typeof o !== "object") {
      s.skipped++;
      return;
    }
    if (typeof o.sessionId === "string" && !s.sessionId) s.sessionId = o.sessionId;
    const at = toMs(o.timestamp);
    if (at != null) {
      s.firstAt = s.firstAt == null ? at : Math.min(s.firstAt, at);
      s.lastAt = s.lastAt == null ? at : Math.max(s.lastAt, at);
    }
    switch (o.type) {
      case "custom-title":
        if (typeof o.customTitle === "string") titles.custom = o.customTitle;
        return;
      case "ai-title":
        if (typeof o.aiTitle === "string") titles.ai = o.aiTitle;
        return;
      case "summary":
        if (typeof o.summary === "string") titles.summary = o.summary;
        return;
      case "continued-in":
        if (typeof o.continuedInSessionId === "string") s.continuedIn.push(o.continuedInSessionId);
        return;
      case "user":
      case "assistant":
        break;
      default:
        return; // system, attachment, queue-operation, file-history-*, mode, cost-state …: bookkeeping, not messages
    }
    // Compact summaries are flagged transcript-only too (they are shown, and become the first message of the new context).
    if (!spoken(o)) {
      s.skipped++;
      return;
    }
    if (typeof o.cwd === "string" && o.cwd && !s.cwd) s.cwd = o.cwd;
    if (typeof o.gitBranch === "string" && !s.gitBranch) s.gitBranch = o.gitBranch;
    if (typeof o.version === "string" && !s.version) s.version = o.version;
    const msg = o.message;
    if (o.type === "assistant") {
      if (o.isApiErrorMessage) {
        flush();
        if (cur) {
          cur.failed = textOfMessage(msg).trim().slice(0, 500) || "the service failed the request";
          cur.failedAt = at;
        } else s.skipped++;
        return;
      }
      const model = typeof msg.model === "string" && msg.model && !msg.model.startsWith("<") ? msg.model : null;
      const content = Array.isArray(msg.content)
        ? msg.content
        : typeof msg.content === "string"
          ? [{ type: "text", text: msg.content }]
          : [];
      if (pending && msg.id && pending.id === msg.id) {
        pending.content = pending.content.concat(content);
        pending.at = at ?? pending.at;
        pending.usage = msg.usage ?? pending.usage;
        pending.stop = msg.stop_reason ?? pending.stop;
        return;
      }
      flush();
      pending = { id: msg.id ?? null, content, at, model, usage: msg.usage ?? null, stop: msg.stop_reason ?? null };
      return;
    }
    flush();
    if (messageKind(msg, "user") === "tool_result") {
      if (cur) cur.items.push({ msg: { role: "user", content: msg.content }, at });
      else s.skipped++;
      return;
    }
    const said = userLineKind(o, msg);
    const compactWas = askedToCompact,
      summaryWas = justCompacted;
    askedToCompact = false;
    justCompacted = null;
    switch (said.kind) {
      case "summary": {
        // A turn whose last reply called no tool has had its answer: the summary comes after it, not inside it.
        const lastSaid = cur?.items.at(-1)?.msg;
        if (cur && cur.kind !== "command" && lastSaid?.role === "assistant" && !lastSaid.content.some((/** @type {any} */ b) => b?.type === "tool_use")) close();
        const inside = cur && cur.kind !== "command";
        /** @type {any} */
        const c = inside
          ? { during: s.turns + 1, cutAfter: lastCall(), toTurn: s.turns, text: said.text, at, manual: compactWas }
          : s.turns || cur
            ? { toTurn: s.turns, text: said.text, at, manual: compactWas }
            : { during: 1, cutAfter: null, toTurn: 0, text: said.text, at, manual: compactWas };
        if (!s.turns && !cur) s.startsFromSummary = true;
        s.compactions.push(c);
        justCompacted = c;
        return;
      }
      case "command":
        close();
        open("command", { role: "user", content: said.text }, at);
        if (/^\/compact\b/.test(said.text)) {
          askedToCompact = true;
          if (summaryWas) summaryWas.manual = true;
        }
        return;
      case "output":
        if (cur?.kind === "command" && !cur.items.length) {
          cur.items.push({ msg: reply([{ type: "text", text: said.text }]), at });
          close();
        } else s.skipped++;
        return;
      case "task": {
        if (cur?.kind === "own" && cur.own?.tasks && !cur.items.length) cur.own.tasks.push(said.task);
        else {
          close();
          open("own", null, at, { own: { agent: AGENT, tasks: [said.task] } });
        }
        cur.user = { role: "user", content: [{ type: "text", text: ownTurnText(AGENT, cur.own.tasks) }] };
        return;
      }
      case "stopped":
        if (cur) cur.stopped = { by: CLIENT, at: at ?? cur.at ?? null };
        else s.skipped++;
        return;
      default:
        close();
        open("typed", { role: "user", content: msg.content }, at);
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
      s.title = titles.custom ?? titles.ai ?? titles.summary ?? null;
      return closed.splice(0);
    },
  };
}
/** A whole session file's text at once → what the reader tells, with `turns` as the list of them. @param {string} text */
export function parseClaudeCodeSession(text) {
  const r = claudeCodeReader();
  const turns = [];
  for (const raw of String(text).split("\n")) turns.push(...r.push(raw));
  turns.push(...r.end());
  return { ...r.s, turns };
}

/** A chat's id on the lists: its project's folder name and its file's. @param {{ slug: string, stem: string }} f */
const chatIdOf = (f) => `${f.slug}/${f.stem}`;

/**
 * Every chat under the root, for a list: no file is read past its first 128 KB. `mark` is the file's size, the
 * number that grows when the chat does. @param {string} root
 */
export function claudeCodeChats(root) {
  return listClaudeCodeFiles(expandHome(root)).map((f) => {
    const p = peekClaudeCode(f.path);
    return {
      id: chatIdOf(f),
      key: `cc:${f.stem}`,
      agentSession: f.stem,
      file: f.name,
      cwd: p.cwd,
      preview: p.preview,
      startedAt: p.firstAt ?? f.mtime,
      lastAt: f.mtime,
      bytes: f.size,
      mark: f.size,
    };
  });
}

// `since` (Date | ms | ISO) keeps only files modified since then; `only` (a set of chat ids, `<slug>/<file stem>`)
// keeps only those. Files import in session-start order, so a chat that names the one that goes on from it
// (`continued-in`) is in place before that one links to it. A missing root is simply nothing to import. A file is read
// a line at a time and written a turn at a time, the server answering other requests in between; `signal` stops it
// after the turn in hand.
/** @param {{ archive?: any, root?: string, onProgress?: (p: any) => void, since?: Date | number | string | null, only?: Set<string> | null, signal?: AbortSignal | null, dryRun?: boolean, redact?: boolean }} [o] */
export async function importClaudeCode({
  archive,
  root = CLAUDE_CODE_ROOT,
  onProgress = noop,
  since = null,
  only = null,
  signal = null,
  dryRun = false,
  redact = true,
} = {}) {
  if (!archive && !dryRun) throw new Error("importClaudeCode: an archive is required");
  root = expandHome(root);
  const sinceMs = toMs(since);
  const files = listClaudeCodeFiles(root).filter((f) => (sinceMs == null || f.mtime >= sinceMs) && (!only || only.has(chatIdOf(f))));
  const sink = new Sink(archive, { dryRun, redact, agent: AGENT });
  const out = summary({ source: "claude-code", root, files: files.length, dryRun });
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  onProgress({
    step: "claude-code",
    message: `${files.length} session file(s)`,
    percent: 0,
    done: 0,
    total: files.length,
  });
  for (const f of files) Object.assign(f, peekClaudeCode(f.path));
  files.sort((a, b) => (a.firstAt ?? a.mtime) - (b.firstAt ?? b.mtime) || a.name.localeCompare(b.name));
  /** @type {Map<string, any>} a chat's session id → the chain of the chat that said it goes on there */
  const continuedIn = new Map();
  /** @type {{ chain: any, from: string, at: number | null }[]} the chats resumed from another, each with that one's id */
  const resumed = [];
  const breathe = breather();
  let done = 0,
    bytesDone = 0;
  for (const f of files) {
    throwIfStopped(signal);
    try {
      const r = claudeCodeReader();
      const s = r.s;
      // The chat is its file: a chat resumed from another begins with that chat's lines, its id on them.
      const sid = f.stem;
      /** @type {any} */
      let chain = null;
      /** @type {ReturnType<Sink["writer"]> | null} */
      let writer = null;
      const open = () => {
        const from = s.sessionId && s.sessionId !== sid ? s.sessionId : null;
        chain = sink.chain(`cc:${sid}`, {
          cwd: s.cwd,
          meta: {
            import: "claude-code",
            sessionId: sid,
            ...(from ? { resumedFrom: from } : {}),
            file: f.name,
            slug: f.slug,
            gitBranch: s.gitBranch,
            version: s.version,
          },
          startedAt: s.firstAt ?? f.mtime,
        });
        // The chat that said it goes on here, when this run read it: the two are linked. No chat is guessed at.
        const parent = continuedIn.get(sid);
        if (parent) {
          sink.link(chain.id, parent.id, "continues", s.firstAt);
          sink.parent(chain, parent.id);
        } else if (from) resumed.push({ chain, from, at: s.firstAt });
        writer = sink.writer(chain);
      };
      const write = (/** @type {any[]} */ turns) => {
        for (const t of turns) {
          if (!writer) open();
          /** @type {ReturnType<Sink["writer"]>} */ (writer).put(t);
        }
      };
      let read = 0,
        said = 0;
      for await (const { line, pos, long } of readLines(f.path)) {
        if (long) out.long.push({ file: f.name, ...long });
        if (line != null) write(r.push(line));
        read = pos;
        if (pos - said >= 8 << 20) {
          said = pos;
          onProgress({ step: "claude-code", message: f.name, percent: pct(bytesDone + pos, totalBytes), done, total: files.length });
        }
        await breathe();
        throwIfStopped(signal);
      }
      write(r.end());
      out.skipped += s.skipped;
      if (chain && writer) {
        // The reader says a place as a count of the file's turns; the chat says it as a turn's number (a message
        // sent again is one turn there, and turns made in Filament may stand before the file's newest).
        const ns = /** @type {ReturnType<Sink["writer"]>} */ (writer).end();
        const numberOf = (/** @type {number} */ count) => (count ? ns[count - 1] : 0);
        // Each summary stands for the whole chat before it, as the agent wrote it: Claude Code's own compaction.
        for (const c of s.compactions)
          sink.compaction(chain, {
            fromTurn: 1,
            toTurn: numberOf(c.toTurn),
            text: c.text,
            kind: c.manual ? "manual" : "plain",
            method: "own",
            detail: { ...(c.during ? { during: numberOf(c.during), cutAfter: c.cutAfter } : {}), by: AGENT, exact: true, how: "agent-own" },
            at: c.at,
          });
        sink.close(chain, { at: s.lastAt ?? f.mtime, title: s.title, mark: read });
        for (const child of s.continuedIn) continuedIn.set(child, chain);
      } else if (!dryRun) out.empty.push({ key: `cc:${sid}`, mark: read });
    } catch (e) {
      if (/** @type {any} */ (e)?.aborted) throw e;
      out.errors.push({ file: f.name, error: String(/** @type {any} */ (e)?.message || e) });
    }
    done++;
    bytesDone += f.size;
    onProgress({
      step: "claude-code",
      message: f.name,
      percent: pct(bytesDone, totalBytes),
      done,
      total: files.length,
    });
  }
  // A chat resumed from another is linked to it when that one is in Filament. The two files begin with the same
  // lines, so neither is surely read first: the link is made once both have been.
  for (const r of resumed) {
    const parent = sink.known(`cc:${r.from}`);
    if (!parent) continue;
    sink.link(r.chain.id, parent.id, "continues", r.at);
    sink.parent(r.chain, parent.id);
  }
  return Object.assign(out, sink.stats);
}

/** Claude Code as one of the agents chats come from (sources.js lists them). */
export const claudeCodeSource = Object.freeze({
  id: "claude-code",
  label: AGENT,
  prefix: "cc:",
  /** @param {string} home */
  where: (home) => join(home, ".claude", "projects"),
  /** @param {string} where */
  found: (where) => {
    try {
      return statSync(where).isDirectory();
    } catch {
      return false;
    }
  },
  /** @param {string} where */
  chats: (where) => claudeCodeChats(where),
  /** @param {{ archive: any, where: string, only: Set<string> | null, onProgress?: (p: any) => void, signal?: AbortSignal | null }} o */
  run: ({ archive, where, only, onProgress, signal }) => importClaudeCode({ archive, root: where, only, onProgress, signal }),
});

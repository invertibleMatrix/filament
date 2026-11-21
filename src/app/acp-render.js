// Rendering of an agent's activity for a chat client that can only show text.
//
// ACP agents narrate what they do: tool calls with a kind and a status, edits with the full old and new text,
// command output, plans, sub-agent activity. A chat API reply can carry markdown, so this module turns each of
// those into the richest markdown a chat client renders well: one short line per tool call, a fenced
// `diff` block for every edit, a fenced block for command output, a checklist for plans. Pure functions plus one
// small stateful renderer per turn; nothing here touches the network.
import { CLAUDE_KEPT_IN_NATIVE } from "../adapters/agents/acp/toolset.js";

// One tidy line per tool call for the chat. Agents put the whole shell command into a tool's title; a chat app
// then renders `$(...)` and `$var` as mathematics and a 600-character command as a wall of text. Shell-like titles
// become one short code span, everything stays on a single line, and nothing is repeated.
export function formatToolLine(title, kind = "") {
  let t = String(title || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!t) return null;
  const quoted = /^`[^`]*`$/.test(t);
  if (quoted) t = t.slice(1, -1).trim();
  const shellish =
    quoted ||
    kind === "execute" ||
    /[;|&$<>{}]/.test(t) ||
    /^(cd|ls|cat|grep|rg|curl|npm|npx|node|python|git|powershell|pwsh|bash|sh|dir|type|echo|for|while|if) /.test(
      t,
    );
  const max = shellish ? 90 : 140;
  if (t.length > max) t = t.slice(0, max - 1).trimEnd() + "…";
  const code = "`" + t.replace(/`/g, "'") + "`";
  if (shellish) return `⚙ run ${code}`;
  return /[`$*_~<>|]/.test(t) ? `⚙ ${code}` : `⚙ ${t}`;
}

const MAX_DIFF_LINES = 60; // changed + context lines shown per edit
const MAX_DIFF_INPUT_LINES = 4000; // above this a line diff is not attempted, only counts
const MAX_OUTPUT_LINES = 30; // command output lines shown
const MAX_OUTPUT_CHARS = 2400;

// ---------------------------------------------------------------------------------------------------
// Line diff (Myers-style shortest edit script via LCS on lines; files are small enough for O(n·m) with a cap)
// ---------------------------------------------------------------------------------------------------
export function lineDiff(oldText, newText) {
  const a = String(oldText ?? "").split(/\r?\n/),
    b = String(newText ?? "").split(/\r?\n/);
  if (a.length === 1 && a[0] === "" && oldText == null) a.length = 0; // a new file has no old lines
  // Symmetrically, a deleted file has no new lines. Without this `String(null ?? "").split()` leaves one empty line
  // in `b`, so a deletion counted a phantom added line — invisible before because renderDiff returns early for
  // deletions, but wrong the moment anything counts lines instead of rendering them.
  if (b.length === 1 && b[0] === "" && newText == null) b.length = 0;
  // strip common prefix / suffix first: most edits touch a small region of a large file
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length,
    endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA),
    midB = b.slice(start, endB);
  const ops = []; // { t: "=" | "-" | "+", line }
  for (let i = 0; i < start; i++) ops.push({ t: "=", line: a[i] });
  if (midA.length * midB.length > (MAX_DIFF_INPUT_LINES * MAX_DIFF_INPUT_LINES) / 16) {
    // too big for LCS: plain replace
    for (const l of midA) ops.push({ t: "-", line: l });
    for (const l of midB) ops.push({ t: "+", line: l });
  } else {
    const n = midA.length,
      m = midB.length;
    const dp = new Uint32Array((n + 1) * (m + 1));
    const W = m + 1;
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i * W + j] =
          midA[i] === midB[j]
            ? dp[(i + 1) * W + j + 1] + 1
            : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
    let i = 0,
      j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        ops.push({ t: "=", line: midA[i] });
        i++;
        j++;
      } else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) ops.push({ t: "-", line: midA[i++] });
      else ops.push({ t: "+", line: midB[j++] });
    }
    while (i < n) ops.push({ t: "-", line: midA[i++] });
    while (j < m) ops.push({ t: "+", line: midB[j++] });
  }
  for (let i = endA; i < a.length; i++) ops.push({ t: "=", line: a[i] });
  return ops;
}

// Hunks with `context` unchanged lines around each change, capped at maxLines; returns { lines, added, removed, omitted }.
export function unifiedHunks(ops, { context = 2, maxLines = MAX_DIFF_LINES } = {}) {
  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, i) => {
    if (op.t !== "=")
      for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep[k] = true;
  });
  const lines = [];
  let added = 0,
    removed = 0,
    omitted = 0,
    gap = false;
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.t === "+") added++;
    else if (op.t === "-") removed++;
    if (!keep[i]) {
      gap = true;
      continue;
    }
    if (gap && lines.length) {
      lines.push("@@ … @@");
      gap = false;
    } else gap = false;
    if (lines.length >= maxLines) {
      omitted++;
      continue;
    }
    lines.push(`${op.t === "=" ? " " : op.t}${op.line}`);
  }
  return { lines, added, removed, omitted };
}

// A change as a unified patch a diff view parses (the permission card's, HarnessV3-ACP AC3's drive D5): the ops in
// hunks of `context` unchanged lines around each change, joined where they meet, under `--- / +++` heads naming the
// file (`/dev/null` for a new one) and `@@ -a,b +c,d @@` heads with the lines' own numbers. Returns { patch, added,
// removed }; the patch is "" when nothing changes.
export function unifiedPatch(ops, { file, created = false, context = 3 }) {
  let added = 0,
    removed = 0;
  // Where each op stands: the old lines and the new ones before it.
  const at = [];
  let a = 0,
    b = 0;
  for (const op of ops) {
    at.push([a, b]);
    if (op.t === "+") (b++, added++);
    else if (op.t === "-") (a++, removed++);
    else (a++, b++);
  }
  const hunks = [];
  for (let i = 0; i < ops.length; ) {
    if (ops[i].t === "=") {
      i++;
      continue;
    }
    let last = i;
    for (let j = i + 1; j < ops.length && j - last <= 2 * context + 1; j++) if (ops[j].t !== "=") last = j;
    const from = Math.max(0, i - context),
      to = Math.min(ops.length, last + context + 1);
    const rows = ops.slice(from, to);
    const olds = rows.filter((op) => op.t !== "+").length,
      news = rows.filter((op) => op.t !== "-").length;
    const [oa, nb] = at[from];
    hunks.push(`@@ -${olds ? oa + 1 : oa},${olds} +${news ? nb + 1 : nb},${news} @@`, ...rows.map((op) => `${op.t === "=" ? " " : op.t}${op.line}`));
    i = to;
  }
  const patch = hunks.length ? `--- ${created ? "/dev/null" : file}\n+++ ${file}\n${hunks.join("\n")}\n` : "";
  return { patch, added, removed };
}

// A patch cut to what a card shows: its hunks whole while their lines fit `maxLines` and `maxChars` — the first one cut
// itself when it alone is longer, its head counted again — each line past `maxRow` characters cut, and every line as
// `shown` shows it (a redaction). A patch without heads gets them, naming `file`. Returns { patch, omitted }: the lines
// it left out.
export function capPatch(patch, { file, maxLines, maxChars, maxRow, shown = (s) => s }) {
  const lines = String(patch || "").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  const first = lines.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return { patch: "", omitted: 0 };
  const heads = lines.slice(0, first).filter((l) => l.startsWith("--- ") || l.startsWith("+++ "));
  const hunks = [];
  for (const l of lines.slice(first)) {
    if (l.startsWith("@@")) hunks.push({ head: l, rows: [] });
    else if (/^[ +\-]/.test(l) || l === "") hunks.at(-1).rows.push(l === "" ? " " : l);
  }
  const row = (l) => {
    const s = shown(l);
    return s.length > maxRow ? `${s.slice(0, maxRow)}…` : s;
  };
  const out = [];
  let rows = 0,
    chars = 0,
    omitted = 0,
    full = false;
  for (const hunk of hunks) {
    const drawn = full ? [] : hunk.rows.map(row);
    let kept = drawn.length;
    const size = (n) => drawn.slice(0, n).reduce((s, l) => s + l.length + 1, 0);
    if (rows + kept > maxLines || chars + size(kept) > maxChars) {
      kept = 0;
      if (!out.length) while (kept < drawn.length && kept < maxLines && size(kept + 1) <= maxChars) kept++;
      full = true;
    }
    omitted += hunk.rows.length - kept;
    if (!kept) continue;
    const head = kept === hunk.rows.length ? hunk.head : cutHead(hunk.head, hunk.rows.slice(0, kept));
    out.push(head, ...drawn.slice(0, kept));
    rows += kept;
    chars += size(kept);
  }
  if (!out.length) return { patch: "", omitted };
  const named = heads.length === 2 ? heads : [`--- ${file}`, `+++ ${file}`];
  return { patch: `${named.join("\n")}\n${out.join("\n")}\n`, omitted };
}

// A hunk's head for the first of its rows alone: its starts kept, its counts those rows'.
function cutHead(head, rows) {
  const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(head);
  if (!m) return head;
  const olds = rows.filter((l) => !l.startsWith("+")).length,
    news = rows.filter((l) => !l.startsWith("-")).length;
  return `@@ -${m[1]},${olds} +${m[2]},${news} @@${m[3]}`;
}

// A fenced diff block for one edit. `oldText === null` means a new file (ACP convention).
export function renderDiff(path, oldText, newText, opts = {}) {
  const isNew = oldText == null;
  const isDelete = newText == null;
  if (isDelete) return `\`\`\`diff\n--- ${path}\n+++ /dev/null\n@@ file deleted @@\n\`\`\`\n`;
  const total = String(oldText ?? "").split(/\r?\n/).length + String(newText ?? "").split(/\r?\n/).length;
  if (total > MAX_DIFF_INPUT_LINES * 2) {
    const c = countLines(oldText, newText);
    return `\`\`\`diff\n--- ${path}\n+++ ${path}\n@@ ${c.added} lines added, ${c.removed} removed (too large to show) @@\n\`\`\`\n`;
  }
  const h = unifiedHunks(lineDiff(oldText, newText), opts);
  if (!h.added && !h.removed) return null; // the agent rewrote the file with identical content: nothing to show
  const head = isNew ? `--- /dev/null\n+++ ${path}` : `--- ${path}\n+++ ${path}`;
  const tail = h.omitted
    ? `\n@@ … ${h.omitted} more line${h.omitted === 1 ? "" : "s"} not shown (${h.added} added, ${h.removed} removed in total) @@`
    : "";
  return `\`\`\`diff\n${head}\n${h.lines.join("\n")}${tail}\n\`\`\`\n`;
}

function countLines(oldText, newText) {
  let added = 0,
    removed = 0;
  for (const op of lineDiff(oldText, newText)) {
    if (op.t === "+") added++;
    else if (op.t === "-") removed++;
  }
  return { added, removed };
}

// Command output as a fenced block, tail-truncated: the last lines are the ones that matter (errors, exit).
export function renderOutput(
  text,
  { exitCode = null, maxLines = MAX_OUTPUT_LINES, maxChars = MAX_OUTPUT_CHARS } = {},
) {
  let t = String(text ?? "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\r(?!\n)/g, "\n")
    .trimEnd();
  if (!t && exitCode == null) return null;
  let lines = t.split("\n");
  let omitted = 0;
  if (lines.length > maxLines) {
    omitted = lines.length - maxLines;
    lines = lines.slice(-maxLines);
  }
  t = lines.join("\n");
  if (t.length > maxChars) {
    t = "…" + t.slice(-maxChars);
  }
  const fence = t.includes("```") ? "````" : "```";
  const note = [
    omitted ? `… ${omitted} earlier line${omitted === 1 ? "" : "s"} not shown` : null,
    exitCode != null && exitCode !== 0 ? `exit code ${exitCode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return `${fence}text\n${note ? note + "\n" : ""}${t}\n${fence}\n`;
}

// A title worth announcing. Two conditions, both from the original heuristic: it must not be a generic placeholder
// ("tool call", "terminal"), AND it must actually name a target or have left `pending` — because the first update
// often arrives generic and gains its path a moment later, and announcing "⚙ Read File" then "⚙ Read src/a.js" is
// exactly the noise this mode exists to remove.
// The `status !== "pending"` arm matters: a turn that is cancelled or dies mid-tool never sends a terminal update,
// and without it such a call vanishes from the chat AND from the request record's tool list. Short titles like
// `Read`, `grep` or `TodoWrite` carry no path character at all, so this arm is the only thing that announces them.
// The run's cards wait for the same moment (app/agent-run.js), so a call is drawn when the text would announce it.
export function announceable(title, kind, status) {
  const t = String(title || "").trim();
  if (!t) return false;
  if (/^(mcp|tool|terminal|shell|read file|edit file|write file|search|command)s?((\s|:)\s*(tool|call))?$/i.test(t))
    return false;
  return status !== "pending" || /[\\/.:`]/.test(t) || (t.includes(" ") && kind === "execute");
}

/**
 * A call its permission's answer kept from running (an agent event's `notRun`), as the archive answers it and an
 * outside client's chat says it: the person declined it, something refused it (`why`: a rule, the switch, the
 * policy), or the turn stopped while it was asked — the loop's words for a call a stop came before, which the page
 * reads as Stopped.
 * @param {string} how @param {string} why
 */
export const notRunWords = (how, why) =>
  how === "declined"
    ? "Not run: the developer declined it."
    : how === "stopped"
      ? "Not run: the developer stopped the turn before it ran."
      : `Not run: ${why || "the permission policy"} refused it.`;

// Plans arrive whole on every update. The first one is shown as a checklist; afterwards only the steps that
// changed state are announced, so a ten-step plan does not repeat ten lines every time one box is ticked.
const BOX = { pending: "[ ]", in_progress: "[~]", completed: "[x]" };
export function renderPlan(entries, prev = null) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.content === "string");
  if (!list.length) return { text: null, state: prev };
  const state = list.map((e) => ({
    content: e.content.replace(/\s+/g, " ").trim(),
    status: e.status || "pending",
    priority: e.priority || "medium",
  }));
  if (!prev || prev.length !== state.length || prev.some((p, i) => p.content !== state[i].content)) {
    if (prev && prev.length) {
      // the plan was rewritten: show the new one in full
      return {
        text: `\n**Plan** (updated)\n${state.map((e) => `- ${BOX[e.status] || "[ ]"} ${e.content}${e.priority === "high" ? " ·high" : ""}`).join("\n")}\n\n`,
        state,
      };
    }
    return {
      text: `\n**Plan**\n${state.map((e) => `- ${BOX[e.status] || "[ ]"} ${e.content}${e.priority === "high" ? " ·high" : ""}`).join("\n")}\n\n`,
      state,
    };
  }
  const changed = [];
  state.forEach((e, i) => {
    if (prev[i].status !== e.status) {
      if (e.status === "completed") changed.push(`✓ ${e.content}`);
      else if (e.status === "in_progress") changed.push(`▸ ${e.content}`);
    }
  });
  return { text: changed.length ? changed.join("\n") + "\n" : null, state };
}

// A sentence for stop reasons that are not a normal end of turn. A refusal's says what follows it: the bridge lets the
// agent's session go at the chat's next turn (it holds what was refused), and a harness chat's history leaves the
// refused turn out (`modelTurnsOf`); an outside client's next session starts from what the client sends.
export function describeStopReason(reason, agentName, { harness = false } = {}) {
  switch (reason) {
    case "refusal":
      return harness
        ? `${agentName} refused this request. Filament leaves this turn out of the chat's history, and your next message starts a new ${agentName} session without it.`
        : `${agentName} refused this request. Your next message starts a new ${agentName} session; rephrase or ask something else.`;
    case "cancelled":
      return `${agentName}'s turn was cancelled before it finished.`;
    case "max_tokens":
      return `${agentName} hit its output limit for one turn; say "continue" to let it go on.`;
    case "max_turn_requests":
      return `${agentName} reached its limit of model calls for one turn; say "continue" to let it go on.`;
    default:
      return null;
  }
}
// The chat API's own vocabulary for the same reasons.
export function mapStopReason(reason, format) {
  const anth = {
    refusal: "refusal",
    max_tokens: "max_tokens",
    end_turn: "end_turn",
    cancelled: "end_turn",
    max_turn_requests: "end_turn",
  };
  const oai = {
    refusal: "content_filter",
    max_tokens: "length",
    end_turn: "stop",
    cancelled: "stop",
    max_turn_requests: "stop",
  };
  return (format === "anthropic" ? anth : oai)[reason] || (format === "anthropic" ? "end_turn" : "stop");
}

// ---------------------------------------------------------------------------------------------------
// Per-turn renderer: turns bridge events into text to append to the reply. Keeps what was already said.
//
// Four `toolActivity` modes (ACP_Enhancement.md §9–§10):
//   hide    — nothing but the agent's own words.
//   quiet   — the default: one compact line when a call is announced, and a second line only
//             when the outcome carries information (an edit's +/− summary, or a failure). Intermediate
//             `tool_call_update`s are merged into the record silently and emit nothing. Diffs are summaries, never
//             fenced blocks; command output appears only on failure, a few lines.
//   text    — the previous behaviour: fenced `diff` blocks per edit and a fenced block of command output, inline in
//             the assistant's prose.
//   verbose — `text` with the caps raised, for when you genuinely want to read the whole dump in chat.
//
// Announcements are deduped by TOOL ID, not by the formatted title string. Deduping on the string merges two
// distinct calls that happen to share a title, and misses a repeat when the agent renames a call mid-flight (the
// title often arrives generic first and gains its target later) — both of which the old `lines` Set did.
// ---------------------------------------------------------------------------------------------------
const VERBOSE_DIFFS = 8; // fenced diff blocks per call in verbose mode (quiet/text cap at 3)
const VERBOSE_DIFF_LINES = 180; // lines per fenced diff in verbose mode
const VERBOSE_OUTPUT_LINES = 90;
const VERBOSE_OUTPUT_CHARS = 7200;
const FAILURE_OUTPUT_LINES = 6; // quiet mode: how much of a failed command's output is worth showing
const QUIET_TARGET_LEN = 110; // quiet mode: how much of a path or command to keep on one line

// One compact line per call, in the shape §9.2 specifies: `⚙ Bash: npm test`, `✓ src/proxy.js +12 −3`,
// `✗ npm test — exit 1`. Shell commands keep formatToolLine's quoting rules so a chat app does not reformat them.
const oneLine = (s, n = QUIET_TARGET_LEN) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** The built-ins a native session keeps on purpose, by the name the agent gives them (acp/toolset.js CLAUDE_KEPT_IN_NATIVE). */
const KEPT_BUILT_INS = new Set(CLAUDE_KEPT_IN_NATIVE);

export class ActivityRenderer {
  #noId = 0;
  constructor({
    toolMode = "quiet",
    agentName = "the agent",
    diffStyle = null,
    outputMode = null,
    maxDiffFiles = null,
    maxOutputLines = null,
    icons = null,
  } = {}) {
    this.toolMode = toolMode;
    this.agentName = agentName;
    // `null`/undefined means "not set" → glyphs on. Only an explicit false turns them into words.
    this.icons = icons !== false;
    // Per-mode defaults, overridable from the dashboard (§10) without the caller knowing which mode is active.
    this.quiet = toolMode === "quiet";
    this.verbose = toolMode === "verbose";
    this.diffStyle = diffStyle || (this.quiet ? "summary" : "fenced"); // summary | fenced | off
    this.outputMode = outputMode || (this.quiet ? "failure" : "always"); // failure | always | never
    // Whether the dashboard set the output mode explicitly. In quiet mode a failure already carries its exit code and
    // last lines on the `✗` line, so a fenced dump on top would be the same text twice — unless you asked for it.
    this.outputModeExplicit = !!outputMode;
    // Files whose diff is shown per call. The mode supplies the default (3, or 8 for verbose); an explicit number
    // wins, and 0 means show none — the knob is authoritative in every mode, not just a cap on quiet's summaries.
    const modeCeiling = this.verbose ? VERBOSE_DIFFS : 3;
    this.maxDiffs =
      maxDiffFiles == null || maxDiffFiles === ""
        ? modeCeiling
        : Math.max(0, Math.round(Number(maxDiffFiles)) || 0);
    this.maxOutputLines = Number(maxOutputLines) || (this.verbose ? VERBOSE_OUTPUT_LINES : MAX_OUTPUT_LINES);
    this.maxOutputChars = this.verbose ? VERBOSE_OUTPUT_CHARS : MAX_OUTPUT_CHARS;
    this.tools = new Map(); // toolCallId -> { title, kind, status, announced, parent, diffsShown, outputShown, output, exit, failed, summaries, routed }
    this.plan = null;
    this.subagents = new Map();
    // `routed` = the call went through Filament's own toolset (so the client rendered it natively). `builtIn` = the
    // agent used its own tool instead, which is a "leak" when steering is on: it still worked, but the client saw
    // narration rather than a native card.
    // `kept`: the built-in calls to a tool a native session keeps on purpose (Claude Code's Skill, HarnessV4_Skills_Plan
    // S1-4): the agent's own, and no leak — Filament offers nothing in its place.
    this.stats = { calls: 0, announced: 0, updates: 0, failures: 0, routed: 0, builtIn: 0, kept: 0 };
  }
  #announce(rec) {
    if (rec.announced || this.toolMode === "hide") return null;
    // formatToolLine already supplies the ⚙ and the shell-quoting rules, so quiet mode clips it rather than
    // prefixing it again.
    const shown = formatToolLine(rec.title, rec.kind);
    if (!shown) return null;
    rec.announced = true;
    this.stats.announced++;
    return this.#mark(`${rec.parent ? "  ↳ " : ""}${this.quiet ? oneLine(shown, 150) : shown}\n`);
  }
  // The edit summary quiet mode uses instead of a fenced diff: `+12 −3 src/proxy.js`.
  #diffSummary(path, oldText, newText) {
    const c = countLines(oldText, newText);
    if (!c.added && !c.removed) return null; // identical rewrite: nothing happened
    const isNew = oldText == null,
      isDel = newText == null;
    const flag = isNew ? " (new)" : isDel ? " (deleted)" : "";
    return `+${c.added} −${c.removed} ${oneLine(path)}${flag}`;
  }
  // The announced tool lines, in call order — what the request record stores as `acp.tools`. Derived from the tool
  // map rather than kept in a Set: the old Set was keyed on the RENDERED string, which is exactly what made the
  // dedupe wrong (two distinct calls with one title collapsed into it), and a getter cannot fall out of sync.
  get lines() {
    const out = [];
    for (const rec of this.tools.values()) {
      if (!rec.announced) continue;
      const shown = formatToolLine(rec.title, rec.kind);
      // Decorated the same way the reply is, so the record's tool list reads like what the user saw rather than
      // like a different rendering of it.
      // Sanitized before marking, so the record cannot carry the invisible tag characters the reply path strips: a
      // tool title comes from the agent, and the record is persisted and re-read later. Sanitizing first also keeps
      // #mark's line-start anchor honest.
      if (shown) out.push(this.#mark(sanitizeUnicodeTags(`${rec.parent ? "  ↳ " : ""}${shown}`)));
    }
    return out;
  }
  // A one-line summary of the turn's tool activity for the record and the dashboard: how many calls, how many
  // progress updates were merged silently, how many failed.
  // A one-line summary of the turn's tool activity for the record and the dashboard: how many calls, how many
  // progress updates were merged silently, how many failed, and how the work was routed.
  // `leakRate` is §10's steering measurement: the share of calls the agent made with its OWN tools instead of
  // Filament's, which is the number that decides whether a steered hybrid beats a uniform quiet feed. It is `null`
  // rather than 0 when there were no calls, because "0% leaked" and "nothing to measure" are different claims. A call to
  // a built-in kept on purpose (`kept`) is the agent's own and no leak: the rate is over the others.
  get summary() {
    const { calls, announced, updates, failures, routed, builtIn, kept } = this.stats;
    const weighed = calls - kept;
    return {
      calls,
      announced,
      updatesMerged: updates,
      failures,
      routed,
      builtIn,
      ...(kept ? { kept } : {}),
      leakRate: weighed ? Math.round(((builtIn - kept) / weighed) * 100) : null,
    };
  }
  // The marker for a line Filament builds ITSELF, when `toolIcons` is off: for a client or font that renders
  // ⚙/✓/✗ as boxes, and because Filament's glyph style is exactly what a model starts imitating once it sits in the
  // client's permanent context.
  //
  // Anchored at the start of one line, and only ever called on a line this renderer just constructed. It must NOT be
  // a global replace over assembled output: that also rewrites glyphs inside a fenced diff or a block of command
  // output, which is the agent's own bytes. Test runners print `✓ passing`, mocha and pytest both do, and a global
  // replace turned it into `ok: passing` — corrupting the record of what the command said, and the archive stores
  // that text as what the agent produced.
  #mark(line) {
    if (this.icons || typeof line !== "string") return line;
    return line
      .replace(/^(\s*(?:↳\s*)?)⚙ /, "$1tool: ")
      .replace(/^(\s*(?:↳\s*)?)✓ /, "$1ok: ")
      .replace(/^(\s*(?:↳\s*)?)✗ /, "$1failed: ")
      .replace(/^(\s*(?:↳\s*)?)▸ /, "$1now: ");
  }
  // Classify and count a tool call. Deliberately runs BEFORE the `hide` guard in `handle`: `toolActivity: hide`
  // suppresses the narration, not the measurement, and the leak rate is most interesting in exactly the
  // configuration where the evidence has been turned off. Keyed by tool id, so the twenty updates one call sends
  // are counted once — the same reason the dedupe moved off the rendered title in P1.
  #track(ev) {
    if (ev.type !== "tool") return null;
    // An event with no id cannot be deduped or reclassified, but it still happened, so it is counted under a synthetic
    // key. Skipping it instead would keep `routed + builtIn === calls` looking true while silently dropping real calls
    // from the denominator — a leak rate that reads clean because the evidence was thrown away.
    const key = ev.id || `#noid-${++this.#noId}`;
    const existing = this.tools.get(key);
    // A later update may be the first to reveal what the call was (the title can arrive generic and gain its
    // `mcp__filament__` prefix, or the bridge may only know once the call resolves). Reclassify rather than ignore, and
    // move the count with it: `routed + builtIn === calls` has to hold or the leak rate is not a rate.
    if (existing) {
      if (ev.routed && !existing.routed) {
        existing.routed = true;
        this.stats.routed++;
        this.stats.builtIn--;
        if (existing.kept) {
          existing.kept = false;
          this.stats.kept--;
        }
      }
      if (!existing.routed && !existing.kept && KEPT_BUILT_INS.has(String(ev.toolName || ""))) {
        existing.kept = true;
        this.stats.kept++;
      }
      return key;
    }
    const rec = {
      title: "",
      kind: "",
      status: "pending",
      announced: false,
      parent: ev.parentToolCallId || null,
      diffsShown: 0,
      outputShown: false,
      output: null,
      exit: null,
      failed: false,
      summaries: [],
      routed: !!ev.routed,
      kept: !ev.routed && KEPT_BUILT_INS.has(String(ev.toolName || "")),
    };
    this.tools.set(key, rec);
    this.stats.calls++;
    if (rec.routed) this.stats.routed++;
    else this.stats.builtIn++;
    if (rec.kept) this.stats.kept++;
    return key;
  }
  // Returns the text to append for this event, or null.
  handle(ev) {
    // #track owns the record and every counter, and runs first so the measurement survives `hide`. The render path
    // below only decorates the record it is handed — it used to keep its own copy of the counting, which is how an
    // idless event ended up in `calls` but in neither routing column.
    const key = this.#track(ev);
    // What the agent tells the person beside its answer (HarnessV4_Tasks C21) is none of its tools' work, so `hide`
    // keeps it: a line of its own, in the words its adapter writes for a client that declares no notices.
    if (ev.type === "agent-notice") return ev.subagent ? null : `${ev.description ? `**${ev.title}:** ${ev.description}` : `**${ev.title}**`}\n`;
    if (this.toolMode === "hide") return null;
    if (ev.type === "tool") {
      const rec = this.tools.get(key);
      const parent = ev.parentToolCallId || null;
      if (ev.title) rec.title = ev.title;
      if (ev.kind) rec.kind = ev.kind;
      if (ev.status) rec.status = ev.status;
      rec.parent ??= parent;
      // A command's output may come in pieces (Codex streams it; Claude's adapter sends it apart from its exit code):
      // gathered here, and drawn once, with its exit code, when the call ends (#content).
      if (ev.terminalOutput) {
        rec.output = (rec.output ?? "") + String(ev.terminalOutput.output ?? "");
        rec.exit = ev.terminalOutput.exitCode ?? rec.exit;
      }
      if (ev.exitCode != null) rec.exit = ev.exitCode;
      if (/^`?mcp__[a-z0-9_-]+__/i.test(rec.title) && ev.rawInput && typeof ev.rawInput === "object") {
        const ri = ev.rawInput;
        const t = ri.file_path || ri.command || ri.pattern || ri.path || ri.query || "";
        rec.title = `${rec.title.replace(/^`?mcp__[a-z0-9_-]+__/i, "").replace(/`$/, "")}${t ? " " + String(t).slice(0, 160) : ""}`;
      }
      const terminal = ev.status === "completed" || ev.status === "failed";
      // §9.1: intermediate updates emit no LINE of their own. They must still be PROCESSED, because the ACP listener
      // forwards each update's own `content`/`diffText`/`terminalOutput` rather than an accumulation — so an agent
      // that announces a call early and delivers its diff on a later update (the common case: the path is in the
      // title at `tool_call`, the diff rides the update) would otherwise lose the diff entirely, taking the edit's
      // `✓ +A −R` summary with it. `#content` collects the summary into `rec.summaries` for quiet mode and returns
      // fenced text for the styles that asked for it.
      if (!terminal && rec.announced) {
        this.stats.updates++;
        const body = this.#content(rec, ev);
        // Quiet + summary style has nothing to say mid-call (the summary is emitted at the terminal event); an
        // explicitly requested fenced style still streams as it arrives, because that is what was asked for.
        return this.quiet && this.diffStyle === "summary" ? null : body || null;
      }
      let text = "";
      // Announce as soon as there is a title worth showing; if the agent never gave one, announce at the end rather
      // than let the call pass silently.
      if (announceable(rec.title, rec.kind, rec.status)) text += this.#announce(rec) || "";
      text += this.#content(rec, ev);
      if (terminal) {
        // Gated on announceable, exactly as the announce path is: a title that never got past a generic placeholder
        // ("tool call") carries nothing worth saying, and announcing it at the end would be new noise. Every
        // informative title — including short ones like `Read` that have no path character — is announced by now.
        // announceable also guarantees formatToolLine has something to format, so no fallback line is needed here.
        if (!rec.announced && announceable(rec.title, rec.kind, rec.status)) text += this.#announce(rec) || "";
        if (ev.status === "failed" && !rec.failed) {
          rec.failed = true;
          this.stats.failures++;
          if (this.quiet) {
            // Compact, and it carries the reason: quiet mode shows no fenced output, so this line is the only place
            // the exit code and the tail of the failure ever reach the chat.
            const why = this.#failureDetail(rec, ev);
            // `.trim()` before the fallback chain: a whitespace-only title is truthy but says nothing, and would
            // otherwise win over the kind and render as a bare "✗ ".
            const subject = oneLine(String(rec.title || "").trim() || rec.kind || "tool call");
            text += this.#mark(`${rec.parent ? "  ↳ " : ""}✗ ${subject}${why ? ` — ${why}` : ""}\n`);
          } else if (String(rec.title || "").trim()) {
            // `text`/`verbose` keep the wording they have always used, including the old guard that suppressed the
            // line when there was no title — `✗ failed: ` with no subject is noise, not information. The guard now
            // trims, so a whitespace-only title counts as no subject too (the old code printed `✗ failed:  `).
            // Built conditionally rather than through #mark: this wording already contains the word "failed", so
            // replacing the glyph with "failed: " would read "failed: failed: npm test".
            text += `${this.icons ? "✗ failed: " : "failed: "}${String(rec.title).replace(/\s+/g, " ").trim().slice(0, 120)}\n`;
          }
        }
        if (this.diffStyle === "summary" && rec.summaries.length && this.maxDiffs > 0) {
          // The edit summaries collected during the call, one line per file, capped by the same knob that caps fenced
          // diffs. Emitted on success only, and always cleared: a failure that left summaries behind would otherwise
          // replay them if the same id ever reached a terminal state again.
          if (ev.status !== "failed")
            for (const s of rec.summaries.slice(0, this.maxDiffs))
              text += this.#mark(`${rec.parent ? "  ↳ " : ""}✓ ${s}\n`);
        }
        rec.summaries.length = 0;
      }
      return text || null;
    }
    // A plan's progress lines carry the same glyphs, so they are marked too — but per line, because #mark anchors at
    // the start of ONE line and a plan update is several. Step text follows its marker on the same line, so it is
    // never at a line start and cannot be mistaken for one.
    // A sub-agent's plan is its own (HarnessV3-ACP AC3-4): the chat's progress lines are the turn's plan alone.
    if (ev.type === "plan") {
      if (ev.subagent) return null;
      const r = renderPlan(ev.entries, this.plan);
      this.plan = r.state;
      return r.text
        ? r.text
            .split("\n")
            .map((l) => this.#mark(l))
            .join("\n")
        : r.text;
    }
    if (ev.type === "subagent") {
      if (ev.state === "spawned" || ev.state === "started") {
        if (this.subagents.has(ev.id)) return null;
        this.subagents.set(ev.id, ev);
        return this.#mark(
          this.quiet
            ? `⚙ sub-agent${ev.name ? ` ${ev.name}` : ""} started${ev.description ? `: ${oneLine(ev.description, 120)}` : ""}\n`
            : `⚙ sub-agent${ev.name ? ` ${ev.name}` : ""} started${ev.description ? `: ${String(ev.description).replace(/\s+/g, " ").slice(0, 120)}` : ""}\n`,
        );
      }
      // A cancelled one (the agent's word for a stop, ACP's sub-agents RFD's too) is stopped; a failed one says so.
      if (ev.state === "completed" || ev.state === "stopped" || ev.state === "finished" || ev.state === "cancelled") {
        const name = ev.name || this.subagents.get(ev.id)?.name || "";
        // A STOPPED sub-agent did not finish, and saying so with a success marker claims otherwise — the word form
        // (`ok: sub-agent x finished`) asserts it more loudly than the glyph ever seemed to. No marker at all: it is
        // not a success, and it is not an error either, so borrowing the failure marker would overstate it too.
        return ev.state === "stopped" || ev.state === "cancelled"
          ? `sub-agent${name ? ` ${name}` : ""} stopped\n`
          : this.#mark(`✓ sub-agent${name ? ` ${name}` : ""} finished\n`);
      }
      if (ev.state === "failed") {
        const name = ev.name || this.subagents.get(ev.id)?.name || "";
        return this.#mark(`✗ sub-agent${name ? ` ${name}` : ""} ended in an error\n`);
      }
      return null;
    }
    // The agent compacting its own context: one line once it has, or could not.
    if (ev.type === "compaction") {
      if (ev.subagent) return null;
      if (ev.state === "completed") return this.#mark(`✓ ${this.agentName} compacted its context\n`);
      if (ev.state === "failed") return this.#mark(`✗ ${this.agentName} could not compact its context${ev.error ? `: ${oneLine(ev.error, 160)}` : ""}\n`);
      return null;
    }
    return null;
  }
  // Why a call failed, in as few words as possible: the exit code and the last lines of output, never the whole dump.
  #failureDetail(rec, ev) {
    const exit = rec.exit;
    const raw =
      (ev.notRun ? notRunWords(String(ev.notRun), String(ev.why || "")) : "") ||
      rec.output ||
      (Array.isArray(ev.content)
        ? ev.content.find((c) => c?.type === "content" && c.content?.type === "text")?.content?.text
        : "") ||
      ev.error ||
      "";
    const clean = String(raw ?? "")
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
      .replace(/\r(?!\n)/g, "\n")
      .trim();
    const lines = clean
      ? clean
          .split("\n")
          .filter((l) => l.trim())
          .slice(-FAILURE_OUTPUT_LINES)
      : [];
    const parts = [
      exit != null && exit !== 0 ? `exit ${exit}` : null,
      lines.length ? oneLine(lines.join(" · "), 220) : null,
    ];
    return parts.filter(Boolean).join(": ");
  }
  // Whether a fenced block of command output should be emitted at all. Quiet mode says no by default, because the
  // `✗ … — exit 1: <last lines>` line already carries the part that matters and a fence would repeat it in the middle
  // of the agent's prose; an explicit dashboard choice overrides that.
  #wantOutput(ev) {
    if (this.outputMode === "never") return false;
    if (this.quiet && !this.outputModeExplicit) return false;
    if (this.outputMode === "failure" && ev.status !== "failed") return false;
    return true;
  }
  #content(rec, ev) {
    let text = "";
    const wantFenced = this.diffStyle === "fenced";
    if (this.diffStyle === "off") return text;
    if (ev.diffText && rec.diffsShown < this.maxDiffs) {
      rec.diffsShown++;
      if (wantFenced) {
        const lines = String(ev.diffText).replace(/\r/g, "").split("\n");
        const cap = this.verbose ? VERBOSE_DIFF_LINES : MAX_DIFF_LINES;
        const shown = lines.slice(0, cap);
        text +=
          (rec.announced ? "" : this.#announce(rec) || "") +
          "```diff\n" +
          shown.join("\n").replace(/\n+$/, "") +
          (lines.length > cap ? `\n@@ … ${lines.length - cap} more lines not shown @@` : "") +
          "\n```\n";
      } else if (this.diffStyle === "summary") {
        // A pre-rendered diff has no old/new text to count, so summarise from its own +/- lines.
        let added = 0,
          removed = 0,
          path = rec.title || "";
        for (const l of String(ev.diffText).split("\n")) {
          if (l.startsWith("+") && !l.startsWith("+++")) added++;
          else if (l.startsWith("-") && !l.startsWith("---")) removed++;
          const m = /^\+\+\+ (.+)$/.exec(l);
          if (m) path = m[1];
        }
        if (added || removed) rec.summaries.push(`+${added} −${removed} ${oneLine(path)}`);
      }
    }
    for (const c of Array.isArray(ev.content) ? ev.content : []) {
      if (!c || typeof c !== "object") continue;
      if (c.type === "diff" && c.path) {
        if (rec.diffsShown >= this.maxDiffs) continue;
        // `diffStyle` wins over the mode default, so "quiet lines plus real diffs" is a combination you can ask for.
        if (this.diffStyle === "summary") {
          const s = this.#diffSummary(c.path, c.oldText, c.newText);
          if (s) {
            rec.diffsShown++;
            rec.summaries.push(s);
          }
          continue;
        }
        const d = renderDiff(
          c.path,
          c.oldText,
          c.newText,
          this.verbose ? { maxLines: VERBOSE_DIFF_LINES } : {},
        );
        if (d) {
          rec.diffsShown++;
          text +=
            (rec.announced
              ? ""
              : this.#announce(
                  Object.assign(rec, { title: rec.title || `Edit ${c.path}`, kind: rec.kind || "edit" }),
                ) || "") + d;
        }
      } else if (
        c.type === "content" &&
        c.content?.type === "text" &&
        c.content.text &&
        (rec.kind === "execute" || ev.kind === "execute") &&
        !rec.outputShown
      ) {
        if (!this.#wantOutput(ev)) continue;
        const o = renderOutput(c.content.text, {
          exitCode: rec.exit,
          maxLines: this.outputMode === "failure" ? FAILURE_OUTPUT_LINES : this.maxOutputLines,
          maxChars: this.maxOutputChars,
        });
        if (o) {
          rec.outputShown = true;
          text += o;
        }
      }
    }
    // The output gathered from the call's pieces, once it has ended, unless its own content above drew it.
    const ended = ev.status === "completed" || ev.status === "failed";
    if (ended && rec.output != null && (rec.kind === "execute" || ev.kind === "execute") && !rec.outputShown) {
      if (!this.#wantOutput(ev)) return text;
      const o = renderOutput(rec.output, {
        exitCode: rec.exit,
        maxLines: this.outputMode === "failure" ? FAILURE_OUTPUT_LINES : this.maxOutputLines,
        maxChars: this.maxOutputChars,
      });
      if (o) {
        rec.outputShown = true;
        text += o;
      }
    }
    return text;
  }
}

// Unicode TAG characters (the U+E0000–U+E007F block) are invisible, carry no meaning for a human, and some agents
// emit them as watermarking or hidden-channel markers. We strip them from all text at the edge:
// they would otherwise land in the client's transcript, be re-sent to the
// next model forever, and poison the archive's byte-exact copy of what the agent said.
//
// Deliberately NOT stripped, because each has a legitimate use and removing it would silently corrupt real text:
//   • U+E0100–U+E01EF (Variation Selectors Supplement) — these select CJK ideographic variants, so stripping them
//     changes which glyph a Han character renders as. They are a separate Unicode block from Tags.
//   • U+FE00–U+FE0F (Variation Selectors) — emoji presentation selectors; removing them changes how emoji render.
//   • U+FEFF — a leading byte-order mark is legitimate, and a mid-string one is harmless enough that guessing is
//     worse than leaving it.
//   • ZWJ sequences, combining marks — all meaningful.
const UNICODE_TAGS_RE = /[\u{E0000}-\u{E007F}]/gu;
export function sanitizeUnicodeTags(text) {
  const s = String(text ?? "");
  if (!s) return s;
  // Cheap guard first, and it returns the SAME string object when there is nothing to do: this runs on every chunk
  // of every agent reply, and an unconditional `.replace` would allocate a fresh string for each one.
  if (!/[\u{E0000}-\u{E007F}]/u.test(s)) return s;
  return s.replace(UNICODE_TAGS_RE, "");
}

// Thoughts woven into the reply text, in the order they happened, as quoted paragraphs:
//
//   > 💭 The tests mock the clock, so the retry timer never fires…
//   > I should check the fake timer setup first.
//
// Used when the wire format cannot carry a second thinking block after text has begun: OpenAI-style parsers keep ONE
// reasoning part and ONE text part per reply (the AI SDK's OpenAI-compatible parser hard-codes `reasoning-0` and
// `txt-0`), so a `reasoning_content` chunk that arrives after the text has started is painted under all the text
// or merged into the block at the top. This class only produces text; the caller appends it to the reply.
export class ThoughtInliner {
  constructor() {
    this.open = false;
    this.fresh = false;
    this.pending = "";
  }
  // Text to append for one thought chunk. `tail` is the reply text so far; it decides the blank line before the quote.
  thought(chunk, tail = "") {
    let out = "";
    if (!this.open) {
      this.open = true;
      this.fresh = true;
      this.pending = "";
      out += paragraphGap(tail) + "> 💭 ";
    }
    let t = this.pending + String(chunk ?? "");
    this.pending = "";
    if (this.fresh) {
      t = t.replace(/^\s+/, "");
      if (!t) return out;
      this.fresh = false;
    }
    // Trailing whitespace waits for the next chunk (and is dropped at close), so a thought never ends on an empty "> ".
    const m = /\s+$/.exec(t);
    if (m) {
      this.pending = m[0];
      t = t.slice(0, t.length - m[0].length);
    }
    return out + t.replace(/\r?\n/g, "\n> ");
  }
  // Text that ends an open quote before other output follows: a blank line, so the next paragraph is not quoted.
  close(tail = "") {
    if (!this.open) return "";
    this.open = false;
    this.fresh = false;
    this.pending = "";
    return paragraphGap(tail);
  }
}
function paragraphGap(tail) {
  return !tail || tail.endsWith("\n\n") ? "" : tail.endsWith("\n") ? "\n" : "\n\n";
}

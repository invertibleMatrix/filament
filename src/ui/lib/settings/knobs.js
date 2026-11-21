// @ts-check
// The settings document's knowledge (HarnessV2 §10.3, moved for HarnessV3 Step 2 D13), DOM-free so it can be
// tested: the sections in §5's order with their blurbs, which editor a knob gets, how a value prints, and how a
// typed value becomes the document's (or a refusal in words). The document itself — knobs, defaults, phases,
// sources — arrives from `GET /api/sessions/:id/settings`; nothing here knows a knob by name except the few with a
// bespoke editor.
import { keyWords } from "../format.js";
import { FORMS } from "../context-words.js";

/**
 * @typedef {{ id: string, title: string, blurb: string, prefixes: string[] }} Section
 * @typedef {{ type: string, default: any, phase: number, live: boolean, doc: string, options?: string[], nullable?: boolean,
 *   scope?: "session" | "repo" | "mode", reach?: "every" | "filament" | "screens" }} KnobInfo
 */

// A shape as a normal person reads it, and what it means — the Next request pane's turns say the forms' names, as
// everywhere (U3, UX-4), lower case to sit inside a sentence ("3 folded").
/** @type {Record<string, string>} */
export const SHAPE_WORDS = Object.fromEntries(FORMS.map((f) => [f.id, f.name.toLowerCase()]));
/** @type {Record<string, string>} */
export const SHAPE_MEANS = Object.fromEntries(FORMS.map((f) => [f.id, f.line]));

/** §5's sections, in its order. `prefixes` are the dotted-path heads that belong to the section. @type {Section[]} */
export const SECTIONS = [
  { id: "model", title: "Model", blurb: "Which model the turns go to, with what effort and output ceiling.", prefixes: ["model."] },
  { id: "loop", title: "Loop", blurb: "What the agent may do without asking, and which tools it has.", prefixes: ["loop."] },
  { id: "agents", title: "Engine and agents", blurb: "Which engine answers this session — the model you pick, the agent loop, or a team: a lead and its workers, and whether its orders wait for you — and the sub-agents: what they see of the conversation, and memories. What they run on is set on a chat's Agents tab and in Library; how many at once, on each model's row under its provider.", prefixes: ["engine.", "subagents."] },
  { id: "context", title: "Context", blurb: "How completed turns reach the model: the result policy and compaction.", prefixes: ["context."] },
  { id: "memory", title: "Memory", blurb: "What memory injects and records for this session; off = muted, recording continues.", prefixes: ["memory."] },
  { id: "instructions", title: "Instructions, skills, hooks, servers", blurb: "Project instruction files, user-authored skills, shell hooks on tool events, MCP servers, the web hands, language servers, and what a new worktree gets a copy of.", prefixes: ["instructions.", "skills.", "hooks", "plugins.", "lsp.", "worktree."] },
  { id: "fork", title: "Fork", blurb: "What a fork of this session inherits: the transcript's shape, the results, the worktree, the settings, the goal.", prefixes: ["fork."] },
  { id: "privacy", title: "Privacy", blurb: "Whether the learner may read this session and whether its text is searchable.", prefixes: ["privacy."] },
  { id: "display", title: "Display", blurb: "The session's name and sidebar flags; never touches the model.", prefixes: ["display."] },
];

/**
 * The knobs no settings editor offers: the models and efforts a chat's agents and teams run on, which its Agents tab
 * and a team's Brief set (the owner's plan of 11-05: three places at most — the Library's card or team, this chat's
 * Agents tab, a launch's pick). `/settings` still reads and sets them by name.
 */
export const HIDDEN_KNOBS = Object.freeze(["subagents.pool", "subagents.byCard", "subagents.byTeam", "engine.teamWorkers", "engine.teamEffort"]);

/**
 * The knobs of teams: a settings editor offers none while Settings › Experimental's Teams switch is off
 * (src/ui/lib/teams-on.js). `/settings` still reads and sets them by name.
 */
export const TEAM_KNOBS = Object.freeze(["engine.mode", "engine.team", "engine.agentTeams.notifyWhenDone", "engine.agentTeams.verifyFirst", "subagents.teams"]);

/** The knob paths of one section, in the document's declared order, but `HIDDEN_KNOBS`. @param {Section} section @param {Record<string, KnobInfo>} knobs */
export function knobsOf(section, knobs) {
  return Object.keys(knobs || {}).filter((p) => !HIDDEN_KNOBS.includes(p) && section.prefixes.some((pre) => (pre.endsWith(".") ? p.startsWith(pre) : p === pre)));
}

/** Whether a section has any knob that is live in the built phase. @param {Section} section @param {Record<string, KnobInfo>} knobs */
export function sectionLive(section, knobs) {
  return knobsOf(section, knobs).some((p) => knobs[p].live);
}

/** The knob's short label: the path without its section head (`compaction.model` for `context.compaction.model`). @param {string} path */
export function labelOf(path) {
  const i = path.indexOf(".");
  return i < 0 ? path : path.slice(i + 1);
}

/** The knob in words (HarnessV3-Launch LD-D10): its short label by the one rule (`Compaction model`). @param {string} path */
export const knobWords = (path) => keyWords(labelOf(path));

/**
 * Which editor a knob gets. `tools` is the per-tool switch row (`loop.tools`); `text-list` a comma-separated line of
 * strings; `rules` the rules as the server describes them, read-only (HarnessV3-AtHome AH-D7: nobody writes one by
 * hand — the harness's permission switch lists them in words, each with Forget); `hooks` one item per line in its
 * short form (`post-tool(edit) npm test`); `json` a textarea for other object lists and free objects.
 * @param {string} path @param {KnobInfo} k
 * @returns {"bool" | "enum" | "number" | "string" | "tools" | "text-list" | "rules" | "hooks" | "json"}
 */
export function editorFor(path, k) {
  if (path === "loop.tools") return "tools";
  if (path === "loop.rules") return "rules";
  if (path === "hooks") return "hooks";
  switch (k.type) {
    case "bool": return "bool";
    case "enum": return "enum";
    case "int":
    case "number": return "number";
    case "string": return "string";
    case "list": return Array.isArray(k.default) && (k.default.length === 0 ? STRING_LISTS.has(path) : k.default.every((x) => typeof x === "string")) ? "text-list" : "json";
    default: return "json";
  }
}
/** Empty-by-default lists whose items are plain strings (the others hold objects and edit as JSON). */
const STRING_LISTS = new Set(["memory.loads", "privacy.redact", "privacy.bashDeny", "loop.addedFolders", "worktree.copy"]);

const HOOK_EVENTS = ["pre-tool", "post-tool", "turn-end", "session-start", "prompt-submit", "pre-compact", "subagent-end"];
/** Hooks: `on[(tool)] command[ timeout=ms]`. */
const HOOK_LINE = /^(pre-tool|post-tool|turn-end|session-start|prompt-submit|pre-compact|subagent-end)(?:\(([A-Za-z0-9_*-]+)\))?\s+(.+?)(?:\s+timeout=(\d+))?$/;

/**
 * A setting's description as the page draws it (HarnessV4_Tasks U4). The stored one is written for the chat too, where
 * a backtick pair marks code and `null` is the word that unsets a setting (`/set <name> null`). On a page, code is set
 * in mono and an unset value is said in words: "not set" — "null = the model's own default" reads "not set: the
 * model's own default". What sits inside code is left as typed.
 * @param {string} doc @returns {{ code: boolean, text: string }[]}
 */
export function docParts(doc) {
  /** @type {{ code: boolean, text: string }[]} */
  const parts = [];
  String(doc ?? "").split(/`([^`\n]+)`/).forEach((piece, i) => {
    if (!piece) return;
    if (i % 2) return void parts.push({ code: true, text: piece });
    // "Not set" where it opens a sentence (or was written with a capital); "null = x" reads "not set: x".
    const text = piece.replace(/\bnull\b(\s*=\s*)?/gi, (whole, eq, at) => {
      const opens = (at === 0 && !parts.length) || /[.!?]\s+$/.test(piece.slice(0, at)) || whole[0] === "N";
      return `${opens ? "Not set" : "not set"}${eq ? ": " : ""}`;
    });
    parts.push({ code: false, text });
  });
  return parts;
}

/** The same description as plain words, for a tooltip: no marks. @param {string} doc */
export const docWords = (doc) => docParts(doc).map((p) => p.text).join("");

/** One rule as its line, as the server describes it: `tool(pattern) verdict[ · learned]`. @param {{ tool: string, pattern: string, verdict: string, learned?: boolean }} r */
export const ruleLine = (r) => `${r.tool}(${r.pattern}) ${r.verdict}${r.learned ? " · learned" : ""}`;
/** One hook as its line. @param {{ on: string, tool?: string, command: string, timeoutMs?: number }} k */
export const hookLine = (k) => `${k.on}${k.tool ? `(${k.tool})` : ""} ${k.command}${k.timeoutMs ? ` timeout=${k.timeoutMs}` : ""}`;

/** A hook line as the document's item, or the problem. @param {string} line */
export function parseHookLine(line) {
  const m = HOOK_LINE.exec(String(line).trim());
  if (!m) return { error: `"${line.trim().slice(0, 60)}" is not a hook: write on(tool) command, e.g. post-tool(edit) npm test — on is ${HOOK_EVENTS.join(", ")}` };
  if (m[2] && m[1] !== "pre-tool" && m[1] !== "post-tool") return { error: `${m[1]} hooks take no tool` };
  const ms = m[4] ? Number(m[4]) : null;
  if (ms != null && (ms < 100 || ms > 600000)) return { error: "timeout= must be 100 to 600000 milliseconds" };
  return { value: { on: m[1], ...(m[2] ? { tool: m[2] } : {}), command: m[3], ...(ms != null ? { timeoutMs: ms } : {}) } };
}
/** Lines → items with the first problem named. @param {string} text @param {(line: string) => { value: any } | { error: string }} one */
function parseLines(text, one) {
  const items = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const r = one(line);
    if ("error" in r) return r;
    items.push(r.value);
  }
  return { value: items };
}

/**
 * A value as the inspector prints it beside its badge.
 * @param {string} path @param {KnobInfo} k @param {any} v
 */
export function formatValue(path, k, v) {
  if (v === null || v === undefined) return k.nullable || k.default === null ? "–" : "";
  if (path === "loop.tools" && typeof v === "object") {
    const off = Object.entries(v).filter(([, on]) => on === false).map(([n]) => n);
    return off.length ? `off: ${off.join(", ")}` : "all on";
  }
  if (typeof v === "boolean") return v ? "on" : "off";
  if (typeof v === "number") return Number.isInteger(v) ? v.toLocaleString() : String(v);
  if (typeof v === "string") return v === "" ? "(empty)" : v;
  if (Array.isArray(v)) {
    if (!v.length) return "none";
    if (path === "loop.rules") return summaryOf(v.map((r) => (r && typeof r === "object" ? ruleLine(r) : String(r))));
    if (path === "hooks") return summaryOf(v.map((k) => (k && typeof k === "object" ? hookLine(k) : String(k))));
    return v.every((x) => typeof x === "string") ? v.join(", ") : `${v.length} item${v.length === 1 ? "" : "s"}`;
  }
  return JSON.stringify(v);
}
/** The first few lines, then a count. @param {string[]} lines */
const summaryOf = (lines) => (lines.length <= 3 ? lines.join("; ") : `${lines.slice(0, 3).join("; ")}; +${lines.length - 3} more`);

/**
 * The typed text of an editor as the document's value. An empty field means "inherit again" (`{ unset: true }`);
 * anything that does not fit the knob is refused with the reason, naming the knob as its row does (`name`).
 * @param {string} path @param {KnobInfo} k @param {string} raw @param {ReturnType<typeof editorFor>} editor
 * @param {string} [name]
 * @returns {{ value: any } | { unset: true } | { error: string }}
 */
export function parseInput(path, k, raw, editor, name = knobWords(path)) {
  const s = String(raw ?? "").trim();
  if (s === "") return { unset: true };
  switch (editor) {
    case "number": {
      const n = Number(s);
      if (!Number.isFinite(n)) return { error: `${name} must be a number` };
      if (k.type === "int" && !Number.isInteger(n)) return { error: `${name} must be a whole number` };
      return { value: n };
    }
    case "string":
      return { value: s };
    case "text-list":
      return { value: s.split(",").map((x) => x.trim()).filter(Boolean) };
    case "hooks":
      return parseLines(s, parseHookLine);
    case "json": {
      try {
        const v = JSON.parse(s);
        if (v === null) return k.nullable ? { value: null } : { error: `${name} cannot be null` };
        if (k.type === "list" && !Array.isArray(v)) return { error: `${name} must be a JSON list` };
        return { value: v };
      } catch {
        return { error: `${name} is not valid JSON` };
      }
    }
    default:
      return { value: s };
  }
}

/**
 * The context map's cells (§10.3): one per completed turn of the preview, width as its share of the history the
 * model would see (a floor keeps a tiny turn visible), the turns under the compaction summary marked, and the
 * compaction boundaries as positions between cells.
 * @param {{ current?: { perTurn?: { n: number, shape: string, tokens: number, fallback?: string, adapted?: "translated" | "folded" }[], head?: { fromTurn?: number, toTurn: number } | null, underSummary?: number } | null, turns?: number } | null | undefined} preview
 * @param {{ minPct?: number }} [o]
 */
export function mapCells(preview, { minPct = 1.5 } = {}) {
  const cur = preview?.current || {};
  const per = Array.isArray(cur.perTurn) ? cur.perTurn : [];
  const under = Number(cur.underSummary) || 0;
  const headTo = cur.head ? Number(cur.head.toTurn) || 0 : 0;
  const total = per.reduce((n, t) => n + (Number(t.tokens) || 0), 0) || 1;
  /** @type {{ n: number, shape: string, tokens: number, fallback: string | null, adapted: "translated" | "folded" | null, pct: number, under: boolean, boundaryBefore: boolean }[]} */
  const cells = [];
  for (let i = 1; i <= under; i++) cells.push({ n: i, shape: "compacted", tokens: 0, fallback: null, adapted: null, pct: minPct, under: true, boundaryBefore: false });
  per.forEach((t, i) => {
    cells.push({
      n: t.n, shape: t.shape, tokens: Number(t.tokens) || 0, fallback: t.fallback || null, adapted: t.adapted || null,
      pct: Math.max(minPct, ((Number(t.tokens) || 0) / total) * 100), under: false, boundaryBefore: i === 0 && headTo > 0,
    });
  });
  const sum = cells.reduce((n, c) => n + c.pct, 0) || 1;
  for (const c of cells) c.pct = (c.pct / sum) * 100;
  return cells;
}

/**
 * One composed message's text for the dry-run turn (§14): a string as it is, blocks one per line — text as
 * written, a tool call by name with its input, a tool result by size then its text, thinking by size.
 * @param {any} content
 */
export function dryRunText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);
  return content.map((b) => {
    if (!b || typeof b !== "object") return String(b);
    if (b.type === "text") return String(b.text ?? "");
    if (b.type === "tool_use" || b.type === "server_tool_use") return `⚙ ${b.name || "tool"}(${JSON.stringify(b.input ?? {})})`;
    if (b.type === "tool_result") {
      const inner = typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x) => (x?.type === "text" ? String(x.text ?? "") : `[${x?.type || "block"}]`)).join("\n") : "";
      return `↳ tool_result${b.is_error ? " (error)" : ""} · ${inner.length.toLocaleString()} chars${inner ? `\n${inner}` : ""}`;
    }
    if (b.type === "thinking" || b.type === "redacted_thinking") return `(thinking · ${String(b.thinking || "").length.toLocaleString()} chars)`;
    if (b.type === "image") return "[image]";
    return `[${b.type || "block"}]`;
  }).join("\n");
}

// The dry run rides the query string, and the server reads a request line of at most 16 KB: the draft is cut to
// what fits once URL-encoded (a non-ASCII character encodes to up to nine bytes), and the dialog says so.
const DRY_RUN_QUERY_BYTES = 12000;
/** The longest head of `text` whose URL encoding fits the query budget. @param {string} text */
export function dryRunDraft(text) {
  let draft = String(text || "");
  while (draft.length && encodeURIComponent(draft).length > DRY_RUN_QUERY_BYTES) draft = draft.slice(0, Math.floor(draft.length * 0.8));
  return draft;
}

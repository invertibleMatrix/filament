// @ts-check
// One tool vocabulary (HarnessV3 Step 3 D5): the canonical kinds every hand speaks, the names each is known by
// (ours, Claude Code's and Cursor's), each field's aliases, the units that differ, and the
// words that cannot cross. `canonicalOf` reads a call from any vocabulary; `buildCall` writes one against the
// tools a request actually declares — their schemas decide the field names, never a client's. A call that would
// lose a field does not translate (null); the adapter folds the turn instead of guessing.
//
// The pinned rules (D5): read, write and list translate; one edit ↔ Edit, several ↔ MultiEdit when declared;
// shell translates with the timeout converted (seconds ours, milliseconds Claude Code's); search translates only
// when every field maps (the output modes' words mapped; `literal` has no clean equivalent); todo translates with the status
// words mapped; web-fetch does not (Claude Code's `prompt` has no equivalent); subagent never (`Task` and
// `delegate_read` mean different things); mcp only when the same full name is declared.
import { besideAction } from "./beside.js";
import { callsMade, textOfMessage } from "./messages.js";
import { redactSecrets } from "./redact.js";
import { asMeant } from "./task-graph.js";
import { draftWhere, spaceFields } from "./space.js";
import { doorCall } from "./mcp-door.js";

/**
 * @typedef {object} KindEntry
 * @property {string[]} names  the tool names this kind is known by (any case)
 * @property {Record<string, string[]>} fields  canonical field → its aliases (the canonical name included)
 * @property {string[]} [cosmetic]  fields that may be dropped without losing meaning
 * @property {(src: string, tgt: string, k: string, v: any, alias?: string) => any} [unit]  a value converted
 *   between two named tools; `alias` is the field's spelling the side used (a `timeout_ms` alias is milliseconds
 *   whatever the tool's name)
 * @property {boolean} [never]  recognized for cards, never translated (the vocabularies mean different things)
 */

/** The status words of a todo list, mapped both ways between vocabularies. */
const TODO_STATUS = {
  // ours → Claude Code
  "Filament->claude": { pending: "pending", doing: "in_progress", done: "completed" },
  // Claude Code → ours
  "claude->Filament": { pending: "pending", in_progress: "doing", completed: "done" },
};

/** The path field's aliases — the one every file-speaking vocabulary spells differently. */
const PATH = ["path", "file_path", "filePath", "target_file"];

/** @type {Record<string, KindEntry>} */
export const KINDS = {
  read: {
    names: ["read", "Read", "read_file", "ReadFile", "view_file", "cat"],
    fields: { path: PATH, offset: ["offset", "line"], limit: ["limit", "max_lines", "n"] },
    cosmetic: [],
  },
  write: {
    names: ["write", "Write", "write_file", "WriteFile", "create_file"],
    fields: { path: PATH, content: ["content"] },
    cosmetic: [],
  },
  // One canonical edit is { path, edits: [{ oldText, newText }] } — Claude Code's Edit holds one pair
  // (old_string/new_string), its MultiEdit holds the list.
  edit: {
    names: ["edit", "Edit", "edit_file", "EditFile", "str_replace_based_edit_tool", "str_replace_editor", "apply_patch"],
    fields: { path: PATH },
    cosmetic: [],
  },
  "edit-many": {
    names: ["MultiEdit", "multi_edit"],
    fields: { path: PATH },
    cosmetic: [],
  },
  shell: {
    names: ["bash", "Bash", "run_command", "execute_command", "shell", "Shell", "run_terminal_cmd", "powershell"],
    fields: { command: ["command", "cmd"], timeout: ["timeout", "timeout_ms"] },
    // The timeout is seconds in ours, milliseconds in Claude Code's Bash — and in any tool that spells the field
    // `timeout_ms`. The unit follows the spelling when it says, the name otherwise; `alias` is the spelling of the
    // side that is not ours (the source when reading, the target when writing).
    unit: (src, tgt, k, v, alias) => {
      if (k !== "timeout" || typeof v !== "number") return v;
      const ms = (name) => name === "Bash" || (name !== "filament" && alias === "timeout_ms");
      if (ms(src) && !ms(tgt)) return v / 1000;
      if (ms(tgt) && !ms(src)) return v * 1000;
      return v;
    },
    // Claude Code's Bash says what its command is for (`description`), words for the person that change nothing run
    // (the hunt of 11-08: every Claude Code turn that ran one folded on its way to the loop).
    cosmetic: ["description"],
  },
  "shell-background": {
    names: ["bash_background", "bash_output", "bash_kill"],
    fields: { command: ["command"], id: ["id"] },
    cosmetic: [],
  },
  search: {
    names: ["grep", "Grep", "search_files", "find_in_files", "ripgrep"],
    fields: {
      pattern: ["pattern", "regex"],
      path: ["path"],
      glob: ["glob", "include"],
      type: ["type"],
      ignoreCase: ["ignoreCase", "-i", "case_insensitive"],
      multiline: ["multiline"],
      output: ["output", "output_mode"],
      context: ["context", "-C"],
      before: ["before", "-B"],
      after: ["after", "-A"],
      limit: ["limit", "head_limit", "max_results"],
      offset: ["offset"],
    },
    // The output modes are the same three, one spelled differently: Claude Code's `files_with_matches` is our `files`
    // (HarnessV3-Tools TL-D8). The spelling of the field says whose words the value is in.
    unit: (src, tgt, k, v, alias) => {
      if (k !== "output") return v;
      if (tgt === "filament") return alias === "output_mode" && v === "files_with_matches" ? "files" : v;
      return alias === "output_mode" && v === "files" ? "files_with_matches" : v;
    },
    // `literal` is ours only and does not cross (D5). Claude Code's `-n` only switches the line numbers ours always
    // shows.
    cosmetic: ["-n"],
  },
  list: {
    names: ["glob", "Glob", "list_files", "LS", "ls", "list_dir"],
    fields: { pattern: ["pattern", "glob"], path: ["path"] },
    // Our `sort` orders the same files (HarnessV3-Tools TL-D20); Claude Code's Glob lists the newest first anyway.
    cosmetic: ["sort"],
  },
  todo: {
    names: ["plan", "checklist", "TodoWrite", "todo_write", "update_plan", "TaskCreate", "updateTodos"],
    fields: { items: ["items", "todos"] },
    // activeForm is derivable from the item's own text; description never carried meaning.
    cosmetic: ["description", "activeForm"],
  },
  "web-fetch": {
    names: ["web_fetch", "WebFetch", "fetch", "open_url"],
    fields: { url: ["url"], offset: ["offset"] },
    never: true, // Claude Code's WebFetch carries a `prompt` ours has no equivalent for
    cosmetic: [],
  },
  "web-search": {
    names: ["web_search", "WebSearch", "search_the_web"],
    fields: { query: ["query"], limit: ["limit"] },
    cosmetic: [],
  },
  ask: {
    names: ["ask", "AskUserQuestion", "ask_user_question", "ask_user", "askUser", "askQuestion"],
    fields: { question: ["question", "prompt"] },
    never: true, // the option shapes differ; a question with lost options would lie
    cosmetic: [],
  },
  subagent: {
    names: ["delegate_read", "Task", "agent", "subagent", "worker"],
    fields: {},
    never: true, // `Task` and `delegate_read` mean different things
    cosmetic: [],
  },
  notebook: {
    names: ["NotebookEdit", "notebook_edit"],
    fields: {},
    never: true, // ours has no notebook tool; recognized so a card can name it, never translated
    cosmetic: [],
  },
  // An image an agent makes (Cursor's generateImage, Codex's image_generation): recognized so a card can draw it.
  image: {
    names: ["generateImage", "image_generation"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A plan an agent proposes for the person to accept (Cursor's createPlan, Claude Code's ExitPlanMode).
  proposal: {
    names: ["createPlan", "ExitPlanMode", "exit_plan_mode"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  memory: {
    names: ["filament_memory", "filament_recall", "filament_remember", "filament_forget", "filament_sessions", "filament_load"],
    fields: {},
    cosmetic: [],
  },
  // A picture an agent draws in the chat, and the guide it reads first (HarnessV4_Visuals_Plan VS-D1): Filament's own.
  visual: {
    names: ["show_visual"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  "visual-guide": {
    names: ["visual_guide"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A page an agent keeps apart from the chat (HarnessV4_Artifacts_Plan AF-D1): Filament's own.
  artifact: {
    names: ["artifact"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // The task graph (HarnessV3-TaskGraph): its tasks, added, started, done — Filament's own; drawn as a row of words
  // (HarnessV4_TaskGraphEasy_Plan E40, TG3).
  tasks: {
    names: ["tasks"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A project's Space (proposal_ux §4.14): its board and its logbook, What happened — Filament's own.
  space: {
    names: ["space"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A team beside the chat, sent by the main agent (team_v2_plan §5.5): Filament's own.
  "team-beside": {
    names: ["team"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A flow beside the chat, designed by the main agent after /flow (HarnessV4_OneAgent_Plan OA3): Filament's own.
  flow: {
    names: ["flow"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A chat of its own linked to this one, started by the main agent with its brief (app/threads.js): Filament's own.
  thread: {
    names: ["thread"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // The chat's own agent coming back to it later by itself (agent/come-back.js, the owner's word of 10-27): Filament's own.
  "come-back": {
    names: ["come_back"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // A sub-agent that only reads running the check of the graph task it looks at, in a copy of the folder
  // (agent/run-check.js, x20): Filament's own.
  "run-check": {
    names: ["run_check"],
    fields: {},
    never: true,
    cosmetic: [],
  },
  // Claude desktop's own artifact tool (its Code tab's `Artifact`), as a chat imported from Claude Code holds its
  // calls: a page kept on claude.ai, never here (HarnessV4_Artifacts_Plan AFC-150). Its name differs from Filament's in
  // case alone (`BY_EXACT_NAME`).
  "claude-artifact": {
    names: [],
    fields: {},
    never: true,
    cosmetic: [],
  },
  mcp: {
    names: [],
    fields: {},
    cosmetic: [],
  },
  other: {
    names: [],
    fields: {},
    cosmetic: [],
  },
};

/** Every name the table knows, lower-cased → its kind (the first kind that claims the name wins; ours first). */
const BY_NAME = (() => {
  /** @type {Map<string, string>} */
  const out = new Map();
  for (const [kind, entry] of Object.entries(KINDS))
    for (const n of entry.names || [])
      if (!out.has(n.toLowerCase())) out.set(n.toLowerCase(), kind);
  return out;
})();

/** Names told from one the table knows by their case alone, each → its kind. */
const BY_EXACT_NAME = new Map([["Artifact", "claude-artifact"]]);

/** The roles the client bridge asks for by name (one table, D5's last line). */
export const ROLE_NAMES = {
  ask: ["AskUserQuestion", "ask_user_question", "ask_user", "askUser"],
  todo: ["TodoWrite", "todo_write", "update_plan", "TaskCreate"],
  read: ["Read", "read_file", "ReadFile", "view_file", "cat"],
  write: ["Write", "write_file", "WriteFile", "create_file"],
  edit: ["Edit", "edit_file", "str_replace_based_edit_tool", "str_replace_editor"],
  bash: ["Bash", "bash", "run_command", "execute_command", "shell", "Shell", "run_terminal_cmd"],
};

/**
 * The kind a tool name speaks, with the memory family resolved by prefix. MCP tools carry their server in the
 * name and are matched by full name only, never by kind. @param {string} name
 * @returns {string | null}
 */
export function kindOfName(name) {
  const n = String(name || "");
  const k = BY_EXACT_NAME.get(n) || BY_NAME.get(n.toLowerCase());
  if (k) return k;
  if (/^filament_/.test(n)) return "memory";
  return null;
}

/**
 * Read a call from any vocabulary (the source side): its canonical kind, its canonical fields, and the `extra`
 * fields with no canonical meaning. The edit pair and the todo list are normalized: `edits` holds
 * `{ oldText, newText, replaceAll? }` items whatever shape the source spoke; `items` holds `{ text, status }` in OUR words
 * (Claude Code's status words are read in; a word with no equivalent stays and refuses to translate out).
 * @param {string} name @param {any} input
 * @returns {{ kind: string, fields: Record<string, any>, extra: Record<string, any> } | null}
 */
export function canonicalOf(name, input) {
  const kind = kindOfName(name);
  if (!kind) return null;
  const src = String(name);
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  /** @type {Record<string, any>} */
  const fields = {};
  /** @type {Record<string, any>} */
  const extra = {};
  const map = KINDS[kind].fields;
  for (const [k, v] of Object.entries(raw)) {
    const canon = Object.entries(map).find(([, aliases]) => aliases.map((a) => a.toLowerCase()).includes(k.toLowerCase()));
    if (canon) {
      const key = canon[0];
      if (key === "items") continue; // the todo list is normalized below
      const alias = canon[1].find((a) => a.toLowerCase() === k.toLowerCase());
      fields[key] = KINDS[kind].unit ? KINDS[kind].unit(src, "filament", key, v, alias) : v;
    } else extra[k] = v;
  }
  // The edit pair: Claude Code's Edit holds one old/new pair at the top level; ours and MultiEdit hold the list.
  if (kind === "edit" || kind === "edit-many") {
    const list = raw.edits ?? raw.edits_list;
    const items = kind === "edit-many" || Array.isArray(list) ? normEdits(list) : normEdits([raw]);
    for (const k of ["old_string", "oldText", "new_string", "newText", "replace_all", "replaceAll", "edits", "edits_list"]) delete extra[k];
    return { kind: "edit", fields: { path: fields.path, edits: items }, extra };
  }
  if (kind === "todo") {
    const list = raw.items ?? raw.todos;
    const items = Array.isArray(list)
      ? list.map((/** @type {any} */ it) => ({ text: String(it?.text ?? it?.content ?? ""), status: inWords(it?.status) }))
      : [];
    const activeForms = Array.isArray(list) && list.some((/** @type {any} */ it) => it?.activeForm != null);
    delete extra.items;
    delete extra.todos;
    return { kind: "todo", fields: { items }, extra: { ...extra, ...(activeForms ? { activeForm: true } : {}) } };
  }
  return { kind, fields, extra };
}

/** Claude Code's status words → ours; ours pass through. @param {any} status */
const inWords = (status) => TODO_STATUS["claude->Filament"][String(status)] ?? String(status ?? "");

/**
 * A list of edit items in either vocabulary's words → ours. Replacing every occurrence belongs to the edit, so it is
 * carried with it (HarnessV3-Tools TL2), present only when true. @param {any} list
 */
function normEdits(list) {
  return (Array.isArray(list) ? list : []).map((/** @type {any} */ e) => ({
    oldText: e?.old_string ?? e?.oldText,
    newText: e?.new_string ?? e?.newText,
    ...((e?.replace_all ?? e?.replaceAll) === true ? { replaceAll: true } : {}),
  }));
}

/** Ours → Claude Code's status words. @param {any} status */
const outWords = (status) => TODO_STATUS["Filament->claude"][String(status)] ?? null;

/**
 * Write a call against the tools a request declares (the target side): the declared tool whose schema can carry
 * every canonical field, with no field lost. Returns null when no declared tool of the kind fits — the adapter
 * folds the turn rather than send a call that changed meaning. `declaredTools` is a list of `{ name, schema }`
 * (the client bridge's shape); ours — the loop's own hands — is spelled with our names and our field words.
 * @param {string} kind @param {Record<string, any>} fields @param {{ name: string, schema: any }[]} declaredTools
 * @param {Record<string, any>} [extra]  fields with no canonical meaning, carried only when the target declares them
 * @returns {{ name: string, input: any } | null}
 */
export function buildCall(kind, fields, declaredTools, extra = {}) {
  const entry = KINDS[kind];
  if (!entry || entry.never) return null;
  const tools = Array.isArray(declaredTools) ? declaredTools : [];
  if (kind === "edit") return buildEdit(fields, tools, extra);
  if (kind === "todo") return buildTodo(fields, tools, extra);
  const candidates = tools.filter((t) => kindOfName(t.name) === kind);
  for (const t of candidates) {
    const name = String(t.name);
    const props = t.schema?.properties && typeof t.schema.properties === "object" ? t.schema.properties : {};
    const required = new Set(Array.isArray(t.schema?.required) ? t.schema.required : []);
    /** @type {Record<string, any>} */
    const input = {};
    let lost = false;
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      const aliases = entry.fields[field] || [field];
      const target = aliases.find((a) => Object.prototype.hasOwnProperty.call(props, a));
      if (!target) { lost = true; break; } // this vocabulary has no spelling for a field the call carries
      input[target] = entry.unit ? entry.unit("filament", name, field, value, target) : value;
    }
    if (lost) continue;
    // Extra fields ride only when the target declares them by name; anything else would be silently dropped.
    for (const [k, v] of Object.entries(extra)) {
      if (v === undefined || v === null) continue;
      if (Object.prototype.hasOwnProperty.call(props, k)) input[k] = v;
      else if (!entry.cosmetic?.includes(k)) { lost = true; break; }
    }
    if (lost) continue;
    // Every required property the target demands must be filled.
    if ([...required].some((r) => input[r] === undefined)) continue;
    return { name, input };
  }
  return null;
}

/** The edit call, bespoke (the pair-versus-list shapes): one edit prefers a pair tool, several need a list tool. */
function buildEdit(fields, tools, extra) {
  const edits = Array.isArray(fields.edits) ? fields.edits : [];
  const path = fields.path;
  const editTools = tools.filter((t) => ["edit", "edit-many"].includes(String(kindOfName(t.name))));
  // Order: for one edit, the pair shapes first; for several, the list shapes first.
  const ordered = edits.length <= 1
    ? [...editTools.filter((t) => kindOfName(t.name) === "edit"), ...editTools.filter((t) => kindOfName(t.name) === "edit-many")]
    : [...editTools.filter((t) => kindOfName(t.name) === "edit-many"), ...editTools.filter((t) => kindOfName(t.name) === "edit")];
  for (const t of ordered) {
    const props = t.schema?.properties && typeof t.schema.properties === "object" ? t.schema.properties : {};
    if (path !== undefined && !PATH.some((a) => Object.prototype.hasOwnProperty.call(props, a))) continue;
    const pathProp = PATH.find((a) => Object.prototype.hasOwnProperty.call(props, a));
    // A list tool (ours, Claude Code's MultiEdit): the field's schema is an array-of-objects. Map each item into
    // the schema's item words.
    const listSchema = props.edits;
    if (listSchema && (listSchema.type === "array" || listSchema.items)) {
      const itemProps = listSchema.items?.properties && typeof listSchema.items.properties === "object" ? listSchema.items.properties : {};
      const oldKey = ["oldText", "old_string"].find((k) => Object.prototype.hasOwnProperty.call(itemProps, k));
      const newKey = ["newText", "new_string"].find((k) => Object.prototype.hasOwnProperty.call(itemProps, k));
      if (!oldKey || !newKey) continue;
      // An edit that replaces every occurrence goes only where the item can say so: one replacement for many is a
      // different edit.
      const allKey = ["replaceAll", "replace_all"].find((k) => Object.prototype.hasOwnProperty.call(itemProps, k));
      if (!allKey && edits.some((/** @type {any} */ e) => e.replaceAll)) continue;
      const items = edits.map((/** @type {any} */ e) => ({ [oldKey]: e.oldText, [newKey]: e.newText, ...(e.replaceAll && allKey ? { [allKey]: true } : {}) }));
      if (items.some((/** @type {any} */ i) => i[oldKey] === undefined)) continue;
      const input = { ...(pathProp && path !== undefined ? { [pathProp]: path } : {}), edits: items };
      const required = new Set(Array.isArray(t.schema?.required) ? t.schema.required : []);
      if ([...required].some((r) => input[r] === undefined)) continue;
      if (extraLost(extra, props, KINDS.edit.cosmetic)) continue;
      return { name: String(t.name), input };
    }
    // A pair tool (Claude Code's Edit, ours with one item collapsed): only one edit fits. A call whose pair is
    // incomplete, or that leaves the target's required fields unfilled, refuses rather than guess.
    if (edits.length !== 1 || edits[0].oldText === undefined || edits[0].newText === undefined) continue;
    const oldKey = ["old_string", "oldText"].find((k) => Object.prototype.hasOwnProperty.call(props, k));
    const newKey = ["new_string", "newText"].find((k) => Object.prototype.hasOwnProperty.call(props, k));
    if (!oldKey || !newKey) continue;
    const allKey = ["replace_all", "replaceAll"].find((k) => Object.prototype.hasOwnProperty.call(props, k));
    if (!allKey && edits[0].replaceAll) continue;
    const required = new Set(Array.isArray(t.schema?.required) ? t.schema.required : []);
    const input = {
      ...(pathProp && path !== undefined ? { [pathProp]: path } : {}),
      [oldKey]: edits[0].oldText,
      [newKey]: edits[0].newText,
      ...(edits[0].replaceAll && allKey ? { [allKey]: true } : {}),
    };
    if ([...required].some((r) => input[r] === undefined)) continue;
    if (extraLost(extra, props, KINDS.edit.cosmetic)) continue;
    return { name: String(t.name), input };
  }
  return null;
}

/** The todo call, bespoke: the item field's name and the status words follow the target's vocabulary. */
function buildTodo(fields, tools, extra) {
  const items = Array.isArray(fields.items) ? fields.items : [];
  const ordered = [...tools.filter((t) => kindOfName(t.name) === "todo")];
  for (const t of ordered) {
    const name = String(t.name);
    const props = t.schema?.properties && typeof t.schema.properties === "object" ? t.schema.properties : {};
    const itemsProp = ["items", "todos"].find((k) => Object.prototype.hasOwnProperty.call(props, k));
    const arrSchema = itemsProp ? props[itemsProp] : null;
    if (!itemsProp || !arrSchema || (arrSchema.type !== "array" && !arrSchema.items)) continue;
    const itemProps = arrSchema.items?.properties && typeof arrSchema.items.properties === "object" ? arrSchema.items.properties : {};
    const textKey = ["text", "content"].find((k) => Object.prototype.hasOwnProperty.call(itemProps, k));
    if (!textKey) continue;
    // The status words follow the target's schema, never its name: an enum naming in_progress/completed speaks
    // Claude Code's words; one naming doing speaks ours; no enum falls back to the tool's name.
    const statusEnum = Array.isArray(itemProps.status?.enum) ? itemProps.status.enum.map(String) : null;
    const cc = statusEnum ? statusEnum.includes("in_progress") || statusEnum.includes("completed") : name === "TodoWrite";
    const items2 = items.map((/** @type {any} */ it) => {
      const status = cc ? outWords(it.status) : it.status;
      if (status == null || (statusEnum && !statusEnum.includes(String(status)))) return null;
      /** @type {Record<string, any>} */
      const out = { [textKey]: it.text, ...(itemProps.status ? { status } : {}) };
      if (Object.prototype.hasOwnProperty.call(itemProps, "activeForm")) out.activeForm = it.text;
      return out;
    });
    if (items2.some((/** @type {any} */ x) => !x)) continue; // a status word with no equivalent in that vocabulary
    // A target requiring anything beyond the list itself refuses: this builder fills only the list.
    const required = Array.isArray(t.schema?.required) ? t.schema.required : [];
    if (required.some((r) => r !== itemsProp)) continue;
    if (extraLost(extra, props, KINDS.todo.cosmetic)) continue;
    return { name, input: { [itemsProp]: items2 } };
  }
  return null;
}

/** Would carrying `extra` lose a field the target has no property for (and is not cosmetic)? */
function extraLost(extra, props, cosmetic) {
  for (const [k, v] of Object.entries(extra)) {
    if (v === undefined || v === null) continue;
    if (!Object.prototype.hasOwnProperty.call(props, k) && !(cosmetic || []).includes(k)) return true;
  }
  return false;
}

// ---- cards (D8) ------------------------------------------------------------------------------------------------
// What the harness draws for one tool call, whatever vocabulary spoke it. `kind` is the renderer's word (`cardOf`'s
// switch maps each canonical kind to one; `other` for the rest); `title` the verb line; `subject` the target — the
// path, the command, the pattern — already read through the aliases, so the renderer never guesses by name.

/** One line of a subject, whole. @param {any} v */
const line = (v) => String(v ?? "").split("\n")[0].trim();
/** One line of a subject, clipped. @param {any} v */
const one = (v) => {
  const s = line(v);
  return s.length > 90 ? s.slice(0, 89) + "…" : s;
};

/** The shells a command comes wrapped in, by their program's name. */
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "fish"]);
const POWERSHELLS = new Set(["powershell", "pwsh"]);
/** A POSIX shell's options that take a value before its script. */
const SHELL_VALUED = new Set(["-o", "-O", "--rcfile", "--init-file"]);
/** PowerShell's switches before its -Command: the ones that take a value, and the bare ones. */
const PS_VALUED = new Set(["-executionpolicy", "-ep", "-windowstyle", "-workingdirectory", "-wd", "-version", "-inputformat", "-outputformat", "-configurationname"]);
const PS_BARE = new Set(["-noprofile", "-nop", "-noninteractive", "-noni", "-nologo", "-sta", "-mta"]);

/**
 * A command line's words, each with where it starts: quotes group ('…' as it is; "…" with \" and \\ read as the
 * character), and a backslash outside quotes stays, so a Windows path keeps its own. Null when a quote never closes.
 * @param {string} s
 * @returns {{ text: string, start: number }[] | null}
 */
function wordsOf(s) {
  /** @type {{ text: string, start: number }[]} */
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    const start = i;
    let text = "";
    while (i < s.length && !/\s/.test(s[i])) {
      if (s[i] === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) return null;
        text += s.slice(i + 1, end);
        i = end + 1;
      } else if (s[i] === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') {
          const escaped = s[j] === "\\" && (s[j + 1] === '"' || s[j + 1] === "\\");
          text += escaped ? s[j + 1] : s[j];
          j += escaped ? 2 : 1;
        }
        if (j >= s.length) return null;
        i = j + 1;
      } else text += s[i++];
    }
    out.push({ text, start });
  }
  return out;
}

/**
 * The command a shell was handed, when the line is only that shell and its script; null otherwise. A POSIX shell's
 * script must be its last word (arguments after it change what it means); PowerShell's -Command and cmd's /c take
 * the rest of the line. A script file (`-File`, `bash x.sh`) is not unwrapped.
 * @param {string} s
 * @returns {string | null}
 */
function unwrapShell(s) {
  const words = wordsOf(s);
  if (!words?.length) return null;
  const program = (words[0].text.split(/[\\/]/).pop() || "").toLowerCase().replace(/\.exe$/, "");
  /** The rest of the line from word k: one word as it reads unquoted, several as written. @param {number} k */
  const rest = (k) => (k >= words.length ? null : k === words.length - 1 ? words[k].text : s.slice(words[k].start));
  for (let k = 1; k < words.length; k++) {
    const w = words[k].text;
    const lower = w.toLowerCase();
    if (POSIX_SHELLS.has(program)) {
      if (w === "--command" || /^-[a-zA-Z]*c[a-zA-Z]*$/.test(w)) return k + 2 === words.length ? words[k + 1].text : null;
      if (SHELL_VALUED.has(w)) k++;
      else if (!w.startsWith("-")) return null;
    } else if (POWERSHELLS.has(program)) {
      if (lower === "-c" || (lower.length >= 4 && "-command".startsWith(lower))) return rest(k + 1);
      if (PS_VALUED.has(lower)) k++;
      else if (!PS_BARE.has(lower)) return null;
    } else if (program === "cmd") {
      if (lower === "/c") return rest(k + 1);
      // Its other switches, valued ones included (`/v:on`, `/t:0a`).
      if (!/^\/[a-z](?::\w+)?$/.test(lower)) return null;
    } else return null;
  }
  return null;
}

/**
 * A leading change of folder, its folder and what follows it: `cd X`, `cd /d X`, `pushd X`, PowerShell's
 * `Set-Location X`, alone or before `&&`, `;` or a line break.
 */
const CD_HEAD = /^(?:cd(?:\s+\/d)?|pushd|set-location|push-location|sl)\s+(?:-(?:literal)?path\s+)?("[^"]*"|'[^']*'|[^\s;&|]+)\s*(?:(?:&&|;|\n)\s*([\s\S]*))?$/i;
/** A command that begins by changing folder, read or not. */
const CD_WORD = /^(?:cd|pushd|set-location|push-location|sl)(?:\s|$)/i;

/** A command without the shells that wrap it (`bash -lc '…'`, `powershell -Command "…"`), at most three. @param {string} command */
const unwrapped = (command) => {
  let s = String(command ?? "").trim();
  for (let depth = 0; depth < 3; depth++) {
    const inner = unwrapShell(s)?.trim();
    if (!inner) break;
    s = inner;
  }
  return s;
};

/**
 * The folders a command's leading changes of folder take it to, in order, as written (their quotes off): `cd X &&`,
 * `cd X;`, `cd X` alone or before a line break, `pushd X`, PowerShell's `Set-Location X;` — the shell that wraps it
 * left out (HarnessV4_Git_Plan GW-D64). [] when it begins with none; null when it begins with one whose folder cannot
 * be read here (`cd $DIR && …`, `cd x || exit`): where it runs is not known.
 * @param {string} command
 * @returns {string[] | null}
 */
export function leadingFolders(command) {
  let s = unwrapped(command);
  /** @type {string[]} */
  const folders = [];
  for (let depth = 0; depth < 3 && s; depth++) {
    const m = CD_HEAD.exec(s);
    if (!m) return CD_WORD.test(s) ? null : folders;
    folders.push(m[1].replace(/^(["'])([\s\S]*)\1$/, "$2"));
    s = (m[2] || "").trim();
  }
  return folders;
}

/**
 * A command as its card reads it (HarnessV3-ACP AC1-6): without the shell that wraps it — `bash -lc '…'`,
 * `powershell -NoProfile -Command "…"`, `cmd /d /s /c "…"` — and without a leading change of folder (`cd X &&`). A
 * line the rules do not fit stays as it is; the call's own command is still whole where its card opens.
 * @param {string} command
 * @returns {string}
 */
export function commandLabel(command) {
  const whole = String(command ?? "").trim();
  let s = unwrapped(whole);
  for (let depth = 0; depth < 3; depth++) {
    const rest = CD_HEAD.exec(s)?.[2]?.trim();
    if (!rest) break;
    s = rest;
  }
  return s || whole;
}

/** Claude Code's TaskUpdate changes one task of its plan: its card is a plan's, though no plan list translates to it. */
const PLAN_STEP_NAMES = new Set(["TaskUpdate"]);

/**
 * Claude desktop's picture tool, as a chat made in its Code tab and imported from Claude Code holds its calls
 * (HarnessV4_Visuals_Plan VC-74): a picture (`show_widget`, its code in `widget_code`) and its guide (`read_me`, the
 * `modules` it was read for), each over an MCP server whose name may differ. They read as Filament's own two.
 * @param {string} name @param {any} input @returns {"visual" | "visual-guide" | null}
 */
function desktopVisualKind(name, input) {
  if (/^mcp__.+__show_widget$/.test(name) && typeof input?.widget_code === "string") return "visual";
  if (/^mcp__.+__read_me$/.test(name) && Array.isArray(input?.modules)) return "visual-guide";
  return null;
}

/** Filament's artifact tool's actions, each → its call's title: an action the model made up is no title. */
const ARTIFACT_TITLES = new Map([
  ["guide", "Read the artifact guide"],
  ["publish", "Publish"],
  ["read", "Read an artifact"],
  ["list", "List artifacts"],
  ["read_db", "Read an artifact's data"],
  ["write_db", "Change an artifact's data"],
]);

/** Filament's space tool's actions, each → its call's title: an action the model made up is no title. */
const SPACE_TITLES = new Map([
  ["read", "Read the Space"],
  ["add", "Add a task"],
  ["take", "Take a task"],
  ["move", "Move a task"],
  ["log", "Write in the logbook"],
  ["guide", "Read the Space guide"],
  ["draft", "Write a draft"],
  ["routine", "Propose a routine"],
  ["repro", "Report a reproduction"],
]);

/**
 * The task graph's actions, each → its call's title for one task and for several (E40, TG3): an action the model made
 * up is no title; one said another way is read as Filament reads it (`ACTION_WORDS`).
 */
const TASK_TITLES = new Map([
  ["add", ["Add a task", "Add tasks"]],
  ["start", ["Start a task", "Start tasks"]],
  ["pause", ["Pause a task", "Pause a task"]],
  ["done", ["Mark a task done", "Mark a task done"]],
  ["change", ["Change a task", "Change tasks"]],
  ["drop", ["Drop a task", "Drop tasks"]],
  ["close", ["Close the task graph", "Close the task graph"]],
  ["show", ["Read the task graph", "Read the task graph"]],
  ["keep", ["Keep it with the graph", "Keep it with the graph"]],
  ["read", ["Read what the graph keeps", "Read what the graph keeps"]],
  ["find", ["Find in the task graph", "Find in the task graph"]],
  ["note", ["Send a note to a task's agent", "Send a note to a task's agent"]],
  ["merge", ["Merge a task as it stands", "Merge a task as it stands"]],
]);

/**
 * A task graph call's card (E40, TG3): what it does and to which tasks — each task its id and name, a done its
 * summary, a pause its checkpoint (E41 P1), a keep what it keeps and behind which task, a close its outcome. The call read as Filament reads it
 * (`asMeant`): tasks as JSON text or one task alone, ids as text, a summary or a name under another word.
 * @param {any} given @returns {{ kind: string, title: string, subject: string }}
 */
function tasksCard(given) {
  const input = /** @type {any} */ (asMeant(given, { crew: "agent" }).input);
  const raw = String(input?.action ?? "").trim().toLowerCase();
  const action = TASK_TITLES.has(raw) ? raw : "";
  const list = Array.isArray(input?.tasks) ? input.tasks : [];
  const rawIds = Array.isArray(input?.ids) ? input.ids : input?.id != null && input.id !== "" ? [input.id] : [];
  const ids = rawIds.map((/** @type {unknown} */ x) => String(x).trim()).filter(Boolean);
  const named = list.filter((t) => t && typeof t === "object").map((t) => [t.id, t.name ?? t.title].filter((x) => x != null && x !== "").join(" "));
  const behind = ids.length ? `behind ${ids[0]}` : "behind the graph";
  const kept = [typeof input?.title === "string" && input.title.trim() ? `“${input.title.trim()}”` : "", Array.isArray(input?.files) && input.files.length ? `${input.files.length} file${input.files.length === 1 ? "" : "s"}` : "", typeof input?.picture === "string" && input.picture.trim() ? `a picture` : "", Array.isArray(input?.forget) && input.forget.length ? `forget ${input.forget.length}` : ""].filter(Boolean).join(", ");
  const subject =
    action === "add" || action === "change" ? named.join(" · ") || (action === "change" && input?.goal ? "the goal" : "")
    : action === "done" ? [ids[0], input?.summary].filter(Boolean).join(": ")
    : action === "pause" ? [ids[0], input?.checkpoint].filter(Boolean).join(": ")
    : action === "close" || action === "drop" ? [ids.join(", "), input?.reason].filter(Boolean).join(": ")
    : action === "note" ? [ids[0], input?.note].filter(Boolean).join(": ")
    : action === "keep" || action === "read" ? [kept, behind].filter(Boolean).join(" ")
    : action === "find" ? [typeof input?.words === "string" ? `“${input.words.trim()}”` : "", ids[0] ? `in ${ids[0]}` : ""].filter(Boolean).join(" ")
    : ids.join(", ");
  const many = (action === "add" || action === "change" ? list.length : ids.length) > 1;
  const titles = TASK_TITLES.get(action);
  return { kind: "tasks", title: titles ? titles[many ? 1 : 0] : "Task graph", subject: one(subject) };
}

/** Claude desktop's artifact tool's actions, each → its call's title. */
const CLAUDE_ARTIFACT_TITLES = new Map([
  ["publish", "Publish on claude.ai"],
  ["quickstart", "Read the artifact guide on claude.ai"],
  ["list", "List artifacts on claude.ai"],
  ["read", "Read an artifact on claude.ai"],
  ["open", "Open an artifact on claude.ai"],
  ["pin", "Pin an artifact on claude.ai"],
  ["unpin", "Unpin an artifact on claude.ai"],
  ["delete", "Delete an artifact on claude.ai"],
]);

/** A path's last part, by either slash: a file's name. @param {unknown} p */
const fileName = (p) => (typeof p === "string" ? p.split(/[\\/]/).filter(Boolean).pop() || "" : "");

/**
 * The title of our `agent` tool's stop of a sub-agent (agent_id with stop: true): the page knows such a call by it — its
 * row (ui/harness/conversation/tools/render.js `SUBAGENT_STOP`) and the live fold's line (ui/harness/lib/labels.js
 * `callWords`) — so it reads as a stop, never as a launch or a follow-up.
 */
const SUBAGENT_STOP = "Stop sub-agent";

/** The most of a memory call's words its card keeps whole: a procedure, a fact, a correction. */
const MEMORY_WHOLE_CHARS = 4000;

/**
 * A memory tool's card (the owner's of 10-28: "i wanna know the content what you are trying to remember ... maybe for
 * memory tool i could see both input and output"): its subject what it looks for or keeps — its query, its words, the
 * chat it loads, the memory it acts on — those words whole, and the rest of its input in a line ("kind: procedure"),
 * redacted. A call that came with no input is named by its tool, as it was.
 * @param {string} n @param {any} input
 */
function memoryCard(n, input) {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const key = ["query", "text", "session", "id"].find((k) => i[k] != null && String(i[k]).trim());
  if (!key) return { kind: "other", title: n || "tool", subject: n || "" };
  const words = redactSecrets(String(i[key]));
  const given = Object.entries(i)
    .filter(([k, v]) => k !== key && v != null && v !== "")
    .map(([k, v]) => `${k}: ${one(typeof v === "string" ? v : JSON.stringify(v))}`)
    .join(" · ");
  return {
    kind: "other",
    title: n || "tool",
    subject: one(words),
    whole: words.length > MEMORY_WHOLE_CHARS ? words.slice(0, MEMORY_WHOLE_CHARS - 1) + "…" : words,
    ...(given ? { given: redactSecrets(given) } : {}),
  };
}

/** How long, in a card's words: "1 min", "15 min", "1 h", "1 h 5 min" — as the come-back's answer says it. @param {number} s */
const spanWords = (s) => {
  const m = Math.max(1, Math.round(s / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
};

/** The language server's asks (app/agent/lsp-tool.js), each as its card's title. */
const LSP_TITLES = new Map([["definition", "Definition"], ["type_definition", "Type definition"], ["implementation", "Implementation"], ["references", "References"], ["hover", "Hover"], ["symbols", "Symbols"], ["workspace_symbols", "Workspace symbols"], ["diagnostics", "Problems"]]);
/**
 * What an `lsp` call asks of, in words: the name and its place ("greet in app.py:8"), the name looked for across the
 * project, or the file.
 * @param {any} input
 */
export function lspSubject(input) {
  const i = input && typeof input === "object" ? input : {};
  const path = typeof i.path === "string" ? i.path.trim().replace(/\\/g, "/") : "";
  const action = String(i.action ?? "").trim().toLowerCase();
  if (action === "workspace_symbols") return one(i.query ?? "");
  if (action === "symbols" || action === "diagnostics" || i.line == null) return one(path);
  const name = typeof i.symbol === "string" && i.symbol.trim() ? i.symbol.trim() : i.column != null ? `column ${i.column}` : "";
  return one(`${name ? `${name} in ` : ""}${path}:${i.line}`);
}
/**
 * An `lsp` call's card: its ask as the title. The places it leads to draw as a search's hits, a file's symbols and
 * problems as a listing's, a hover as what arrived.
 * @param {any} input
 */
const lspCard = (input) => {
  const action = String(input?.action ?? "").trim().toLowerCase();
  const kind = action === "hover" ? "other" : action === "symbols" || action === "diagnostics" ? "list" : "search";
  return { kind, title: LSP_TITLES.get(action) || "Language server", subject: lspSubject(input) };
};

/**
 * One tool call's card (D8), in any vocabulary: `{ kind, title, subject }`. The title is the running verb the row
 * shows, the subject the target it names. A call the table does not know (MCP, an unknown tool) is `mcp`/`other`
 * with the tool's own name as its subject — named, never guessed. A memory tool's card also keeps its words whole
 * (`whole`) and the rest of its input (`given`), which its pill shows opened (`memoryCard`).
 * @param {string} name @param {any} input
 * @returns {{ kind: string, title: string, subject: string, whole?: string, given?: string }}
 */
export function cardOf(name, input) {
  // A coding agent calls Filament's own tools by their MCP names: each cards as Filament's tool, as a running turn's call
  // does (app/agent-run.js), so a turn redrawn from its messages never folds one with an MCP server's (the Hunter on E40).
  const n = String(name || "").replace(/^mcp__filament__/, "");
  // A call through Filament's mcp tool (E49) cards as the server's tool it calls, as it ran; its find and load by what
  // they looked for.
  const door = doorCall(n, input);
  if (door) return "call" in door ? cardOf(door.call.name, door.call.input) : { kind: "mcp", title: door.title, subject: door.subject };
  // A skill loaded — Filament's skill tool (HarnessV4_SpacesPlugins_Plan B4), Claude Code's Skill — by its name.
  // Filament's also lists, reads and finds in a skill's folder (HarnessV4_Skills_Plan S1-5).
  if (n === "skill" || n === "Skill") {
    const who = String(input?.name ?? input?.skill ?? "");
    const act = n === "skill" ? String(input?.action ?? "").toLowerCase() : "";
    if (act === "list" || act === "read" || act === "find") {
      const what = act === "find" ? String(input?.words ?? "") : String(input?.path ?? "");
      return { kind: "other", title: act === "list" ? "List skill files" : act === "read" ? "Read skill file" : "Search skill", subject: one(what ? `${who} · ${what}` : who) };
    }
    return { kind: "other", title: "Load skill", subject: one(who) };
  }
  // Claude Code's ToolSearch loads the tools it holds back until asked for, by name (`select:A,B`), or looks for them
  // by words — what Filament's mcp tool's load and find do, carded alike (the owner's of 10-31: its row named nothing
  // but itself); Filament's own tools by their own names, as a call of one cards.
  if (n === "lsp") return lspCard(input);
  if (n === "ToolSearch") {
    const query = line(input?.query);
    const picked = /^select:/i.test(query) ? query.slice("select:".length).split(",").map((t) => t.trim().replace(/^mcp__filament__/, "")).filter(Boolean) : null;
    return picked ? { kind: "other", title: "Load tools", subject: picked.join(", ") } : { kind: "other", title: "Look for tools", subject: query };
  }
  const kind = kindOfName(n) || (PLAN_STEP_NAMES.has(n) ? "todo" : null) || desktopVisualKind(n, input);
  if (kind === "memory") return memoryCard(n, input);
  if (!kind) return { kind: /^mcp__/.test(n) ? "mcp" : "other", title: n || "tool", subject: n || "" };
  const canon = canonicalOf(n, input) || { kind, fields: /** @type {Record<string, any>} */ ({}), extra: /** @type {Record<string, any>} */ ({}) };
  const f = /** @type {Record<string, any>} */ (canon.fields);
  switch (kind) {
    // A file's path stays whole: the card names its file by it (relative to the working folder, where it is inside),
    // finds the file's diff and counts the files it changed; the page cuts it short where it is drawn.
    case "read":
      return { kind: "read", title: "Read", subject: line(f.path) };
    case "write":
      return { kind: "write", title: "Write", subject: line(f.path) };
    case "edit":
    case "edit-many":
      return { kind: "edit", title: "Edit", subject: line(f.path) };
    case "shell":
    case "shell-background":
      return {
        kind: "shell",
        title: { bash_background: "Run in background", bash_output: "Read output", bash_kill: "Stop" }[n] || (kind === "shell-background" ? "Run in background" : "Run"),
        subject: one(f.command != null ? commandLabel(f.command) : f.id),
      };
    case "search":
      return { kind: "search", title: "Search", subject: one(f.pattern) };
    case "list":
      return { kind: "list", title: "List", subject: one(f.pattern) };
    case "todo": {
      // A list counts its items; Claude Code's task tools change one task at a time: TaskCreate names the task it
      // adds, TaskUpdate the task it changes and what became of it.
      const list = input?.items ?? input?.todos;
      if (!Array.isArray(list) && (input?.subject != null || input?.taskId != null))
        return { kind: "todo", title: "Plan", subject: one(input.subject ?? `task ${input.taskId}${input.status ? `: ${inWords(input.status)}` : ""}`) };
      const count = (f.items || []).length;
      return { kind: "todo", title: "Plan", subject: `${count} item${count === 1 ? "" : "s"}` };
    }
    case "web-fetch":
      return { kind: "web", title: "Fetch", subject: one(f.url) };
    case "web-search":
      return { kind: "web", title: "Search the web", subject: one(f.query) };
    case "image":
      return { kind: "image", title: "Generate an image", subject: one(input?.description ?? input?.prompt ?? "") };
    // A visual by its title, never its code; its guide by the kinds it was read for.
    case "visual":
      return { kind: "visual", title: "Draw", subject: one(input?.title ?? "") };
    case "visual-guide": {
      const kinds = input?.kinds ?? input?.modules;
      return { kind: "visual-guide", title: "Read the visual guide", subject: one((Array.isArray(kinds) ? kinds : [kinds]).filter((k) => k != null && k !== "").join(", ")) };
    }
    // An artifact's call by what it does, and the artifact by its title or its name — never its page.
    case "artifact": {
      const action = String(input?.action ?? "");
      const title = ARTIFACT_TITLES.get(action) || "Artifact";
      const subject = action === "guide" ? input?.type || "page" : action === "list" ? (input?.query ?? "") : (input?.title || input?.id || "");
      return { kind: "artifact", title, subject: one(subject) };
    }
    case "tasks":
      return tasksCard(input);
    // The Space's call by what it does: the task by its title or id, a logbook line by its words, the guide by its
    // topic, a guided action by its title, a draft and where it goes — its fields read as the tool reads them, in
    // `with` (an object or JSON text of one) or beside `action` (E39).
    case "space": {
      const w = spaceFields(input) ?? (input && typeof input === "object" ? input : {});
      const action = String(w.action ?? "").trim().toLowerCase();
      // The routine action by what the call does (the space tool's `routine`): a watcher's guidance sent, by its
      // words; one paused, with the line on why; one run now; Pause all; else a proposal — a watcher's where it has a
      // trigger.
      if (action === "routine") {
        const said = (/** @type {unknown} */ x) => (typeof x === "string" && x.trim() ? x : "");
        if (said(w.guidance)) return { kind: "space", title: "Send guidance", subject: one(w.guidance.replace(/\s+/g, " ")) };
        if (said(w.pauseAll)) return { kind: "space", title: "Pause all", subject: one(w.pauseAll) };
        if (said(w.pause)) return { kind: "space", title: "Pause a routine", subject: one([w.id, w.pause].filter((x) => x != null && x !== "").join(": ")) };
        if (w.run === true) return { kind: "space", title: "Run a routine now", subject: one(w.id ?? "") };
        return { kind: "space", title: w.trigger && typeof w.trigger === "object" ? "Propose a watcher" : "Propose a routine", subject: one(w.title || w.id || "") };
      }
      const title = SPACE_TITLES.get(action) || "Space";
      const where = action === "draft" ? draftWhere(w) : w.to;
      const subject =
        action === "log" ? w.text
        : action === "add" ? w.title
        : action === "guide" ? w.topic || ""
        : ["draft", "routine", "repro"].includes(action) ? [w.title || w.id, action === "draft" && where ? `→ ${where}` : ""].filter(Boolean).join(" ")
        : [w.id, where ? `→ ${where}` : ""].filter(Boolean).join(" ");
      return { kind: "space", title, subject: one(subject ?? "") };
    }
    // A team beside the chat by what the call does: the team and its ask's first words, the team and its note's to its
    // lead, or how they stand.
    // Its action as the tool takes it (core/beside.js `besideAction`): in any case, and an archived call's `fire`, the
    // act's name before version 123, as send.
    case "team-beside": {
      const action = besideAction(input?.action);
      return action === "send"
        ? { kind: "team-beside", title: "Send a team", subject: one([input?.team, input?.ask].filter((x) => x != null && x !== "").join(": ")) }
        : action === "note"
          ? { kind: "team-beside", title: "Note to a team's lead", subject: one([input?.team, input?.note].filter((x) => x != null && x !== "").join(": ")) }
          : { kind: "team-beside", title: "Teams beside this chat", subject: "" };
    }
    // A flow by what the call does: drawn or changed, by its title; an act on a flow it drives In place (OA4), the box
    // and what it did to it; the offer of Run as a flow (OA6); or how the chat's flows stand.
    case "flow": {
      const action = String(input?.action ?? "");
      if (action === "draft" || action === "edit") return { kind: "flow", title: action === "draft" ? "Draw a flow" : "Change the flow", subject: one(input?.title ?? (Array.isArray(input?.steps) ? `${input.steps.length} steps` : "")) };
      if (action === "stop") return { kind: "flow", title: "Stop the flow", subject: one(input?.why ?? "") };
      if (action === "offer") return { kind: "flow", title: "Offer Run as a flow", subject: "" };
      if (action === "box") {
        const what = String(input?.do ?? "").toLowerCase();
        const box = String(input?.box ?? "");
        const verb = /** @type {Record<string, string>} */ ({ stop: "Stop", skip: "Skip", retry: "Retry", go: "Go on past" })[what];
        return { kind: "flow", title: "Act on the flow", subject: one(what === "back" ? `Send ${input?.to ?? "a box"} back from ${box}` : verb ? `${verb} ${box}` : box) };
      }
      return { kind: "flow", title: "Flows beside this chat", subject: "" };
    }
    // A thread the main agent starts (app/threads.js): by its title, or its brief's first line.
    case "thread":
      return { kind: "thread", title: "Start a thread", subject: one(input?.title || (String(input?.brief ?? "").split("\n").find((l) => l.trim()) ?? "")) };
    // The chat's own agent coming back later (the Designer's of 10-27): when, as it asked, and its note's first line —
    // or its Cancel of the one it set.
    case "come-back": {
      if (input?.cancel === true) return { kind, title: "Cancel coming back", subject: "" };
      const s = Number(input?.seconds);
      const when = input?.seconds != null && Number.isFinite(s) ? `in ${spanWords(s)}` : "";
      return { kind, title: "Come back later", subject: one([when, String(input?.note ?? "").trim()].filter(Boolean).join(": ")) };
    }
    // Claude desktop's: what the call does on claude.ai, and the page by its title, its file's name or its address —
    // the row links the address (HarnessV4_Artifacts_Plan AFC-150..AFC-152). A publish names no action.
    case "claude-artifact": {
      const action = String(input?.action ?? "publish");
      const title = action === "publish" && input?.asset ? "Upload to an artifact on claude.ai" : CLAUDE_ARTIFACT_TITLES.get(action);
      if (!title) return { kind, title: "Artifact on claude.ai", subject: one(action) };
      const files = Array.isArray(input?.file_paths) ? input.file_paths : [];
      const page = input?.title || fileName(input?.file_path) || (files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "") || input?.url;
      return { kind, title, subject: one(action === "quickstart" ? input?.intent : action === "list" ? input?.type || input?.scope : page) };
    }
    case "ask": {
      // One question, or several at once (Claude Code's AskUserQuestion; Cursor's askQuestion, under its title).
      const first = Array.isArray(input?.questions) ? input.questions[0] : null;
      return { kind: "ask", title: "Ask", subject: one(f.question ?? input?.prompt ?? input?.title ?? first?.question ?? first?.prompt ?? "") };
    }
    case "proposal":
      // Its name (Cursor's), else the plan's first line without its heading's marks (Claude Code's).
      return { kind: "proposal", title: "Propose a plan", subject: one(input?.name ?? (String(input?.plan ?? "").split("\n").find((l) => l.trim()) ?? "").replace(/^#+\s*/, "")) };
    case "subagent":
      // Our `agent` stopping a sub-agent (agent_id with stop: true) launches nothing and follows nothing up: whom it
      // stops, under a title that says so (`SUBAGENT_STOP`), which the page's row and the live fold read.
      if (n === "agent" && input?.stop === true && input?.agent_id) return { kind: "subagent", title: SUBAGENT_STOP, subject: one(input.agent_id) };
      // The task in a few words when the call names it (our `agent`, Claude Code's `Task`), else its prompt's head —
      // or, for a lead's `worker` that applies a worker's changes, the worker it names.
      return { kind: "subagent", title: n || "Sub-agent", subject: one(input?.description ?? input?.prompt ?? input?.agent_id ?? input?.question ?? n) };
    default:
      return { kind: "other", title: n || "tool", subject: one(n) };
  }
}

/**
 * The calls a conversation made, each in its card's words, oldest first: "Read src/a.js", "Run npm test", a failed one
 * marked — what a task's next worker reads of an earlier try (HarnessV3-FailurePoints §6 item 3). A call kept by its
 * target alone names it (`keptCardOf`). Secrets redacted.
 * @param {any[] | null | undefined} convo @returns {string[]}
 */
export function callLines(convo) {
  return callsMade(convo).map((c) => {
    const { title, subject } = keptCardOf(c.name, c.input);
    return redactSecrets(`${title}${subject && subject !== title ? ` ${subject}` : ""}${c.ok ? "" : " (failed)"}`);
  });
}

/**
 * The files a conversation's write and edit calls named, each once, as the calls named them (a path relative to the
 * folder the agent worked in, or absolute), in the order first written — a failed call's left out: it wrote nothing.
 * What a worker in the folder itself changed, where no git records it (HarnessV3-FailurePoints §8 item 2).
 * @param {any[] | null | undefined} convo @returns {string[]}
 */
export function pathsWritten(convo) {
  /** @type {Set<string>} */
  const paths = new Set();
  for (const c of callsMade(convo)) {
    const canon = c.ok ? canonicalOf(c.name, c.input) : null;
    const path = canon && (canon.kind === "write" || canon.kind === "edit") ? canon.fields.path : null;
    if (typeof path === "string" && path.trim()) paths.add(path);
  }
  return [...paths];
}

/**
 * The card of a call as Filament kept it. Where its arguments were never known, the call is kept by the one target
 * its card showed while it ran, `{ input: "<target>" }`, which no field of the call's own names — its card would say
 * "Read" and nothing of what it read. Two kinds of call are kept so: one of a turn rebuilt from its run's log, which
 * never holds arguments (core/run-work.js `workOfRun`; HarnessV4_Tasks A2, U1), and one of a coding agent that names
 * a title and a place and no input (app/agent-run.js `rebuilt`; HarnessV4_Tasks B2). Here the card names that
 * target. A call that says its own fields keeps its card.
 * @param {string} name @param {any} input
 * @returns {{ kind: string, title: string, subject: string }}
 */
export function keptCardOf(name, input) {
  const card = cardOf(name, input);
  const keys = input && typeof input === "object" && !Array.isArray(input) ? Object.keys(input) : [];
  const target = keys.length === 1 && keys[0] === "input" && typeof input.input === "string" && input.input.trim() ? input.input : null;
  if (!target || (card.subject && !(card.kind === "subagent" && card.subject === one(String(name || ""))))) return card;
  const whole = card.kind === "read" || card.kind === "write" || card.kind === "edit";
  return { ...card, subject: whole ? line(target) : one(card.kind === "shell" ? commandLabel(target) : target) };
}

/** How much of a tool result the transcript carries per call; `resultChars` says the whole. */
export const RESULT_PREVIEW_CHARS = 2000;

/**
 * A turn's tool calls as cards (D8), from its work messages in either wire format: each call paired with its
 * result by id, in order — `{ id, name, card, input, result, resultChars, isError }`. The result is the result
 * message's text as the client sent it, capped (`resultChars` says the whole) — the transcript's payload must not
 * double a stored megabyte; `isError` only where the format says so (Anthropic's `is_error`). Calls without a
 * result (an interrupted leg) still appear. A call kept by its target alone names it on its card (`keptCardOf`).
 * @param {any[]} messages  the turn's work, in `format`
 * @param {"anthropic" | "openai"} format
 * @returns {{ id: string | null, name: string, card: { kind: string, title: string, subject: string }, input: any, result: string | null, resultChars: number, isError: boolean }[]}
 */
export function toolsOfTurn(messages, format) {
  return callsOf(messages, format).cards;
}

/**
 * `toolsOfTurn`'s cards and, for each, the place in `messages` of the message that made its call.
 * @param {any[]} messages @param {"anthropic" | "openai"} format
 * @returns {{ cards: ReturnType<typeof toolsOfTurn>, at: number[] }}
 */
function callsOf(messages, format) {
  const card = keptCardOf;
  /** @type {any[]} */
  const out = [];
  /** @type {number[]} */
  const at = [];
  const byId = new Map();
  const capped = (s) => {
    const whole = String(s ?? "");
    return whole.length > RESULT_PREVIEW_CHARS ? { result: whole.slice(0, RESULT_PREVIEW_CHARS), resultChars: whole.length } : { result: whole, resultChars: whole.length };
  };
  for (const [i, m] of (Array.isArray(messages) ? messages : []).entries()) {
    if (format === "anthropic" && Array.isArray(m?.content)) {
      for (const b of m.content) {
        if (b?.type !== "tool_use") continue;
        const entry = { id: b.id ?? null, name: String(b.name || ""), card: card(b.name, b.input), input: b.input ?? {}, result: null, resultChars: 0, isError: false };
        out.push(entry);
        at.push(i);
        if (entry.id) byId.set(entry.id, entry);
      }
      for (const r of resultsOf(m, format)) {
        const entry = byId.get(r.id);
        if (entry) {
          Object.assign(entry, capped(r.text));
          entry.isError = r.isError;
        }
      }
      continue;
    }
    if (format === "openai") {
      if (Array.isArray(m?.tool_calls))
        for (const c of m.tool_calls) {
          let input = {};
          try { input = JSON.parse(String(c?.function?.arguments ?? "{}")); } catch { input = {}; }
          const entry = { id: c?.id ?? null, name: String(c?.function?.name || ""), card: card(c?.function?.name, input), input, result: null, resultChars: 0, isError: false };
          out.push(entry);
          at.push(i);
          if (entry.id) byId.set(entry.id, entry);
        }
      for (const r of resultsOf(m, format)) {
        const entry = byId.get(r.id);
        if (entry) Object.assign(entry, capped(r.text));
      }
    }
  }
  return { cards: out, at };
}

/**
 * The tool results one work message carries, each by the id of the call it answers, its text whole: what
 * `toolsOfTurn` cuts to `RESULT_PREVIEW_CHARS`, read the same way, so a card's whole result is the one its preview
 * was cut from (pictures are no part of it). `isError` only where the format says so (Anthropic's `is_error`).
 * @param {any} m @param {"anthropic" | "openai"} format
 * @returns {{ id: string, text: string, isError: boolean }[]}
 */
export function resultsOf(m, format) {
  if (format === "anthropic" && Array.isArray(m?.content))
    return m.content
      .filter((/** @type {any} */ b) => b?.type === "tool_result" && b.tool_use_id)
      .map((/** @type {any} */ b) => ({ id: b.tool_use_id, text: String(textOfMessage(b.content) ?? ""), isError: b.is_error === true }));
  if (format === "openai" && m?.role === "tool" && m.tool_call_id) return [{ id: m.tool_call_id, text: String(textOfMessage(m.content) ?? ""), isError: false }];
  return [];
}

/** A tool call block of a reply: the model's own, or one the provider ran. @param {any} b */
const isCallBlock = (b) => b?.type === "tool_use" || b?.type === "server_tool_use";
/** A message's blocks, whatever its shape: a string is one text. @param {any} m @returns {any[]} */
const blocksOf = (m) => (Array.isArray(m?.content) ? m.content : typeof m?.content === "string" && m.content ? [{ type: "text", text: m.content }] : []);

/**
 * Whether a work message is the model's (a reply, or a Responses call item): what follows it, up to the next one, is
 * what its calls returned. @param {any} m
 */
export const isModelMessage = (m) => m?.role === "assistant" || m?.type === "function_call";

/**
 * A turn's work counted as a page heads it: tool legs (a message of the model's that called tools, one round of the
 * turn's tool loop) and tool calls, in any wire format — Anthropic blocks, OpenAI `tool_calls`, Responses call items.
 * The archive keeps the two on the turn as its work is written (`meta.tally`), so reading them opens no message.
 * @param {any[]} messages @returns {{ legs: number, calls: number }}
 */
export function tallyOfWork(messages) {
  let legs = 0,
    calls = 0;
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m?.type === "function_call") {
      legs++;
      calls++;
      continue;
    }
    if (m?.role !== "assistant") continue;
    const made = (Array.isArray(m.tool_calls) ? m.tool_calls.length : 0) + blocksOf(m).filter(isCallBlock).length;
    if (made) legs++;
    calls += made;
  }
  return { legs, calls };
}

/**
 * What a page draws of one work message: the model's words and thoughts whole, each call as a bare mark (its card is
 * `workSteps`'s), nothing of what a call returned. Null for a message that is not the model's.
 * @param {any} m @returns {{ type: "function_call" } | { role: "assistant", content: any[], tool_calls?: {}[] } | null}
 */
export function saidOf(m) {
  if (m?.type === "function_call") return { type: "function_call" };
  if (m?.role !== "assistant") return null;
  const content = blocksOf(m).flatMap((/** @type {any} */ b) =>
    b?.type === "text" && typeof b.text === "string" && b.text ? [{ type: "text", text: b.text }]
    : b?.type === "thinking" && typeof b.thinking === "string" && b.thinking ? [{ type: "thinking", thinking: b.thinking }]
    : isCallBlock(b) ? [{ type: b.type }]
    : []);
  return { role: "assistant", content, ...(Array.isArray(m.tool_calls) && m.tool_calls.length ? { tool_calls: m.tool_calls.map(() => ({})) } : {}) };
}

/** How many of a turn's work messages one stretch carries; the results of its last calls ride along. */
export const WORK_PAGE = 300;
/** How much of one string of a call's input a stretch of work carries; a cut string says its whole length. */
export const INPUT_PREVIEW_CHARS = 4000;

/**
 * A call's input with every long string cut to its head, the cut said in the string itself, so whatever draws the
 * string says it: a file written whole, a long patch. The archive keeps the input whole.
 * @param {any} input @returns {any}
 */
function cappedInput(input) {
  if (typeof input === "string")
    return input.length > INPUT_PREVIEW_CHARS
      ? `${input.slice(0, INPUT_PREVIEW_CHARS)}\n… (${input.length.toLocaleString("en-US")} characters in all: the first ${INPUT_PREVIEW_CHARS.toLocaleString("en-US")} are shown)`
      : input;
  if (Array.isArray(input)) return input.map(cappedInput);
  if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).map(([k, v]) => [k, cappedInput(v)]));
  return input;
}

/**
 * A stretch of a turn's work as a page draws it, in the order it happened: each message of the model's cut to what
 * it said (`saidOf`), with the calls it made as cards (`tools`: `toolsOfTurn`'s, each paired with what it returned
 * within the stretch, its input's long strings cut). What the calls returned rides in the cards alone.
 * @param {any[]} messages  the stretch, in `format` @param {"anthropic" | "openai"} format
 */
export function workSteps(messages, format) {
  const list = Array.isArray(messages) ? messages : [];
  const { cards, at } = callsOf(list, format);
  return list.flatMap((m, i) => {
    const said = saidOf(m);
    if (!said) return [];
    const tools = cards.filter((_, k) => at[k] === i).map((c) => ({ ...c, input: cappedInput(c.input) }));
    return [tools.length ? { ...said, tools } : said];
  });
}

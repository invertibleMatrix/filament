// @ts-check
// The tools of `/mcp/memory` (HarnessV3-Memory M7-6, M7-D40, M7-D43..D45): memory for an agent Filament does not run.
// Each call stands as `agent` in the project of its folder and, in a session, on the session's chain (kind `mcp`), so
// what it is shown is logged there and a claim retired later reaches it as an erratum at the top of its next call.
// The verbs the models' tools share run `executeMemoryTool`, so the two answer in one format.
import { executeMemoryTool, MEMORY_TOOL_SCHEMAS, searchResults } from "./memory-tools.js";

/** The hands a coding agent has when it names none: their pitfalls come with its brief. */
const CODING_HANDS = Object.freeze(["Bash", "Read", "Edit", "Write"]);
/** The brief the opening words carry, in tokens (M7-D45). */
const OPENING_TOKENS = 600;

const READ = Object.freeze({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
const SAID_ONCE = Object.freeze({ ...READ, idempotentHint: false });
const WRITE = Object.freeze({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
const CWD = Object.freeze({
  type: "string",
  description: "Your working folder, absolute. Leave it out when this session's folder is known: Filament asks your client for its roots.",
});
const ID = Object.freeze({ type: "string", description: "The claim's id, as its line or a search result shows it (i12)." });

/** The tools by their names here, in a shared tool's words or a refusal. @param {string} text */
const shortNames = (text) => text.replace(/filament_memory_(\w+)/g, "`$1`");
/** A shared tool for an agent over MCP, its description and its arguments' words alike. @param {string} name */
const shared = (name) => {
  const s = /** @type {Record<string, { description: string, schema: any }>} */ (MEMORY_TOOL_SCHEMAS)[name];
  return /** @type {{ description: string, schema: any }} */ (JSON.parse(shortNames(JSON.stringify(s))));
};
/** @param {any} schema @param {Record<string, any>} more */
const withProps = (schema, more) => ({ ...schema, properties: { ...schema.properties, ...more } });
/**
 * A shared verb's arguments without `quote` (the memory plan's d1): an outside agent's session holds no words the person
 * typed, so its quote would never be heard. @param {any} schema
 */
const unquoted = (schema) => ({ ...schema, properties: Object.fromEntries(Object.entries(schema.properties).filter(([k]) => k !== "quote")) });

/** @type {readonly { name: string, title: string, description: string, inputSchema: any, annotations: any }[]} */
export const MEMORY_MCP_TOOLS = Object.freeze([
  {
    name: "brief",
    title: "Brief me for a task",
    description:
      "What memory holds for the task you are starting, in this project: the user's rules, the project's dossier, the procedures your task names, the pitfalls of the tools you will use, the open threads on the files it names, and what else matches — each line with its id, its kind and how it is known. Call it first, with your task in a sentence. Memory is background, your task is the instruction: when what you find contradicts a memory, trust what you find and `correct` it.",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "What you are about to do, in a sentence or two; name the files you will touch." },
        tools: { type: "array", items: { type: "string" }, description: `The tools you will use, as you call them (default: ${CODING_HANDS.join(", ")}): their pitfalls come with the brief.` },
        budget: { type: "integer", minimum: 300, maximum: 4000, description: "Tokens the brief may take (default 1500)." },
        cwd: CWD,
      },
      required: ["task"],
    },
    annotations: READ,
  },
  {
    name: "search",
    title: "Search memory",
    description: shared("search").description,
    inputSchema: withProps(shared("search").schema, { cwd: CWD }),
    annotations: READ,
  },
  {
    name: "claim",
    title: "One claim",
    description:
      "One claim by its id: its words, whether it stands, how it is known and how sure memory is of it, its flags, what triggers it, what replaced it and who found it.",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: READ,
  },
  {
    name: "history",
    title: "A claim's history",
    description: "A claim's history: every change, with who made it, why and when, and the claims it replaced or that replaced it.",
    inputSchema: { type: "object", properties: { id: ID }, required: ["id"] },
    annotations: READ,
  },
  {
    name: "pitfalls",
    title: "Before a call",
    description:
      "Before you run a command or touch a file: what memory knows about that call — the pitfalls the user or past sessions hit with it, and the right way, and the open threads on its files. A pitfall with a right way is said each time a call does it the wrong way; anything else, once in this session.",
    inputSchema: {
      type: "object",
      properties: {
        tool: { type: "string", description: "The tool you will call, as you call it: Bash, Edit, Write, Read…" },
        input: { type: "object", description: "Its arguments as you will send them: { command } for a shell, { file_path } for a file." },
        cwd: CWD,
      },
      required: ["tool", "input"],
    },
    annotations: SAID_ONCE,
  },
  {
    name: "questions",
    title: "Memory's questions",
    description:
      "What memory asks the user before it changes their own word, in this project and everywhere. Read only: tell the user; they answer in Filament's console.",
    inputSchema: { type: "object", properties: { cwd: CWD } },
    annotations: READ,
  },
  { name: "sessions", title: "Find past sessions", description: shared("sessions").description, inputSchema: shared("sessions").schema, annotations: READ },
  { name: "load", title: "Load a past session", description: shared("load").description, inputSchema: shared("load").schema, annotations: READ },
  {
    name: "remember",
    title: "Remember",
    description: `${shared("remember").description} Filed in the project of your folder; a claim that holds in every project (about the user, not a codebase) with scope "global".`,
    inputSchema: withProps(unquoted(shared("remember").schema), {
      scope: { type: "string", enum: ["project", "global"], description: "project (the default): filed in the project of your folder. global: holds in every project." },
      cwd: CWD,
    }),
    annotations: WRITE,
  },
  { name: "correct", title: "Correct a claim", description: shared("correct").description, inputSchema: unquoted(shared("correct").schema), annotations: WRITE },
  { name: "close", title: "Close an open thread", description: shared("close").description, inputSchema: shared("close").schema, annotations: { ...WRITE, idempotentHint: true } },
  { name: "confirm", title: "Confirm a claim", description: shared("confirm").description, inputSchema: shared("confirm").schema, annotations: { ...WRITE, idempotentHint: true } },
  { name: "forget", title: "Retire a claim", description: shared("forget").description, inputSchema: shared("forget").schema, annotations: WRITE },
]);

const GUIDE = [
  "Filament's memory: what the user and their past sessions established, across their projects and every agent they use — rules, preferences, decisions, procedures, pitfalls and open threads — each claim with an id (i12) and how it is known.",
  "- Start a task with `brief`, your task in a sentence.",
  "- Before a command or an edit that may have bitten before, ask `pitfalls`.",
  "- Cite a claim by its id. When one proves wrong, `correct` it: a second note beside it leaves both standing. When one proves right, `confirm` it. When you finish the work of an open thread, `close` it.",
  "- `remember` what the user asks you to keep, and what you established that a later session needs.",
  "- A memory describes the moment it was recorded: when what you find contradicts it, trust what you find, and correct it.",
  "- When memory corrects something it told you in this session, the next answer opens with it.",
].join("\n");
const NO_FOLDER =
  "This session names no folder: pass your working folder as `cwd`, or memory reads every project and files nothing in one.";

/** Why memory cannot answer now, or "". @param {any} memory */
function closedWhy(memory) {
  if (!memory.enabled?.()) return "memory is off in Filament's settings";
  if (!memory.isOpen?.()) return memory.archiveWhy();
  return "";
}
/**
 * Where a call stands (`mcpStand`): the project of its folder and the session's chain, each made on first use
 * (M7-D40), and a handle as an agent there; what it stores or corrects is its finding, named for its client (M7-D47).
 * `global`: a write that holds in every project. `chain: false`: a read logged nowhere. A caller that reaches its own
 * project's sessions alone (`where.confined`) gets a handle that keeps to them.
 * @param {any} memory @param {{ folder: string, key: string | null, client: string, meta: any, confined?: boolean }} where
 * @param {{ global?: boolean, chain?: boolean }} [o]
 */
function standing(memory, where, { global = false, chain = true } = {}) {
  const at = memory.mcpStand({ key: chain ? where.key : null, cwd: where.folder, client: where.client, meta: where.meta ? { mcp: where.meta } : null });
  const finder = { agent: where.client.replace(/^mcp:/, ""), type: "MCP" };
  return memory.scope({ role: "agent", project: global ? null : at?.project ?? null, chain: at?.chain ?? null, client: where.client, finder, confined: !!where.confined });
}
/** @param {unknown} tools */
const handsOf = (tools) => {
  const list = Array.isArray(tools) ? tools.map((t) => String(t || "").trim().slice(0, 60)).filter(Boolean).slice(0, 30) : [];
  return list.length ? list : [...CODING_HANDS];
};
/** Whether a shared verb's answer is a refusal. @param {string} out */
const refused = (out) => {
  try {
    const o = JSON.parse(out);
    return !!o && typeof o === "object" && "error" in o;
  } catch {
    return false;
  }
};

/**
 * One tool call over MCP. Never throws for what memory refuses: that is the answer, flagged `isError`.
 * @param {any} memory @param {string} name @param {any} args
 * @param {{ folder: string, key: string | null, client: string, meta: any, confined?: boolean }} where
 * @returns {Promise<{ content: { type: "text", text: string }[], isError?: boolean }>}
 */
export async function memoryMcpCall(memory, name, args, where) {
  const why = closedWhy(memory);
  if (why) return { content: [{ type: "text", text: why }], isError: true };
  if (name === "remember" && args.scope !== "global" && !where.folder)
    return { content: [{ type: "text", text: `${NO_FOLDER} A claim about the user that holds in every project can be remembered with scope "global".` }], isError: true };
  const scope = standing(memory, where, { global: name === "remember" && args.scope === "global" });
  // What it was shown and is retired since: at the top, said once (M7-D40).
  const errata = await scope.errata();
  /** @type {{ text: string, isError: boolean }} */
  let r;
  try {
    r = await run(scope, name, args);
  } catch (/** @type {any} */ e) {
    r = { text: String(e?.message || e).slice(0, 300), isError: true };
  }
  return { content: [...(errata ? [{ type: /** @type {"text"} */ ("text"), text: errata }] : []), { type: "text", text: r.text }], ...(r.isError ? { isError: true } : {}) };
}

/** @param {any} scope @param {string} name @param {any} args @returns {Promise<{ text: string, isError: boolean }>} */
async function run(scope, name, args) {
  /** @param {string} text */
  const ok = (text) => ({ text, isError: false });
  /** @param {string} op */
  const sharedVerb = async (op) => {
    const out = await executeMemoryTool(scope, `filament_memory_${op}`, args);
    // A refusal is Filament's words, never a claim's: the tools it names are named as they are called here.
    return refused(out) ? { text: shortNames(out), isError: true } : { text: out, isError: false };
  };
  switch (name) {
    case "brief": {
      const b = await scope.brief({ purpose: "agent", task: String(args.task || ""), tools: handsOf(args.tools), budget: Number(args.budget) || null });
      return ok(b.text || `Nothing from memory for this task: ${b.why}.`);
    }
    case "search": {
      const items = await scope.search(String(args.query || ""), { project: !!args.project_only, limit: Math.min(30, Number(args.limit) || 10) });
      const text = searchResults(items);
      // A topic page shows the claims its lines carry (the memory plan's f7): a retired one reaches the session as an erratum.
      scope.shown("search", items.flatMap((/** @type {any} */ it) => (it.kind === "page" ? it.shows || [] : [it.id])), text);
      return ok(text);
    }
    case "claim":
    case "history": {
      const c = name === "claim" ? scope.card(String(args.id || "")) : scope.history(String(args.id || ""));
      if (c.error) return { text: JSON.stringify({ error: c.error }), isError: true };
      const text = JSON.stringify(c);
      scope.shown(name, [c.id], text);
      return ok(text);
    }
    case "pitfalls": {
      const said = scope.reminders(String(args.tool || ""), args.input && typeof args.input === "object" ? args.input : {});
      if (!said.length) return ok("Nothing in memory for this call that this session was not told already.");
      const text = ["Memory on the call you are about to make (Filament):", ...said.map((/** @type {any} */ m) => `- ${m.line}`)].join("\n");
      // Each kind logged with its own lines, as a request's reminders are.
      for (const kind of ["pitfall", "thread"]) {
        const of = said.filter((/** @type {any} */ m) => m.kind === kind);
        scope.shown(kind, of.map((/** @type {any} */ m) => m.id), of.map((/** @type {any} */ m) => m.line).join("\n"));
      }
      return ok(text);
    }
    case "questions":
      return ok(JSON.stringify({ questions: scope.questions() }));
    case "sessions":
    case "load":
    case "remember":
    case "correct":
    case "close":
    case "confirm":
    case "forget":
      return sharedVerb(name);
    default:
      return { text: `unknown tool ${name}`, isError: true };
  }
}

/**
 * The opening words (M7-D45): how memory is used; and, when the session's folder is known as it opens, the brief for
 * no task — the user's rules and the project's dossier — logged as shown on the session. Read in no session first: a
 * session memory has nothing to say to gets no chain for it (M7-D40).
 * @param {any} memory @param {{ folder: string, key: string | null, client: string, meta: any, confined?: boolean }} where
 */
export async function memoryMcpOpening(memory, where) {
  if (!where.folder) return `${GUIDE}\n${NO_FOLDER}`;
  if (closedWhy(memory)) return GUIDE;
  try {
    const b = await standing(memory, where, { chain: false }).brief({ purpose: "agent", task: "", tools: [], budget: OPENING_TOKENS });
    if (!b.text) return GUIDE;
    standing(memory, where).shown("brief", b.ids, b.text);
    return `${GUIDE}\n\n${b.text}`;
  } catch {
    return GUIDE;
  }
}

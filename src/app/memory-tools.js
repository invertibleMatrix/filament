// Memory as a tool the model can call (docs/memory-architecture.md §7).
//
// Filament appends its `filament_memory_*` tools (`MEMORY_TOOL_NAMES`) to a request. When the upstream reply calls them, Filament executes
// the calls against the brain, appends the assistant turn and the results to the outbound body, and asks the same
// upstream again, up to a few rounds, so the model can connect the dots before it answers. The client sees one
// message: for streams, text flows through as it arrives, the memory tool blocks are withheld, the follow-up reply
// continues with renumbered block indices, and one terminal event closes the message with summed usage. A reply
// that mixes memory tools with the client's own tools is not looped (the client must run its tools first): the
// memory calls are executed and their results wait for the client's next request (a `tool` block on the tool
// result message), so the model still gets what it asked for.
//
// Three wire formats are handled on both sides: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses.
//
// Usage contract: what the CLIENT receives (the terminal stream event, the JSON reply) reports the conversation it
// actually holds — the first round's prompt plus the sum of visible output — because clients read usage as "my
// context size" and the withheld tool exchanges never become client history. The request RECORD keeps the summed
// processing total of every round (totalUsageOf), which is the billing truth.
const PREFIX = "filament_memory_";
import { usageFromAnthropic, usageFromOpenAI, usageFromResponses } from "../core/wire/usage.js";
import { saysCache } from "../core/cache-facts.js";
import { createSseEventReader } from "../core/wire/sse.js";
import { clip, durationWords, headChars, tailChars } from "../core/text.js";
import { withTrace } from "../services/memory/trace.js";
import { MEMORY_WAIT_MS, REMEMBERED_KINDS, projectOf } from "../services/memory/brain.js";
import { RECALL_TOOL, recall } from "./sessions/recall.js";
// The recall tool (HarnessV2 §6.4) rides the same loop: the model asks for an archived turn or tool result by its
// pointer, Filament answers from the session's archive and asks the upstream again. Offered by the session's document
// (any shape but raw in force), not by memory's switch — a muted session still gets it.
export const isMemoryTool = (name) => typeof name === "string" && (name.startsWith(PREFIX) || name === RECALL_TOOL);
export const isRecallTool = (name) => name === RECALL_TOOL;
/** What a call of memory's own tools gets where they were not offered — switched off for the chat, or memory off — and
 *  the model called one all the same: the request's own answer and the agent loop's (the owner's of 10-28). */
export const MEMORY_TOOLS_OFF = "Not run: memory's tools are off in this chat. Go on without them.";
/**
 * What a call of memory's tools is answered on a request memory could not read (t420): its tools ride it as they ride
 * every request of the chat, so the tools section the provider caches stays as it was, and none of them runs. Why
 * memory missed it stays on the record: an error's words may name this computer's files, and these go to the provider.
 */
export const memoryUnavailable = () => "Not run: memory is unavailable for this request. Go on without it; its tools work again once memory reads the chat's next request.";
/** What a coding agent's call of memory's tools is answered while memory is still opening (`callAgentMemoryTool`). */
export const MEMORY_STARTING = "Not run: memory is still starting. Try again in a moment.";
export const MEMORY_TOOL_NAMES = ["search", "sessions", "load", "remember", "correct", "close", "confirm", "forget", "grep"].map((n) => PREFIX + n);
export { RECALL_TOOL };

const RECALL_SCHEMA = {
  description:
    "Bring back what Filament left out of this conversation's history to save room: an earlier turn in full (its tool calls and their results, verbatim) by its number, or one tool result by the pointer written in its place (r: plus eight hex digits, as in 'result r:2f9a1c3d' or '→ superseded … (r:…)'). Use it when a folded turn, a stub line or a pointer stands where you need the actual text, instead of running a tool again. Returns the archived text; nothing is re-run. With neither, it lists this chat's turns: what opened each and its answer's head and end, to find what an earlier turn said was left. Not long-term memory: that is filament_memory_search.",
  schema: {
    type: "object",
    properties: {
      turn: { type: "integer", minimum: 1, description: "The turn's number, to bring it back whole." },
      result: { type: "string", description: "A result pointer: r: and eight hex digits." },
      before: { type: "integer", minimum: 2, description: "With neither: list the turns before this one." },
    },
  },
};

/**
 * What a remember's `quote` is (the memory plan's d1), and a correct's, which names remember's: the person's words,
 * checked against what they typed in this chat, file the claim as theirs; anything else stays the agent's note.
 */
const QUOTE_WORDS =
  "When the user said it in this chat: their own words, copied exactly (8 characters or more), which files the memory as the user's word. Leave it out for what you found yourself, or read in a file, a page or a tool's result.";
/** The memory tools' words and arguments, by short name: the models' tools, and the shared verbs of `/mcp/memory`. */
const SCHEMAS = {
  search: {
    description:
      "Search the user's long-term memory across all projects and sessions: facts, rules, preferences, decisions, procedures and summaries of past turns. Use it when the user refers to earlier work, when context is missing, or before doing something the user may have corrected before. Not for words said in a session (filament_memory_grep). Returns items with ids, kinds, how each is known (trust), dates and session references; items of kind session or turn are quotes, not checked facts.",
    schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look for: names, files, errors, topics, or the question in a sentence.",
        },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Max results (default 10)." },
        project_only: { type: "boolean", description: "Only this project's memory (default false)." },
      },
      required: ["query"],
    },
  },
  sessions: {
    description:
      "Find the user's past sessions (conversations with any coding tool) by words the user typed in them; tool output is filament_memory_grep's. Returns session ids, titles, dates, clients, end states and matching snippets. Load one with filament_memory_load.",
    schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords from what the user would have typed." },
        limit: { type: "integer", minimum: 1, maximum: 20 },
      },
      required: ["query"],
    },
  },
  load: {
    description:
      "Bring a session's record into this conversation: a past session by its id, or 'current' for what has left your context. Budgeted; newest turns first. A chat the user tags in a message, written [title](chat:<id>), is a past session: load it by that id when the request needs what it holds. Never load a past session on your own to pick up its work: a session the briefing names is a reference, loaded only when the user asks for it or tags it.",
    schema: {
      type: "object",
      properties: {
        session: { type: "string", description: "A session id (from filament_memory_sessions, a memory item or a tagged chat), or 'current' for this session." },
        view: {
          type: "string",
          enum: ["chat", "summary", "full", "compact", "lineage", "page"],
          description:
            "chat (the default): the user's inputs and final answers. summary: inputs plus per-turn summaries. full: every message, tool activity included (expensive). compact: the latest compaction summary plus what followed. lineage: this session and all its ancestors, oldest first, a summary each. page: what Filament's page told the user (its notes, errors, status lines), oldest first: what they saw and you did not.",
        },
        from_turn: { type: "integer", description: "The oldest turn to include." },
        to_turn: { type: "integer", description: "The newest turn to include." },
        budget_tokens: { type: "integer", minimum: 200, maximum: 30000, description: "Default 4000." },
      },
      required: ["session"],
    },
  },
  remember: {
    description:
      `Store something new and durable in the user's long-term memory, which later sessions start from: a fact about the user or a project, a rule, a preference, a decision with its reason, or a procedure, written "How to <goal>: 1. <step> 2. <step>", each step the command or action that worked. Keep what a later session could not re-read from the code or git: the user's rules, corrections and decisions with their reason, and the pitfalls you hit; other kinds in one or two sentences, and no transient task details. To change a memory that is wrong or outdated, use filament_memory_correct on its id: a second note beside the old one leaves both standing.`,
    schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        kind: { type: "string", enum: [...REMEMBERED_KINDS] },
        importance: { type: "number", minimum: 0, maximum: 1, description: "Default 0.8." },
        quote: { type: "string", description: QUOTE_WORDS },
      },
      required: ["text"],
    },
  },
  correct: {
    description:
      "Replace a memory that has changed or proved wrong, by its id: the new text becomes the memory, the old one is kept as history and no longer served, and sessions that saw it are told. Without text, the memory is only retired. Not for a finished open thread (filament_memory_close) nor for a memory that was never true (filament_memory_forget).",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The memory's id, as its line or a search result shows it (i12, e:…)." },
        text: { type: "string", description: "What holds now, in one or two sentences. Left out, the memory is only retired." },
        reason: { type: "string", description: "Why: what you observed or what the user said." },
        quote: { type: "string", description: "As in filament_memory_remember: the user's own words from this chat, copied exactly; left out for what you found yourself." },
      },
      required: ["id", "reason"],
    },
  },
  close: {
    description:
      "Close an open thread (unfinished work a past session left) once its work is done, by its id. It is kept as history, no longer served or said at calls on its files. The user's own thread is theirs to close: they are asked. A memory that was wrong or has changed is corrected with filament_memory_correct instead.",
    schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "The open thread's id, as its line or a search result shows it." },
        because: { type: "string", description: "What finished it: the change made, or the check that shows it done." },
      },
      required: ["id", "because"],
    },
  },
  confirm: {
    description:
      "Mark a memory that proved right in this session (you checked it, or it worked), by its id. It counts as used, so it keeps being offered.",
    schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  forget: {
    description:
      "Retire a memory that was never true, by its id. It is kept as history and no longer served. For a memory that was true and has changed, use filament_memory_correct instead.",
    schema: {
      type: "object",
      properties: { id: { type: "string" }, reason: { type: "string", description: "Why it is not true." } },
      required: ["id"],
    },
  },
  grep: {
    description:
      "Find where words were said in a session: this one ('current', the default) or a past one by its id. It reads every message of every turn (the user's, yours, each tool call's name and input, each result), so it finds what has left your context: a command's output, an error, a path, a decision. Plain words, not a pattern: any case, any whitespace between them. Newest turns first, each with its number and the lines around the words. To see a turn whole, filament_memory_load it with view 'full', from_turn and to_turn its number.",
    schema: {
      type: "object",
      properties: {
        text: { type: "string", description: "The words to find, as they would be written." },
        session: { type: "string", description: "'current' (default) or a session id from filament_memory_sessions." },
        from_turn: { type: "integer", description: "The oldest turn to search." },
        to_turn: { type: "integer", description: "The newest turn to search; to go on past the turns shown, the last one's number minus one." },
        limit: { type: "integer", minimum: 1, maximum: 30, description: "Most turns to show (default 10)." },
      },
      required: ["text"],
    },
  },
};
export const MEMORY_TOOL_SCHEMAS = Object.freeze(SCHEMAS);

/** Tool definitions in the client's wire format. @param {string} format @returns {any[]} */
export function memoryToolDefs(format) {
  return Object.entries(SCHEMAS).map(([n, s]) => {
    const name = PREFIX + n;
    if (format === "anthropic") return { name, description: s.description, input_schema: s.schema };
    if (format === "responses")
      return { type: "function", name, description: s.description, parameters: s.schema, strict: false };
    return { type: "function", function: { name, description: s.description, parameters: s.schema } };
  });
}

// Append the tools to a request (idempotent by name). Returns how many were added.
export function attachMemoryTools(format, body, responsesBody = null) {
  let added = 0;
  const add = (target, fmt) => {
    if (!target) return;
    const list = Array.isArray(target.tools) ? target.tools : (target.tools = []);
    const names = new Set(list.map((t) => t?.name || t?.function?.name));
    for (const def of memoryToolDefs(fmt)) {
      const name = def.name || def.function?.name;
      if (!names.has(name)) {
        list.push(def);
        added++;
      }
    }
  };
  add(body, format === "responses" ? "openai" : format);
  if (responsesBody) add(responsesBody, "responses");
  return added;
}
export function detachMemoryTools(body) {
  if (Array.isArray(body?.tools))
    body.tools = body.tools.filter((t) => !isMemoryTool(t?.name || t?.function?.name));
}

/**
 * Whether a request carries tools of its own (`tools`, or Chat Completions' older `functions`; a Responses client's on
 * its own body), read before memory's are added.
 * @param {any} body @param {any} [responsesBody]
 */
export const carriesOwnTools = (body, responsesBody = null) =>
  [body?.tools, body?.functions, responsesBody?.tools].some((t) => Array.isArray(t) && t.length > 0);

/**
 * Taken before memory's tools go on a request: puts its tools back as the client sent them, for the retry when its
 * model refuses the request for them (HarnessV3-AtHome AH-D1 — dispatch/verdict.js).
 * @param {any} body @param {any} [responsesBody]
 * @returns {() => void}
 */
export function toolsAsSent(body, responsesBody = null) {
  const targets = [body, responsesBody];
  const kept = targets.map((t) => (t && "tools" in t ? { had: true, tools: Array.isArray(t.tools) ? [...t.tools] : t.tools } : { had: false }));
  return () =>
    targets.forEach((t, i) => {
      if (!t) return;
      if (kept[i].had) t.tools = kept[i].tools;
      else delete t.tools;
    });
}

/** Where a model refused memory's tools: the upstream, and the model name it was sent. @param {string} upstreamId @param {string} model */
export const toolsRefusalKey = (upstreamId, model) => `${upstreamId}\0${model}`;

/** The recall tool's definition in a wire format. @param {string} format */
export function recallToolDef(format) {
  const s = RECALL_SCHEMA;
  if (format === "anthropic") return { name: RECALL_TOOL, description: s.description, input_schema: s.schema };
  if (format === "responses") return { type: "function", name: RECALL_TOOL, description: s.description, parameters: s.schema, strict: false };
  return { type: "function", function: { name: RECALL_TOOL, description: s.description, parameters: s.schema } };
}

/** Append the recall tool to a request (idempotent). Returns 1 when it was added. */
export function attachRecallTool(format, body, responsesBody = null) {
  let added = 0;
  const add = (target, fmt) => {
    if (!target) return;
    const list = Array.isArray(target.tools) ? target.tools : (target.tools = []);
    if (list.some((t) => (t?.name || t?.function?.name) === RECALL_TOOL)) return;
    list.push(recallToolDef(fmt));
    added++;
  };
  add(body, format === "responses" ? "openai" : format);
  if (responsesBody) add(responsesBody, "responses");
  return added;
}

// ---------------------------------------------------------------------------------------------------
// Executing calls
// ---------------------------------------------------------------------------------------------------
const cap = (s, n = 12000) => (s.length > n ? s.slice(0, n - 20) + `\n…[${s.length - n} more chars]` : s);
/**
 * A session's load cut to `n` characters where it is longer: a fifth from its start, the rest from its newest end, and
 * the line between them saying how much went. @param {string} s @param {number} n
 */
const capMiddle = (s, n) => {
  if (s.length <= n) return s;
  const head = Math.floor((n - 60) / 5);
  const tail = n - 60 - head;
  const h = headChars(s, head);
  const t = tailChars(s, tail);
  return `${h}\n…[${(s.length - h.length - t.length).toLocaleString("en-US")} characters left out here]\n${t}`;
};
/**
 * A search's answer, as the models' tool and an agent's over `/mcp/memory` give it: each item with its id, kind, how
 * it is known, its marks, when and where it was said, and its words. @param {any[]} items
 */
export const searchResults = (items) =>
  cap(
    JSON.stringify({
      results: items.map((it) => ({
        id: it.id,
        kind: it.kind,
        trust: it.trust || undefined,
        flags: it.flags?.length ? it.flags : undefined,
        when: it.when || undefined,
        session: it.chainId || undefined,
        turn: it.turnId || undefined,
        score: Math.round((it.score || 0) * 100) / 100,
        text: it.text,
      })),
    }),
  );
/**
 * One call of a memory or recall tool, run on a memory handle (`memory.scope`): the handle says who asks
 * (its role is the `by` of a write) and where they stand. `tally` is the request's own count of past-session tokens
 * loaded so far, shared by every call of every round. A call is waited on as long as a turn waits on memory (the
 * handle's `waitMs`, `MEMORY_WAIT_MS`): past it, its result says memory took longer, and the turn goes on; the call
 * goes on unwaited, to finish or fail on its own.
 * @param {any} scope @param {string} name @param {any} [input] @param {{ loadedTokens?: number }} [tally]
 */
export async function executeMemoryTool(scope, name, input = {}, tally = {}) {
  const a = input || {};
  if (isRecallTool(name)) {
    try {
      return cap(recall(scope.archive || null, scope.conversation || null, a), 60000);
    } catch (e) {
      return JSON.stringify({ error: e.message.slice(0, 300) });
    }
  }
  const waitMs = scope.waitMs?.() ?? MEMORY_WAIT_MS;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let clock;
  /** @type {Promise<string>} */
  const late = new Promise((resolve) => {
    clock = setTimeout(
      () => resolve(JSON.stringify({ error: `memory took longer than ${durationWords(waitMs)} to answer, so the turn goes on without this call's result; the call goes on unwaited, and what it writes may still be written` })),
      waitMs,
    );
  });
  try {
    return await Promise.race([memoryCall(scope, name, a, tally), late]);
  } finally {
    clearTimeout(clock);
  }
}
/**
 * What a write's quote came to, in its answer (the memory plan's d1): filed as the user's word, or the agent's note and
 * why. @param {{ heard?: boolean, unheard?: string }} r
 */
const quoteSaid = (r) => (r.heard ? { quote: "found in what the user typed: filed as the user's word" } : r.unheard ? { quote: `not filed as the user's word: ${r.unheard}` } : {});
/**
 * A memory tool's call, answered in words whatever happens: its result, or why there is none.
 * @param {any} scope @param {string} name @param {any} a @param {{ loadedTokens?: number }} tally
 * @returns {Promise<string>}
 */
async function memoryCall(scope, name, a, tally) {
  const op = String(name).slice(PREFIX.length);
  try {
    if (op === "search") {
      const items = await scope.search(String(a.query || ""), {
        project: !!a.project_only,
        limit: Math.min(30, Number(a.limit) || 10),
      });
      return searchResults(items);
    }
    if (op === "sessions") {
      const list = scope.sessions(String(a.query || ""), { limit: Math.min(20, Number(a.limit) || 10) });
      return cap(JSON.stringify({ sessions: list }));
    }
    if (op === "load" || op === "grep") {
      // A session by its id, or `current`: the one the call stands in (the filament-agent plan's Phase 4).
      const named = String(a.session || (op === "grep" ? "current" : ""));
      const id = named === "current" ? scope.chain || null : named;
      if (id === null) return JSON.stringify({ error: "this call stands in no session, so 'current' names none: give a session id (filament_memory_sessions finds them)" });
      const r =
        op === "load"
          ? scope.load(id, {
              view: a.view || "chat",
              budgetTokens: Math.min(30000, Math.max(200, Number(a.budget_tokens) || 4000)),
              fromTurn: a.from_turn,
              toTurn: a.to_turn,
            })
          : scope.grep(id, { text: String(a.text || ""), limit: Math.min(30, Math.max(1, Number(a.limit) || 10)), fromTurn: a.from_turn, toTurn: a.to_turn });
      if (!r) return JSON.stringify({ error: scope.confined ? "no such session in this project's memory" : "no such session" });
      // One ceiling per request across every load and grep of every round, so a determined model cannot pull the whole
      // archive through the door one 30k slice at a time.
      const ceiling = scope.loadCeiling();
      const used = (tally.loadedTokens ||= 0);
      const tok = r.tokens || 0;
      if (used + tok > ceiling)
        return JSON.stringify({
          error: `this request has already pulled ${Math.round(used)} tokens of session history and its budget is ${ceiling}; ask for less: a narrower turn range, a cheaper view (summary) or fewer turns`,
        });
      tally.loadedTokens = used + tok;
      if (op === "grep") {
        const { tokens: _, ...found } = r;
        return cap(JSON.stringify(r.more ? { ...found, next: `older turns have it too: grep again with to_turn ${r.matches.at(-1).turn - 1}` } : found), 30000);
      }
      // Room for the budget it was asked with, and never less than before; past it, its start and its newest end are
      // kept, and the middle goes, said (the owner's of 11-10: a cut from the end lost the newest of a 30,000-token load).
      const budget = Math.min(30000, Math.max(200, Number(a.budget_tokens) || 4000));
      return capMiddle(
        r.text ||
          (r.messages
            ? r.messages
                .map(
                  (m) =>
                    `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`,
                )
                .join("\n\n")
            : ""),
        Math.max(60000, budget * 4),
      );
    }
    if (op === "remember") {
      const r = await scope.remember(String(a.text || ""), { kind: a.kind || "fact", importance: a.importance ?? 0.8, quote: a.quote == null ? "" : String(a.quote) });
      if (r.retired) return JSON.stringify({ stored: false, id: r.id, note: r.note, ...quoteSaid(r) });
      return JSON.stringify({ stored: true, id: r.id, ...quoteSaid(r), ...(r.replaced ? { replaced: r.replaced } : {}), ...(r.note ? { note: r.note } : {}) });
    }
    if (op === "correct") {
      const { heard, unheard, ...r } = await scope.correct(String(a.id || ""), { text: a.text == null ? "" : String(a.text), reason: String(a.reason || ""), quote: a.quote == null ? "" : String(a.quote) });
      return JSON.stringify({ ...r, ...quoteSaid({ heard, unheard }) });
    }
    if (op === "close") return JSON.stringify(await scope.close(String(a.id || ""), { because: a.because == null ? "" : String(a.because) }));
    if (op === "confirm") return JSON.stringify(await scope.confirm(String(a.id || "")));
    if (op === "forget") return JSON.stringify(await scope.forget(String(a.id || ""), { reason: a.reason == null ? null : String(a.reason) }));
    return JSON.stringify({ error: `unknown memory tool ${name}` });
  } catch (e) {
    return JSON.stringify({ error: e.message.slice(0, 300) });
  }
}
/** A tool's short name for notes and traces: `search`, `recall`. @param {string} name */
export const shortToolName = (name) => String(name || "").replace(/^filament_memory_/, "").replace(/^filament_recall$/, "recall");

// The service-side glue around the calls above: the context a call runs in, the loop that runs them (with trace
// spans), the deferral of results onto the session's next request, and the MCP surface the agent bridge exposes.
/**
 * A request's memory tool context: the model's handle on memory, standing in the request's session, plus its trace.
 * A loop's own tick stands on its loop's turn, and a sub-agent's run's tick writes as the sub-agent (`prep.loopTurn`,
 * `prep.finder`, HarnessV3-Memory M7-D20). The calls of every round add their loaded tokens to it (`loadedTokens`).
 * A request whose caller reaches its own project's sessions alone (`sit.confined`) gets a handle that keeps to them.
 * @param {any} memory @param {any} sit @param {any} prep
 */
export function memoryToolCtx(memory, sit, prep) {
  return {
    scope: memory.scope({
      role: "model",
      project: sit?.project?.id || null,
      chain: prep?.chain || null,
      turn: prep?.turn || prep?.loopTurn || null,
      client: sit?.client || "",
      finder: prep?.finder || null,
      deferTo: prep?.deferTo || null,
      confined: !!sit?.confined,
      // A sub-agent's request stands in the chat that launched it: its quote of the person is not heard (d1).
      helper: !!prep?.conversation || !!sit?.headers?.["x-filament-subagent"],
    }),
    trace: sit?.trace || null,
  };
}
/**
 * Each call run in turn: what it returned, and how long it took (`ms`).
 * @param {any[]} calls @param {any} ctx  from memoryToolCtx
 */
export async function runMemoryTools(calls, ctx) {
  const tr = ctx?.trace || null;
  return withTrace(tr, async () => {
    const results = [];
    for (const c of calls) {
      const short = shortToolName(c.name);
      const run = async (s) => {
        const o = await executeMemoryTool(ctx.scope, c.name, c.input || {}, ctx);
        if (s) s.resultChars = String(o || "").length;
        return o;
      };
      const t = performance.now();
      const output = tr
        ? await tr.span(`tool ${short}`, run, {
            note: "run by Filament; the result goes back to the model, not to the client",
          })
        : await run(null);
      results.push({ id: c.id, callId: c.callId, name: c.name, output, ms: Math.round(performance.now() - t) });
    }
    return results;
  });
}
/**
 * Why a reply's memory results ride the session's next request, as its trace says it: the reply called the client's
 * tools beside memory's, which end its round with the client; it reached the memory tool round limit; the follow-up
 * that took the results to the model failed; or the request ended before the model was handed them — its client gone,
 * hung up or stopped, or the follow-up's call aborted on its way.
 */
const DEFERRED_BECAUSE = Object.freeze({
  mixed: "the reply also called the client's tools: the memory results ride along with the client's next request of this session",
  limit: "the memory tool round limit was reached: the memory results ride along with the client's next request of this session",
  failed: "the follow-up that took them to the model failed: the memory results ride along with the client's next request of this session",
  gone: "the request ended before the model was handed them — its client gone, or the follow-up's call aborted: the memory results ride along with the client's next request of this session",
});
// A reply's memory calls whose results its model was not handed: run now, the results handed to the next request of the
// chain, the trace saying why (`because`).
/**
 * What it ran, as `runMemoryTools` returns it; null where it ran nothing (no session open to hand the results to).
 * `run`: what runs the calls, `runMemoryTools` unless the caller answers some of them itself.
 * @param {any[]} calls @param {any} ctx  from memoryToolCtx
 * @param {{ run?: (calls: any[], ctx: any) => Promise<any[]>, because: keyof typeof DEFERRED_BECAUSE }} o
 */
export async function deferMemoryResults(calls, ctx, { run = runMemoryTools, because }) {
  if (!ctx.scope.conversation || !ctx.scope.isOpen()) return null;
  ctx.trace?.step("memory results deferred", {
    calls: calls.length,
    note: DEFERRED_BECAUSE[because],
  });
  const results = await run(calls, ctx);
  // Each call's part of the text, under its id and the round it was called in (`round`, where the calls are more than
  // one reply's), in the rounds' order: a provider that names each reply's calls afresh (`call_0`) names a later round's
  // as an earlier one's. The next request leaves out the results an exchange it puts back carries.
  const said = results.map((r) => ({
    id: String(r.id ?? ""),
    round: Number(r.round) || 1,
    text: `Result of ${r.name}(${clip(JSON.stringify(calls.find((c) => c.id === r.id && c.round === r.round)?.input || {}), 120)}):\n${clip(r.output, 6000)}`,
  }));
  ctx.scope.defer(said.map((s) => s.text).join("\n\n"), said);
  return results;
}

/**
 * Memory's tools as a coding agent's session lists them: whenever memory is on, open or not yet, since a session's list
 * is fixed for its life (http/mcp.js, `listChanged: false`); a call made before memory opens is told so in words
 * (`callAgentMemoryTool`). @param {any} memory
 */
export function agentMemoryMcpTools(memory) {
  return memory.enabled()
    ? memoryToolDefs("anthropic").map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      }))
    : [];
}
/**
 * A coding agent's call to memory's tools (HarnessV3-ACP AC4-2): an agent's handle, standing in the project of its
 * folder and in the session and turn it runs in — what it is shown is logged there, and what it remembers is filed on
 * the turn. A call with no session stands in none. `confined`: the turn is for a caller that reaches its own project's
 * sessions alone, and so is the agent's handle. `helper`: the agent is a sub-agent of the chat (its seat), whose quote
 * of the person is not heard (the memory plan's d1).
 * @param {any} memory @param {string} name @param {any} args
 * @param {{ cwd?: string, upstream?: string, chain?: string | null, turn?: string | null, confined?: boolean, helper?: boolean }} [o]
 */
export async function callAgentMemoryTool(memory, name, args, { cwd = "", upstream = "", chain = null, turn = null, confined = false, helper = false } = {}) {
  // Listed before memory has opened (`agentMemoryMcpTools`): a call then is told to come back. An archive that would not
  // open is no wait: the handle's refusal says why, in its own words.
  if (!memory.isOpen() && !memory.archiveError) return MEMORY_STARTING;
  const project = projectOf({ acpCwd: cwd, mayAsk: (f) => memory.mayAsk(f) });
  return executeMemoryTool(memory.scope({ role: "agent", project: project.id, chain, turn, client: `agent:${upstream}`, confined, helper }), name, args);
}

// ---------------------------------------------------------------------------------------------------
// Parsing replies (JSON) into a generic assistant turn
// ---------------------------------------------------------------------------------------------------
// generic: { blocks: [{type:"text",text}|{type:"thinking",thinking,signature}|{type:"redacted_thinking",data}|{type:"tool_use",id,name,input}], stopReason, usage, id, model, reasoning }
export function parseReply(fmt, json) {
  const g = {
    blocks: [],
    stopReason: null,
    usage: json?.usage || null,
    id: json?.id || null,
    model: json?.model || null,
    reasoning: "",
  };
  if (!json) return g;
  if (fmt === "anthropic") {
    for (const b of json.content || []) {
      if (b.type === "tool_use")
        g.blocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input ?? {} });
      else if (b.type === "text") g.blocks.push({ type: "text", text: b.text || "" });
      else if (b.type === "thinking")
        g.blocks.push({ type: "thinking", thinking: b.thinking || "", signature: b.signature });
      else if (b.type === "redacted_thinking") g.blocks.push({ type: "redacted_thinking", data: b.data });
    }
    g.stopReason = json.stop_reason || null;
  } else if (fmt === "responses") {
    for (const it of json.output || []) {
      if (it.type === "function_call")
        g.blocks.push({
          type: "tool_use",
          id: it.id,
          callId: it.call_id,
          name: it.name,
          input: parseArgs(it.arguments),
        });
      else if (it.type === "message")
        for (const c of it.content || [])
          if (c.type === "output_text") g.blocks.push({ type: "text", text: c.text || "" });
          else if (it.type === "reasoning") g.blocks.push({ type: "reasoning", item: it });
    }
    g.stopReason = json.status;
  } else {
    const m = json.choices?.[0]?.message || {};
    if (m.reasoning_content) g.reasoning = m.reasoning_content;
    if (typeof m.content === "string" && m.content) g.blocks.push({ type: "text", text: m.content });
    for (const c of m.tool_calls || [])
      g.blocks.push({
        type: "tool_use",
        id: c.id,
        name: c.function?.name,
        input: parseArgs(c.function?.arguments),
      });
    g.stopReason = json.choices?.[0]?.finish_reason || null;
  }
  return g;
}
const parseArgs = (s) => {
  if (s == null || s === "") return {};
  if (typeof s === "object") return s;
  try {
    return JSON.parse(s);
  } catch {
    return { _raw: String(s) };
  }
};
export const ourCalls = (g) => g.blocks.filter((b) => b.type === "tool_use" && isMemoryTool(b.name));
export const otherCalls = (g) => g.blocks.filter((b) => b.type === "tool_use" && !isMemoryTool(b.name));

// The client-visible JSON when rounds happened: earlier rounds' visible blocks, then the final reply. The usage is
// the conversation the client holds (clientUsageOf); the record keeps the loop total (totalUsageOf). A final reply whose
// calls were all memory's — the round limit, a follow-up that failed — ends as one that called none (`endedWithoutCalls`).
export function mergeJsonRounds(fmt, rounds) {
  if (rounds.length === 1) return stripOurTools(fmt, rounds[0]);
  const final = structuredClone(rounds[rounds.length - 1]);
  const usage =
    clientUsageOf(fmt, rounds.map((r) => r?.usage).filter(Boolean)) ||
    sumUsage(rounds.map((r) => r?.usage).filter(Boolean));
  if (fmt === "anthropic") {
    const content = [];
    for (const r of rounds)
      for (const b of r.content || []) if (!(b.type === "tool_use" && isMemoryTool(b.name))) content.push(b);
    final.content = content;
    if (usage) final.usage = usage;
  } else if (fmt === "responses") {
    const output = [];
    for (const r of rounds)
      for (const it of r.output || [])
        if (!(it.type === "function_call" && isMemoryTool(it.name))) output.push(it);
    final.output = output;
    if (usage) final.usage = usage;
  } else {
    const msg = final.choices?.[0]?.message;
    if (msg) {
      const texts = rounds
        .map((r) => r.choices?.[0]?.message?.content)
        .filter((t) => typeof t === "string" && t);
      // Each round's words a paragraph of their own: "Let me check." and the answer read as one line glued.
      msg.content = texts.join("\n\n") || msg.content || null;
      if (Array.isArray(msg.tool_calls)) {
        msg.tool_calls = msg.tool_calls.filter((c) => !isMemoryTool(c.function?.name));
        if (!msg.tool_calls.length) delete msg.tool_calls;
      }
    }
    if (usage) final.usage = usage;
  }
  return endedWithoutCalls(fmt, final);
}
export function stripOurTools(fmt, json) {
  const j = structuredClone(json);
  if (fmt === "anthropic" && Array.isArray(j.content))
    j.content = j.content.filter((b) => !(b.type === "tool_use" && isMemoryTool(b.name)));
  else if (fmt === "responses" && Array.isArray(j.output))
    j.output = j.output.filter((it) => !(it.type === "function_call" && isMemoryTool(it.name)));
  else if (j.choices?.[0]?.message?.tool_calls) {
    const m = j.choices[0].message;
    m.tool_calls = m.tool_calls.filter((c) => !isMemoryTool(c.function?.name));
    if (!m.tool_calls.length) delete m.tool_calls;
  }
  return endedWithoutCalls(fmt, j);
}
// A reply the client is shown without memory's calls whose stop reason still says a call, with no call of the client's
// left in it: it ends as a reply that called none — `end_turn`, `stop` — as the stream's `finish` ends one. A Responses
// reply says no call in its status. Changes `j`; → `j`.
function endedWithoutCalls(fmt, j) {
  if (fmt === "anthropic") {
    if (j.stop_reason === "tool_use" && !(j.content || []).some((b) => b?.type === "tool_use")) j.stop_reason = "end_turn";
  } else if (fmt !== "responses") {
    const c = j.choices?.[0];
    if (c?.finish_reason === "tool_calls" && !c.message?.tool_calls?.length) c.finish_reason = "stop";
  }
  return j;
}
export function sumUsage(list) {
  if (!list.length) return null;
  const out = {};
  const add = (dst, src) => {
    for (const [k, v] of Object.entries(src || {})) {
      if (typeof v === "number") dst[k] = (dst[k] || 0) + v;
      else if (v && typeof v === "object" && !Array.isArray(v)) {
        dst[k] = dst[k] && typeof dst[k] === "object" ? dst[k] : {};
        add(dst[k], v);
      } else if (dst[k] === undefined) dst[k] = v;
    }
  };
  for (const u of list) add(out, u);
  return out;
}

// One round's raw usage, normalized to { input (excludes cached), cacheRead, cacheWrite, output, thinking }.
function normalizeRoundUsage(fmt, u) {
  if (!u || typeof u !== "object") return null;
  const n = {};
  if (fmt === "anthropic") usageFromAnthropic(u, n);
  else if (fmt === "responses") usageFromResponses(u, n);
  else usageFromOpenAI(u, n);
  return n.input != null || n.output != null || n.cacheRead != null ? n : null;
}
// What the client should be told a multi-round reply "cost" in context terms: the FIRST round's prompt (the
// conversation as the client holds it — the tool exchanges in between are not client history) plus the output
// visible across all rounds. Without this, clients that read usage as their context size see the sum of every
// round's growing prompt and compact far too early.
export function clientUsageOf(fmt, usages) {
  const rounds = (usages || []).map((u) => normalizeRoundUsage(fmt, u)).filter(Boolean);
  if (!rounds.length) return null;
  const first = rounds[0];
  const output = rounds.reduce((n, r) => n + (r.output || 0), 0);
  const prompt = (first.input || 0) + (first.cacheRead || 0) + (first.cacheWrite || 0);
  if (fmt === "anthropic")
    return {
      input_tokens: first.input || 0,
      output_tokens: output,
      cache_read_input_tokens: first.cacheRead || 0,
      cache_creation_input_tokens: first.cacheWrite || 0,
    };
  if (fmt === "responses")
    return {
      input_tokens: prompt,
      output_tokens: output,
      total_tokens: prompt + output,
      ...(first.cacheRead ? { input_tokens_details: { cached_tokens: first.cacheRead } } : {}),
    };
  return {
    prompt_tokens: prompt,
    completion_tokens: output,
    total_tokens: prompt + output,
    ...(first.cacheRead ? { prompt_tokens_details: { cached_tokens: first.cacheRead } } : {}),
  };
}
// The billing truth for the request record: every round's tokens, summed. Its cache counts are there where a round's
// usage carried one, as one round's are (core/wire/usage.js): a sum of rounds that said none says none.
export function totalUsageOf(fmt, usages) {
  const rounds = (usages || []).map((u) => normalizeRoundUsage(fmt, u)).filter(Boolean);
  if (!rounds.length) return null;
  const out = { input: 0, output: 0 };
  for (const r of rounds) {
    out.input += r.input || 0;
    out.output += r.output || 0;
    if (saysCache(r.cacheRead, r.cacheWrite)) {
      out.cacheRead = (out.cacheRead || 0) + (r.cacheRead || 0);
      out.cacheWrite = (out.cacheWrite || 0) + (r.cacheWrite || 0);
    }
    if (r.cacheWrite1h != null) out.cacheWrite1h = (out.cacheWrite1h || 0) + r.cacheWrite1h;
    if (r.thinking != null) out.thinking = (out.thinking || 0) + r.thinking;
    if (r.providerCost != null) out.providerCost = (out.providerCost || 0) + r.providerCost;
  }
  return out;
}

// Append the assistant turn and the memory tool results to the outbound body in the client's format.
// `sameFormat` says whether thinking blocks can be passed back verbatim (Anthropic to Anthropic).
export function appendFollowUp({
  format,
  body,
  responsesBody = null,
  passthrough = false,
  generic,
  results,
  sameFormat = true,
  responseId = null,
}) {
  const calls = ourCalls(generic);
  if (format === "anthropic") {
    const content = [];
    for (const b of generic.blocks) {
      if (b.type === "thinking" && sameFormat && b.signature)
        content.push({ type: "thinking", thinking: b.thinking, signature: b.signature });
      else if (b.type === "redacted_thinking" && sameFormat)
        content.push({ type: "redacted_thinking", data: b.data });
      else if (b.type === "text" && b.text) content.push({ type: "text", text: b.text });
      else if (b.type === "tool_use" && isMemoryTool(b.name))
        content.push({ type: "tool_use", id: b.id, name: b.name, input: b.input || {} });
    }
    if (!content.length) content.push({ type: "text", text: "(memory lookup)" });
    body.messages.push({ role: "assistant", content });
    body.messages.push({
      role: "user",
      content: results.map((r) => ({ type: "tool_result", tool_use_id: r.id, content: r.output })),
    });
  } else if (format === "responses" && passthrough && responsesBody) {
    const items = [];
    for (const c of calls)
      items.push({
        type: "function_call",
        call_id: c.callId || c.id,
        name: c.name,
        arguments: JSON.stringify(c.input || {}),
      });
    for (const r of results)
      items.push({ type: "function_call_output", call_id: r.callId || r.id, output: r.output });
    if (responseId && responsesBody.store !== false) {
      responsesBody.previous_response_id = responseId;
      responsesBody.input = items.filter((it) => it.type === "function_call_output");
    } else {
      if (typeof responsesBody.input === "string")
        responsesBody.input = [{ type: "message", role: "user", content: responsesBody.input }];
      if (!Array.isArray(responsesBody.input)) responsesBody.input = [];
      responsesBody.input.push(...items);
    }
    // keep the chat-shaped mirror consistent for records and any later translation
    if (body?.messages) {
      body.messages.push({
        role: "assistant",
        content:
          generic.blocks
            .filter((b) => b.type === "text")
            .map((b) => b.text)
            .join("") || null,
        tool_calls: calls.map((c) => ({
          id: c.callId || c.id,
          type: "function",
          function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
        })),
      });
      for (const r of results)
        body.messages.push({ role: "tool", tool_call_id: r.callId || r.id, content: r.output });
    }
  } else {
    const text = generic.blocks
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("");
    const msg = {
      role: "assistant",
      content: text || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: "function",
        function: { name: c.name, arguments: JSON.stringify(c.input || {}) },
      })),
    };
    if (generic.reasoning && sameFormat) msg.reasoning_content = generic.reasoning;
    body.messages.push(msg);
    for (const r of results) body.messages.push({ role: "tool", tool_call_id: r.id, content: r.output });
  }
}

// ---------------------------------------------------------------------------------------------------
// Streaming: withhold memory tool blocks, renumber follow-up rounds, one terminal event.
// ---------------------------------------------------------------------------------------------------
// Feed upstream SSE text (format `fmt`) with push(); it returns what to forward. endResponse() closes one upstream
// reply and says whether a follow-up is needed; nextResponse() prepares for the follow-up's stream; finish() returns
// the terminal events to send when rounds happened. Its events are read as core/wire/sse.js `createSseEventReader`
// reads them: one with a line past what Filament reads of one is dropped from what it forwards, `onOver` told.
/** @param {string} fmt @param {{ onOver?: (over: import("../core/lines.js").Over) => void }} [o] */
export function createMemoryToolStream(fmt, { onOver = () => {} } = {}) {
  /** The frames the push under way forwarded as they came, with their parse (core/wire/sse.js `Parsed`). @type {[string, any][]} */
  let parsed = [];
  const st = {
    rounds: 0,
    generic: null,
    sawOurs: false,
    sawOthers: false,
    usages: [],
    clientBlocks: 0,
    seq: 0,
    firstDone: false,
    held: [],
    messageStopHeld: null,
    doneHeld: false,
    finalIds: [],
    stopReason: null,
    model: null,
    responseId: null,
    visibleItems: [],
    createdSeen: false,
    // An earlier round sent words: a later round's first goes on after a paragraph's break.
    textSent: false,
  };
  const newGeneric = () => ({
    blocks: [],
    stopReason: null,
    usage: null,
    id: null,
    model: null,
    reasoning: "",
    byIndex: new Map(),
    toolIdx: new Map(),
    saidText: false,
    // The reply said its end (its stop reason, finish_reason, [DONE] or final response): a reply cut before it never
    // runs its memory calls, whose input may have been cut too.
    ended: false,
    // The reply said an error — an error event, an error chunk, a finish_reason of "error", a failed response — with its
    // end or without: a failed reply, which runs no memory call it began either.
    failed: false,
  });
  st.generic = newGeneric();
  const out = [];
  const emit = (ev) => {
    out.push(ev);
  };
  const sse = (obj, event) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(obj)}\n\n`;
  // W3.5: until a memory tool appears (and on round 0), handlers update state but the original SSE
  // frame is what goes to the client — parse once, no re-stringify. After a memory tool is seen, or
  // on a follow-up round that must skip message_start and renumber indices, each frame is rebuilt.
  let silent = false;
  const emitSse = (obj, event) => {
    if (!silent) emit(sse(obj, event));
  };
  const memoryToolEvent = (j) => {
    if (fmt === "anthropic")
      return (
        j?.type === "content_block_start" &&
        j.content_block?.type === "tool_use" &&
        isMemoryTool(j.content_block.name)
      );
    if (fmt === "responses")
      return (
        j?.type === "response.output_item.added" &&
        j.item?.type === "function_call" &&
        isMemoryTool(j.item.name)
      );
    const tcs = j?.choices?.[0]?.delta?.tool_calls;
    if (!Array.isArray(tcs)) return false;
    return tcs.some((tc) => {
      if (isMemoryTool(tc.function?.name)) return true;
      // A tool_call whose name has not arrived yet must be intercepted: OpenAI-compat
      // providers often send `{id}` on one delta and `function.name` on the next, and
      // forwarding the nameless start would leak `filament_memory_*` on the name chunk.
      if (tc.function?.name) return false;
      const blk = st.generic.toolIdx.get(tc.index ?? 0);
      return !blk?.name;
    });
  };
  // Usage the client should see (first round's prompt + summed output) and the billing total (all rounds summed).
  const clientU = () => clientUsageOf(fmt, [...st.usages, st.generic.usage].filter(Boolean));
  const totalOf = () => totalUsageOf(fmt, [...st.usages, st.generic.usage].filter(Boolean));

  const handleAnthropic = (event, j) => {
    const g = st.generic;
    const t = j.type;
    if (t === "error") g.failed = true;
    if (t === "message_start") {
      g.usage = sumUsage([g.usage, j.message?.usage].filter(Boolean));
      g.id = j.message?.id || g.id;
      g.model = j.message?.model || g.model;
      if (!st.firstDone) emitSse(j, event);
      return;
    }
    if (t === "content_block_start") {
      const idx = j.index;
      const b = j.content_block || {};
      const blk =
        b.type === "tool_use"
          ? { type: "tool_use", id: b.id, name: b.name, inputJson: "", input: {} }
          : b.type === "text"
            ? { type: "text", text: b.text || "" }
            : b.type === "thinking"
              ? { type: "thinking", thinking: b.thinking || "", signature: b.signature }
              : b.type === "redacted_thinking"
                ? { type: "redacted_thinking", data: b.data }
                : { type: b.type, ...b };
      g.byIndex.set(idx, blk);
      g.blocks.push(blk);
      if (blk.type === "tool_use" && isMemoryTool(blk.name)) {
        st.sawOurs = true;
        blk.hidden = true;
        return;
      }
      if (blk.type === "tool_use") st.sawOthers = true;
      blk.clientIndex = st.clientBlocks++;
      emitSse({ ...j, index: blk.clientIndex }, event);
      return;
    }
    if (t === "content_block_delta") {
      const blk = g.byIndex.get(j.index);
      const d = j.delta || {};
      if (blk) {
        if (d.type === "text_delta") blk.text = (blk.text || "") + (d.text || "");
        else if (d.type === "thinking_delta") blk.thinking = (blk.thinking || "") + (d.thinking || "");
        else if (d.type === "signature_delta") blk.signature = d.signature;
        else if (d.type === "input_json_delta")
          blk.inputJson = (blk.inputJson || "") + (d.partial_json || "");
      }
      if (blk?.hidden) return;
      emitSse({ ...j, index: blk?.clientIndex ?? j.index }, event);
      return;
    }
    if (t === "content_block_stop") {
      const blk = g.byIndex.get(j.index);
      if (blk?.type === "tool_use") blk.input = parseArgs(blk.inputJson);
      if (blk?.hidden) return;
      emitSse({ ...j, index: blk?.clientIndex ?? j.index }, event);
      return;
    }
    if (t === "message_delta") {
      g.stopReason = j.delta?.stop_reason || g.stopReason;
      if (j.delta?.stop_reason) g.ended = true;
      g.usage = { ...(g.usage || {}), ...(j.usage || {}) };
      if (st.sawOurs && !st.sawOthers && g.stopReason === "tool_use") {
        st.held.push(j);
        return;
      }
      if (st.rounds > 0) {
        emitSse({ ...j, usage: clientU() || sumUsage([...st.usages, g.usage].filter(Boolean)) }, event);
      } else emitSse(j, event);
      return;
    }
    if (t === "message_stop") {
      g.ended = true;
      if (st.sawOurs && !st.sawOthers && g.stopReason === "tool_use") {
        st.messageStopHeld = j;
        return;
      }
      emitSse(j, event);
      return;
    }
    emitSse(j, event); // ping, error, unknown
  };

  const handleOpenai = (j) => {
    const g = st.generic;
    const c = j.choices?.[0];
    if (j.error || c?.finish_reason === "error") g.failed = true;
    if (j.usage) g.usage = sumUsage([g.usage, j.usage].filter(Boolean));
    g.id = j.id || g.id;
    g.model = j.model || g.model;
    const pendingLoop = () => st.sawOurs && !st.sawOthers && (g.stopReason === "tool_calls" || !g.stopReason);
    const total = () =>
      st.rounds > 0 ? clientU() || sumUsage([...st.usages, g.usage].filter(Boolean)) : j.usage;
    if (!c) {
      if (j.usage && pendingLoop()) {
        st.held.push(j);
        return;
      }
      emitSse(j.usage ? { ...j, usage: total() } : j);
      return;
    }
    const d = c.delta || {};
    const fwdDelta = { ...d };
    if (typeof d.content === "string" && d.content) {
      let tb = g.blocks.at(-1);
      if (!tb || tb.type !== "text") {
        tb = { type: "text", text: "" };
        g.blocks.push(tb);
      }
      tb.text += d.content;
      // A later round's words go on from an earlier round's in the one message the client holds: a paragraph between,
      // as the reply that is not streamed has (`mergeJsonRounds`).
      if (!g.saidText && st.textSent) fwdDelta.content = `\n\n${d.content}`;
      g.saidText = true;
      st.textSent = true;
    }
    if (typeof d.reasoning_content === "string" && d.reasoning_content) g.reasoning += d.reasoning_content;
    if (Array.isArray(d.tool_calls)) {
      const keep = [];
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? 0;
        let blk = g.toolIdx.get(idx);
        if (!blk) {
          blk = { type: "tool_use", id: tc.id, name: tc.function?.name || "", inputJson: "", input: {} };
          g.toolIdx.set(idx, blk);
          g.blocks.push(blk);
          if (isMemoryTool(blk.name)) {
            blk.hidden = true;
            st.sawOurs = true;
          } else if (blk.name) {
            st.sawOthers = true;
            blk.clientIndex = st.clientBlocks++;
          }
        }
        if (tc.id && !blk.id) blk.id = tc.id;
        if (tc.function?.name && !blk.name) {
          blk.name = tc.function.name;
          if (isMemoryTool(blk.name)) {
            blk.hidden = true;
            st.sawOurs = true;
            if (blk.clientIndex != null) {
              const stillOthers = [...g.toolIdx.values()].some(
                (b) => b !== blk && !b.hidden && b.name && !isMemoryTool(b.name),
              );
              if (!stillOthers) st.sawOthers = false;
              delete blk.clientIndex;
            }
          } else if (!blk.hidden) {
            st.sawOthers = true;
            if (blk.clientIndex == null) blk.clientIndex = st.clientBlocks++;
          }
        }
        if (tc.function?.arguments) blk.inputJson += tc.function.arguments;
        // Unnamed blocks stay off the wire until classified; hidden memory tools never go out.
        // Arguments that arrived on the nameless start are replayed on the first forwarded chunk.
        if (!blk.hidden && blk.clientIndex != null) {
          const fn = { ...(tc.function || {}), name: blk.name || tc.function?.name };
          if (!blk.announced && blk.inputJson) fn.arguments = blk.inputJson;
          keep.push({
            ...tc,
            index: blk.clientIndex,
            id: blk.id || tc.id,
            type: tc.type || "function",
            function: fn,
          });
          blk.announced = true;
        }
      }
      if (keep.length) fwdDelta.tool_calls = keep;
      else delete fwdDelta.tool_calls;
    }
    if (c.finish_reason) {
      g.stopReason = c.finish_reason;
      g.ended = true;
      for (const blk of g.toolIdx.values()) blk.input = parseArgs(blk.inputJson);
      if (st.sawOurs && !st.sawOthers && c.finish_reason === "tool_calls") {
        st.held.push(j);
        return;
      }
    }
    const carries = ["role", "content", "reasoning_content", "reasoning", "tool_calls", "refusal", "function_call"].some(
      (k) =>
        k in fwdDelta &&
        fwdDelta[k] !== undefined &&
        !(k === "content" && fwdDelta[k] === null && !("role" in fwdDelta)),
    );
    if (!carries && !c.finish_reason && !j.usage) return; // only withheld memory tool deltas
    const fwd = { ...j, choices: [{ ...c, delta: fwdDelta }] };
    if (j.usage) fwd.usage = total();
    emitSse(fwd);
  };

  const handleResponses = (j) => {
    const g = st.generic;
    const t = j.type;
    if (t === "error" || t === "response.failed") g.failed = true;
    const seq = () => ({ ...j, sequence_number: silent ? j.sequence_number : st.seq++ });
    if (t === "response.created" || t === "response.in_progress") {
      g.id = j.response?.id || g.id;
      st.responseId = g.id;
      g.model = j.response?.model || g.model;
      if (!st.firstDone) emitSse(seq(), t);
      return;
    }
    if (t === "response.output_item.added") {
      const it = j.item || {};
      const idx = j.output_index;
      const blk =
        it.type === "function_call"
          ? { type: "tool_use", id: it.id, callId: it.call_id, name: it.name, inputJson: "", input: {} }
          : it.type === "message"
            ? { type: "text", text: "", item: it }
            : { type: it.type, item: it };
      g.byIndex.set(idx, blk);
      g.blocks.push(blk);
      if (blk.type === "tool_use" && isMemoryTool(blk.name)) {
        blk.hidden = true;
        st.sawOurs = true;
        return;
      }
      if (blk.type === "tool_use") st.sawOthers = true;
      blk.clientIndex = st.clientBlocks++;
      emitSse({ ...seq(), output_index: blk.clientIndex }, t);
      return;
    }
    if (j.output_index != null) {
      const blk = g.byIndex.get(j.output_index);
      if (blk) {
        if (t === "response.output_text.delta") blk.text = (blk.text || "") + (j.delta || "");
        else if (t === "response.function_call_arguments.delta") blk.inputJson += j.delta || "";
        else if (t === "response.function_call_arguments.done") {
          blk.inputJson = j.arguments || blk.inputJson;
          blk.input = parseArgs(blk.inputJson);
        } else if (t === "response.output_item.done") {
          blk.item = j.item;
          if (blk.type === "tool_use") blk.input = parseArgs(j.item?.arguments ?? blk.inputJson);
          else if (blk.type === "text" && j.item?.content)
            blk.text = j.item.content
              .filter((c) => c.type === "output_text")
              .map((c) => c.text)
              .join("");
          if (!blk.hidden) st.visibleItems.push(j.item);
        }
      }
      if (blk?.hidden) return;
      emitSse({ ...seq(), output_index: blk?.clientIndex ?? j.output_index }, t);
      return;
    }
    if (t === "response.completed" || t === "response.incomplete" || t === "response.failed") {
      const r = j.response || {};
      g.usage = r.usage || g.usage;
      g.stopReason = r.status;
      g.ended = true;
      g.id = r.id || g.id;
      st.responseId = g.id;
      if (
        st.sawOurs &&
        !st.sawOthers &&
        t === "response.completed" &&
        (r.output || []).some((it) => it.type === "function_call" && isMemoryTool(it.name))
      ) {
        st.held.push(j);
        return;
      }
      if (st.rounds > 0) {
        const cu = clientU();
        const output = [
          ...(st.priorItems || []),
          ...(r.output || []).filter((it) => !(it.type === "function_call" && isMemoryTool(it.name))),
        ];
        emitSse(
          {
            ...seq(),
            response: { ...r, output, usage: cu || sumUsage([...st.usages, g.usage].filter(Boolean)) },
          },
          t,
        );
      } else emitSse(seq(), t);
      return;
    }
    emitSse(seq(), t);
  };

  const dispatch = (event, j) => {
    if (fmt === "anthropic") handleAnthropic(event, j);
    else if (fmt === "responses") handleResponses(j);
    else handleOpenai(j);
  };
  const onEvent = (event, dataStr, rawBlock) => {
    if (dataStr === "[DONE]") {
      st.generic.ended = true;
      if (st.sawOurs && !st.sawOthers && st.generic.stopReason === "tool_calls") {
        st.doneHeld = true;
        return;
      }
      emit("data: [DONE]\n\n");
      return;
    }
    let j;
    try {
      j = JSON.parse(dataStr);
    } catch {
      emit(rawBlock != null ? rawBlock + "\n\n" : `${event ? `event: ${event}\n` : ""}data: ${dataStr}\n\n`);
      return;
    }
    // Round 0, no memory tool yet: handlers update state quietly and the original SSE frame is forwarded.
    // A follow-up round always intercepts (skip message_start, renumber indices). Once a memory tool is
    // seen, remaining events of that round intercept too (withhold the tool, hold the terminal).
    const pendingName = [...st.generic.toolIdx.values()].some((b) => b.type === "tool_use" && !b.name);
    const intercept = st.rounds > 0 || st.sawOurs || pendingName || memoryToolEvent(j);
    if (!intercept) {
      silent = true;
      dispatch(event, j);
      silent = false;
      if (st.sawOurs) return;
      emit(rawBlock + "\n\n");
      parsed.push([dataStr, j]);
      if (fmt === "responses" && typeof j.sequence_number === "number" && j.sequence_number + 1 > st.seq)
        st.seq = j.sequence_number + 1;
      return;
    }
    silent = false;
    dispatch(event, j);
  };
  const events = createSseEventReader((event, data, block) => {
    if (data.length) onEvent(event, data.join("\n"), block);
  }, { onOver });

  return {
    state: st,
    /** What the last `push` forwarded untouched, parsed: the next reader of that text takes it instead of parsing it again. */
    get parsed() {
      return parsed;
    },
    push(text) {
      parsed = [];
      events.push(text);
      const o = out.join("");
      out.length = 0;
      return o;
    },
    // Close one upstream reply. needsFollowUp: only memory tools were called. `failed`: the reply said an error.
    endResponse() {
      // A final event the upstream did not terminate (`data: [DONE]\n` at EOF is legal SSE) is read like any other; its
      // forwarded bytes belong in this reply's tail.
      parsed = [];
      events.end();
      const g = st.generic;
      for (const blk of g.blocks)
        if (blk.type === "tool_use" && blk.inputJson !== undefined && !Object.keys(blk.input || {}).length)
          blk.input = parseArgs(blk.inputJson);
      const ours = g.ended && !g.failed ? ourCalls(g) : [];
      const others = otherCalls(g);
      const needsFollowUp = ours.length > 0 && others.length === 0;
      const deferred = ours.length > 0 && others.length > 0 ? ours : [];
      const o = out.join("");
      out.length = 0;
      return {
        needsFollowUp,
        ours,
        deferred,
        generic: g,
        usage: g.usage,
        stopReason: g.stopReason,
        responseId: g.id,
        forwarded: o,
        failed: g.failed,
      };
    },
    nextResponse() {
      const g = st.generic;
      st.usages.push(g.usage);
      st.rounds++;
      st.firstDone = true;
      st.held = [];
      st.messageStopHeld = null;
      st.doneHeld = false;
      if (fmt === "responses")
        st.priorItems = [
          ...(st.priorItems || []),
          ...g.blocks.filter((b) => !b.hidden && b.item).map((b) => b.item),
        ];
      st.sawOurs = false;
      st.sawOthers = false;
      st.generic = newGeneric();
    },
    // When the last round ended without a follow-up, the terminal events were already forwarded (with the client
    // usage). When the whole exchange must be closed by Filament (an error mid-loop), this writes a clean ending.
    finish({ error = null } = {}) {
      const g = st.generic;
      const total = sumUsage([...st.usages, g.usage].filter(Boolean));
      const cu = clientU() || total;
      const stop = g.stopReason === "tool_use" || g.stopReason === "tool_calls" ? null : g.stopReason;
      if (fmt === "anthropic")
        return error
          ? sse({ type: "error", error: { type: "api_error", message: error } }, "error")
          : `${sse({ type: "message_delta", delta: { stop_reason: stop || "end_turn", stop_sequence: null }, usage: cu || { output_tokens: 0 } }, "message_delta")}${sse({ type: "message_stop" }, "message_stop")}`;
      if (fmt === "responses") {
        if (error) return sse({ type: "error", message: error, sequence_number: st.seq++ }, "error");
        const held = st.held.find((h) => /^response\.(completed|incomplete|failed)$/.test(h.type));
        const r = held?.response || { id: g.id, object: "response", status: "completed" };
        const output = [
          ...(st.priorItems || []),
          ...(r.output || []).filter((it) => !(it.type === "function_call" && isMemoryTool(it.name))),
        ];
        return sse(
          {
            type: held?.type || "response.completed",
            sequence_number: st.seq++,
            response: { ...r, output, usage: cu || r.usage },
          },
          held?.type || "response.completed",
        );
      }
      if (error) return sse({ error: { message: error, type: "server_error" } });
      return (
        sse({
          id: g.id || "filament",
          object: "chat.completion.chunk",
          model: g.model,
          choices: [{ index: 0, delta: {}, finish_reason: stop || "stop" }],
        }) +
        (total
          ? sse({
              id: g.id || "filament",
              object: "chat.completion.chunk",
              model: g.model,
              choices: [],
              usage: cu,
            })
          : "") +
        "data: [DONE]\n\n"
      );
    },
    clientUsage: () => clientU(),
    totalUsage: () => totalOf(),
  };
}

// The generic turn a stream built, converted for appendFollowUp (same shape as parseReply's).
export const genericFromStream = (g) => ({
  blocks: g.blocks.map((b) =>
    b.type === "tool_use"
      ? {
          type: "tool_use",
          id: b.id,
          callId: b.callId,
          name: b.name,
          input: b.input && Object.keys(b.input).length ? b.input : parseArgs(b.inputJson),
        }
      : b.type === "text"
        ? { type: "text", text: b.text || "" }
        : b.type === "thinking"
          ? { type: "thinking", thinking: b.thinking || "", signature: b.signature }
          : b.type === "redacted_thinking"
            ? { type: "redacted_thinking", data: b.data }
            : { type: b.type },
  ),
  stopReason: g.stopReason,
  usage: g.usage,
  id: g.id,
  model: g.model,
  reasoning: g.reasoning || "",
});

// ---------------------------------------------------------------------------------------------------
// The one-line cue: a visible first line on a session's first reply, naming related sessions and how to load one.
// ---------------------------------------------------------------------------------------------------
export function applyCueJson(fmt, json, cue) {
  if (!json || !cue) return false;
  const line = `${cue}\n\n`;
  if (fmt === "anthropic") {
    const b = (json.content || []).find((x) => x.type === "text");
    if (b) {
      b.text = line + (b.text || "");
      return true;
    }
    if (Array.isArray(json.content)) {
      json.content.unshift({ type: "text", text: cue });
      return true;
    }
    return false;
  }
  if (fmt === "responses") {
    for (const it of json.output || []) {
      if (it.type !== "message") continue;
      const c = (it.content || []).find((x) => x.type === "output_text");
      if (c) {
        c.text = line + (c.text || "");
        return true;
      }
    }
    return false;
  }
  const m = json.choices?.[0]?.message;
  if (!m) return false;
  if (Array.isArray(m.content)) {
    const first = m.content.find((c) => c?.type === "text");
    if (first) first.text = line + (first.text || "");
    else m.content.unshift({ type: "text", text: cue });
    return true;
  } // content parts: prepend to the first text part, never drop the array
  m.content = line + (typeof m.content === "string" ? m.content : "");
  return true;
}

// Client-format SSE stage that puts the cue in front of the model's first text. Text-only replies get the line;
// a reply that is only tool calls gets nothing (the cue would have nowhere to live). Its events are read as
// core/wire/sse.js `createSseEventReader` reads them: one with a line past what Filament reads of one is dropped from
// what it forwards, `onOver` told.
/** @param {string} fmt @param {string} cue @param {{ onOver?: (over: import("../core/lines.js").Over) => void }} [o] */
export function createCueStream(fmt, cue, { onOver = () => {} } = {}) {
  let done = false,
    seq = 0,
    seenSeq = false,
    cueItem = null;
  const line = `${cue}\n\n`;
  const out = [];
  const sse = (obj, event) => `${event ? `event: ${event}\n` : ""}data: ${JSON.stringify(obj)}\n\n`;
  const onEvent = (event, dataStr, rawBlock) => {
    if (dataStr === "[DONE]" || (done && fmt !== "responses")) {
      out.push(rawBlock + "\n\n");
      return;
    }
    let j;
    try {
      j = JSON.parse(dataStr);
    } catch {
      out.push(rawBlock + "\n\n");
      return;
    }
    if (fmt === "anthropic") {
      out.push(rawBlock + "\n\n");
      if (j.type === "content_block_start" && j.content_block?.type === "text") {
        out.push(
          sse(
            { type: "content_block_delta", index: j.index, delta: { type: "text_delta", text: line } },
            "content_block_delta",
          ),
        );
        done = true;
      }
      return;
    }
    if (fmt === "responses") {
      const has = typeof j.sequence_number === "number";
      if (has) seenSeq = true;
      const next = () => (seenSeq ? seq++ : undefined);
      if (j.type === "response.output_text.delta" && !done) {
        cueItem = j.item_id || null;
        out.push(sse({ ...j, delta: line, sequence_number: next() }, j.type));
        done = true;
      }
      if (
        j.type === "response.output_item.done" &&
        j.item?.type === "message" &&
        (!cueItem || j.item.id === cueItem)
      ) {
        const c = (j.item.content || []).find((x) => x.type === "output_text");
        if (c && !String(c.text || "").startsWith(cue)) c.text = line + (c.text || "");
      }
      if (/^response\.(completed|incomplete)$/.test(j.type) && j.response?.output) {
        const target =
          j.response.output.find((it) => it.type === "message" && (!cueItem || it.id === cueItem)) ||
          j.response.output.find((it) => it.type === "message");
        const c = target ? (target.content || []).find((x) => x.type === "output_text") : null;
        if (c && !String(c.text || "").startsWith(cue)) {
          c.text = line + (c.text || "");
          done = true;
        }
      }
      if (has) j.sequence_number = next();
      out.push(sse(j, j.type));
      return;
    }
    const c = j.choices?.[0];
    const d = c?.delta;
    if (d && ("role" in d || typeof d.content === "string")) {
      const cueChunk = {
        ...j,
        choices: [
          {
            ...c,
            delta: { ...("role" in d ? {} : { role: "assistant" }), content: line },
            finish_reason: null,
          },
        ],
      };
      delete cueChunk.usage;
      if ("role" in d) {
        out.push(sse(j));
        out.push(sse(cueChunk));
      } else {
        out.push(sse(cueChunk));
        out.push(sse(j));
      }
      done = true;
      return;
    }
    out.push(sse(j));
  };
  const events = createSseEventReader((event, data, block) => {
    if (data.length) onEvent(event, data.join("\n"), block);
    else if (block.trim()) out.push(block + "\n\n");
  }, { onOver });
  return {
    push(text) {
      events.push(text);
      const o = out.join("");
      out.length = 0;
      return o;
    },
    // What the stream left after its last blank line, as it came.
    end() {
      return events.rest();
    },
    get applied() {
      return done;
    },
  };
}

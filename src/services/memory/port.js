// @ts-check
// The memory port (HarnessV3-Memory MD-21, M2-4): every consumer outside the memory service — the model's tools, the
// person's @mem, an agent over MCP (an ACP agent's, or any client's on /mcp/memory), a sub-agent, the dashboard and its
// assistant — reaches memory through a handle
// from `memory.scope({ role, ... })`. The handle knows who is asking: its role is the `by` on every write it makes,
// so no caller can forget to say, or say it for someone else. It reads the service's brain at each call, because the
// brain is rebuilt whenever memory reopens; a handle kept across a reopen keeps working. The verbs that reach the
// engine or write are async and refuse by rejecting, memory closed included; the session reads are synchronous, but for
// `errata`, which looks at the disk.
import { NO_PROJECT_ID } from "../../core/project-id.js";

/**
 * Who can ask (the `by` of a write): the person in the chat, the owner on the dashboard or its console, the model
 * through its tools, an agent over MCP or a sub-agent, and Filament's own learner and curator (M4-1).
 */
export const ROLES = Object.freeze(["person", "owner", "model", "agent", "learner", "curator"]);
/** Filament's own roles: what they write is Filament's, never the user's or an assistant's. @param {string} role */
export const filamentRole = (role) => role === "learner" || role === "curator";
/** Whether a role's word is the user's own: the person in the chat or the owner. A model's or an agent's is a note. @param {string} role */
export const speaksForUser = (role) => role === "person" || role === "owner";

/**
 * A handle on memory for one consumer.
 * @param {any} service  the MemoryService
 * @param {{ role: string, project?: string | null, chain?: string | null, turn?: number | null, conversation?: string | null, client?: string, finder?: import("./brain.js").Finder | null, deferTo?: string | null, confined?: boolean, helper?: boolean }} o
 *   `project`, `chain`, `turn`: where the consumer stands (a write is filed there, a load counts there);
 *   `conversation`: the model context the consumer is, when it is not the session's own (HarnessV3-Memory M7-3): a
 *   sub-agent's id. A reminder is said once in it, and its calls are told as its;
 *   `client`: who the consumer is, as the record names it (`claude-code`, `agent:<upstream>`); `finder`: the sub-agent
 *   whose run the consumer is (M7-D20): what it remembers or corrects is its finding, named for it; `deferTo`: where
 *   what a reply could not carry waits, when not at `conversation` (a request's own, from memory's prepare);
 *   `confined`: the consumer works for a caller that could not read every session (another machine without the admin
 *   token): its searches, session lists, loads and greps keep to `project`'s sessions and the one it stands in;
 *   `helper`: a coding agent's sub-agent, standing in the chat that launched it, whose quote of the person is not heard
 *   (the memory plan's d1: the person spoke to the agent that launched it)
 */
export function memoryHandle(service, { role, project = null, chain = null, turn = null, conversation = null, client = "", finder = null, deferTo = null, confined = false, helper = false }) {
  if (!ROLES.includes(role)) throw new Error(`memory.scope needs a role (${ROLES.join(", ")}); got ${role}`);
  const brain = () => {
    if (!service.brain) throw new Error(`no archive: ${service.archiveWhy()}`);
    return service.brain;
  };
  const by = role;
  const here = conversation || chain;
  /** The project a confined handle keeps to; null where it stands in none, which keeps it to its own session. */
  const own = project && project !== NO_PROJECT_ID ? project : null;
  /**
   * Whether a session is the handle's to read: any, unconfined; confined, the one it stands in and its project's. One
   * Memory settings leave out is its own alone (brain.js `keptToItself`): no other's to read.
   * @param {string} id
   */
  const reaches = (id) =>
    id === chain || id === here || ((!confined || (!!own && service.archive?.chainHead?.(String(id))?.project_id === own)) && !service.brain?.keptToItself?.(String(id)));
  /** The verbs that are the user's alone: the person's or the owner's. @param {string} what */
  const userOnly = (what) => {
    if (!speaksForUser(role)) throw new Error(`only the user ${what}`);
  };
  return Object.freeze({
    role,
    project,
    chain,
    turn,
    conversation: here,
    client,
    confined,
    reaches,
    /** The session record, for the recall tool's pointers: archived turns and tool results, not memories. */
    get archive() {
      return service.archive;
    },
    /** Whether memory is open now: a handle outlives a reopen, and a write while memory is closed is refused. */
    isOpen: () => !!service.brain,

    // ---- reads ----
    /**
     * Memories for a query, every project's. `project: true` keeps to the scope's project: its claims, read from its own
     * items too, the ones that hold in every project, and what was typed in its sessions. A confined handle's always
     * keeps to it; with no project, to the claims that hold in every project. A memory the handle's session was shown
     * that the search answers again counts as a use of that showing (b4): the agent went back for it — in a topic page's
     * lines too (`covers`, the memory plan's f7).
     * @param {string} query @param {{ limit?: number, project?: boolean }} [o]
     */
    search: async (query, { limit = 10, project: only = false } = {}) => {
      const found = confined
        ? await brain().search(query, { projectId: own || NO_PROJECT_ID, only: true, limit, at: project })
        : await brain().search(query, { projectId: only ? project : null, only, limit, at: project });
      if (here && Array.isArray(found)) brain().creditShown(here, found.flatMap((/** @type {any} */ it) => (it?.kind === "page" ? it.covers || [] : [String(it?.id || "")])).filter(Boolean));
      return found;
    },
    /**
     * What a worker that starts without the session's conversation is handed with its task (HarnessV3-Memory M7-1,
     * M7-D1): the scope's session's errata, the user's rules, the dossier, the procedures, pitfalls and threads for its
     * task and tools, and what else the task matches, each line with its id; logged as shown on the scope's turn.
     * `purpose`: subagent or agent; `model`, a sub-agent's: the model its calls go out on. A confined handle's matches
     * are its project's memory alone.
     * @param {{ purpose?: string, task?: string, tools?: string[], budget?: number | null, model?: string }} [o]
     */
    brief: async ({ purpose = "agent", task = "", tools = [], budget = null, model = "" } = {}) =>
      brain().brief({ projectId: project, chainId: chain, turnId: turn, purpose, task, tools, budget, within: confined ? own || NO_PROJECT_ID : undefined, model }),
    /**
     * Past sessions by what was typed in them: a confined handle's, its project's alone; none Memory settings leave out
     * (brain.js `sessions`' `others`). @param {string} query @param {{ limit?: number }} [o]
     */
    sessions: (query, { limit = 10 } = {}) => (!confined ? brain().sessions(query, { limit, others: true }) : own ? brain().sessions(query, { limit, project: own, others: true }) : []),
    /**
     * A past session's material; null for none, or one a confined handle does not reach (`reaches`), whose lineage keeps
     * to its project too. Another session's turns kept apart stay out (brain.js `load`'s `others`); the handle's own
     * session reads them. The session's own context loading another of its project before its first turn is finished
     * continues it (brain.js `linkLoaded`); a sub-agent's load links nothing. @param {string} id @param {any} [o]
     */
    load: (id, o = {}) => {
      if (!reaches(id)) return null;
      const r = brain().load(id, { ...o, ...(confined ? { within: own || NO_PROJECT_ID } : {}), others: id !== chain && id !== here });
      if (r && chain && here === chain && id !== chain) brain().linkLoaded(chain, id);
      return r;
    },
    /**
     * Where words were said in a session, newest turn first; null for one a confined handle does not reach. Another
     * session's turns kept apart stay out, as `load`'s do.
     * @param {string} id @param {{ text: string, limit?: number, fromTurn?: number | null, toTurn?: number | null }} o
     */
    grep: (id, o) => (reaches(id) ? brain().grep(id, { ...o, others: id !== chain && id !== here }) : null),
    /** How many tokens of past sessions one request may load in all. */
    loadCeiling: () => Number(brain().getConfig?.()?.autopilot?.loadBudgetTokens) || 30000,
    /** How long a turn waits on memory (the brain's `waitMs`), a memory tool's call included; null while memory is closed. */
    waitMs: () => service.brain?.waitMs ?? null,
    /** A claim: what it says, how it is known, where it is filed. @param {string} id */
    claim: (id) => brain().claim(id),
    /**
     * The open thread a task of the session's graph names (HarnessV4_GraphThreads E28): its words, whether it is the
     * user's own, its project — or why the id names none. @param {string} id
     */
    thread: (id) => brain().threadOf(id),
    /** A claim's history: who changed it, why and when, and what it replaced or was replaced by. @param {string} id */
    history: (id) => brain().history(id),
    /** A claim's card, as the claim browser draws it (HarnessV3-Memory M7-D34); a stored item that is no claim, refused. @param {string} id */
    card: (id) => brain().card(id),
    /**
     * What the consumer was shown outside a request, logged as shown in its session (M7-D40), so a claim retired later
     * reaches it as an erratum; nothing without a session. @param {string} kind @param {string[]} ids @param {string} text
     */
    shown: (kind, ids, text) => {
      if (here) brain().noteShown(here, kind, ids, text);
    },
    /**
     * What its session was shown and is retired since, or whose files moved: taken and said once, as lines (M7-D40); ""
     * without a session. Async where the session reads are not: the files of every anchored claim it was shown are
     * checked, their stats taken off the event loop first, as a turn block's are.
     */
    errata: async () => {
      if (!here) return "";
      const b = brain();
      const check = b.anchorCheck.run();
      await check.warm(b.archive.anchors.pathsShownIn(here));
      return b.sayErrata(here, { check }).text;
    },
    /**
     * Text for this conversation's next request: tool results a reply could not carry — `calls`, each call's id and its
     * part of the text, so a result the next request carries already is said no second time.
     * @param {string} text @param {{ id: string, text: string }[] | null} [calls]
     */
    defer: (text, calls = null) => brain().setDeferred(deferTo || here, text, calls),
    /**
     * Memory at the moment of action (HarnessV3-Memory M5-3, M5-5): the pitfalls a tool call is about to repeat and the
     * open threads on the files it touches, each as the line that rides on the call's result; each firing is recorded
     * in the scope's session and turn, said once in its conversation. `mark: false`: each firing is handed back (`fire`)
     * unrecorded, for `fired` once its line reached the agent. @param {string} tool @param {any} input
     * @param {{ mark?: boolean }} [o]
     */
    reminders: (tool, input, { mark = true } = {}) => brain().remindersFor({ projectId: project, chainId: chain, turnId: turn, conversation, tool, input, mark }),
    /** The reminders `reminders` read unmarked, said now: each firing recorded. @param {readonly { fire?: any }[]} list */
    fired: (list) => brain().noteFired(list.flatMap((p) => (p.fire ? [p.fire] : []))),
    /**
     * What happened while the consumer worked (HarnessV3-Memory M5-4), told to memory's observers in the scope's
     * project, session and turn, from its conversation: a tool call's result (`{ type: "tool.result", id, tool, input,
     * ok, exitCode, error }`). Never waits; dropped while memory is closed or does not learn. @param {any} event
     */
    observe: (event) => service.observe?.({ ...event, project, chain, turn, ...(conversation ? { conversation } : {}) }),

    // ---- writes: each one by this role ----
    /** `quote`: the person's words that say it, filed as theirs where this chat holds them (the memory plan's d1). @param {string} text @param {{ kind?: string, importance?: number, quote?: string }} [o] */
    remember: async (text, { kind = "fact", importance = 0.8, quote = "" } = {}) =>
      brain().remember(text, { kind, importance, projectId: project, chainId: chain, turnId: turn, client, by, finder, quote, helper }),
    /** Replace a claim, or retire it when there is no new text. @param {string} id @param {{ text?: string, reason?: string, quote?: string }} [o] */
    correct: async (id, { text = "", reason = "", quote = "" } = {}) => brain().correct(id, { text, reason, by, chainId: chain, turnId: turn, client, finder, quote, helper }),
    /** Close an open thread whose work is done (M7-D64); the user's own is asked about. @param {string} id @param {{ because?: string }} [o] */
    close: async (id, { because = "" } = {}) => brain().closeThread(id, { by, because, chainId: chain, turnId: turn, finder }),
    /** @param {string} id */
    confirm: async (id) => brain().confirm(id, { by }),
    /** Retire a claim: kept with its history, never deleted. @param {string} id @param {{ reason?: string | null }} [o] */
    forget: async (id, { reason = null } = {}) => brain().forget(id, { by, reason, chainId: chain, finder }),
    /**
     * Set a claim's status as it is: the owner's control on the dashboard. Every other role goes through confirm,
     * correct, close and forget, which carry their own rules. @param {number} id @param {string} status @param {{ reason?: string }} [o]
     */
    setStatus: async (id, status, { reason = "set in the console" } = {}) => {
      if (role !== "owner") throw new Error("only the owner sets a memory's status directly; confirm, correct, close or forget it instead");
      return brain().setItemStatus(Number(id), status, { by, reason });
    },
    /**
     * A claim's words written into a skill (Add to a skill…, HarnessV4_Skills_Plan step 4): said on its History, the
     * claim as it was — the owner's act on the page. False where the id names no claim. @param {string} id
     * @param {{ skill: string, section: string }} o
     */
    addedToSkill: (id, { skill, section }) => {
      if (role !== "owner") throw new Error("only the owner adds a memory's words to a skill");
      return brain().noteAddedToSkill(id, { skill, section, by });
    },

    // ---- the curator's questions and passes (HarnessV3-Memory M4): the user's to answer, run and undo ----
    /**
     * Memory's open questions for the scope's project and the global ones. A confined handle's leave out the ones it
     * does not reach: one that would keep a claim in every project, which quotes other projects' (the memory plan's
     * f5), and one about another project's claim. @param {{ status?: string }} [o]
     */
    questions: ({ status = "open" } = {}) =>
      brain()
        .questions(project, { status })
        .filter((/** @type {any} */ q) => !confined || brain().questionReaches({ kind: q.kind, itemIds: q.claims.map((/** @type {any} */ c) => Number(String(c.id).slice(1))) }, own)),
    /** Answer a question: `accept` carries it out as this role's word, `reject` closes it for good. @param {string} id @param {string} answer */
    decide: async (id, answer) => {
      userOnly("answers memory's questions");
      if (confined) {
        const q = service.archive?.inbox?.get(Number(String(id).replace(/^q/i, "")));
        if (q && !brain().questionReaches(q, own)) return { ok: false, error: `${id} is about other projects: it is answered where every project is` };
      }
      return brain().decide(id, answer, { by, chainId: chain });
    },
    /** A curator pass over the scope's project now, after any pass already running. */
    curate: async () => {
      userOnly("runs the curator");
      if (!service.curator) throw new Error("the curator does not run: memory is off");
      return service.curator.run(project, { reason: "asked" });
    },
    /** Undo a curator pass (`r12`): its actions reversed and marked, never deleted. @param {string} run */
    undo: async (run) => {
      userOnly("undoes a curator pass");
      return brain().undoRun(Number(String(run).replace(/^r/i, "")), { by });
    },
  });
}

// @ts-check
// Shared machinery for agent bridges (ACP agents in acp/bridge.js, the Cursor SDK in cursor-sdk.js, Codex in
// codex/bridge.js): the live turn that outlives one HTTP reply, the client-tool actions it can raise, and the wait /
// resume / interrupt cycle.
//
// One agent turn as the chat client sees it. A turn may outlive the HTTP reply that started it: when the agent
// needs the client's hands (a permission answer, a file, a command) Filament ends the reply with a tool call,
// the client runs it and comes back with the result in a new request, and the same turn continues into that
// new reply. Events that arrive while no reply is attached are buffered.
import { randomBytes } from "node:crypto";
import { ClientToolset, newActionId } from "./client-bridge.js";
import { answerFromText, answerWords, askedOf, endedBy, fromJudged, nobodyAnswer } from "./asks.js";
import { LocalHands } from "../tools/local-hands.js";
import { renderRecord } from "../../core/notes.js";
import { agentTitle } from "../../core/catalogues.js";
import { classifyFailure, overflowSaid } from "./acp/failures.js";
import { mcpCallOf } from "./acp/updates.js";
import { ACP } from "../../core/schema.js";

/** The permission policies an upstream's `acp.permissions` takes (core/schema.js). @type {readonly string[]} */
const POLICIES = ACP.permissions.options;
/** Whether a word is one of the permission policies. @param {string} word */
export const isPolicy = (word) => POLICIES.includes(word);
/**
 * Whether a policy puts what the agent asks to someone first: `ask`, and a word that is none of the policies (a
 * config.json edited by hand, `policyOf`). Where nobody can be asked, `ask` allows it once and says so; a word that is
 * none of them refuses it, as `reject` does (`choosePermission`): never allowed unasked.
 * @param {string} policy
 */
export const askingPolicy = (policy) => policy === "ask" || !isPolicy(policy);
/**
 * What refused a request where a policy refused it: the policy, or a word that is none of them, which asked first and
 * found nobody to ask. A noun phrase, as a refusal's `why` names what refused.
 * @param {string} policy
 */
export const policyRefused = (policy) => (isPolicy(policy) ? `the ${policy} permission policy` : `the permission policy "${policy}", which is none of the policies and asks first, with nobody to ask`);

/**
 * Filament's own MCP server's address for an agent's session, `/mcp/<token>`: the token is the session's capability,
 * standing for the tools it is given (`contextForMcpToken`). A session's record on disk keeps the address with its
 * token left out (`addressKept`), and a session opened again from that record is given a new one (`addressGiven`).
 * @param {string} base @param {string} token
 */
export const mcpAddress = (base, token) => `${base}/mcp/${token}`;
/** Filament's own server's address as a record on disk keeps it: its token left out. @param {string} url */
export const addressKept = (url) => url.replace(/\/mcp\/[^/]*$/, "/mcp/");
/**
 * An address a record kept without its token (`addressKept`), given a new one; null for an address that has its own.
 * @param {string} url @returns {{ url: string, token: string } | null}
 */
export const addressGiven = (url) => {
  if (!url.endsWith("/mcp/")) return null;
  const token = randomBytes(12).toString("hex");
  return { url: `${url}${token}`, token };
};

/** @typedef {(level: string, msg: string) => void} Log */
/**
 * Where Filament's own tools stand for a turn (HarnessV3-ACP AC4-2, AC4-5): the session it runs in (memory's chain, else
 * the session the request belongs to, where memory left it out or its prepare failed before it opened the turn) and
 * that session's turn as memory keeps it, whether it has the task graph, whether the turn is a graph task's sub-agent's,
 * which ends with its `report` (AC6-1), the id of a team's worker whose lead reads along, which asks it with ask_lead
 * (`asksLead`, HarnessV3-TaskGraph-v2 TG2-D49), and whether its agent leads the session's team, with the team's tools
 * (AC6-3), and whether its chat shows the agent's visuals (`visuals`, HarnessV4_Visuals_Plan E16) — `by` the
 * sub-agent whose run it is and which of its exchanges, which they are kept under — and makes its artifacts
 * (`artifacts`, HarnessV4_Artifacts_Plan E18), a version of which names the model the turn asked for (`model`).
 * `callOf`: the agent's own call a
 * call over MCP came in, on the turn's run; `callIsOwn`: whether a call over MCP came in the agent's own call or a
 * sub-agent's of its own, claiming none. `none`: a call of Filament's own (HarnessV4_Tasks C33), whose session is
 * offered none of Filament's tools, memory's among them. `mcp`: the chat's own MCP servers (`plugins.mcp`, as its
 * settings hold them) and `dirs`: the folders it adds for reading (`loop.addedFolders`, as they passed), which the
 * agent's session opens with (HarnessV4_Overnight_Plan OV-D15, OV-D23). `confined`: the turn is for a caller that
 * reaches its own project's sessions alone, and so are memory's tools. `leftOut`: Memory settings leave its chat out
 * (D4 of 11-01): its session is offered none of memory's tools. `memoryWorks`: memory works in its chat — on, and no
 * Memory setting leaves it out — its tools offered or not, where the agent's own memory goes off. `rowless`: memory keeps no row of the turn — it leaves
 * the turn out for a reason of its own, or its situate or prepare failed (stages/situate.js `turnMemState`) — so its own
 * agent's pictures are kept on the session `chain` names while it runs. `spaceOn`: the chat's project has a Space, made
 * and switched on, now (the owner's of 11-08, h3), whose coming or going opens the session again with its tool. `space`:
 * false where a sub-agent's card goes without the Space (SA2).
 * @typedef {{ chain: string | null, turn: string | null, graph: boolean, report?: boolean, asksLead?: string, team?: boolean, reads?: boolean, confined?: boolean, leftOut?: boolean, memoryWorks?: boolean, rowless?: boolean, visuals?: boolean, artifacts?: boolean, spaceOn?: boolean, space?: false, model?: string, by?: { id: string, exchange: number, name?: string, team?: { key: string, name: string } },
 *   callOf?: (name: string) => Promise<{ id: string, round: number } | null>, callIsOwn?: (name: string) => Promise<boolean | null>, none?: boolean, mcp?: readonly ChatServer[], dirs?: readonly string[] }} ToolsAt
 */
/**
 * One of the chat's own MCP servers (`plugins.mcp`): over stdio or streamable HTTP. `load` is Filament's own loop's
 * (E49), which no agent is given; `note`, what of it the place uses, is said in the agent's standing context.
 * @typedef {{ name: string, command?: string, args?: string[], env?: Record<string, string>, cwd?: string, url?: string, headers?: Record<string, string>, load?: string, note?: string }} ChatServer
 */
/** @typedef {import("./asks.js").AskForm} AskForm @typedef {import("./asks.js").AskAnswer} AskAnswer */
/**
 * How the harness's own turn asks the person (HarnessV3-ACP AC2-4): the run holds the question, by its id, until the
 * page answers it. Null when the wait ends unanswered: a stop, a hang-up, or the signal (the agent's own end of it).
 * @typedef {(form: AskForm, id: string, signal: AbortSignal | null) => Promise<AskAnswer | null>} Asker
 */
/**
 * How a harness chat's turn makes its seed fit when the agent refuses it for its size (HarnessV3-FailurePoints D9):
 * Filament compacts its copy of the chat and composes the turn again — the request a new session is seeded from, with
 * the composer's report of it for the record (`composition`) — or says why it made no room. `said`: what the
 * agent's refusal said of its context in numbers (`overflowSaid`), which the compaction aims under (HarnessV4_Tasks
 * B5). A turn whose message asks before room is made names `"ask"` in its place (HarnessV4_Tasks C26): nothing is
 * compacted, and the refusal is the turn's failure, which the page answers with the ways to make room.
 * @typedef {(said: ReturnType<typeof overflowSaid>) => Promise<{ body: any, headers: Record<string, string>, composition?: any } | { error: string }>} Reseed
 */
/**
 * The agent's own commands among the person's words sent while it works (`/compact`), by its session's word (the
 * `session` event's `ownCommands`). `holds` names the command the words are, which waits for the turn's end; null for
 * words. `unsure`: words shaped like a command, sent before the agent said its commands, can't be told yet — the
 * promise of its word; null once it has, or for other words (HarnessV3-FailurePoints, the early-command race).
 * @typedef {{ holds: (text: string) => string | null, unsure: (text: string) => Promise<void> | null }} AgentCommands
 */
/**
 * How a bridge hands the person's words to its agent's turn (the `session` event's `steer`): queued at the agent, which
 * takes them at its next step or after its turn's answer (`queued`, HarnessV3-FailurePoints §7.2), into the running turn
 * (`live`, HarnessV3-ACP AC3-1) or at its next step (`next`, AC-D6). `send` is true once the agent took them — `"after"`
 * when it took them after its turn's answer — `words` the person's own where the agent hears them wrapped (a
 * sub-agent's), `images` the pictures they carry. `interrupt`, where the agent can be: the words interrupt it instead
 * (FP-D8). `images`: the agent takes pictures with the words (HarnessV4_Tasks C22); where it doesn't, none are sent.
 * `by`: whose the words are — the person's, or Filament's own or relayed — which a turn cancelled at its next step says
 * ahead of them (acp/next-step.js; the nudge map of 11-10).
 * @typedef {import("../../core/media.js").SteerImage} SteerImage
 * @typedef {{ at: "live" | "next" | "queued", send: (text: string, words?: string, images?: SteerImage[], by?: "person" | "filament") => Promise<boolean | "after">, interrupt?: (text: string, words?: string, images?: SteerImage[], by?: "person" | "filament") => Promise<boolean>, images?: boolean }} Steer
 */
/**
 * What an agent asks to do, as one of the loop's calls (HarnessV3-ACP AC3-2): the loop's tool name and its input.
 * `reads`: an MCP tool's call its agent says only reads (its request's kind `read`) — the gate judges it as the loop
 * judges a tool its server vouches for as read-only (readOnlyHint, the loop's `mcpReadOnly`).
 * @typedef {{ name: string, input: any, reads?: boolean }} LoopCall
 */
/**
 * The session's switch's verdict on a request (AC3-2): run, refuse (`why`: what refused it, as the call's card says
 * it), or ask — the loop's permission card's words: the tool, its question, a command whole and why it asks apart from
 * it, each file it changes as its diff and how many more past those (HarnessV3-ACP, AC3's drive D5), the project's
 * always-allow waiting for the call's shape — or, where the project offers none, what "Always allow in this chat"
 * would keep of the command (`keeps`, d-allow). `mode`: the mode it was judged under; `how`: the verdict in words for the
 * record; `notes`: more for the record (the switch moved, a rule reached part of a command); `offers`: the
 * always-allows a yes brought to its threshold; `review`: a review rule asks, with a second look first and no
 * always-allow (HarnessV4_Space_Plan SG-D13), as `describeRule` says it; `always`: the agent offers only to always
 * allow it, so what would run asks, and its card says the grant stays with the agent.
 * @typedef {{ verdict: "run" | "refuse" | "ask", mode: string, how: string, notes: string[], why?: string, tool?: string,
 *   question?: string, command?: string, reason?: string, changes?: import("../../core/types.js").FileChange[],
 *   changesLeft?: number, offer?: { itemId: number, tool: string, shape: string }, review?: string, always?: true,
 *   keeps?: { hand: "bash" | "powershell", folder: string, commands: string[] },
 *   offers?: { tool: string, shape: string, text: string, count: number, itemId: number }[] }} Judgement
 */
/**
 * How the harness's own turn judges what its agent asks to do (AC3-2, AC-D13): `judge` the calls under the session's
 * rules and its switch as they stand, `allowed` the person's yes to them — judged again, and counted towards the
 * project's always-allow — or a worker's lead's yes (`by: "lead"`, HarnessV3-TaskGraph-v2 TG2-D41), judged again
 * the same and counted towards nothing; `mode` the switch's mode now, for an agent whose sandbox follows it as a turn
 * starts (Codex). `root`: the agent's folder, where a command is read for whether it only reads. `look`: a review
 * rule's second look starts on the request that asks (HarnessV4_Space_Plan S3b); `unlook` stops it once answered.
 * `rulesAsk`: the ask or review rule that speaks for the calls, whatever the mode (a command on another machine).
 * `judge`'s `always`: the agent offers only to always allow the calls; `allowed`'s: the person's yes to such a card,
 * which counts towards no always-allow of the project's. `onlyReads`: whether each of the calls is one the gate runs
 * in every mode as only reading — a command read so, an MCP tool its agent says reads —, whatever the rules say of it.
 * @typedef {{ judge: (calls: LoopCall[], root: string, o?: { always?: boolean }) => Judgement,
 *   allowed: (calls: LoopCall[], root: string, o?: { by?: "lead", always?: boolean }) => Judgement, mode: () => string,
 *   rulesAsk?: (calls: LoopCall[], root: string) => string | null, onlyReads?: (calls: LoopCall[], root: string) => boolean,
 *   look?: (about: import("../../core/second-look.js").LookAbout) => import("../../core/second-look.js").LookRef,
 *   unlook?: (look: import("../../core/second-look.js").LookRef | null) => void }} Permits
 */
/**
 * Something the agent waits on from the client: a tool call the reply hands out, settled by the client's next request.
 * @typedef {{ id: string, kind: string, name: string, input: any, parse: ((text: string, isError: boolean) => any) | null,
 *   createdAt: number, settled: boolean, handedOut: boolean, handedAt?: number, promise: Promise<any>,
 *   resolve: (v: any) => void, reject: (e: any) => void }} ClientAction
 */

export class LiveTurn {
  /**
   * @param {{ convKey?: string, upstreamId?: string, clientTools?: ClientToolset | null, bridge?: string,
   *   onEvent?: ((ev: any) => Promise<void> | void) | null, log?: Log, clientWaitMs?: number, asker?: Asker | null,
   *   permits?: Permits | null, toolsAt?: ToolsAt | null, asks?: { n: number } | null }} [o]
   */
  constructor({
    convKey,
    upstreamId,
    clientTools = null,
    bridge = "prompts",
    onEvent = null,
    log = () => {},
    clientWaitMs = 3600_000,
    asker = null,
    permits = null,
    toolsAt = null,
    asks = null,
  } = {}) {
    this.id = randomBytes(4).toString("hex");
    this.convKey = convKey;
    this.upstreamId = upstreamId;
    this.clientTools = clientTools || new ClientToolset();
    this.bridge = bridge;
    /** How the person is asked on the page: the harness's own turn's, else none. */
    this.asker = asker;
    /** How what the agent asks to do is judged: by the harness session's switch, else by the upstream's policy. */
    this.permits = permits;
    /** Where Filament's own tools stand while the turn runs (HarnessV3-ACP AC4-2, AC4-5). */
    this.toolsAt = toolsAt;
    /** The plan the agent proposed was sent back to it (HarnessV3-ACP AC3-3): its agent ends the turn, which isn't a cancel. */
    this.planBack = false;
    /** The mode the agent goes back to when a yes to its plan moves it on to another: the turn's asking mode. @type {string | null} */
    this.planMode = null;
    /**
     * The agent's questions so far, which number them: its run's count, which every prompt of the run carries on — a
     * run that prompts its agent again would otherwise ask its next question under an id one of its asks ended with
     * (the owner's of 11-10: the chat listed no ask, and its turn waited for a yes nobody could give) — else its own.
     * @type {{ n: number }}
     */
    this.asks = asks || { n: 0 };
    this.log = log;
    this.clientWaitMs = clientWaitMs;
    this.sink = onEvent;
    /** Events that came while no reply was attached. @type {any[]} */
    this.buffer = [];
    /** @type {Map<string, ClientAction>} */
    this.actions = new Map();
    /** @type {((v?: any) => void)[]} */
    this.waiters = [];
    /** @type {Set<string>} */
    this.knownActionIds = new Set();
    this.done = false;
    /** @type {any} */
    this.out = null;
    /** @type {any} */
    this.error = null;
    /** @type {Promise<any> | null} */
    this.promise = null;
    /** The agent's session (or thread, or SDK agent) this turn runs in. @type {string | null} */
    this.sessionId = null;
    /** @type {any} */
    this.conv = null;
    // Whether the agent sends its raw messages beside its updates (Claude's adapter, asked when the session opened): a
    // reply that continues this turn draws its calls as the first one did (HarnessV3-ACP AC1-1).
    this.rawMessages = false;
    /**
     * The agent process the turn runs on, from the moment it chose the process (before its handshake and its session
     * open) to its end.
     * @type {any}
     */
    this.proc = null;
    /** @type {ClientAction | null} */
    this.planAction = null;
    /** @type {string | null} */
    this.lastPlanJson = null;
    /** @type {{ call: any, json: string } | null} */
    this.planQueued = null;
    /** Set by the bridge: how to stop the agent's turn. @type {(() => Promise<void> | void) | null} */
    this.cancel = null;
    /** Aborted as the turn ends: a call of Filament's own the agent made in it stops with it (the browser's). */
    this.over = new AbortController();
    this.startedAt = Date.now();
    /** @type {number | null} */
    this.detachedAt = null;
    /** @type {number | null} */
    this.endedAt = null;
    this.handedOut = 0;
    /** How long sibling actions are gathered into one reply (tests shorten it). @type {number | undefined} */
    this.batchMs = undefined;
    /** What the turn actually got, once the bridge knows (see describe()). @type {string | undefined} */
    this.bridgeEffective = undefined;
    this.emit = this.emit.bind(this);
  }
  /**
   * One event to the request reading the turn, or into the buffer while none does. A reader that answers with a promise
   * (the turn's start, which notes where the working tree stood) is waited for by a bridge that awaits the emit.
   * @param {any} ev @returns {Promise<void> | void}
   */
  emit(ev) {
    if (this.sink) return this.#deliver(this.sink, ev);
    // `own: true` — this is Filament's voice, not the agent's. The server counts agent-authored text separately so it
    // can tell "the agent answered" from "Filament wrote something"; a dropped-output notice must not be mistaken for
    // an answer.
    if (this.buffer.length >= 5000)
      this.buffer.splice(0, 1000, {
        type: "text",
        own: true,
        text: "\n_filament: part of the agent's output while the client was busy could not be kept._\n",
      });
    this.buffer.push(ev);
  }
  /** @param {(ev: any) => Promise<void> | void} sink @param {any} ev @returns {Promise<void> | void} */
  #deliver(sink, ev) {
    try {
      const r = sink(ev);
      if (r && typeof r.then === "function") return r.catch((/** @type {any} */ e) => this.log("warn", `[bridge] client sink failed: ${e.message}`));
    } catch (/** @type {any} */ e) {
      this.log("warn", `[bridge] client sink failed: ${e.message}`);
    }
  }
  /**
   * How a question says what came of it (`askPerson`, `judged`): as the turn's own events while it runs; once it ended
   * while the question waited, to the request that read the turn as it was put. The turn's end lets go of that request
   * (`finish`), and the buffer the words would fill instead is the chat's next request's, which took such an end for
   * one of its own (the review of the crashes' fix, 11-15). The request is held only while the question waits.
   * @returns {(ev: any) => Promise<void> | void}
   */
  sayer() {
    const asked = this.sink;
    return (ev) => (this.done && !this.sink && asked ? this.#deliver(asked, ev) : this.emit(ev));
  }
  /** @param {(ev: any) => Promise<void> | void} sink */
  attach(sink) {
    this.sink = sink;
    this.detachedAt = null;
    const b = this.buffer;
    this.buffer = [];
    for (const ev of b) this.emit(ev);
  }
  detach() {
    this.sink = null;
    this.detachedAt = Date.now();
  }
  get waiting() {
    return [...this.actions.values()].filter((a) => !a.settled);
  }
  nextUnhanded() {
    for (const a of this.actions.values()) if (!a.handedOut && !a.settled) return a;
    return null;
  }
  unhandedAll() {
    return [...this.actions.values()].filter((a) => !a.handedOut && !a.settled);
  }
  /** @param {ClientAction} action */
  request(action) {
    this.actions.set(action.id, action);
    this.knownActionIds.add(action.id);
    this.wake();
    return action.promise;
  }
  // A plan as the client's task list; one at a time, never the same plan twice in a row.
  /** @param {{ name: string, input: any }} call @param {string} json */
  sendPlan(call, json) {
    /** @type {ClientAction} */
    const action = /** @type {any} */ ({
      id: newActionId(),
      kind: "plan",
      name: call.name,
      input: call.input,
      parse: null,
      createdAt: Date.now(),
      settled: false,
      handedOut: false,
    });
    action.promise = new Promise((res, rej) => {
      action.resolve = res;
      action.reject = rej;
    });
    action.promise.catch(() => {});
    action.promise
      .finally(() => {
        if (this.planQueued && this.planQueued.json !== this.lastPlanJson) {
          const q = this.planQueued;
          this.planQueued = null;
          this.sendPlan(q.call, q.json);
        } else this.planQueued = null;
      })
      .catch(() => {});
    this.planAction = action;
    this.lastPlanJson = json;
    this.request(action);
    return action;
  }
  // Plan entries from the agent -> the client's task list when it has one (returns true), else nothing.
  /** @param {any[]} entries @returns {boolean} */
  bridgePlan(entries) {
    if (this.bridge === "off" || !entries.length) return false;
    const call = this.clientTools.buildTodo(entries);
    if (!call) return false;
    const json = JSON.stringify(call.input);
    const pa = this.planAction;
    if (json === this.lastPlanJson && !(pa && !pa.handedOut && !pa.settled)) {
      /* same plan again: nothing new for the client */
    } else if (pa && !pa.handedOut && !pa.settled) {
      pa.input = call.input;
      this.lastPlanJson = json;
    } else if (pa && pa.handedOut && !pa.settled) this.planQueued = { call, json };
    else this.sendPlan(call, json);
    return true;
  }
  wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const r of w) r();
  }
  /** @param {string} id @param {any} value */
  settle(id, value) {
    const a = this.actions.get(id);
    if (!a || a.settled) return false;
    a.settled = true;
    this.actions.delete(id);
    a.resolve(value);
    return true;
  }
  /** @param {string} id @param {any} err */
  fail(id, err) {
    const a = this.actions.get(id);
    if (!a || a.settled) return false;
    a.settled = true;
    this.actions.delete(id);
    a.reject(err);
    return true;
  }
  /** @param {string} reason */
  abandon(reason, code = "CLIENT_ABANDONED") {
    let n = 0;
    for (const a of this.waiting) {
      this.fail(a.id, Object.assign(new Error(reason), { code }));
      n++;
    }
    return n;
  }
  // The turn is over. Actions the agent was waiting on are moot; a pending plan (fire-and-forget) still goes to the client.
  /** @param {any} out @param {any} err */
  finish(out, err) {
    this.done = true;
    // An ended turn stays its session's for its undelivered output (`takeSession`), and what it held of the request
    // that ran it — its bridge's stop, the page's asker, the switch's judge, the request's sink, each with all the turn
    // was sent, its chat whole — stayed alive with it (the crashes of 11-14). None of them has work left: nothing is left
    // to stop (its bridge let go of the request's abort before this; a hang-up or an interrupt asks for it only with
    // `?.`), nobody is asked and nothing judged on an ended turn (`askPerson`, `judged`'s callers), and what it says
    // after this waits in its buffer for the chat's next request, as a detached turn's does.
    this.cancel = null;
    this.asker = null;
    this.permits = null;
    this.sink = null;
    // What its chat's calls between turns read of it stays (the chat, the sub-agent, the folders: acp/bridge.js
    // `#mcpAt`); which call of its own a call came in is asked of a running turn alone (http/mcp.js).
    if (this.toolsAt) {
      const { callOf, callIsOwn, ...kept } = this.toolsAt;
      this.toolsAt = kept;
    }
    // An error holds the functions on the stack it was made on until its stack is read, and the turn keeps both: its
    // signal's reason, made here under the request's own functions, and its failure. Read now, each is words alone.
    const ended = new Error("the agent's turn ended");
    void ended.stack;
    for (let e = err, n = 0; e instanceof Error && n < 8; e = e.cause, n++) void e.stack;
    this.over.abort(ended);
    this.out = out;
    this.error = err || null;
    this.endedAt = Date.now();
    for (const a of this.waiting)
      if (a.kind !== "plan" || a.handedOut)
        this.fail(a.id, Object.assign(new Error("the agent's turn ended"), { code: "CLIENT_ABANDONED" }));
    this.wake();
  }
  // `bridge` is what was configured; `bridgeEffective` is what the turn actually got (set by the bridge once it knows
  // whether the agent can switch its built-in tools off and whether the client declared any). Null until then.
  describe() {
    return {
      id: this.id,
      sessionId: this.sessionId,
      upstreamId: this.upstreamId,
      bridge: this.bridge,
      bridgeEffective: this.bridgeEffective ?? null,
      clientTools: this.clientTools.summary(),
      waiting: this.waiting.map((a) => ({
        id: a.id,
        kind: a.kind,
        tool: a.name,
        handedOut: a.handedOut,
        ageMs: Date.now() - a.createdAt,
      })),
      buffered: this.buffer.length,
      attached: !!this.sink,
      done: this.done,
      startedAt: this.startedAt,
      detachedAt: this.detachedAt,
    };
  }
}

// Permission policy -> pick an option from the agent's request_permission offer, by its kind (ACP's allow_once,
// allow_always, reject_once, reject_always): an option's name is the agent's words for it, and says nothing Filament
// goes by ("Don't allow" is no yes).
/** @param {string} policy @param {any} params */
export function choosePermission(policy, params) {
  /** @type {any[]} */
  const opts = params?.options || [];
  /** @param {string} k */
  const byKind = (k) => opts.find((o) => String(o?.kind || "").toLowerCase() === k);
  // The agent's allow-once wherever it offers one: an "always" stays in the agent, so its later calls of the kind never
  // reach Filament, and a policy changed since (ask, read-only) goes unheard for them. Allow-all alone takes the
  // "always", where it is the one yes the agent offers.
  const once = byKind("allow_once");
  const allow = once || byKind("allow_always");
  const reject = byKind("reject_once") || byKind("reject_always");
  const kind = (params?.toolCall?.kind || "").toLowerCase();
  const isRead = ["read", "search", "fetch", "think"].includes(kind);
  // Fail closed: when the option the policy wants is not offered, cancel rather than pick the opposite; a word that is
  // none of the policies refuses, as `reject` does.
  let pick = null;
  if (policy === "allow-all") pick = allow;
  else if (policy === "read-only") pick = isRead ? once : reject;
  else if (policy === "allow-once") pick = once;
  else pick = reject; // reject, and a word that is no policy
  return pick
    ? { outcome: { outcome: "selected", optionId: pick.optionId } }
    : { outcome: { outcome: "cancelled" } };
}

/** The longest title `describeToolCall` keeps, in characters. */
const TITLE_KEPT = 200;

/**
 * What an agent asks to do, as the loop's calls the session's switch judges (HarnessV3-ACP AC3-2): a command is `bash`
 * (Claude's PowerShell `powershell`); a change — an edit, a deletion, a move — is `edit` of each file it names
 * (Claude's Write `write`), with what the request shows of it (ACP's `diff`: a text written whole where it replaces
 * nothing, else each text it replaces and its replacement; a deletion as one), for the card to show it as a diff
 * (HarnessV3-ACP, AC3's drive D5); a fetch is `web_fetch` (the host Claude's sandbox asks to reach among them, as
 * Codex's), a web search `web_search`; a read is `read`, a search `grep` (Claude's Glob `glob`), with the folder it
 * searches where it names one, as the loop's own hands take it; Claude's sub-agent is
 * `agent` and its other inner steps `plan` — entering its plan mode among them, which only narrows what it does. A
 * call to an MCP server's tool, however the agent says it (`mcpCallOf`), is judged by its name as Claude says one,
 * with its arguments, and as reading where its kind says it reads (`reads`); anything else as an MCP call is, by its
 * tool's own name — an agent's own tool as one of the agent's server's (`mcp__claude-code__Skill`), never reading. Not
 * calls: `plan`, a plan the agent proposes (`switch_mode`), which
 * waits for the person whatever the switch says; `hand`, Filament's own hand (a tool its own MCP server listed at the
 * session's address), judged where it acts. Its server's name is no proof: the agent's own config, a repository's,
 * may name a server "filament" too, so a tool of that name the session's own address never listed is judged as any
 * server's is.
 * @param {any} tc  an ACP tool call: its kind, title, rawInput and locations, and its tool's own name where the agent
 *   says it
 * @param {string} agent  the agent's upstream id, its own tools' server
 * @param {string} [platform]  where the agent runs its commands: this machine's
 * @param {{ has: (tool: string) => boolean } | null} [own]  the tools Filament's own server listed at the session's
 *   address (acp/bridge.js `ownListed`); none where it listed nothing
 * @returns {LoopCall[] | "plan" | "hand"}
 */
export function loopCalls(tc, agent, platform = process.platform, own = null) {
  const kind = String(tc?.kind || "").toLowerCase();
  const raw = tc?.rawInput && typeof tc.rawInput === "object" ? tc.rawInput : {};
  const tool = String([tc?.name, tc?._meta?.claudeCode?.toolName, tc?._meta?.qoder?.toolName, raw._toolName].find((n) => typeof n === "string" && n) || "");
  const title = String(tc?.title || "").trim();
  if (kind === "switch_mode") return "plan";
  const mcp = mcpCallOf(tc, tool);
  if (mcp?.server === "filament" && own?.has(mcp.tool)) return "hand";
  if (mcp) return [{ name: `mcp__${mcp.server}__${mcp.tool}`, input: mcp.input && typeof mcp.input === "object" ? mcp.input : {}, ...(kind === "read" ? { reads: true } : {}) }];
  if (tool === "SandboxNetworkAccess") return [{ name: "web_fetch", input: { url: `https://${String(raw.host ?? title)}` } }];
  if (tool === "PowerShell") return [{ name: "powershell", input: { command: String(raw.command ?? "") } }];
  // Antigravity's run_command (read in 1.4.5): its command line and the folder it runs in, run by Windows PowerShell on
  // Windows, so read by PowerShell's reader there, in that folder (as Codex's are); elsewhere by bash's, in that folder.
  if (kind === "execute" && typeof raw.CommandLine === "string")
    return [{ name: platform === "win32" ? "powershell" : "bash", input: { command: raw.CommandLine, ...(typeof raw.Cwd === "string" && raw.Cwd ? { cwd: raw.Cwd } : {}) } }];
  if (kind === "execute" || tool === "Bash")
    return [{ name: "bash", input: { command: typeof raw.command === "string" ? raw.command : title.replace(/^`([\s\S]*)`$/, "$1") } }];
  /** @type {string[]} */
  const paths = [...new Set([...(Array.isArray(tc?.locations) ? tc.locations.map((/** @type {any} */ l) => l?.path) : []), raw.file_path, raw.path, raw.notebook_path].filter((p) => typeof p === "string" && p))];
  /** @param {string} name @param {(path: string) => any} [input] */
  const each = (name, input = (path) => ({ path })) => (paths.length ? paths : [title]).map((path) => ({ name, input: input(path) }));
  /** @type {any[]} */
  const diffs = (Array.isArray(tc?.content) ? tc.content : []).filter((/** @type {any} */ c) => c?.type === "diff" && typeof c.path === "string");
  const slashed = (/** @type {string} */ p) => p.replace(/\\/g, "/");
  /** What the request shows of its change to one file. @param {string} path */
  const changeOf = (path) => {
    if (kind === "delete") return { path, deleted: true };
    const own = diffs.filter((d) => d.path === path || slashed(d.path) === slashed(path));
    if (!own.length) return { path };
    if (own.length === 1 && (own[0].oldText == null || own[0].oldText === "")) return { path, content: String(own[0].newText ?? "") };
    const every = raw.replace_all === true;
    return { path, edits: own.filter((d) => typeof d.oldText === "string" && d.oldText).map((d) => ({ oldText: d.oldText, newText: String(d.newText ?? ""), replaceAll: every })) };
  };
  if (kind === "edit" || kind === "delete" || kind === "move") return each(tool === "Write" ? "write" : "edit", changeOf);
  if (kind === "fetch")
    return typeof raw.query === "string" && typeof raw.url !== "string" ? [{ name: "web_search", input: { query: raw.query } }] : [{ name: "web_fetch", input: { url: String(raw.url ?? title) } }];
  if (kind === "read") return each("read");
  if (kind === "search") return [{ name: tool === "Glob" ? "glob" : "grep", input: { pattern: String(raw.pattern ?? raw.query ?? title), ...(typeof raw.path === "string" && raw.path ? { path: raw.path } : {}) } }];
  if (kind === "think" || tool === "EnterPlanMode") return [{ name: tool === "Agent" || tool === "Task" ? "agent" : "plan", input: {} }];
  return [{ name: `mcp__${agent}__${tool || kind || "tool"}`, input: raw }];
}

/**
 * The agent's own choice for the switch's verdict (AC3-2): its allow-once for a run — never its "always", which would
 * keep the grant in the agent instead of Filament — and its reject-once for a refusal. Null when it offers none.
 * @param {any[]} options  the request's options @param {boolean} allow
 */
export function optionFor(options, allow) {
  const by = (/** @type {string} */ k) => (options || []).find((o) => String(o?.kind || "").toLowerCase() === k);
  return (allow ? by("allow_once") : by("reject_once") || by("reject_always")) || null;
}

/**
 * The agent's "always" allow, which Filament takes only where it offers no allow-once: on the person's yes to a card
 * that says it is an always, or for Filament's own hand, which judges each call where it acts. Null when it offers none.
 * @param {any[]} options  the request's options
 */
export const alwaysOf = (options) => (options || []).find((o) => String(o?.kind || "").toLowerCase() === "allow_always") || null;

// Plain words for a permission prompt: what the agent wants to do.
/** @param {{ title?: string, kind?: string } | null | undefined} tc */
export function describeToolCall(tc) {
  const title = String(tc?.title || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TITLE_KEPT);
  const kind = String(tc?.kind || "").toLowerCase();
  if (
    /^(write|edit|read|run|delete|create|move|rename|fetch|search|grep|glob|list|open|update|remove|execute|bash|shell)\b/i.test(
      title,
    ) &&
    kind !== "execute"
  )
    return title.charAt(0).toLowerCase() + title.slice(1);
  if (kind === "execute") return `run ${/^`.*`$/.test(title) ? title : "`" + title.replace(/`/g, "'") + "`"}`;
  if (kind === "edit") return `edit ${title || "a file"}`;
  if (kind === "delete") return `delete ${title || "a file"}`;
  if (kind === "move") return `move ${title || "a file"}`;
  if (kind === "fetch") return `fetch ${title || "a URL"}`;
  if (kind === "read" || kind === "search") return `${kind} ${title || "files"}`;
  return title || "use a tool";
}

/** What Filament's own tools answer while the agent writes Filament's summary, which reads only (HarnessV3-ACP AC5-4). */
export const WRITING_REFUSAL = "Error: Filament runs no tool while the summary is written: write it from the conversation as it stands.";

/**
 * The note a question nobody could be asked leaves on its turn (HarnessV3-ACP AC2-4): what the agent asked, why nobody
 * could answer it, and what the agent heard instead.
 * @param {LiveTurn} turn @param {string} asked @param {string} why @param {string} heard
 */
function noteUnasked(turn, asked, why, heard) {
  /** @type {import("../../core/notes.js").Note} */
  const n = { kind: "question-unasked", asked: asked.replace(/\s+/g, " ").trim().slice(0, 160), why, heard };
  turn.emit({ type: "note", text: renderRecord(n), note: n });
}

/**
 * The note an "ask" policy leaves on its turn when nobody could be asked: what was asked for was allowed once — the
 * agent's own request, or what Filament does for it. @param {LiveTurn} turn
 */
export function noteUnanswerable(turn) {
  /** @type {import("../../core/notes.js").Note} */
  const n = { kind: "permissions-unanswerable" };
  turn.emit({ type: "note", text: renderRecord(n), note: n });
}

// Common base for bridges: turns, client-tool actions, local hands, the permission policy of the moment.
export class TurnBridge {
  /** @param {{ log?: Log }} [o] */
  constructor({ log = () => {} } = {}) {
    this.log = log;
    /** Agent session id -> its turn (running, or ended with output the client has not seen). @type {Map<string, LiveTurn>} */
    this.turns = new Map();
    /** The turns running now, from their start — before their agent session is known — to their end. @type {Set<LiveTurn>} */
    this.live = new Set();
    /**
     * Filament's own work on an agent's process outside a turn (`working`): the summary the agent writes for Filament,
     * the compaction Filament asks of it. @type {Set<{ proc: any, upstreamId: string }>}
     */
    this.work = new Set();
    /**
     * Conversation key -> its work, one piece at a time: its turns, the agent's own, a summary, a compaction.
     * @type {Map<string, Promise<any>>}
     */
    this.turnQueues = new Map();
    /**
     * Agent session id -> its lock, a chain of the work on it: two chats can share one session (each resumed it), and
     * they take turns on it (`lockSession`). @type {Map<string, Promise<any>>}
     */
    this.sessionLocks = new Map();
    /** Upstream id -> its newest agent settings (the permission policy is read live). @type {Map<string, any>} */
    this.latestAcp = new Map();
    this.hands = new LocalHands({ log });
    /**
     * What an agent says of its account and its plan, for the server's store (HarnessV3-ACP AC3-6; the server's hook).
     * @type {((upstreamId: string, report: import("../../core/agent-limits.js").AccountReport) => void) | null}
     */
    this.onAccount = null;
    /**
     * What a session an agent opened or refused outside a turn — the one its models are read from — shows of its
     * sign-in, for the app's logins (the server's hook; app/agent-logins.js `turnSaid`): opened, or refused asking for
     * a sign-in, in the refusal's words.
     * @type {((upstreamId: string, signedIn: boolean, said?: string) => void) | null}
     */
    this.onSignIn = null;
    /**
     * Filament's own tools for the agent's sessions (HarnessV3-ACP AC4-2, AC4-5; the server's hook): memory's, and the
     * task graph's. Without it a session has none of them.
     * @type {import("../../core/ports.js").AgentTools | null}
     */
    this.agentTools = null;
    /** The upstreams and words a warning said were no policy (`policyOf`), each said once. @type {Set<string>} */
    this.policyTold = new Set();
  }
  /**
   * An upstream's permission policy (`acp.permissions`), allow-all where it names none. A word that is none of the
   * policies is kept as it is, never read as allow-all: it asks first where someone can be asked and is refused where
   * nobody can (`askingPolicy`), and the log says so once for each upstream and word. A save refuses such a word
   * (validateConfig), so it comes from a config.json edited by hand ("readonly").
   * @param {any} acp  the upstream's agent settings @param {string} upstreamId
   */
  policyOf(acp, upstreamId) {
    const word = String(acp?.permissions || "allow-all");
    if (isPolicy(word)) return word;
    const told = `${upstreamId}\n${word}`;
    if (!this.policyTold.has(told)) {
      this.policyTold.add(told);
      this.log("warn", `[bridge] ${upstreamId}: acp.permissions "${word}" is none of the permission policies (${POLICIES.join(", ")}), so each request asks where someone can be asked and is refused where nobody can, until it is corrected`);
    }
    return word;
  }
  /**
   * Whether a chat has work queued or running (`turnQueues`): it is in use, and no sweep takes it or its agent, however
   * long that work runs (the bug report's H8: a turn longer than the idle limits lost its session and its agent).
   * @param {string} convKey
   */
  inUse(convKey) {
    return this.turnQueues.has(convKey);
  }
  /**
   * The session's lock, once the work holding it has ended: never two turns on one session at once (the bug report's
   * H9 and X5). A stop while it waits (`signal`) ends the wait; the release then gives its place up, and the lock stays
   * with the work that holds it: the entry goes only once the work before it has ended too.
   * @param {string} id @param {AbortSignal | null} [signal]
   * @returns {Promise<() => void>}  the release
   */
  async lockSession(id, signal = null) {
    const prev = this.sessionLocks.get(id) || Promise.resolve();
    /** @type {(v?: any) => void} */
    let release = () => {};
    const mine = new Promise((r) => (release = r));
    const chain = prev.then(() => mine);
    this.sessionLocks.set(id, chain);
    if (!signal) await prev;
    else if (!signal.aborted) {
      /** @type {() => void} */
      let stopped = () => {};
      const stop = new Promise((r) => (stopped = () => r(undefined)));
      signal.addEventListener("abort", stopped, { once: true });
      await Promise.race([prev, stop]);
      signal.removeEventListener("abort", stopped);
    }
    return () => {
      release();
      chain.then(() => {
        if (this.sessionLocks.get(id) === chain) this.sessionLocks.delete(id);
      });
    };
  }
  /**
   * At shutdown, a chat with work running or queued was used until now: its work ends here, and the next start reads
   * it idle from then (the bug report's H8 and H10).
   * @param {Map<string, { lastUsed: number }>} convs
   */
  usedUntilNow(convs) {
    for (const [k, c] of convs) if (this.inUse(k)) c.lastUsed = Date.now();
  }
  /**
   * Hand what the agent said of its account to the server's store: a failure there never reaches a turn.
   * @param {string} upstreamId @param {import("../../core/agent-limits.js").AccountReport} report
   */
  heardAccount(upstreamId, report) {
    try {
      this.onAccount?.(upstreamId, report);
    } catch (/** @type {any} */ e) {
      this.log("debug", `[accounts] ${upstreamId}: ${e.message}`);
    }
  }
  /**
   * Hand what a session opened or refused outside a turn shows of the agent's sign-in to the app's logins: a failure
   * there never reaches whoever opened it.
   * @param {string} upstreamId @param {boolean} signedIn @param {string} [said]  the refusal's words
   */
  heardSignIn(upstreamId, signedIn, said = "") {
    try {
      this.onSignIn?.(upstreamId, signedIn, said);
    } catch (/** @type {any} */ e) {
      this.log("debug", `[accounts] ${upstreamId}: ${e.message}`);
    }
  }
  /**
   * The refused seed (HarnessV3-ACP AC4-4, P9.3; HarnessV3-FailurePoints D9): a new session's first prompt carried the
   * earlier conversation, and the agent refused it for its size before any answer (the bridge marks that failure
   * `seededUnanswered`). The refused session goes: the refused prompt stays in its own history, where every later
   * prompt would be refused too. Where the turn can make its seed fit (`opts.reseed`, a harness chat's), Filament
   * compacts its copy of the chat, and a new session starts from that. Where it can't, made no room, or the agent
   * refuses that too, the prompt goes once more without the earlier conversation, in a new session that stays
   * unseeded. The turn says which. Where the chat asks before it makes room (`opts.reseed` is `"ask"`), nothing is
   * compacted and nothing goes on without the conversation: the refusal is the turn's. Any other failure, or one
   * after a stop, is the turn's.
   * @param {any} e @param {any} opts  the turn's @param {LiveTurn} turn
   * @param {{ drop: () => void, again: (o: { bare: true } | { body: any, headers: Record<string, string> }) => Promise<any>, session: string }} o
   *   `drop` lets the refused session go, `again` runs the turn once more — bare, or as the request `reseed` made;
   *   `session` is what the agent's session is called
   */
  async retrySeed(e, opts, turn, { drop, again, session }) {
    /** Whether a failure is the seed refused for its size, the turn not stopped. @param {any} x */
    const refused = (x) => !!x?.seededUnanswered && classifyFailure(x).kind === "overflow" && !opts.signal?.aborted;
    if (!refused(e)) throw e;
    drop();
    // The most its context takes, where its refusal names it: the window it works in, said by the agent itself.
    const told = overflowSaid(e);
    if (told.max) opts.windowSaid?.(told.max);
    const who = agentTitle(opts.upstream);
    /** @param {string} words */
    const say = (words) => turn.emit({ type: "text", own: true, text: `_filament: ${words}._\n\n` });
    /** @type {Reseed | "ask" | null} */
    const reseed = opts.reseed || null;
    if (reseed === "ask") {
      say(`the earlier conversation was too long for ${who} to take in. Nothing was compacted, and nothing was sent without it: this session asks before it makes room (context.compaction.mode)`);
      throw e;
    }
    if (!reseed) {
      say(`the earlier conversation was too long for ${who} to take in, so it goes on without it, in a new ${session}`);
      return again({ bare: true });
    }
    say(`the earlier conversation was too long for ${who} to take in, so Filament compacts its copy of it, and a new ${session} starts from that`);
    const made = await reseed(told).catch((/** @type {any} */ x) => ({ error: String(x?.message || x) }));
    if (opts.signal?.aborted) throw e;
    if ("error" in made) {
      say(`the compaction made no room (${made.error}), so it goes on without the earlier conversation, in a new ${session}`);
      return again({ bare: true });
    }
    try {
      return await again({ body: made.body, headers: made.headers });
    } catch (/** @type {any} */ e2) {
      if (!refused(e2)) throw e2;
      drop();
      say(`compacted, the earlier conversation was still too long for ${who} to take in, so it goes on without it, in a new ${session}`);
      return again({ bare: true });
    }
  }
  // Resolves with the finished turn, or with { clientAction, turn } when the agent needs the client's hands first.
  /** @param {LiveTurn} turn @returns {Promise<any>} */
  async waitTurn(turn) {
    for (;;) {
      // Agents call tools in parallel (Cursor reads several files at once): every action pending right now goes out
      // in the same reply, so the client runs them together and answers them in one request. A plan that is still
      // pending when the turn ends goes out too, so the client's task list shows the final state.
      if (turn.unhandedAll().length) {
        if (!turn.done) await new Promise((r) => setTimeout(r, turn.batchMs ?? 120)); // siblings arrive a few ms to ~200 ms apart
        const all = turn.unhandedAll();
        if (!all.length) continue; // settled meanwhile: re-evaluate
        for (const a of all) {
          a.handedOut = true;
          a.handedAt = Date.now();
          turn.handedOut++;
        }
        return { clientAction: all[0], clientActions: all, turn };
      }
      if (turn.done) {
        if (turn.error) throw turn.error;
        return turn.out;
      }
      await new Promise((r) => turn.waiters.push(r));
    }
  }
  // Run `body(turn)` as the turn's work: settle the turn when it ends, hand back the first result the client needs.
  /** @param {LiveTurn} turn @param {Promise<any>} promise @param {(() => void) | null} [onEnd] */
  trackTurn(turn, promise, onEnd = null) {
    this.live.add(turn);
    turn.promise = promise.then(
      (out) => {
        turn.finish(out, null);
        return out;
      },
      (err) => {
        turn.finish(null, err);
        throw err;
      },
    );
    turn.promise.catch(() => {}); // surfaced through waitTurn, never as an unhandled rejection
    turn.promise
      .finally(() => {
        this.live.delete(turn);
        onEnd?.();
        this.turnEnded(turn);
      })
      .catch(() => {});
    return this.waitTurn(turn);
  }
  // The reply that carried a tool call has ended; keep the turn alive for the client's next request.
  /** @param {LiveTurn} turn */
  detach(turn) {
    turn.detach();
  }
  // The client came back with tool results (and possibly a fresh sink): settle what it answered, continue the turn. A
  // hang-up of the request that brought them (`signal`) cancels the turn, as it does a turn a request began (the bug
  // report's P10).
  /**
   * @param {{ turn: LiveTurn, results?: { id: string, text?: string, isError?: boolean }[], onEvent: (ev: any) => void,
   *   signal?: AbortSignal | null }} args
   */
  async resume({ turn, results = [], onEvent, signal = null }) {
    /** @type {ClientAction[]} */
    const settled = [];
    for (const r of results) {
      const a = turn.actions.get(r.id);
      if (!a) continue;
      try {
        const v = a.parse ? a.parse(String(r.text ?? ""), !!r.isError) : String(r.text ?? "");
        if (turn.settle(r.id, v)) settled.push(a);
      } catch (e) {
        turn.fail(r.id, e);
        settled.push(a);
      }
    }
    turn.attach(onEvent);
    const hangUp = () => void turn.cancel?.();
    if (signal?.aborted) hangUp();
    else signal?.addEventListener("abort", hangUp, { once: true });
    try {
      const res = await this.waitTurn(turn);
      return { res, settled };
    } finally {
      signal?.removeEventListener("abort", hangUp);
    }
  }
  // Output the agent produced while no reply was attached; delivered at the start of the client's next request.
  /** @param {LiveTurn} turn @param {(ev: any) => void} onEvent */
  drain(turn, onEvent) {
    const n = turn.buffer.length;
    if (n) turn.attach(onEvent);
    turn.detach();
    if (turn.done && turn.sessionId) this.turns.delete(turn.sessionId);
    return n;
  }
  /**
   * A turn takes its session: the agent's requests on it are the turn's from now. What the chat's turn before it left
   * undelivered comes first; another chat's, on a session two chats share, is never this one's (the bug report's H9).
   * @param {string} sessionId @param {LiveTurn} turn @param {(ev: any) => void} onEvent
   */
  takeSession(sessionId, turn, onEvent) {
    const old = this.turns.get(sessionId);
    if (old && old !== turn && old.conv === turn.conv && old.done && old.buffer.length) {
      for (const ev of old.buffer) onEvent(ev);
      old.buffer = [];
    }
    this.turns.set(sessionId, turn);
  }
  // The live or leftover turn a request belongs to: by the ids of the tool calls it answers, else by its conversation.
  /** @param {{ upstream: any, format: string, body: any, cwdHint?: string, conversationId?: string | null, actionIds?: string[] }} args */
  turnForRequest({ upstream, format, body, cwdHint, conversationId, actionIds = [] }) {
    if (actionIds.length)
      for (const t of this.turns.values()) if (actionIds.some((id) => t.knownActionIds.has(id))) return t;
    const conv = /** @type {any} */ (this).peekByRequest({ upstream, format, body, cwdHint, conversationId });
    const t = conv ? this.turns.get(conv.sessionId || conv.agentId) : null; // ACP sessions vs SDK agents
    // The chat's own: two chats can share one session (each resumed it), and neither's message stops or takes the
    // other's turn (the bug report's H9).
    return t && t.conv === conv && (!t.done || t.buffer.length) ? t : null;
  }
  // The user moved on while the agent waited for the client: cancel the outstanding actions and the agent's turn.
  /** @param {LiveTurn} turn */
  async interrupt(turn, reason = "the user sent a new message") {
    const n = turn.abandon(reason);
    if (!turn.done) {
      try {
        await turn.cancel?.();
      } catch {}
    }
    await Promise.race([turn.promise?.catch(() => {}), new Promise((r) => setTimeout(r, 15000))]);
    return { cancelledActions: n, ended: turn.done };
  }
  /**
   * Whether a turn runs on an upstream now, counted from its start, or Filament's own work does (`working`)
   * (HarnessV3-ACP AC3-7: an account is neither removed nor signed out under a running turn).
   * @param {string} upstreamId
   */
  running(upstreamId) {
    return [...this.live, ...this.work].some((t) => t.upstreamId === upstreamId);
  }
  /**
   * Whether a turn runs on this agent process (its `proc`): from the moment the turn chose it, before the handshake and
   * the session open (the bug report's H11: Connect stopped a process under a turn still opening its session). Or
   * Filament's own work does (`working`).
   * @param {any} p
   */
  runsOn(p) {
    return [...this.live, ...this.work].some((t) => t.proc === p);
  }
  /**
   * Filament's own work on an agent's process outside a turn — the summary the agent writes for Filament, the compaction
   * Filament asks of it — counted as a turn is (the bug report's P3): neither the process nor the account it runs as is
   * let go of under it. Returns its end, which stops a process let go of meanwhile once nothing runs on it.
   * @param {any} proc @param {string} upstreamId
   * @returns {() => void}
   */
  working(proc, upstreamId) {
    const work = { proc, upstreamId };
    this.work.add(work);
    return () => {
      this.work.delete(work);
      if (proc.retire && !proc.exited && !this.runsOn(proc)) proc.kill();
    };
  }
  /** A turn ended: a process let go of while it ran (`retire`) stops once no turn runs on it. @param {LiveTurn} turn */
  turnEnded(turn) {
    this.log(
      "debug",
      `[bridge] turn ${turn.id} ended${turn.buffer.length ? ` with ${turn.buffer.length} buffered event(s) for the client's next request` : ""}`,
    );
    const p = turn.proc;
    if (p?.retire && !p.exited && !this.runsOn(p)) p.kill();
  }
  /**
   * At shutdown, the processes let go of whose turns, or Filament's own work on them, still run stop with the rest: no
   * longer the bridge's, they would outlive Filament and go on working with nobody to hear them.
   */
  stopLetGo() {
    for (const t of [...this.live, ...this.work]) if (t.proc?.retire && !t.proc.exited) t.proc.kill();
  }
  /**
   * An agent's question put to the person (HarnessV3-ACP AC2-4), on its turn's run as an `ask` and its `ask-end`:
   * through the page, in a harness turn; else through the outside client's question tool, where the questions fit it;
   * else to nobody, and the agent hears at once what `nobodyAnswer` says (a permission: cancelled), which the turn's
   * note explains. The bridges put a permission here only where the page answers it: without the page they put it to
   * the client themselves, or leave it to their policy. The signal ends the wait — the agent withdrew its question, or
   * saw a link completed — as `endedBy` reads it. `again`: a permission the session's switch asks about is judged
   * again when the switch moves while it waits (the page's `switched`, HarnessV3-AtHome AH-F1): the answer that settles
   * it, or null when it still asks and waits on under the same id (HarnessV3-ACP AC3-2).
   * @param {LiveTurn | null | undefined} turn @param {AskForm} form
   * @param {{ signal?: AbortSignal | null, again?: (() => AskAnswer | null) | null }} [o]
   * @returns {Promise<AskAnswer>}
   */
  async askPerson(turn, form, { signal = null, again = null } = {}) {
    const live = turn && !turn.done ? turn : null;
    /** @type {AskAnswer} */
    const unanswered = nobodyAnswer(form) ?? { outcome: "cancelled" };
    if (!live) {
      this.log("info", `[bridge] an agent asked “${askedOf(form).slice(0, 80)}” with no turn running; nobody could be asked`);
      return unanswered;
    }
    const id = `q${++live.asks.n}`;
    // Read once, as the request it says its end to (`sayer`): the turn's end lets go of both (`finish`) while this
    // question may still wait.
    const asker = live.asker;
    const say = live.sayer();
    const call = asker || live.bridge === "off" ? null : live.clientTools.buildQuestions(form);
    say({ type: "ask", id, form, waits: !!asker });
    /** @type {AskAnswer} */
    let answer;
    let nobody = false;
    if (asker) {
      for (;;) {
        answer = (await asker(form, id, signal)) || endedBy(signal);
        if (answer.outcome !== "switched" || !again) break;
        const settled = again();
        if (settled) {
          answer = settled;
          break;
        }
      }
    } else if (call) {
      try {
        answer = await this.askClient(live, { kind: "question", call, parse: (t, isError) => answerFromText(form, t, isError), signal });
      } catch {
        answer = endedBy(signal);
      }
    } else {
      nobody = true;
      answer = unanswered;
      const why = live.bridge === "off"
        ? "this agent's client bridge is off"
        : live.clientTools.has("ask") ? "its questions don't fit this chat tool's question tool" : "this chat tool declares no question tool";
      noteUnasked(live, askedOf(form), why, answerWords(form, answer).join("; "));
    }
    say({ type: "ask-end", id, outcome: answer.outcome, words: answerWords(form, answer), ...(nobody ? { nobody: true } : {}) });
    return answer;
  }
  /**
   * What the agent asks to do, answered by the session's switch (HarnessV3-ACP AC3-2): its calls judged as the loop
   * judges its own (`turn.permits`), each verdict on the turn's record. One that asks puts the loop's permission card
   * to the person — judged again if the switch moves while it waits (HarnessV3-AtHome AH-F1). A yes is judged again
   * too: a deny rule, or read-only, come since overrules it; one that stands counts towards the project's always-allow,
   * and an always-allow it brings to its threshold is offered. `refused`: the switch or a rule refused it, `why` saying
   * which — the mode itself where it asks and the turn has nobody to ask (a sub-agent's: the answer names its
   * `reason`); `declined`: the person said no; `cancelled`: nobody answered (a stop, a hang-up, the run's end). An agent
   * that offers only to always allow it (`always`) is asked about it whatever the mode, its card saying so: the
   * switch's run alone grants no always.
   * @param {LiveTurn} turn @param {LoopCall[]} calls
   * @param {{ agent: string, what: string, call: string | null, signal?: AbortSignal | null, always?: boolean }} o
   *   `what`: the request in a few words, for the record; `call`: the agent's tool call it is for, where it names one
   * @returns {Promise<{ outcome: "run" | "refused" | "declined" | "cancelled", mode: string, why?: string, asked?: boolean, by?: "lead" }>}
   *   `asked`: it ran on the person's yes — or, `by: "lead"`, on a worker's lead's
   */
  async judged(turn, calls, { agent, what, call, signal = null, always = false }) {
    const permits = /** @type {Permits} */ (turn.permits);
    const root = String(turn.conv?.cwd || "");
    // Its verdicts go to the request that read the turn as it was asked, should the turn end while its card waits (`sayer`).
    const say = turn.sayer();
    /** @param {Judgement} j @param {string} [lead] */
    const record = (j, lead = `${agent} asked to ${what}`) => {
      for (const n of j.notes) say({ type: "note", text: `permission: ${n}` });
      say({ type: "note", text: `permission: ${lead} — ${j.how}` });
    };
    const judge = () => permits.judge(calls, root, always ? { always } : undefined);
    const first = judge();
    record(first);
    if (first.verdict === "run") return { outcome: "run", mode: first.mode };
    if (first.verdict === "refuse") return { outcome: "refused", mode: first.mode, why: first.why };
    /** The verdict a switch brought while the card waited, when it settled it. @type {Judgement | null} */
    let switched = null;
    // A review rule asks with a second look first (HarnessV4_Space_Plan SG-D13): the Reviewer reads the request while
    // the card waits, and is stopped once it is answered.
    const look = first.review ? permits.look?.({ command: first.command || what, folder: root, why: `the rule ${first.review} asks for a second look` }) || { error: "this chat runs no agents of Filament's" } : null;
    const form = fromJudged({ agent, call, tool: String(first.tool), words: String(first.question), command: first.command, reason: first.reason, changes: first.changes, changesLeft: first.changesLeft, offer: first.offer, keeps: first.keeps, review: first.review, look, always: !!first.always });
    const answer = await this.askPerson(turn, form, {
      signal,
      again: () => {
        const j = judge();
        record(j, `the switch moved while ${agent}'s request to ${what} waited`);
        if (j.verdict === "ask") return null;
        switched = j;
        return { outcome: "answered", answers: { permission: { chosen: [j.verdict === "run" ? "allow" : "deny"] } }, reason: j.verdict === "run" ? `${j.mode} mode runs it` : `${j.why} refuses it` };
      },
    });
    permits.unlook?.(look);
    const settled = /** @type {Judgement | null} */ (switched);
    if (settled) return settled.verdict === "run" ? { outcome: "run", mode: settled.mode } : { outcome: "refused", mode: settled.mode, why: settled.why };
    const chosen = answer.outcome === "answered" ? answer.answers?.permission?.chosen?.[0] : null;
    if (!chosen) {
      say({ type: "note", text: `permission: ${agent}'s request to ${what} — not answered` });
      return { outcome: "cancelled", mode: first.mode };
    }
    // A worker's lead answers as the person does, in its own name (HarnessV3-TaskGraph-v2 TG2-D41).
    const byLead = /** @type {any} */ (answer).by === "lead";
    if (chosen !== "allow") {
      // A no that names its reason is nobody's: the mode asks, and the turn has no one to ask (a sub-agent's).
      if (answer.reason) {
        say({ type: "note", text: `permission: ${agent}'s request to ${what} — refused: ${answer.reason} (${first.mode} mode)` });
        const why = first.always ? `Filament, as the agent offered only an always-allow and ${answer.reason},` : `${first.mode} mode, where ${answer.reason},`;
        return { outcome: "refused", mode: first.mode, why };
      }
      say({ type: "note", text: `permission: ${agent}'s request to ${what} — ${byLead ? "its lead declined" : "the person declined"}` });
      return { outcome: "declined", mode: first.mode };
    }
    const yes = permits.allowed(calls, root, { ...(byLead ? { by: /** @type {const} */ ("lead") } : {}), ...(first.always ? { always: true } : {}) });
    record(yes, `${agent}'s request to ${what}`);
    for (const o of yes.offers || []) {
      say({ type: "permission-offer", tool: o.tool, shape: o.shape, count: o.count, itemId: o.itemId });
      say({ type: "note", text: `permission: an always-allow for "${o.text}" was offered (memory item ${o.itemId}, inferred)` });
    }
    return yes.verdict === "run" ? { outcome: "run", mode: yes.mode, asked: true, ...(byLead ? { by: /** @type {const} */ ("lead") } : {}) } : { outcome: "refused", mode: yes.mode, why: yes.why };
  }
  /**
   * Permission for one of Filament's own tools that acts for the agent in a harness chat — the browser
   * (HarnessV4_AgentTools_Plan AT-D7): its calls judged by the session's switch as the loop's are (`judged`), the
   * permission card where it asks. With no turn of the chat running nothing stands for the person, and it is refused.
   * `asked`: it runs on the person's yes — `by: "lead"`, on a worker's lead's, which holds for its team alone.
   * @param {LiveTurn | null | undefined} turn @param {any} upstream @param {LoopCall[]} calls @param {string} what
   * @returns {Promise<{ asked: boolean, by?: "lead" }>}
   */
  async permitCalls(turn, upstream, calls, what) {
    if (!turn || turn.done || !turn.permits)
      throw Object.assign(new Error("no turn of the harness chat runs to judge it, so Filament did not run it"), { code: -32000 });
    const agent = String(upstream?.name || upstream?.id || "the agent").replace(" (agent via ACP)", "");
    const j = await this.judged(turn, calls, { agent, what, call: null });
    if (j.outcome === "run") return { asked: j.asked === true, ...(j.by ? { by: j.by } : {}) };
    throw Object.assign(new Error(j.outcome === "refused" ? `${j.why} refused it` : j.outcome === "declined" ? "the person declined it" : "the question was not answered"), { code: -32000 });
  }
  /**
   * What the session's switch would answer a request now, asking nobody and saying nothing — a browser batch's later
   * step, judged as its own call would be (AT-D7). "refuse" where no turn runs to judge it.
   * @param {LiveTurn | null | undefined} turn @param {LoopCall[]} calls @returns {"run" | "ask" | "refuse"}
   */
  judgeNow(turn, calls) {
    if (!turn || turn.done || !turn.permits) return "refuse";
    return /** @type {Permits} */ (turn.permits).judge(calls, String(turn.conv?.cwd || "")).verdict;
  }
  /**
   * The session's permission mode now, as its switch stands — a command on another machine is judged in it there (the
   * owner's of 11-10). Null where no turn runs. @param {LiveTurn | null | undefined} turn @returns {string | null}
   */
  modeNow(turn) {
    if (!turn || turn.done || !turn.permits) return null;
    return /** @type {Permits} */ (turn.permits).mode();
  }
  /**
   * The session's ask or review rule that speaks for a request, whatever its mode, as describeRule says it — a command
   * on another machine asks the person on it first (the remote-agents plan's c-tools). Null where none does, or no turn
   * runs. @param {LiveTurn | null | undefined} turn @param {LoopCall[]} calls @returns {string | null}
   */
  rulesAsk(turn, calls) {
    if (!turn || turn.done || !turn.permits) return null;
    return /** @type {Permits} */ (turn.permits).rulesAsk?.(calls, String(turn.conv?.cwd || "")) ?? null;
  }
  /**
   * An agent's question Filament can't show anyone (it asks in a way the card doesn't draw): the agent hears `heard` at
   * once, and its turn's note says why — the log, with no turn running.
   * @param {LiveTurn | null | undefined} turn @param {string} asked @param {string} why @param {string} heard
   */
  unaskable(turn, asked, why, heard) {
    if (turn && !turn.done) noteUnasked(turn, asked, `Filament can't show it: ${why}`, heard);
    else this.log("info", `[bridge] an agent asked “${asked.slice(0, 80)}”, which Filament can't show (${why}); it heard “${heard}”`);
  }
  // Ask the chat client to run one of its tools; resolves with the parsed result from the client's next request. The
  // signal withdraws it: an action not handed out yet never is, and an answer that comes anyway settles nothing.
  /**
   * @param {LiveTurn} turn
   * @param {{ kind: string, call: { name: string, input: any } | null, parse?: ((text: string, isError: boolean) => any) | null,
   *   fireAndForget?: boolean, signal?: AbortSignal | null }} ask
   * @returns {Promise<any>}
   */
  askClient(turn, { kind, call, parse = null, fireAndForget = false, signal = null }) {
    if (!call)
      return Promise.reject(Object.assign(new Error("the client has no tool for this"), { code: -32000 }));
    /** @type {ClientAction} */
    const action = /** @type {any} */ ({
      id: newActionId(),
      kind,
      name: call.name,
      input: call.input,
      parse,
      createdAt: Date.now(),
      settled: false,
      handedOut: false,
    });
    action.promise = new Promise((res, rej) => {
      action.resolve = res;
      action.reject = rej;
    });
    if (fireAndForget) action.promise.catch(() => {});
    turn.request(action);
    if (signal) {
      const withdraw = () => turn.fail(action.id, Object.assign(new Error("the agent no longer waits for it"), { code: "CLIENT_ABANDONED" }));
      if (signal.aborted) withdraw();
      else {
        signal.addEventListener("abort", withdraw, { once: true });
        // Settled, it lets go: a signal made with AbortSignal.any is kept by Node while a listener waits on it.
        const off = () => signal.removeEventListener("abort", withdraw);
        action.promise.then(off, off);
      }
    }
    return action.promise;
  }
  /**
   * Permission for something Filament is about to do itself on the agent's behalf (a local write or command): in a
   * harness session the switch judges it as the loop's call (HarnessV3-ACP AC3-2); otherwise the upstream's policy.
   * `chat`: the agent's session is a harness chat's. With no turn of it running, nothing stands for the person's switch
   * and the upstream's policy is not theirs, so Filament does nothing for the agent (the bug report's P1).
   * @param {LiveTurn | null | undefined} turn @param {any} upstream @param {string} kind @param {string} title
   * @param {{ chat?: boolean }} [o]
   */
  async permitLocal(turn, upstream, kind, title, { chat = false } = {}) {
    if (chat && (!turn || turn.done))
      throw Object.assign(new Error(`refused: no turn of the harness chat runs to judge it, so Filament did not ${describeToolCall({ kind, title })}`), { code: -32000 });
    const acp = this.latestAcp.get(upstream.id) || upstream.acp || {};
    const policy = this.policyOf(acp, upstream.id);
    const options = [
      { optionId: "allow", name: "Allow", kind: "allow_once" },
      { optionId: "reject", name: "Reject", kind: "reject_once" },
    ];
    const agentName = (upstream.name || upstream.id).replace(" (agent via ACP)", "");
    const calls = loopCalls({ kind, title }, upstream.id);
    if (turn?.permits && !turn.done && Array.isArray(calls)) {
      const j = await this.judged(turn, calls, { agent: agentName, what: `have Filament ${describeToolCall({ kind, title })}`, call: null });
      if (j.outcome === "run") return;
      throw Object.assign(new Error(j.outcome === "refused" ? `refused: ${j.why} refused it` : j.outcome === "declined" ? "refused by the user" : "the question was not answered"), { code: -32000 });
    }
    // A read is no question `ask` puts to you, as the agent's own reads never are: it goes by allow-once, unsaid. A word
    // that is none of the policies asks for every request, a read too, and refuses it where nobody can be asked.
    const asks = askingPolicy(policy) && (policy !== "ask" || kind !== "read");
    if (asks && turn && !turn.done && turn.bridge !== "off" && turn.clientTools.has("ask")) {
      const question = `${agentName} wants Filament to ${describeToolCall({ kind, title })}. Allow it?`;
      try {
        const id = await this.askClient(turn, {
          kind: "permission",
          call: turn.clientTools.buildAsk({ question, header: "Permission", options }),
          parse: (t) => ClientToolset.parseAskAnswer(t, options, question, turn.clientTools.askShown(options)),
        });
        if (id !== "allow") throw new Error("refused by the user");
        return;
      } catch (/** @type {any} */ e) {
        throw Object.assign(new Error(`refused: ${e.message}`), { code: -32000 });
      }
    }
    const d = choosePermission(policy === "ask" ? "allow-once" : policy, {
      toolCall: { kind, title },
      options,
    });
    if (d.outcome.optionId !== "allow")
      throw Object.assign(new Error(isPolicy(policy) ? `refused by Filament's permission policy (${policy})` : `refused by ${policyRefused(policy)}`), { code: -32000 });
    // Allowed once as the agent's own requests are when nobody can be asked, and said as theirs are (the bug
    // report's P2).
    if (asks && turn && !turn.done) noteUnanswerable(turn);
  }
  // Time out actions the client never answered; forget turns that ended long ago.
  sweepTurns(now = Date.now()) {
    for (const [sid, t] of this.turns) {
      if (!t.done && t.detachedAt && t.waiting.length && now - t.detachedAt > t.clientWaitMs) {
        const n = t.abandon(
          `the client did not answer within ${Math.round(t.clientWaitMs / 60000)} min`,
          "CLIENT_TIMEOUT",
        );
        this.log(
          "warn",
          `[bridge] ${String(sid).slice(0, 8)}: ${n} client action(s) abandoned after ${Math.round((now - t.detachedAt) / 60000)} min without an answer`,
        );
      }
      if (t.done && now - (t.endedAt || t.startedAt) > 30 * 60_000) this.turns.delete(sid);
    }
  }
}

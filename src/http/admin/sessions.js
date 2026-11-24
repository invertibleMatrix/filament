// @ts-check
// The admin API's sessions area: the session inspector's backend (WP-S) and the native sessions' rows (HarnessV2
// §8.1). One session's truth — identity, what is in force, cost, memory activity, lineage — its request records, the
// override rows that change its chain-meta policies from the surface; and, for a native session, its creation, its
// turns (the reply in `/v1/messages` shape), its transcript, its settings document, compaction, fork and its move to
// another place of its repository (HarnessV4_Git_Plan §12); and any session's sub-agents. Memory's
// `/api/memory/sessions/*` stays the memory perspective (the transcript and the archive); this is the session
// perspective. Every mutation is a `config` operation, like the dashboard's own saves.
// Every answer here shows an MCP server's credentials as the placeholder (HarnessV4_Settings_Plan HS-D8): a session's,
// a project's and your defaults' settings all pass through this area.
import { readFileSync } from "node:fs";
import { sendJson as send } from "../../app/pipeline/respond.js";
import { maskAnswer } from "../../services/mcp-servers.js";
import { guard as guardWith } from "./guard.js";
import { lowerHeaders } from "../../core/headers.js";
import { isHouseCall } from "../../services/house.js";
import { agentsDevice, deviceCaller, markSessionTurn, pressRefused } from "../guards.js";
import { resolveModelDisplay } from "../../core/routing.js";
import { estimateTokens } from "../../core/tokens.js";
import { TURN_BY, turnBy } from "../../core/turn-by.js";
import { SUBAGENT_VIEWS } from "../../services/session-settings.js";
import { SUBAGENT_STARTS, startFields } from "../../services/subagent-starts.js";
import { tabOf, takeOf } from "../../services/session-writers.js";
import { readImages } from "../../services/runs.js";
import { exchangeOfRun } from "../../core/run-work.js";
import { eventsOf } from "../../app/sessions/cut-turns.js";
import { helpersMade, madeIn } from "./artifacts.js";
import { allowedFolderSoon } from "./folder.js";
import { PAUSE_KINDS, newFolderRefusal } from "../../app/agent/turn.js";
import { askOf, shownCommand } from "../../app/agent/tools.js";
import { choicesOf } from "../../app/agent/subagents.js";
import { makeWorktree, takeBack } from "../../adapters/git/places.js";
import { lastCheckout } from "../../adapters/git/worktree.js";
import { repoOf } from "../../adapters/git/snapshot.js";
import { imageTypeOf } from "../../core/media.js";
import { rangeBlock } from "../../core/hunt-range.js";
import { yourFilesCheck } from "../../app/agent/instructions.js";
import { spaceable } from "../../core/space.js";
import { allCommands, commandsOf, stopByPerson } from "../../app/agent/commands.js";
import { cancelComeBack, comeBacksNow, stopChatShells } from "../../adapters/tools/hands.js";
import { cancelByPerson } from "../../app/agent/come-back.js";
import { goalOf } from "../../services/memory/truth.js";
import { listVersions } from "../../core/list-since.js";
import { driverOf } from "./browser.js";
import { fullControl, grantEnds } from "../../services/devices.js";
import { folderKeyOf, inFolder } from "../../services/copies.js";
import { agentsPage } from "../../core/teams-on.js";

/** The area's one way to answer: the body with every MCP server's credentials masked. @type {typeof send} */
const sendJson = (res, status, obj, extra) => send(res, status, maskAnswer(obj), extra);

/**
 * The area's reading of a failure: a refusal that names its status (the sessions service's 400/404/409, its 502 when
 * the compaction model keeps failing), no archive (its words say why), or an unknown session.
 * @param {(r: any, a: any) => any} fn
 */
const guard = (fn) =>
  guardWith(
    async (r, a) => {
      try {
        return await fn(r, a);
      } catch (/** @type {any} */ e) {
        if (Number.isInteger(e?.status) && e.status >= 400 && e.status < 600 && !r.res.headersSent)
          return sendJson(r.res, e.status, { error: e.message, ...(e.extra || {}) });
        throw e;
      }
    },
    (msg) =>
      /^no archive/.test(msg)
        ? { status: 503, error: msg }
        : /^no such session/.test(msg)
          ? { status: 404, error: "no such session" }
          : /^no such project/.test(msg)
            ? { status: 404, error: "no such project" }
            : null,
  );

/** A provider's id from its route, decoded (the router hands params over as sent): a call's id may hold a `:`, as
 *  `functions.read:0` does, which the page sends as `%3A`, and a visual's is its call's. One that does not decode is
 *  read as sent. @param {any} r @param {string} name */
const idOf = (r, name) => {
  try {
    return decodeURIComponent(String(r.params[name]));
  } catch {
    return String(r.params[name]);
  }
};

/**
 * An ask waiting in a chat (the remote-agents plan's f-answer), as GET /sessions/:id/asks lists it and
 * POST /sessions/:id/asks/:ask/answer answers it. Its id is made of what its event already carries — the run log puts
 * its run's `runId` on every event: the chat's own turn's pause is its run's id (the turn that paused, `paused.requestId`);
 * a coding agent's question is `<runId>.<id>`, its run's and its own (`q1`), and so is the card the chat's own turn
 * waits on for a command on another machine (`there-1`); a sub-agent's is `<agentId>.<ask>`, its number among the
 * sub-agent's questions. So an id names one ask once: a later turn's `q1`, or a sub-agent's next ask, is another.
 * `from`: "chat", "coding-agent", or the sub-agent's id. `options`: the answers it is answered by, each by its id
 * (`choice`); `words`: whether words may answer it — alone, for a question of the chat's or a sub-agent's, whose choice
 * is its answer; beside a choice in a form, a permission's press or a plan's go. `form`: a coding agent's form whole,
 * or a command card's for another machine, which `outcome` and `answers` answer as its run's own route does.
 * @typedef {{ id: string, kind: string, from: string, runId: string | null, tool: string, question: string, command?: string,
 *   options: { id: string, label: string, description?: string }[], words: boolean, at: number | null, form?: any }} Ask
 */
/** A permission's answers: the press of Allow or of Deny (`choice`, or `allow` as a boolean) — never its words. */
const PERMIT_OPTIONS = Object.freeze([
  { id: "allow", label: "Allow" },
  { id: "deny", label: "Deny" },
]);
/** A worker's plan its lead reviews (TG2-D50): its go — the words beside it, or alone, are its corrections. */
const PLAN_OPTIONS = Object.freeze([{ id: "go", label: "Go: let it start" }]);
/** A coding agent's plan with no ways on of its own, and a link it asks the person to open: their outcomes. */
const FORM_OPTIONS = Object.freeze({
  plan: [
    { id: "accepted", label: "Accept the plan" },
    { id: "rejected", label: "Reject it" },
  ],
  link: [
    { id: "accepted", label: "Opened it" },
    { id: "declined", label: "Decline" },
  ],
});
/**
 * How far back a run is read for the asks it waits on where its run log lists none of its own (services/runs.js
 * `waitingAsks`, which every running turn here has): a stand-in's. One past it is listed nowhere and answered here 409,
 * as one that waits no more; its run's own route (POST /runs/:id/answer) reads no window.
 */
const ASK_EVENTS = 5000;

/**
 * How long a session's answer waits for what is still open in its folder to be read anew, after a Clean up or a Tidy
 * up moved it (the reviewer's of 11-10): past it the answer goes with the last read, marked `stale`, and the page asks
 * again in a moment (views/plan.js `OPEN_AGAIN_MS`). Only the read that shows the list waits (`?open=fresh`).
 */
const OPEN_FRESH_MS = 2500;

/**
 * @param {any} a  the admin context
 * @returns {import("../router.js").RouteRow[]}
 */
export function sessionRoutes(a) {
  const { memory, usage, ops, sessions, replayCompare = null, config, sessionTurns = null, runs = null, subagents = null, secondLook = null, sessionWriters = null, graphs = null, guests = null, artifacts = null, copies = null, flows = null, stillOpen = null, isDraining = () => false, log = () => {} } = a;
  /**
   * Whether the chat's turn waits on a question it asked (its park's kind `ask`, run out of time not yet): a message
   * answers it. @param {string} id
   */
  const questionWaits = (id) => {
    const p = /** @type {any} */ (memory.archive.metaOf(id, ["paused"]))?.paused;
    return p?.kind === "ask" && !(Number(p.expires) > 0 && Number(p.expires) <= Date.now());
  };
  /**
   * A write to the session (HarnessV3-FixRound decision 22): a harness tab that follows it, read-only, is refused in
   * words. A request that names no tab is not a harness tab's, and passes. Stop and Force stop never come here.
   * @param {(r: any, a: any) => any} fn
   */
  const writes = (fn) => (/** @type {any} */ r, /** @type {any} */ ctx) => {
    const why = sessionWriters?.refusal(r.params.id, tabOf(r.req), { take: takeOf(r.req) }) || null;
    return why ? sendJson(r.res, 409, { error: why, readOnly: true }) : fn(r, ctx);
  };
  /** Each chat's Agents list as last sent, by version: a read that names the one it holds is sent the rows that moved. */
  const agentLists = listVersions();
  /** …and as its heads (`heads=1`), apart: a version of one form never names one of the other's. */
  const agentHeads = listVersions();
  /**
   * The views' sizes being read, by chat: a read asked while one is on its way takes that one's answer (the owner's of
   * 11-17: the Sub Agents tab asks for its sizes twice at once, and each read composed a long chat's whole history
   * twice, the server held for seconds at each). Let go of once it answers: the next read composes afresh.
   * @type {Map<string, Promise<Record<string, number>>>}
   */
  const sizing = new Map();
  /** @returns {import("../../app/agent/subagents.js").SubagentRegistry} */
  const subagentsOn = () => {
    if (!subagents) throw Object.assign(new Error("sub-agents are not wired in this Filament"), { status: 503 });
    return subagents;
  };
  /** The records that belong to the session, as the truth wants them (raw) and as the list wants them (public). */
  const recordsOf = (chainId) => (usage?.forChain ? usage.forChain(chainId) : { records: [], capped: false });
  /** The truth's model names as "who answers them": `agent/grok-4.6-xhigh` is a lane — the row shows the upstream
   *  it lands on. Two lanes to the same destination collapse into one line. @param {string[]} names */
  const modelsAnsweredBy = (names) => {
    const seen = new Set();
    const out = [];
    for (const n of names || []) {
      const shown = resolveModelDisplay(config.get(), n);
      if (!shown) continue;
      const key = shown.replace(/\s*\(.*\)$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(shown);
    }
    return out;
  };
  const native = () => {
    if (!sessions) throw new Error("no archive: native sessions are not wired");
    return sessions;
  };
  /**
   * A session made in a new worktree (HarnessV4_Git_Plan GW-D45): its start checked first, then the worktree made from
   * its folder, then the session made in it. A create that fails after that takes the worktree back, and says what
   * stays where it could not. A refusal is a 409 in words, with a free name where the name is taken. Made, the worktree
   * gets its project's template copied in (HarnessV4_Four_Plan FO-D34), beside the chat: the paths the line left on
   * (`copy`), else the project's list; the chat's first turn waits for it (FO-D36).
   * @param {any} args  `create`'s
   * @param {any} worktree  the body's `{ name, made?, copy? }`: `made`, a name the page made from the message (GW-D44)
   */
  const createInWorktree = async (args, worktree) => {
    const f = await allowedFolderSoon(config.get(), args.cwd);
    if (!f.ok) throw Object.assign(new Error(f.error), { status: f.status });
    native().check(args);
    const refuse = (/** @type {string} */ x) => newFolderRefusal(config.get(), x, { from: f.root });
    const made = await makeWorktree(f.root, String(worktree?.name || "").trim(), { refuse, orFree: worktree?.made === true });
    if (!made.ok) throw Object.assign(new Error(made.error), { status: 409, extra: made.free ? { free: made.free } : {} });
    log("info", `git: the worktree ${made.folder} made on branch ${made.branch} for a new chat`);
    let chat;
    try {
      chat = native().create({ ...args, cwd: made.cwd });
    } catch (/** @type {any} */ e) {
      const stays = await takeBack(made);
      log(stays ? "warn" : "info", `git: the worktree ${made.folder} taken back, its chat not made${stays ? `; ${stays}` : ""}`);
      if (stays) e.message = `${e.message}; ${stays}`;
      throw e;
    }
    const copy = Array.isArray(worktree?.copy) ? worktree.copy.map(String) : native().worktreeTemplate(f.root).copy;
    copies?.start(chat.id, { from: made.place, to: made.folder, paths: copy });
    return { ...chat, worktree: { name: made.name, folder: made.folder, branch: made.branch } };
  };
  /**
   * Where a move goes, as a body or a query names it: a place, or a new worktree's name and what it copies.
   * @param {any} to
   */
  const moveTo = (to) =>
    to?.place
      ? { place: String(to.place) }
      : { name: String(to?.name || ""), made: to?.made === true, ...(Array.isArray(to?.copy) ? { copy: to.copy.map(String) } : {}) };
  /** A settings change body: `{ patch, unset }`, or the document itself as the patch. @param {any} b */
  const changeOf = (b) => {
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    const hasKeys = "patch" in b || "unset" in b;
    return { patch: hasKeys ? b.patch || {} : b, unset: hasKeys && Array.isArray(b.unset) ? b.unset : [] };
  };
  /**
   * The chat's own turn's pause while it waits for the person (`meta.paused`, as the transcript's `paused` says it): not
   * once it lapsed, nor while a turn begun after it runs — its answer's — or the turn that answers it is in flight
   * (`answeredBy`). The turn that paused may hold the chat a moment past its reply's end: the pause waits all the same.
   * A client's chat is its client's to answer, in its own next message.
   * @param {string} chainId @returns {Ask | null}
   */
  const ownAsk = (chainId) => {
    const chain = memory.archive?.chainHead(chainId);
    const p = chain?.native ? memory.archive.metaOf(chainId, ["paused"])?.paused : null;
    if (!p?.requestId || !PAUSE_KINDS.includes(p.kind) || (Number(p.expires) > 0 && Number(p.expires) <= Date.now())) return null;
    const at = Number(p.at) || 0;
    if (Number(sessionTurns?.holder(chain.key)?.since) > at) return null;
    if (p.answeredBy && usage?.byId?.get(String(p.answeredBy))?.status === "pending") return null;
    const id = String(p.requestId);
    if (p.kind === "ask") {
      const q = askOf(p.pending?.input);
      const options = q.options.map((o, i) => ({ id: String(i + 1), label: o.label, ...(o.description ? { description: o.description } : {}) }));
      return { id, kind: "question", from: "chat", runId: id, tool: "ask", question: q.question, options, words: true, at: at || null };
    }
    const tool = String(p.pending?.name || "");
    const command = shownCommand(tool, p.pending?.input);
    return { id, kind: "permission", from: "chat", runId: id, tool, question: String(p.question || ""), ...(command ? { command } : {}), options: PERMIT_OPTIONS.map((o) => ({ ...o })), words: true, at: at || null };
  };
  /** A coding agent's form's one question, where it asks one that takes one choice: its choices answer it. @param {any} f */
  const oneQuestion = (f) => (Array.isArray(f?.questions) && f.questions.length === 1 && !f.questions[0].several ? f.questions[0] : null);
  /**
   * The questions the chat's coding agent's turn waits on (HarnessV3-ACP AC2-4), and the cards its own agent's turn waits
   * on for a command on another machine (agent/loop.js `askThere`, `there-N`, the chat's: `from` "chat"): asked on its run
   * (`ask` that `waits`, by its id) and not ended there (`ask-end`). A worker's question to its lead is its sub-agent's,
   * listed with it. Each carries its form, which answers it.
   * @param {any} run  the run's meta, as `runningIn` lists it @returns {Ask[]}
   */
  const agentAsks = (run) => {
    const from = run.kind === "coding-agent" ? "coding-agent" : "chat";
    const id = String(run.id);
    // The run's own list where it keeps one (services/runs.js `waitingAsks`): a card waits inside a turn whose other
    // calls may stream thousands of events meanwhile. Else its newest events.
    const evts = runs?.waitingAsks ? runs.waitingAsks(id) : runs?.events(id, { since: Math.max(0, (Number(run.events) || 0) - ASK_EVENTS), limit: ASK_EVENTS, types: ["ask", "ask-end"] })?.events || [];
    const ended = new Set(evts.filter((e) => e.type === "ask-end").map((e) => String(e.id)));
    return evts
      .filter((e) => e.type === "ask" && e.waits === true && e.kind !== "lead" && typeof e.id === "string" && e.id && !ended.has(e.id))
      .map((e) => {
        const f = e.form || {};
        const one = oneQuestion(f);
        const options = one
          ? one.choices.map((/** @type {any} */ c) => ({ id: String(c.id), label: String(c.label || c.id), ...(c.description ? { description: String(c.description) } : {}) }))
          : !f.questions?.length && f.kind in FORM_OPTIONS ? /** @type {any} */ (FORM_OPTIONS)[f.kind].map((/** @type {any} */ o) => ({ ...o })) : [];
        const command = String(f.judged?.command || "");
        return { id: `${id}.${e.id}`, kind: String(e.kind || f.kind || "question"), from, runId: id, tool: String(e.tool || "ask"), question: String(e.question || ""), ...(command ? { command } : {}), options, words: !!one?.words, at: Number(e.ts) || null, form: f };
      });
  };
  /**
   * A sub-agent's call or question that waits for the person (`progress.asking`, registry `ask` and `askLead`): its
   * call's permission, its question to its lead — which the person answers too —, or its plan its lead reviews.
   * @param {any} s  its row @param {any} q  its `progress.asking` @returns {Ask}
   */
  const subagentAsk = (s, q) => {
    const lead = q.to === "lead";
    const plan = lead && q.plan === true;
    // A question its chat on another machine asks there (the remote-agents plan's s-asks) is answered as its lead's is.
    const question = lead || q.kind === "question";
    const command = question ? "" : String(q.command || q.args || "");
    const options = !question ? PERMIT_OPTIONS.map((o) => ({ ...o })) : plan ? PLAN_OPTIONS.map((o) => ({ ...o })) : (Array.isArray(q.options) ? q.options : []).map((/** @type {any} */ label, /** @type {number} */ i) => ({ id: String(i + 1), label: String(label) }));
    return { id: `${s.id}.${q.n}`, kind: plan ? "plan" : question ? "question" : "permission", from: String(s.id), runId: s.runId || null, tool: String(q.tool || ""), question: String(q.question || ""), ...(command ? { command } : {}), options, words: true, at: Number(q.at) || null };
  };
  /**
   * Every ask waiting in the chat now: its own turn's, its coding agent's, its sub-agents'. A caller that joins late —
   * another machine following a chat it started here — finds them here, as the page finds them in the transcript.
   * @param {string} chainId @returns {Ask[]}
   */
  const asksIn = (chainId) => {
    /** @type {Ask[]} */
    const out = [];
    const own = ownAsk(chainId);
    if (own) out.push(own);
    for (const run of runs?.runningIn?.(chainId) || []) if (run.kind === "coding-agent" || run.kind === "agent-turn") out.push(...agentAsks(run));
    for (const s of subagents?.list(chainId) || []) if (s.status === "running" && s.progress?.asking) out.push(subagentAsk(s, s.progress.asking));
    return out;
  };
  /**
   * An ask id that waits no more: one this chat asked once — its turn's run asked it (`ask`), its sub-agent asked that
   * many — is answered or ended (409); any other is none of the chat's (404). The same words for an id never asked and
   * for another chat's, so an answer learns nothing of the ids there are. A sub-agent after a restart is the chat's
   * again, its count of questions with it (`asksIn` lists the chat's sub-agents first, which reads its kept threads in):
   * one the chat keeps no more — deleted from the Agents tab, or past the threads it keeps — is none of its own now, and
   * its asks are 404, refused as a 409 would be.
   * @param {string} chainId @param {string} askId @returns {[number, string]}
   */
  const noAsk = (chainId, askId) => {
    const dot = askId.lastIndexOf(".");
    const head = dot < 0 ? askId : askId.slice(0, dot);
    const tail = dot < 0 ? "" : askId.slice(dot + 1);
    const sa = dot < 0 ? null : subagents?.get(head);
    const n = Number(tail);
    const runOfChat = !sa && String(runs?.getRun(head)?.meta?.chain ?? "") === chainId;
    const asked = sa
      ? sa.chainId === chainId && Number.isInteger(n) && n >= 1 && n <= Number(sa.questions)
      : runOfChat && (runs?.events(head, { since: 0, limit: 50000, types: ["ask"] })?.events || []).some((e) => e.type === "ask" && (dot < 0 ? !e.waits : e.waits === true && e.id === tail));
    return asked ? [409, `ask ${askId} waits no more: it was answered, or what asked it ended`] : [404, `no ask ${askId} in this chat`];
  };
  /**
   * A chat's Stop, as POST /sessions/:id/stop takes it and a revoked agents' device's chats are stopped: forced where
   * `force`. → the turn's holder and how the stop landed (null: nothing of the harness's ran), and the runs it reached
   * where the holder named none.
   * @param {{ id: string, key: string }} chain @param {{ force?: boolean, from?: string }} [o]
   */
  const stopChat = (chain, { force = false, from = "harness" } = {}) => {
    // Whichever way the stop lands below, Filament starts no turn of its own here until a newer one begins (FO-D50) —
    // and a driving goal halts until `/goal go` (core/goal-drive.js), whether or not a turn ran.
    memory.markLastStop?.(chain.id);
    sessions.holdGoal?.(chain.id, "stopped");
    // …and a come-back its agent set (agent/come-back.js) is dropped with it, and Filament's check-in on its running
    // commands (sessions/idle-wake.js).
    cancelComeBack(chain.id);
    sessions.idleStop?.(chain.id);
    /** The stop for one run, forced when asked. → whether the run took it. @param {string} runId */
    const stopRun = (runId) => (force ? runs?.force?.(runId, { from }) : runs?.steer?.(runId, { kind: "stop", text: "", from }))?.ok === true;
    const took = force ? "forced" : "steered";
    const holder = sessionTurns.holder(chain.key);
    if (holder?.window !== "harness") return { holder: null, stopped: null, runs: null };
    // A loop running under the turn's request gets the stop steer: its stop signal cuts what is running (the model
    // call, a command, a foreground sub-agent) and the loop ends the turn `stopped`, in its words, with its work
    // archived. A turn whose request id is not out yet (one not streamed writes its head at its end) is found by its
    // run: the session's running turns that are the harness's own requests (`api: "session"` on their record) — an
    // outside client's coding-agent turn still running in the session is its client's. The session's cancel is only
    // for a turn with no loop under it yet (still composing): cancelling a loop too would make its hang-up check win
    // and end the turn "aborted", unarchived (BUG-06). `steer` answers `{ ok: false }` when no loop runs under the id;
    // it never throws. No text: the note must not quote words the developer never typed.
    const ids = holder.requestId
      ? [holder.requestId]
      : (runs?.runningIn?.(chain.id) || []).filter((/** @type {any} */ m) => usage?.byId?.get(m.id)?.api === "session").map((/** @type {any} */ m) => m.id);
    const reached = ids.filter((runId) => stopRun(runId));
    const steered = reached.length > 0;
    const cancelled = steered ? false : native().cancelTurn(chain.id);
    return { holder, stopped: steered ? took : cancelled ? "cancelled" : null, runs: steered && !holder.requestId ? reached : null };
  };
  /**
   * What runs in the chats another machine's agents' device started stops at once, forced: each chat's turn, as its
   * Force stop ends it, its sub-agents at work, its task graph — held, its command tasks' runs and its checks cut, with
   * or without a turn of the chat running (graph-runner.js `stop`) — and its background commands, its agent's and its
   * sub-agents', each with everything it started (hands.js `stopChatShells`). Their asks end with their runs; nothing of
   * those chats starts by itself after (`stopChat`). @param {string} device  its id @param {string} why  what ended its
   * reach, for the log
   */
  const stopDeviceChats = (device, why) => {
    if (!memory.archive) return;
    for (const id of memory.archive.chainIds()) {
      if (memory.archive.metaOf(id, ["agentDevice"])?.agentDevice !== device) continue;
      const chain = memory.archive.chainHead(id);
      const turn = chain?.native && sessionTurns && sessions ? stopChat(chain, { force: true, from: "filament" }).stopped : null;
      const subs = (subagents?.list(id) || []).filter((s) => s.status === "running" && subagents?.stop(s.id, { from: "filament" }).ok).length;
      graphs?.stop(id);
      if (turn || subs) log("info", `remote: chat ${id} stopped (its turn ${turn || "not running"}, ${subs} sub-agent${subs === 1 ? "" : "s"}): ${why}`);
      void stopChatShells(id).then(
        (n) => {
          if (n) log("info", `remote: chat ${id}'s ${n} background command${n === 1 ? "" : "s"} stopped: ${why}`);
        },
        (/** @type {any} */ e) => log("warn", `remote: chat ${id}'s background commands could not all be stopped (${why}): ${String(e?.message || e).slice(0, 200)}`),
      );
    }
  };
  // Another machine's agents' device revoked — by a manager here, with the full device it came in by, or replaced by a
  // second mint (devices.js `onRevoke`) — and its chats stop.
  a.devices?.onRevoke?.((/** @type {string} */ gone) => {
    // One a second mint replaced has left the list already: only a device still listed as no agents' one is passed by.
    const d = a.devices.get(gone);
    if (d && d.scope !== "agent") return;
    stopDeviceChats(gone, "the agents' device that started it was revoked");
  });
  // …and so do they as its grant `agents` is switched off (devices.js `onGrant`): its door lets it in no more, and what
  // it started goes no further. Full control switched off stops them too: a turn that runs as the person's would run on
  // so until it ends (`grantEnds`).
  a.devices?.onGrant?.((/** @type {string} */ id, /** @type {any} */ grants, /** @type {any} */ before) => {
    const ends = grantEnds(grants, before);
    if (ends) stopDeviceChats(id, `the agents' device that started it had its ${ends}`);
  });
  /**
   * The end of the turn that holds a chat, waited for up to `ms`. → whether it ended.
   * @param {string} key @param {number} ms @returns {Promise<boolean>}
   */
  const turnEnded = (key, ms) =>
    new Promise((done) => {
      if (!sessionTurns) return done(true);
      /** @type {() => void} */
      let un = () => {};
      const clock = setTimeout(() => {
        un();
        done(false);
      }, ms);
      un = sessionTurns.onChange(key, (/** @type {any} */ holder) => {
        if (holder) return;
        clearTimeout(clock);
        un();
        done(true);
      });
    });
  // Copies let go — cleared from their machine's card, idle a week, or making room (services/copies.js) — take the chats
  // that machine's agents worked in there with them, before their folders are removed: what runs in each stopped as a
  // revoke stops it and waited for, then the chat deleted as its Delete deletes it (memory.js): its teams and flows
  // stopped, what was kept behind its graphs dropped. A chat's folder is compared as the filesystem named the copies'
  // folders before they went (`keys`). The person's chat in a copy placed for it (Run on) goes with that copy too
  // (`chats`), its folder compared alike.
  /**
   * The projects copies let go made here — a chat in a copy makes its folder one (`projectName`) —, each whose folder was
   * one of theirs and that holds no chat now, deleted with its Space: none stays in the list for a folder that is gone.
   * @param {string[]} keys  the copies' folders, as copies.js `folderKeyOf` named them
   */
  const dropCopyProjects = async (keys) => {
    /** @type {{ id: string, cwd: string | null, name: string | null, chains: number }[]} */
    let projects = [];
    try {
      projects = memory.archive?.projects?.() || [];
    } catch (/** @type {any} */ e) {
      log("warn", `[copies] the projects of copies let go could not be read (${e?.message || e}): they stay in the list`);
      return;
    }
    for (const p of projects) {
      if (Number(p.chains) > 0 || !p.cwd || !keys.some((f) => inFolder(folderKeyOf(String(p.cwd)), f))) continue;
      try {
        await memory.deleteProject(p.id);
        if (a.spaces?.drop?.(p.id)) a.routines?.arm?.();
      } catch (/** @type {any} */ e) {
        log("warn", `[copies] the project ${p.name || p.cwd} of a copy let go was not deleted: ${e?.message || e}`);
      }
    }
  };
  a.remoteCopies?.onCleared?.(async (/** @type {import("../../services/copies.js").Cleared} */ { devices: theirs, keys, chats: yours = [] }) => {
    if (!memory.archive?.agentChats || !keys.length) return;
    if (!theirs.length && !yours.length) return void (await dropCopyProjects(keys));
    const inside = (/** @type {string | null} */ cwd) => {
      if (!cwd) return false;
      const k = folderKeyOf(cwd);
      return keys.some((f) => inFolder(k, f));
    };
    // One whose folder cannot be read is left: the agents' chats there are stopped all the same (the review of s2a).
    const own = yours.flatMap((id) => {
      try {
        const cwd = memory.archive.metaOf?.(id, ["cwd"])?.cwd;
        return typeof cwd === "string" ? [{ id, cwd }] : [];
      } catch (/** @type {any} */ e) {
        log("warn", `[copies] chat ${id}'s folder could not be read (${e?.message || e}): it is not deleted with its copy`);
        return [];
      }
    });
    const chats = [...memory.archive.agentChats(theirs), ...own].filter((/** @type {any} */ x, i, all) => inside(x.cwd) && all.findIndex((y) => y.id === x.id) === i);
    // Each chat on its own: one whose stop throws neither lets the folders go early nor leaves the others running.
    await Promise.allSettled(
      chats.map(async (/** @type {{ id: string }} */ c) => {
        const chain = memory.archive.chainHead(c.id);
        /** @param {string} what @param {() => unknown} fn */
        const step = (what, fn) => {
          try {
            fn();
          } catch (/** @type {any} */ e) {
            log("warn", `[copies] chat ${c.id}'s ${what} could not be stopped: ${String(e?.message || e).slice(0, 160)}`);
          }
        };
        step("turn", () => chain?.native && sessionTurns && sessions && stopChat(chain, { force: true, from: "filament" }));
        step("sub-agents", () => {
          for (const s of subagents?.list(c.id) || []) if (s.status === "running") subagents?.stop(s.id, { from: "filament" });
        });
        step("task graph", () => graphs?.stop(c.id));
        step("teams", () => a.besides?.stopAll(c.id));
        step("flows", () => flows?.drop(c.id));
        await stopChatShells(c.id).catch(() => 0);
        if (chain && !(await turnEnded(chain.key, 30_000))) log("warn", `[copies] chat ${c.id}'s turn did not end within 30 s of its stop: it is deleted all the same`);
        const beside = memory.archive.besideOf?.(c.id) || [];
        try {
          await memory.deleteSession(c.id);
          for (const id of [c.id, ...beside]) a.taskNotes?.drop(id);
        } catch (/** @type {any} */ e) {
          log("warn", `[copies] chat ${c.id} in a copy let go was not deleted: ${e?.message || e}`);
        }
      }),
    );
    await dropCopyProjects(keys);
  });
  /**
   * Whether a chat is another machine's agents' whose device lets them in no more: revoked, replaced by a second mint, or
   * its grant `agents` switched off. @param {string} chainId
   */
  const agentsLetGo = (chainId) => {
    const device = memory.archive?.metaOf?.(chainId, ["agentDevice"])?.agentDevice;
    if (typeof device !== "string") return false;
    const d = a.devices?.get?.(device);
    return !d || d.revokedAt != null || d.grants?.agents !== true;
  };
  /**
   * Whether a turn in the chat `chainId` reads past its own project (`markSessionTurn`'s `reads`): never in another
   * machine's agents' chat that runs fenced (archive.js `fenced`), whoever sends its turn — the person, or Filament's own
   * wake —; nor for their device itself unless it holds Full control (the fc-review's).
   * @param {string} chainId @param {import("../guards.js").Caller | null} who
   */
  const turnReads = (chainId, who) =>
    memory.archive?.fenced?.(String(chainId)) !== true && (!agentsDevice(who) || fullControl(a.devices, /** @type {any} */ (who).device.id));
  return [
    [
      "POST",
      "/sessions",
      guard(async (r) => {
        const b = await r.json();
        if (!b || typeof b !== "object") return sendJson(r.res, 400, { error: "a JSON object is required: { cwd, model?, title?, autoTitle?, settings?, kind?, worktree?, from? }" });
        // `from: { space }`: handed from a Space of your own to run here (HarnessV4_SpacesPlugins_Plan A4); its What
        // happened says when the chat finishes.
        if (b.from != null && !(typeof b.from === "object" && spaceable(b.from.space)))
          return sendJson(r.res, 400, { error: "from is the Space it was handed from: { space: <its project's id> }" });
        // `preset`: there are none; a client written before them sends none or "plain", any other name is refused (draftOf).
        // Another machine's agents' chat runs with memory's recall and tools off while their device holds no Full control
        // (the remote-agents plan's f-fence; archive.js `fenced`, read at each resolution of its settings): their machine
        // keeps their memory, and nothing of this machine's other chats reaches them; its turns are recorded as any
        // chat's. What else they may set is their model, effort and mode, the mode capped by their grants (remote.js
        // AGENT_BODIES).
        const settings = b.settings ?? null;
        // `agents`: started by another machine's agents' device — the one kind of chat Filament's copies folder is a root for.
        const args = { cwd: b.cwd, model: b.model ?? null, title: b.title ?? null, autoTitle: b.autoTitle === true, settings, preset: b.preset ?? null, kind: b.kind || "interactive", ...(b.from ? { from: { space: String(b.from.space) } } : {}), ...(agentsDevice(r.who) ? { agents: true } : {}) };
        // A copy another launch's chat works in is that chat's alone: a second chat there would work under its turns. One
        // whose chat never ran a turn there goes to this one (copies.js `bind`): the launch never heard that chat named.
        const taken = agentsDevice(r.who) && typeof b.cwd === "string" ? a.remoteCopies?.copyAt(r.who.device.id, b.cwd) : null;
        // A copy placed for the person's own chat (transfers.js `place` `for: "person"`) is never their agents' to start in.
        if (taken?.owned) return sendJson(r.res, 403, { error: `${b.cwd} is in a copy placed for a chat of the person's own: another machine's agents start none there` });
        if (taken?.chat && taken.ran) return sendJson(r.res, 409, { error: `${b.cwd} is in a copy another launch's chat works in: a launch that names no folder takes a copy of its own` });
        // Run on: the person's chat, started by their machine's app — the full device that machine's agents' devices were
        // minted by — in the copy placed for it (services/copies.js `ownedAt`): bound to it below as a launch's chat is,
        // so its turns hold it and what it changes is read back from there; it works there whatever agentLoop.roots
        // lists (`ownCopy`). One copy, one chat: a second is refused once the first ran a turn.
        const own = r.who?.kind === "device" && r.who.scope === "full" && typeof b.cwd === "string" ? a.remoteCopies?.ownedAt?.(r.who.device.id, b.cwd) : null;
        if (own && b.worktree != null) return sendJson(r.res, 400, { error: `${b.cwd} is a copy placed for a chat of yours, which works in it: no worktree is made of it` });
        // A chat of it deleted gives way (copies.js `bind`); one not known to be gone is there.
        const ownChatThere = () => {
          try {
            return memory.archive?.hasChain?.(own?.chat) !== false;
          } catch {
            return true;
          }
        };
        if (own?.chat && own.ran && ownChatThere()) return sendJson(r.res, 409, { error: `${b.cwd} is in a copy another chat of yours works in: Run on sends a copy for each chat` });
        if (own) Object.assign(args, { ownCopy: own.folder });
        // A chat in a copy makes the copy's folder a project here, called for the project it is a copy of and the machine
        // it came from, never "1" (copies.js `projectName`); it goes with the copy (onCleared, above).
        const inCopy = own || taken;
        if (inCopy && a.remoteCopies?.projectName) Object.assign(args, { projectName: a.remoteCopies.projectName(inCopy) });
        // `worktree: { name }`: the chat works in a new worktree of its folder's repository, made here (GW-D45).
        const made = b.worktree != null ? await createInWorktree(args, b.worktree) : native().create(args);
        if (own) {
          if (!a.remoteCopies.bind(own.id, String(made.id))) {
            // Two starts in it at once, and the other's chat ran a turn first: this one is let go, as the 409 would say.
            await memory.deleteSession(String(made.id)).catch(() => null);
            return sendJson(r.res, 409, { error: `${b.cwd} is in a copy another chat of yours works in: Run on sends a copy for each chat` });
          }
          memory.archive?.mergeMeta(String(made.id), { copy: own.id });
          // A start before it whose chat never ran a turn there gave way to this one (the app asked again, its answer
          // lost): that chat, empty, is deleted, never left naming a copy that is this one's (the review of s2a).
          if (own.chat && own.chat !== String(made.id) && !own.ran) await memory.deleteSession(own.chat).catch(() => null);
        }
        // Another machine's agents' chat is theirs alone (the remote-agents plan's f-answer): the device that started it
        // is kept on it, and the admin gate lets that device reach no other chat, nor its runs or asks (index.js). The
        // name of the machine whose agents they are is kept beside it (`agentFrom`, the sidebar's "From MacBook's
        // agents"): a device minted again lets the one before go, and its name with it.
        // A chat started in a copy taken for its launch (transfers.js `place`) is that copy's, whose turns hold it
        // (services/copies.js `bind`, `lease`).
        if (agentsDevice(r.who)) {
          const from = r.who.device.from || (r.who.device.of ? a.devices?.get?.(r.who.device.of)?.name : null);
          const copy = a.remoteCopies?.copyAt(r.who.device.id, String(made.cwd || b.cwd || ""));
          const bound = copy && a.remoteCopies.bind(copy.id, String(made.id)) ? { copy: copy.id } : {};
          memory.archive?.mergeMeta(String(made.id), { agentDevice: r.who.device.id, ...(from ? { agentFrom: String(from) } : {}), ...bound });
          // Two starts in one copy at once both passed the 409 above, and the other's chat ran a turn first: this one is
          // let go, as the 409 would have said (the swarm's review of 11-10). A chat never bound there would work in it unheld.
          if (copy && !bound.copy) {
            await memory.deleteSession(String(made.id)).catch(() => null);
            return sendJson(r.res, 409, { error: `${b.cwd} is in a copy another launch's chat works in: a launch that names no folder takes a copy of its own` });
          }
        }
        return sendJson(r.res, 200, made);
      }),
    ],
    [
      "GET",
      "/sessions/holders",
      guard((r) => {
        // The compactions running now ride the same answer (HarnessV4_Tasks U3-5): the page's five-second resync
        // corrects a start or an end the events feed dropped, as it corrects a holder.
        const compacting = sessions?.compactionsNow() || [];
        // So do the commands running in the background, each chat's (HarnessV4_Background_Plan E38-D4): Now's resync.
        const commands = allCommands();
        // And each chat's come-back while one waits (agent/come-back.js; the Designer's of 10-27), for the same resync.
        const comeBacks = [...comeBacksNow()].map(([chainId, comeBack]) => ({ chainId, comeBack }));
        // …and each chat's check-in on its agent idle while its command runs (sessions/idle-wake.js).
        const idleWakes = sessions?.idleWakesNow?.() || [];
        // And each chat's work stretch going on, from its start (sessions/stretch.js; the owner's of 11-03): Now counts
        // the chat's time from it, across the turns what its agent waited on woke.
        const stretches = sessions?.stretchesNow?.() || [];
        // And the flows at work, every chat's (the owner's of 10-28): Now keeps a chat under Working while one runs.
        /** @type {import("../../app/flow-runner.js").FlowAtWork[]} */
        let flowsNow = [];
        try {
          flowsNow = flows?.live?.() || [];
        } catch {}
        // And the Spaces' buttons running now, an app's long build among them (the owner's of 10-29): Now's own rows.
        /** @type {any[]} */
        let appRuns = [];
        try {
          appRuns = (a.dashboards?.running?.() || []).map((/** @type {any} */ x) => {
            const p = memory.archive?.getProject?.(x.project);
            return { ...x, projectName: String(p?.name || p?.cwd || "").split(/[\\/]/).filter(Boolean).pop() || "" };
          });
        } catch {}
        if (!sessionTurns) return sendJson(r.res, 200, { holders: [], compacting, commands, comeBacks, idleWakes, stretches, flows: flowsNow, appRuns });
        // The lock knows the chain keys; the archive maps key → id, and a key that names no chain yet is left
        // out (its session isn't in the sidebar either — D11).
        const holders = sessionTurns
          .holders()
          .map(({ key, ...h }) => {
            const chainId = memory.archive?.chainIdForKey?.(key);
            return chainId ? { chainId, ...h } : null;
          })
          .filter(Boolean);
        return sendJson(r.res, 200, { holders, compacting, commands, comeBacks, idleWakes, stretches, flows: flowsNow, appRuns });
      }),
    ],
    [
      "GET",
      "/sessions/:id",
      guard(async (r) => {
        const { records, capped } = recordsOf(r.params.id);
        const truth = memory.sessionTruth(r.params.id, { records, capped });
        if (truth) truth.identity.models = modelsAnsweredBy(truth.identity.models);
        // Its graph with what is kept behind each task (HarnessV4_TaskNotes_Plan E33), as the runner's own views draw it:
        // the page takes the newest rev, so one view of a rev never drops the marks another drew — nor the side by side
        // Parallelize tasks frees from an Ignore (the review of 11-09).
        if (truth?.inForce?.graph && graphs) truth.inForce.graph = graphs.view(r.params.id);
        // What is still open in the chat, as its agent is told it again after a compaction: the Plan's card (11-05). Where
        // what the folders hold moved since its reads — a Clean up, a Tidy up —, the read anew is waited for a moment, so
        // the card's next look says what went (the reviewer's of 11-10). So is the first read of a folder never read
        // (the re-read of 11-11: the first look after a start had none of its rows, and nothing said they were coming).
        // Only for the read that shows the list, which asks for it (`?open=fresh`): a read for a pin, a title or a
        // model answers at once, the read begun behind it (`shown`).
        const fresh = r.url.searchParams.get("open") === "fresh";
        if (fresh && truth && (stillOpen?.stale?.(String(r.params.id)) || stillOpen?.reading?.(String(r.params.id)))) await stillOpen.refresh(String(r.params.id), { within: OPEN_FRESH_MS });
        // Still read past the wait (a repository of many worktrees), or not waited for: said, and the page asks again
        // in a moment (the review of 4569417b8).
        if (truth && stillOpen) truth.open = { ...stillOpen.shown(String(r.params.id)), ...(stillOpen.stale?.(String(r.params.id)) || stillOpen.reading?.(String(r.params.id)) ? { stale: true } : {}) };
        return truth ? sendJson(r.res, 200, truth) : sendJson(r.res, 404, { error: "no such session" });
      }),
    ],
    // A line of what is still open its agent dismissed, said again (the owner's of 11-09): `{ key }`, the item's, as
    // `open.items` names it. Only the session's writer brings one back.
    [
      "POST",
      "/sessions/:id/open/undismiss",
      guard(writes(async (r) => {
        if (!stillOpen) return sendJson(r.res, 503, { error: "what is still open is not wired in this Filament" });
        if (!memory.archive || !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const b = (await r.json()) || {};
        if (typeof b.key !== "string" || !b.key) return sendJson(r.res, 400, { error: "a JSON object is required: { key }, the item's" });
        stillOpen.undismiss(String(r.params.id), b.key);
        return sendJson(r.res, 200, { ok: true });
      })),
    ],
    // The goal a page's goal bar follows, and whether the chat is pinned: what `GET /sessions/:id` says of them in force
    // (`inForce.goal`, `inForce.pinned`), read off the chat alone — not its statistics (its turns, its records, memory's
    // rows), which that answer builds.
    [
      "GET",
      "/sessions/:id/goal",
      guard((r) => {
        if (!memory.archive) throw new Error(`no archive: ${memory.archiveWhy()}`);
        const meta = memory.archive.metaOf(String(r.params.id), ["goal", "pinned"]);
        return meta ? sendJson(r.res, 200, { goal: goalOf(meta.goal), pinned: !!meta.pinned }) : sendJson(r.res, 404, { error: "no such session" });
      }),
    ],
    // Who runs a turn in the session now, as its transcript says it (`live`), its turns unread: what a page asks again
    // and again while a chat it shows runs. `?after=<run>`: the turn after that run's too, by its newest request (`next`).
    ["GET", "/sessions/:id/live-state", guard((r) => sendJson(r.res, 200, native().liveState(r.params.id, { after: r.url.searchParams.get("after") || null })))],
    [
      "GET",
      "/sessions/:id/requests",
      guard((r) => {
        if (!memory.archive) throw new Error(`no archive: ${memory.archiveWhy()}`);
        if (!memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const limit = Math.min(500, Math.max(1, Number(r.url.searchParams.get("limit")) || 100));
        const { records, capped } = recordsOf(r.params.id);
        // Newest first, like /api/requests; each row is the public record (the bytes are on /api/requests/:id).
        const rows = records.slice(-limit).reverse().map((rec) => usage.publicRecord(rec));
        return sendJson(r.res, 200, { chainId: r.params.id, requests: rows, total: records.length, capped });
      }),
    ],
    // Sub-agents (HarnessV3 §15 item 86): the session's sub-agents and how warm the main agent's cache is, the
    // developer's own launches (the harness's spawn widget), what each context view would hand one, a task rewritten
    // with the main agent's context, and one sub-agent's state, stop, follow-up and a kept-aside report sent on. The
    // registry holds them in memory, and the session keeps each one's thread — what was said, never its conversation —
    // so they are here after a restart (HarnessV4_Tasks E15 step 5, BW-10).
    [
      "GET",
      "/sessions/:id/subagents",
      guard((r) => {
        const reg = subagentsOn();
        // `own`: a coding agent's own agents, read from the session's turns' runs (step 5, V4-D280): rows to read,
        // never Filament's to continue, stop or count. `limit`: Agents on the side's seats and how many of its agents
        // run, for the Sub Agents tab's meter (HarnessV4_Tasks U12-D5) — no number of the chat's own (the owner's of 11-05).
        // The two read the chat's settings once (`seatsNow`): a page asks this every few seconds while a row runs. `version`: the list
        // as sent; `since`, a version the page holds: then `ids`, every row's in order, and `subagents`, the rows that
        // moved since (`listVersions`, the slowness of 11-02: the owner's largest chat's list was 1.1 MB, read every
        // few seconds while an agent ran).
        // The list first: it brings back the threads the chat kept, as ever before the seats are counted. `heads=1`: each
        // exchange's words as the page's rows draw them (`publicOf` `head`), the page reading them whole where it shows
        // them; its versions are kept apart from the list's whole form, which another machine's older page reads.
        const since = String(r.url.searchParams.get("since") || "");
        const heads = r.url.searchParams.get("heads") === "1";
        const sent = (heads ? agentHeads : agentLists).take(r.params.id, reg.list(r.params.id, { head: heads }), since);
        // Work brought into the folder since no longer waits — its row moves on a later read. Every read asks, the reads
        // that name a version too: the page reads the list whole once, then by version.
        reg.settleWaiting(r.params.id, { person: true });
        const seats = reg.seatsNow(r.params.id);
        return sendJson(r.res, 200, { chainId: r.params.id, version: sent.version, ...(sent.ids ? { since, ids: sent.ids } : {}), subagents: sent.rows, own: guests ? guests.list(r.params.id) : [], queued: reg.queued(r.params.id), envelopes: reg.envelopes ? reg.envelopes(r.params.id) : [], cache: reg.cacheOf(r.params.id), limit: seats.limit, nextSeat: seats.nextSeat, refusedPictures: reg.refusedPictures() });
      }),
    ],
    [
      "POST",
      "/sessions/:id/subagents",
      guard(writes(async (r) => {
        const b = await r.json();
        if (!b || typeof b.prompt !== "string") return sendJson(r.res, 400, { error: "a JSON object is required: { prompt, description?, as? (a saved agent's tag, or a list of tags), models? (with one tag: that agent asked once on each of these models, all or none), images? ([{ name, mediaType, data }]), start?, worker? (an agent's tag: launched in its place, where `as` asks it by its tag), may? (read | copy | edit: lower than the card's, never higher), model?, effort? (model | low | medium | high | xhigh | max: the session's, else max, where none is named), view?, running?, changes?, memory?, worktree?, deliver?, pause?, inform?, hunts? (a graph task's id: the task a Hunter hunts bugs in), range? (with hunts: the files it hunts in) }" });
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        // The pictures that go with the task: each agent asked gets them after its words.
        const pics = readImages(b.images);
        if ("error" in pics) return sendJson(r.res, 400, { error: pics.error });
        // A start (HarnessV4_Tasks E13-1, BW-4) fills the fields the launch does not name itself.
        const named = {
          worker: typeof b.worker === "string" ? b.worker : undefined,
          may: typeof b.may === "string" ? b.may : undefined,
          view: typeof b.view === "string" ? b.view : undefined,
          running: typeof b.running === "boolean" ? b.running : undefined,
          changes: typeof b.changes === "string" ? b.changes : undefined,
          worktree: typeof b.worktree === "boolean" ? b.worktree : undefined,
          deliver: typeof b.deliver === "boolean" ? b.deliver : undefined,
        };
        const started = startFields(b.start, named);
        if (!started.ok) return sendJson(r.res, 400, { error: started.error });
        const f = started.start ? started.fields : named;
        // A start that brings its own question (Catch me up) is asked it where the launch brings no words; one that
        // asks its card launches by the card's tag, so the answer stands in the chat as that card's.
        const row = started.row;
        // A hunt's range (the plan's p6): the files a Hunter fired from a graph task hunts in — its task's — read from
        // git into the head of its task, each with the lines it holds uncommitted and how to read them, in the words of
        // one that hunts them alone. A file its task deleted is listed as gone: the hunt goes on.
        const hunts = typeof b.hunts === "string" && b.hunts.trim() ? b.hunts.trim() : null;
        if (b.range != null && !hunts) return sendJson(r.res, 400, { error: "range names what a bug hunt hunts in: it goes with hunts" });
        /** @type {string | null} */
        let rangeText = null;
        if (hunts && b.range != null && sessions?.huntRange) {
          const got = await sessions.huntRange(r.params.id, b.range, { label: `the files task ${hunts} named and changed` });
          if (!got.ok) return sendJson(r.res, 400, { error: `the range cannot be hunted in: ${got.error}` });
          rangeText = got.range ? rangeBlock(got.range, "alone") : null;
        }
        const asked = !b.prompt.trim() && row?.task ? row.task : b.prompt;
        const prompt = rangeText ? `${rangeText}\n\n${asked}` : asked;
        const reg = subagentsOn();
        /** One launch — asked where a tag is named, else the worker the body or its start names (HarnessV4_Tasks E15): the registry reads the card. @param {string} tag @param {string} [model]  the model it runs on, where the launch names one */
        const launchAs = (tag, model = typeof b.model === "string" ? b.model.trim() : "") => reg.launch({
          origin: "owner",
          chainId: r.params.id,
          prompt,
          ...(typeof b.description === "string" ? { description: b.description } : row?.task && asked === row.task ? { description: row.name } : {}),
          ...(started.start && !row?.asks ? { start: started.start } : {}),
          // One that asks its card (Catch me up) asks whoever holds that place in the session: its copy, where it names one.
          ...(tag ? { as: tag } : typeof f.worker === "string" ? (row?.asks ? { as: reg.inPlaceOf ? reg.inPlaceOf(r.params.id, f.worker) : f.worker } : { worker: f.worker }) : {}),
          ...(row?.since ? { since: row.since } : {}),
          ...(pics.images.length ? { images: pics.images } : {}),
          ...(typeof f.may === "string" ? { may: f.may } : {}),
          ...(model ? { model } : {}),
          // How hard it thinks (HarnessV4_Tasks U12-D7): the registry checks the level, and a fork refuses one.
          ...(typeof b.effort === "string" && b.effort.trim() ? { effort: b.effort.trim() } : {}),
          ...(typeof f.view === "string" ? { view: f.view } : {}),
          // A start that starts as a live copy while the cache is warm (Catch me up): where the launch names no view,
          // model or effort, the registry forks at Send if the cache is warm then.
          ...(row?.fork === "warm" && named.view === undefined && !model && !(typeof b.effort === "string" && b.effort.trim()) ? { warm: true } : {}),
          ...(typeof f.running === "boolean" ? { running: f.running } : {}),
          // A start's `null` is its word that it sees no change, never a gap the card's own fills.
          ...(typeof f.changes === "string" || f.changes === null ? { changes: f.changes } : {}),
          ...(typeof f.worktree === "boolean" ? { worktree: f.worktree } : {}),
          ...(typeof f.deliver === "boolean" ? { deliver: f.deliver } : {}),
          // A Hunter started on a graph task's Hunt bugs names that task (UX9): the registry checks its id.
          ...(hunts ? { hunts } : {}),
          pause: b.pause === true,
          inform: b.inform === true,
        });
        /**
         * Several launches at once: the refusal where they do not all fit the models' limits now, else null (AG-3).
         * `models`: those they would run on — one the chat's list does not hold lends its own room. With no limit set on
         * them, `max` is Infinity and every launch fits.
         * @param {number} n @param {string[]} models
         */
        const noRoom = (n, models) => {
          const { max, running } = reg.limit(r.params.id, "side", models);
          // More than its models ever run at once: waiting for one to finish would not help.
          if (n > max) return { error: `this chat's models run ${max} agent${max === 1 ? "" : "s"} at once, so ${n} do not fit: none was started — ask fewer`, limit: { max, running } };
          if (n > max - running)
            return {
              error: `${running} of ${max} agent${max === 1 ? " is" : "s are"} running on this chat's models, so ${n === 1 ? "one more does not fit: it was not started" : `${n} more do not fit: none was started`} — wait for one to finish${n > 1 && max > running ? ", or ask fewer" : ""}`,
              limit: { max, running },
            };
          return null;
        };
        // One saved agent asked the same thing on several models at once, each blind to the others (HarnessV4_Tasks
        // E15 step 8, AG-241): one launch per model, each on its model's seat — all start, or none does.
        if (Array.isArray(b.models)) {
          const tag = String((Array.isArray(b.as) ? (b.as.length === 1 ? b.as[0] : "") : b.as) ?? "").trim().replace(/^@/, "").toLowerCase();
          if (!tag) return sendJson(r.res, 400, { error: "`models` asks one saved agent on several models: `as` names its tag" });
          if (!a.agentCards?.find(tag)) return sendJson(r.res, 400, { error: `there is no agent \`@${tag}\` — ${agentsPage(config.get())} lists them` });
          const models = [...new Set(b.models.map((/** @type {unknown} */ m) => String(m ?? "").trim().replace(/^agent\//, "")).filter(Boolean))];
          if (models.length < 2) return sendJson(r.res, 400, { error: "`models` names fewer than two models: one model is `model`" });
          const full = noRoom(models.length, models);
          if (full) return sendJson(r.res, 409, full);
          // The count above, each model's seat and these launches are one step: nothing else of the server runs
          // between them.
          for (const model of models) {
            const seat = reg.seat(r.params.id, model);
            if (!seat.ok) return sendJson(r.res, 409, { error: `none was started — ${seat.error}` });
          }
          /** @type {any[]} */
          const begun = [];
          /** @type {{ tag: string, model: string, error: string }[]} */
          const refused = [];
          for (const model of models) {
            const one = launchAs(tag, model);
            if (one.ok) begun.push(reg.get(one.id));
            else refused.push({ tag, model, error: one.error });
          }
          if (!begun.length) return sendJson(r.res, 400, { error: refused[0].error, refused });
          return sendJson(r.res, 200, { subagents: begun, refused });
        }
        // Several saved agents asked the same thing at once, each blind to the others: all start, or none does (AG-3).
        if (Array.isArray(b.as)) {
          const tags = [...new Set(b.as.map((/** @type {unknown} */ t) => String(t ?? "").trim().replace(/^@/, "").toLowerCase()).filter(Boolean))];
          if (!tags.length) return sendJson(r.res, 400, { error: "`as` names no agent: a tag, or a list of tags" });
          const unknown = tags.filter((t) => !a.agentCards?.find(t));
          if (unknown.length) return sendJson(r.res, 400, { error: `there is no agent ${unknown.map((t) => `\`@${t}\``).join(", ")} — ${agentsPage(config.get())} lists them` });
          // Each on the launch's model, else its card's first: one that names none takes a row of the chat's list.
          const named = typeof b.model === "string" && b.model.trim() ? b.model.trim() : "";
          const full = noRoom(tags.length, tags.map((t) => named || String(a.agentCards?.find(t)?.models?.[0] || a.agentCards?.find(t)?.model || "")).filter(Boolean));
          if (full) return sendJson(r.res, 409, full);
          /** @type {any[]} */
          const begun = [];
          /** @type {{ tag: string, error: string }[]} */
          const refused = [];
          // The count above and these launches are one step: nothing else of the server runs between them, so no
          // other launch takes a seat the count gave away.
          for (const tag of tags) {
            const one = launchAs(tag);
            if (one.ok) begun.push(reg.get(one.id));
            else refused.push({ tag, error: one.error });
          }
          if (!begun.length) return sendJson(r.res, 400, { error: refused[0].error, refused });
          return sendJson(r.res, 200, { subagents: begun, refused });
        }
        const out = await launchAs(typeof b.as === "string" ? b.as.trim() : "");
        if (!out.ok) return sendJson(r.res, 400, { error: out.error });
        return sendJson(r.res, 200, { subagent: reg.get(out.id) });
      })),
    ],
    [
      "GET",
      "/sessions/:id/subagents/views",
      guard(async (r) => {
        // What goes with any of the views (HarnessV4_Tasks E13-1): the turn running now — null with none — and a change
        // as a patch, from either source; and the starts' table, so every surface reads the same one. A reader that
        // shows no change's size says so (`?changes=0`) and waits for no patch: the folder's uncommitted change is
        // read from git file by file, and a project in the middle of work holds many (`changes` is then null). The two
        // are read side by side, started before the views are composed (the slowness of 11-01: one after the other,
        // after the composes, they took seconds).
        const sized = r.url.searchParams.get("changes") !== "0";
        const besideOf = () =>
          Promise.all([
            native().contextView(r.params.id, null, { running: true, changes: sized ? "turn" : null }),
            sized ? native().contextView(r.params.id, null, { changes: "uncommitted" }) : null,
          ]);
        // A fork carries the main agent's newest request whole: its size is that request's, and it exists only while
        // a turn runs or the last one's request is kept. Its model is that request's too.
        const cache = subagents ? subagents.cacheOf(r.params.id) : null;
        const sizesOf = () => {
          const going = sizing.get(r.params.id);
          if (going) return going;
          const read = (async () => {
            /** @type {Record<string, number>} */
            const tokens = {};
            for (const [name, strategy] of Object.entries(SUBAGENT_VIEWS)) {
              const v = strategy ? await native().contextView(r.params.id, strategy) : null;
              tokens[name] = v ? estimateTokens(v.text) : 0;
            }
            // The context window as it stands, as large as it is: each reader's own window fits it at launch.
            tokens.window = estimateTokens((await native().windowView(r.params.id, { messages: subagents?.liveMessages?.(r.params.id) ?? null }))?.text || "");
            return tokens;
          })();
          sizing.set(r.params.id, read);
          read.then(
            () => sizing.delete(r.params.id),
            () => sizing.delete(r.params.id),
          );
          return read;
        };
        const [[beside, loose], sizes] = await Promise.all([besideOf(), sizesOf()]);
        // The fork's size is this read's own, beside its fork's facts below: a read that took another's sizes answers its own.
        const tokens = { ...sizes, fork: cache?.tokens || 0 };
        /** @param {any} c */
        const patchOf = (c) => ({ tokens: c?.text ? estimateTokens(c.text) : 0, files: Number(c?.files) || 0, ...(c?.note ? { note: String(c.note) } : {}) });
        return sendJson(r.res, 200, {
          chainId: r.params.id,
          tokens,
          fork: { available: !!cache?.forkable, model: cache?.model || null, state: cache?.state || "none" },
          running: beside?.running ? { run: beside.running.run, tokens: estimateTokens(beside.running.text), rounds: beside.running.rounds, calls: beside.running.tools } : null,
          changes: sized ? { turn: patchOf(beside?.changes), uncommitted: patchOf(loose?.changes) } : null,
          starts: Object.values(SUBAGENT_STARTS),
        });
      }),
    ],
    [
      "POST",
      "/sessions/:id/subagents/enhance",
      guard(async (r) => {
        const b = await r.json();
        if (!b || typeof b.prompt !== "string") return sendJson(r.res, 400, { error: "a JSON object is required: { prompt, readOnly?, view? }" });
        // The rewrite's call has no clock (HarnessV3-FailurePoints §4 A): the page that asked hanging up ends it.
        const hangUp = new AbortController();
        r.res.on("close", () => {
          if (!r.res.writableEnded) hangUp.abort();
        });
        const out = await subagentsOn().enhance({
          chainId: r.params.id,
          prompt: b.prompt,
          ...(b.readOnly === true ? { readOnly: true } : {}),
          ...(typeof b.view === "string" ? { view: b.view } : {}),
          signal: hangUp.signal,
        });
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 400, { error: out.error });
      }),
    ],
    [
      "GET",
      "/sessions/:id/subagents/:sid",
      guard((r) => {
        const reg = subagentsOn();
        reg.recall(r.params.id);
        // `card=1`: the cards' form, each asking and answer clipped as the list's were before its heads — what a card
        // shows of an answer the page's list carries as a head.
        const sa = r.url.searchParams.get("card") === "1" ? reg.get(r.params.sid) : reg.detail(r.params.sid);
        if (!sa || sa.chainId !== r.params.id) return sendJson(r.res, 404, { error: "no such sub-agent in this session" });
        return sendJson(r.res, 200, { subagent: sa });
      }),
    ],
    // How a sub-agent's exchange ended, read from its own run's log (HarnessV4_Tasks U1): for the card of the call that
    // launched one neither the registry nor its session holds any longer — a session keeps its newest — whose
    // turn never heard its end. `run`: that exchange's run, as the launching run named it (`subagent-run`). Only a
    // run of this session's sub-agent answers; `end` is null while the log shows none.
    [
      "GET",
      "/sessions/:id/subagents/:sid/end",
      guard((r) => {
        const runId = String(r.url.searchParams.get("run") || "");
        const meta = runId && runs ? runs.getRun(runId) : null;
        if (!meta || meta.kind !== "subagent" || String(meta.meta?.chain ?? "") !== r.params.id || String(meta.meta?.subagent ?? "") !== r.params.sid)
          return sendJson(r.res, 404, { error: `no run ${runId || "(none named)"} of sub-agent ${r.params.sid} in this session: the run log holds none under that id (it keeps a run for its retention days)` });
        return sendJson(r.res, 200, { run: runId, end: exchangeOfRun(eventsOf(runs, runId)) });
      }),
    ],
    // A second look's run (HarnessV4_Space_Plan S3b): answered once there is one — no clock: its launch goes on until
    // its first model call, or ends without one — with its id, whether it still runs, and, ended, its answer or why it
    // failed. The card and the sheet follow the run for its words.
    [
      "GET",
      "/sessions/:id/second-looks/:sid",
      guard(async (r) => {
        if (!secondLook) return sendJson(r.res, 503, { error: "second looks are not available in this Filament" });
        const out = await secondLook.run(r.params.id, r.params.sid);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 404, { error: out.error });
      }),
    ],
    [
      "POST",
      "/sessions/:id/second-looks/:sid/stop",
      guard((r) => {
        if (!secondLook) return sendJson(r.res, 503, { error: "second looks are not available in this Filament" });
        const out = secondLook.stop(r.params.id, r.params.sid);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 404, { error: out.error });
      }),
    ],
    // A thread deleted from the Agents tab (the owner's ask of 10-23): refused in words while it works.
    [
      "DELETE",
      "/sessions/:id/subagents/:sid",
      guard(async (r) => {
        const out = await subagentsOn().forget(r.params.sid, r.params.id);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, out.status, { error: out.error });
      }),
    ],
    [
      "POST",
      "/sessions/:id/subagents/:sid/stop",
      guard((r) => {
        const sa = subagentsOn().get(r.params.sid);
        if (!sa || sa.chainId !== r.params.id) return sendJson(r.res, 404, { error: "no such sub-agent in this session" });
        const out = subagentsOn().stop(sa.id);
        return out.ok ? sendJson(r.res, 200, { ok: true }) : sendJson(r.res, 409, { error: out.error });
      }),
    ],
    // The developer's own words to a running sub-agent, past its lead (HarnessV4_Tasks decision 10): `{ text }`, read at
    // its next step as their message, and its lead — the session's agent — told whom they told what. `told`: "turn"
    // where the lead's turn runs and reads it at its next step, "queue" where its next turn will; `asking`: the call
    // whose answer the sub-agent waits for first. Only the session's writer sends one, as only it sends the turns.
    [
      "POST",
      "/sessions/:id/subagents/:sid/message",
      guard(writes(async (r) => {
        const b = await r.json();
        if (!b || typeof b.text !== "string" || !b.text.trim()) return sendJson(r.res, 400, { error: "a JSON object is required: { text } — your words for it" });
        const sa = subagentsOn().get(r.params.sid);
        if (!sa || sa.chainId !== r.params.id) return sendJson(r.res, 404, { error: "no such sub-agent in this session" });
        const out = subagentsOn().developerMessage(sa.id, { chainId: r.params.id, text: b.text });
        return out.ok ? sendJson(r.res, 200, { ok: true, told: out.told, asking: out.asking ?? null }) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    // A team's worker's waiting call (HarnessV3-AtHome P2 step 4): the developer's answer — `allow: true`, their press of
    // Allow, runs the call; without it the words answer it "Not run" in them, whatever they say; with `modeSwitch: true`
    // the words are their permission switch, and the call is judged again under the mode now in force (AH-F1). To a
    // worker's plan its lead reviews (TG2-D50), `go: true` lets it start; without it the words are corrections. `ask`,
    // when given, is the number of the question it answers (HarnessV3-TaskGraph-v2 TG2-D42): one settled, or never
    // asked, is answered 409 with the one that waits now. A question another machine's chat asks there takes `choice`,
    // the number of one of its choices, or the words alone — never `allow`. Only the session's writer answers, as only it
    // sends the session's turns.
    [
      "POST",
      "/sessions/:id/subagents/:sid/answer",
      guard(writes(async (r) => {
        const b = await r.json();
        if (!b || typeof b.answer !== "string" || !b.answer.trim()) return sendJson(r.res, 400, { error: "a JSON object is required: { answer, allow?, go? } — allow: true runs the call, go: true lets a plan start; without them, answer says what to do instead" });
        if (b.ask != null && !(Number.isInteger(b.ask) && b.ask >= 1)) return sendJson(r.res, 400, { error: "ask is the number of the question the answer is for: a whole number from 1" });
        if (b.choice != null && typeof b.choice !== "string") return sendJson(r.res, 400, { error: "choice is the number of the question's choice, from 1, as a string" });
        const sa = subagentsOn().get(r.params.sid);
        if (!sa || sa.chainId !== r.params.id) return sendJson(r.res, 404, { error: "no such sub-agent in this session" });
        const out = subagentsOn().answer(sa.id, r.params.id, b.answer, { allow: b.allow === true, go: b.go === true, modeSwitch: b.modeSwitch === true, n: b.ask ?? null, choice: b.choice ?? null });
        return out.ok ? sendJson(r.res, 200, { ok: true, subagent: subagentsOn().get(sa.id) }) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    // The asks waiting in a chat (the remote-agents plan's f-answer): its own turn's, its coding agent's and its
    // sub-agents', each by its id (`Ask`) — what a caller that joins late answers.
    [
      "GET",
      "/sessions/:id/asks",
      guard((r) => {
        if (!memory.archive) throw new Error(`no archive: ${memory.archiveWhy()}`);
        if (!memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        return sendJson(r.res, 200, { chainId: r.params.id, asks: asksIn(r.params.id) });
      }),
    ],
    // One answer for any ask waiting in the chat, by its id (`Ask`): `{ allow?, choice?, words?, go?, outcome?, answers?,
    // reason? }`. A permission is answered by its press — `allow`, or `choice` allow | deny —, a question by one of its
    // options' ids (`choice`) or its `words`, a worker's plan by its `go` (`choice` go) or the words that correct it, a
    // coding agent's form by a choice of its one question, or whole by `outcome` and `answers` as its run's own route
    // takes them — never by matching words. The words go with the answer as said: Deny's why, the agent reads them; a
    // question of the chat's or a sub-agent's takes its choice or its words, and both are refused (400). The
    // chat's own turn's ask goes on in that turn: its reply is this answer's, as POST /sessions/:id/turns answers
    // (`stream`, `runEvents`); any other answers `{ ok, id, from }`. 404 for an id the chat never asked, 409 for one
    // answered or ended, 400 for an answer that doesn't fit it. Only the session's writer answers.
    [
      "POST",
      "/sessions/:id/asks/:ask/answer",
      guard(writes(async (r) => {
        const receivedAt = Date.now();
        const chainId = String(r.params.id || "");
        const askId = decodeURIComponent(r.params.ask);
        if (!memory.archive) throw new Error(`no archive: ${memory.archiveWhy()}`);
        if (!memory.archive.hasChain(chainId)) return sendJson(r.res, 404, { error: "no such session" });
        const b = await r.json();
        const shape = "a JSON object is required: { allow?, choice?, words?, go?, outcome?, answers?, reason? } — allow or a choice of its options' ids answers a permission, a choice or words a question";
        if (!b || typeof b !== "object" || Array.isArray(b) || (b.choice != null && typeof b.choice !== "string") || (b.words != null && typeof b.words !== "string") || (b.allow != null && typeof b.allow !== "boolean"))
          return sendJson(r.res, 400, { error: shape });
        const ask = asksIn(chainId).find((x) => x.id === askId);
        if (!ask) {
          const [status, error] = noAsk(chainId, askId);
          return sendJson(r.res, status, { error });
        }
        const choice = b.choice == null ? null : ask.options.find((o) => o.id === b.choice) || null;
        if (b.choice != null && !choice) return sendJson(r.res, 400, { error: `choice is the id of one of its options${ask.options.length ? `: ${ask.options.map((o) => o.id).join(", ")}` : ", and it has none: words answer it"}` });
        const words = String(b.words ?? "").trim();
        /** The press a permission's answer is: `allow`, else its choice; null for neither. */
        const allow = typeof b.allow === "boolean" ? b.allow : choice?.id === "allow" ? true : choice?.id === "deny" ? false : null;
        const noPress = `a permission is answered by its press: allow true or false, or choice ${PERMIT_OPTIONS.map((o) => o.id).join(" | ")}`;
        const noAnswer = `a question is answered by a choice of its options' ids${ask.options.length ? ` (${ask.options.map((o) => o.id).join(", ")})` : ""} or its words`;
        // The chat's own question, or a sub-agent's, takes its choice or its words: a choice's own words are its answer, so
        // words beside one are refused, nothing answered — never cut. A coding agent's form takes both, as its route does.
        if (ask.kind === "question" && !ask.form && choice && words)
          return sendJson(r.res, 400, { error: "a question is answered by its choice or its words, not both: a choice's own words are its answer, and words beside one would go unread" });
        // The chat's own turn's pause: the answer's turn goes on in it, its press the house's (turn.js `allowOf`).
        if (ask.from === "chat" && !ask.form) {
          if (ask.kind === "permission" && allow === null) return sendJson(r.res, 400, { error: noPress });
          const content = ask.kind === "permission" ? words || (allow ? "yes" : "no") : choice?.label || words;
          if (!content) return sendJson(r.res, 400, { error: noAnswer });
          if (isDraining()) {
            r.res.setHeader("retry-after", "5");
            return sendJson(r.res, 503, { error: "Filament is restarting; answer again in a few seconds", restarting: true });
          }
          const agents = agentsDevice(r.who);
          markSessionTurn(r.req, { reads: turnReads(r.params.id, r.who) });
          a.browsers?.drive?.(chainId, driverOf(deviceCaller(r.req, a.devices || null) ?? r.who));
          const turn = { content, ...(ask.kind === "permission" ? { allow } : {}), stream: b.stream === true, ...(b.runEvents === true ? { runEvents: true } : {}) };
          await native().turn(chainId, turn, r.req, r.res, { receivedAt, bodyAt: Date.now(), sentAt: null }, { commands: !agents });
          return;
        }
        const done = () => sendJson(r.res, 200, { ok: true, id: ask.id, from: ask.from });
        const dot = ask.id.lastIndexOf(".");
        const [head, tail] = [ask.id.slice(0, dot), ask.id.slice(dot + 1)];
        // A form's — a coding agent's question, or the card the chat's own turn waits on for a command on another machine:
        // its answer, checked against its question where the run waits on it.
        if (ask.form) {
          const f = ask.form || {};
          const one = oneQuestion(f);
          const picked = typeof b.allow === "boolean" && f.judged ? (b.allow ? "allow" : "deny") : choice?.id || "";
          /** @type {any} */
          let answer = null;
          if (typeof b.outcome === "string") answer = { outcome: b.outcome, answers: b.answers, reason: b.reason };
          else if (one && (picked || words)) answer = { outcome: "answered", answers: { [one.id]: { chosen: picked ? [picked] : [], ...(words ? { words } : {}) } } };
          else if (!one && picked && f.kind in FORM_OPTIONS) answer = { outcome: picked, ...(words ? { reason: words } : {}) };
          if (!answer) return sendJson(r.res, 400, { error: one ? (f.judged ? noPress : noAnswer) : `answer this ${f.kind === "plan" || f.kind === "link" ? f.kind : "form"} with ${f.kind in FORM_OPTIONS ? `a choice (${ask.options.map((o) => o.id).join(", ")}) or ` : ""}outcome and answers, as its form says them` });
          const out = runs.answer(head, tail, answer);
          return out.ok ? done() : sendJson(r.res, out.gone ? 409 : 400, { error: out.error });
        }
        // A sub-agent's: its call's press, its plan's go, or its question's answer — numbered, so it settles that ask alone.
        const n = Number(tail);
        const reg = subagentsOn();
        /** @type {{ ok: boolean, error?: string }} */
        let out;
        if (ask.kind === "permission") {
          if (allow === null) return sendJson(r.res, 400, { error: noPress });
          out = reg.answer(head, chainId, words || (allow ? "yes" : "no"), { allow, n });
        } else if (ask.kind === "plan") {
          const go = b.go === true || choice?.id === "go";
          if (!go && !words) return sendJson(r.res, 400, { error: "a plan is answered by its go (go: true, or choice go), or by the words that correct it" });
          out = reg.answer(head, chainId, words || "go", { go, n });
        } else {
          const said = choice?.label || words;
          if (!said) return sendJson(r.res, 400, { error: noAnswer });
          out = reg.answer(head, chainId, said, { n, ...(choice ? { choice: choice.id } : {}) });
        }
        return out.ok ? done() : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    // Detach (BUG-12): free the main agent from a foreground sub-agent — `{ report: true }` (the default) and its report
    // arrives as a message when it finishes; `{ report: false }` and it stays the developer's to send on.
    [
      "POST",
      "/sessions/:id/subagents/:sid/detach",
      guard(writes(async (r) => {
        const b = (await r.json()) || {};
        const sa = subagentsOn().get(r.params.sid);
        if (!sa || sa.chainId !== r.params.id) return sendJson(r.res, 404, { error: "no such sub-agent in this session" });
        const out = subagentsOn().detach(sa.id, { report: b.report !== false });
        return out.ok ? sendJson(r.res, 200, { ok: true, subagent: subagentsOn().get(sa.id) }) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    [
      "POST",
      "/sessions/:id/subagents/:sid/follow-up",
      guard(writes(async (r) => {
        const b = await r.json();
        if (!b || typeof b.prompt !== "string") return sendJson(r.res, 400, { error: "a JSON object is required: { prompt, changes?, again? }" });
        // `again`: Retry on a thread that failed — its question asked again in the same thread (the owner's word of 10-24).
        const out = subagentsOn().followUp(r.params.sid, { prompt: b.prompt, chainId: r.params.id, by: "owner", ...(typeof b.changes === "string" ? { changes: b.changes } : {}), ...(b.again === true ? { again: true } : {}) });
        if (!out.ok) return sendJson(r.res, 400, { error: out.error });
        return sendJson(r.res, 200, { subagent: subagentsOn().get(out.id) });
      })),
    ],
    [
      "POST",
      "/sessions/:id/subagents/:sid/send",
      guard(writes(async (r) => {
        const b = (await r.json()) || {};
        // `when`: "now" (the running turn's next step, else the next turn) or "next" (with your next message, which
        // a turn running now does not read by itself).
        const when = b.when ?? "now";
        if (when !== "now" && when !== "next") return sendJson(r.res, 400, { error: 'when is "now" or "next"' });
        const out = subagentsOn().send(r.params.sid, r.params.id, Number.isInteger(b.exchange) ? b.exchange : -1, { when });
        if (!out.ok) return sendJson(r.res, 409, { error: out.error });
        return sendJson(r.res, 200, { ok: true, into: out.into, subagent: subagentsOn().get(r.params.sid) });
      })),
    ],
    // The developer's own send-back of a failed graph task (HarnessV4_Tasks U1), or their start of one they stopped
    // ("Start again", HarnessV4_Tasks B4): its last worker goes on
    // with it, in its own conversation — or, `{ fresh: true }`, "Start fresh": a new one takes it. It is the planner's
    // `tasks start`, made from the page: the planner is told, and the work starts while a turn runs — `waits` says why
    // it has not ("held", "off", "turn", "slot"), `resumes` the worker that goes on (null: a new one takes it),
    // `again` that it was a stopped one. Only the session's writer sends one back.
    [
      "POST",
      "/sessions/:id/graph/tasks/:task/start",
      guard(writes(async (r) => {
        if (!graphs) return sendJson(r.res, 503, { error: "the task graph is not wired in this Filament" });
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const b = (await r.json()) || {};
        const out = graphs.sendBack(r.params.id, String(r.params.task || "").toLowerCase(), { fresh: b.fresh === true });
        return out.ok ? sendJson(r.res, 200, { ok: true, text: out.text, waits: out.waits, resumes: out.resumes, again: out.again, graph: out.view }) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    // The developer's side run (the Designer's of 10-27, built 10-28). GET: what the Plan page's sheet and the
    // side-by-side card say as they open — the chat's room (how many run; no number of its own), whether its turn is open —
    // it runs, or waits on a question it paused on — (Start now or when it ends), whether
    // its folder is a git repository (outside one a sub-agent works in the folder: no copy), whether its editing
    // sub-agents work in their own copies by default, and how long the repository's newest copy took to check out
    // (`checkoutMs`, null where none is known). POST `{ tasks: [{ id, model, effort?, folder: "copy" | "yours", goal?,
    // steps?, acceptance? }], starts: "now" | "turn", offer?: <the card's at> }`: the tasks go to sub-agents of their own — all or none, refused
    // 409 in words — the graph claims them and the planner is told; `started` the tasks launched now, `later` that they
    // wait for its turn's end. Only the session's writer runs one.
    [
      "GET",
      "/sessions/:id/graph/side-run",
      guard(async (r) => {
        if (!graphs) return sendJson(r.res, 503, { error: "the task graph is not wired in this Filament" });
        const reg = subagentsOn();
        const room = reg.room(r.params.id);
        const git = room.cwd ? await repoOf(room.cwd).catch(() => ({ repo: null })) : { repo: null };
        const took = git.repo ? await lastCheckout(git.repo).catch(() => null) : null;
        // `now`: the server's clock, which a card on another machine's page counts the deadline down by.
        return sendJson(r.res, 200, { running: room.running, turn: reg.turnOpen(r.params.id), repo: !!git.repo, worktree: room.worktree, checkoutMs: took ? took.ms : null, now: Date.now() });
      }),
    ],
    // The developer's Ignore of the side-by-side card (Phase 5): `{ at }` names the card; it goes, and its tasks are not
    // offered again by themselves. One gone already is refused 409 in words. Only the session's writer answers it.
    [
      "POST",
      "/sessions/:id/graph/side-offer/ignore",
      guard(writes(async (r) => {
        if (!graphs) return sendJson(r.res, 503, { error: "the task graph is not wired in this Filament" });
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const b = (await r.json()) || {};
        if (!Number.isFinite(b.at)) return sendJson(r.res, 400, { error: "a JSON object is required: { at }, the card's" });
        const out = graphs.ignoreOffer(r.params.id, Number(b.at));
        return out.ok ? sendJson(r.res, 200, { ok: true, graph: out.view }) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    [
      "POST",
      "/sessions/:id/graph/side-run",
      guard(writes(async (r) => {
        if (!graphs) return sendJson(r.res, 503, { error: "the task graph is not wired in this Filament" });
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const b = (await r.json()) || {};
        const starts = b.starts === "turn" ? "turn" : b.starts === "now" || b.starts == null ? "now" : null;
        if (!starts) return sendJson(r.res, 400, { error: 'starts is "now" or "turn"' });
        if (!Array.isArray(b.tasks) || !b.tasks.length) return sendJson(r.res, 400, { error: "a JSON object is required: { tasks: [{ id, model, folder }], starts }" });
        /** @type {import("../../core/task-graph.js").SidePick[]} */
        const picks = b.tasks.map((/** @type {any} */ x) => ({
          id: String(x?.id ?? "").toLowerCase(),
          model: typeof x?.model === "string" ? x.model.trim() : "",
          ...(typeof x?.effort === "string" && x.effort.trim() ? { effort: x.effort.trim().toLowerCase() } : {}),
          folder: x?.folder === "yours" ? "yours" : "copy",
          ...(typeof x?.goal === "string" ? { goal: x.goal } : {}),
          ...(Array.isArray(x?.steps) ? { steps: x.steps.map((/** @type {unknown} */ s) => String(s ?? "")) } : {}),
          ...(typeof x?.acceptance === "string" ? { acceptance: x.acceptance } : {}),
        }));
        // The side-by-side card's Accept names its card (`offer`, its `at`): it starts nothing once that card is gone.
        if (b.offer !== undefined && !Number.isFinite(b.offer)) return sendJson(r.res, 400, { error: "offer names the card by its at, a number" });
        const out = graphs.sideRun(r.params.id, picks, { starts, ...(b.offer !== undefined ? { card: Number(b.offer) } : {}) });
        return out.ok ? sendJson(r.res, 200, { ok: true, started: out.started, later: out.later, refused: out.refused, graph: out.view }) : sendJson(r.res, 409, { error: out.error, ...(out.gone ? { gone: true } : {}) });
      })),
    ],
    // The card for sub-agents that change files, while Parallelize tasks is off (app/agent/held-launch.js, the owner's of
    // 11-14): GET the chat's cards — the one waiting and the newest answered —; POST `{ answer: "accept" | "decline" |
    // "always" }` to one: Accept starts what it holds, decline (One at a time) keeps the work with the agent, always
    // (Always accept in this chat, the owner's of 11-16) accepts it and switches the chat's own Parallelize tasks on
    // (`subagents.parallelize`), so no card asks in it again — a press, as that switch written is. One answered already
    // is refused 409 in words, and switches nothing. Only the session's writer answers it.
    [
      "GET",
      "/sessions/:id/held-launches",
      guard(async (r) => sendJson(r.res, 200, { holds: subagentsOn().held(r.params.id) })),
    ],
    [
      "POST",
      "/sessions/:id/held-launches/:hold",
      guard(writes(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const b = (await r.json()) || {};
        if (b.answer !== "accept" && b.answer !== "decline" && b.answer !== "always") return sendJson(r.res, 400, { error: 'a JSON object is required: { answer: "accept" | "decline" | "always" }' });
        // Always: the chat's switch is written before the card is answered — its launches take a while to start, and a
        // launch its agent makes meanwhile, or a task its graph lets go, starts with no card (the review of the change).
        // A card no longer waiting switches nothing; the switch not written answers nothing.
        if (b.answer === "always") {
          const card = subagentsOn().held(r.params.id).find((/** @type {any} */ h) => h?.id === String(r.params.hold));
          if (!card || card.state !== "waiting") return sendJson(r.res, 409, { error: card ? `the card was answered already (${card.state === "accepted" ? "accepted" : "kept with the agent"})` : "no such card in this chat" });
          try {
            native().patchSettings(r.params.id, { patch: { subagents: { parallelize: true } } }, { via: "the card's Always accept in this chat" });
          } catch (e) {
            return sendJson(r.res, 409, { error: `Parallelize tasks could not be switched on for this chat: ${/** @type {any} */ (e)?.message || e}` });
          }
        }
        const out = await subagentsOn().answerHeld(r.params.id, String(r.params.hold), b.answer);
        if (!out.ok) return sendJson(r.res, 409, { error: out.error });
        return sendJson(r.res, 200, { ok: true, hold: out.hold });
      })),
    ],
    // What the planner kept behind a task of the session's graph — `?task=` its id, none for the graph itself
    // (HarnessV4_TaskNotes_Plan E33, case 15): its notes and files, a line each; with `note=` a note whole; with `file=` a
    // file's bytes — an image as one, any other kind as text or a download, never run on this page's address.
    [
      "GET",
      "/sessions/:id/graph/kept",
      guard((r) => {
        const notes = a.taskNotes || null;
        if (!notes?.on) return sendJson(r.res, 503, { error: "this Filament keeps no notes behind its tasks" });
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const graph = graphs?.get(r.params.id) || null;
        if (!graph) return sendJson(r.res, 404, { error: "this session has no task graph" });
        const q = r.url.searchParams;
        const task = String(q.get("task") || "").toLowerCase() || null;
        if (task && !graph.tasks.some((/** @type {any} */ t) => t.id === task)) return sendJson(r.res, 404, { error: `${task} is no task in the graph` });
        if (q.has("note")) {
          const n = notes.note(r.params.id, graph.startedAt, task, String(q.get("note") || ""));
          return n ? sendJson(r.res, 200, { note: n }) : sendJson(r.res, 404, { error: "no note of that title is kept there" });
        }
        if (q.has("file")) {
          const f = notes.file(r.params.id, graph.startedAt, task, String(q.get("file") || ""));
          if (!f) return sendJson(r.res, 404, { error: "no file of that name is kept there" });
          const data = readFileSync(f.path);
          const image = imageTypeOf(data);
          const text = !image && !data.subarray(0, 8192).includes(0);
          r.res.writeHead(200, {
            "content-type": image || (text ? "text/plain; charset=utf-8" : "application/octet-stream"),
            "content-length": data.length,
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox",
            "cache-control": "no-store",
            ...(image || text ? {} : { "content-disposition": `attachment; filename="${f.name.replace(/["\\]/g, "_")}"` }),
          });
          return r.res.end(data);
        }
        return sendJson(r.res, 200, { task, ...notes.list(r.params.id, graph.startedAt, task) });
      }),
    ],
    // A writing sub-agent's own worktree (§15 item 88): what waits to be applied, as files and a diff, and the apply
    // itself — all or nothing (409 names the files that would not come through). Both work from the repository's
    // refs after a restart too, once the registry has forgotten the sub-agent.
    [
      "GET",
      "/sessions/:id/subagents/:sid/changes",
      guard(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const out = await subagentsOn().changes(r.params.sid, r.params.id);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 404, { error: out.error });
      }),
    ],
    [
      "POST",
      "/sessions/:id/subagents/:sid/apply",
      guard(writes(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        // `choices`: the developer's, by path, for the files that overlapped theirs (the Designer's of 10-27).
        const b = await r.json();
        const out = await subagentsOn().apply(r.params.sid, r.params.id, "owner", { choices: choicesOf(b?.choices) });
        if (!out.ok) return sendJson(r.res, 409, { error: out.error, ...(out.conflicts ? { conflicts: out.conflicts } : {}), ...(out.stuck ? { partial: true, stuck: out.stuck } : {}) });
        return sendJson(r.res, 200, { ok: true, files: out.files, came: out.came || [], subagent: subagentsOn().get(r.params.sid) });
      })),
    ],
    // Mark as applied (10-29): its change is in the folder already, brought in by hand — nothing is written, and nothing
    // of it waits after; DELETE undoes the mark, its work waiting again as it did. 409 says why not, in words.
    [
      "POST",
      "/sessions/:id/subagents/:sid/mark-applied",
      guard(writes(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const out = await subagentsOn().markTaken(r.params.sid, r.params.id, "owner");
        if (!out.ok) return sendJson(r.res, 409, { error: out.error });
        return sendJson(r.res, 200, { ok: true, files: out.files, subagent: subagentsOn().get(r.params.sid) });
      })),
    ],
    [
      "DELETE",
      "/sessions/:id/subagents/:sid/mark-applied",
      guard(writes(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const out = await subagentsOn().unmarkTaken(r.params.sid, r.params.id);
        if (!out.ok) return sendJson(r.res, 409, { error: out.error });
        return sendJson(r.res, 200, { ok: true, files: out.files, subagent: subagentsOn().get(r.params.sid) });
      })),
    ],
    // What Apply would do now, nothing written (the Designer's of 10-27): how each file would come in, and the files
    // that would stop it — the effect line said before the press; `?choices=` (JSON, by path) the developer's so far.
    [
      "GET",
      "/sessions/:id/subagents/:sid/apply-preview",
      guard(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        let raw = null;
        try {
          raw = JSON.parse(r.url.searchParams.get("choices") || "null");
        } catch {
          return sendJson(r.res, 400, { error: "choices must be JSON: { path: \"yours\" | \"its\" | \"both\" }" });
        }
        const out = await subagentsOn().preview(r.params.sid, r.params.id, { choices: choicesOf(raw) });
        if (!out.ok) return sendJson(r.res, 409, { error: out.error });
        return sendJson(r.res, 200, out);
      }),
    ],
    // One file that stops an apply, as Compare shows it (the Designer's of 10-27): each overlap's lines, yours over its.
    [
      "GET",
      "/sessions/:id/subagents/:sid/apply-compare",
      guard(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const path = String(r.url.searchParams.get("path") || "");
        if (!path) return sendJson(r.res, 400, { error: "a file is required: ?path=" });
        const out = await subagentsOn().compare(r.params.sid, r.params.id, path);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 409, { error: out.error });
      }),
    ],
    // Send back to rebase (the Designer's of 10-27): its change redone on the folder as it is now, the overlaps marked,
    // and it goes on to resolve them — its work then waits again.
    [
      "POST",
      "/sessions/:id/subagents/:sid/rebase",
      guard(writes(async (r) => {
        if (memory.archive && !memory.archive.hasChain(r.params.id)) return sendJson(r.res, 404, { error: "no such session" });
        const out = await subagentsOn().rebase(r.params.sid, r.params.id);
        if (!out.ok) return sendJson(r.res, 409, { error: out.error });
        return sendJson(r.res, 200, { ...out, subagent: subagentsOn().get(r.params.sid) });
      })),
    ],
    // An edit or write call's change in an agent's thread, as the call made it (the transcript audit, 2026-10-23): its
    // card's diff, for a run that keeps no snapshot of its rounds — as a turn's card reads its own (E22).
    [
      "GET",
      "/sessions/:id/subagents/:sid/calls/:call/change",
      guard((r) => {
        const out = subagentsOn().callChange(r.params.sid, r.params.id, idOf(r, "call"));
        return out.ok ? sendJson(r.res, 200, out.change) : sendJson(r.res, 404, { error: out.error, why: out.why });
      }),
    ],
    [
      "GET",
      "/sessions/:id/transcript",
      guard((r) => {
        const q = r.url.searchParams;
        const since = q.has("since") ? Number(q.get("since")) : null;
        const limit = q.has("limit") ? Number(q.get("limit")) : null;
        const work = q.get("work") === "held" ? "held" : q.get("work") !== "0";
        // `written`: the version of the turns the page holds — it is sent the turns written since (`transcript`).
        const t = native().transcript(r.params.id, { since, limit, work, written: q.get("written") || null });
        // The artifacts its agent published, by call (HarnessV4_Artifacts_Plan AF-D38): each card after its words; and
        // its helpers', by helper and exchange, for the cards that launched or asked them (AFC-100). The store's list
        // reads every artifact's record off the disk: both read it once.
        const listed = artifacts ? artifacts.list() : [];
        const store = artifacts ? { ...artifacts, list: () => listed } : artifacts;
        const made = madeIn(store, t.chainId);
        const helpers = helpersMade(store, t.chainId);
        return sendJson(r.res, 200, { ...t, ...(made.length ? { artifacts: made } : {}), ...(helpers.length ? { helpersMade: helpers } : {}) });
      }),
    ],
    [
      "GET",
      "/sessions/:id/turns/:n/work",
      guard((r) => sendJson(r.res, 200, native().turnWork(r.params.id, Number(r.params.n), { from: Number(r.url.searchParams.get("from")) || 0 }))),
    ],
    // An edit or write call's change as the call made it, for a card git's snapshot holds nothing for
    // (HarnessV4_Four_Plan E22).
    ["GET", "/sessions/:id/turns/:n/calls/:call/change", guard((r) => sendJson(r.res, 200, native().callChange(r.params.id, Number(r.params.n), idOf(r, "call"))))],
    // A call's result whole, for a card whose transcript carried its head alone: read as the card opens, let go of as it
    // closes (the owner's of 11-15).
    ["GET", "/sessions/:id/turns/:n/calls/:call/result", guard((r) => sendJson(r.res, 200, native().callResult(r.params.id, Number(r.params.n), idOf(r, "call"))))],
    // One visual the agent drew in a turn, whole (HarnessV4_Visuals_Plan E16, VS-D9); one a helper no turn launched
    // drew, kept on its session (VS-D48).
    ["GET", "/sessions/:id/turns/:n/visuals/:vid", guard((r) => sendJson(r.res, 200, native().turnVisual(r.params.id, Number(r.params.n), idOf(r, "vid"))))],
    ["GET", "/sessions/:id/visuals/:vid", guard((r) => sendJson(r.res, 200, native().sessionVisual(r.params.id, idOf(r, "vid"))))],
    [
      "GET",
      "/sessions/:id/settings",
      guard((r) => sendJson(r.res, 200, native().settingsOf(r.params.id))),
    ],
    [
      "PATCH",
      "/sessions/:id/settings",
      guard(writes(async (r) => {
        const change = changeOf(await r.json());
        if (!change) return sendJson(r.res, 400, { error: "a JSON object is required: { patch?: { <section>: {…} }, unset?: [\"<path>\"] }" });
        return sendJson(r.res, 200, native().patchSettings(r.params.id, change));
      })),
    ],
    [
      "PUT",
      "/sessions/:id/window",
      guard(writes(async (r) => {
        const b = await r.json();
        if (!b || typeof b !== "object" || !("tokens" in b) || (b.tokens !== null && typeof b.tokens !== "number"))
          return sendJson(r.res, 400, { error: "a JSON object is required: { tokens: <the model's window in tokens> | null }" });
        return sendJson(r.res, 200, native().setWindow(r.params.id, { tokens: b.tokens }));
      })),
    ],
    [
      "POST",
      "/sessions/:id/rules/forget",
      guard(writes(async (r) => {
        const b = await r.json();
        if (!b || typeof b !== "object" || typeof b.tool !== "string" || typeof b.pattern !== "string")
          return sendJson(r.res, 400, { error: "a JSON object is required: { tool, pattern, verdict?, from? } — a row of the session's rulesInForce" });
        // The permission switch's Forget (HarnessV3-AtHome AH-D7): a remembered permission is dismissed and kept, a
        // written rule leaves its layer; the gate asks again.
        return sendJson(r.res, 200, await native().forgetRule(r.params.id, { tool: b.tool, pattern: b.pattern, verdict: b.verdict ?? null, from: b.from ?? null }));
      })),
    ],
    [
      "POST",
      "/sessions/:id/rules/always",
      guard(writes(async (r) => {
        const b = await r.json();
        // Always allow in this chat (d-allow): the commands the question offered to keep (`keeps`) run without asking in
        // this chat from now on. The same press as the project's, so the same row: each command is read again there.
        if (b && typeof b === "object" && "keeps" in b) return sendJson(r.res, 200, native().alwaysAllowInChat(r.params.id, b.keeps));
        if (!b || typeof b !== "object" || typeof b.tool !== "string" || typeof b.shape !== "string")
          return sendJson(r.res, 400, { error: "a JSON object is required: { tool, shape } — the always-allow a call's question offers — or { keeps }, what it offers to always allow in this chat" });
        // Always allow in this project, chosen where the agent asks (HarnessV4_Tasks E3): that shape runs without asking
        // in the chat's project from now on, and the permission switch lists it with its Forget.
        return sendJson(r.res, 200, await native().alwaysAllow(r.params.id, { tool: b.tool, shape: b.shape }));
      })),
    ],
    [
      "POST",
      "/sessions/:id/agent-tasks/:task/stop",
      // One task the chat's coding agent runs beside its work, stopped alone (HarnessV4_Tasks E6): a sub-agent its agent
      // lets Filament cancel. 409 with why where it does not.
      guard(writes(async (r) => sendJson(r.res, 200, native().stopAgentTask(r.params.id, r.params.task)))),
    ],
    [
      "GET",
      "/sessions/:id/commands",
      // The chat's commands that run in the background, each with its newest line (HarnessV4_Background_Plan E38-D4):
      // what the open status popover reads every 2 s.
      guard((r) => sendJson(r.res, 200, { commands: commandsOf(r.params.id) })),
    ],
    [
      "POST",
      "/sessions/:id/commands/:cmd/stop",
      // The person's Stop on one of them (E38-D3): stopped with what it started, its agent told with its next turn.
      // 409 with why where the chat has no such command running.
      guard(writes(async (r) => {
        const out = await stopByPerson(r.params.id, r.params.cmd);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    [
      "POST",
      "/sessions/:id/come-back/cancel",
      // The person's Cancel on the come-back its agent set (agent/come-back.js; the Designer's of 10-27): dropped, its
      // agent told with its next turn, never woken for it; the answer names the one cancelled. 409 with why where the
      // chat has none set.
      guard(writes((r) => {
        const out = cancelByPerson(r.params.id);
        return out.ok ? sendJson(r.res, 200, out) : sendJson(r.res, 409, { error: out.error });
      })),
    ],
    [
      "GET",
      "/sessions/:id/settings/history",
      guard((r) => sendJson(r.res, 200, native().settingsHistory(r.params.id, { limit: Math.min(500, Math.max(1, Number(r.url.searchParams.get("limit")) || 100)) }))),
    ],
    [
      "GET",
      "/sessions/:id/compose",
      guard(async (r) => {
        // Dry only: the preview never sends, writes or summarises (§8.1). `form=a,b` names the carry forms weighed.
        if (r.url.searchParams.get("dry") === "0") return sendJson(r.res, 400, { error: "the compose row is a dry run; use POST /sessions/:id/turns to send" });
        const forms = String(r.url.searchParams.get("form") || "").split(",").map((s) => s.trim()).filter(Boolean);
        // `prompt=1` is the dry-run turn: the composed request itself, with `text` as the draft the developer would send.
        const prompt = r.url.searchParams.get("prompt") === "1";
        // `compaction=1` adds the compactor's plan: every way of making room, weighed (HarnessV3-Compaction §6).
        // `onceModel` weighs it as that side model, chosen for one compaction, would make it.
        const compaction = r.url.searchParams.get("compaction") === "1";
        const q = (/** @type {string} */ k) => (r.url.searchParams.has(k) ? r.url.searchParams.get(k) : null);
        const once = q("onceModel") != null ? { model: q("onceModel") } : null;
        return sendJson(r.res, 200, await native().preview(r.params.id, { forms, prompt, compaction, once, text: String(r.url.searchParams.get("text") || "").slice(0, 20000) }));
      }),
    ],
    [
      "POST",
      "/sessions/:id/turns",
      guard(writes(async (r) => {
        // A stop under way takes no new turn (system.js's /shutdown): one started now would be cut as Filament exits.
        if (isDraining()) {
          r.res.setHeader("retry-after", "5");
          return sendJson(r.res, 503, { error: "Filament is restarting; send again in a few seconds", restarting: true });
        }
        // When the turn reached the route, and when the page says it sent it (BUG-19, F3 item 17): the record's timing.
        const receivedAt = Date.now();
        const b = await r.json();
        if (!b || typeof b !== "object") return sendJson(r.res, 400, { error: "a JSON object is required: { content, stream?, permissions?, allow?, modeSwitch?, settingsPatch?, load?, runEvents?, sendAsIs?, unattended?, overrules?, carry?, by?, resume?, wake?, byFilament?, thread?, watch?, works?, sendId? }" });
        const sentAt = Number(r.req.headers["x-filament-sent-at"]);
        // The admin gate let its caller in, so the pipeline asks it for no inbound key: a page on another machine sends
        // its turn with its session alone, and the keys never leave this one (the owner's remote Filament of 11-06).
        // Another machine's agents read their own chats alone, and send no Filament chat command (the remote-agents
        // plan's f-fence); under Full control (devices.js `fullControl`) memory's tools reach the person's chats too.
        const agents = agentsDevice(r.who);
        // Who begins the turn (core/turn-by.js), read as the service reads it: what follows must know before it does.
        const begun = turnBy(b);
        if ("error" in begun) return sendJson(r.res, 400, { error: begun.error });
        const who = TURN_BY[begun.by];
        // Filament's own turn — a command's end or a come-back that wakes the chat, a goal's next round, a restart's resume,
        // a sync, a team's result, a flow's line, a watcher's wake, any — starts in another machine's agents' chat only
        // while their device lets them in. A refusal is final to the waker.
        if (!who.person && agentsLetGo(r.params.id))
          return sendJson(r.res, 403, { error: "another machine's agents started this chat, and their device lets them in no more: Filament starts no turn of its own here", wake: "let go" });
        markSessionTurn(r.req, { reads: turnReads(r.params.id, r.who) });
        // The chat's browser is in the app of whoever drives it (browser.js `driverOf`): the caller of its newest message of
        // the person's own — none of Filament's, which this computer sends whoever drives.
        if (who.person) a.browsers?.drive?.(r.params.id, driverOf(deviceCaller(r.req, a.devices || null) ?? r.who));
        // A program on this computer without the desktop app's key presses nothing (guards.js `pressRefusal`; a turn whose
        // body is a press was refused at the gate): its words answer the call the chat waits on as Deny's do, /allow among them.
        // A question's answer is its words alone, so they answer none (the xd-key hunt's): refused, and the question waits on.
        const unpressed = pressRefused(r.req);
        if (unpressed && questionWaits(String(r.params.id))) return sendJson(r.res, 403, { error: unpressed, press: true });
        const input = unpressed ? { ...b, allow: false } : b;
        // The reply itself goes to the socket in `/v1/messages` shape; nothing is sent here after the pipeline ran.
        await native().turn(r.params.id, input, r.req, r.res, { receivedAt, bodyAt: Date.now(), sentAt: sentAt > 0 ? sentAt : null }, { commands: !agents, unpressed });
      })),
    ],
    [
      // A turn a coding agent began by itself (HarnessV3-ACP AC3-9): Filament asks for it when Claude goes on by itself
      // on the session a harness chat holds — house calls only. `{ upstream, sessionId, model, tasks? }`; the reply is
      // a turn's, and 409 `{ busy: true }` while another runs.
      "POST",
      "/sessions/:id/own-turns",
      guard(async (r) => {
        if (!isHouseCall(lowerHeaders(r.req.headers))) return sendJson(r.res, 403, { error: "a coding agent's own turn is asked for by Filament alone" });
        const b = await r.json();
        if (!b || typeof b !== "object") return sendJson(r.res, 400, { error: "a JSON object is required: { upstream, sessionId, model, tasks? }" });
        await native().ownTurn(r.params.id, b, r.req, r.res);
      }),
    ],
    [
      // The session a harness tab shows (decision 22): `{ chainId: string | null, take?: boolean, peek?: boolean }`, the
      // tab in `x-filament-tab`. The tab writes the session when no open tab does, or when it takes it over; else it
      // follows. `peek` asks who writes it and takes it in neither case. Showing another session, or none, lets the one it
      // wrote go. The answer says which, and where each tab is: `{ chainId, writer, you, where, here }`.
      "PUT",
      "/tabs/open",
      guard(async (r) => {
        const b = (await r.json()) || {};
        const tab = tabOf(r.req);
        if (!tab) return sendJson(r.res, 400, { error: "x-filament-tab is required: the tab that shows the session" });
        if (!sessionWriters) return sendJson(r.res, 200, { chainId: b.chainId ?? null, writer: tab, you: true, where: null, here: null });
        return sendJson(r.res, 200, sessionWriters.open(tab, typeof b.chainId === "string" && b.chainId ? b.chainId : null, { take: b.take === true, peek: b.peek === true }));
      }),
    ],
    [
      "POST",
      "/sessions/:id/compact",
      // `onceTurnEnds: true` is Stop and compact's second half (HarnessV4_Tasks U2): the session's running turn is
      // waited for, with no clock, and the session compacted once it has ended. The page that asked hanging up ends
      // the wait.
      guard(writes(async (r) => {
        const b = (await r.json()) || {};
        const hangUp = new AbortController();
        r.res.on("close", () => {
          if (!r.res.writableEnded) hangUp.abort();
        });
        // `once`: the writer chosen for this compaction alone — the same model or the side model, which `model` may name
        // (the card that asks before a message).
        const once = b.once && typeof b.once === "object" ? { model: b.once.model ?? null, writer: b.once.writer ?? null } : null;
        // `by: "last"`: the model that answered the chat's last turn writes it, where another has been picked since (a
        // switch's handoff while its cache is warm).
        // `sending`: the person's message goes once room is made (Compact and send): no wake runs ahead of it.
        return sendJson(r.res, 200, await native().compact(r.params.id, { method: b.method ?? null, way: b.way ?? null, once, onceTurnEnds: b.onceTurnEnds === true, signal: hangUp.signal, by: b.by === "last" ? "last" : null, sending: b.sending === true }));
      })),
    ],
    [
      "POST",
      "/sessions/:id/compact/stop",
      // The stop of a compaction written outside a turn (HarnessV4_Tasks U3-5): the Compact that asked for it answers
      // that it was stopped, and nothing is written. One a turn writes is refused: it stops with its turn.
      guard(writes(async (r) => sendJson(r.res, 200, native().stopCompaction(r.params.id)))),
    ],
    [
      "POST",
      "/sessions/:id/compactions/:cid/undo",
      guard(writes(async (r) => sendJson(r.res, 200, await native().undoCompaction(r.params.id, r.params.cid)))),
    ],
    // Rewind in place (app/sessions/rewind.js): `GET ?turn=N` says what a rewind to before the person's message of turn
    // N would do — the turns that leave the conversation, each file that goes back and how, and a question that waits
    // (`asking`, the turn that asked) — nothing moved; `POST`
    // `{ turn, what: "both" | "conversation" | "files" }` does it; `POST …/rewind/undo` takes back the one that stands,
    // until the next message.
    [
      "GET",
      "/sessions/:id/rewind",
      guard(async (r) => sendJson(r.res, 200, await native().rewindPreview(r.params.id, r.url.searchParams.get("turn") ?? ""))),
    ],
    [
      "POST",
      "/sessions/:id/rewind",
      guard(writes(async (r) => {
        const b = (await r.json()) || {};
        return sendJson(r.res, 200, await native().rewindTo(r.params.id, { turn: b.turn, what: b.what ?? "both" }));
      })),
    ],
    [
      "POST",
      "/sessions/:id/rewind/undo",
      guard(writes(async (r) => sendJson(r.res, 200, await native().undoRewind(r.params.id)))),
    ],
    [
      "POST",
      "/sessions/:id/autofit",
      guard(async (r) => {
        const b = (await r.json()) || {};
        // Its status is a read; only the fit itself writes the session (decision 22).
        const run = () => native().autofit(r.params.id, { margin: b.margin, status: b.status === true }).then((out) => sendJson(r.res, 200, out));
        return b.status === true ? run() : writes(run)(r, null);
      }),
    ],
    [
      "POST",
      "/sessions/:id/fork",
      guard(async (r) => {
        const b = (await r.json()) || {};
        return sendJson(r.res, 200, await native().fork(r.params.id, { atTurn: b.atTurn, worktree: b.worktree ?? false, strategy: b.strategy ?? null, results: b.results ?? null, settings: b.settings ?? null, plan: b.plan === true }));
      }),
    ],
    [
      // Where the chat would move and what would go with it, read now (HarnessV4_Git_Plan GW-D84): `?place=` a place of
      // its repository, else `?name=` a new worktree's (`made=1`: a name the page made, which gives way to a free one).
      // Not the archive's move (`/memory/sessions/:id/move`), which files a chat under another project.
      "GET",
      "/sessions/:id/move",
      guard(async (r) => {
        const q = r.url.searchParams;
        return sendJson(r.res, 200, await native().moveRead(r.params.id, moveTo(q.get("place") ? { place: q.get("place") } : { name: q.get("name"), made: q.get("made") === "1" })));
      }),
    ],
    [
      // Move the chat (GW-D71): `{ to: { place } | { name, made?, copy? }, files? }` — `files`, the paths the sheet
      // showed going: a list that changed since is refused with the new read; `copy`, what the new worktree gets a copy
      // of (HarnessV4_Four_Plan FOC-67).
      "POST",
      "/sessions/:id/move",
      guard(writes(async (r) => {
        const b = (await r.json()) || {};
        const files = Array.isArray(b.files) ? b.files.map(String) : null;
        return sendJson(r.res, 200, await native().move(r.params.id, { to: moveTo(b.to), files }));
      })),
    ],
    [
      // Take the chat's newest move back (GW-D79): `{ id }`.
      "POST",
      "/sessions/:id/move/back",
      guard(writes(async (r) => {
        const b = (await r.json()) || {};
        return sendJson(r.res, 200, await native().moveBack(r.params.id, String(b.id || "")));
      })),
    ],
    [
      // Replay-compare (HarnessV2 §10.6): the copy is made and the run opened before the answer; the turns replay behind
      // it, one `replay-turn` event each, the table on `run-end`.
      "POST",
      "/sessions/:id/replay-compare",
      guard(async (r) => {
        const b = (await r.json()) || {};
        if (!replayCompare) throw new Error("no archive: replay-compare is not wired");
        try {
          return sendJson(r.res, 202, await replayCompare.start(r.params.id, { settings: b.settings ?? null, defaults: b.defaults === true, turns: b.turns ?? 3, strategy: b.strategy ?? null }));
        } catch (/** @type {any} */ e) {
          if (e?.status) return sendJson(r.res, e.status, { error: e.message, ...(e.detail ? { detail: e.detail } : {}) });
          throw e;
        }
      }),
    ],
    [
      "POST",
      "/sessions/:id/recall",
      guard(async (r) => {
        const b = await r.json();
        if (!b || typeof b !== "object") return sendJson(r.res, 400, { error: "a JSON object is required: { turn } or { result: \"r:<hash8>\" }" });
        return sendJson(r.res, 200, native().recallFor(r.params.id, b));
      }),
    ],
    [
      "GET",
      "/sessions/:id/instructions",
      guard((r) => sendJson(r.res, 200, native().instructionsFor(r.params.id))),
    ],
    [
      "POST",
      "/sessions/draft-start",
      guard(async (r) => {
        const b = await r.json();
        const outside = b?.outside === true;
        if (!b || typeof b !== "object" || (!outside && typeof b.cwd !== "string")) return sendJson(r.res, 400, { error: "a JSON object is required: { cwd, model?, settings?, text? }, or { outside: true, … } for a chat outside a project" });
        const args = { model: b.model ?? null, settings: b.settings ?? null, preset: b.preset ?? null, text: typeof b.text === "string" ? b.text : "" };
        // The New Task board (HarnessV3-NewTask): the body the first send would create from, weighed — nothing written. A
        // copy placed for the person's chat is weighed as POST /sessions makes the chat there (`ownCopy`).
        const own = !outside && r.who?.kind === "device" && r.who.scope === "full" ? a.remoteCopies?.ownedAt?.(r.who.device.id, b.cwd) : null;
        if (!outside) return sendJson(r.res, 200, await native().draftStart({ ...args, cwd: b.cwd, ...(own ? { ownCopy: own.folder } : {}) }));
        // A chat outside a project (no folder chosen): weighed in Everything's folder, where its first send makes it and
        // the chat works — not made here.
        if (!a.everything) return sendJson(r.res, 503, { error: "Everything is not wired in this Filament" });
        const home = a.everything.where();
        if (home.refused) return sendJson(r.res, home.status || 400, { error: home.refused });
        return sendJson(r.res, 200, await native().draftStart({ ...args, cwd: home.cwd, unmade: !home.made, outside: true }));
      }),
    ],
    // Your defaults for sessions (HarnessV4_Tasks U3-8): the global layer as a document, and its writer.
    [
      "GET",
      "/defaults/settings",
      guard((r) => sendJson(r.res, 200, native().defaultsOf())),
    ],
    [
      "PATCH",
      "/defaults/settings",
      guard(async (r) => {
        const change = changeOf(await r.json());
        if (!change) return sendJson(r.res, 400, { error: "a JSON object is required: { patch?: { <section>: {…} }, unset?: [\"<path>\"] }" });
        return sendJson(r.res, 200, native().patchDefaults(change));
      }),
    ],
    // Your own instruction files (the Designer's answer of 10-27): whether each is there and its size, for Settings ›
    // Instructions; with none named, Claude Code's own file where this computer has one. Nothing of what one says.
    [
      "GET",
      "/instructions/your-files",
      guard((r) => sendJson(r.res, 200, yourFilesCheck(r.url.searchParams.getAll("path")))),
    ],
    [
      "GET",
      "/projects/:id/settings",
      guard((r) => sendJson(r.res, 200, native().projectSettingsOf(r.params.id))),
    ],
    [
      "POST",
      "/projects/:id/settings",
      guard(async (r) => {
        const change = changeOf(await r.json());
        if (!change) return sendJson(r.res, 400, { error: "a JSON object is required: { patch?: { <section>: {…} }, unset?: [\"<path>\"] }" });
        return sendJson(r.res, 200, native().patchProjectSettings(r.params.id, change));
      }),
    ],
    [
      "POST",
      "/projects/:id/rules/forget",
      guard(async (r) => {
        const b = await r.json();
        if (!b || typeof b !== "object" || typeof b.tool !== "string" || typeof b.pattern !== "string")
          return sendJson(r.res, 400, { error: "a JSON object is required: { tool, pattern, verdict? } — a rule of the project's list" });
        // Settings › Permissions' Forget for a project (HarnessV4_Settings_Plan HC-82): a remembered permission is taken
        // back, a written rule leaves the list; the gate asks again.
        return sendJson(r.res, 200, await native().forgetProjectRule(r.params.id, { tool: b.tool, pattern: b.pattern, verdict: b.verdict ?? null }));
      }),
    ],
    // Stop the harness's own turn in the session (Step 3 D16): the turn the lock names as the harness's — its own, or one
    // its coding agent began by itself — takes the two-step stop (a stop steer on its run, else its session cancels it).
    // Nothing else is the harness's to stop: a chat's move goes on to its end; with it, or no turn at all, the answer
    // says the stop reached none (`holder` and `stopped` null). A client's chat is its client's, answered so before
    // anything is marked (Filament is that client's proxy).
    // `force: true` is the Force stop from the session (HarnessV4_Tasks A5), for a page with no run id in hand — it
    // reloaded, or another tab sent the turn: the run the stop would have steered is forced instead (`runs.force`), so
    // the turn ends now whatever its loop or its agent does, stopped, its work kept, and its lock is free. No silence
    // ends a harness turn, so this is its way out of an agent that never ends its turn. Where the stop steers no run
    // (a turn with none under it) a forced one is the stop it was.
    // A driving goal held at once (core/goal-drive.js): no round starts by itself until `/goal go` — mid-round too, where a
    // typed `/goal hold` would reach the running turn as a note. 409 where the goal drives no round.
    [
      "POST",
      "/sessions/:id/goal/hold",
      guard(async (r) => {
        const id = String(r.params.id || "");
        const chain = memory.archive?.chainHead(id);
        if (!chain) throw Object.assign(new Error("no such session"), { status: 404 });
        const drive = sessions.holdGoal?.(chain.id, "held") ?? null;
        return drive ? sendJson(r.res, 200, { ok: true, drive }) : sendJson(r.res, 409, { error: "the goal starts no round by itself now" });
      }),
    ],
    [
      "POST",
      "/sessions/:id/stop",
      guard(async (r) => {
        const id = String(r.params.id || "");
        const chain = memory.archive?.chainHead(id);
        if (!chain) throw Object.assign(new Error("no such session"), { status: 404 });
        if (!sessionTurns) return sendJson(r.res, 501, { error: "one turn at a time is not wired" });
        const force = (await r.json())?.force === true;
        // A client's chat is its client's: nothing of the harness's runs or waits there, and its newest turn is its own.
        if (!chain.native) return sendJson(r.res, 200, { ok: true, holder: null, stopped: null });
        const s = stopChat(chain, { force });
        return sendJson(r.res, 200, { ok: true, holder: s.holder, stopped: s.stopped, ...(s.runs ? { runs: s.runs } : {}) });
      }),
    ],
    // Send without it (the filament-agent plan's D6, HarnessV3-FailurePoints §5.1 item 3): what the session's running turn
    // waits on — a summary Filament writes, memory's lookups or its capture — is let go, and the turn goes on at once.
    // 409 when it waits on none of them.
    [
      "POST",
      "/sessions/:id/wait/skip",
      guard(async (r) => {
        const id = String(r.params.id || "");
        const chain = memory.archive?.chainHead(id);
        if (!chain) throw Object.assign(new Error("no such session"), { status: 404 });
        if (!native().skipWait(chain.id)) return sendJson(r.res, 409, { error: "this session's turn waits on nothing it can be sent without" });
        return sendJson(r.res, 200, { ok: true });
      }),
    ],
    // What the page told the person about the session, in its own words (the filament-agent plan's Phase 4b): kept on
    // the session for an agent to read. Not a write to the conversation: a tab that follows it read-only says it too.
    [
      "POST",
      "/sessions/:id/page",
      guard(async (r) => {
        const b = await r.json();
        if (!Array.isArray(b?.lines)) return sendJson(r.res, 400, { error: "a JSON object is required: { lines: [{ at, kind, text }] }" });
        return sendJson(r.res, 200, native().pageSaid(String(r.params.id || ""), b.lines));
      }),
    ],
    // Open a rewound line as its own session (Step 3 D11): the live turns before it plus the line, the line live.
    [
      "POST",
      "/sessions/:id/lines/:line/fork",
      guard(async (r) => {
        const fork = memory.forkLine(String(r.params.id || ""), String(r.params.line || ""));
        if (!fork || fork.error) return sendJson(r.res, 404, { error: fork?.error || "no such rewound line" });
        return sendJson(r.res, 200, fork);
      }),
    ],
  ];
}

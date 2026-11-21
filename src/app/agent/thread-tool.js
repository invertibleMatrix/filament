// @ts-check
// The main agent's `thread` tool (core/threads.js, app/threads.js; the owner's of 11-09 and 11-11): it starts a chat of
// its own, linked to this one — an advisor it writes for reviews, a worker it hands a part to —, on the model, provider
// and effort it names, in this folder or another, its first message the agent's brief. The two write each other letters
// with the envelope tool, no tag needed; nothing comes back by itself unless `notify` asks for the thread's first reply.
// One tool of Filament's own, the same for both engines: the loop offers it, and a coding agent reaches it over Filament's
// MCP server or as Cursor's custom tools (agent-tools.js). Offered to a harness chat's own agent while its
// `loop.tools.thread` switch is on — never to a team's chat, a sub-agent, nor a chat of another machine's agents.
import { THREAD_LIMITS } from "../../core/threads.js";
import { SUBAGENT_EFFORTS } from "../../core/schema.js";
import { fromJudged } from "../../adapters/agents/asks.js";

export const THREAD = "thread";
/** A call where the chat starts no threads: no harness chat, a team's own, a sub-agent's, or another machine's agents'. */
export const THREAD_OFF = "Not run: threads are started by a harness chat's own agent, and this is none.";
/** A call made after the person switched the tool off for the chat. */
export const THREAD_SWITCHED_OFF = "Not run: the person switched the thread tool off for this chat. Do the work here, or say in your answer which thread you would have started and why.";

export const THREAD_TOOL = Object.freeze({
  name: THREAD,
  description:
    "Start a chat of its own linked to this one, for work that should stand apart and keep its own record: an advisor that reviews what you send it and remembers every earlier review, a worker that owns a part on another model, a project of its own in another folder. " +
    "Its first message is your brief (brief): say who leads, what it does, and when it writes back. The two of you write each other letters with Filament's envelope tool, no tag needed; the person sees both chats and may write in either. " +
    "model, provider and effort pick what it runs on, as you would say them; left out, this chat's model. folder runs it in another folder. " +
    "notify sends its first finished reply back to you as a letter; otherwise nothing comes back unless it writes. " +
    `Not for a quick piece of work you would wait for (agent), nor for a large job a team does (team). At most ${THREAD_LIMITS.perMessage} threads per message of the person's.`,
  input_schema: {
    type: "object",
    required: ["brief"],
    properties: {
      title: { type: "string", description: `Its name in the left bar, ${THREAD_LIMITS.title} characters at most. Left out: the brief's first line.` },
      brief: { type: "string", description: `Its first message, your words: its role, its task, who leads, when it writes back. ${THREAD_LIMITS.brief} characters at most.` },
      model: { type: "string", description: "The model it runs on, as you'd say it. Left out: this chat's model." },
      provider: { type: "string", description: "Who serves that model (a provider or a coding agent), where several do." },
      effort: { type: "string", enum: [...SUBAGENT_EFFORTS], description: "How hard it thinks (the highest level its model takes at or below it); model: its model's own." },
      folder: { type: "string", description: "The whole path of the folder it works in. Left out: this chat's folder. Another folder is judged as a write there would be; one that is no project yet, or is not there, asks the person first, Full access aside." },
      notify: { type: "boolean", description: "true: its first finished reply comes back to you as a letter." },
    },
  },
});

/**
 * Where a call stands: the chat it starts from, the start as the threads runner answers it, whether the person's switch
 * leaves the tool on now, the folder a start would ask the person for (`asks`, app/threads.js), which the loop judges
 * the call by before it runs, and why a start would be refused whatever they answer (`refusal`, as the tool says it),
 * which the loop reads before it asks.
 * @typedef {{ chain: string, start: (input: import("../threads.js").ThreadStart, ctx: import("../threads.js").ThreadCtx) => Promise<import("../threads.js").ThreadStarted>,
 *   on?: () => boolean, asks?: (input: import("../threads.js").ThreadStart) => import("../threads.js").ThreadFolder | null,
 *   refusal?: (input: import("../threads.js").ThreadStart) => Promise<string | null> }} ThreadAt
 */
/**
 * The threads as the agents' tools reach them, wired once by the server: a start as the main agent's, whether a chat
 * starts threads at all, whether its `loop.tools` switch leaves the tool on now, the folder a start would ask for, and
 * why one would be refused whatever the person answers.
 * @typedef {{ start: (chain: string, input: import("../threads.js").ThreadStart, ctx: import("../threads.js").ThreadCtx) => Promise<import("../threads.js").ThreadStarted>,
 *   starts: (chain: string) => boolean, on: (chain: string) => boolean, asks?: (chain: string, input: import("../threads.js").ThreadStart) => import("../threads.js").ThreadFolder | null,
 *   refusal?: (chain: string, input: import("../threads.js").ThreadStart) => Promise<string | null> }} ThreadDeps
 */

/**
 * What the person is asked where a thread would start in a folder that is not its starter's own (agent/loop.js
 * `judgedAs`, `folderAskOf`), in place of a write's words: one no project holds yet (`fresh`), else another project's.
 * @param {any} input  the call's @param {string} folder @param {boolean} [fresh]
 */
export function threadAskWords(input, folder, fresh = true) {
  const title = String(input?.title ?? "").replace(/\s+/g, " ").trim().slice(0, THREAD_LIMITS.title);
  const what = `May I start ${title ? `the thread “${title}”` : "a thread"} in ${folder}?`;
  return fresh
    ? `${what} No project holds that folder yet: it becomes one, made where it is not there — answer /allow to start it, or say what to do instead.`
    : `${what} It is not this chat's own folder: the thread's agent works there as this chat's does here — answer /allow to start it, or say what to do instead.`;
}

/**
 * Whether a thread's folder is asked for, from what the chat's switch and rules answer a write there (`verdict`): a
 * folder no project holds yet (`fresh`) asks whatever that write would do — Edit runs one inside the chat's folder
 * unasked, a rule or an always-allow another — unless the chat runs in Full access (`mode` auto); any other folder as
 * the write would. One rule for both engines: the loop's `admit` and a coding agent's `folderAskOf`.
 * @param {boolean} fresh @param {"run" | "ask" | "refuse"} verdict @param {string | null} mode
 * @returns {"run" | "ask" | "refuse"}
 */
export const folderVerdict = (fresh, verdict, mode) => (verdict === "run" && fresh && mode !== "auto" ? "ask" : verdict);

/**
 * The person's yes for a thread's folder in a coding agent's turn (app/threads.js `ThreadCtx`), from what its turn
 * gives Filament's tools (core/ports.js AgentToolCtx): the chat's switch judges a write there (`judgeNow`), and where
 * `folderVerdict` asks, the person answers the thread's own words on the turn's card (`askPerson`), judged again as the
 * switch moves while it waits. A switch that runs or refuses it answers in its own words, on its record (`permit`).
 * Null where no turn runs to ask in.
 * @param {Pick<import("../../core/ports.js").AgentToolCtx, "permit" | "judgeNow" | "modeNow" | "askPerson" | "signal">} turn
 * @param {any} input  the call's
 * @returns {import("../threads.js").ThreadCtx["folder"]}
 */
export function folderAskOf(turn, input) {
  const { permit, judgeNow, askPerson } = turn;
  if (!permit || !judgeNow || !askPerson) return null;
  return async ({ folder, fresh }) => {
    const calls = [{ name: "write", input: { path: folder, content: "" } }];
    const now = () => folderVerdict(fresh, judgeNow(calls), turn.modeNow?.() ?? null);
    if (now() !== "ask") return permit(calls, `start a thread in ${folder}`);
    /** The switch's answer where it moved while the card waited; null while it still asks. */
    const again = () => {
      const v = now();
      return v === "ask" ? null : { outcome: "answered", answers: { permission: { chosen: [v === "run" ? "allow" : "deny"] } }, reason: v === "run" ? "this chat's mode runs it now" : "this chat's mode refuses it now" };
    };
    const answer = await askPerson(fromJudged({ agent: "", tool: THREAD, words: threadAskWords(input, folder, fresh) }), { signal: turn.signal ?? null, again });
    const said = answer?.outcome === "answered" ? answer.answers?.permission : null;
    const chosen = Array.isArray(said?.chosen) ? said.chosen[0] : null;
    if (!chosen) throw new Error("the question was not answered");
    if (chosen !== "allow") throw new Error(answer.reason ? String(answer.reason) : `the person declined it${typeof said.words === "string" && said.words.trim() ? ` — "${said.words.trim().slice(0, 1500)}"` : ""}`);
    // A yes is judged again: read-only, or a deny rule, come since overrules it.
    if (judgeNow(calls) === "refuse") throw new Error("the person said yes, but this chat's mode or a rule refuses it now");
    return { asked: !answer.reason };
  };
}

/** A start the runner refused, as the tool says it. @param {string} why */
const notStarted = (why) => `Not started: ${why}.`;

/**
 * Where a call of a chat stands, or null where it starts no threads.
 * @param {ThreadDeps | null | undefined} deps @param {string | null | undefined} chain @returns {ThreadAt | null}
 */
export function threadAtOf(deps, chain) {
  if (!deps || !chain || !deps.starts(chain)) return null;
  return {
    chain,
    start: (input, ctx) => deps.start(chain, input, ctx),
    on: () => deps.on(chain),
    asks: (input) => deps.asks?.(chain, input) ?? null,
    refusal: async (input) => {
      const why = (await deps.refusal?.(chain, input)) ?? null;
      return why ? notStarted(why) : null;
    },
  };
}

/**
 * What a coding agent's turn gives a start (app/threads.js `ThreadCtx`): the person's yes for a folder that is not the
 * chat's own, asked on the turn's card (`folderAskOf`), and the mode the turn runs in now.
 * @param {Pick<import("../../core/ports.js").AgentToolCtx, "permit" | "judgeNow" | "modeNow" | "askPerson" | "signal">} turn
 * @param {any} input  the call's
 * @returns {import("../threads.js").ThreadCtx}
 */
export const threadCtxOf = (turn, input) => ({ folder: folderAskOf(turn, input), mode: turn.modeNow ?? null });

/** @param {string} error @returns {{ ok: false, error: string }} */
const no = (error) => ({ ok: false, error });

/**
 * Where a thread started, as its answer says it, from what happened: a folder that became a project — on the person's
 * yes, or unasked where the chat's mode runs it —, another folder the person allowed, else the folder alone.
 * @param {import("../threads.js").ThreadStarted} t
 */
const whereWords = (t) => ` in ${t.folder}${t.made ? (t.asked ? ", a new project the person allowed" : ", a new project made unasked as this chat's mode lets it") : t.asked ? ", which the person allowed" : ""}`;

/**
 * One call of the tool, its answer in words, or its refusal; the runner's refusals in their own words.
 * @param {any} input @param {ThreadAt} at @param {import("../threads.js").ThreadCtx} [ctx]
 * @returns {Promise<{ ok: true, text: string, started: import("../threads.js").ThreadStarted } | { ok: false, error: string }>}
 */
export async function threadCall(input, at, ctx = {}) {
  if (at.on && !at.on()) return no(THREAD_SWITCHED_OFF);
  try {
    const t = await at.start(
      { title: input?.title, brief: input?.brief, model: input?.model, provider: input?.provider, effort: input?.effort, folder: input?.folder, notify: input?.notify === true },
      ctx,
    );
    const back = t.notify ? "Its first finished reply comes back to you as a letter." : "Nothing comes back by itself: it writes you when its brief says to.";
    return {
      ok: true,
      text: `Started the thread "${t.title}" (${t.id}) on ${t.model}${t.effort ? ` at ${t.effort} effort` : ""}${whereWords(t)}: it reads your brief now. Write it with Filament's envelope tool, to: "${t.id}". ${back} Go on with your work.`,
      started: t,
    };
  } catch (/** @type {any} */ e) {
    if (Number.isInteger(e?.status)) return no(notStarted(e.message));
    throw e;
  }
}

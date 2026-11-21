// @ts-check
// The main agent's `flow` tool (HarnessV4_OneAgent_Plan OA3, OA-D7): it designs a flow of the person's agents and teams
// beside its chat once the person asks with `/flow` — `draft` — changes a draft of its own while it stands — `edit` —
// and reads how the chat's flows stand — `read`. It never starts one: Start is the person's press alone (L26). Every
// draft is checked whole (names, needs, order, writers) and a refusal comes back to the agent in words, to fix (L37).
// A flow the person started In place, the agent drives (OA4): `box` stops, skips or retries one of its boxes, or answers
// a gate it waits at — go on, or send a box back — with why; `stop` stops it; `edit` changes its steps to come. The
// words that opened its turn say how; the description only names them. And in a turn of the person's without /flow,
// `offer` puts a Run as a flow button under its reply (OA6, OA-D14): their press is their /flow, with the words of
// the message it stands under; the offer itself draws nothing, and comes once a reply.
// One tool of Filament's own, the same for both engines: the loop offers it, and a coding agent reaches it over Filament's
// MCP server or as Cursor's custom tools (agent-tools.js). Offered from the chat's first message to a harness chat's own
// agent while its `loop.tools.flow` switch is on — never to a team's lead, a worker or a helper, nor in a team's own
// chat: a team draws no flow. A call made after the person switched it off is refused in words. It rides on every
// request of the chat, so its description stays short: the rules and the roster come with the /flow message itself
// (core/flow.js flowAskLine), on the one turn that draws.
import { FLOW_LIMITS, flowText, nowOf } from "../../core/flow.js";

export const FLOW_NAME = "flow";
/** What the tool does, in the order its description gives them. */
export const FLOW_ACTIONS = Object.freeze(["read", "draft", "edit", "offer", "box", "stop"]);
/** What `box` does to a box of a flow the agent drives (OA4): stop, skip or retry it; at a gate it waits at, go or back. */
export const FLOW_BOX_DOES = Object.freeze(["stop", "skip", "retry", "go", "back"]);
/** A call where the chat draws no flow: no harness chat, a team's own, or a lead's, a worker's or a helper's. */
export const FLOW_OFF = "Not run: a flow is drawn by a harness chat's own agent, and this is none.";
/** A call made after the person switched the tool off for the chat. */
export const FLOW_SWITCHED_OFF = "Not run: the person switched the flow tool off for this chat. Say in your answer what you would draw, and that the chat's settings turn it on.";

/** A box as the tool's schema gives it. */
const BOX_SCHEMA = {
  type: "object",
  required: ["id"],
  properties: {
    id: { type: "string", description: "A short word (plan, build): how later boxes name it in needs." },
    agent: { type: "string", description: "One of the person's agents, by its tag." },
    team: { type: "string", description: "One of the person's teams, by its key." },
    review: { type: "boolean", description: "true: the person's own review." },
    words: { type: "string", description: `What it is asked; ${FLOW_LIMITS.words} characters at most. A review's: what the person looks at.` },
    needs: { type: "array", items: { type: "string" }, description: "Ids of earlier steps' boxes whose results it is handed." },
    gate: { type: "boolean", description: "An agent box that checks what it needs." },
    readOnly: { type: "boolean", description: "It changes no file." },
  },
};

export const FLOW_TOOL = Object.freeze({
  name: FLOW_NAME,
  description:
    "Design a flow beside this chat when the person asks for one with /flow: their agents and teams in steps, each box handed the person's words and the results of the boxes it needs. Never start one: the draft stands over the person's message box for them to change and Start. Their /flow message brings the rules and their agents and teams. " +
    "draft draws it (title, steps), only while the person's newest message is /flow. " +
    "edit changes a draft of yours that stands, as the person asks, or the steps to come of a flow you drive: the steps whole, or a new title. " +
    "read says how this chat's flows stand, whether you may draft now, and the person's agents and teams. " +
    "offer, without /flow, where their message lays out three or more steps in order or a review point: it puts a Run as a flow button under your reply (their press is their /flow), draws nothing, and is used once a reply. " +
    "box and stop act on a flow you drive in place, as its start told you. " +
    "A refusal says what to fix: fix it and call again.",
  input_schema: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: [...FLOW_ACTIONS] },
      title: { type: "string", description: "draft, edit: the flow in a few words." },
      flow: { type: "string", description: "edit, box, stop: its id; else the newest of yours." },
      box: { type: "string", description: "box: the box to act on, by its id." },
      do: { type: "string", enum: [...FLOW_BOX_DOES], description: "box: what to do with it: stop, skip or retry it, or at a gate go (go on) or back (send a box back)." },
      to: { type: "string", description: "box, sending back: the box to send it back to." },
      why: { type: "string", description: "box, stop: your reason, shown with it." },
      steps: {
        type: "array",
        description: `draft, edit: the steps, top to bottom; ${FLOW_LIMITS.steps} at most.`,
        items: {
          type: "object",
          required: ["boxes"],
          properties: {
            why: { type: "string", description: "Why this step is where it is." },
            boxes: { type: "array", description: `Its boxes, which run in parallel; ${FLOW_LIMITS.boxes} at most.`, items: BOX_SCHEMA },
          },
        },
      },
    },
  },
});

/**
 * Where a call stands: the chat it draws beside, and the flow runner's draft, edit, read and act — on a flow it drives —
 * for it, and whether the person's switch leaves the tool on now.
 * @typedef {{ chain: string, draft: (input: any) => import("../../core/flow.js").Flow, edit: (input: any) => import("../../core/flow.js").Flow,
 *   read: () => string, act?: (input: any) => { flow: import("../../core/flow.js").Flow, did: string }, offer?: () => unknown, on?: () => boolean }} FlowAt
 */

/**
 * The flows beside the chats as the agents' tools reach them, wired once by the server: a draft, an edit, a read and an
 * act on a flow it drives (OA4) as the main agent's, the offer of Run as a flow under the reply of the turn that runs
 * (OA6), whether a chat draws flows at all (a team's own does not), and whether its `loop.tools` switch leaves the tool
 * on now.
 * @typedef {{ draft: (chain: string, input: any) => import("../../core/flow.js").Flow, edit: (chain: string, input: any) => import("../../core/flow.js").Flow,
 *   read: (chain: string) => string, act?: (chain: string, input: any) => { flow: import("../../core/flow.js").Flow, did: string },
 *   offer?: (chain: string) => unknown, fires: (chain: string) => boolean, on: (chain: string) => boolean }} FlowDeps
 */

/**
 * Where a call of a chat stands, or null where it draws no flow.
 * @param {FlowDeps | null | undefined} deps @param {string | null | undefined} chain @returns {FlowAt | null}
 */
export function flowAtOf(deps, chain) {
  if (!deps || !chain || !deps.fires(chain)) return null;
  const act = deps.act;
  const offer = deps.offer;
  return { chain, draft: (input) => deps.draft(chain, input), edit: (input) => deps.edit(chain, input), read: () => deps.read(chain), ...(act ? { act: (/** @type {any} */ input) => act(chain, input) } : {}), ...(offer ? { offer: () => offer(chain) } : {}), on: () => deps.on(chain) };
}

/** @param {string} error @returns {{ ok: false, error: string }} */
const no = (error) => ({ ok: false, error });

/**
 * One call of the tool, its answer in words, or its refusal; the runner's refusals in their own words.
 * @param {any} input @param {FlowAt} at
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function flowCall(input, at) {
  if (at.on && !at.on()) return no(FLOW_SWITCHED_OFF);
  const action = String(input?.action ?? "").trim().toLowerCase();
  if (!FLOW_ACTIONS.includes(action)) return no(`flow takes an action: ${FLOW_ACTIONS.join(", ")}${action ? `; ${action.slice(0, 40)} is none of them` : ""}.`);
  if (action === "read") return { ok: true, text: at.read() };
  // A flow it drives In place (OA4): what it did, and where the flow stands now; what comes of it is its next word.
  if (action === "box" || action === "stop") {
    if (!at.act) return no("Not done: no flow of this chat is driven here.");
    try {
      const r = at.act(input);
      return { ok: true, text: `Done: you ${r.did}. ${nowOf(r.flow)}. The person reads it on the flow; what comes of it reaches you here as it lands.` };
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status)) return no(`Not done: ${e.message}.`);
      throw e;
    }
  }
  // Run as a flow (OA6, OA-D14): a button under the reply; the person's press sends /flow with their words, and the
  // draft comes then — the offer draws nothing.
  if (action === "offer") {
    if (!at.offer) return no("Not offered: this chat offers no flow here.");
    try {
      at.offer();
      return { ok: true, text: "Offered: a Run as a flow button stands under your reply; their press sends /flow with their words, and you draft it then. Nothing is drawn now: answer them as you would." };
    } catch (/** @type {any} */ e) {
      if (Number.isInteger(e?.status)) return no(`Not offered: ${e.message}.`);
      throw e;
    }
  }
  if ((action === "draft" || !input?.title) && !Array.isArray(input?.steps)) return no(`${action} takes steps: [{"why": "…", "boxes": [{"id": "…", "agent": "…", "words": "…", "needs": []}]}].`);
  try {
    const flow = action === "draft" ? at.draft(input) : at.edit(input);
    return {
      ok: true,
      text: [
        flow.state !== "draft"
          ? "Changed: the steps to come of the flow you drive, as below — Filament runs them as their turn comes, and the person sees the change."
          : `${action === "draft" ? "Drawn" : "Changed"}: the draft stands over the person's message box, where they change it and press Start — nothing runs before. In your reply, say why each step is where it is; where they ask for a change, edit this draft.`,
        "",
        flowText(flow),
      ].join("\n"),
    };
  } catch (/** @type {any} */ e) {
    if (Number.isInteger(e?.status)) return no(`Not ${action === "draft" ? "drawn" : "changed"}: ${e.message}.`);
    throw e;
  }
}

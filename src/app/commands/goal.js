// @ts-check
// `/goal …`: the goal layer (WP-I), answered by Filament on a record of its own. Setting a goal spends ONE model call —
// the intake estimate the goal cannot skip — and proposes a slice; the goal becomes active only on `/goal accept`, and
// from then on the accepted slice rides every request of the session — said on the person's next message, at the end of
// the system prompt from the chat's next compaction on (brain.js `applyGoal`) — and Filament drives it round by round (core/goal-drive.js): the command's turn ends, and its first round starts. `/goal go` drives
// on, `/goal hold` holds it. It counts no money (the owner's of 11-05). Status, done and abandon are local.
import { answerWith, openCommandRecord } from "./answer.js";
import { plainModelProblem, parseAgentModel } from "../agent/turn.js";
import { leftOutOf } from "../pipeline/stages/situate.js";
import {
  ESTIMATE_PROMPT,
  estimateUser,
  parseEstimateReply,
  newGoal,
  goalStatusText,
  leftOutWords,
  SIZE_CLASS_HINT,
} from "../../services/memory/goal.js";
import { DRIVE_MS, DRIVE_ROUNDS, driveFrom, driveOf, driveWords } from "../../core/goal-drive.js";

/** @typedef {import("../pipeline/context.js").RequestContext} RequestContext */
/** @typedef {import("../deps.js").AppDeps} AppDeps */
/** @typedef {import("./parse.js").GoalCommand} GoalCommand */

/** A drive's time in words (core/goal-drive.js `DRIVE_MS`). */
const DRIVE_TIME = `${DRIVE_MS / 3_600_000} hours`;

const USAGE = [
  "**/goal** — one objective for this session, sized before it starts.",
  "- `/goal <text>` — propose the goal. Filament makes one model call that sizes it (hours … team-years) and names the slice one developer with this assistant can plausibly finish; nothing is active yet.",
  `- \`/goal accept\` — activate the proposed slice. From then on it rides every request of this session — said on your next message, at the end of the system prompt from the next compaction on — and in a Filament chat Filament drives it: each turn that ends starts the next round by itself, until the agent marks the slice done or blocked, you press Stop or write to the agent, ${DRIVE_ROUNDS} rounds pass, or ${DRIVE_TIME} do.`,
  `- \`/goal go\` — drive it on from where it halted, ${DRIVE_ROUNDS} rounds or ${DRIVE_TIME} more; \`/goal hold\` — no round starts by itself until \`/goal go\`.`,
  "- `/goal slice <text>` — rewrite the slice before accepting.",
  "- `/goal status` (or a bare `/goal`) — the goal, its estimate, its slice and its drive.",
  "- `/goal done` / `/goal abandon` — close it; your next message says so, and the block leaves the system prompt at the next compaction.",
  "",
  "It counts no money: nothing of a goal stops for what it spent.",
].join("\n");

/**
 * The model the estimate runs on: the chat's own model when it is a plain routed model (the best one the route
 * allows), else memory's summarizer. The agent loop or a coding agent would run a whole turn for one sizing
 * question.
 * @param {any} cfg @param {string} model @param {AppDeps["destination"]} destination
 */
export function estimateModelFor(cfg, model, destination) {
  const name = String(model || "");
  if (!name || parseAgentModel(name)) return null;
  return plainModelProblem(cfg, name, destination) ? null : name;
}

/**
 * The goal as a card (Facade D4), from the same values the status text shows: the state, the words, the estimate's
 * four parts and its drive. The actions depend on the state — a proposed goal gets Accept; an active one, Hold or Go
 * on as it drives or halted, Done and Abandon — each a command any client can type. In a chat memory leaves out
 * (`leftOut`) only closing it works, so a proposed goal gets Abandon there.
 * @param {any} g  the goal as `goalFor` returns it, or null @param {{ leftOut?: boolean }} [o]
 */
export function goalCard(g, { leftOut = false } = {}) {
  if (!g) return null;
  const state = String(g.status || "proposed");
  /** @type {any} */
  const card = {
    kind: "goal",
    v: 1,
    state,
    title: state === "proposed" ? "Goal proposed" : state === "active" ? "Goal active" : state === "done" ? "Goal done" : "Goal abandoned",
    text: g.text || "",
    ...(g.slice ? { slice: g.slice } : {}),
    ...(g.estimate
      ? {
          estimate: {
            sizeClass: g.estimate.sizeClass || null,
            achievableSlice: g.estimate.achievableSlice || null,
            assumptions: Array.isArray(g.estimate.assumptions) ? g.estimate.assumptions : [],
            firstStep: g.estimate.firstStep || null,
          },
        }
      : {}),
    ...(driveOf(g) ? { drive: driveWords(driveOf(g)) } : {}),
  };
  const actions = [];
  if (state === "proposed") actions.push(leftOut ? { label: "Abandon", command: "/goal abandon" } : { label: "Accept", command: "/goal accept" });
  if (state === "active") {
    // A chat memory leaves out drives nothing: only closing it works there.
    const drive = leftOut ? null : driveOf(g);
    if (drive && drive.halted) actions.push({ label: "Go on", command: "/goal go" });
    else if (drive) actions.push({ label: "Hold", command: "/goal hold" });
    actions.push({ label: "Done", command: "/goal done" });
    actions.push({ label: "Abandon", command: "/goal abandon" });
  }
  if (actions.length) card.actions = actions;
  return card;
}

/** The answers that are words, not the goal: they carry no card, so a page that draws the card never hides them. A
 *  refusal (an action that changed nothing — "already active", "no slice to accept") is words too, whatever its action. */
const WORDS_ONLY = new Set(["help", "unknown"]);
/** What a chat memory leaves out does with a goal its session has: reads it and closes it. */
const CLOSING = new Set(["show", "done", "abandon"]);

/**
 * @param {RequestContext} ctx
 * @param {AppDeps} deps
 * @param {GoalCommand & { raw: string, command: string }} cmd
 */
export async function answerGoalCommand(ctx, deps, cmd) {
  const { memory, config, destination, ops } = deps;
  const { body } = ctx;
  const sit = ctx.memory.sit;
  const rec = openCommandRecord(ctx, deps, { upstream: ctx.route.upstream, cwd: true });
  const chainId = sit ? memory.chainIdFor(sit) : null;
  // A chat memory leaves out — a harness chat, whose session situate found, or a client's — gets no goal: a goal rides
  // on memory's work, which stays out of it. One its session got before is still read and closed there, and only that
  // is offered. `out`: why memory leaves it out — the Memory setting that does, in its words, where one does; `missed`:
  // its read of the chat failed, which leaves out this message alone.
  const leftOut = !sit && !!memory.isOpen?.();
  const out = leftOut ? leftOutOf(ctx.memory) : false;
  const missed = out === true && !!ctx.memory.failed;
  const kept = leftOut && ctx.memory.session && memory.goalFor(ctx.memory.session.chain) ? ctx.memory.session.chain : null;
  const goalChain = chainId || kept;
  /** A chat Filament runs, whose turns it sends itself: its goal is driven (core/goal-drive.js). */
  const own = sit?.client === "harness";
  /** @type {string[]} */
  const changes = [`/goal ${cmd.action} answered by Filament`];
  let text;
  let card = null;
  let failed = false;
  let refused = false;
  /** An answer that changed nothing, in words: it carries no card (backlog 17). @param {string} t */
  const refuse = (t) => {
    refused = true;
    return t;
  };
  /** What the reply says that the card would not show — an estimate not made — as plain words (a card draws text, not markdown). @type {string[]} */
  const notes = [];
  try {
    text = await reply();
  } catch (/** @type {any} */ e) {
    failed = true;
    text = `/goal failed: ${String(e?.message || e).slice(0, 200)}`;
    changes.push(`goal: failed (${String(e?.message || e).slice(0, 120)})`);
  }
  // The record names the session the command acts on, and it books nothing (a command's record never does, finish.js).
  // Its command turn is kept where its chat keeps turns (answer.js `commandSit`): where memory situated the chat, and in
  // a chat Filament composes that Memory settings leave out (situate's `kept`); an outside client's they leave out
  // gains none.
  rec.memory = { chain: goalChain || undefined, command: true, client: sit?.client, goal: cmd.action };
  try {
    if (!failed && !refused && !WORDS_ONLY.has(cmd.action)) card = goalCard(goalChain ? memory.goalFor(goalChain) : null, { leftOut });
    if (card && notes.length) card.notes = notes;
  } catch {}
  answerWith(ctx, deps, rec, text, { changes, local: true, card });
  return undefined;

  async function reply() {
    if (cmd.action === "help") return USAGE;
    if (cmd.action === "unknown") return `I did not understand \`${cmd.arg}\`.\n\n${USAGE}`;
    if (!goalChain || (!chainId && !CLOSING.has(cmd.action)))
      return refuse(
        out
          ? `${leftOutWords(out, missed)}, and a goal rides on memory's work: no goal is set ${missed ? "— send it again" : "here"}${kept ? `${missed ? ";" : " —"} the one its session has is read and closed here (\`/goal status\`, \`/goal done\`, \`/goal abandon\`)` : ""}.`
          : memory.archive
            ? "This chat has no session yet (Filament could not identify it), so there is nothing to set a goal on. Send a normal message first."
            : `No archive, so this chat has no session to set a goal on. ${memory.archiveWhy()}`,
      );
    const current = memory.goalFor(goalChain);
    const open = current && (current.status === "proposed" || current.status === "active");
    if (cmd.action === "show") {
      if (!current) return refuse(`No goal in this session. \`/goal <text>\` proposes one; Filament sizes it first.\n\n${USAGE}`);
      return goalStatusText(current, { chainId: goalChain, leftOut: out, missed });
    }
    if (cmd.action === "set") {
      if (!cmd.text.trim()) return refuse(`\`/goal\` needs the goal's text.\n\n${USAGE}`);
      if (open)
        return refuse(`This session already has a ${current.status} goal: “${current.text}”. \`/goal done\` or \`/goal abandon\` closes it first; \`/goal status\` shows it.`);
      const goal = newGoal(cmd.text, { now: memory.now() });
      // The one call a goal cannot skip. Its failure leaves the goal proposed without an estimate, said in words —
      // `/goal accept` then refuses until an estimate exists.
      const cfg = config();
      const model = estimateModelFor(cfg, body.model, destination);
      let estimateErr = null;
      try {
        const r = await memory.callModel({
          system: ESTIMATE_PROMPT,
          user: estimateUser(goal.text, sit?.project || null),
          purpose: "estimate",
          chainId,
          model,
          includeUsage: true,
        });
        const raw = typeof r === "string" ? r : r?.text || "";
        const parsed = parseEstimateReply(raw);
        if (!parsed) estimateErr = "the model's reply was not an estimate";
        else {
          goal.estimate = { ...parsed, at: memory.now(), model: model || memory.modelFor?.({ chainId })?.model || "memory's model", requestId: typeof r === "object" && r ? r.requestId || null : null };
          goal.slice = parsed.achievableSlice;
        }
      } catch (/** @type {any} */ e) {
        estimateErr = String(e?.message || e).slice(0, 160);
      }
      memory.setGoal(chainId, goal);
      changes.push(goal.estimate ? `goal: proposed and sized ${goal.estimate.sizeClass} (one estimate call)` : `goal: proposed; the estimate failed (${estimateErr})`);
      try {
        ops.record("archive", `goal proposed in session ${chainId}`, { sub: "goal", detail: { chain: chainId, sized: goal.estimate?.sizeClass || null, estimated: !!goal.estimate }, ref: { requestId: rec.id, chainId } });
      } catch {}
      if (!goal.estimate) {
        notes.push(`The intake estimate could not be made (${estimateErr}): /goal slice <text> writes the slice, then /goal accept.`);
        return `Goal noted: “${goal.text}”. The intake estimate could not be made (${estimateErr}), so the goal stays **proposed** without a slice. Try \`/goal slice <text>\` to write the slice yourself, then \`/goal accept\`; or \`/goal abandon\`.`;
      }
      const e = goal.estimate;
      return [
        `Goal noted: “${goal.text}”.`,
        ``,
        `**Estimate** (${e.model}; an estimate, not a promise): this is a **${e.sizeClass}**-sized goal — ${SIZE_CLASS_HINT[e.sizeClass]}.`,
        `- achievable slice: ${e.achievableSlice}`,
        e.assumptions.length ? `- assumptions: ${e.assumptions.join("; ")}` : "",
        e.firstStep ? `- first step: ${e.firstStep}` : "",
        ``,
        `Nothing is active yet. \`/goal accept\` makes the slice this session's goal; \`/goal slice <text>\` rewrites it first; \`/goal abandon\` drops it.`,
      ]
        .filter((l) => l !== "")
        .join("\n");
    }
    if (!current) return refuse(`No goal in this session to ${cmd.action}. \`/goal <text>\` proposes one.`);
    if (cmd.action === "slice") {
      if (!open) return refuse(`The goal is ${current.status}; its slice cannot change. \`/goal <text>\` proposes a new one.`);
      memory.setGoal(chainId, { ...current, slice: cmd.text.trim().slice(0, 600) });
      return current.status === "active"
        ? `Slice rewritten for the active goal: “${cmd.text.trim().slice(0, 600)}”. Your next message says so; the system prompt takes it at the next compaction, so nothing the provider cached is written again.`
        : `Slice rewritten: “${cmd.text.trim().slice(0, 600)}”. \`/goal accept\` activates it.`;
    }
    if (cmd.action === "accept") {
      if (current.status === "active") return refuse(`The goal is already active: “${current.slice}”. \`/goal status\` shows where it stands.`);
      if (current.status !== "proposed") return refuse(`The goal is ${current.status}; \`/goal <text>\` proposes a new one.`);
      if (!current.slice) return refuse("There is no slice to accept: the estimate did not produce one. `/goal slice <text>` writes it, then `/goal accept`.");
      // Driven in a chat Filament runs, whose turns it sends itself (sessions/service.js `turn`); an outside client's
      // goal rides its requests alone.
      memory.setGoal(chainId, { ...current, status: "active", acceptedAt: memory.now(), ...(own ? { drive: driveFrom(null, memory.now()) } : {}) });
      changes.push(own ? "goal: accepted and activated, driven round by round" : "goal: accepted and activated");
      return own
        ? `Goal active: “${current.slice}”. It rides every request of this session for every model: said on the next message, at the end of the system prompt from the next compaction on. Its first round starts as this answer ends (or, where something the agent started still runs, once that wakes it), and each turn that ends starts the next by itself, until the agent ends a reply with [goal: done] or [goal: blocked: …], you press Stop or write to the agent, ${DRIVE_ROUNDS} rounds pass, or ${DRIVE_TIME} do. \`/goal hold\` holds it; \`/goal done\` or \`/goal abandon\` closes it.`
        : `Goal active: “${current.slice}”. It rides every request of this session for every model: said on your next message, at the end of the system prompt from the next compaction on. \`/goal done\` or \`/goal abandon\` closes it.`;
    }
    if (cmd.action === "go" || cmd.action === "hold") {
      if (!own) return refuse("Only a goal of a chat Filament runs is driven: an outside client's turns are its own to send.");
      if (current.status !== "active") return refuse(`The goal is ${current.status}: only an active goal is driven. ${current.status === "proposed" ? "\`/goal accept\` activates it." : "\`/goal <text>\` proposes a new one."}`);
      const drive = driveOf(current);
      if (cmd.action === "hold") {
        if (!drive || drive.halted) return refuse(`The goal starts no round by itself now${drive?.halted ? ` (${driveWords(drive)})` : ""}.`);
        memory.setGoal(chainId, { ...current, drive: { ...drive, halted: { kind: "held", at: memory.now() } } });
        changes.push("goal: held");
        return `Goal held at round ${drive.round}: no round starts by itself until \`/goal go\`. Your messages go to the agent as ever.`;
      }
      // Halted, it goes on; driving, it goes on too — a drive whose round never came (a restart between rounds, say)
      // starts it again —, with as many rounds again from where it stands, and its time again from now.
      const next = driveFrom(drive, memory.now());
      memory.setGoal(chainId, { ...current, drive: next });
      changes.push(`goal: driven on, to round ${next.cap}`);
      return `Goal driven on from round ${next.round}: its next round starts as this answer ends (or, where something the agent started still runs, once that wakes it), up to round ${next.cap}. It halts sooner after ${DRIVE_TIME}, or as you write to the agent.`;
    }
    if (cmd.action === "done" || cmd.action === "abandon") {
      if (!open) return refuse(`The goal is already ${current.status}.`);
      const status = cmd.action === "done" ? "done" : "abandoned";
      memory.setGoal(goalChain, { ...current, status, closedAt: memory.now() });
      changes.push(`goal: ${status}`);
      // Where memory leaves the chat out, the words offer nothing refused there: no next goal is proposed.
      const after = leftOut ? "The goal stays on the session's record." : "The next message says so, the block leaves the system prompt at the next compaction, and no round starts by itself. The goal stays on the session's record; `/goal <text>` proposes the next one.";
      const rounds = Number(current.drive?.round) || 0;
      return `Goal ${status}: “${current.slice || current.text}”${rounds ? ` — ${rounds} round${rounds === 1 ? "" : "s"} driven` : ""}${current.estimate ? `, sized ${current.estimate.sizeClass}` : ""}. ${after}`;
    }
    return goalStatusText(current, { chainId: goalChain, leftOut: out, missed });
  }
}

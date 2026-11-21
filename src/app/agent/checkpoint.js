// @ts-check
// The checkpoints an agent hears, composed once for every reader (the owner's of 11-10: every nudge reaches Filament's
// loop and the coding agents alike — an agent that drifts in a long context hears only its tools' answers, so what keeps
// it on course has to reach it whichever agent it is). A moment of the turn — its start, a move to another model or
// agent, a compaction, a call's end, a tick of its plan, a note of the person's — and what stands then (the facts,
// gathered by the caller) make the blocks the agent hears, in one order, the same for both kinds of agent but where
// DIVERGENCE says why not; how they reach it follows from what its reader can take mid-turn (`steer`), never from its
// brand. A turn Filament starts itself is composed as any turn's start is, and what a turn's end says each caller says
// itself (loop.js; acp-turn.js `owed`): neither is a moment here. The composer reads nothing and keeps nothing: the
// caller records what it said once it reached the agent — a prompt that never reached it says nothing.

/** @typedef {"turn-start" | "switch" | "after-compact" | "action" | "tick" | "note"} Moment */
/**
 * What an agent can take, which decides how a block reaches it: `kind` — Filament's own loop, or a coding agent run as
 * a chat's turn; `steer` — how words reach its running turn: queued at it (Claude Code's queue), into it live (Codex's
 * turn/steer, Cursor's SDK, an ACP agent's steering), or only once a step ended (`next`, Cursor's CLI);
 * null where none do. `envelopes`: it has Filament's envelope tool. `lead`: it leads a team; `worker`: it is a sub-agent.
 * @typedef {{ kind: "loop" | "coding", steer: "queued" | "live" | "next" | null, envelopes: boolean, lead: boolean, worker: boolean }} Reader
 */
/**
 * How the blocks reach the agent: `message` — on the model's copy of the message the moment rides (the loop's turn
 * start, its fold, its round's tool results; a coding agent's prompt); `steer` — into its running turn as Filament's
 * words; `tool-answer` — at the tail of Filament's next tool answer to it.
 * @typedef {"message" | "steer" | "tool-answer"} Via
 */
/**
 * The parts of the block that comes back after a compaction (sessions/reattach.js `reattachBlock` renders them).
 * @typedef {{ files: readonly string[], plan: any, graph: string | null, open: readonly string[] | null, letters: readonly any[] | null, ended: readonly string[] | null, skills: readonly any[] | null }} BackParts
 */
/**
 * What stands at the moment, gathered by the caller — each a block's text, or what a block is made of; one left out is
 * a block not said. `fileNews`: the files the agent read that changed since, `text` with what changed in them and
 * `names` with their names and how many lines changed. `whereHeld`: an earlier message of the request holds where it
 * stands already (a summary's head). `back`: what comes back after a compaction — at a turn's start, the one a coding
 * agent's compaction owed and its turn never heard (`owed`). `team`: a lead's team as it stands (team-tools.js `teamNow`).
 * A tick's (task-graph.js `TickParts`): `answer`, what moved; `atOnce`; `next`; `now`, how the work stands or, all done,
 * the words that weigh it; then `started`, what Filament started of it, and `alsoOpen`, what else is open beside it.
 * `drift`: at a call, a sign that the agent drifts from its work (core/drift.js).
 * @typedef {{ exits?: string, fileNews?: { text: string, names: string } | null, open?: string, sealed?: string,
 *   where?: string, whereHeld?: boolean, back?: BackParts | null, owed?: boolean, handover?: string, team?: string,
 *   unplanned?: string, drift?: string, memory?: string, answer?: string, next?: string, atOnce?: string, now?: string,
 *   alsoOpen?: string, started?: string, onTask?: string }} Facts
 */
/** @typedef {{ id: string, text?: string, back?: BackParts }} Block */

/** Every moment, in the order a turn meets them. */
export const MOMENTS = /** @type {readonly Moment[]} */ (Object.freeze(["turn-start", "switch", "after-compact", "action", "tick", "note"]));

/** The readers a chat has, by what they can take: the matrix's rows. @type {Readonly<Record<"loop" | "loopLead" | "loopWorker" | "claude" | "codex" | "cursorSdk" | "cursorCli" | "codingLead" | "codingWorker", Reader>>} */
export const READERS = Object.freeze({
  loop: { kind: "loop", steer: "live", envelopes: true, lead: false, worker: false },
  loopLead: { kind: "loop", steer: "live", envelopes: true, lead: true, worker: false },
  loopWorker: { kind: "loop", steer: "live", envelopes: false, lead: false, worker: true },
  claude: { kind: "coding", steer: "queued", envelopes: true, lead: false, worker: false },
  codex: { kind: "coding", steer: "live", envelopes: true, lead: false, worker: false },
  cursorSdk: { kind: "coding", steer: "live", envelopes: true, lead: false, worker: false },
  cursorCli: { kind: "coding", steer: "next", envelopes: true, lead: false, worker: false },
  codingLead: { kind: "coding", steer: "queued", envelopes: true, lead: true, worker: false },
  codingWorker: { kind: "coding", steer: "queued", envelopes: false, lead: false, worker: true },
});

/**
 * Where the two kinds of agent hear differently, and why — each a block one kind hears and the other does not (`only`),
 * a part of a block one kind alone gets (`part`), a block both hear in other forms (`only` null), or a way a reader
 * is reached that others are not (`via`). Kept as data: the matrix test reads the facts each caller gives the composer
 * from its source, and holds every difference between what a loop and a coding agent hear to an entry here.
 */
export const DIVERGENCE = Object.freeze([
  { id: "recent-files", moments: ["after-compact"], block: "back", part: "files", only: "loop", via: null, why: "the files the folded rounds used come back whole to the loop; a coding agent's own compaction keeps what it needs, and its tools read the rest again" },
  { id: "live-plan", moments: ["after-compact"], block: "back", part: "plan", only: "loop", via: null, why: "the loop's checklist comes back while it is live, unless a kept round shows it; a coding agent's own to-do list is its client's to keep, and Filament's checklist for it is on its task graph, which comes back" },
  { id: "folded-letters", moments: ["after-compact"], block: "back", part: "letters", only: "loop", via: null, why: "the loop knows which letters the rounds it folded opened, and names them; a coding agent's own compaction says nothing of what it folded — the envelopes still sealed are listed after it all the same" },
  { id: "lead-ended", moments: ["after-compact"], block: "back", part: "ended", only: "loop", via: null, why: "the loop's lead hears which of its workers ended in what comes back (turn.js `reattach`, team-tools.js `endedWorkers`); a coding lead hears its team as it stands instead, after it (DIVERGENCE lead-team)" },
  { id: "lead-team", moments: ["after-compact"], block: "team", part: null, only: "coding", via: null, why: "a coding lead hears its team as it stands after what comes back (team-tools.js `teamNow`): its compaction may have taken what its workers said; the loop's lead hears which of them ended inside what comes back (DIVERGENCE lead-ended)" },
  { id: "shell-exits-start", moments: ["turn-start", "switch"], block: "shell-exits", part: null, only: "loop", via: null, why: "a harness chat's background commands that ended while no turn ran are told with the message that begins the next, before either kind of agent runs (sessions/service.js), and a coding agent's that end while its turn runs go into it (agent/commands.js) — a sub-agent's into its own run; the loop's start takes what is left unseen: an outside client's shells, a sub-agent's own" },
  { id: "file-news-names", moments: ["turn-start", "switch"], block: "file-news", part: null, only: null, via: null, why: "the loop hears what changed in each file; a coding agent hears the files' names and how many lines changed, and reads them again with its own tools (Claude Code also notes a file it read that changed)" },
  { id: "owed-back", moments: ["turn-start"], block: "back", part: null, only: "coding", via: null, why: "a coding agent that compacted its own context with nothing said after — it took no step Filament could send words in at, or it compacted outside a turn — is owed what comes back with its next turn's first prompt, in place of what is open and, where the block carries its task graph, of where it stands; the loop's fold says what comes back in the request it folds in, so its turn's start owes none" },
  { id: "where-held", moments: ["turn-start"], block: "where", part: "held", only: "loop", via: null, why: "the loop's turn start is told where a summary's head in the same request holds where it stands (`whereHeld`), and leaves the block out; a coding agent's start composes it all the same, and its bridge leaves it out where the seed or the catch-up that goes with its prompt holds it (context.js `notHeldIn`): the same rule, kept where each one's history is read" },
  { id: "next-tool-answer", moments: ["after-compact", "action"], block: null, part: null, only: null, via: "tool-answer", why: "an agent that takes words only once a step ended (Cursor's CLI) hears what comes at its calls at the tail of Filament's next tool answer to it (tool-tail.js): a steer would cancel its step. Where it calls none of Filament's tools before its turn ends, an action's blocks go with the turn — an unplanned line would be stale by then, memory's was for a call long past, and a long wait is weighed again in the turn that follows — while a compaction's block is owed to its next turn's start. A note's blocks ride the person's words, which go in at its next step all the same" },
]);

/** The blocks of each moment, in the order the agent hears them. */
const ORDER = Object.freeze({
  "turn-start": ["shell-exits", "file-news", "back", "still-open", "sealed", "where"],
  // A move to the loop tells its own commands that ended, as any start of its turn does (sw-loop).
  switch: ["shell-exits", "file-news", "handover", "sealed"],
  // The loop's fold tells its commands that exited after the summary, as any round's boundary does (loop.js
  // `tellShells`); a coding agent's come into its turn as they end (agent/commands.js): no block of the compaction's.
  "after-compact": ["back", "team", "sealed"],
  // What is still open, where a change waited long in the turn with nothing said of it (still-open.js `waited`): what
  // stands first, then what the call met.
  action: ["still-open", "memory", "unplanned", "drift"],
  tick: ["answer", "at-once", "next", "now", "started", "also-open"],
  // What the developer's words overrule is a delivery of its own (subagents.js `overruleFrames`), heard whole beside them.
  note: ["on-task"],
});

/** The fact each block is made of. @type {Readonly<Record<string, keyof Facts>>} */
const FACT = Object.freeze({
  "shell-exits": "exits",
  "file-news": "fileNews",
  back: "back",
  team: "team",
  "still-open": "open",
  sealed: "sealed",
  where: "where",
  handover: "handover",
  unplanned: "unplanned",
  drift: "drift",
  memory: "memory",
  answer: "answer",
  next: "next",
  "at-once": "atOnce",
  now: "now",
  "also-open": "alsoOpen",
  started: "started",
  "on-task": "onTask",
});

/**
 * Whether `reader` hears block `id` at `moment` at all: a block one kind alone hears (DIVERGENCE) is that kind's, the
 * envelopes' words are for an agent with the envelope tool, and a team's words for its lead. A checklist on the graph is
 * never a lead's (graph-runner.js `plan`), so its tick is composed for every reader alike.
 * @param {Moment} moment @param {Reader} reader @param {string} id @param {Facts} facts
 */
const hears = (moment, reader, id, facts) => {
  if (DIVERGENCE.some((d) => d.only && !d.part && d.only !== reader.kind && d.block === id && d.moments.includes(moment))) return false;
  if (id === "sealed" && !reader.envelopes) return false;
  if (id === "team" && !reader.lead) return false;
  // What comes back after a compaction a coding agent never heard rides its next turn's start in place of what it says
  // anew there (FabeleHelper's of 11-10: nothing twice): what is open, and where it stands where the block carries its
  // graph. The envelopes still sealed are no part of it, and are said after it.
  if (facts.back && facts.owed && (id === "still-open" || (id === "where" && facts.back.graph))) return false;
  if (id === "back" && moment === "turn-start" && !facts.owed) return false;
  if (id === "where" && facts.whereHeld) return false;
  return true;
};

/**
 * How the blocks of `moment` reach `reader`. A turn's start and a move ride the message that begins the turn; a tick,
 * the tool's answer. Mid-turn — a compaction, a call's end, a note — the loop's ride its next request, and a coding
 * agent's go into its running turn where it takes words while it works, else at the tail of Filament's next tool answer
 * to it (a steer to a `next` agent would cancel its step) — but a note's, which ride the person's words however those
 * go in.
 * @param {Moment} moment @param {Reader} reader @returns {Via}
 */
export const viaOf = (moment, reader) => {
  if (moment === "turn-start" || moment === "switch") return "message";
  if (moment === "tick") return "tool-answer";
  if (reader.kind === "loop") return "message";
  // A note's blocks ride the person's words, which go in however the agent takes words while it works.
  if (moment === "note") return "steer";
  return reader.steer === "queued" || reader.steer === "live" ? "steer" : "tool-answer";
};

/**
 * The blocks `reader` hears at `moment`, in order, from what stands (`facts`); how they reach it (`via`); and the blocks'
 * ids (`marks`) but a tick's answer, which is the tool's own — a caller that says them on the record by id reads them
 * here (acp-turn.js, a note's). What comes back after a coding agent's compaction that its turn never heard rides its
 * next turn's start (`owed`), composed again from what stands then; the rest stood for their moment alone.
 * @param {Moment} moment @param {Reader} reader @param {Facts} facts
 * @returns {{ blocks: Block[], via: Via, marks: string[] }}
 */
export function compose(moment, reader, facts) {
  /** @type {Block[]} */
  const blocks = [];
  for (const id of ORDER[moment]) {
    const fact = facts[FACT[id]];
    if (fact == null || fact === "" || !hears(moment, reader, id, facts)) continue;
    if (id === "back") blocks.push({ id, back: backFor(reader, /** @type {BackParts} */ (fact)) });
    else if (id === "file-news") blocks.push({ id, text: reader.kind === "loop" ? /** @type {any} */ (fact).text : /** @type {any} */ (fact).names });
    else blocks.push({ id, text: String(fact) });
  }
  return { blocks, via: viaOf(moment, reader), marks: blocks.filter((b) => b.id !== "answer").map((b) => b.id) };
}

/** What comes back for `reader`: the files the folded rounds used are the loop's alone (DIVERGENCE recent-files). @param {Reader} reader @param {BackParts} parts @returns {BackParts} */
const backFor = (reader, parts) => (reader.kind === "loop" ? parts : { ...parts, files: [] });

/** The text of the blocks that have one, in order. @param {readonly Block[]} blocks @param {string} [sep] */
export const textOf = (blocks, sep = "\n\n") =>
  blocks
    .map((b) => b.text || "")
    .filter(Boolean)
    .join(sep);

/** The blocks of a tick that follow the answer as lists, each on a line of its own; the rest run on in its line. */
const TICK_LINES = new Set(["started", "also-open"]);
/** A tick's blocks as one answer: the answer's own words, at-once, next and now in a line; what follows on lines. @param {readonly Block[]} blocks */
export const tickText = (blocks) => blocks.reduce((s, b) => (!b.text ? s : !s ? b.text : `${s}${TICK_LINES.has(b.id) ? "\n" : " "}${b.text}`), "");

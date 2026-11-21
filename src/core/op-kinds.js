// @ts-check
// The kinds of operation the op log records and the System tab shows: pure data, so the config schema (which offers
// them as chips) does not have to import the log itself.

// Kinds the System tab shows by default. The noisy ones are still RECORDED (the owner's choice: record everything,
// default-hide the firehose) — they just need their chip switched on, so a single turn cannot bury the audit trail.
export const OP_KINDS = {
  health: {
    label: "Health",
    hint: "An upstream failed, cooled down, recovered on a successful call, was reset, or reported a rate limit or quota. Also failovers.",
    noisy: false,
  },
  config: {
    label: "Config",
    hint: "The configuration was saved, reloaded from disk, a template applied, the console's assistant applied its draft, a key rotated, or the server shut down. A save, template apply and assistant apply all carry the redacted diff — which paths changed and to what, with credentials masked.",
    noisy: false,
  },
  job: {
    label: "Background job",
    hint: "An engine install, an import, a learn backfill, a mirror or a backup started, reached a milestone, or ended — including the ones that ended by refusing.",
    noisy: false,
  },
  compaction: {
    label: "Compaction",
    hint: "A session's compaction: the turns it made room of, how (a fold, one summary, the agent's own), its writer and what it left.",
    noisy: false,
  },
  learner: {
    label: "Learner",
    hint: "A learning run over a session: how many items it extracted, how long it took, whether it advanced the session's cursor.",
    noisy: false,
  },
  curator: {
    label: "Memory curator",
    hint: "A curator pass over a project's memory: how many memories it merged, keyed, checked and retired, the questions it asked you, its model calls, and whether it ran out of budget. Counts only; the pass itself is at /api/memory/curator/runs.",
    noisy: false,
  },
  engine: {
    label: "Memory engine",
    hint: "The Mnemosyne sidecar starting, becoming ready or degraded, restarting after failures, or printing an error line.",
    noisy: false,
  },
  agent: {
    label: "Coding agent",
    hint: "An agent session created, resumed or forgotten; a permission decision; a process exiting or being killed. Also the agent loop's turns (`agent/<model>`): started, paused, stopped or done, with round and tool-call counts.",
    noisy: false,
  },
  hook: {
    label: "Session hooks",
    hint: "A session hook ran (HarnessV2 §5.6): the moment (pre-tool, post-tool, turn-end, session-start, prompt-submit, pre-compact, subagent-end), the command, its exit and verdict — allow or block — and what it said. One per hook run.",
    noisy: false,
  },
  run: {
    label: "Run",
    hint: "A watched run — an agent turn or a sub-agent — starting or ending, with how many events it recorded; and the run log's retention sweep. Counts and ids only; the events themselves are under /api/runs.",
    noisy: false,
  },
  alert: {
    label: "Alert",
    hint: "Every alert Filament raised: failover, degraded memory engine, daily budget.",
    noisy: false,
  },
  archive: {
    label: "Archive",
    hint: "A session or project deleted, a backup written, a backup restored, the embeddings rebuilt, or a session's goal proposed (/goal). Compactions and imports are their own kinds; this is the archive-level operations.",
    noisy: false,
  },
  log: {
    label: "Warnings and errors",
    hint: "Anything Filament logged at warn or error level. Previously stdout-only and gone on restart.",
    noisy: false,
  },
  search: {
    label: "Searches",
    hint: "Every memory or archive search. Several per request, so hidden until you ask for it.",
    noisy: true,
  },
  engineop: {
    label: "Engine calls",
    hint: "Every call into the Mnemosyne engine, including the ones outside a request. Several per request.",
    noisy: true,
  },
  tool: {
    label: "Agent tool calls",
    hint: "Every tool call an agent made, and whether the client or Filament's own hands ran it. Many per turn.",
    noisy: true,
  },
  stream: {
    label: "Stream milestones",
    hint: "First byte and completion per request. Deliberately not wired: the request record already carries ttft and totalMs, and the Live tab shows in-flight requests, so a stream operation would only duplicate them.",
    noisy: true,
  },
};
export const OP_KIND_KEYS = Object.keys(OP_KINDS);
export const NOISY_OP_KINDS = OP_KIND_KEYS.filter((k) => OP_KINDS[k].noisy);
export const DEFAULT_OP_KINDS = OP_KIND_KEYS.filter((k) => !OP_KINDS[k].noisy);
// Which kinds actually have a producer today. The others are declared so the shape is stable and so the UI can say
// "nothing emits this yet" instead of rendering a chip that can never fill — an audit trail that advertises coverage it
// does not have is worse than one that admits its gaps. Wiring them is the remaining Phase B work.
export const WIRED_OP_KINDS = [
  "health",
  "config",
  "job",
  "compaction",
  "alert",
  "log",
  "agent",
  "learner",
  "curator",
  "engine",
  "hook",
  "run",
  "archive",
  "search",
  "engineop",
  "tool",
];

// @ts-check
// Outcome memory (HarnessV3-Memory M7-4): how a model's finished work went — a harness turn, a sub-agent's exchange or
// a team worker's (HarnessV3-AtHome P2) — kept as counts, never words. Here, pure: what a run did, read from its calls (M7-D49), and how a list of
// outcomes reads by model and kind, and by what each run did (M7-D52). It is a record the owner reads; nothing in
// Filament picks a model by it (M7-D54).
import { kindOfName } from "../../core/tool-vocab.js";
import { commandOf, commandParts, shapeOfWords, simpleCommands, targetOf, triggerTool } from "./triggers.js";

/**
 * What a run did, the most first (M7-D49, M7-D56): it ran tests, edited files, ran other commands, handed work on to a
 * sub-agent, read, or none of those.
 */
export const DID = Object.freeze(["tests", "edited", "ran", "delegated", "read", "answered"]);
/** The kinds of outcome (M7-D48): a harness turn, a sub-agent's exchange, a team worker's exchange (HarnessV3-AtHome P2). */
export const OUTCOME_KINDS = Object.freeze(["turn", "subagent", "worker"]);
/** How an outcome ended (M7-D48). */
export const ENDED = Object.freeze(["done", "failed", "stopped"]);
/** How long outcomes are kept (M7-D51). */
export const OUTCOME_DAYS = 365;

/** The call kinds that change files. */
const EDITS = new Set(["write", "edit", "edit-many", "notebook"]);
/** The call kinds that read: files, searches, folders, the web. */
const READS = new Set(["read", "search", "list", "web-fetch", "web-search"]);
/** Reads by name (M7-D56): the reader sub-agent, which reads for the run on whatever model it reads with. */
const READERS = new Set(["delegate_read"]);
/** Programs that run tests, as a command's head or the program a runner runs (`npx jest`, `uv run pytest`). */
const TEST_PROGRAMS = new Set([
  "pytest", "py.test", "jest", "vitest", "mocha", "ava", "tap", "rspec", "phpunit", "ctest", "tox", "nox", "karma",
  "playwright", "cypress", "unittest", "nose2", "jasmine", "busted", "prove",
]);
/** A subcommand, script or goal whose name says it tests: `test`, `t`, `test:unit`, `test-e2e`, `spec`, `e2e`. */
const TEST_NAME = /^(?:t|tests?|specs?|e2e)(?:$|[:_.-])|[:_.-](?:tests?|specs?|e2e)$/i;
/** The build tools that take goals rather than a subcommand: any goal that tests, or their `check` and `verify`. */
const GOALS = new Set(["make", "gradle", "gradlew", "mvn", "mvnw", "ant", "sbt", "rake", "bazel"]);

/**
 * Whether one simple command runs tests: a test program; a tool's subcommand that tests (`npm test`, `go test`, `cargo
 * test`, `yarn test:unit`); what a runner runs (`npm run test:e2e`, `uv run pytest`, `python -m pytest`); a build's
 * test goal (`./gradlew check`); `node --test`. A test run behind an option it cannot read (`pnpm -r test`) reads as
 * any other command. @param {string} simple
 */
export function runsTests(simple) {
  const { words } = commandParts(simple);
  const shape = shapeOfWords(words);
  if (!shape) return false;
  const [head, sub = ""] = shape.split(" ");
  if (TEST_PROGRAMS.has(head) || TEST_PROGRAMS.has(sub) || TEST_NAME.test(sub)) return true;
  if (head === "node") return words.some((w) => w === "--test" || w.startsWith("--test="));
  if (GOALS.has(head)) return words.slice(1).some((w) => !w.startsWith("-") && (TEST_NAME.test(w) || /^(?:check|verify)$/i.test(w)));
  const target = targetOf(words).replace(/^-m /, "");
  return TEST_PROGRAMS.has(target) || TEST_NAME.test(target);
}

/**
 * The tool calls of a conversation's assistant turns, as Anthropic blocks carry them (the agent loop's work, a
 * sub-agent's conversation). @param {any[]} messages @returns {{ name: string, input: any }[]}
 */
export function callsOf(messages) {
  /** @type {{ name: string, input: any }[]} */
  const out = [];
  for (const m of Array.isArray(messages) ? messages : [])
    if (m?.role === "assistant" && Array.isArray(m.content))
      for (const b of m.content) if (b?.type === "tool_use") out.push({ name: String(b.name || ""), input: b.input });
  return out;
}

/** @typedef {{ tests: number, edited: number, ran: number, delegated: number, read: number, other: number }} CallCounts */
/** The counts' kinds. @type {readonly (keyof CallCounts)[]} */
const COUNTED = Object.freeze(["tests", "edited", "ran", "delegated", "read", "other"]);

/**
 * How many calls of each kind (M7-D49, M7-D56): a shell command that runs tests, a file written or edited, any other
 * command, work handed on to a sub-agent or a team's worker, a read (files, searches, folders, the web, the reader
 * sub-agent), anything else (a question, the plan, memory, an MCP tool).
 * @param {{ name: string, input?: any }[]} calls @returns {CallCounts}
 */
export function countCalls(calls) {
  const n = { tests: 0, edited: 0, ran: 0, delegated: 0, read: 0, other: 0 };
  for (const c of calls) {
    const name = String(c.name || "").toLowerCase();
    const kind = kindOfName(c.name) ?? "";
    const command = triggerTool(c.name) === "bash" || kind === "shell" || kind === "shell-background" ? commandOf(c.input) : "";
    if (EDITS.has(kind)) n.edited++;
    else if (command) n[simpleCommands(command).some(runsTests) ? "tests" : "ran"]++;
    else if (READS.has(kind) || READERS.has(name)) n.read++;
    else if (kind === "subagent") n.delegated++;
    else n.other++;
  }
  return n;
}

/** What a run did, from its counts: the first of `DID` it reached. @param {CallCounts} n @returns {string} */
export const didOf = (n) => (n.tests ? "tests" : n.edited ? "edited" : n.ran ? "ran" : n.delegated ? "delegated" : n.read ? "read" : "answered");

/** How many calls the counts hold. @param {CallCounts} n */
export const callsIn = (n) => COUNTED.reduce((sum, k) => sum + (Number(n[k]) || 0), 0);

/**
 * How an agent loop's run ended, as an outcome says it (M7-D48): done, failed, or stopped (by the developer, a budget,
 * the deadline, the client leaving); null while it is paused, which is no end. @param {string} status
 */
export const endedOf = (status) => (status === "paused" ? null : status === "done" || status === "failed" ? status : "stopped");

/** What calls cost together: null when none of them has a price. @param {(number | null | undefined)[]} costs */
export function pricedSum(costs) {
  const known = costs.filter((c) => typeof c === "number");
  return known.length ? known.reduce((n, c) => n + /** @type {number} */ (c), 0) : null;
}

/**
 * What one model call spent, read off its request record: the prompt as the provider counted it, cached parts
 * included; the output; its cost, null with no price known (or no record).
 * @param {any} rec @returns {{ tokensIn: number, tokensOut: number, usd: number | null }}
 */
export function callSpend(rec) {
  const tk = rec?.tokens || {};
  return {
    tokensIn: (Number(tk.input) || 0) + (Number(tk.cacheRead) || 0) + (Number(tk.cacheWrite) || 0),
    tokensOut: Number(tk.output) || 0,
    usd: typeof rec?.cost === "number" ? rec.cost : null,
  };
}

/** @typedef {{ counts: CallCounts, tokensIn: number, tokensOut: number, usd: number | null, ms: number }} Spent  what a run spent so far */

/**
 * What a turn spent, its paused halves as one (M7-D48): a turn that never paused, its own; the cost known where either
 * half's is. @param {Spent | null} a  the half before the pause @param {Spent} b @returns {Spent}
 */
export const addSpent = (a, b) => !a ? b : ({
  counts: /** @type {CallCounts} */ (Object.fromEntries(COUNTED.map((k) => [k, (Number(a.counts[k]) || 0) + (Number(b.counts[k]) || 0)]))),
  tokensIn: a.tokensIn + b.tokensIn,
  tokensOut: a.tokensOut + b.tokensOut,
  usd: pricedSum([a.usd, b.usd]),
  ms: a.ms + b.ms,
});

/**
 * One finished piece of an agent's work as its writer knows it (M7-D48).
 * @typedef {object} OutcomeInput
 * @property {string} chain  its session
 * @property {number | null} [turn]  the session's turn it ran on; when not given, its request's
 * @property {string | null} request  the request it ran under: a turn's or a sub-agent run's own
 * @property {string} kind  turn, subagent or worker
 * @property {string | null} agent  a sub-agent's type, a worker's role
 * @property {string} model
 * @property {CallCounts} counts
 * @property {string} ended  done, failed or stopped
 * @property {number} rounds @property {number} tokensIn @property {number} tokensOut
 * @property {number | null} usd  null when no price is known
 * @property {number} ms
 */

/** The middle of a list of numbers (the mean of the middle two when even); null for none. @param {number[]} xs */
export function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * @typedef {object} OutcomeRow  one outcome as the archive keeps it
 * @property {string} kind  turn, subagent or worker
 * @property {string} model
 * @property {string} did
 * @property {string} ended  done, failed or stopped
 * @property {string | null} corrected  user, lead (a worker's outcome its lead corrected), or null
 * @property {number} rounds @property {number} calls @property {number} tokens_in @property {number} tokens_out
 * @property {number | null} usd  null when no price is known @property {number} ms
 */

/** A group's counts, with nothing in them yet. */
const tally = () => ({ runs: 0, held: 0, done: 0, failed: 0, stopped: 0, corrected: 0 });
/** @param {ReturnType<typeof tally>} t @param {OutcomeRow} r */
function count(t, r) {
  t.runs++;
  if (r.ended === "done") t.done++;
  else if (r.ended === "failed") t.failed++;
  else t.stopped++;
  if (r.corrected) t.corrected++;
  else if (r.ended === "done") t.held++;
}

/**
 * How models did (M7-D52): the outcomes grouped by model and kind, the most runs first. Each group: its runs; how many
 * were done, failed, stopped, corrected, and held (done and never corrected); its median rounds and time; its tokens;
 * its cost over the runs whose price is known (`priced` of them; null when none is), and per such run; and the same
 * counts for each thing its runs did, in `DID`'s order.
 * @param {OutcomeRow[]} rows
 */
export function outcomeTable(rows) {
  /** @type {Map<string, { model: string, kind: string, rows: OutcomeRow[] }>} */
  const groups = new Map();
  for (const r of rows) {
    const key = `${r.model}\u0000${r.kind}`;
    const g = groups.get(key) || { model: r.model, kind: r.kind, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ model, kind, rows: rs }) => {
      const all = tally();
      /** @type {Record<string, ReturnType<typeof tally>>} */
      const by = {};
      for (const r of rs) {
        count(all, r);
        count((by[r.did] ||= tally()), r);
      }
      const priced = rs.filter((r) => typeof r.usd === "number");
      const usd = priced.length ? priced.reduce((n, r) => n + /** @type {number} */ (r.usd), 0) : null;
      return {
        model,
        kind,
        ...all,
        rounds: median(rs.map((r) => r.rounds)),
        ms: median(rs.map((r) => r.ms)),
        tokensIn: rs.reduce((n, r) => n + r.tokens_in, 0),
        tokensOut: rs.reduce((n, r) => n + r.tokens_out, 0),
        priced: priced.length,
        usd: usd == null ? null : Math.round(usd * 1e6) / 1e6,
        usdPerRun: usd == null ? null : Math.round((usd / priced.length) * 1e6) / 1e6,
        did: DID.filter((d) => by[d]).map((d) => ({ did: d, ...by[d] })),
      };
    })
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model) || OUTCOME_KINDS.indexOf(a.kind) - OUTCOME_KINDS.indexOf(b.kind));
}

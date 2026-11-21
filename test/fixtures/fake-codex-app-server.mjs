#!/usr/bin/env node
// A fake `codex app-server` (HarnessV3-ACP AC2-1): Codex's JSON-RPC lines without the `jsonrpc` field, its handshake,
// account, models, threads and turns, scripted by the turn's text:
//   (anything)       an echo: one message, streamed
//   ~holds <n>       the echo's model call reads n tokens: the thread's context holds that
//   ~work            reasoning, a file read, a command with output, a file change, a plan, then words
//   ~readboth        one command that reads two files (`cat a.txt b.txt`, two `read` actions), then words
//   ~approve         a command that asks approval first, with Codex's proposed rule, run or declined by the answer
//   ~patch-approve   a file change that asks approval first
//   ~more-access     a request for network access
//   ~subagent        a sub-agent: a spawn call, the child thread's own items, a wait that reports it
//   ~subagent-slow   the same, its thread starting a while after the call (FAKE_CODEX_SPAWN_MS, 800 by default)
//   ~subagent-approve  a sub-agent's command that asks approval first, from the sub-agent's own thread
//   ~read-approve    a command that only reads, asking approval first
//   ~ps-read-approve, ~ps-approve  a command as Codex words one on Windows — its argv, PowerShell and `-Command` before
//                    the script, each word quoted as a POSIX shell would — that only reads, or removes a folder;
//                    FAKE_CODEX_POWERSHELL names the PowerShell
//   ~net-approve     a command asking approval to reach the network host it wants
//   ~fail            the turn fails on the plan's usage limit
//   ~fail-unsaid     the same, its end leaving the error to the notification before it
//   ~fail-spent      the same after a model call — its words, its usage — as a turn whose next call hits the limit
//   ~fail-calls      the same after two model calls, each with its usage
//   ~nextfails       an echo, and the thread's next turn fails on the plan's usage limit, saying and spending nothing
//   ~reroute         an echo, Codex having moved the turn to gpt-6-nano (model/rerouted)
//   ~stray-child     a sub-agent thread of this thread's that no reported call spawned
//   ~slow            words, then nothing until interrupted
//   ~ask             a question for the person (requestUserInput)
//   ~ask-withdrawn   the same, withdrawn (serverRequest/resolved) as Codex goes on without it
//   ~ask-nothing     a question that asks nothing
//   ~ask-crash       a question, the app-server exiting while it waits
//   ~elicit          an MCP server's form for the person (mcpServer/elicitation/request)
//   ~elicit-odd      the same, a form that asks nothing
//   ~mcp-approve     an MCP server's tool, Codex asking first as it does: the item started, then a form that asks
//                    nothing with the approval in its `_meta`; the tool runs on an accept, else fails as Codex says
//   ~compact         Codex compacts its context
//   ~rename          Codex names the thread
//   ~limits          an update of the plan's windows, then words
//   ~account-change  another account signs in (account/updated); words once Filament has read its windows
//   ~crash           words, then the app-server exits (code 3)
//   ~lastwords       words, then, once FAKE_CODEX_EXIT_GATE (a file) is there, its last words and the turn's end, and
//                    the app-server exits (code 3): a test holds its output meanwhile, so Node says it exited before
//                    that is read (the bug report's X4)
//   ~steer           words, then nothing until the person's words come in (turn/steer), said back as `heard:<words>`;
//                    the turn ends after them unless they say ~again; a command each time the test ticks
//                    (FAKE_CODEX_TICK_DIR); with ~compactfirst, Codex compacts its context before its words; with
//                    ~twoedits, it changes two files after them; with ~threefails, `npm test` fails three times in a
//                    row after them — with ~editbetween, a patch of a.txt, then of b.txt, between the runs
//                    — with ~threefolders, it fails once in each of three folders; with ~onerun, it runs once and passes
//   ~mcpcall <tool> <json>  a call of one of Filament's own tools over the MCP server its thread was given, its answer
//                    said back as `mcp:<text>`
//   ~review          a review turn, which takes no words (turn/steer refused) and runs until interrupted; it ticks too
// A turn/start on a thread a turn runs on goes into that turn, its words as turn/steer's, and the turn it names never
// starts: Codex as seen live (the bug report's X5).
// Filament's summary instruction (HarnessV3-ACP AC5-4) is answered with what the thread heard before it, in the shape
// asked for, its usage mostly read from the cache — in a fork of a thread (`thread/fork`), which holds what the thread
// heard; FAKE_CODEX_SUMMARY_TRIES=1: first a command that asks approval, run or declined by the answer;
// FAKE_CODEX_SUMMARY_GATE: a file it waits for before it answers.
// Codex compacting a thread when asked (`thread/compact/start`, AC5-5): a turn of its own, its one item the
// compaction, the thread then holding a summary of what it heard; FAKE_CODEX_COMPACT=fail fails that turn instead, and
// FAKE_CODEX_COMPACT_GATE names a file it waits for before it compacts, an interrupt meanwhile ending it.
// `thread/delete` forgets a thread. FAKE_CODEX_DROP_MS: `thread/unsubscribe` and `thread/delete` are answered after
// this long, each saying so in FAKE_CODEX_CALLS (`<method> answered`) as it is.
// FAKE_CODEX_SIGNED_OUT=1 reads as signed out; `provider`, as signed out with no sign-in needed (Codex on a configured
// provider); a file's path, as signed out until that file is there (a sign-in in a terminal); `home`, as signed out
// until `<CODEX_HOME>/fake-auth.json` is there (AC3-7). Its own sign-in (`account/login/start`, ChatGPT's page or a
// code for another computer's) completes after FAKE_CODEX_LOGIN_MS (150 by default), keeping the login in CODEX_HOME —
// FAKE_CODEX_LOGIN=fail fails it, `wait` never ends it until `account/login/cancel`; `account/logout` clears it.
// Run as `codex login` (`login` its first argument), it signs in in CODEX_HOME and exits 0. FAKE_CODEX_LIMITS_FAIL=1
// refuses the plan's windows; FAKE_CODEX_START_FAIL=1 exits at its start, saying why on stderr; FAKE_CODEX_RESUME_FAIL=1 refuses thread/resume; FAKE_CODEX_INJECT_FAIL=1 refuses
// thread/inject_items; FAKE_CODEX_OVERFLOW_SEEDED=1 fails a turn on a thread given history items as too long for
// its window; FAKE_CODEX_READONLY=1 makes workspace-write read-only, as on an unset-up Windows, and `all` full access
// too, as a managed machine's requirements would;
// FAKE_CODEX_SLOW_START_MS: thread/start answers after this long, so a turn can be caught while its thread opens.
// FAKE_CODEX_FAIL_QUIET=1: every turn fails on the plan's usage limit after a model call that said nothing, its usage alone.
// FAKE_CODEX_INIT_GATE: a file; initialize is answered once it is there.
// FAKE_CODEX_THREAD_MODEL: the model a thread says it is on as it starts or resumes, whatever it was asked for.
// FAKE_CODEX_CALLS names a file each message the fake hears is appended to. FAKE_CODEX_SPENT=1: the plan's 5-hour
// window is spent (Codex says `rate_limit_reached`), the account has no credits and two reset credits, and
// `account/rateLimitResetCredit/consume` spends one — its key once, `alreadyRedeemed` again. FAKE_CODEX_CONSUME_LOST=1
// loses the first one's answer, an error in its place, as a timeout would.
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { personWords } from "./person-words.mjs";

const env = process.env;
/** The login kept in CODEX_HOME, where FAKE_CODEX_SIGNED_OUT is `home`. */
const homeAuth = join(env.CODEX_HOME || ".", "fake-auth.json");
if (process.argv[2] === "login") {
  process.stdout.write(`Signing in to the fake Codex in ${env.CODEX_HOME || "its usual folder"}\r\n`);
  writeFileSync(homeAuth, JSON.stringify({ email: "dev@example.com" }));
  process.exit(0);
}
if (env.FAKE_CODEX_START_FAIL === "1") {
  process.stderr.write("Error: failed to initialize sqlite state runtime under ~/.codex\n");
  process.exit(1);
}
/** Whether no account is signed in now (FAKE_CODEX_SIGNED_OUT). */
const signedOut = () => {
  const s = env.FAKE_CODEX_SIGNED_OUT || "";
  if (s === "home") return !existsSync(homeAuth);
  return s === "1" || s === "provider" || (!!s && !existsSync(s));
};
/** The sign-in under way: its id and how it ends early. @type {{ id: string, timer: any } | null} */
let login = null;
/**
 * The account signed in; `~account-change` signs another in. An OpenAI API key's login (`account/login/start` of type
 * `apiKey`) keeps the key in CODEX_HOME, as Codex keeps it in its auth.json, and reads as Codex's `apiKey` account in
 * every app-server started after; a key that doesn't start `sk-` is refused, in words that repeat it.
 */
let account = /** @type {any} */ (existsSync(homeAuth) && JSON.parse(readFileSync(homeAuth, "utf8")).OPENAI_API_KEY ? { type: "apiKey" } : { type: "chatgpt", email: "dev@example.com", planType: "plus" });
/** Whether the plan is spent (FAKE_CODEX_SPENT), its reset credits left, and the keys a credit was spent with. */
let spent = env.FAKE_CODEX_SPENT === "1";
let resetCredits = 2;
const redeemed = new Set();
/** Who waits for Filament to read the account's windows again. @type {(() => void) | null} */
let reread = null;
let buf = "";
let nextId = 1000;
/** Requests the fake sent, waiting for Filament's answer. @type {Map<number, (msg: any) => void>} */
const waiting = new Map();
/** @type {Map<string, { id: string, cwd: string, name: string | null, parent: string | null, heard?: string[], ephemeral?: boolean, injected?: boolean }>} */
const threads = new Map();
/** The turn running per thread: its id, how an interrupt ends it, what it does with words steered in, and whether it is a
 *  review, which takes none. @type {Map<string, { id: string, onInterrupt: (() => void) | null, onSteer?: ((text: string, pictures?: number) => void) | null, review?: boolean }>} */
const running = new Map();

/** @param {any} msg */
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");
/** @param {string} method @param {any} params */
const notify = (method, params) => send({ method, params });
/** A request of the fake's own, answered by Filament. @param {string} method @param {any} params */
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    send({ id, method, params });
  });
const tick = () => new Promise((r) => setTimeout(r, 5));
/** A thread let go of, answered after FAKE_CODEX_DROP_MS where that is set. @param {string} method @param {string} threadId */
const dropped = async (method, threadId) => {
  if (!env.FAKE_CODEX_DROP_MS) return;
  await new Promise((r) => setTimeout(r, Number(env.FAKE_CODEX_DROP_MS)));
  if (env.FAKE_CODEX_CALLS) appendFileSync(env.FAKE_CODEX_CALLS, JSON.stringify({ method: `${method} answered`, params: { threadId } }) + "\n");
};

const MODELS = [
  {
    id: "gpt-6-astra",
    model: "gpt-6-astra",
    displayName: "GPT-6-Astra",
    description: "Latest frontier agentic coding model.",
    hidden: false,
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
  },
  {
    id: "gpt-5.6-terra",
    model: "gpt-5.6-terra",
    displayName: "GPT-5.6-Terra",
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: "low",
    supportedReasoningEfforts: ["low", "medium"].map((reasoningEffort) => ({ reasoningEffort, description: "" })),
  },
  { id: "codex-internal", model: "codex-internal", displayName: "Hidden", hidden: true, isDefault: false, supportedReasoningEfforts: [] },
];

/** The sandbox a thread gets for the one asked. @param {string | undefined} mode */
const sandboxOf = (mode) =>
  mode === "danger-full-access" && env.FAKE_CODEX_READONLY !== "all"
    ? { type: "dangerFullAccess" }
    : mode === "read-only" || env.FAKE_CODEX_READONLY === "1" || env.FAKE_CODEX_READONLY === "all"
      ? { type: "readOnly", networkAccess: false }
      : { type: "workspaceWrite", writableRoots: [], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false };

/** Token counts of one call. @param {number} input @param {number} cached @param {number} output */
const counts = (input, cached, output) => ({
  totalTokens: input + output,
  inputTokens: input,
  cachedInputTokens: cached,
  cacheWriteInputTokens: 0,
  outputTokens: output,
  reasoningOutputTokens: 0,
});
/** A thread's running total, the turn's first call adding to it. @type {Map<string, any>} */
const totals = new Map();
/** @param {string} threadId @param {string} turnId @param {number} input @param {number} cached @param {number} output */
function usage(threadId, turnId, input, cached, output) {
  const last = counts(input, cached, output);
  const was = totals.get(threadId) || counts(0, 0, 0);
  const total = Object.fromEntries(Object.keys(last).map((k) => [k, was[k] + last[k]]));
  totals.set(threadId, total);
  notify("thread/tokenUsage/updated", { threadId, turnId, tokenUsage: { total, last, modelContextWindow: 400000 } });
}

/** An item that starts and ends at once. @param {string} threadId @param {string} turnId @param {any} item */
function whole(threadId, turnId, item) {
  notify("item/started", { threadId, turnId, item: { ...item, status: "inProgress" } });
  notify("item/completed", { threadId, turnId, item });
}

/** The threads whose words are streaming: a test's tick waits for them (`ticks`). @type {Map<string, number>} */
const speaking = new Map();

/** Words, streamed. @param {string} threadId @param {string} turnId @param {string} text */
async function say(threadId, turnId, text) {
  const id = `msg_${randomUUID().slice(0, 8)}`;
  speaking.set(threadId, (speaking.get(threadId) || 0) + 1);
  notify("item/started", { threadId, turnId, item: { type: "agentMessage", id, text: "" } });
  for (const part of text.match(/.{1,12}/gs) || []) {
    notify("item/agentMessage/delta", { threadId, turnId, itemId: id, delta: part });
    await tick();
  }
  notify("item/completed", { threadId, turnId, item: { type: "agentMessage", id, text, phase: "final_answer" } });
  speaking.set(threadId, (speaking.get(threadId) || 1) - 1);
}

/**
 * FAKE_CODEX_TICK_DIR: the turn's next step, when the test says so — a file `tick` there is a command Codex runs and
 * ends at once, while the turn runs: words that wait in Filament for the agent's next call go then (HarnessV4_Tasks C34).
 * @param {string} threadId @param {string} turnId
 */
function ticks(threadId, turnId) {
  const dir = process.env.FAKE_CODEX_TICK_DIR;
  if (!dir) return;
  let k = 0;
  const ticker = setInterval(() => {
    if (running.get(threadId)?.id !== turnId) return clearInterval(ticker);
    const f = join(dir, "tick");
    // Between its words, as an agent's next call comes.
    if (!existsSync(f) || speaking.get(threadId)) return;
    rmSync(f, { force: true });
    const command = "true";
    whole(threadId, turnId, { type: "commandExecution", id: `tick_${++k}`, command, cwd: ".", status: "completed", commandActions: [{ type: "unknown", command }], aggregatedOutput: "", exitCode: 0, durationMs: 1 });
  }, 20);
}

/** The end of a turn. @param {string} threadId @param {string} turnId @param {string} status @param {any} [error] */
function end(threadId, turnId, status, error = null) {
  running.delete(threadId);
  notify("turn/completed", { threadId, turn: { id: turnId, status, error, items: [] } });
}

/** Codex compacting a thread when asked. @param {string} threadId @param {string} turnId */
async function compactThread(threadId, turnId) {
  /** @type {{ id: string, onInterrupt: (() => void) | null }} */
  const turn = { id: turnId, onInterrupt: null };
  running.set(threadId, turn);
  notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress", items: [] } });
  const gate = env.FAKE_CODEX_COMPACT_GATE;
  if (gate) {
    let stopped = false;
    turn.onInterrupt = () => (stopped = true);
    while (!existsSync(gate) && !stopped) await tick();
    if (stopped) return end(threadId, turnId, "interrupted");
    turn.onInterrupt = null;
  }
  if (env.FAKE_CODEX_COMPACT === "fail") {
    const error = { message: "stream disconnected before completion: the compaction's request failed", codexErrorInfo: "other", additionalDetails: null };
    notify("error", { threadId, turnId, error, willRetry: false });
    return end(threadId, turnId, "failed", error);
  }
  whole(threadId, turnId, { type: "contextCompaction", id: `cmp_${randomUUID().slice(0, 8)}` });
  notify("thread/compacted", { threadId, turnId });
  usage(threadId, turnId, 120000, 118000, 2400);
  const thread = threads.get(threadId);
  if (thread) thread.heard = [`[compacted: ${(thread.heard || []).join(" | ")}]`];
  end(threadId, turnId, "completed");
}

let mcpCalls = 0;
/**
 * `~mcpcall <tool> <json>`: a call of one of Filament's own tools over the MCP server its thread was given (its config's
 * `mcp_servers.filament`), as Codex makes one — an `mcpToolCall` item —, its answer said back: `mcp:<text>`,
 * `mcp:error:<text>` for a call it refused, `mcperr:<why>` where none answered.
 * @param {string} threadId @param {string} turnId @param {string} text
 */
async function mcpCall(threadId, turnId, text) {
  const asked = /~mcpcall (\S+) (\{.*\})/.exec(text);
  if (!asked) return;
  const url = threads.get(threadId)?.mcpUrl;
  const args = JSON.parse(asked[2]);
  const item = { type: "mcpToolCall", id: `mcp_${++mcpCalls}`, server: "filament", tool: asked[1], arguments: args, result: null, error: null, durationMs: null };
  notify("item/started", { threadId, turnId, item: { ...item, status: "inProgress" } });
  // The call goes out a moment after its item started, as Codex's does: the two reach Filament by two ways.
  await new Promise((r) => setTimeout(r, 50));
  const r = url
    ? await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: asked[1], arguments: args } }) })
        .then((x) => x.json())
        .catch((e) => ({ error: { message: e.message } }))
    : { error: { message: "no MCP server" } };
  const words = (r.result?.content || []).map((/** @type {any} */ c) => c.text).join("");
  const answer = r.error ? `mcperr:${r.error.message}` : `mcp:${r.result?.isError ? "error:" : ""}${words}`;
  const done = r.error || r.result?.isError ? { status: "failed", error: { message: r.error?.message || words } } : { status: "completed", result: { content: r.result.content, structuredContent: null } };
  notify("item/completed", { threadId, turnId, item: { ...item, ...done, durationMs: 5 } });
  await say(threadId, turnId, answer);
}

/** @param {string} threadId @param {string} turnId @param {string} text */
async function play(threadId, turnId, text) {
  notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress", items: [] } });
  if (text.startsWith("[Filament: this conversation has reached its compaction line.")) {
    if (env.FAKE_CODEX_SUMMARY_TRIES === "1") {
      const item = { type: "commandExecution", id: "cmd_sum", command: "touch notes.md", cwd: ".", commandActions: [{ type: "unknown", command: "touch notes.md" }] };
      notify("item/started", { threadId, turnId, item: { ...item, status: "inProgress" } });
      const answer = await ask("item/commandExecution/requestApproval", { threadId, turnId, itemId: item.id, command: item.command, cwd: ".", commandActions: item.commandActions, startedAtMs: Date.now() });
      notify("item/completed", { threadId, turnId, item: { ...item, status: answer?.result?.decision === "accept" ? "completed" : "declined" } });
    }
    const gate = env.FAKE_CODEX_SUMMARY_GATE;
    if (gate) while (!existsSync(gate)) await tick();
    usage(threadId, turnId, 40, 900, 30);
    await say(threadId, turnId, `<analysis>Going through it.</analysis>\n<summary>The thread heard: ${(threads.get(threadId)?.heard || []).slice(0, -1).join(" | ")}</summary>`);
    return end(threadId, turnId, "completed");
  }
  const script = /~([a-z-]+)/.exec(text)?.[1] || "";
  // A thread a `~nextfails` turn marked: this turn fails on the plan's usage limit, saying nothing and spending nothing.
  const marked = threads.get(threadId);
  if (marked?.failNext) {
    marked.failNext = false;
    const error = { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded", additionalDetails: null };
    notify("error", { threadId, turnId, error, willRetry: false });
    return end(threadId, turnId, "failed", error);
  }
  if (script === "nextfails" && marked) marked.failNext = true;
  if (script === "reroute") notify("model/rerouted", { threadId, turnId, fromModel: "gpt-6-astra", toModel: "gpt-6-nano", reason: "capacity" });
  if (script === "mcpcall") {
    await mcpCall(threadId, turnId, text);
    return end(threadId, turnId, "completed");
  }
  if (env.FAKE_CODEX_FAIL_QUIET === "1") {
    usage(threadId, turnId, 1400, 1000, 50);
    const error = { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded", additionalDetails: null };
    notify("error", { threadId, turnId, error, willRetry: false });
    return end(threadId, turnId, "failed", error);
  }
  if (env.FAKE_CODEX_OVERFLOW_SEEDED === "1" && threads.get(threadId)?.injected) {
    const error = { message: "Codex ran out of room in the model's context window.", codexErrorInfo: "contextWindowExceeded", additionalDetails: null };
    notify("error", { threadId, turnId, error, willRetry: false });
    return end(threadId, turnId, "failed", error);
  }
  if (script === "work") {
    const r = "rsn_1";
    notify("item/started", { threadId, turnId, item: { type: "reasoning", id: r, summary: [], content: [] } });
    notify("item/reasoning/summaryTextDelta", { threadId, turnId, itemId: r, delta: "Reading the file", summaryIndex: 0 });
    notify("item/completed", { threadId, turnId, item: { type: "reasoning", id: r, summary: ["Reading the file"], content: [] } });
    whole(threadId, turnId, {
      type: "commandExecution",
      id: "cmd_read",
      command: "cat notes.txt",
      cwd: ".",
      status: "completed",
      commandActions: [{ type: "read", command: "cat notes.txt", name: "notes.txt", path: "notes.txt" }],
      aggregatedOutput: "hello\n",
      exitCode: 0,
      durationMs: 3,
    });
    notify("item/started", { threadId, turnId, item: { type: "commandExecution", id: "cmd_run", command: "npm test", cwd: ".", status: "inProgress", commandActions: [{ type: "unknown", command: "npm test" }] } });
    notify("item/commandExecution/outputDelta", { threadId, turnId, itemId: "cmd_run", delta: "ok 1\n" });
    notify("item/commandExecution/outputDelta", { threadId, turnId, itemId: "cmd_run", delta: "ok 2\n" });
    notify("item/completed", { threadId, turnId, item: { type: "commandExecution", id: "cmd_run", command: "npm test", cwd: ".", status: "completed", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: "ok 1\nok 2\n", exitCode: 0, durationMs: 40 } });
    const changes = [{ path: "notes.txt", kind: { type: "update", move_path: null }, diff: "@@ -1 +1,2 @@\n hello\n+world\n" }];
    notify("item/started", { threadId, turnId, item: { type: "fileChange", id: "patch_1", changes, status: "inProgress" } });
    notify("item/completed", { threadId, turnId, item: { type: "fileChange", id: "patch_1", changes, status: "completed" } });
    notify("turn/plan/updated", { threadId, turnId, explanation: null, plan: [{ step: "Read notes", status: "completed" }, { step: "Add a line", status: "inProgress" }] });
    usage(threadId, turnId, 1200, 1000, 40);
    usage(threadId, turnId, 1500, 1200, 30);
    await say(threadId, turnId, "Added a line to notes.txt.");
    return end(threadId, turnId, "completed");
  }
  if (script === "readboth") {
    const command = "cat a.txt b.txt";
    whole(threadId, turnId, {
      type: "commandExecution",
      id: "cmd_both",
      command,
      cwd: ".",
      status: "completed",
      commandActions: [
        { type: "read", command: "cat a.txt", name: "a.txt", path: "a.txt" },
        { type: "read", command: "cat b.txt", name: "b.txt", path: "b.txt" },
      ],
      aggregatedOutput: "a\nb\n",
      exitCode: 0,
      durationMs: 3,
    });
    await say(threadId, turnId, "Read both.");
    return end(threadId, turnId, "completed");
  }
  if (script === "approve" || script === "read-approve" || script === "ps-approve" || script === "ps-read-approve") {
    /** A word as Rust's shlex writes it: bare, in '…', or in "…" when it holds a backslash. @param {string} w */
    const worded = (w) => (/^[A-Za-z0-9_+\-./:@]+$/.test(w) ? w : /[\\']/.test(w) ? `"${w.replace(/(["\\$`])/g, "\\$1")}"` : `'${w}'`);
    const ps = [env.FAKE_CODEX_POWERSHELL || "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", "-Command", script === "ps-approve" ? "Remove-Item -Recurse build" : "Get-Content a.txt | Select-Object -First 2"].map(worded).join(" ");
    const item =
      script === "approve"
        ? { type: "commandExecution", id: "cmd_rm", command: "rm -rf build", cwd: ".", commandActions: [{ type: "unknown", command: "rm -rf build" }] }
        : script === "read-approve"
          ? { type: "commandExecution", id: "cmd_cat", command: "cat a.txt", cwd: ".", commandActions: [{ type: "read", command: "cat a.txt", name: "a.txt", path: "a.txt" }] }
          : { type: "commandExecution", id: "cmd_ps", command: ps, cwd: ".", commandActions: [{ type: "unknown", command: ps }] };
    notify("item/started", { threadId, turnId, item: { ...item, status: "inProgress" } });
    const rule = script === "approve" ? ["rm", "-rf", "build"] : null;
    const answer = await ask("item/commandExecution/requestApproval", { threadId, turnId, itemId: item.id, command: item.command, cwd: ".", commandActions: item.commandActions, proposedExecpolicyAmendment: rule, startedAtMs: Date.now() });
    const decision = answer?.result?.decision;
    const ok = decision === "accept" || decision === "acceptForSession" || !!decision?.acceptWithExecpolicyAmendment;
    notify("item/completed", { threadId, turnId, item: { ...item, status: ok ? "completed" : "declined", aggregatedOutput: ok ? "done\n" : "", exitCode: ok ? 0 : null } });
    await say(threadId, turnId, `decision: ${typeof decision === "string" ? decision : JSON.stringify(decision)}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "net-approve") {
    const item = { type: "commandExecution", id: "cmd_npm", command: "npm install", cwd: ".", commandActions: [{ type: "unknown", command: "npm install" }] };
    notify("item/started", { threadId, turnId, item: { ...item, status: "inProgress" } });
    const answer = await ask("item/commandExecution/requestApproval", { threadId, turnId, itemId: item.id, command: item.command, cwd: ".", commandActions: item.commandActions, networkApprovalContext: { host: "registry.npmjs.org", protocol: "https" }, startedAtMs: Date.now() });
    const decision = answer?.result?.decision;
    notify("item/completed", { threadId, turnId, item: { ...item, status: decision === "accept" ? "completed" : "declined", aggregatedOutput: "", exitCode: decision === "accept" ? 0 : null } });
    await say(threadId, turnId, `decision: ${typeof decision === "string" ? decision : JSON.stringify(decision)}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "patch-approve") {
    const changes = [{ path: "a.txt", kind: { type: "add" }, diff: "one\ntwo\n" }];
    notify("item/started", { threadId, turnId, item: { type: "fileChange", id: "patch_ask", changes, status: "inProgress" } });
    const answer = await ask("item/fileChange/requestApproval", { threadId, turnId, itemId: "patch_ask", startedAtMs: Date.now() });
    const ok = answer?.result?.decision === "accept" || answer?.result?.decision === "acceptForSession";
    notify("item/completed", { threadId, turnId, item: { type: "fileChange", id: "patch_ask", changes, status: ok ? "completed" : "declined" } });
    await say(threadId, turnId, `decision: ${answer?.result?.decision}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "more-access") {
    const answer = await ask("item/permissions/requestApproval", { threadId, turnId, itemId: "perm_1", cwd: ".", reason: "fetch a page", permissions: { network: { enabled: true }, fileSystem: null }, startedAtMs: Date.now() });
    await say(threadId, turnId, `granted: ${JSON.stringify(answer?.result?.permissions)}${answer?.result?.scope === "session" ? " for the session" : ""}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "subagent" || script === "subagent-slow") {
    const child = randomUUID();
    threads.set(child, { id: child, cwd: ".", name: null, parent: threadId });
    const spawn = { type: "collabAgentToolCall", id: "spawn_1", tool: "spawnAgent", senderThreadId: threadId, receiverThreadIds: [], prompt: "count the files", model: "gpt-5.6-terra", reasoningEffort: "low", agentsStates: {} };
    notify("item/started", { threadId, turnId, item: { ...spawn, status: "inProgress" } });
    if (script === "subagent-slow") await new Promise((r) => setTimeout(r, Number(env.FAKE_CODEX_SPAWN_MS) || 800));
    notify("thread/started", { thread: { id: child, parentThreadId: threadId, cwd: "." } });
    notify("item/completed", { threadId, turnId, item: { ...spawn, status: "completed", receiverThreadIds: [child] } });
    const childTurn = `turn_${randomUUID().slice(0, 8)}`;
    notify("turn/started", { threadId: child, turn: { id: childTurn, status: "inProgress", items: [] } });
    notify("item/started", { threadId: child, turnId: childTurn, item: { type: "reasoning", id: "c_rsn", summary: [], content: [] } });
    notify("item/reasoning/summaryTextDelta", { threadId: child, turnId: childTurn, itemId: "c_rsn", delta: "Counting", summaryIndex: 0 });
    notify("item/completed", { threadId: child, turnId: childTurn, item: { type: "reasoning", id: "c_rsn", summary: ["Counting"], content: [] } });
    whole(child, childTurn, { type: "commandExecution", id: "c_ls", command: "ls", cwd: ".", status: "completed", commandActions: [{ type: "listFiles", command: "ls", path: "." }], aggregatedOutput: "a\nb\n", exitCode: 0 });
    await say(child, childTurn, "There are 2 files.");
    usage(child, childTurn, 300, 0, 20);
    notify("turn/completed", { threadId: child, turn: { id: childTurn, status: "completed", error: null, items: [] } });
    whole(threadId, turnId, { type: "collabAgentToolCall", id: "wait_1", tool: "wait", status: "completed", senderThreadId: threadId, receiverThreadIds: [child], prompt: null, model: null, reasoningEffort: null, agentsStates: { [child]: { status: "completed", message: "There are 2 files." } } });
    usage(threadId, turnId, 800, 0, 25);
    await say(threadId, turnId, "The sub-agent counted 2 files.");
    return end(threadId, turnId, "completed");
  }
  if (script === "subagent-approve") {
    const child = randomUUID();
    threads.set(child, { id: child, cwd: ".", name: null, parent: threadId });
    const spawn = { type: "collabAgentToolCall", id: "spawn_2", tool: "spawnAgent", senderThreadId: threadId, receiverThreadIds: [], prompt: "clean the build", model: "gpt-5.6-terra", reasoningEffort: "low", agentsStates: {} };
    notify("item/started", { threadId, turnId, item: { ...spawn, status: "inProgress" } });
    notify("thread/started", { thread: { id: child, parentThreadId: threadId, cwd: "." } });
    notify("item/completed", { threadId, turnId, item: { ...spawn, status: "completed", receiverThreadIds: [child] } });
    const childTurn = `turn_${randomUUID().slice(0, 8)}`;
    notify("turn/started", { threadId: child, turn: { id: childTurn, status: "inProgress", items: [] } });
    const item = { type: "commandExecution", id: "c_rm", command: "rm -rf build", cwd: ".", commandActions: [{ type: "unknown", command: "rm -rf build" }] };
    notify("item/started", { threadId: child, turnId: childTurn, item: { ...item, status: "inProgress" } });
    const answer = await ask("item/commandExecution/requestApproval", { threadId: child, turnId: childTurn, itemId: item.id, command: item.command, cwd: ".", commandActions: item.commandActions, proposedExecpolicyAmendment: null, startedAtMs: Date.now() });
    const decision = answer?.result?.decision;
    notify("item/completed", { threadId: child, turnId: childTurn, item: { ...item, status: decision === "accept" ? "completed" : "declined", aggregatedOutput: "", exitCode: decision === "accept" ? 0 : null } });
    notify("turn/completed", { threadId: child, turn: { id: childTurn, status: "completed", error: null, items: [] } });
    await say(threadId, turnId, `the sub-agent's decision: ${JSON.stringify(decision)}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "fail" || script === "fail-unsaid" || script === "fail-spent" || script === "fail-calls") {
    if (script === "fail-spent") {
      await say(threadId, turnId, "Starting on it.");
      usage(threadId, turnId, 1400, 1000, 50);
    }
    if (script === "fail-calls") {
      await say(threadId, turnId, "Two calls in.");
      usage(threadId, turnId, 1000, 800, 20);
      usage(threadId, turnId, 1500, 1200, 30);
    }
    const error = { message: "You've hit your usage limit.", codexErrorInfo: "usageLimitExceeded", additionalDetails: null };
    notify("error", { threadId, turnId, error, willRetry: false });
    return end(threadId, turnId, "failed", script === "fail-unsaid" ? null : error);
  }
  if (script === "steer") {
    const turn = running.get(threadId);
    if (turn) {
      turn.onInterrupt = () => end(threadId, turnId, "interrupted");
      // The answer comes a moment after the words were taken, as the model's next call's would; one at a time. Pictures
      // that came with them are said back by their count (`[1 picture]`).
      let answering = Promise.resolve();
      turn.onSteer = (words, pictures = 0) => {
        answering = answering
          .then(() => new Promise((r) => setTimeout(r, 20)))
          .then(() => say(threadId, turnId, `heard:${words}${pictures ? ` [${pictures} picture${pictures === 1 ? "" : "s"}]` : ""}`))
          .then(() => (/~again\b/.test(words) ? undefined : end(threadId, turnId, "completed")));
      };
    }
    // `~compactfirst`: Codex compacts its context before its words, as it does before a model call.
    if (/~compactfirst\b/.test(text)) {
      whole(threadId, turnId, { type: "contextCompaction", id: "cmp_s" });
      notify("thread/compacted", { threadId, turnId });
    }
    await say(threadId, turnId, "Working on it…");
    // `~twoedits`: Codex changes two files of its folder before its next step, each change completed.
    if (/~twoedits\b/.test(text))
      for (const [id, path] of [["patch_a", "a.txt"], ["patch_b", "b.txt"]]) {
        const changes = [{ path, kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b\n" }];
        notify("item/started", { threadId, turnId, item: { type: "fileChange", id, changes, status: "inProgress" } });
        notify("item/completed", { threadId, turnId, item: { type: "fileChange", id, changes, status: "completed" } });
      }
    // `~threefails`: `npm test` fails three times in a row, exit code 1; with `~editbetween`, Codex patches a.txt between
    // the first run and the second and b.txt between the second and the third (apply_patch), each change completed.
    if (/~threefails\b/.test(text))
      for (let i = 1; i <= 3; i++) {
        if (i > 1 && /~editbetween\b/.test(text)) {
          const id = `between_${i}`;
          const changes = [{ path: i === 2 ? "a.txt" : "b.txt", kind: { type: "update", move_path: null }, diff: "@@ -1 +1 @@\n-a\n+b\n" }];
          notify("item/started", { threadId, turnId, item: { type: "fileChange", id, changes, status: "inProgress" } });
          notify("item/completed", { threadId, turnId, item: { type: "fileChange", id, changes, status: "completed" } });
        }
        whole(threadId, turnId, { type: "commandExecution", id: `fails_${i}`, command: "npm test", cwd: ".", status: "failed", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: "1 failing\n", exitCode: 1, durationMs: 5 });
      }
    // `~threefolders`: `npm test` fails once in each of three folders (`cwd`), exit code 1; `~onerun`: it runs once
    // in the turn's folder, and passes.
    if (/~threefolders\b/.test(text))
      for (const dir of ["packages/a", "packages/b", "packages/c"])
        whole(threadId, turnId, { type: "commandExecution", id: `folder_${dir.slice(-1)}`, command: "npm test", cwd: dir, status: "failed", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: "1 failing\n", exitCode: 1, durationMs: 5 });
    if (/~onerun\b/.test(text)) whole(threadId, turnId, { type: "commandExecution", id: "one_run", command: "npm test", cwd: ".", status: "completed", commandActions: [{ type: "unknown", command: "npm test" }], aggregatedOutput: "3 passing\n", exitCode: 0, durationMs: 5 });
    ticks(threadId, turnId);
    return;
  }
  if (script === "review") {
    const turn = running.get(threadId);
    if (turn) {
      turn.review = true;
      turn.onInterrupt = () => end(threadId, turnId, "interrupted");
    }
    await say(threadId, turnId, "Reviewing…");
    ticks(threadId, turnId);
    return;
  }
  if (script === "slow") {
    // Interruptible from its first word on: a stop may come as soon as one is heard.
    const turn = running.get(threadId);
    if (turn) turn.onInterrupt = () => end(threadId, turnId, "interrupted");
    await say(threadId, turnId, "Working on it…");
    return;
  }
  if (script === "ask" || script === "ask-nothing") {
    const files = [{ id: "q1", header: "Pick", question: "Which file?", isOther: false, isSecret: false, options: [{ label: "a.txt", description: "" }, { label: "b.txt", description: "" }] }];
    const answer = await ask("item/tool/requestUserInput", { threadId, turnId, itemId: "ask_1", isBlocking: true, questions: script === "ask" ? files : [] });
    await say(threadId, turnId, `answers: ${JSON.stringify(answer?.result?.answers)}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "ask-crash") {
    void ask("item/tool/requestUserInput", { threadId, turnId, itemId: "ask_4", isBlocking: true, questions: [{ id: "q1", header: "Pick", question: "Which file?", isOther: true, isSecret: false, options: [] }] });
    await new Promise((r) => setTimeout(r, 150));
    process.exit(3);
  }
  if (script === "ask-withdrawn") {
    const requestId = nextId;
    void ask("item/tool/requestUserInput", { threadId, turnId, itemId: "ask_2", isBlocking: true, questions: [{ id: "q1", header: "Pick", question: "Which file?", isOther: true, isSecret: false, options: [{ label: "a.txt", description: "" }] }] });
    await new Promise((r) => setTimeout(r, 150));
    notify("serverRequest/resolved", { threadId, requestId });
    await say(threadId, turnId, "Went on without it.");
    return end(threadId, turnId, "completed");
  }
  if (script === "elicit" || script === "elicit-odd") {
    const space = { type: "string", title: "Space", enum: ["eng", "ops"] };
    const requestedSchema = script === "elicit" ? { type: "object", properties: { space }, required: ["space"] } : { type: "object", properties: {} };
    const answer = await ask("mcpServer/elicitation/request", { threadId, turnId, serverName: "docs", mode: "form", _meta: null, message: "Which space?", requestedSchema });
    await say(threadId, turnId, `elicit: ${JSON.stringify(answer?.result)}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "mcp-approve") {
    const item = { type: "mcpToolCall", id: "mcp_1", server: "docs", tool: "search_docs", arguments: { query: "tabs" }, result: null, error: null, durationMs: null };
    notify("item/started", { threadId, turnId, item: { ...item, status: "inProgress" } });
    const meta = { codex_approval_kind: "mcp_tool_call", persist: ["session", "always"], tool_description: "Search the docs", tool_params: item.arguments };
    const answer = await ask("mcpServer/elicitation/request", { threadId, turnId, serverName: "docs", mode: "form", _meta: meta, message: 'Allow the docs MCP server to run tool "search_docs"?', requestedSchema: { type: "object", properties: {} } });
    const ok = answer?.result?.action === "accept";
    const done = ok ? { status: "completed", result: { content: [{ type: "text", text: "found" }], structuredContent: null } } : { status: "failed", error: { message: "user rejected MCP tool call" } };
    notify("item/completed", { threadId, turnId, item: { ...item, ...done } });
    await say(threadId, turnId, `mcp: ${JSON.stringify(answer?.result)}`);
    return end(threadId, turnId, "completed");
  }
  if (script === "compact") {
    whole(threadId, turnId, { type: "contextCompaction", id: "cmp_1" });
    notify("thread/compacted", { threadId, turnId });
    await say(threadId, turnId, "Compacted.");
    return end(threadId, turnId, "completed");
  }
  if (script === "rename") {
    notify("thread/name/updated", { threadId, threadName: "Fake named thread" });
    await say(threadId, turnId, "Named.");
    return end(threadId, turnId, "completed");
  }
  if (script === "limits") {
    // Codex's updates are sparse: this one says the five-hour window's use alone, and the plan; a weekly window
    // without its use (off the protocol) says nothing of it.
    const secondary = { usedPercent: null, windowDurationMins: 10080, resetsAt: null };
    notify("account/rateLimits/updated", { rateLimits: { limitId: "codex", primary: { usedPercent: 55, windowDurationMins: null, resetsAt: null }, secondary, credits: null, planType: "pro" } });
    // A model's own allowance comes the same way: what it says is never the plan's.
    notify("account/rateLimits/updated", { rateLimits: { limitId: "gpt-6-astra", primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: null }, credits: { hasCredits: false, unlimited: false, balance: "0" }, planType: "free", rateLimitReachedType: "rate_limit_reached" } });
    await say(threadId, turnId, "Counted.");
    return end(threadId, turnId, "completed");
  }
  if (script === "account-change") {
    // Another account signs in, in a terminal: Codex says so, and the words wait until Filament has read its windows.
    account = { type: "chatgpt", email: "ops@example.com", planType: "pro" };
    const read = new Promise((r) => (reread = () => r(null)));
    notify("account/updated", { authMode: "chatgpt", planType: "pro" });
    await read;
    reread = null;
    await say(threadId, turnId, "Signed in as another.");
    return end(threadId, turnId, "completed");
  }
  if (script === "stray-child") {
    notify("thread/started", { thread: { id: randomUUID(), parentThreadId: threadId, cwd: "." } });
    await say(threadId, turnId, "Done.");
    return end(threadId, turnId, "completed");
  }
  if (script === "lastwords") {
    await say(threadId, turnId, "Working…");
    while (env.FAKE_CODEX_EXIT_GATE && !existsSync(env.FAKE_CODEX_EXIT_GATE)) await new Promise((r) => setTimeout(r, 10));
    await say(threadId, turnId, "last words");
    end(threadId, turnId, "completed");
    return void process.stdout.write("", () => process.exit(3));
  }
  if (script === "crash") {
    await say(threadId, turnId, "Starting…");
    process.exit(3);
  }
  const holds = /~holds (\d+)/.exec(text);
  usage(threadId, turnId, holds ? Number(holds[1]) : 900, 0, 12);
  await say(threadId, turnId, `Echo: ${text}`);
  end(threadId, turnId, "completed");
}

/** @param {any} msg */
async function handle(msg) {
  if (env.FAKE_CODEX_CALLS) appendFileSync(env.FAKE_CODEX_CALLS, JSON.stringify({ method: msg.method || null, id: msg.id ?? null, params: msg.params ?? null, result: msg.result ?? null, jsonrpc: msg.jsonrpc ?? null }) + "\n");
  if (msg.id != null && !msg.method) {
    waiting.get(msg.id)?.(msg);
    waiting.delete(msg.id);
    return;
  }
  if (msg.id == null) return; // initialized
  const p = msg.params || {};
  const reply = (/** @type {any} */ result) => send({ id: msg.id, result });
  const refuse = (/** @type {number} */ code, /** @type {string} */ message) => send({ id: msg.id, error: { code, message } });
  switch (msg.method) {
    case "initialize":
      while (env.FAKE_CODEX_INIT_GATE && !existsSync(env.FAKE_CODEX_INIT_GATE)) await new Promise((r) => setTimeout(r, 20));
      return reply({ userAgent: "filament/0.154.0 (fake; test)", codexHome: ".", platformFamily: "test", platformOs: "test" });
    case "account/read":
      return reply(signedOut() ? { account: null, requiresOpenaiAuth: env.FAKE_CODEX_SIGNED_OUT !== "provider" } : { account, requiresOpenaiAuth: true });
    case "account/rateLimits/read": {
      if (signedOut()) return refuse(-32600, "codex account authentication required to read rate limits");
      if (env.FAKE_CODEX_LIMITS_FAIL === "1") return refuse(-32603, "failed to fetch codex rate limits");
      // The second account's plan has no weekly window.
      const weekly = account.email === "dev@example.com" ? { usedPercent: 40, windowDurationMins: 10080, resetsAt: 1791900000 } : null;
      if (env.FAKE_CODEX_SPENT === "1") {
        const now = Math.round(Date.now() / 1000);
        const left = Array.from({ length: resetCredits }, (_, i) => ({ id: `rc_${i}`, grantedAt: now - 86400, expiresAt: now + (10 + i * 10) * 86400, resetType: "codexRateLimits", status: "available", title: null }));
        reply({
          rateLimits: { limitId: "codex", primary: { usedPercent: spent ? 100 : 0, windowDurationMins: 300, resetsAt: now + 3600 }, secondary: { usedPercent: 64, windowDurationMins: 10080, resetsAt: now + 3 * 86400 }, credits: { hasCredits: false, unlimited: false, balance: "0" }, planType: "plus", rateLimitReachedType: spent ? "rate_limit_reached" : null },
          rateLimitResetCredits: { availableCount: resetCredits, credits: left },
        });
        return reread?.();
      }
      reply({ rateLimits: { limitId: "codex", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1791400000 }, secondary: weekly, credits: null, planType: null } });
      return reread?.();
    }
    case "account/login/start": {
      if (p.type === "apiKey") {
        if (!String(p.apiKey || "").startsWith("sk-")) return refuse(-32602, `invalid OpenAI API key ${p.apiKey}`);
        writeFileSync(homeAuth, JSON.stringify({ OPENAI_API_KEY: p.apiKey }));
        account = { type: "apiKey" };
        reply({ type: "apiKey" });
        notify("account/login/completed", { loginId: null, success: true, error: null });
        return notify("account/updated", { authMode: "apikey", planType: null });
      }
      if (p.type !== "chatgpt" && p.type !== "chatgptDeviceCode") return refuse(-32602, `unsupported login type ${p.type}`);
      if (login) clearTimeout(login.timer);
      const id = `login-${randomUUID().slice(0, 8)}`;
      const ends = env.FAKE_CODEX_LOGIN || "ok";
      login = {
        id,
        timer:
          ends === "wait"
            ? null
            : setTimeout(() => {
                login = null;
                if (ends === "ok") writeFileSync(homeAuth, JSON.stringify({ email: "dev@example.com" }));
                notify("account/login/completed", { loginId: id, success: ends === "ok", error: ends === "ok" ? null : "the sign-in was refused" });
                if (ends === "ok") notify("account/updated", { authMode: "chatgpt", planType: "plus" });
              }, Number(env.FAKE_CODEX_LOGIN_MS || 150)),
      };
      return reply(
        p.type === "chatgpt"
          ? { type: "chatgpt", loginId: id, authUrl: `https://auth.example.test/oauth/authorize?state=${id}` }
          : { type: "chatgptDeviceCode", loginId: id, verificationUrl: "https://auth.example.test/codex/device", userCode: "FAKE-1234" },
      );
    }
    case "account/login/cancel": {
      if (!login || login.id !== p.loginId) return reply({ status: "notFound" });
      clearTimeout(login.timer);
      login = null;
      reply({ status: "canceled" });
      return notify("account/login/completed", { loginId: p.loginId, success: false, error: "Login was not completed" });
    }
    case "account/logout":
      rmSync(homeAuth, { force: true });
      reply({});
      return notify("account/updated", { authMode: null, planType: null });
    case "account/rateLimitResetCredit/consume": {
      // One credit per key: the same key again is the same attempt.
      if (redeemed.has(p.idempotencyKey)) return reply({ outcome: "alreadyRedeemed" });
      if (!resetCredits) return reply({ outcome: "noCredit" });
      if (!spent) return reply({ outcome: "nothingToReset" });
      redeemed.add(p.idempotencyKey);
      resetCredits -= 1;
      spent = false;
      if (env.FAKE_CODEX_CONSUME_LOST === "1" && redeemed.size === 1) return refuse(-32603, "the answer was lost");
      return reply({ outcome: "reset" });
    }
    case "model/list": {
      // Two pages: the first model, then the rest.
      const all = p.includeHidden ? MODELS : MODELS.filter((m) => !m.hidden);
      return reply(p.cursor === "2" ? { data: all.slice(1), nextCursor: null } : { data: all.slice(0, 1), nextCursor: "2" });
    }
    case "windowsSandbox/readiness":
      return reply({ status: "notConfigured" });
    case "thread/start": {
      if (env.FAKE_CODEX_SLOW_START_MS) await new Promise((r) => setTimeout(r, Number(env.FAKE_CODEX_SLOW_START_MS)));
      const id = randomUUID();
      threads.set(id, { id, cwd: p.cwd, name: null, parent: null, mcpUrl: p.config?.["mcp_servers.filament"]?.url || null });
      reply({ thread: { id, cwd: p.cwd }, model: env.FAKE_CODEX_THREAD_MODEL || p.model || "gpt-6-astra", sandbox: sandboxOf(p.sandbox), approvalPolicy: p.approvalPolicy, cwd: p.cwd });
      return notify("thread/started", { thread: { id, cwd: p.cwd, parentThreadId: null } });
    }
    case "thread/resume":
      if (env.FAKE_CODEX_RESUME_FAIL === "1") return refuse(-32600, `no rollout found for thread id ${p.threadId}`);
      threads.set(p.threadId, { id: p.threadId, cwd: p.cwd, name: null, parent: null, heard: threads.get(p.threadId)?.heard || [], mcpUrl: p.config?.["mcp_servers.filament"]?.url || threads.get(p.threadId)?.mcpUrl || null });
      return reply({ thread: { id: p.threadId, cwd: p.cwd }, model: env.FAKE_CODEX_THREAD_MODEL || p.model || "gpt-6-astra", sandbox: sandboxOf(p.sandbox), cwd: p.cwd });
    case "thread/fork": {
      const from = threads.get(p.threadId);
      if (!from) return refuse(-32600, `no rollout found for thread id ${p.threadId}`);
      const id = randomUUID();
      const cwd = p.cwd || from.cwd;
      threads.set(id, { id, cwd, name: null, parent: null, heard: [...(from.heard || [])], ephemeral: p.ephemeral === true });
      reply({ thread: { id, cwd, forkedFromId: p.threadId, ephemeral: p.ephemeral === true }, model: p.model || "gpt-6-astra", sandbox: sandboxOf(p.sandbox), approvalPolicy: p.approvalPolicy, cwd });
      return notify("thread/started", { thread: { id, cwd, parentThreadId: null, forkedFromId: p.threadId } });
    }
    case "thread/inject_items":
      if (env.FAKE_CODEX_INJECT_FAIL === "1") return refuse(-32602, "invalid items");
      if (threads.has(p.threadId)) threads.get(p.threadId).injected = true;
      return reply({});
    case "thread/list":
      return reply({ data: [...threads.values()].filter((t) => !t.ephemeral).map((t) => ({ id: t.id, cwd: t.cwd, name: t.name, preview: "a fake thread", parentThreadId: t.parent, createdAt: 1791300000, updatedAt: 1791300100 })), nextCursor: null });
    case "thread/unsubscribe":
      return dropped(msg.method, p.threadId).then(() => reply({}));
    case "thread/compact/start": {
      if (!threads.has(p.threadId)) return refuse(-32600, `thread not found: ${p.threadId}`);
      reply({});
      return compactThread(p.threadId, `turn_${randomUUID().slice(0, 8)}`);
    }
    case "thread/delete":
      threads.delete(p.threadId);
      return dropped(msg.method, p.threadId).then(() => reply({}));
    case "turn/start": {
      const turnId = `turn_${randomUUID().slice(0, 8)}`;
      const text = personWords((p.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n"));
      const busy = running.get(p.threadId);
      if (busy) {
        reply({ turn: { id: turnId, status: "inProgress", items: [] } });
        return busy.onSteer?.(text);
      }
      running.set(p.threadId, { id: turnId, onInterrupt: null });
      const thread = threads.get(p.threadId);
      if (thread) thread.heard = [...(thread.heard || []), text];
      reply({ turn: { id: turnId, status: "inProgress", items: [] } });
      return play(p.threadId, turnId, text);
    }
    case "turn/steer": {
      // Codex's own precondition: the turn running must be the one named.
      const turn = running.get(p.threadId);
      if (!turn || turn.id !== p.expectedTurnId) return refuse(-32600, turn ? `expected active turn id ${p.expectedTurnId} but found ${turn.id}` : "no active turn to steer");
      if (turn.review) return send({ id: msg.id, error: { code: -32600, message: "cannot steer a review turn", data: { codexErrorInfo: { activeTurnNotSteerable: { turnKind: "review" } } } } });
      const words = (p.input || []).filter((/** @type {any} */ i) => i.type === "text").map((/** @type {any} */ i) => i.text).join("\n");
      const pictures = (p.input || []).filter((/** @type {any} */ i) => i.type === "image" && /^data:image\/[a-z]+;base64,/.test(String(i.url || ""))).length;
      reply({ turnId: turn.id });
      return turn.onSteer?.(words, pictures);
    }
    case "turn/interrupt": {
      reply({});
      const turn = running.get(p.threadId);
      if (turn?.id === p.turnId) turn.onInterrupt?.();
      return;
    }
    default:
      return refuse(-32601, `method not found: ${msg.method}`);
  }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (line) void handle(JSON.parse(line));
  }
});
process.stdin.on("end", () => process.exit(0));

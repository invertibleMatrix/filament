// Minimal ACP agent for tests. Speaks newline-delimited JSON-RPC on stdio.
// Behaviour: echoes the prompt as text, emits a thought and a fake tool call first, asks permission when the
// prompt contains "perm", records every prompt in a JSONL file given by FAKE_ACP_LOG for assertions.
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { request as httpRequest } from "node:http";
import { join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { personWords } from "./person-words.mjs";
let buf = "";
const sessions = new Map();
// Claude Code's one model beyond those it lists (ANTHROPIC_CUSTOM_MODEL_OPTION), offered last, as its adapter offers it:
// Claude Code's own list carries it at its bottom, and claude-agent-acp 0.93 keeps it there, past an `availableModels`
// allowlist too (dist/session-model.js `applyAvailableModelsAllowlist`) — read in that source, never run for real.
// Claude Code lays its own settings' `env` over the variables it starts with (claude-agent-acp 0.93 acp-agent.js): under
// FAKE_ACP_SETTINGS, one set in the settings.json of its folder names it, whatever it was started with — read only
// where a test asks it and CLAUDE_CONFIG_DIR names the test's folder, never the person's own.
const settingsEnv = (() => {
  try {
    return process.env.FAKE_ACP_SETTINGS && process.env.CLAUDE_CONFIG_DIR ? JSON.parse(readFileSync(join(process.env.CLAUDE_CONFIG_DIR, "settings.json"), "utf8"))?.env || {} : {};
  } catch {
    return {};
  }
})();
const customName = settingsEnv.ANTHROPIC_CUSTOM_MODEL_OPTION ?? process.env.ANTHROPIC_CUSTOM_MODEL_OPTION;
const customModel = customName ? [{ value: customName, name: `Custom model (${customName})` }] : [];
// `~leftcmd`'s shell: it starts the command — a process that waits a minute, and outlives it (`detached`: Node ends a
// process's children with it on Windows, which a real shell does not) — writes the command's id to FAKE_ACP_LEFT_PID,
// and waits with it.
const LEFT_SHELL = 'const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{},60000)"], { stdio: "ignore", windowsHide: true, detached: true }); if (process.env.FAKE_ACP_LEFT_PID) require("node:fs").writeFileSync(process.env.FAKE_ACP_LEFT_PID, String(c.pid)); setTimeout(() => {}, 60000);';
/** The words of `~failonce` this process has failed a prompt for. @type {Set<string>} */
const failedOnce = new Set();
/** The forks made and not opened yet: what each holds of the session it was made from. */
const forks = new Map();
/**
 * What each session closed saved of its running totals, as Claude Code writes them into its transcript when its
 * process exits on its own: a session resumed goes on from them. An agent killed saves nothing. Kept in this process —
 * or, under FAKE_ACP_SAVED_DIR, in a file there for each session, which an agent started later reads as Claude Code
 * reads its transcript.
 */
const savedTotals = (() => {
  const here = new Map();
  /** @param {string} id */
  const file = (id) => join(process.env.FAKE_ACP_SAVED_DIR || "", `${id}.json`);
  return {
    /** @param {string} id */
    get: (id) => (!process.env.FAKE_ACP_SAVED_DIR ? here.get(id) : existsSync(file(id)) ? JSON.parse(readFileSync(file(id), "utf8")) : undefined),
    /** @param {string} id @param {any} totals */
    set: (id, totals) => (!process.env.FAKE_ACP_SAVED_DIR ? void here.set(id, totals) : (mkdirSync(process.env.FAKE_ACP_SAVED_DIR, { recursive: true }), writeFileSync(file(id), JSON.stringify(totals)))),
  };
})();
/** The model a session was set to: its model option, `session/set_model`, else the process's `--model`. */
const setTo = (s) => s?.model || (process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "");
/**
 * The model a session's own messages and counted tokens name. It answers on what it was set to: a family's bare word
 * as that family's model (`opus[1m]` is claude-opus-5), a full name without its marks, and claude-sonnet-5 where it was
 * set to none, to `default` or `auto`, or to a name the fake itself made up (fake-default). FAKE_ACP_ANSWERS_ON: an
 * agent that answers on that model whatever it was set to, and says nothing of it — `@<file>`: on the model that file
 * names as each message is written, on what it was set to while the file is empty or not there.
 */
const answersOn = (s) => {
  const knob = process.env.FAKE_ACP_ANSWERS_ON || "";
  const other = knob.startsWith("@") ? (existsSync(knob.slice(1)) ? readFileSync(knob.slice(1), "utf8").trim() : "") : knob;
  if (other) return other;
  const set = String(setTo(s) || "").replace(/\[[^\]]*\]/g, "").replace(/-(low|medium|high|xhigh|max)$/, "");
  if (!set || set === "default" || set === "auto" || set === "fake-default") return "claude-sonnet-5";
  return /^(opus|sonnet|haiku|fable)$/.test(set) ? `claude-${set}-5` : set;
};
/** What each prompt of a `~steps` turn spends, in ACP's `usage`. */
const STEP_USAGE = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
/**
 * A session's model calls spent `add` on `model`: Claude's SDK keeps the running total since the session opened, by
 * model, which each of its results says as its `modelUsage`.
 */
function spendInto(s, model, add) {
  const all = (s.modelsSpent ||= {});
  const was = all[model] || { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 };
  all[model] = Object.fromEntries(Object.entries(was).map(([k, v]) => [k, v + (add[k] || 0)]));
}
/** What a session's running totals by model grew by since `before`, each model that grew: a result's own, as Claude's adapter reads it. */
function grewSince(now, before) {
  const out = {};
  for (const [model, t] of Object.entries(now || {})) {
    const was = before?.[model] || {};
    const grew = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v - (was[k] || 0)]));
    if (Object.values(grew).some((v) => v > 0)) out[model] = grew;
  }
  return out;
}
/**
 * A session's model calls cost `usd` more: the figure Claude's adapter says (`usage_update`'s `cost`) is the running total
 * of the session's query — every call since it opened in this process, or since a `/clear` (`~cleared`) began it again.
 */
function costSoFar(s, usd) {
  s.costSpent = Math.round(((s.costSpent || 0) + usd) * 1e6) / 1e6;
  return { amount: s.costSpent, currency: "USD" };
}
// FAKE_ACP_MCP_CAPS: declare mcpCapabilities in initialize — "http" (can take HTTP MCP servers) or "none" (declares it cannot); unset = omit the field like an older agent.
// FAKE_ACP_PARAMS: behave like Cursor's parameterized model picker (only when the client asked for it in initialize).
// FAKE_ACP_RESUME_FAIL: session/resume fails, as for a session the agent no longer has.
// FAKE_ACP_REOPENS_ON: a resumed session is on that model whatever it was set to before, and its answer says so.
// FAKE_ACP_FAIL_KIND: every prompt fails as Claude's adapter fails one, with this `errorKind`.
// FAKE_ACP_NO_MODELS: a session opens with no model to choose (no `models`, no model option).
// FAKE_ACP_FAIL_SAID: every prompt fails as Claude's adapter fails one, with these words for its details.
// FAKE_ACP_OVERFLOW_SEEDED: a prompt that carries the earlier conversation is refused as too long — a number above 1
// is the most tokens it says it takes, 200 under what it says it counted (the API's words). FAKE_ACP_CALLS
// names, for an open, the system prompt's append and Filament's MCP address it was given.
// FAKE_ACP_NO_LOAD: declare no `loadSession`, as an agent that cannot open a session again.
// FAKE_ACP_SESSION_CAPS: session methods to declare, comma-separated ("close,resume,fork"); FAKE_ACP_STEERING: declare
// live steering, as claude-agent-acp does; FAKE_ACP_CALLS: a JSONL file of the session methods it is sent, with
// its pid. FAKE_ACP_CLAUDE: Claude's adapter's marks (`_meta.claudeCode`, its raw SDK messages when a session asks
// for them, message ids and tool names), in the scripted turns (`~work`, `~nested`, `~early`, `~background`,
// `~wake`, `~compact`, `~readcompact`, `~compactfail`, `~slowcompact <file>`, `~compacthang`, `~waitfor <file>`,
// `~compactfailwait <file>`, `~subcompact`, `~rfdsub`, `~rfdsub-bg`).
// `session/fork` and `session/delete`, where FAKE_ACP_SESSION_CAPS declares them: a fork as Claude's adapter makes one,
// kept to be resumed, holding what its session heard. Filament's summary instruction (HarnessV3-ACP AC5-4) is answered
// with what the session heard before it, in the shape asked for, its usage mostly read from the cache;
// FAKE_ACP_SUMMARY_TRIES: first it asks to edit a file, then writes one, runs a command and reads one through the
// client, each outcome in FAKE_ACP_CALLS (`summary: tried`); FAKE_ACP_SUMMARY_GATE: a file it waits for before it
// answers; FAKE_ACP_SUMMARY_READS_MS: it reads a file through the client for that long first, saying nothing
// meanwhile; FAKE_ACP_SUMMARY_FAIL: its prompt fails, overloaded; FAKE_ACP_TRANSCRIPT_FAIL: the compaction model's ask
// over a transcript (a call of Filament's own, its summarizer) fails, overloaded. FAKE_ACP_DELETE_MS: it takes this long over a
// `session/delete`, saying it in FAKE_ACP_CALLS as it answers.
// FAKE_ACP_SLOW_NEW_MS: session/new answers after this long, so a stop can come before the prompt.
// FAKE_ACP_HOLD_GATE: a folder; where it is set, `~slowstart` says nothing until `<gate>/slowstart` is there, and
// `~drip` drips until `<gate>/drip` is, in place of FAKE_ACP_SLOW_MS and FAKE_ACP_DRIP_MS: a test holds the stage
// it reads.
// FAKE_ACP_INIT_GATE: a file; initialize is answered once it is there. FAKE_ACP_SLOW_MODE_MS: session/set_mode answers
// after this long. FAKE_ACP_NEW_CRASH: the agent dies opening a session, saying why on stderr. `~thinking` (with
// FAKE_ACP_CLAUDE): Claude's estimate of its thinking before its words (one more while a Read runs), a sub-agent's
// task with its progress, a housekeeping task, and a shell left running in the background, which ends after the turn
// once `<FAKE_ACP_WAKE_GATE>/sh1` is there, a last estimate said between turns just before. `~slowtool`: words, then a
// command of the same model call that runs until FAKE_ACP_TOOL_GATE (a file) is there, or FAKE_ACP_TOOL_MS (12 s by
// default) where no gate is set, then its result and the last words; `~slowtool think`: a thought in place of the words.
// FAKE_ACP_SESSION_COMMANDS: each session publishes a command of its own too (`for-<session>`). `~deaf`: a turn that
// never ends, not even when cancelled. FAKE_ACP_DEAF_END: a file; once it is there a `~deaf` turn ends cancelled, as
// a stop that lands late does. FAKE_ACP_DEAF_OFF: a file; once it is there `~deaf` is no trigger, so a prompt that
// carries the earlier conversation's words runs as any other.
// FAKE_ACP_ARGV: a JSONL file each start appends the arguments it was given to. FAKE_ACP_HEADERS: one each start appends
// the headers Claude Code would send with its model calls to (ANTHROPIC_CUSTOM_HEADERS), null for none.
// `~lastwords`: words, then, once FAKE_ACP_EXIT_GATE (a file) is there, an edit, words and a word on stderr, and the
// agent exits (code 3): a test holds its output meanwhile, so Node says it exited before that is read (the bug report's
// X4).
// `~cursor`: Cursor's own tools as cursor-agent's ACP server streams them, each followed by its extension (AC2-2).
// `~elicit`, `~link`, `~link-done`, `~withdraw`, `~cursorask`, `~cursorplan`: questions to the person (AC2-4).
// FAKE_ACP_WITHDRAW_GATE: a file `~withdraw` waits for before it withdraws its question, and removes, so each
// withdrawal waits for its own.
// `~permwords`: two permissions, a command only its title names, then one said in words; `~permnoreject`: a call's
// permission offering no way to refuse; `~oddask`: a Cursor question and a form the card can't draw; `~permknown`: a
// permission naming a call announced before, in a status of its own; `~permended`: a permission for a call that ended.
// `~cursormcp <server> <tool>`: Cursor's call to an MCP server's tool and its question before the tool runs.
// Claude's own requests, as claude-agent-acp 0.76 sends them (AC3-2): `~permbash [command]`, `~permwrite`, `~permread`, `~permedit`
// (`~permwrite <path>`: a Write of that file; `~hears` after any of the three: refused, its turn takes what was queued
// while it asked, as Claude does at its next step, and says ` heard:<words>`; `~again`: refused, it asks once more),
// (an Edit of the session's README.md, with its diff as 0.76 sends it, as a Write's),
// `~permexit` (the plan it proposes, acted on as 0.76 does: its plain yes goes on, its fresh context starts over in
// bypassPermissions, published, and waits a moment for a mode set back, keep planning ends the turn cancelled;
// `twice`: the fresh context says its mode again once set back; `other`: a plan as another agent proposes one, its own
// yes and no, its yes moving it to the mode `says <mode>` names, said, else unsaid),
// `~permenter` (into its plan mode, published once allowed), `~permhand` (Filament's own hand, its memory search;
// `always`: no allow-once offered; a word: that tool of a server named filament), `~permalways` (no allow-once offered). `session/set_mode` is recorded, with its mode.
// `~gemini`, `~qoder`: a turn as Gemini CLI 0.44.1 and Qoder CLI 1.1.50 stream one (AC2-3). FAKE_ACP_LATE_REPLAY: a
// session/load answers at once and replays the session's history after its answer, as Gemini CLI does, for longer
// than Filament's quiet wait in steps shorter than it. `~quiet`: a turn that goes silent after the dials before it (an
// edit, say) until session/cancel (AC2-5). `~apierror`: an API error Claude meets, as its adapter (0.76) sends one —
// its words as a message of their own, raw and as a chunk, then the prompt's failure with them; `~apierrorbare`: a
// failure without them; `~apierrorok`: no failure, the turn ends well. `~notice`: a model fallback's notice between
// two words, as claude-agent-acp 0.93 sends one — a `notice` update where the client declares notices (C21).
// Live steering as claude-agent-acp 0.76 takes it (`_session/steering`, AC3-1, under FAKE_ACP_STEERING): `~steerable`
// works, after the dials and a `~mcpcall` in its prompt, until words come into its turn, says them back
// (`heard:<words>`) and ends, unless they say `~again`. Under FAKE_ACP_CLAUDE, which declares prompt queueing as
// Claude's adapter does (HarnessV3-FailurePoints §7.2), a prompt sent while it works is words into it too: folded in at
// once, as at its next step — the prompt's echo (a raw user message), the answer of the prompt it joined (`end_turn`),
// and the turn goes on as the new prompt's. `~queue` (FAKE_ACP_CLAUDE): a turn of two steps — `~queue3`, three; with
// `~compactfirst`, Claude compacts its own context before the first; with `~compactat <call>`, before that call; with
// `~compactin <call>`, while that call runs, before what waits in its queue is folded in; with `~skillfirst <name>`, a
// call of Filament's skill tool that loaded the skill completed before any of them (outside a `~queue` turn: before a
// `~compactthen`) —
// each a call that runs until FAKE_ACP_QUEUE_GATE/<call> exists (`q1`, `q2`, `q3`), then its last words (`done`), then its result once
// <gate>/end exists. A prompt sent meanwhile waits in its queue: the next step folds it in (`heard:<words>`), and one
// still queued at the result runs next, a cycle of its own (`next:<words>`) — one whose words say `~failqueued` ends in
// an error, which fails it. A cancel answers what waits cancelled and
// ends the turn there. Once <gate>/fail exists, the step it waits on fails the prompt (a request refused), what waits
// staying queued. Once <gate>/lose exists at its result, the session's process dies before it takes what waits: each is
// answered as claude-agent-acp answers a prompt to a session it lost, unechoed, and the session is gone. FAKE_ACP_QODER_QUEUE declares prompt queueing as Qoder's CLI does (`_meta.qoder`), with no
// raw messages. FAKE_ACP_AGY_PROMPT declares Antigravity's own system channel (`_meta.antigravity.systemPrompt`, as
// 1.4.5 does), and FAKE_ACP_CALLS records what a session opens with there (`agySystem`). FAKE_ACP_CALLS records each prompt queued (`queued prompt`). Under FAKE_ACP_CLAUDE every
// prompt is echoed as its cycle takes it (a raw user message, `isReplay`, its text), and a prompt sent while another of
// its session runs that no turn folds in waits, as Claude's adapter queues it: it runs once the session's prompts are
// all answered, and a cancel answers it cancelled (HarnessV3-FailurePoints §7.3, FP-D5).
// `~steerlate`: a turn that has settled though its prompt's answer comes a while later (FAKE_ACP_LATE_MS, 600 by
// default), so words then are handed back. FAKE_ACP_CALLS records each steering with its words and idle behaviour.
// FAKE_ACP_COMMANDS_GATE: a file a new session's commands wait for, where they come a moment after it opens, so
// words sent before can't be told from one (HarnessV3-FailurePoints, the early-command race); a prompt says nothing
// until they're out, as an agent says its commands as its session opens, before it answers.
// FAKE_ACP_NO_COMMANDS: the agent says no commands (with the gate, its turns still wait for it).
// FAKE_ACP_CANCEL_GATE: a file a `~steerable` turn's cancel waits for before the turn ends, so words can come while
// it stops. FAKE_ACP_STEER_GATE: a file the answer to a steering waits for, its words already in the turn, so the host
// is still waiting on it when more come.
// A turn cancelled at its next step, as Cursor's CLI keeps one (AC-D6): `~steps` works in two steps, each a call
// (`c_step1`, `c_step2`) — the first ends once FAKE_ACP_STEP_GATE exists, the second a moment after. A cancel ends the
// turn cancelled, and its session keeps what it did: its next prompt is answered `kept:<steps> heard:<words>`, the
// words after the prompt's last `---` (where they say `~failkept`, it fails instead). Each prompt spends STEP_USAGE.
// Its account as claude-agent-acp 0.76 says it (AC3-6): FAKE_ACP_AUTH declares `_meta.authStatus` and pushes
// `_auth/status_update` once it has answered initialize — `max` (a Claude Max login), `none` (nobody signed in), `key`
// (an Anthropic API key), or an `authStatus` as JSON; FAKE_ACP_AUTH_DELAY_MS later where it is set (the adapter checks
// its login in the background, while the first turns run), and once FAKE_ACP_AUTH_GATE (a file) is there, which it
// removes once the word is written (`gateOpen`). `~limits`: the plan's windows as the adapter says them, the
// 5-hour in a `usage_update`'s `_claude/rateLimit` and the weekly (near its end) as a raw `rate_limit_event`
// (FAKE_ACP_CLAUDE), then words; `~spent`: the 5-hour window rejected, then the prompt's failure as a `rate_limit` —
// every prompt's, under FAKE_ACP_SPENT (an account whose plan is spent). `~holds <n>`: the context holds n tokens of
// its 200,000-token window as the turn ends (AC5-3). `~counted <name>`: the turn's result names the models that
// counted it — <name>, which read the conversation, and a helper (HarnessV4_Tasks C19).
// A prompt of `/usage`, as claude-agent-acp 0.87 answers it (FAKE_ACP_CLAUDE): Claude Code's report, which no model
// reads — its figures on the raw message that carries it (`usage_report`), then its words. FAKE_ACP_USAGE: the report's
// `rate_limits` as JSON, `fail` for a prompt that fails, or `none` for words with no report on their message (Claude
// Code's answer when it leaves the plan's figures out, as it sometimes does when asked again soon); without it, none (a
// login whose plan Claude Code can't read). FAKE_ACP_USAGE_MS: the report comes this much later; FAKE_ACP_USAGE_GATE: once
// this file is there, removed once the prompt's answer is written (`gateOpen`); FAKE_ACP_USAGE_TAIL_MS:
// its words and the prompt's answer trail the report this much, as Claude Code's did by four seconds on a real Max login
// (2026-10-10). FAKE_ACP_CALLS: `/usage`, with whether its session keeps a transcript (`persist`, its open's
// `persistSession`). FAKE_ACP_INIT_EXIT_MS: the agent ends this long after its handshake, a word on stderr first.
// The agent's own compaction asked for (AC5-5), under FAKE_ACP_OWN_COMPACT: each session publishes `compact` as
// Claude's adapter does, and a prompt of `/compact [what to keep]` compacts the session as the adapter says a manual
// one (`compacting`, below) — the session then holding a summary of what it heard (FAKE_ACP_CALLS: `own compact`, with
// what it was told to keep). `fail`: it fails as the adapter says one ("Not enough messages to compact.").
// FAKE_ACP_OWN_COMPACT_GATE: a file it waits for before it compacts, a session/cancel meanwhile ending the prompt
// cancelled.
// How Claude's adapter says its compaction (AC2-1, AC5-7), each of the SDK's raw messages first (the adapter forwards
// one before it reads it): from 0.87, ACP's `compaction_update` to a client that declares `session.compaction` — its
// start, its end with the summary it kept (streamed before the end as `compaction_summary_chunk`s under
// FAKE_ACP_COMPACT_CHUNKS), its end again once the boundary's figures came, which the adapter keeps for AIR — and to
// one that does not, its call named `compact`, the figures in its `rawOutput` (FAKE_ACP_COMPACT_FORM=tool: so,
// whatever the client declared); FAKE_ACP_COMPACT_FORM=0.76: 0.76's call, marked `_meta.contextCompaction`. Then the
// usage it refreshes.
const compacting = (sessionId, id, raw, manual) => {
  const asked = process.env.FAKE_ACP_COMPACT_FORM;
  const declared = !!clientCaps.session?.compaction && typeof clientCaps.session.compaction === "object";
  const form = asked === "0.76" ? "0.76" : asked === "tool" || !declared ? "tool" : "update";
  // FAKE_ACP_COMPACT_NO_ID: its `compaction_update`s name no compaction, as an agent that sends no id for one.
  const named = process.env.FAKE_ACP_COMPACT_NO_ID ? {} : { compactionId: id };
  const meta = (more = {}) => (form === "0.76" ? { _meta: { contextCompaction: { version: 1, ...more }, claudeCode: { toolName: "compact" } } } : { _meta: { claudeCode: { toolName: "compact" } } });
  return {
    start() {
      raw({ type: "system", subtype: "status", status: "compacting", uuid: id });
      if (form === "update") notify(sessionId, { sessionUpdate: "compaction_update", ...named, status: "in_progress" });
      else notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, title: "Compact conversation", kind: "think", status: "in_progress", ...meta(manual ? { trigger: "manual" } : {}) });
    },
    // `{ pre, post, ms, summary }` for one that completed, `{ error }` for one that failed.
    end(how) {
      if (how.error) {
        raw({ type: "system", subtype: "status", status: null, compact_result: "failed", compact_error: how.error, uuid: `${id}_r` });
        if (form === "update") return notify(sessionId, { sessionUpdate: "compaction_update", ...named, status: "failed", error: how.error });
        return notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: "failed", content: [{ type: "content", content: { type: "text", text: `Compaction failed: ${how.error}` } }], rawOutput: { error: how.error }, ...meta({ error: how.error }) });
      }
      const chunked = form === "update" && !!process.env.FAKE_ACP_COMPACT_CHUNKS;
      if (chunked) for (const part of how.summary.match(/[\s\S]{1,24}/g) || []) notify(sessionId, { sessionUpdate: "compaction_summary_chunk", ...named, content: { type: "text", text: part } });
      raw({ type: "system", subtype: "status", status: null, compact_result: "success", uuid: `${id}_r` });
      if (form === "update") notify(sessionId, { sessionUpdate: "compaction_update", ...named, status: "completed", ...(chunked ? {} : { summary: [{ type: "text", text: how.summary }] }) });
      else notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", ...meta() });
      raw({ type: "system", subtype: "compact_boundary", compact_metadata: { trigger: manual ? "manual" : "auto", pre_tokens: how.pre, post_tokens: how.post, duration_ms: how.ms }, uuid: `${id}_b` });
      const facts = { trigger: manual ? "manual" : "automatic", preTokens: how.pre, postTokens: how.post, durationMs: how.ms };
      if (form === "update") notify(sessionId, { sessionUpdate: "compaction_update", ...named, status: "completed" });
      else notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, rawOutput: facts, ...meta(facts) });
      notify(sessionId, { sessionUpdate: "usage_update", used: how.post, size: 200000 });
    },
  };
};
const wantsRaw = (cfg, message) => cfg === true || (Array.isArray(cfg) && cfg.some((f) => f.type === message.type && (f.subtype === undefined || f.subtype === message.subtype)));
const AUTH = { max: { kind: "account", label: "Claude Max", account: { plan: "max", email: "dev@example.com", organization: "Example Org" } }, none: { kind: "none", label: "Not logged in" }, key: { kind: "api_key", label: "Anthropic API key", detail: "env" } };
// A login kept in its folder, as claude-agent-acp keeps one in CLAUDE_CONFIG_DIR (AC3-7), under FAKE_ACP_HOME_LOGIN:
// signed in where `<CLAUDE_CONFIG_DIR>/.fake-login` holds its status. Run with `--cli auth login --claudeai` (or
// `--console`), as a client runs its terminal sign-in, it signs in there and exits 0 (FAKE_ACP_LOGIN_EXIT: another
// code, signing nobody in; `wait`, waiting for the person until it is stopped). It offers those two ways to a client
// that declares `auth.terminal`, and no other (the adapter's 0.9x names no way `authenticate` takes), declares `logout` (which clears the folder's login and says so), and refuses a session
// where nobody is signed in, as the adapter does.
const homeLogin = process.env.FAKE_ACP_HOME_LOGIN ? join(process.env.CLAUDE_CONFIG_DIR || ".", ".fake-login") : null;
if (homeLogin && process.argv.includes("--cli")) {
  if (process.env.FAKE_ACP_LOGIN_EXIT === "wait") {
    process.stdout.write("Open the page this prints to sign in\r\n");
    setInterval(() => {}, 60_000);
    await new Promise(() => {});
  }
  const code = Number(process.env.FAKE_ACP_LOGIN_EXIT || 0);
  process.stdout.write(`Signing in to the fake Claude in ${process.env.CLAUDE_CONFIG_DIR || "its usual folder"}\r\n`);
  if (!code) writeFileSync(homeLogin, JSON.stringify(process.argv.includes("--console") ? AUTH.key : AUTH.max));
  await new Promise((r) => setTimeout(r, 50));
  process.exit(code);
}
const TERMINAL_WAYS = [
  { id: "claude-ai-login", name: "Claude Subscription", description: "Use Claude subscription ", type: "terminal", args: ["--cli", "auth", "login", "--claudeai"] },
  { id: "console-login", name: "Anthropic Console", description: "Use Anthropic Console (API usage billing)", type: "terminal", args: ["--cli", "auth", "login", "--console"] },
];
const homeAuth = () => (existsSync(homeLogin) ? JSON.parse(readFileSync(homeLogin, "utf8")) : AUTH.none);
// FAKE_ACP_KEY_TAKES, beside FAKE_ACP_KEY_VAR: the one key it takes. It then says who it runs as — that key's owner
// where the variable holds it, nobody with another or with none — and opens a session with that key alone.
const keyVar = process.env.FAKE_ACP_KEY_VAR || "";
const keyTakes = process.env.FAKE_ACP_KEY_TAKES || "";
const keyStatus = keyVar && keyTakes ? (process.env[keyVar] === keyTakes ? { kind: "api_key", label: "Fake API key" } : AUTH.none) : null;
const authStatus = keyStatus || (homeLogin ? homeAuth() : process.env.FAKE_ACP_AUTH ? AUTH[process.env.FAKE_ACP_AUTH] || JSON.parse(process.env.FAKE_ACP_AUTH) : null);
// Its own ways to sign in (AC3-7, the review of 11-10: an agent of ACP's registry that names no way a client runs in a
// terminal): FAKE_ACP_AUTH_METHODS, JSON, declares those methods in place of its others — one carrying Zed's older
// `_meta["terminal-auth"]` only to a client that declares it, as Claude's adapter and Qoder do. `authenticate` signs it
// in after FAKE_ACP_AUTHENTICATE_MS, writing FAKE_ACP_SIGNED_IN (a file: a session is refused "Authentication required"
// until it is there); FAKE_ACP_AUTHENTICATE=fail refuses it, `wait` never answers it. FAKE_ACP_KEY_VAR names the
// variable it reads a key from: a session is refused until it is set. FAKE_ACP_CALLS records each `authenticate` with its
// method, and its start with whether that variable was set (`keyed`) — never its value.
const ownWays = process.env.FAKE_ACP_AUTH_METHODS ? JSON.parse(process.env.FAKE_ACP_AUTH_METHODS) : null;
const signedOutHere = () => (!!process.env.FAKE_ACP_SIGNED_IN && !existsSync(process.env.FAKE_ACP_SIGNED_IN)) || (!!keyVar && (keyTakes ? process.env[keyVar] !== keyTakes : !process.env[keyVar]));
// FAKE_ACP_AGY: its login and its models as Antigravity's ACP server has them (agy_acp_server 1.4.5, read on 11-11). At
// its start it declares its four ways with no type — `authenticate` carries each out —, ACP's `logout` and its plan's
// tier (`_meta.antigravity`), and never who it runs as, at its start or after. Signed in (FAKE_ACP_SIGNED_IN, which its
// `logout` removes), a session opens with its plan's tier by name, one model to choose (`gemini-3.8-flash`), its
// thinking level as an option of its own (`thinking_level`, category `thought_level`: low, medium, high — high as it
// opens), its modes, and that model at each level in the classic list. FAKE_ACP_CALLS records each option a session is
// set to (`session/set_config_option`, with its `configId` and `value`) and its `logout`.
const agy = !!process.env.FAKE_ACP_AGY;
const AGY_WAYS = [
  { id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" },
  { id: "oauth-business", name: "Log in with Gemini Enterprise", description: "Log in with your Gemini Enterprise account" },
  { id: "gemini-api-key", name: "Gemini API key", description: "Use an API key with Gemini Developer API" },
  { id: "agent-platform", name: "Gemini Enterprise Agent Platform", description: "Use Gemini Enterprise Agent Platform (formerly Vertex AI) with Application Default Credentials or an API key" },
];
const AGY_MODES = [{ id: "default", name: "Default", description: "Default permission prompt flow" }, { id: "auto_edit", name: "Auto Edit", description: "Auto-approve file edit tools" }, { id: "yolo", name: "YOLO", description: "Auto-approve all tools" }];
const AGY_LEVELS = ["low", "medium", "high"];
const agyOpts = (su) => [
  { currentValue: "gemini-3.8-flash", options: [{ value: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }], id: "model", name: "Model", category: "model", type: "select" },
  { currentValue: su?.config?.thinking_level || "high", options: AGY_LEVELS.map((l) => ({ value: l, name: l[0].toUpperCase() + l.slice(1) })), id: "thinking_level", name: "Thinking Level", category: "thought_level", type: "select" },
  { currentValue: su?.config?.mode || "default", options: AGY_MODES.map((x) => ({ value: x.id, name: x.name, description: x.description })), id: "mode", name: "Session Mode", category: "mode", type: "select" },
];
const agySession = (id, su) => ({ sessionId: id, modes: { currentModeId: su?.config?.mode || "default", availableModes: AGY_MODES }, configOptions: agyOpts(su), models: { availableModels: [...AGY_LEVELS].reverse().map((l) => ({ modelId: `gemini-3.8-flash-${l}`, name: `Gemini 3.8 Flash (${l[0].toUpperCase() + l.slice(1)})`, description: `gemini-3.8-flash-${l}` })), currentModelId: `gemini-3.8-flash-${su?.config?.thinking_level || "high"}` }, _meta: { antigravity: { tier: { name: "Google AI Plus", id: "g1-plus-tier", upgradeUri: "https://antigravity.google/g1-upgrade" } } } });
/**
 * What an open was given: Claude's system prompt's append and whether its prompt is recorded (`snapshot`), its
 * settings, Filament's MCP address (the server named Filament, else the first with an address), the other servers by
 * name and transport (`servers`, only when there are any), those of them given an Authorization header (`authed`, by
 * name: never its value), those given at Filament's connector door (`doors`, their addresses) and the added folders
 * (`dirs`, only when there are any).
 */
// Filament's own server over stdio: its relay, given Filament's address in its variable (toolset.js `relayServer`).
const ownStdio = (p) => (p?.mcpServers || []).find((x) => x && !x.url && x.name === "filament" && Array.isArray(x.args)) || null;
const ownUrl = (p) => ((p?.mcpServers || []).find((x) => x && x.url && x.name === "filament") || (p?.mcpServers || []).find((x) => x && x.url))?.url || ownStdio(p)?.env?.find((e) => e.name === "FILAMENT_RELAY_ADDRESS")?.value;
const others = (p) => (p?.mcpServers || []).filter((x) => x && x.name !== "filament").map((x) => `${x.name}:${x.url ? x.type || "http" : "stdio"}`);
const authed = (p) => (p?.mcpServers || []).filter((x) => x && x.name !== "filament" && (x.headers || []).some((h) => String(h?.name).toLowerCase() === "authorization")).map((x) => x.name);
const doors = (p) => (p?.mcpServers || []).filter((x) => x && x.name !== "filament" && /\/mcp\/c\//.test(String(x.url || ""))).map((x) => x.url);
const given = (p) => ({ ...(p?._meta?.systemPrompt?.append ? { system: p._meta.systemPrompt.append } : {}), ...(p?._meta?.antigravity?.systemPrompt ? { agySystem: p._meta.antigravity.systemPrompt.append ?? null, ...("snapshot" in p._meta.antigravity.systemPrompt ? { agySnapshot: true } : {}) } : {}),...(p?._meta?.systemPrompt && "snapshot" in p._meta.systemPrompt ? { snapshot: p._meta.systemPrompt.snapshot } : {}),...(p?._meta?.claudeCode?.options?.settings ? { settings: p._meta.claudeCode.options.settings } : {}), ...(ownUrl(p) ? { mcpUrl: ownUrl(p) } : {}), ...(others(p).length ? { servers: others(p) } : {}), ...(authed(p).length ? { authed: authed(p) } : {}), ...(doors(p).length ? { doors: doors(p) } : {}), ...(p?.additionalDirectories?.length ? { dirs: p.additionalDirectories } : {}) });
/**
 * Claude Code connects to the MCP servers a session opens with — new, loaded or resumed — before it answers the open:
 * the handshake, then the tool list, whose length the session's prompts log.
 */
// A session's MCP handshake over node:http, each request on a socket of its own that closes with it: an agent that
// exits right after (`~lastwords`) leaves no pooled fetch socket behind for Node's exit on Windows to trip over (the
// libuv `UV_HANDLE_CLOSING` assertion, seen under the full suite's load).
const postJson = (url, body) => new Promise((resolve, reject) => { const req = httpRequest(url, { method: "POST", agent: false, headers: { "content-type": "application/json", accept: "*/*", "content-length": Buffer.byteLength(body) } }, (res) => { let text = ""; res.setEncoding("utf8"); res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, text })); res.on("error", reject); }); req.on("error", reject); req.end(body); });
// Over stdio, as an agent starts a server it is given so: the program with its arguments and variables, its messages a
// line each — the handshake, the tool list, then its input closed, which ends it.
const viaStdio = (server) => new Promise((resolve) => { const child = spawn(server.command, server.args, { env: { ...process.env, ...Object.fromEntries((server.env || []).map((e) => [e.name, e.value])) }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); let buf = ""; const got = []; const wanted = 2; child.stdout.setEncoding("utf8"); child.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) got.push(JSON.parse(line)); } if (got.length === 1 && !child.listed) { child.listed = true; child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n"); } if (got.length >= wanted) child.stdin.end(); }); child.on("error", () => resolve(got)); child.on("close", () => resolve(got)); child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } } }) + "\n"); });
// A tool's call to a server the agent started over stdio, as an agent makes one: the handshake, then `tools/call`, its
// answer the message that answers it — or, where none comes within FAKE_ACP_RELAY_MS (20 s), an error that says so.
// Cancelled (`signal`), the server is stopped.
const callViaStdio = (server, name, args, signal) => new Promise((resolve) => {
  const child = spawn(server.command, server.args, { env: { ...process.env, ...Object.fromEntries((server.env || []).map((e) => [e.name, e.value])) }, stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
  let buf = "";
  let done = false;
  const end = (r) => { if (done) return; done = true; clearTimeout(timer); child.stdin.end(); resolve(r); };
  const timer = setTimeout(() => end({ error: { message: "the server gave no answer" } }), Number(process.env.FAKE_ACP_RELAY_MS) || 20000);
  signal?.addEventListener("abort", () => { child.kill(); end({ error: { message: "cancelled" } }); });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }) + "\n");
      } else if (msg.id === 2) end(msg);
    }
  });
  child.on("error", (e) => end({ error: { message: e.message } }));
  child.on("close", () => end({ error: { message: "the server closed with no answer" } }));
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } } }) + "\n");
});
const connectMcp = async (su) => { if (su?.mcpStdio) { const got = await viaStdio(su.mcpStdio); su.mcpVia = "stdio"; su.mcpInit = got.find((m) => m.id === 1)?.result ? 200 : 0; su.mcpTools = (got.find((m) => m.id === 2)?.result?.tools || []).length; return; } if (!su?.mcpUrl) return; try { const r = await postJson(su.mcpUrl, JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake", version: "1" } } })); su.mcpInit = r.status; const l = await postJson(su.mcpUrl, JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })); su.mcpTools = (JSON.parse(l.text).result?.tools || []).length; } catch { su.mcpInit = 0; } };
const call = (method, sessionId, extra = {}) => process.env.FAKE_ACP_CALLS && appendFileSync(process.env.FAKE_ACP_CALLS, JSON.stringify({ method, sessionId, pid: process.pid, ...extra }) + "\n");
if (process.env.FAKE_ACP_ARGV) appendFileSync(process.env.FAKE_ACP_ARGV, JSON.stringify(process.argv.slice(2)) + "\n");
// `FAKE_ACP_ENVLOG`: the variables `FAKE_ACP_ENVNAMES` names (commas between), as this process sees them, a line a start.
if (process.env.FAKE_ACP_ENVLOG) appendFileSync(process.env.FAKE_ACP_ENVLOG, JSON.stringify(Object.fromEntries(String(process.env.FAKE_ACP_ENVNAMES || "").split(",").filter(Boolean).map((n) => [n, process.env[n] ?? null]))) + "\n");
if (keyVar) call("start", null, { keyed: !!process.env[keyVar] });
if (process.env.FAKE_ACP_HEADERS) appendFileSync(process.env.FAKE_ACP_HEADERS, JSON.stringify(process.env.ANTHROPIC_CUSTOM_HEADERS ?? null) + "\n");
// `--list-models`: the list as Cursor's CLI prints it, coloured, its own state marked, and nothing else (AF2).
if (process.argv.includes("--list-models"))
  process.stdout.write("Available models\r\n\r\n\x1b[1mfake-a - Fake A (current)\x1b[0m\r\nfake-b - Fake B\r\n\r\nTip: use --model <id> to switch.\r\n", () => process.exit(0));
let paramPicker = false;
const paramOpts = (s) => {
  const model = s?.config?.model || "grok-4.6"; const c = s?.config || {};
  const opts = [{ id: "mode", type: "select", currentValue: "agent", options: [{ value: "agent" }, { value: "plan" }] }, { id: "model", type: "select", currentValue: model, options: [{ value: "grok-4.6", name: "Grok 4.6" }, { value: "composer-2.5", name: "Composer 2.5" }, { value: "claude-opus-4-8", name: "Claude Opus 4.8" }] }];
  if (model !== "composer-2.5") opts.push({ id: "effort", category: "thought_level", type: "select", currentValue: c.effort || "high", options: [{ value: "low" }, { value: "medium" }, { value: "high" }, { value: "xhigh" }] });
  if (model === "claude-opus-4-8") opts.push({ id: "thinking", category: "thought_level", type: "select", currentValue: c.thinking || "false", options: [{ value: "false", name: "Off" }, { value: "true", name: "On" }] });
  opts.push({ id: "fast", category: "model_config", type: "select", currentValue: c.fast || "true", options: [{ value: "false", name: "Off" }, { value: "true", name: "On" }] });
  return opts;
};
const variantOpts = () => [{ id: "mode", type: "select", currentValue: "agent", options: [{ value: "agent" }] }, { id: "model", type: "select", currentValue: "grok-4.6[effort=high,fast=true]", options: [{ value: "grok-4.6[effort=high,fast=true]" }, { value: "composer-2.5[fast=true]" }] }];
/**
 * A prompt answered (FAKE_ACP_CLAUDE): once its session has none running, the first that waits runs. It holds its
 * place from now: a prompt sent in the moment before its cycle begins waits behind it, as Claude's queue keeps order.
 * @param {any} id
 */
const answered = (id) => {
  for (const [sessionId, s] of sessions) {
    if (!s.open?.delete(id) || s.open.size || !s.waiting?.length) continue;
    const next = s.waiting.shift();
    s.open.add(next.id);
    next.dequeued = true;
    // The cycle that ended said its result, as Claude's does, before the next prompt's echo.
    const result = { type: "result", subtype: "success", is_error: false };
    if (!s.resulted && wantsRaw(s.raw, result)) write({ jsonrpc: "2.0", method: "_claude/sdkMessage", params: { sessionId, message: result } });
    // Its next cycle begins a moment later, as Claude's model call does.
    setTimeout(() => handle(next), 100);
  }
};
/** Lines held to go out together (`together`), or null. @type {string[] | null} */
let held = null;
/** @param {any} o @param {() => void} [out]  called once the line is written to the pipe (not where `together` holds it) */
const write = (o, out) => {
  const line = JSON.stringify(o) + "\n";
  if (held) held.push(line);
  else process.stdout.write(line, out);
  if (o.id != null && !o.method && (o.result !== undefined || o.error !== undefined)) answered(o.id);
};
/** What `say` writes goes out in one write: Filament reads it in one go. @param {() => void} say */
const together = (say) => {
  held = [];
  try {
    say();
  } finally {
    const lines = held.join("");
    held = null;
    process.stdout.write(lines);
  }
};
// A picture an image tool saves: a 96×64 PNG, a gradient.
const picture = () => {
  const w = 96, ht = 64, rows = Buffer.alloc((w * 3 + 1) * ht);
  for (let y = 0; y < ht; y++) for (let x = 0; x < w; x++) rows.set([200, 40 + x * 2, 60 + y * 3], y * (w * 3 + 1) + 1 + x * 3);
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body)); return Buffer.concat([len, body, crc]); };
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(ht, 4); head.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
};
const notify = (sessionId, update) => write({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } });
// A word a test lets come (FAKE_ACP_AUTH_GATE, FAKE_ACP_USAGE_GATE): once its gate, a file, is there; the file is removed
// once the word is written to the pipe, so a test that holds its own thread till then knows the word waits there unread.
const gateOpen = async (gate) => { if (gate) while (!existsSync(gate)) await new Promise((r) => setTimeout(r, 20)); };
const gateTaken = (gate) => () => { if (gate) rmSync(gate, { force: true }); };
// Who it runs as (`_auth/status_update`), once FAKE_ACP_AUTH_GATE lets it.
const saysWho = async () => {
  const gate = process.env.FAKE_ACP_AUTH_GATE;
  await gateOpen(gate);
  write({ jsonrpc: "2.0", method: "_auth/status_update", params: { authStatus } }, gateTaken(gate));
};
// The agent dies with `code` (`die`): it lets go of its stdin and ends by itself once its words are out, as a process
// with nothing left to do ends. `process.exit` at once in its place can trip libuv's UV_HANDLE_CLOSING assertion on
// Windows as Node tears down with work still in flight — a call just answered — and the agent then exits 0xC0000409,
// not with its code (nodejs/node#56645, seen under load). What still ticks stops (`dying`); a test's timer that would
// hold it longer — a word due in a minute, another session's slow step — is cut short by an exit DIE_GRACE_MS on, its
// last work long done by then.
const DIE_GRACE_MS = 250;
let dying = false;
const die = (code) => { dying = true; process.exitCode = code; process.stdin.destroy(); setTimeout(() => process.exit(code), DIE_GRACE_MS).unref(); };
// A session's commands, published a few ms after its open's answer — a new session's, a loaded or resumed one's —
// as Claude's adapter does (its `sendAvailableCommandsUpdate` after all three); none under FAKE_ACP_NO_COMMANDS. FAKE_ACP_COMMANDS_MS: how long after, by the session's turn among this agent's (`5,60000`: the
// first after 5 ms, the rest after a minute; the last one stands for those after it), `early` for ahead of the open's
// answer. FAKE_ACP_COMMANDS_GATE: once that file exists instead. Then they're out (`commandsOut`), and a prompt waiting
// for them goes on (`onCommandsOut`).
const sayCommands = (id) => notify(id, { sessionUpdate: "available_commands_update", availableCommands: [{ name: "review", description: "Review the diff" }, { name: "commit", description: "Commit" }, ...(process.env.FAKE_ACP_OWN_COMPACT ? [{ name: "compact", description: "Clear conversation history but keep a summary in context. Optional: /compact [instructions for summarization]" }] : []), ...(process.env.FAKE_ACP_SESSION_COMMANDS ? [{ name: `for-${id}`, description: "this session's own" }] : [])] });
let sessionsOpened = 0;
const whenCommands = (id, say) => { const out = () => { if (!process.env.FAKE_ACP_NO_COMMANDS) say(); const s = sessions.get(id); if (s) { s.commandsOut = true; s.onCommandsOut?.(); } }; const gate = process.env.FAKE_ACP_COMMANDS_GATE; if (gate) { const look = () => (existsSync(gate) ? out() : setTimeout(look, 20)); return void look(); } const all = String(process.env.FAKE_ACP_COMMANDS_MS || "5").split(","); const when = all[Math.min(sessionsOpened++, all.length - 1)].trim(); if (when === "early") out(); else setTimeout(out, Number(when)).unref(); };
// Words a test lets come after a turn: at once, or — under FAKE_ACP_WAKE_GATE, a folder — once a file named for the
// session is there.
const opened = (sessionId, fn) => { const gate = process.env.FAKE_ACP_WAKE_GATE; const go = () => (gate && !existsSync(join(gate, sessionId)) ? setTimeout(go, 20) : fn()); go(); };
// FAKE_ACP_TICK_DIR: the agent's next step, when the test says so — a file `tick` there is a call it makes and ends at
// once, with no message of its own (so no card): words that wait in Filament for the agent's next call go then
// (HarnessV4_Tasks C34). A turn ticks while `alive()`.
let ticked = 0;
const tickWhile = (sessionId, alive) => {
  const tickDir = process.env.FAKE_ACP_TICK_DIR;
  if (!tickDir) return;
  const ticker = setInterval(() => {
    if (dying || !alive()) return clearInterval(ticker);
    const f = join(tickDir, "tick");
    if (!existsSync(f)) return;
    rmSync(f, { force: true });
    const id = `tick_${++ticked}`;
    notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, title: "tick", kind: "think", status: "in_progress" });
    notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed" });
  }, 20);
};
let reqId = 1000; const pendingPerm = new Map(); let clientCaps = {};
// Ask the client for something (permission, file, terminal) and wait for its answer.
const askClient = (method, params) => new Promise((resolve) => { const id = ++reqId; pendingPerm.set(id, resolve); write({ jsonrpc: "2.0", id, method, params }); });
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => { buf += d; let nl; while ((nl = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1); if (line) handle(JSON.parse(line)); } });
async function handle(m) {
  if (m.id != null && (m.result !== undefined || m.error !== undefined) && !m.method) { const r = pendingPerm.get(m.id); if (r) { pendingPerm.delete(m.id); r(m.error ? { __error: m.error } : m.result); } return; }
  const reply = (result, out) => write({ jsonrpc: "2.0", id: m.id, result }, out);
  if (m.method === "initialize" && process.env.FAKE_ACP_INIT_GATE) while (!existsSync(process.env.FAKE_ACP_INIT_GATE)) await new Promise((r) => setTimeout(r, 20));
  if (m.method === "initialize") { paramPicker = !!m.params?.clientCapabilities?._meta?.parameterizedModelPicker; clientCaps = m.params?.clientCapabilities || {}; reply({ protocolVersion: 1, agentCapabilities: { loadSession: !process.env.FAKE_ACP_NO_LOAD, promptCapabilities: { image: true, embeddedContext: !!process.env.FAKE_ACP_EMBED }, ...(process.env.FAKE_ACP_MCP_CAPS ? { mcpCapabilities: { http: process.env.FAKE_ACP_MCP_CAPS === "http", sse: false } } : {}), ...(process.env.FAKE_ACP_SESSION_CAPS ? { sessionCapabilities: Object.fromEntries(process.env.FAKE_ACP_SESSION_CAPS.split(",").map((c) => [c, {}])) } : {}), ...(process.env.FAKE_ACP_QODER_QUEUE ? { _meta: { qoder: { promptQueueing: true } } } : {}), ...(process.env.FAKE_ACP_AGY_PROMPT || agy ? { _meta: { antigravity: { tier: true, systemPrompt: { append: true } } } } : {}), ...(process.env.FAKE_ACP_CLAUDE || authStatus ? { _meta: { ...(process.env.FAKE_ACP_CLAUDE ? { claudeCode: { promptQueueing: true } } : {}), ...(authStatus ? { authStatus: {} } : {}) } } : {}), ...(homeLogin || agy ? { auth: { logout: {} } } : {}) }, authMethods: ownWays ? ownWays.filter((w) => !w?._meta?.["terminal-auth"] || clientCaps._meta?.["terminal-auth"] === true) : agy ? AGY_WAYS : homeLogin ? (clientCaps.auth?.terminal ? TERMINAL_WAYS : []) : [{ id: "fake_login", name: "Fake" }], agentInfo: { name: "fake-acp", version: "1.0" }, ...(process.env.FAKE_ACP_STEERING ? { _meta: { steering: { supported: true } } } : {}) }); if (authStatus) setTimeout(() => saysWho(), Number(process.env.FAKE_ACP_AUTH_DELAY_MS || 5)); if (process.env.FAKE_ACP_INIT_EXIT_MS) setTimeout(() => process.stderr.write("fake agent: gone at its start.\n", () => die(3)), Number(process.env.FAKE_ACP_INIT_EXIT_MS)); return; }
  if (m.method === "authenticate") {
    call("authenticate", null, { methodId: m.params?.methodId ?? null });
    if (process.env.FAKE_ACP_AUTHENTICATE === "wait") return;
    if (process.env.FAKE_ACP_AUTHENTICATE === "fail") return write({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "the fake's sign-in page was closed" } });
    if (process.env.FAKE_ACP_AUTHENTICATE_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_AUTHENTICATE_MS)));
    if (process.env.FAKE_ACP_SIGNED_IN) writeFileSync(process.env.FAKE_ACP_SIGNED_IN, "signed in");
    return reply({});
  }
  if (m.method === "session/new" && signedOutHere()) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "Authentication required" } });
  if (m.method === "logout" && agy) { call("logout", null); if (process.env.FAKE_ACP_SIGNED_IN) rmSync(process.env.FAKE_ACP_SIGNED_IN, { force: true }); return reply({}); }
  if (m.method === "logout" && homeLogin) { rmSync(homeLogin, { force: true }); reply({}); return write({ jsonrpc: "2.0", method: "_auth/status_update", params: { authStatus: AUTH.none } }); }
  if (m.method === "session/new" && process.env.FAKE_ACP_NEW_CRASH) return process.stderr.write("[session/create] fake: the session store is locked\n", () => die(1));
  if (m.method === "session/new" && homeLogin && homeAuth().kind === "none") return write({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "Authentication required" } });
  if (m.method === "session/new") { const id = `sess_${Math.random().toString(36).slice(2, 10)}`; sessions.set(id, { cwd: m.params.cwd, prompts: [], mcp: (m.params.mcpServers || []).length, mcpUrl: ownUrl(m.params) || null, mcpStdio: ownStdio(m.params), disableBuiltIn: !!m.params._meta?.disableBuiltInTools, raw: m.params._meta?.claudeCode?.emitRawSDKMessages ?? false, persist: m.params._meta?.claudeCode?.options?.persistSession ?? null }); call("session/new", id, given(m.params));
    if (process.env.FAKE_ACP_SLOW_NEW_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_SLOW_NEW_MS)));
    await connectMcp(sessions.get(id)); whenCommands(id, () => sayCommands(id)); if (agy) return reply(agySession(id, sessions.get(id))); if (process.env.FAKE_ACP_PARAMS) return reply({ sessionId: id, modes: { currentModeId: "agent", availableModes: [{ id: "agent" }, { id: "plan" }] }, configOptions: paramPicker ? paramOpts(sessions.get(id)) : variantOpts() }); if (process.env.FAKE_ACP_CONFIG) return reply({ sessionId: id, modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "plan" }, { id: "bypassPermissions" }] }, configOptions: [{ id: "model", type: "select", currentValue: "default", options: [{ value: "default", name: "Default (recommended)", description: "Opus (1M context)" }, { value: "opus[1m]", name: "Opus (1M context)", description: "Opus 5 with 1M context · Best for everyday, complex tasks" }, { value: "sonnet", name: "Sonnet 5", description: "Sonnet 5 · Efficient for routine tasks" }, ...customModel] }, { id: "effort", type: "select", currentValue: "default", options: [{ value: "default" }, { value: "low" }, { value: "high" }, { value: "xhigh" }] }] });
    return reply({ sessionId: id, modes: { currentModeId: "agent", availableModes: [{ id: "agent" }, { id: "ask" }] }, models: process.env.FAKE_ACP_NO_MODELS ? undefined : { currentModelId: process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "fake-default", availableModels: [{ modelId: "fake-a" }, { modelId: "fake-b" }] } }); }
  if (m.method === "session/load") { call("session/load", m.params.sessionId, given(m.params)); if (m.params.sessionId === "sess_busy") return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "Claude Code process exited with code 1. stderr: Error: Session sess_busy is running as a background session (sess_busy). Run `claude attach sess_busy` to open it, or `claude stop sess_busy` first to resume it here." } } }); if (!process.env.FAKE_ACP_ALLOW_LOAD) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32000, message: "load not supported" } }); sessions.set(m.params.sessionId, { cwd: m.params.cwd, prompts: [], loaded: true, mcp: (m.params.mcpServers || []).length, mcpUrl: given(m.params).mcpUrl || null, mcpStdio: ownStdio(m.params), raw: m.params._meta?.claudeCode?.emitRawSDKMessages ?? false }); await connectMcp(sessions.get(m.params.sessionId)); whenCommands(m.params.sessionId, () => sayCommands(m.params.sessionId)); if (process.env.FAKE_ACP_LATE_REPLAY) { const sid = m.params.sessionId; const told = [{ sessionUpdate: "user_message_chunk", content: { type: "text", text: "REPLAYED the old question" } }, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "REPLAYED an old thought" } }, { sessionUpdate: "tool_call", toolCallId: "old_read", title: "REPLAYED old.md", kind: "read", status: "completed", locations: [] }, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "REPLAYED the old answer" } }]; told.forEach((u, i) => setTimeout(() => notify(sid, u), 100 * (i + 1))); } return reply(process.env.FAKE_ACP_CONFIG ? { modes: { currentModeId: "default", availableModes: [{ id: "default" }, { id: "plan" }, { id: "bypassPermissions" }] }, configOptions: [{ id: "model", type: "select", currentValue: "default", options: [{ value: "default", name: "Default (recommended)", description: "Opus (1M context)" }, { value: "opus[1m]", name: "Opus (1M context)", description: "Opus 5 with 1M context · Best for everyday, complex tasks" }, { value: "sonnet", name: "Sonnet 5", description: "Sonnet 5 · Efficient for routine tasks" }, ...customModel] }, { id: "effort", type: "select", currentValue: "default", options: [{ value: "default" }, { value: "low" }, { value: "high" }, { value: "xhigh" }] }] } : {}); }
  // A session reattached without its history replayed, and one let go of (sent only where they are declared).
  // A session resumed while it is open here, under FAKE_ACP_SAVED_DIR, is torn down and opened again with what the
  // resume gives it, as Claude's adapter does with a live session opened with other settings: Claude Code's exit writes
  // its totals first, and the resumed query goes on from them.
  // FAKE_ACP_REOPENS_ON: the resumed session runs on that model and says so. FAKE_ACP_REOPENS_SAYS: it says that model
  // and runs on its default, as Claude Code did on 11-17 with a model it could not restore (its adapter named it all the same).
  if (m.method === "session/resume" && process.env.FAKE_ACP_SAVED_DIR && sessions.get(m.params.sessionId)?.modelsSpent) { const live = sessions.get(m.params.sessionId); savedTotals.set(m.params.sessionId, { costSpent: live.costSpent, modelsSpent: structuredClone(live.modelsSpent) }); }
  if (m.method === "session/resume") { call("session/resume", m.params.sessionId, given(m.params)); if (process.env.FAKE_ACP_RESUME_FAIL) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "this session cannot be resumed" } } }); const fork = forks.get(m.params.sessionId); sessions.set(m.params.sessionId, { cwd: m.params.cwd, prompts: fork ? [...fork.prompts] : [], loaded: true, mcp: (m.params.mcpServers || []).length, mcpUrl: given(m.params).mcpUrl || null, mcpStdio: ownStdio(m.params), raw: m.params._meta?.claudeCode?.emitRawSDKMessages ?? false }); await connectMcp(sessions.get(m.params.sessionId)); whenCommands(m.params.sessionId, () => sayCommands(m.params.sessionId)); Object.assign(sessions.get(m.params.sessionId), structuredClone(savedTotals.get(m.params.sessionId) || {})); const says = process.env.FAKE_ACP_REOPENS_SAYS; const on = process.env.FAKE_ACP_REOPENS_ON || says; if (says) Object.assign(sessions.get(m.params.sessionId), { model: "default", config: { model: "default" } }); else if (on) Object.assign(sessions.get(m.params.sessionId), { model: on, config: { model: on } }); return reply({ modes: { currentModeId: "agent", availableModes: [{ id: "agent" }, { id: "ask" }] }, ...(on ? { configOptions: [{ id: "model", type: "select", currentValue: on, options: [{ value: "default" }, { value: "opus[1m]" }, { value: "sonnet" }, ...customModel] }, { id: "effort", type: "select", currentValue: "default", options: [{ value: "default" }, { value: "low" }, { value: "high" }, { value: "xhigh" }] }] } : {}) }); }
  // FAKE_ACP_FORK_GATE: a fork is asked (logged, `fork asked`), and made once that file exists.
  if (m.method === "session/fork") { const from = sessions.get(m.params.sessionId); if (!from) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "unknown session" } }); const forkGate = process.env.FAKE_ACP_FORK_GATE; if (forkGate) { call("fork asked", m.params.sessionId); while (!existsSync(forkGate)) await new Promise((r) => setTimeout(r, 10)); } const id = `fork_${Math.random().toString(36).slice(2, 10)}`; forks.set(id, { prompts: [...from.prompts] }); call("session/fork", id, { from: m.params.sessionId, ...given(m.params) }); return reply({ sessionId: id }); }
  if (m.method === "session/delete") { if (process.env.FAKE_ACP_DELETE_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_DELETE_MS))); call("session/delete", m.params.sessionId); sessions.delete(m.params.sessionId); forks.delete(m.params.sessionId); return reply({}); }
  // A session closed saves its running totals for the query that resumes it, as Claude Code writes them as it exits —
  // except while FAKE_ACP_UNSAVED names a file that exists: Claude Code killed before it wrote, what it saved before stays.
  if (m.method === "session/close") { call("session/close", m.params.sessionId); const closing = sessions.get(m.params.sessionId); if (closing?.modelsSpent && !(process.env.FAKE_ACP_UNSAVED && existsSync(process.env.FAKE_ACP_UNSAVED))) savedTotals.set(m.params.sessionId, { costSpent: closing.costSpent, modelsSpent: structuredClone(closing.modelsSpent) }); sessions.delete(m.params.sessionId); return reply({}); }
  if (m.method === "session/list") return reply({ sessions: process.env.FAKE_ACP_ALLOW_LOAD ? [{ sessionId: "sess_old1", cwd: process.cwd(), title: "Old chat from the terminal", updatedAt: "2026-09-12T10:00:00.000Z" }, { sessionId: "sess_old2", cwd: process.cwd(), title: "Another", updatedAt: "2026-09-11T10:00:00.000Z" }, { sessionId: "sess_busy", cwd: process.cwd(), title: "Open in a terminal", updatedAt: "2026-09-13T00:00:00.000Z" }] : [] });
  if (m.method === "session/set_mode") { if (process.env.FAKE_ACP_SLOW_MODE_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_SLOW_MODE_MS))); const s = sessions.get(m.params.sessionId); if (s) { s.mode = m.params.modeId; s.onMode?.(); } call("session/set_mode", m.params.sessionId, { modeId: m.params.modeId }); return reply({}); }
  if (m.method === "session/set_config_option" && agy) {
    const s = sessions.get(m.params.sessionId); const o = agyOpts(s).find((x) => x.id === m.params.configId);
    if (!o || !o.options.some((x) => x.value === m.params.value)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Invalid params" } });
    call("session/set_config_option", m.params.sessionId, { configId: m.params.configId, value: m.params.value });
    if (s) (s.config ||= {})[m.params.configId] = m.params.value;
    return reply({ configOptions: agyOpts(s) });
  }
  if (m.method === "session/set_config_option" && process.env.FAKE_ACP_PARAMS) {
    const s = sessions.get(m.params.sessionId); const o = paramOpts(s).find((x) => x.id === m.params.configId);
    if (!o) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Invalid params", data: { message: `Unknown model config option: ${m.params.configId}` } } });
    if (!o.options.some((x) => x.value === m.params.value)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "Invalid params", data: { message: `Invalid value for ${m.params.configId}: ${m.params.value}` } } });
    if (s) { (s.config ||= {})[m.params.configId] = m.params.value; if (m.params.configId === "model") { delete s.config.effort; delete s.config.thinking; delete s.config.fast; } (s.sets ||= []).push(`${m.params.configId}=${m.params.value}`); }
    return reply({ configOptions: paramOpts(s) });
  }
  // FAKE_ACP_KEEPS_MODEL: a set of the model the agent does not take — it stays on that one, and its answer names it.
  if (m.method === "session/set_config_option") { const s = sessions.get(m.params.sessionId); const value = m.params.configId === "model" && process.env.FAKE_ACP_KEEPS_MODEL ? process.env.FAKE_ACP_KEEPS_MODEL : m.params.value; if (s) { (s.config ||= {})[m.params.configId] = value; if (m.params.configId === "model") s.model = value; } const cfgOpts = [{ id: "model", type: "select", currentValue: s?.config?.model || "default", options: [{ value: "default" }, { value: "opus[1m]" }, { value: "sonnet" }, ...customModel] }, { id: "effort", type: "select", currentValue: s?.config?.effort || "default", options: [{ value: "default" }, { value: "low" }, { value: "high" }, { value: "xhigh" }] }]; return reply({ configOptions: cfgOpts }); }
  if (m.method === "session/set_model") { const s = sessions.get(m.params.sessionId); if (s) s.model = m.params.modelId; return reply({}); }
  // The words go into a `~steerable` turn; with no turn running they are handed back where the host asked for that
  // (`promptRequired`), and start a turn of their own where it did not (claude-agent-acp's default).
  if (m.method === "_session/steering") {
    if (!process.env.FAKE_ACP_STEERING) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "Method not found" } });
    const { sessionId, prompt, _meta } = m.params || {}; const s = sessions.get(sessionId);
    if (!s) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "Session not found" } } });
    if (!Array.isArray(prompt) || !prompt.length) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32602, message: "steer params require a non-empty prompt array" } });
    const words = prompt.map((p) => p.text || "").join(""); const idle = _meta?.steering?.idleBehavior ?? null;
    const pictures = prompt.filter((p) => p.type === "image").length;
    call("_session/steering", sessionId, { words, idle, ...(pictures ? { images: pictures } : {}) });
    if (!s.onSteer) return reply(idle === "promptRequired" ? { outcome: "promptRequired", reason: "noRunningTurn" } : { outcome: "startedNewTurn" });
    const gate = process.env.FAKE_ACP_STEER_GATE;
    const answer = () => (gate && !existsSync(gate) ? setTimeout(answer, 20) : reply({ outcome: "injected" }));
    answer();
    return s.onSteer(words, pictures);
  }
  // A `~rfdsub-bg` sub-agent's own session cancelled (ACP's sub-agents RFD grants `cancel`): that sub-agent alone stops,
  // as Claude's adapter stops its task; its parent's session goes on.
  if (m.method === "session/cancel") for (const s of sessions.values()) if (s.bgChild && s.bgChild.kid === m.params?.sessionId) { const stop = s.bgChild.stop; s.bgChild = null; return void stop(); }
  // A `~steps` turn cancelled: it ends cancelled, and its session keeps what it did.
  if (m.method === "session/cancel" && sessions.get(m.params?.sessionId)?.stepping != null) { const s = sessions.get(m.params.sessionId); const id = s.stepping; s.stepping = null; s.kept = [...s.done]; return void write({ jsonrpc: "2.0", id, result: { stopReason: "cancelled", usage: STEP_USAGE } }); }
  // A `~dropcall` turn cancelled while its MCP call waits: the call is dropped, and the turn ends cancelled.
  if (m.method === "session/cancel") sessions.get(m.params?.sessionId)?.dropCall?.abort();
  // A `~leftcmd` turn cancelled: the shell it ran its command in is ended, and not what the shell ran.
  if (m.method === "session/cancel") { const s = sessions.get(m.params?.sessionId); try { s?.leftShell?.kill(); } catch {} if (s) s.leftShell = null; }
  // Prompts waiting in Claude's queue are dropped by a cancel, answered cancelled; then the turn's own cancel.
  if (m.method === "session/cancel") for (const p of sessions.get(m.params?.sessionId)?.waiting?.splice(0) || []) write({ jsonrpc: "2.0", id: p.id, result: { stopReason: "cancelled" } });
  // A `~queue` turn cancelled: what waits in its queue is dropped, answered cancelled, and so is the turn.
  if (m.method === "session/cancel" && sessions.get(m.params?.sessionId)?.queue) { const s = sessions.get(m.params.sessionId); const q = s.queue; s.queue = null; s.queueing = null; q.cancelled = true; for (const p of q.waiting.splice(0)) write({ jsonrpc: "2.0", id: p.id, result: { stopReason: "cancelled" } }); if (q.active != null) write({ jsonrpc: "2.0", id: q.active, result: { stopReason: "cancelled" } }); return; }
  if (m.method === "session/cancel") { const s = sessions.get(m.params?.sessionId); if (s?.onSteer) { s.queueing = null; s.onQueued = null; s.onSteer = null; const gate = process.env.FAKE_ACP_CANCEL_GATE; const end = () => (gate && !existsSync(gate) ? setTimeout(end, 20) : write({ jsonrpc: "2.0", id: s.steerable, result: { stopReason: "cancelled" } })); end(); return; } if (s && s.hung != null) { write(s.hungFails ? { jsonrpc: "2.0", id: s.hung, error: { code: -32603, message: "Internal error", data: { errorKind: "overloaded", details: "Overloaded" } } } : { jsonrpc: "2.0", id: s.hung, result: { stopReason: "cancelled" } }); s.hung = null; s.hungFails = false; } return; }
  if (m.method === "session/prompt") {
    const { sessionId, prompt } = m.params; const s = sessions.get(sessionId); if (!s) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "Session not found" } } });
    // A prompt sent while a turn that takes them runs (`~steerable`, `~queue`): queued, for that turn to fold in.
    // Its pictures are counted (`images`), and its echo carries them as Claude's raw user message does. Once
    // <gate>/refusequeue exists, the next one is refused at once, unechoed and unrecorded, and the file goes.
    const refusing = s.queueing && process.env.FAKE_ACP_QUEUE_GATE ? join(process.env.FAKE_ACP_QUEUE_GATE, "refusequeue") : "";
    if (refusing && existsSync(refusing)) { rmSync(refusing, { force: true }); return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "the prompt was refused as sent" } } }); }
    if (s.queueing) { const words = prompt.map((p) => p.text || "").join(""); const pictures = prompt.filter((p) => p.type === "image"); call("queued prompt", sessionId, { words, ...(pictures.length ? { images: pictures.length } : {}) }); s.open?.add(m.id); s.queueing.push({ id: m.id, words, pictures }); s.onQueued?.(); return; }
    // One sent while another runs that no turn folds in waits for the session's prompts to be answered (Claude's queue).
    if (process.env.FAKE_ACP_CLAUDE && s.open?.size && !m.dequeued) { const pictures = prompt.filter((p) => p.type === "image").length; call("queued prompt", sessionId, { words: prompt.map((p) => p.text || "").join(""), ...(pictures ? { images: pictures } : {}) }); (s.waiting ||= []).push(m); return; }
    if (process.env.FAKE_ACP_CLAUDE) (s.open ||= new Set()).add(m.id);
    if (process.env.FAKE_ACP_COMMANDS_GATE && !s.commandsOut) await new Promise((r) => (s.onCommandsOut = r));
    if (process.env.FAKE_ACP_FAIL_KIND) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: process.env.FAKE_ACP_FAIL_KIND } } });
    if (process.env.FAKE_ACP_FAIL_SAID) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: process.env.FAKE_ACP_FAIL_SAID } } });
    const sent = prompt.map((p) => p.text || "").join("");
    const most = Number(process.env.FAKE_ACP_OVERFLOW_SEEDED) || 0;
    if (process.env.FAKE_ACP_OVERFLOW_SEEDED && /Earlier conversation \(from another assistant/.test(sent)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: `Internal error: Prompt is too long${most > 1 ? `: ${most + 200} tokens > ${most} maximum` : ""}`, data: { errorKind: "invalid_request" } } });
    const text = personWords(sent);
    s.prompts.push(text);
    // `~cleared`: the session's running totals begin again first, as Claude Code's /clear begins them (`costSoFar`) —
    // by model too, its results counted from nothing, under a Claude session of its own — and it says so in its raw
    // `conversation_reset` (below, once the prompt's echo is out), which names a new conversation.
    const cleared = /~cleared\b/i.test(text) ? s.claudeId || sessionId : null;
    if (cleared) Object.assign(s, { costSpent: 0, modelsSpent: {}, results: 0, loaded: false, claudeId: `cleared_${Math.random().toString(36).slice(2, 10)}` });
    if (process.env.FAKE_ACP_LOG) appendFileSync(process.env.FAKE_ACP_LOG, JSON.stringify({ sessionId, cwd: s.cwd, config: s.config || null, model: s.model || (process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : null), text, prompt: sent, images: prompt.filter((p) => p.type === "image").length, resources: prompt.filter((p) => p.type === "resource").length, mcp: s.mcp || 0, mcpUrl: s.mcpUrl || null, mcpInit: s.mcpInit ?? null, mcpTools: s.mcpTools ?? null, mcpVia: s.mcpVia || (s.mcpUrl ? "http" : null), disableBuiltIn: !!s.disableBuiltIn, loaded: !!s.loaded, raw: s.raw || false }) + "\n");
    // The prompt that carries a cancelled `~steps` turn on: what the session kept of it, and the words it heard — or,
    // where the words say `~failkept`, its failure, overloaded, as an adapter fails a prompt.
    if (s.kept) { const kept = s.kept; s.kept = null; const words = text.split("\n---\n").pop(); if (/~failkept\b/.test(words)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "overloaded", details: "Overloaded" } } }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `kept:${kept.join(",")} heard:${words}` } }); return reply({ stopReason: "end_turn", usage: STEP_USAGE }); }
    // `~failsecond`: the session's next prompt fails, overloaded, as an adapter fails one; this one goes on as it says.
    if (s.failNext) { s.failNext = false; return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "overloaded", details: "Overloaded" } } }); }
    if (/~failsecond\b/i.test(text)) s.failNext = true;
    // `~pricesecond`: the session's next prompt is answered as `~priced` answers, what it spent said.
    if (s.priceNext) { s.priceNext = false; notify(sessionId, { sessionUpdate: "usage_update", used: 2156, size: 200000, cost: costSoFar(s, 0.0309) }); return reply({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 100, cachedWriteTokens: 2000, totalTokens: 2156 } }); }
    if (/~pricesecond\b/i.test(text)) s.priceNext = true;
    if (/~slowstart\b/i.test(text)) {
      // Silent before the first output.
      const gate = process.env.FAKE_ACP_HOLD_GATE;
      if (gate) while (!existsSync(join(gate, "slowstart"))) await new Promise((r) => setTimeout(r, 20));
      else await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_SLOW_MS) || 20000));
    }
    // Claude's adapter's marks for the scripted turns below (FAKE_ACP_CLAUDE): each chunk names its model call and each
    // call its tool, and its raw SDK messages come under the session it prompted, a sub-agent's marked by its parent.
    const claude = !!process.env.FAKE_ACP_CLAUDE;
    const raw = (message) => {
      if (message.type === "result") s.resulted = true;
      if (claude && wantsRaw(s.raw, message)) write({ jsonrpc: "2.0", method: "_claude/sdkMessage", params: { sessionId, message } });
    };
    // The prompt's echo, as its cycle takes it.
    s.resulted = false;
    raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text: sent }] } });
    if (cleared) raw({ type: "conversation_reset", new_conversation_id: `conv_${Math.random().toString(36).slice(2, 10)}`, uuid: `reset_${s.prompts.length}`, session_id: cleared, trigger: "clear" });
    // The agent's own compaction, asked for (AC5-5): `/compact [what to keep]`, as Claude's adapter says a manual one.
    if (process.env.FAKE_ACP_OWN_COMPACT && /^\/compact\b/.test(text)) {
      const told = text.replace(/^\/compact\s*/, "");
      call("own compact", sessionId, { told });
      const own = compacting(sessionId, "u_own", raw, true);
      own.start();
      const gate = process.env.FAKE_ACP_OWN_COMPACT_GATE;
      if (gate) {
        s.hung = m.id;
        while (!existsSync(gate) && s.hung === m.id) await new Promise((r) => setTimeout(r, 20));
        if (s.hung !== m.id) return; // cancelled: session/cancel answered the prompt
        s.hung = null;
      }
      if (process.env.FAKE_ACP_OWN_COMPACT === "fail") {
        own.end({ error: "Not enough messages to compact." });
        return reply({ stopReason: "end_turn" });
      }
      own.end({ pre: 120000, post: 18000, ms: 31000, summary: `Kept: ${s.prompts.slice(0, -1).join(" | ")}${told ? ` (keeping ${told})` : ""}` });
      s.prompts = [`[compacted${told ? ` keeping ${told}` : ""}: ${s.prompts.slice(0, -1).join(" | ")}]`];
      return reply({ stopReason: "end_turn", usage: { inputTokens: 30, outputTokens: 900, cachedReadTokens: 119000, cachedWriteTokens: 0, totalTokens: 119930 } });
    }
    if (process.env.FAKE_ACP_TRANSCRIPT_FAIL && /Summarize the conversation below so that work can continue from your summary alone/.test(text)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "overloaded", details: "Overloaded" } } });
    if (text.startsWith("[Filament: this conversation has reached its compaction line.")) {
      if (process.env.FAKE_ACP_SUMMARY_FAIL) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "overloaded", details: "Overloaded" } } });
      if (process.env.FAKE_ACP_SUMMARY_TRIES) {
        const asked = await askClient("session/request_permission", { sessionId, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "no", name: "Reject", kind: "reject_once" }], toolCall: { toolCallId: "sum_edit", title: "Edit notes.md", kind: "edit", status: "pending" } });
        const tried = { permission: asked?.outcome?.optionId || asked?.outcome?.outcome || null };
        for (const [what, method, params] of [["write", "fs/write_text_file", { sessionId, path: join(s.cwd, "notes.md"), content: "x" }], ["terminal", "terminal/create", { sessionId, command: "echo", args: ["x"] }], ["read", "fs/read_text_file", { sessionId, path: join(s.cwd, "README.md") }]]) {
          const r = await askClient(method, params);
          tried[what] = r?.__error ? `error: ${r.__error.message}` : "ok";
        }
        call("summary: tried", sessionId, tried);
      }
      const gate = process.env.FAKE_ACP_SUMMARY_GATE;
      if (gate) while (!existsSync(gate)) await new Promise((r) => setTimeout(r, 20));
      const reading = Date.now() + Number(process.env.FAKE_ACP_SUMMARY_READS_MS || 0);
      while (Date.now() < reading) { await askClient("fs/read_text_file", { sessionId, path: join(s.cwd, "README.md") }); await new Promise((r) => setTimeout(r, 100)); }
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "<analysis>Going through it.</analysis>\n" } });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `<summary>The session heard: ${s.prompts.slice(0, -1).join(" | ")}</summary>` } });
      return reply({ stopReason: "end_turn", usage: { inputTokens: 5, outputTokens: 40, cachedReadTokens: 900, cachedWriteTokens: 0, totalTokens: 945 } });
    }
    const say = (sid, kind, words, msg) => notify(sid, { sessionUpdate: kind, content: { type: "text", text: words }, ...(claude ? { messageId: msg } : {}) });
    const named = (name, extra = {}) => (claude ? { _meta: { claudeCode: { toolName: name }, ...extra } } : Object.keys(extra).length ? { _meta: extra } : {});
    const asst = (msg, content, parent = null) => raw({ type: "assistant", parent_tool_use_id: parent, message: { id: msg, role: "assistant", content } });
    const res = (id, content, parent = null) => raw({ type: "user", parent_tool_use_id: parent, message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content }] } });
    // A call's start as Claude's adapter streams one (`~work`): announced bare as its model begins to write it, its input —
    // and the file it names (`path`) — on the update that follows; its end, which the caller sends, carries neither.
    // Another agent announces the call whole. `under`: the Task call a sub-agent's call runs under.
    const begins = (id, tool, kind, bare, title, input, { path = null, under = null } = {}) => {
      const at = path ? { locations: [{ path }] } : {};
      if (!claude) return notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, title, kind, status: "in_progress", rawInput: input, ...at });
      const meta = { _meta: { claudeCode: { toolName: tool, ...(under ? { parentToolUseId: under } : {}) } } };
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, title: bare, kind, status: "pending", rawInput: {}, ...meta });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, title, rawInput: input, ...at, ...meta });
    };
    // The plan's windows as Claude's adapter says them (AC3-6): beside the context's size once a model call has used
    // some, and raw where the session asked for them; the reset in epoch seconds.
    const planWindow = (info) => notify(sessionId, { sessionUpdate: "usage_update", used: 1200, size: 200000, _meta: { "_claude/rateLimit": info } });
    const inSeconds = (ms) => Math.round((Date.now() + ms) / 1000);
    // `/usage`: Claude Code's report, the figures raw on the synthetic message that carries its words (AC3-6).
    if (claude && text === "/usage") {
      call("/usage", sessionId, { persist: s.persist });
      if (process.env.FAKE_ACP_USAGE_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_USAGE_MS)));
      const gate = process.env.FAKE_ACP_USAGE_GATE;
      await gateOpen(gate);
      if (process.env.FAKE_ACP_USAGE === "fail") return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "the usage endpoint did not answer" } } }, gateTaken(gate));
      const none = process.env.FAKE_ACP_USAGE === "none";
      const limits = process.env.FAKE_ACP_USAGE && !none ? JSON.parse(process.env.FAKE_ACP_USAGE) : null;
      const session = { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 1, total_lines_added: 0, total_lines_removed: 0, model_usage: {} };
      raw({ type: "assistant", parent_tool_use_id: null, message: { model: "<synthetic>", role: "assistant", content: [{ type: "text", text: "## Usage" }] }, ...(none ? {} : { usage_report: { session, rate_limits: limits } }), session_id: sessionId });
      if (process.env.FAKE_ACP_USAGE_TAIL_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_USAGE_TAIL_MS)));
      say(sessionId, "agent_message_chunk", "## Usage", "m_usage");
      return reply({ stopReason: "end_turn" }, gateTaken(gate));
    }
    if (/~limits\b/i.test(text)) {
      planWindow({ status: "allowed", rateLimitType: "five_hour", utilization: 0.42, resetsAt: inSeconds(2 * 3600_000) });
      raw({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", rateLimitType: "seven_day", utilization: 0.81, resetsAt: inSeconds(3 * 86_400_000) }, session_id: sessionId });
      say(sessionId, "agent_message_chunk", "Counted.", "m_lim1");
      return reply({ stopReason: "end_turn" });
    }
    if (/~spent\b/i.test(text) || process.env.FAKE_ACP_SPENT) {
      planWindow({ status: "rejected", rateLimitType: "five_hour", utilization: 1, resetsAt: inSeconds(3600_000), isUsingOverage: false, overageStatus: "rejected", overageDisabledReason: "out_of_credits" });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "rate_limit", details: "You've hit your 5-hour limit" } } });
    }
    // A whole turn as Claude's adapter streams one (HarnessV3-ACP AC1): a plan and a read, an edit that really writes
    // README.md, a command, a sub-agent, the closing words. In Claude's mode the raw SDK messages come first (the
    // adapter forwards one before it reads it), and the sub-agent is its own session (the client declared them).
    // Another agent: the same work, unnamed, no sub-agent.
    // Its own compaction in the middle of a turn's work (HarnessV4_Tasks C28): a read before it, a command after, the
    // closing words.
    if (/~midcompact\b/i.test(text)) {
      const file = `${s.cwd}/README.md`;
      say(sessionId, "agent_message_chunk", "Reading the readme.", "m1");
      asst("m1", [{ type: "text", text: "Reading the readme." }]);
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "mc_r1", title: "Read File", kind: "read", status: "pending", rawInput: {}, ...named("Read") });
      asst("m1", [{ type: "tool_use", id: "mc_r1", name: "Read", input: { file_path: file } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "mc_r1", title: `Read ${file}`, rawInput: { file_path: file }, locations: [{ path: file }], ...named("Read") });
      res("mc_r1", "hello agent");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "mc_r1", status: "completed", content: [{ type: "content", content: { type: "text", text: "hello agent" } }], ...named("Read") });
      const mid = compacting(sessionId, "u_mc", raw, false);
      mid.start();
      mid.end({ pre: 180000, post: 31000, ms: 42000, summary: "Kept: the readme says hello agent." });
      say(sessionId, "agent_message_chunk", "Checking the tree.", "m2");
      asst("m2", [{ type: "text", text: "Checking the tree." }]);
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "mc_b1", title: "Terminal", kind: "execute", status: "pending", rawInput: {}, ...named("Bash") });
      asst("m2", [{ type: "tool_use", id: "mc_b1", name: "Bash", input: { command: "git status --short", description: "See what changed" } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "mc_b1", title: "git status --short", rawInput: { command: "git status --short" }, ...named("Bash") });
      res("mc_b1", "clean");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "mc_b1", status: "completed", content: [{ type: "content", content: { type: "text", text: "clean" } }], ...named("Bash") });
      say(sessionId, "agent_message_chunk", "All clean.", "m3");
      asst("m3", [{ type: "text", text: "All clean." }]);
      return reply({ stopReason: "end_turn" });
    }
    // Claude compacting its own context mid-turn, as its adapter says it (`compacting`); then the turn goes on.
    if (/~compact\b/i.test(text)) {
      say(sessionId, "agent_message_chunk", "Reading.", "m1");
      asst("m1", [{ type: "text", text: "Reading." }]);
      const auto = compacting(sessionId, "u_c1", raw, false);
      auto.start();
      auto.end({ pre: 180000, post: 31000, ms: 42000, summary: "Kept: the reading so far." });
      say(sessionId, "agent_message_chunk", "Going on.", "m2");
      asst("m2", [{ type: "text", text: "Going on." }]);
      return reply({ stopReason: "end_turn" });
    }
    // Two model calls, each counted on its raw message as Claude's SDK counts it — every block of a call repeats its
    // usage — and the turn's usage their sum, as Claude's adapter says it (the Cache follows each call).
    if (/~cachecalls\b/i.test(text)) {
      const used = (input, read, wrote) => ({ input_tokens: input, cache_read_input_tokens: read, cache_creation_input_tokens: wrote, output_tokens: 1 });
      const counted = (msg, content, usage) => raw({ type: "assistant", parent_tool_use_id: null, message: { id: msg, role: "assistant", content, usage } });
      say(sessionId, "agent_message_chunk", "Reading.", "m1");
      counted("m1", [{ type: "thinking", thinking: "Where to look." }], used(3, 0, 20000));
      counted("m1", [{ type: "text", text: "Reading." }], used(3, 0, 20000));
      say(sessionId, "agent_message_chunk", "Done.", "m2");
      counted("m2", [{ type: "text", text: "Done." }], used(8, 20000, 400));
      return reply({ stopReason: "end_turn", usage: { inputTokens: 11, outputTokens: 40, cachedReadTokens: 20000, cachedWriteTokens: 20400, totalTokens: 40451 } });
    }
    // The same compaction failing after its start (HarnessV3-TaskGraph-v2 TG2-D56: nothing was compacted).
    if (/~compactfail\b/i.test(text)) {
      const failing = compacting(sessionId, "u_cf", raw, false);
      failing.start();
      failing.end({ error: "Conversation too long to compact." });
      say(sessionId, "agent_message_chunk", "Going on uncompacted.", "m1");
      return reply({ stopReason: "end_turn" });
    }
    // The same compaction taking its time (TG2-D56): its end waits until the file named after the word exists, a
    // session/cancel meanwhile ending the prompt cancelled.
    const slow = /~slowcompact (\S+)/i.exec(text);
    if (slow) {
      const auto = compacting(sessionId, "u_slow", raw, false);
      auto.start();
      s.hung = m.id;
      while (!existsSync(slow[1]) && s.hung === m.id) await new Promise((r) => setTimeout(r, 20));
      if (s.hung !== m.id) return;
      s.hung = null;
      auto.end({ pre: 180000, post: 31000, ms: 42000, summary: "Kept: the reading so far, again." });
      say(sessionId, "agent_message_chunk", "Going on after a long compaction.", "m1");
      return reply({ stopReason: "end_turn" });
    }
    // A compaction whose end is never said, the prompt ending with it open (`~compacthang`); a prompt that runs until a
    // file exists (`~waitfor <file>`); a compaction that fails, the prompt running on after it until a file exists
    // (`~compactfailwait <file>`) — each a session/cancel meanwhile ends cancelled (TG2-D56).
    if (/~compacthang\b/i.test(text)) {
      compacting(sessionId, "u_hang", raw, false).start();
      say(sessionId, "agent_message_chunk", "Left mid-compaction.", "m1");
      return reply({ stopReason: "end_turn" });
    }
    const waitFor = /~(waitfor|compactfailwait) (\S+)/i.exec(text);
    if (waitFor) {
      if (waitFor[1].toLowerCase() === "compactfailwait") {
        const failing = compacting(sessionId, "u_fw", raw, false);
        failing.start();
        failing.end({ error: "Conversation too long to compact." });
        say(sessionId, "agent_message_chunk", "Going on uncompacted.", "m0");
      }
      s.hung = m.id;
      while (!existsSync(waitFor[2]) && s.hung === m.id) await new Promise((r) => setTimeout(r, 20));
      if (s.hung !== m.id) return;
      s.hung = null;
      say(sessionId, "agent_message_chunk", "Waited.", "m1");
      return reply({ stopReason: "end_turn" });
    }
    // A sub-agent of Claude's own compacting its context mid-turn, on its own session (TG2-D56: the turn's agent
    // compacted nothing); then the turn's closing words.
    if (/~subcompact\b/i.test(text) && claude && clientCaps.subagents) {
      notify(sessionId, { sessionUpdate: "subagent_spawned", subagentSessionId: "task_c", name: "Read it all", task: "Read every file", capabilities: {} });
      const sub = compacting("task_c", "u_sub", () => {}, false);
      sub.start();
      sub.end({ pre: 150000, post: 20000, ms: 30000, summary: "Kept: the sub-agent's reading." });
      notify(sessionId, { sessionUpdate: "subagent_state_update", subagentSessionId: "task_c", state: "completed" });
      say(sessionId, "agent_message_chunk", "Its helper is done.", "m1");
      return reply({ stopReason: "end_turn" });
    }
    // An image read, and an MCP server's screenshots, as claude-agent-acp reports them (HarnessV4_Tasks U9): each file's
    // bytes an image block, wrapped as the call's content. `~picture a.png` reads one; `~pictures a.png b.png …` is one
    // screenshot call handing them all, after its words.
    const pictured = /~(pictures?) ((?:\S+\.\w+ ?)+)/i.exec(text);
    if (pictured) {
      const many = pictured[1].toLowerCase() === "pictures";
      const names = pictured[2].trim().split(/\s+/);
      const blocks = names.map((n) => ({ type: "content", content: { type: "image", data: readFileSync(`${s.cwd}/${n}`).toString("base64"), mimeType: "image/png" } }));
      const tool = many ? "mcp__browser__take_screenshot" : "Read";
      const file = `${s.cwd}/${names[0]}`;
      say(sessionId, "agent_message_chunk", many ? "Taking screenshots." : "Looking at the picture.", "m1");
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "p_1", title: many ? "take_screenshot" : "Read File", kind: many ? "other" : "read", status: "pending", rawInput: {}, ...named(tool) });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "p_1", title: many ? "take_screenshot (MCP)" : `Read ${file}`, rawInput: many ? {} : { file_path: file }, ...(many ? {} : { locations: [{ path: file }] }), ...named(tool) });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "p_1", status: "completed", content: many ? [{ type: "content", content: { type: "text", text: `Took ${names.length} screenshots.` } }, ...blocks] : blocks, ...named(tool) });
      say(sessionId, "agent_message_chunk", "Seen.", "m2");
      return reply({ stopReason: "end_turn" });
    }
    // A command that runs a while, its model call's words before it (HarnessV4_Tasks U4): what the page shows while it
    // runs. `~slowtool think`: a thought before it in place of the words.
    if (/~slowtool\b/i.test(text)) {
      const words = "Running the tests now — this takes a while.";
      if (/~slowtool think\b/i.test(text)) say(sessionId, "agent_thought_chunk", "The tests take a while; run them once.", "m1");
      else {
        say(sessionId, "agent_message_chunk", words, "m1");
        asst("m1", [{ type: "text", text: words }]);
      }
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "st_b1", title: "Terminal", kind: "execute", status: "pending", rawInput: {}, ...named("Bash") });
      asst("m1", [{ type: "tool_use", id: "st_b1", name: "Bash", input: { command: "npm test", description: "Run the tests" } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "st_b1", title: "npm test", rawInput: { command: "npm test" }, ...named("Bash") });
      const gate = process.env.FAKE_ACP_TOOL_GATE;
      if (gate) while (!existsSync(gate)) await new Promise((r) => setTimeout(r, 20));
      else await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_TOOL_MS) || 12000));
      res("st_b1", "all 42 tests passed");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "st_b1", status: "completed", content: [{ type: "content", content: { type: "text", text: "all 42 tests passed" } }], ...named("Bash") });
      say(sessionId, "agent_message_chunk", "All 42 tests passed.", "m2");
      asst("m2", [{ type: "text", text: "All 42 tests passed." }]);
      return reply({ stopReason: "end_turn" });
    }
    if (/~work\b/i.test(text)) {
      const file = `${s.cwd}/README.md`;
      // The SDK's own start, which Filament's list leaves out: the adapter sends it to a client that asks for all.
      raw({ type: "system", subtype: "init", model: "haiku" });
      say(sessionId, "agent_thought_chunk", "Plan first.", "m1");
      say(sessionId, "agent_message_chunk", "Reading the readme.", "m1");
      asst("m1", [{ type: "text", text: "Reading the readme." }]);
      notify(sessionId, { sessionUpdate: "plan", entries: [{ content: "Read the readme", priority: "high", status: "in_progress" }, { content: "Edit it", priority: "medium", status: "pending" }] });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "w_r1", title: "Read File", kind: "read", status: "pending", rawInput: {}, ...named("Read") });
      asst("m1", [{ type: "tool_use", id: "w_r1", name: "Read", input: { file_path: file } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_r1", title: `Read ${file}`, rawInput: { file_path: file }, locations: [{ path: file }], ...named("Read") });
      const before = readFileSync(file, "utf8");
      res("w_r1", before);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_r1", status: "completed", content: [{ type: "content", content: { type: "text", text: "```\n" + before + "```" } }], ...named("Read") });
      say(sessionId, "agent_message_chunk", "Editing it.", "m2");
      asst("m2", [{ type: "text", text: "Editing it." }]);
      notify(sessionId, { sessionUpdate: "plan", entries: [{ content: "Read the readme", priority: "high", status: "completed" }, { content: "Edit it", priority: "medium", status: "in_progress" }] });
      const after = before + "edited by the agent\n";
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "w_e1", title: "Edit", kind: "edit", status: "pending", rawInput: {}, ...named("Edit") });
      asst("m2", [{ type: "tool_use", id: "w_e1", name: "Edit", input: { file_path: file, old_string: before, new_string: after } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_e1", title: `Edit ${file}`, rawInput: { file_path: file, old_string: before, new_string: after }, locations: [{ path: file }], ...named("Edit") });
      writeFileSync(file, after);
      res("w_e1", `The file ${file} has been updated.`);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_e1", status: "completed", content: [{ type: "diff", path: file, oldText: before, newText: after }], ...named("Edit") });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "w_b1", title: "Terminal", kind: "execute", status: "pending", rawInput: {}, content: [{ type: "terminal", terminalId: "term1" }], ...named("Bash", { terminal_info: { terminal_id: "term1" } }) });
      asst("m3", [{ type: "tool_use", id: "w_b1", name: "Bash", input: { command: "git status --short", description: "See what changed" } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_b1", title: "git status --short", rawInput: { command: "git status --short" }, ...named("Bash") });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_b1", _meta: { terminal_output: { terminal_id: "term1", data: " M README.md\n" } } });
      res("w_b1", " M README.md");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "w_b1", status: "completed", ...named("Bash", { terminal_exit: { terminal_id: "term1", exit_code: 0, signal: null } }) });
      if (claude && clientCaps.subagents) {
        asst("m4", [{ type: "tool_use", id: "w_task", name: "Task", input: { description: "Look for TODOs", prompt: "Find the TODOs in src", subagent_type: "Explore" } }]);
        notify(sessionId, { sessionUpdate: "subagent_spawned", subagentSessionId: "task_1", name: "Look for TODOs", task: "Find the TODOs in src", capabilities: {} });
        const child = { claudeCode: { toolName: "Grep", parentToolUseId: "w_task" } };
        notify("task_1", { sessionUpdate: "tool_call", toolCallId: "w_g1", title: "grep", kind: "search", status: "pending", rawInput: {}, _meta: child });
        asst("c1", [{ type: "tool_use", id: "w_g1", name: "Grep", input: { pattern: "TODO", path: "src" } }], "w_task");
        notify("task_1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Searching." }, messageId: "c1" });
        res("w_g1", "src/a.js:1: // TODO one", "w_task");
        notify("task_1", { sessionUpdate: "tool_call_update", toolCallId: "w_g1", status: "completed", content: [{ type: "content", content: { type: "text", text: "src/a.js:1: // TODO one" } }], _meta: child });
        notify("task_1", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Found one TODO in src/a.js." }, messageId: "c2" });
        notify("task_1", { sessionUpdate: "plan", entries: [{ content: "Search src", priority: "high", status: "completed" }] });
        notify(sessionId, { sessionUpdate: "subagent_state_update", subagentSessionId: "task_1", state: "completed" });
        res("w_task", "Found one TODO in src/a.js.");
      }
      say(sessionId, "agent_message_chunk", "Done: README.md edited.", "m5");
      asst("m5", [{ type: "text", text: "Done: README.md edited." }]);
      raw({ type: "result", subtype: "success", num_turns: 5 });
      // `~refuse` beside it: the work done, then the provider's filter refuses the turn, as Claude's adapter ends one.
      return reply({ stopReason: /~refuse\b/i.test(text) ? "refusal" : "end_turn" });
    }
    // A sub-agent's own sub-agent, as Claude's adapter announces one: on the session of the sub-agent that launched it,
    // its calls on its own session.
    if (/~nested\b/i.test(text) && claude && clientCaps.subagents) {
      const readme = `${s.cwd}/README.md`;
      say(sessionId, "agent_message_chunk", "Delegating.", "n1");
      asst("n1", [{ type: "tool_use", id: "n_task", name: "Task", input: { description: "Outer", prompt: "Look around", subagent_type: "general-purpose" } }]);
      notify(sessionId, { sessionUpdate: "subagent_spawned", subagentSessionId: "task_o", name: "Outer", task: "Look around", capabilities: {} });
      asst("o1", [{ type: "tool_use", id: "n_task2", name: "Task", input: { description: "Inner", prompt: "Read the readme", subagent_type: "Explore" } }], "n_task");
      notify("task_o", { sessionUpdate: "subagent_spawned", subagentSessionId: "task_i", name: "Inner", task: "Read the readme", capabilities: {} });
      const inner = { claudeCode: { toolName: "Read", parentToolUseId: "n_task2" } };
      notify("task_i", { sessionUpdate: "tool_call", toolCallId: "n_r1", title: "Read File", kind: "read", status: "pending", rawInput: {}, _meta: inner });
      asst("i1", [{ type: "tool_use", id: "n_r1", name: "Read", input: { file_path: readme } }], "n_task2");
      notify("task_i", { sessionUpdate: "tool_call_update", toolCallId: "n_r1", title: `Read ${readme}`, rawInput: { file_path: readme }, _meta: inner });
      res("n_r1", "hello agent", "n_task2");
      notify("task_i", { sessionUpdate: "tool_call_update", toolCallId: "n_r1", status: "completed", content: [{ type: "content", content: { type: "text", text: "hello agent" } }], _meta: inner });
      notify("task_o", { sessionUpdate: "subagent_state_update", subagentSessionId: "task_i", state: "completed" });
      res("n_task2", "It says hello.", "n_task");
      notify(sessionId, { sessionUpdate: "subagent_state_update", subagentSessionId: "task_o", state: "completed" });
      res("n_task", "The readme says hello.");
      say(sessionId, "agent_message_chunk", "Nested done.", "n2");
      asst("n2", [{ type: "text", text: "Nested done." }]);
      raw({ type: "result", subtype: "success", num_turns: 2 });
      return reply({ stopReason: "end_turn" });
    }
    // A sub-agent as claude-agent-acp 0.93 says one to a client that declares `subagents` (ACP's sub-agents RFD, seen
    // live 10-17): announced on its parent with `subagent_update` — its `sessionId` the child's, its task's id; its
    // title the agent's type; `cancel` granted — the prompt as the child's first `session_message`, its work on its own
    // session, and its end on the parent: idle, with why. `~rfdsub-bg`: launched in the background, the turn ends
    // while it works on, until a session/cancel of its own session stops it (HarnessV4_Tasks E6).
    if (/~rfdsub(-bg)?\b/i.test(text) && claude && clientCaps.subagents) {
      const bg = /~rfdsub-bg\b/i.test(text);
      const sys = (subtype, more = {}) => raw({ type: "system", subtype, ...more });
      const kid = "a7f00d";
      const launch = { description: "Look for TODOs", prompt: "Find the TODOs in src", subagent_type: "Explore", ...(bg ? { run_in_background: true } : {}) };
      sys("status", { status: "requesting" });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "r_task", title: "Task", kind: "think", status: "pending", rawInput: {}, ...named("Agent") });
      asst("r1", [{ type: "tool_use", id: "r_task", name: "Agent", input: launch }]);
      sys("task_started", { task_id: kid, task_type: "local_agent", is_backgrounded: bg, tool_use_id: "r_task", description: launch.description, subagent_type: "Explore" });
      notify(sessionId, { sessionUpdate: "subagent_update", sessionId: kid, title: "Explore", description: launch.description, capabilities: { cancel: {} }, state: { state: "running" } });
      notify(kid, { sessionUpdate: "session_message", messageId: "r_task", senderSessionId: sessionId, recipientSessionId: kid, content: [{ type: "text", text: launch.prompt }] });
      const child = { claudeCode: { toolName: "Grep", parentToolUseId: "r_task" } };
      notify(kid, { sessionUpdate: "tool_call", toolCallId: "r_g1", title: "grep", kind: "search", status: "pending", rawInput: {}, _meta: child });
      asst("rc1", [{ type: "text", text: "Searching." }, { type: "tool_use", id: "r_g1", name: "Grep", input: { pattern: "TODO", path: "src" } }], "r_task");
      notify(kid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Searching." }, messageId: "rc1" });
      res("r_g1", "src/a.js:1: // TODO one", "r_task");
      notify(kid, { sessionUpdate: "tool_call_update", toolCallId: "r_g1", status: "completed", content: [{ type: "content", content: { type: "text", text: "src/a.js:1: // TODO one" } }], _meta: child });
      if (bg) {
        const launched = "Async agent launched successfully. (This tool result is internal metadata; never quote it.)";
        raw({ type: "user", parent_tool_use_id: null, tool_use_result: { isAsync: true, status: "async_launched", agentId: kid, description: launch.description, prompt: launch.prompt }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "r_task", content: [{ type: "text", text: launched }] }] } });
        notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "r_task", status: "completed", content: [{ type: "content", content: { type: "text", text: launched } }], ...named("Agent") });
        say(sessionId, "agent_message_chunk", "It works in the background.", "r2");
        asst("r2", [{ type: "text", text: "It works in the background." }]);
        raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "human" } });
        s.bgChild = {
          kid,
          // As the adapter stops one (seen live 10-17): its task killed, the sub-agent idle and cancelled, its end.
          stop: () => {
            sys("task_updated", { task_id: kid, patch: { status: "killed" } });
            notify(sessionId, { sessionUpdate: "subagent_update", sessionId: kid, state: { state: "idle", stopReason: "cancelled" } });
            sys("task_notification", { task_id: kid, tool_use_id: "r_task", status: "stopped", output_file: "", summary: "" });
          },
        };
        return reply({ stopReason: "end_turn" });
      }
      notify(kid, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Found one TODO in src/a.js." }, messageId: "rc2" });
      asst("rc2", [{ type: "text", text: "Found one TODO in src/a.js." }], "r_task");
      sys("task_updated", { task_id: kid, patch: { status: "completed" } });
      notify(sessionId, { sessionUpdate: "subagent_update", sessionId: kid, state: { state: "idle", stopReason: "end_turn" } });
      res("r_task", "Found one TODO in src/a.js.");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "r_task", status: "completed", content: [{ type: "content", content: { type: "text", text: "Found one TODO in src/a.js." } }], ...named("Agent") });
      say(sessionId, "agent_message_chunk", "Done: one TODO.", "r3");
      asst("r3", [{ type: "text", text: "Done: one TODO." }]);
      raw({ type: "result", subtype: "success", num_turns: 2 });
      return reply({ stopReason: "end_turn" });
    }
    // A call Claude's adapter surfaces before its own message comes, as it does when a permission request comes first
    // (its `ensureToolCallEmitted`): whole, and pending.
    if (/~early\b/i.test(text) && claude) {
      say(sessionId, "agent_message_chunk", "Looking.", "e1");
      asst("e1", [{ type: "text", text: "Looking." }]);
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "e_b1", title: "`git log -1`", kind: "execute", status: "pending", rawInput: { command: "git log -1" }, ...named("Bash") });
      asst("e2", [{ type: "tool_use", id: "e_b1", name: "Bash", input: { command: "git log -1" } }]);
      res("e_b1", "commit abc");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "e_b1", status: "completed", ...named("Bash") });
      say(sessionId, "agent_message_chunk", "One commit.", "e3");
      asst("e3", [{ type: "text", text: "One commit." }]);
      raw({ type: "result", subtype: "success", num_turns: 3 });
      return reply({ stopReason: "end_turn" });
    }
    // `~readcompact`: Claude reads the readme, compacts its own context, and answers — the turn's work up to the
    // compaction is in its summary, and Filament's copy keeps the rest.
    if (/~readcompact\b/i.test(text) && claude) {
      say(sessionId, "agent_message_chunk", "Reading.", "rc1");
      asst("rc1", [{ type: "text", text: "Reading." }]);
      const file = join(s.cwd, "README.md");
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "rc_r1", title: "Read README.md", kind: "read", status: "pending", rawInput: { file_path: file }, ...named("Read") });
      asst("rc2", [{ type: "tool_use", id: "rc_r1", name: "Read", input: { file_path: file } }]);
      res("rc_r1", "hello agent");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "rc_r1", status: "completed", ...named("Read") });
      const auto = compacting(sessionId, "u_rc", raw, false);
      auto.start();
      auto.end({ pre: 180000, post: 31000, ms: 42000, summary: "Kept: the readme, read." });
      say(sessionId, "agent_message_chunk", "Going on.", "rc3");
      asst("rc3", [{ type: "text", text: "Going on." }]);
      raw({ type: "result", subtype: "success", num_turns: 2 });
      return reply({ stopReason: "end_turn" });
    }
    // A sub-agent launched in the background, as Claude Code 2.x runs one through claude-agent-acp 0.76.0: its Agent
    // call comes back at once, the sub-agent works on, and its task ends during Claude's last model call; the prompt
    // settles at Claude's own answer, and its answer to the task comes in a cycle of its own after that.
    if (/~thinking\b/i.test(text) && claude) {
      const sys = (subtype, more = {}) => raw({ type: "system", subtype, ...more });
      sys("session_state_changed", { state: "running" });
      sys("status", { status: "requesting" });
      for (const n of [40, 90, 150, 260, 400, 520, 640, 900, 2000, 30]) sys("thinking_tokens", { estimated_tokens: n, estimated_tokens_delta: 1 });
      sys("task_started", { task_id: "hk", description: "housekeeping", task_type: "local_bash", ambient: true, skip_transcript: true });
      sys("task_started", { task_id: "sh1", tool_use_id: "t_bash", description: "npm test", task_type: "local_bash", is_backgrounded: true });
      sys("task_started", { task_id: "ag1", tool_use_id: "t_agent", description: "Find hello", task_type: "local_agent", subagent_type: "Explore", is_backgrounded: false });
      sys("task_progress", { task_id: "ag1", tool_use_id: "t_agent", description: "Find hello", usage: { total_tokens: 1200, tool_uses: 3, duration_ms: 4000 }, last_tool_name: "Grep", summary: "Searching for hello" });
      sys("task_updated", { task_id: "ag1", patch: { status: "completed", end_time: 1 } });
      const readme = join(s.cwd, "README.md");
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "th_r1", title: "Read File", kind: "read", status: "pending", rawInput: {}, ...named("Read") });
      asst("th0", [{ type: "tool_use", id: "th_r1", name: "Read", input: { file_path: readme } }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "th_r1", title: `Read ${readme}`, rawInput: { file_path: readme }, locations: [{ path: readme }], ...named("Read") });
      sys("thinking_tokens", { estimated_tokens: 777, estimated_tokens_delta: 1 });
      res("th_r1", "hello agent\n");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "th_r1", status: "completed", content: [], ...named("Read") });
      say(sessionId, "agent_message_chunk", "Thought it through.", "th1");
      asst("th1", [{ type: "text", text: "Thought it through." }]);
      raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "human" } });
      sys("session_state_changed", { state: "idle" });
      reply({ stopReason: "end_turn" });
      const gate = process.env.FAKE_ACP_WAKE_GATE;
      void (async () => {
        if (gate) while (!existsSync(join(gate, "sh1"))) await new Promise((r) => setTimeout(r, 20));
        sys("thinking_tokens", { estimated_tokens: 4321, estimated_tokens_delta: 1 });
        sys("task_notification", { task_id: "sh1", tool_use_id: "t_bash", status: "completed", output_file: "", summary: "npm test passed" });
      })();
      return;
    }
    if (/~background\b/i.test(text) && claude) {
      const sys = (subtype, more = {}) => raw({ type: "system", subtype, ...more });
      const launch = { description: "Find hello", prompt: "Find the files that say hello", subagent_type: "Explore" };
      const launched = "Async agent launched successfully. (This tool result is internal metadata; never quote it.)";
      const child = { claudeCode: { toolName: "Grep", parentToolUseId: "b_task" } };
      sys("session_state_changed", { state: "running" });
      sys("status", { status: "requesting" });
      say(sessionId, "agent_message_chunk", "Launching a sub-agent.", "b1");
      asst("b1", [{ type: "text", text: "Launching a sub-agent." }]);
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "b_task", title: "Task", kind: "think", status: "pending", rawInput: {}, ...named("Agent") });
      // FAKE_ACP_BG_PAUSE_MS: the launch takes that long, as a real one takes a moment: words handed over as the call
      // begins reach Claude while its prompt runs.
      if (Number(process.env.FAKE_ACP_BG_PAUSE_MS) > 0) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_ACP_BG_PAUSE_MS)));
      asst("b1", [{ type: "tool_use", id: "b_task", name: "Agent", input: launch }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "b_task", title: launch.description, rawInput: launch, ...named("Agent") });
      raw({ type: "user", parent_tool_use_id: null, tool_use_result: { isAsync: true, status: "async_launched", agentId: "a1", description: launch.description, prompt: launch.prompt }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "b_task", content: [{ type: "text", text: launched }] }] } });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "b_task", status: "completed", content: [{ type: "content", content: { type: "text", text: launched } }], ...named("Agent") });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "b_g1", title: "grep", kind: "search", status: "pending", rawInput: {}, _meta: child });
      asst("c1", [{ type: "tool_use", id: "b_g1", name: "Grep", input: { pattern: "hello" } }], "b_task");
      res("b_g1", "README.md", "b_task");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "b_g1", status: "completed", content: [{ type: "content", content: { type: "text", text: "README.md" } }], _meta: child });
      sys("status", { status: "requesting" });
      asst("c2", [{ type: "text", text: "README.md says hello." }], "b_task");
      sys("task_notification", { task_id: "a1", tool_use_id: "b_task", status: "completed", output_file: "", summary: "README.md says hello." });
      say(sessionId, "agent_message_chunk", "It runs in the background; I will answer when it reports.", "b2");
      asst("b2", [{ type: "text", text: "It runs in the background; I will answer when it reports." }]);
      // `~background-spent`: the turn's cycle and Claude's answer to the task each say what they spent, in their results,
      // the prompt's answer the turn's cycle's alone, as Claude's adapter answers it; `-spentfail`: so, the turn's cycle
      // ending in an error and its prompt held, as Claude's adapter holds a turn whose sub-agent runs, until Claude's
      // answer has ended — then the prompt fails; `-fold`: Claude's answer reads a file until a prompt is sent to the
      // session, which Claude Code adds to the running cycle — the prompt's echo, `heard:<words>`, and the cycle's result
      // naming the prompt, whose answer says what the cycle spent, as Claude's adapter counts a cycle that answered one;
      // `-foldfail`: so, the cycle ending in an error, which fails the prompt.
      const spent = /~background-(spent|spentfail|fold|foldfail)\b/i.exec(text)?.[1].toLowerCase();
      const cycleSpent = { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
      const answerSpent = { input_tokens: 300, output_tokens: 30, cache_read_input_tokens: 2000, cache_creation_input_tokens: 50 };
      const asAcp = (u) => ({ inputTokens: u.input_tokens, outputTokens: u.output_tokens, cachedReadTokens: u.cache_read_input_tokens, cachedWriteTokens: u.cache_creation_input_tokens, totalTokens: u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens });
      const failed = spent === "spentfail" ? { subtype: "error_during_execution", is_error: true, errors: ["the model's server failed mid-turn"] } : {};
      raw({ type: "result", subtype: "success", num_turns: 2, origin: { kind: "human" }, ...failed, ...(spent ? { usage: cycleSpent } : {}) });
      sys("session_state_changed", { state: "idle" });
      if (spent !== "spentfail") reply({ stopReason: "end_turn", ...(spent ? { usage: asAcp(cycleSpent) } : {}) });
      // Claude's answer to the task, in a cycle of its own. `~background-idle`: Claude never begins one; `-slow`: its
      // model call takes 4 s to say a word; `-stuck`: it reads a file and is heard from no more.
      const late = /~background-(idle|slow|stuck)\b/i.exec(text)?.[1].toLowerCase();
      if (late === "idle") return;
      setTimeout(() => {
        sys("session_state_changed", { state: "running" });
        sys("status", { status: "requesting" });
        if (late === "stuck" || spent?.startsWith("fold")) {
          notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "b_r1", title: "Read README.md", kind: "read", status: "pending", rawInput: { file_path: "README.md" }, ...named("Read") });
          asst("b3", [{ type: "tool_use", id: "b_r1", name: "Read", input: { file_path: "README.md" } }]);
          if (spent?.startsWith("fold")) {
            s.queueing = [];
            s.onQueued = () => {
              const [p] = s.queueing?.splice(0) || [];
              if (!p) return;
              s.queueing = null;
              s.onQueued = null;
              res("b_r1", "hello agent");
              notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "b_r1", status: "completed", ...named("Read") });
              raw({ type: "user", parent_tool_use_id: null, isReplay: true, uuid: "u_fold", message: { role: "user", content: [{ type: "text", text: p.words }] } });
              sys("status", { status: "requesting" });
              say(sessionId, "agent_message_chunk", `heard:${p.words}`, "b4");
              asst("b4", [{ type: "text", text: `heard:${p.words}` }]);
              const broke = spent === "foldfail" ? { subtype: "error_during_execution", is_error: true, errors: ["the model's server failed mid-turn"] } : {};
              raw({ type: "result", subtype: "success", num_turns: 2, origin: { kind: "task-notification" }, user_message_uuids: ["u_fold"], usage: answerSpent, ...broke });
              if (spent === "foldfail") write({ jsonrpc: "2.0", id: p.id, error: { code: -32603, message: "Internal error: the model's server failed mid-turn", data: { errorKind: "server_error" } } });
              else write({ jsonrpc: "2.0", id: p.id, result: { stopReason: "end_turn", usage: asAcp(answerSpent) } });
              sys("session_state_changed", { state: "idle" });
            };
            return;
          }
          res("b_r1", "hello agent");
          notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "b_r1", status: "completed", ...named("Read") });
          return;
        }
        const answer = () => {
          say(sessionId, "agent_message_chunk", "The sub-agent found it: README.md says hello.", "b3");
          asst("b3", [{ type: "text", text: "The sub-agent found it: README.md says hello." }]);
          raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "task-notification" }, ...(spent ? { usage: answerSpent } : {}) });
          sys("session_state_changed", { state: "idle" });
          if (spent === "spentfail") write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error: the model's server failed mid-turn", data: { errorKind: "server_error" } } });
        };
        if (late === "slow") setTimeout(answer, 4000);
        else answer();
      }, 300);
      return;
    }
    // Words the agent says once its turn has settled, in no cycle (AC3-9): a chunk after the turn's result, then a
    // title, once `opened` lets them come.
    if (/~trail\b/i.test(text)) {
      raw({ type: "system", subtype: "status", status: "requesting" });
      say(sessionId, "agent_message_chunk", "Done.", "tr1");
      asst("tr1", [{ type: "text", text: "Done." }]);
      raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "human" } });
      reply({ stopReason: "end_turn" });
      opened(sessionId, () => {
        say(sessionId, "agent_message_chunk", "One more thing.", "tr2");
        notify(sessionId, { sessionUpdate: "session_info_update", title: "Trail said" });
      });
      return;
    }
    // A cycle Claude ends idle with no result (claude-agent-acp's issue #825: a model stream dropped mid-turn): its
    // model call, a word, the session gone idle — idle is the adapter's "authoritative turn-over signal".
    if (/~noresult\b/i.test(text)) {
      raw({ type: "system", subtype: "session_state_changed", state: "running" });
      raw({ type: "system", subtype: "status", status: "requesting" });
      say(sessionId, "agent_message_chunk", "Cut off", "nr1");
      raw({ type: "system", subtype: "session_state_changed", state: "idle" });
      reply({ stopReason: "end_turn" });
      return;
    }
    // A task launched in the background that ends after the turn (AC3-9), as Claude Code 2.x runs one through
    // claude-agent-acp 0.76.0: the turn settles at once; the task's end comes between turns, and Claude goes on by
    // itself in a cycle no prompt began — its model call, a thought, its words, its result (`origin:
    // task-notification`), the context's size, idle — FAKE_ACP_WAKE_MS after the turn (300 by default).
    // `~wake-two`: two tasks end before it; `~wake-perm`: the cycle asks to run `npm test` first (a title says it
    // asked) and says what it was told; `~wake-stuck`: it reads a file and is heard from no more; `~wake-twice`: a
    // second task ends right after the first cycle, and a second cycle answers it; `~wake-heels`: so, the first
    // cycle's thought first, and once `opened` lets them come, the rest of it, the second task's end and the whole
    // second cycle in one write, which Filament reads in one go; `~wake-heelsperm`: so, the second cycle asking to run
    // `npm test` as `~wake-perm`'s does, going on once answered; `~wake-quiet`: so, the first cycle saying nothing
    // after its result, and a title once both are said; `~wake-sub`: what goes on after the turn is the
    // background sub-agent's alone; `~wake-child`: the cycle's one piece of work is its sub-agent's, on the sub-agent's
    // own session, and a title once the cycle's result came; `~wake-mix`: a housekeeping task ends first, and a second
    // task while the cycle's first model call fails and is tried again; `~wake-late`: a title after the cycle, once
    // `opened` lets it come; `~wake-write`: the turn launches a sub-agent on a session of its own, and the cycle first
    // has its client write a file for its session and one for the sub-agent's, and run `echo between`, saying how
    // each went in its words and its title; `~wake-fold`: the cycle reads a file until a prompt is sent to its session,
    // which Claude Code adds to the running cycle (HarnessV3-FailurePoints §7.2) — the prompt's echo, `heard:<words>`,
    // the cycle's result naming it, and the prompt's answer, in one write; `~wake-foldtwice`: so, the second task's
    // end and a second cycle answering it in the same write; `~wake-foldlate`: so, the prompt's answer held back, and of
    // the second cycle only its start in that write — its rest and the answer once `opened` lets them come, then each
    // prompt queued meanwhile run next, as `~wake-next`'s; `~wake-next`: the cycle ends first (`read it`, its result),
    // and the prompt runs next, a cycle of its own — its echo, `next:<words>`, its result, and its answer, which ends
    // at the output limit (`max_tokens`); `~wake-nextfail`: so, that cycle ending in an error, which fails the prompt;
    // `~wake-peer`: no task ends — a message from another session begins the cycle, its result's origin a peer's.
    // `~wake-task`: as `~wake`, its task said started in the background as the turn launches it (`task_started`).
    // `~wake-monitor`: so, the task Claude's Monitor, a shell it watches in the background (`local_bash`).
    // `~wake-monitorlate`: so, its end said first as its status (`task_updated`, completed) and its notification 50 ms
    // after, in another write; where FAKE_ACP_WAKE_GATE names a folder, once a file `t1` is in it.
    // `~wake-monitornoend`: so, its end said as its status alone — no notification, no cycle of Claude's.
    // `~wake-subperm`: no task ends — the background sub-agent asks to run `npm test` on its parent's session, with no
    // cycle of Claude's running, and the session's title says what it was told.
    const wake = /~wake(?:-(two|perm|stuck|twice|heelsperm|heels|quiet|subperm|sub|child|mix|late|write|foldtwice|foldlate|fold|next|nextfail|peer|task|monitorlate|monitornoend|monitor))?\b/i.exec(text);
    if (wake && claude) {
      const how = (wake[1] || "").toLowerCase();
      const sys = (subtype, more = {}) => raw({ type: "system", subtype, ...more });
      const launch = { description: "Run the tests", prompt: "Run the test suite", subagent_type: "general-purpose" };
      const launched = "Async agent launched successfully. (This tool result is internal metadata; never quote it.)";
      sys("session_state_changed", { state: "running" });
      sys("status", { status: "requesting" });
      say(sessionId, "agent_message_chunk", "Started the tests in the background.", "k1");
      asst("k1", [{ type: "text", text: "Started the tests in the background." }]);
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "k_task", title: launch.description, kind: "think", status: "pending", rawInput: launch, ...named("Agent") });
      asst("k1", [{ type: "tool_use", id: "k_task", name: "Agent", input: launch }]);
      if (how === "task") sys("task_started", { task_id: "t1", task_type: "local_agent", is_backgrounded: true, tool_use_id: "k_task", description: launch.description, subagent_type: launch.subagent_type });
      if (how === "monitor" || how === "monitorlate" || how === "monitornoend") sys("task_started", { task_id: "t1", task_type: "local_bash", is_backgrounded: true, tool_use_id: "k_task", description: "npm test" });
      raw({ type: "user", parent_tool_use_id: null, tool_use_result: { isAsync: true, status: "async_launched", agentId: "t1", description: launch.description, prompt: launch.prompt }, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "k_task", content: [{ type: "text", text: launched }] }] } });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "k_task", status: "completed", content: [{ type: "content", content: { type: "text", text: launched } }], ...named("Agent") });
      if ((how === "child" || how === "write") && clientCaps.subagents) notify(sessionId, { sessionUpdate: "subagent_spawned", subagentSessionId: "k_child", name: launch.description, task: launch.prompt, capabilities: {} });
      say(sessionId, "agent_message_chunk", "I will say when they end.", "k2");
      asst("k2", [{ type: "text", text: "I will say when they end." }]);
      raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "human" } });
      sys("session_state_changed", { state: "idle" });
      reply({ stopReason: "end_turn" });
      const ended = (id, summary, more = {}) => sys("task_notification", { task_id: id, tool_use_id: "k_task", status: "completed", output_file: "", summary, ...more });
      /** One cycle of Claude's own. @param {number} n @param {string} words */
      const cycle = async (n, words) => {
        // The words come in the model call's message, or in the next call's after a command ran.
        let msg = `kw${n}`;
        sys("session_state_changed", { state: "running" });
        sys("status", { status: "requesting" });
        if (how === "mix" && n === 1) {
          sys("api_retry", { attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: 529, error: "overloaded" });
          ended("t2", "The linter is clean.");
          sys("status", { status: "requesting" });
        }
        if (how === "child") {
          notify("k_child", { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Running the tests again." }, messageId: "kc1" });
          notify("k_child", { sessionUpdate: "tool_call", toolCallId: "k_c1", title: "npm test", kind: "execute", status: "pending", rawInput: { command: "npm test" }, _meta: { claudeCode: { toolName: "Bash", parentToolUseId: "k_task" } } });
          raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "task-notification" } });
          sys("session_state_changed", { state: "idle" });
          return notify(sessionId, { sessionUpdate: "session_info_update", title: "Child done" });
        }
        say(sessionId, "agent_thought_chunk", `Reading report ${n}.`, `kw${n}`);
        if (how === "next" || how === "nextfail") {
          notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "k_r1", title: "Read README.md", kind: "read", status: "pending", rawInput: { file_path: "README.md" }, ...named("Read") });
          asst(`kw${n}`, [{ type: "tool_use", id: "k_r1", name: "Read", input: { file_path: "README.md" } }]);
          s.queueing = [];
          s.onQueued = () => {
            const [p] = s.queueing?.splice(0) || [];
            if (!p) return;
            s.queueing = null;
            s.onQueued = null;
            notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "k_r1", status: "completed", ...named("Read") });
            res("k_r1", "hello agent\n");
            say(sessionId, "agent_message_chunk", "read it ", "kwn1");
            asst("kwn1", [{ type: "text", text: "read it " }]);
            raw({ type: "result", subtype: "success", num_turns: 2, origin: { kind: "task-notification" }, usage: { input_tokens: 700, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
            sys("session_state_changed", { state: "idle" });
            sys("session_state_changed", { state: "running" });
            raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text: p.words }] } });
            sys("status", { status: "requesting" });
            say(sessionId, "agent_message_chunk", `next:${p.words}`, "kwn2");
            asst("kwn2", [{ type: "text", text: `next:${p.words}` }]);
            const broke = how === "nextfail" ? { subtype: "error_during_execution", is_error: true, errors: ["the model's server failed mid-turn"] } : {};
            raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "human" }, usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...broke });
            if (how === "nextfail") write({ jsonrpc: "2.0", id: p.id, error: { code: -32603, message: "Internal error: the model's server failed mid-turn", data: { errorKind: "server_error" } } });
            else write({ jsonrpc: "2.0", id: p.id, result: { stopReason: "max_tokens", usage: { inputTokens: 50, outputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 55 } } });
            sys("session_state_changed", { state: "idle" });
          };
          tickWhile(sessionId, () => !!s.onQueued);
          return;
        }
        if ((how === "fold" || how === "foldtwice" || how === "foldlate") && n === 1) {
          notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "k_r1", title: "Read README.md", kind: "read", status: "pending", rawInput: { file_path: "README.md" }, ...named("Read") });
          asst(`kw${n}`, [{ type: "tool_use", id: "k_r1", name: "Read", input: { file_path: "README.md" } }]);
          s.queueing = [];
          s.onQueued = () => {
            const [p] = s.queueing?.splice(0) || [];
            if (!p) return;
            s.queueing = null;
            s.onQueued = null;
            const folded = () => write({ jsonrpc: "2.0", id: p.id, result: { stopReason: "end_turn", usage: { inputTokens: 700, outputTokens: 30, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 730 } } });
            together(() => {
              notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "k_r1", status: "completed", ...named("Read") });
              res("k_r1", "hello agent\n");
              raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text: p.words }] } });
              sys("status", { status: "requesting" });
              say(sessionId, "agent_message_chunk", `heard:${p.words}`, "kwf");
              asst("kwf", [{ type: "text", text: `heard:${p.words}` }]);
              raw({ type: "result", subtype: "success", num_turns: 2, origin: { kind: "task-notification" }, usage: { input_tokens: 700, output_tokens: 30, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
              if (how !== "foldlate") folded();
              sys("session_state_changed", { state: "idle" });
              if (how === "fold") return;
              ended("t2", "The build is done.");
              if (how === "foldtwice") return void cycle(2, "The build is done too.");
              sys("session_state_changed", { state: "running" });
              sys("status", { status: "requesting" });
              say(sessionId, "agent_thought_chunk", "Reading report 2.", "kw2");
            });
            if (how !== "foldlate") return;
            // What is queued meanwhile waits for the second cycle, whose rest comes once `opened` lets it, with the
            // folded words' answer; then each queued prompt runs, a cycle of its own.
            s.queueing = [];
            let rest = false;
            tickWhile(sessionId, () => !rest);
            opened(sessionId, () => {
              rest = true;
              const next = s.queueing?.splice(0) || [];
              s.queueing = null;
              together(() => {
                say(sessionId, "agent_message_chunk", "The build is done too.", "kw2");
                asst("kw2", [{ type: "text", text: "The build is done too." }]);
                raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "task-notification" }, total_cost_usd: 0.012, usage: { input_tokens: 902, output_tokens: 42, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } });
                notify(sessionId, { sessionUpdate: "usage_update", used: 4002, size: 200000, cost: costSoFar(s, 0.012) });
                sys("session_state_changed", { state: "idle" });
                folded();
                for (const q of next) {
                  sys("session_state_changed", { state: "running" });
                  raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text: q.words }] } });
                  sys("status", { status: "requesting" });
                  say(sessionId, "agent_message_chunk", `next:${q.words}`, `kwq${q.id}`);
                  asst(`kwq${q.id}`, [{ type: "text", text: `next:${q.words}` }]);
                  raw({ type: "result", subtype: "success", num_turns: 1, origin: { kind: "human" }, usage: { input_tokens: 50, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
                  write({ jsonrpc: "2.0", id: q.id, result: { stopReason: "end_turn", usage: { inputTokens: 50, outputTokens: 5, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: 55 } } });
                  sys("session_state_changed", { state: "idle" });
                }
              });
            });
          };
          tickWhile(sessionId, () => !!s.onQueued);
          return;
        }
        if (how === "stuck") {
          notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "k_r1", title: "Read README.md", kind: "read", status: "pending", rawInput: { file_path: "README.md" }, ...named("Read") });
          asst(`kw${n}`, [{ type: "tool_use", id: "k_r1", name: "Read", input: { file_path: "README.md" } }]);
          return;
        }
        if ((how === "perm" && n === 1) || (how === "heelsperm" && n === 2)) {
          const tc = { toolCallId: "k_b1", kind: "execute", title: "npm test", rawInput: { command: "npm test", description: "Run the tests again" } };
          notify(sessionId, { sessionUpdate: "tool_call", ...tc, status: "pending", ...named("Bash") });
          asst(`kw${n}`, [{ type: "tool_use", id: "k_b1", name: "Bash", input: tc.rawInput }]);
          const asked = askClient("session/request_permission", { sessionId, options: [{ optionId: "allow-once", name: "Yes", kind: "allow_once" }, { optionId: "reject", name: "No", kind: "reject_once" }], toolCall: { ...tc, status: "pending" }, _meta: { permission: { version: 1, title: tc.title } } });
          notify(sessionId, { sessionUpdate: "session_info_update", title: "Asked to run npm test" });
          const r = await asked;
          const chosen = r?.outcome?.optionId || r?.outcome?.outcome;
          if (chosen === "allow-once") notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "k_b1", status: "completed", content: [{ type: "content", content: { type: "text", text: "12 passing" } }] });
          words = `${words} Told: ${chosen}.`;
          msg = `kw${n}b`;
        }
        if (how === "write" && n === 1) {
          const write = (/** @type {string} */ sid, /** @type {string} */ name) => askClient("fs/write_text_file", { sessionId: sid, path: join(s.cwd, name), content: "written between turns\n" });
          const went = (/** @type {any} */ r) => (r?.__error ? "refused" : "done");
          const mine = went(await write(sessionId, `between-${sessionId}.txt`));
          const subs = went(await write("k_child", `between-${sessionId}-sub.txt`));
          const t = await askClient("terminal/create", { sessionId, command: "echo", args: ["between"] });
          let ran = "refused";
          if (!t?.__error) {
            await askClient("terminal/wait_for_exit", { sessionId, terminalId: t.terminalId });
            ran = String((await askClient("terminal/output", { sessionId, terminalId: t.terminalId }))?.output || "").trim();
            await askClient("terminal/release", { sessionId, terminalId: t.terminalId });
          }
          words = `${words} Writes: ${mine}, the sub-agent's ${subs}; the command: ${ran}.`;
          notify(sessionId, { sessionUpdate: "session_info_update", title: `Between: ${mine}, ${subs}, ${ran}` });
        }
        /** The cycle's words, its result, and what the adapter says after it. */
        const finish = () => {
          say(sessionId, "agent_message_chunk", words, msg);
          raw({ type: "assistant", parent_tool_use_id: null, message: { id: msg, model: answersOn(s), role: "assistant", content: [{ type: "text", text: words }] } });
          raw({ type: "result", subtype: "success", num_turns: 1, origin: how === "peer" ? { kind: "peer", from: "sess_other" } : { kind: "task-notification" }, total_cost_usd: 0.012, usage: { input_tokens: 900 + n, output_tokens: 40 + n, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 } });
          if (how === "quiet" && n === 1) return;
          notify(sessionId, { sessionUpdate: "usage_update", used: 4000 + n, size: 200000, cost: costSoFar(s, 0.012) });
          sys("session_state_changed", { state: "idle" });
        };
        if ((how === "heels" || how === "heelsperm") && n === 1)
          return opened(sessionId, () =>
            together(() => {
              finish();
              ended("t2", "The build is done.");
              void cycle(2, "The build is done too.");
            }),
          );
        finish();
      };
      setTimeout(async () => {
        if (how === "sub") {
          // The background sub-agent's call, on its parent's session as the adapter reports one: no cycle of Claude's.
          notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "k_g1", title: "grep", kind: "search", status: "pending", rawInput: {}, _meta: { claudeCode: { toolName: "Grep", parentToolUseId: "k_task" } } });
          asst("ks1", [{ type: "tool_use", id: "k_g1", name: "Grep", input: { pattern: "test" } }], "k_task");
          return;
        }
        if (how === "subperm") {
          const sub = { claudeCode: { toolName: "Bash", parentToolUseId: "k_task" } };
          const tc = { toolCallId: "k_sb1", kind: "execute", title: "npm test", rawInput: { command: "npm test", description: "Run the tests" } };
          notify(sessionId, { sessionUpdate: "tool_call", ...tc, status: "pending", _meta: sub });
          asst("ks1", [{ type: "tool_use", id: "k_sb1", name: "Bash", input: tc.rawInput }], "k_task");
          const r = await askClient("session/request_permission", { sessionId, options: [{ optionId: "allow-once", name: "Yes", kind: "allow_once" }, { optionId: "reject", name: "No", kind: "reject_once" }], toolCall: { ...tc, status: "pending", _meta: sub }, _meta: { permission: { version: 1, title: tc.title } } });
          const chosen = r?.outcome?.optionId || r?.outcome?.outcome;
          if (chosen === "allow-once") notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "k_sb1", status: "completed", content: [{ type: "content", content: { type: "text", text: "12 passing" } }], _meta: sub });
          notify(sessionId, { sessionUpdate: "session_info_update", title: `The sub-agent was told: ${chosen}` });
          return;
        }
        if (how === "mix") ended("t0", "Watching the files.", { ambient: true });
        if (how === "monitornoend") return sys("task_updated", { task_id: "t1", patch: { status: "completed", end_time: Date.now() } });
        if (how === "monitorlate") {
          const gate = process.env.FAKE_ACP_WAKE_GATE;
          if (gate) while (!existsSync(join(gate, "t1"))) await new Promise((r) => setTimeout(r, 20));
          sys("task_updated", { task_id: "t1", patch: { status: "completed", end_time: Date.now() } });
          await new Promise((r) => setTimeout(r, 50));
        }
        if (how !== "peer") ended("t1", "The tests pass.");
        if (how === "two") ended("t2", "The linter is clean.");
        await cycle(1, how === "two" || how === "mix" ? "Both came back: the tests pass and the linter is clean." : how === "peer" ? "Another session said the tests pass." : "The tests pass.");
        if (how === "late") return opened(sessionId, () => notify(sessionId, { sessionUpdate: "session_info_update", title: "Late word" }));
        if (how !== "twice" && how !== "quiet") return;
        ended("t2", "The build is done.");
        await cycle(2, "The build is done too.");
        if (how === "quiet") notify(sessionId, { sessionUpdate: "session_info_update", title: "Two cycles" });
      }, Number(process.env.FAKE_ACP_WAKE_MS) || 300);
      return;
    }
    // Gemini CLI's turn, as 0.44.1's ACP agent streams one (AC2-3): no tool names, no input, no `_meta` on a call; a
    // title naming the target (a read's path as the project knows it, a search's "'pattern' within ./", a command
    // itself), absolute locations, and what it showed of the result (nothing, for a read). A call it asks about first
    // it announces only in the question, with its diff or its explanation, and one refused it never mentions again; a
    // failure has no title. A call to an MCP server's tool it titles "<tool> (<server> MCP Server)", the tool's
    // parameters (JSON) its words. Its thought leads with a bold subject; its usage rides on the answer's
    // `_meta.quota`, in snake_case.
    if (/~gemini\b/i.test(text)) {
      const file = `${s.cwd}/README.md`;
      const before = readFileSync(file, "utf8");
      const after = `${before}edited by gemini\n`;
      const words = (t) => [{ type: "content", content: { type: "text", text: t } }];
      const begin = (id, title, kind, locations = []) => notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, status: "in_progress", title, content: [], locations, kind });
      const done = (id, title, kind, content, locations = []) => notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", title, content, locations, kind });
      const options = [{ optionId: "proceed_always", name: "Allow for this session", kind: "allow_always" }, { optionId: "proceed_once", name: "Allow", kind: "allow_once" }, { optionId: "cancel", name: "Reject", kind: "reject_once" }];
      const ask = (toolCall) => askClient("session/request_permission", { sessionId, options, toolCall: { status: "pending", ...toolCall } });
      const ran = (r) => r?.outcome?.outcome === "selected" && r.outcome.optionId !== "cancel";
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "**Reading the project**\n\nThe readme first, then the open TODOs." } });
      begin("read_file-1", "README.md", "read", [{ path: file }]);
      done("read_file-1", "README.md", "read", [], [{ path: file }]);
      begin("grep_search-2", "'TODO' within ./", "search");
      done("grep_search-2", "'TODO' within ./", "search", words("Found 1 match"));
      const snip = (t) => t.split("\n")[0].substring(0, 30) + (t.length > 30 ? "..." : "");
      const editTitle = `README.md: ${snip(before)} => ${snip(after)}`;
      const diff = [{ type: "diff", path: file, oldText: before, newText: after, _meta: { kind: "modify" } }];
      const edit = await ask({ toolCallId: "replace-3", title: editTitle, content: diff, locations: [{ path: file }], kind: "edit" });
      if (ran(edit)) {
        writeFileSync(file, after);
        done("replace-3", editTitle, "edit", diff, [{ path: file }]);
      }
      const cmd = await ask({ toolCallId: "run_shell_command-4", title: "npm test", content: words(`[current working directory ${s.cwd}] (Run the tests)`), locations: [], kind: "execute" });
      if (ran(cmd)) done("run_shell_command-4", "npm test", "execute", words("> fake@1.0.0 test\n> node --test\n\n# pass 3\n# fail 0"));
      begin("web_fetch-5", "Fetching content from: https://example.com/docs", "fetch");
      done("web_fetch-5", "Fetching content from: https://example.com/docs", "fetch", words("Content processed from prompt."));
      const mcpTitle = "list_issues (github MCP Server)";
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "list_issues-6", status: "in_progress", title: mcpTitle, content: words('{"state":"open"}'), locations: [], kind: "other" });
      done("list_issues-6", mcpTitle, "other", words("3 open issues: #12, #14, #15"));
      const investigate = "Running subagent 'codebase_investigator' with inputs: { objective: Map the auth module }";
      begin("codebase_investigator-7", investigate, "think");
      done("codebase_investigator-7", investigate, "think", words("The auth module lives in src/auth: a session store and a login route."));
      begin("read_file-8", "missing.md", "read", [{ path: `${s.cwd}/missing.md` }]);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "read_file-8", status: "failed", content: words(`File not found: ${s.cwd}/missing.md`), kind: "read" });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Done: the edit ${ran(edit) ? "made" : "not made"}, the tests ${ran(cmd) ? "run" : "not run"}.` } });
      const count = (i, o) => ({ input_tokens: i, output_tokens: o });
      return reply({ stopReason: "end_turn", _meta: { quota: { token_count: count(1840, 96), model_usage: [{ model: "gemini-3-pro-preview", token_count: count(1840, 96) }] } } });
    }
    // Qoder CLI's turn, as 1.1.50's ACP agent streams one (AC2-3): Claude Code's tools, named in `_meta.qoder` where it
    // announces a call, with the input whole and a copy of it as the call's content; a result fenced as code where it
    // is a file's or a command's, the tool's own beside it (`rawOutput`). A call it asks about first (an edit, a
    // command) it announces only in the question; a refused one ends failed. Its to-dos come as a plan too; its usage
    // in ACP's own field and in `_meta.quota`, in snake_case.
    if (/~qoder\b/i.test(text)) {
      const file = `${s.cwd}/README.md`;
      const before = readFileSync(file, "utf8");
      const after = `${before}edited by qoder\n`;
      const q = (name) => ({ _meta: { qoder: { toolName: name } } });
      const words = (t) => [{ type: "content", content: { type: "text", text: t } }];
      const asJson = (input) => words(JSON.stringify(input, null, 2));
      const fenced = (t, lang = "") => words("```" + lang + "\n" + t + (t.endsWith("\n") ? "" : "\n") + "```");
      const announce = (id, name, title, input, kind, locations) => notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, status: "pending", title, content: asJson(input), kind, rawInput: input, locations, ...q(name) });
      const result = (id, content, rawOutput, failed = false) => notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: failed ? "failed" : "completed", content, rawOutput });
      const options = [{ optionId: "proceed_always", name: "Allow for this session", kind: "allow_always" }, { optionId: "proceed_once", name: "Allow", kind: "allow_once" }, { optionId: "cancel", name: "Reject", kind: "reject_once" }];
      const ask = (id, name, title, input, kind, content) => askClient("session/request_permission", { sessionId, options, toolCall: { toolCallId: id, status: "pending", title, content, kind, rawInput: input, ...q(name) } });
      const ran = (r) => r?.outcome?.outcome === "selected" && r.outcome.optionId !== "cancel";
      const refused = "The user doesn't want to proceed with this tool use.";
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "The readme first." } });
      const todos = [{ description: "Read the readme", status: "in_progress" }, { description: "Edit it", status: "pending" }, { description: "Run the tests", status: "pending" }];
      announce("q_todo", "TodoWrite", "TodoWrite", { todos }, "other");
      notify(sessionId, { sessionUpdate: "plan", entries: todos.map((t) => ({ content: t.description, priority: "medium", status: t.status })) });
      result("q_todo", words("Todos have been modified successfully."), "Todos have been modified successfully.");
      announce("q_read", "Read", `Read ${file}`, { file_path: file }, "read", [{ path: file }]);
      result("q_read", fenced(before), before);
      const edit = await ask("q_edit", "Edit", `Edit ${file}`, { file_path: file, old_string: before, new_string: after }, "edit", [{ type: "diff", path: file, oldText: before, newText: after }]);
      if (ran(edit)) {
        writeFileSync(file, after);
        result("q_edit", words(`The file ${file} has been updated.`), `The file ${file} has been updated.`);
      } else result("q_edit", fenced(refused), refused, true);
      const cmd = await ask("q_bash", "Bash", "npm test", { command: "npm test", description: "Run the tests" }, "execute", words("npm test"));
      if (ran(cmd)) result("q_bash", fenced("# pass 3\n# fail 0", "console"), "# pass 3\n# fail 0");
      else result("q_bash", fenced(refused), refused, true);
      announce("q_grep", "Grep", "Search TODO", { pattern: "TODO", path: "src" }, "search");
      result("q_grep", words("src/a.js:1: // TODO one"), "src/a.js:1: // TODO one");
      notify(sessionId, { sessionUpdate: "plan", entries: todos.map((t) => ({ content: t.description, priority: "medium", status: "completed" })) });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `Done: the edit ${ran(edit) ? "made" : "not made"}, the tests ${ran(cmd) ? "run" : "not run"}.` } });
      const count = (i, o) => ({ input_tokens: i, output_tokens: o });
      return reply({ stopReason: "end_turn", usage: { inputTokens: 2310, outputTokens: 142, totalTokens: 2452 }, _meta: { quota: { token_count: count(2310, 142), model_usage: [{ model: "qoder-auto", token_count: count(2310, 142) }] } } });
    }
    // Cursor's own tools, as cursor-agent 2026.09.10 streams them: each call names its tool in `rawInput._toolName`,
    // its input grows as its model writes it, and right after its end comes its extension, a request whose answer
    // Cursor does not wait for. A sub-agent; its to-do list, whole, then an update naming only what changed; an image
    // it saves in the working folder. Then the answers it got.
    if (/~cursor\b/i.test(text)) {
      const answers = [];
      const ext = (method, params) => answers.push(askClient(method, params).then((r) => `${method.slice(7)}=${r?.__error ? `error ${r.__error.code}` : r?.outcome?.outcome}`));
      const upd = (id, more) => notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, ...more });
      const task = { _toolName: "task", description: "Look for TODOs", prompt: "Find the TODOs in src", subagentType: "explore" };
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "c_task", title: "Task", kind: "other", status: "pending", rawInput: { _toolName: "task", description: "Look" } });
      upd("c_task", { rawInput: { _toolName: "task", description: "Look for TODOs", prompt: "Find the TO" } });
      upd("c_task", { status: "in_progress", title: "Task: Look for TODOs", rawInput: task });
      upd("c_task", { status: "completed", content: [{ type: "content", content: { type: "text", text: "Found one TODO in src/a.js." } }], rawOutput: { durationMs: 1200, isBackground: false } });
      ext("cursor/task", { toolCallId: "c_task", description: task.description, prompt: task.prompt, subagentType: "explore", model: "composer-2.5", agentId: "ag_1", durationMs: 1200 });
      const todos = (id, list, merge) => {
        notify(sessionId, { sessionUpdate: "tool_call", toolCallId: id, title: `Update TODOs: ${list.map((t) => t.content).join(", ")}`, kind: "other", status: "pending", rawInput: { _toolName: "updateTodos", todos: list, merge } });
        upd(id, { status: "completed" });
        ext("cursor/update_todos", { toolCallId: id, todos: list, merge });
      };
      todos("c_todo1", [{ id: "1", content: "Read the code", status: "completed" }, { id: "2", content: "Fix the bug", status: "in_progress" }, { id: "3", content: "Rewrite it all", status: "cancelled" }], false);
      todos("c_todo2", [{ id: "2", content: "Fix the bug", status: "completed" }, { id: "4", content: "Run the tests", status: "pending" }], true);
      const png = `${s.cwd}/red.png`;
      writeFileSync(png, picture());
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "c_img", title: "Generate Image: a red square", kind: "other", status: "pending", rawInput: { _toolName: "generateImage", description: "a red square", filename: "red.png" } });
      upd("c_img", { status: "in_progress" });
      upd("c_img", { status: "completed", content: [{ type: "content", content: { type: "text", text: `Image saved to ${png}` } }] });
      ext("cursor/generate_image", { toolCallId: "c_img", description: "a red square", filePath: png, referenceImagePaths: [] });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `answers: ${(await Promise.all(answers)).join(" ")}` } });
      return reply({ stopReason: "end_turn" });
    }
    // An agent's questions to the person (AC2-4), then what it heard. `~elicit`: Claude's AskUserQuestion, a form its
    // adapter asks only of a client that declares forms, on the call it belongs to. `~link`: a link to open
    // (`~link-done`: the agent then sees it completed). `~withdraw`: a question the agent withdraws. `~cursorask`:
    // Cursor's questions, each asked as a permission (Skip its refusal) when its client refuses them, as cursor-agent
    // does. `~cursorplan`: the plan Cursor proposes.
    const heard = (what) => { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: what } }); return reply({ stopReason: "end_turn" }); };
    if (/~elicit\b/i.test(text)) {
      if (!clientCaps.elicitation?.form) return heard("elicit: no forms");
      const options = [{ label: "Postgres", description: "relational" }, { label: "SQLite", description: "a file" }];
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "q_ask", title: "Which database?", kind: "other", status: "pending", rawInput: { questions: [{ question: "Which database?", header: "Database", options, multiSelect: false }] }, _meta: { claudeCode: { toolName: "AskUserQuestion" } } });
      // As the adapter builds it (0.93.0): one question's words ride `message`, and its Other field carries the marker
      // for a JetBrains AIR client alone — Filament's form has none (the owner's of 10-30).
      const air = !!clientCaps._meta?.jetbrains?.air;
      const r = await askClient("elicitation/create", {
        sessionId, toolCallId: "q_ask", mode: "form", message: "Which database?",
        requestedSchema: { type: "object", properties: {
          question_0: { type: "string", title: "Database", oneOf: options.map((o) => ({ const: o.label, title: o.label, description: o.description })) },
          question_0_custom: { type: "string", title: "Other", description: "Type your own answer, or add a note to the option you chose above (optional).", ...(air ? { _meta: { _askUserQuestionCustomAnswer: { isCustomAnswer: true, questionId: "question_0" } } } : {}) },
        } },
      });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "q_ask", status: "completed" });
      return heard(`elicit: ${JSON.stringify(r?.__error ? { error: r.__error.code } : r)}`);
    }
    if (/~link\b/i.test(text)) {
      const answer = askClient("elicitation/create", { sessionId, mode: "url", elicitationId: "el_1", url: "https://example.com/login", message: "Sign in to the docs server" });
      if (/~link-done\b/i.test(text)) { await new Promise((r) => setTimeout(r, 150)); write({ jsonrpc: "2.0", method: "elicitation/complete", params: { elicitationId: "el_1" } }); }
      const r = await answer;
      return heard(`link: ${r?.__error ? `error ${r.__error.code}` : r?.action}`);
    }
    if (/~withdraw\b/i.test(text)) {
      const id = reqId + 1;
      const answer = askClient("elicitation/create", { sessionId, mode: "form", message: "Pick one", requestedSchema: { type: "object", properties: { pick: { type: "string", enum: ["a", "b"] } } } });
      const gate = process.env.FAKE_ACP_WITHDRAW_GATE || "";
      await new Promise((r) => { const go = () => (existsSync(gate) ? (rmSync(gate), r(null)) : setTimeout(go, 20)); go(); });
      write({ jsonrpc: "2.0", method: "$/cancel_request", params: { requestId: id } });
      const r = await answer;
      return heard(`withdrawn: ${r?.__error ? `error ${r.__error.code}` : r?.action}`);
    }
    if (/~cursorask\b/i.test(text)) {
      const questions = [
        { id: "db", prompt: "Which database?", options: [{ id: "pg", label: "Postgres" }, { id: "lite", label: "SQLite" }], allowMultiple: false },
        { id: "extras", prompt: "Which extras?", options: [{ id: "auth", label: "Auth" }, { id: "jobs", label: "Jobs" }], allowMultiple: true },
      ];
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "c_ask", title: "Ask Question", kind: "other", status: "pending", rawInput: { _toolName: "askQuestion", title: "Setup", questions } });
      const r = await askClient("cursor/ask_question", { toolCallId: "c_ask", title: "Setup", questions });
      if (r?.__error?.code !== -32601) return heard(`cursor-ask: ${r?.__error ? `error ${r.__error.code}` : JSON.stringify(r?.outcome)}`);
      const chosen = [];
      for (const q of questions.filter((x) => !x.allowMultiple)) {
        const p = await askClient("session/request_permission", { sessionId, toolCall: { toolCallId: "c_ask", title: q.prompt, kind: "other", status: "pending" }, options: [...q.options.map((o) => ({ optionId: o.id, name: o.label, kind: "allow_once" })), { optionId: "__ask_question_skip__", name: "Skip", kind: "reject_once" }] });
        if (p?.outcome?.outcome !== "selected") return heard("cursor-ask: fallback cancelled");
        if (p.outcome.optionId !== "__ask_question_skip__") chosen.push(`${q.id}=${p.outcome.optionId}`);
      }
      return heard(`cursor-ask: fallback ${chosen.join(",") || "skipped"}`);
    }
    if (/~cursorplan\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "c_plan", title: "Create Plan: Add auth", kind: "other", status: "pending", rawInput: { _toolName: "createPlan", name: "Add auth" } });
      const r = await askClient("cursor/create_plan", { toolCallId: "c_plan", name: "Add auth", overview: "Sessions and a login page", plan: "# Add auth\n\n1. Sessions\n2. A login page", todos: [{ id: "t1", content: "Sessions", status: "pending" }, { id: "t2", content: "A login page", status: "pending" }], isProject: false, phases: [] });
      return heard(`plan: ${r?.__error ? `error ${r.__error.code}` : JSON.stringify(r?.outcome)}`);
    }
    if (/~permwords\b/i.test(text)) {
      const options = [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }];
      const a = await askClient("session/request_permission", { sessionId, options, toolCall: { toolCallId: "pw1", status: "pending", title: "`npm test &&\nnpm run lint`", kind: "execute" } });
      const words = [{ type: "content", content: { type: "text", text: "Fetch https://example.com for the docs" } }];
      const b = await askClient("session/request_permission", { sessionId, options, toolCall: { toolCallId: "pw2", status: "pending", title: "Fetch", kind: "fetch", content: words } });
      return heard(`permwords: ${a?.outcome?.optionId} ${b?.outcome?.optionId}`);
    }
    if (/~permnoreject\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "pn1", title: "Edit README.md", kind: "edit", status: "pending" });
      const r = await askClient("session/request_permission", { sessionId, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }], toolCall: { toolCallId: "pn1", status: "pending", title: "Edit README.md", kind: "edit" } });
      return heard(`permnoreject: ${r?.outcome?.outcome}`);
    }
    if (/~oddask\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "c_odd", title: "Ask Question", kind: "other", status: "pending", rawInput: { _toolName: "askQuestion", title: "Odd" } });
      const r = await askClient("cursor/ask_question", { toolCallId: "c_odd", title: "Odd", questions: [{ id: "q", prompt: "Which?", options: [], allowMultiple: false }] });
      const f = await askClient("elicitation/create", { sessionId, mode: "form", message: "Odd form", requestedSchema: { type: "object", properties: { x: { type: "object" } } } });
      return heard(`oddask: ${JSON.stringify(r?.outcome)} ${f?.action}`);
    }
    if (/~permknown\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "pk1", title: "Tool call", kind: "read", status: "in_progress" });
      const r = await askClient("session/request_permission", { sessionId, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }], toolCall: { toolCallId: "pk1", title: "Read", kind: "read", status: "pending" } });
      return heard(`permknown: ${r?.outcome?.optionId}`);
    }
    if (/~permended\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "pe1", title: "Edit README.md", kind: "edit", status: "completed" });
      const options = [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }];
      const r = await askClient("session/request_permission", { sessionId, options, toolCall: { toolCallId: "pe1", title: "Edit README.md", kind: "edit" } });
      return heard(`permended: ${r?.outcome?.optionId}`);
    }
    // Cursor's call to an MCP server's tool, as Cursor's CLI 2026.09.10 sends one (AC4's drive D2): titled
    // "<server>: <tool>", its input `{ providerIdentifier, toolName, args }`; then its question before the tool runs,
    // titled "<server>-<tool>: <tool>", the arguments fenced as JSON, with Cursor's options. Allowed once, it runs.
    const cursorMcp = /~cursormcp (\S+) (\S+)/i.exec(text);
    if (cursorMcp) {
      const [, server, tool] = cursorMcp;
      const args = { query: "tabs" };
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "cm1", title: `${server}: ${tool}`, kind: "other", status: "pending", rawInput: { providerIdentifier: server, toolName: tool, args } });
      const options = [{ optionId: "allow-once", name: "Allow once", kind: "allow_once" }, { optionId: "allow-always", name: "Allow always", kind: "allow_always" }, { optionId: "reject-once", name: "Reject", kind: "reject_once" }];
      const content = [{ type: "content", content: { type: "text", text: `\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\`` } }];
      const r = await askClient("session/request_permission", { sessionId, options, toolCall: { toolCallId: "cm1", title: `${server}-${tool}: ${tool}`, kind: "other", status: "pending", content } });
      const chosen = r?.outcome?.optionId || r?.outcome?.outcome;
      if (chosen === "allow-once") notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "cm1", status: "completed", rawOutput: { success: true }, content: [{ type: "content", content: { type: "text", text: "found" } }] });
      return heard(`cursormcp: ${chosen}`);
    }
    // Claude's own requests, as claude-agent-acp 0.76 sends them (AC3-2): its tool's name and its input, a command's
    // title its description, and its options sorted as it sorts them — allow-once, then its "always", then reject. A
    // call allowed runs and ends; one refused or cancelled, the agent says nothing more of. `~permbash` runs
    // `rm -rf build` unless the prompt names another command after it; `~then <command>` after that one: answered, it
    // asks to run the next in the same turn (`cb2`, `cb3`…), and its closing words say each answer.
    const claudeAsk = /~perm(bash|write|read|edit|exit|enter|hand|always)\b(.*)$/im.exec(text);
    if (claudeAsk) {
      const which = claudeAsk[1].toLowerCase();
      // `~hears` after it: refused, its turn goes on as Claude's does after a call it was not allowed — what the host
      // queued while it asked is taken at its next step, and its closing words say what it heard.
      // `~again` too: refused, it asks the same once more before that step, as an agent that tries a call twice.
      const hears = /~hears\b/i.test(claudeAsk[2]);
      const again = /~again\b/i.test(claudeAsk[2]);
      const [rest, ...then] = claudeAsk[2].replace(/~(hears|again)\b/gi, "").split(/~then\b/i);
      const command = rest.trim() || "rm -rf build";
      // `~permwrite <path>`: the file it asks to write, where the prompt names one (a worker's, outside its worktree);
      // `~permread <path>` the file it asks to read, as Claude asks for one outside its folder.
      const file = (which === "write" || which === "read") && rest.trim() ? rest.trim() : `${s.cwd}/notes.md`;
      /** @type {{ id: any, words: string }[] | null} */
      const taking = hears ? [] : null;
      if (taking) s.queueing = taking;
      const readme = `${s.cwd}/README.md`;
      const plan = "# Plan\n1. Clean the build";
      const other = which === "exit" && /\bother\b/.test(rest);
      // `~permhand <tool>`: a tool of a server named filament, which Filament's own may never list; else its memory search.
      const handTool = rest.replace(/\balways\b/, "").trim() || "filament_memory_search";
      const tc = {
        bash: { toolCallId: "cb1", name: "Bash", kind: "execute", title: "Run it", rawInput: { command, description: "Run it" } },
        write: { toolCallId: "cw1", name: "Write", kind: "edit", title: "Write notes.md", rawInput: { file_path: file, content: "notes\n" }, locations: [{ path: file }], content: [{ type: "diff", path: file, oldText: null, newText: "notes\n" }] },
        read: { toolCallId: "cr1", name: "Read", kind: "read", title: `Read ${file.split(/[\\/]/).pop()}`, rawInput: { file_path: file }, locations: [{ path: file }] },
        edit: { toolCallId: "cd1", name: "Edit", kind: "edit", title: "Edit README.md", rawInput: { file_path: readme, old_string: "hello agent", new_string: "hello, agent of change" }, locations: [{ path: readme }], content: [{ type: "diff", path: readme, oldText: "hello agent", newText: "hello, agent of change" }] },
        exit: { toolCallId: "ce1", name: "ExitPlanMode", kind: "switch_mode", title: "Approve Plan", rawInput: { plan }, content: [{ type: "content", content: { type: "text", text: plan } }] },
        enter: { toolCallId: "cp1", name: "EnterPlanMode", kind: "other", title: "EnterPlanMode", rawInput: {} },
        hand: { toolCallId: "ch1", name: `mcp__filament__${handTool}`, kind: "other", title: `mcp__filament__${handTool}`, rawInput: handTool === "bash" ? { command: "ls" } : { query: "x" } },
        always: { toolCallId: "ca1", name: "Bash", kind: "execute", title: "Build", rawInput: { command: "make", description: "Build" } },
      }[which];
      const yes = { optionId: "allow-once", name: "Yes", kind: "allow_once" };
      const always = { optionId: "allow-with-updates", name: "Yes, and don't ask again for similar commands", kind: "allow_always" };
      const no = { optionId: "reject", name: "No", kind: "reject_once" };
      const options = {
        exit: other
          ? [{ optionId: "proceed", name: "Yes, proceed", kind: "allow_once" }, { optionId: "reject", name: "No, keep planning", kind: "reject_once" }]
          : [{ optionId: "exit-plan-clear-bypass", name: "Yes, clear context (12% used) and bypass permissions", kind: "allow_always" }, { optionId: "exit-plan-bypass", name: "Yes, and bypass permissions", kind: "allow_always" }, { optionId: "exit-plan-default", name: "Yes, manually approve edits", kind: "allow_once" }, { optionId: "reject", name: "No, keep planning", kind: "reject_once" }],
        enter: [{ ...yes, name: "Yes, enter plan mode" }, { ...no, name: "No, start implementing now" }],
        always: [always, no],
        // `~permhand always`: Filament's own hand, offered only to always allow it.
        ...(/\balways\b/.test(rest) ? { hand: [always, no] } : {}),
      }[which] || [yes, always, no];
      // The call as 0.76 announces it: its tool's name in Claude's marks; the permission's call carries it as `name`.
      const { name: toolName, ...call } = tc;
      notify(sessionId, { sessionUpdate: "tool_call", ...call, status: "pending", _meta: { claudeCode: { toolName } } });
      const request = () => askClient("session/request_permission", { sessionId, options, toolCall: { ...tc, status: "pending" }, _meta: { permission: { version: 1, title: which === "exit" ? "Ready to code?" : tc.title } } });
      let r = await request();
      if (again && (r?.outcome?.optionId || r?.outcome?.outcome) === "reject") r = await request();
      const chosen = r?.outcome?.optionId || r?.outcome?.outcome;
      const ran = () => notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: tc.toolCallId, status: "completed", content: [{ type: "content", content: { type: "text", text: "done" } }] });
      if (which === "exit" && chosen === "reject") {
        notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: tc.toolCallId, status: "failed" });
        return reply({ stopReason: "cancelled" });
      }
      if (which === "exit" && chosen === "exit-plan-clear-bypass") {
        s.mode = "bypassPermissions";
        notify(sessionId, { sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" });
        await new Promise((r) => { s.onMode = r; setTimeout(r, 2000); });
        s.onMode = null;
        // `twice`: an agent that won't be turned back says its own mode once more.
        if (/\btwice\b/.test(rest)) notify(sessionId, { sessionUpdate: "current_mode_update", currentModeId: "bypassPermissions" });
        ran();
        return heard(`permexit: ${chosen} (mode ${s.mode})`);
      }
      const says = other && chosen === "proceed" ? /\bsays (\w+)/.exec(rest)?.[1] : null;
      if (says) {
        s.mode = says;
        notify(sessionId, { sessionUpdate: "current_mode_update", currentModeId: says });
      }
      if (other && chosen === "proceed") ran();
      if (chosen === "allow-once" || (which === "exit" && /^exit-plan-/.test(String(chosen)))) ran();
      if (which === "enter" && chosen === "allow-once") notify(sessionId, { sessionUpdate: "current_mode_update", currentModeId: "plan" });
      if (taking) {
        const until = Date.now() + 3000;
        while (chosen === "reject" && !taking.length && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
        s.queueing = null;
        let active = m.id;
        let words = "";
        for (const p of taking.splice(0)) {
          raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text: p.words }] } });
          write({ jsonrpc: "2.0", id: active, result: { stopReason: "end_turn" } });
          active = p.id;
          words += ` heard:${p.words}`;
        }
        notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `perm${which}: ${chosen}${words}` } });
        return write({ jsonrpc: "2.0", id: active, result: { stopReason: "end_turn" } });
      }
      let said = `perm${which}: ${chosen}`;
      for (const [i, next] of then.map((c) => c.trim()).filter(Boolean).entries()) {
        const more = { toolCallId: `cb${i + 2}`, kind: "execute", title: "Run it", rawInput: { command: next, description: "Run it" } };
        notify(sessionId, { sessionUpdate: "tool_call", ...more, status: "pending", _meta: { claudeCode: { toolName: "Bash" } } });
        const answer = await askClient("session/request_permission", { sessionId, options: [yes, always, no], toolCall: { ...more, name: "Bash", status: "pending" }, _meta: { permission: { version: 1, title: more.title } } });
        const took = answer?.outcome?.optionId || answer?.outcome?.outcome;
        if (took === "allow-once") notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: more.toolCallId, status: "completed", content: [{ type: "content", content: { type: "text", text: "done" } }] });
        said += ` then ${took}`;
      }
      return heard(said);
    }
    if (/~steps\b/i.test(text)) {
      s.stepping = m.id; s.done = [];
      const step = (n, then) => {
        notify(sessionId, { sessionUpdate: "tool_call", toolCallId: `c_step${n}`, title: `Step ${n}`, kind: "execute", status: "in_progress", rawInput: { command: `step ${n}` } });
        const gate = n === 1 ? process.env.FAKE_ACP_STEP_GATE : "";
        const finish = () => {
          if (s.stepping !== m.id) return;
          if (gate && !existsSync(gate)) return void setTimeout(finish, 20);
          s.done.push(`step ${n}`);
          notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: `c_step${n}`, status: "completed", rawOutput: { output: `step ${n} done` } });
          setTimeout(() => s.stepping === m.id && then(), 150);
        };
        finish();
      };
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "stepping… " } });
      step(1, () => step(2, () => { s.stepping = null; notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "all steps done" } }); reply({ stopReason: "end_turn", usage: STEP_USAGE }); }));
      return;
    }
    // `~quietspend` (FAKE_ACP_CLAUDE): a model call that says nothing, the cycle's result counting what it spent, then the
    // prompt's failure, as Claude's adapter fails one: the agent fails before any word or call of its own.
    if (claude && /~quietspend\b/i.test(text)) {
      const spentQuietly = { input_tokens: 300, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      raw({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_qs1", model: answersOn(s), role: "assistant", content: [], usage: spentQuietly } });
      raw({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["the model's server failed mid-turn"], origin: { kind: "human" }, usage: spentQuietly });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error: the model's server failed mid-turn", data: { errorKind: "server_error" } } });
    }
    if (/~mute\b/i.test(text)) return reply({ stopReason: "end_turn" }); // a turn that ends without a word
    notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking about it" } });
    notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "t1", title: "Read File", kind: "read", status: "pending" });
    notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "t1", title: `Read ${s.cwd}/README.md`, status: "completed", content: process.env.FAKE_ACP_CONFIG ? [{ type: "diff", path: "a.js", oldText: "one\ntwo\nthree", newText: "one\ntwo changed\nthree\nfour\nfive" }] : [] });
    if (/perm/i.test(text)) {
      const id = ++reqId;
      const decision = await new Promise((r) => { pendingPerm.set(id, r); write({ jsonrpc: "2.0", id, method: "session/request_permission", params: { sessionId, toolCall: { toolCallId: "t2", title: "Run command", kind: "execute" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "always", name: "Always", kind: "allow_always" }, { optionId: "no", name: "Reject", kind: "reject_once" }] } }); });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `permission:${decision?.outcome?.optionId || decision?.outcome?.outcome} ` } });
    }
    // A sub-agent's permission prompt on its own session, as Claude's adapter sends one after announcing the sub-agent.
    if (/~subask\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "subagent_spawned", subagentSessionId: "sub_ask", name: "builder", task: "run the build" });
      const decision = await askClient("session/request_permission", { sessionId: "sub_ask", toolCall: { toolCallId: "t3", title: "npm run build", kind: "execute" }, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }] });
      notify(sessionId, { sessionUpdate: "subagent_state_update", subagentSessionId: "sub_ask", state: "completed" });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `sub-permission:${decision?.outcome?.optionId || decision?.outcome?.outcome} ` } });
    }
    if (/~steerlate\b/i.test(text)) { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done. " } }); setTimeout(() => reply({ stopReason: "end_turn" }), Number(process.env.FAKE_ACP_LATE_MS) || 600); return; }
    if (/~deaf\b/i.test(text) && !(process.env.FAKE_ACP_DEAF_OFF && existsSync(process.env.FAKE_ACP_DEAF_OFF))) {
      // Never answers, a cancel included — until its gate, where it has one.
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working… " } });
      const gate = process.env.FAKE_ACP_DEAF_END;
      const late = () => (existsSync(gate) ? reply({ stopReason: "cancelled" }) : void setTimeout(late, 20));
      if (gate) late();
      return;
    }
    if (/~chatty\b/i.test(text)) { let n = 0; const t = setInterval(() => { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `w${++n} ` } }); if (n >= 300) clearInterval(t); }, 10); return; } // never answers, and talks on through a cancel: a word every 10 ms for 3 s
    // A command its own shell runs and its cancel leaves running, as Cursor's CLI does (HarnessV4_Tasks B13): the call
    // announced, its permission asked — so its client has heard of the call before anything starts — then a shell of
    // its own that starts a real process, which waits a minute, its id written to FAKE_ACP_LEFT_PID, and silence
    // until session/cancel, which ends the turn and the shell, and not the process: nobody's child from then.
    // `~leftbusy`: another call begins while it runs.
    if (/~leftcmd\b/i.test(text)) { notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "left1", title: "node wait.js", kind: "execute", status: "pending" }); await askClient("session/request_permission", { sessionId, options: [{ optionId: "allow", name: "Allow", kind: "allow_once" }, { optionId: "no", name: "Reject", kind: "reject_once" }], toolCall: { toolCallId: "left1", status: "pending", title: "node wait.js", kind: "execute" } }); s.leftShell = spawn(process.execPath, ["-e", LEFT_SHELL], { stdio: "ignore", windowsHide: true, env: { ...process.env } }); notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "left1", status: "in_progress" }); if (/~leftbusy\b/i.test(text)) notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "left2", title: "Read a.txt", kind: "read", status: "completed" }); s.hung = m.id; return; }
    if (/~hangfail\b/i.test(text)) { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working… " } }); s.hung = m.id; s.hungFails = true; return; } // fails when cancelled, as an agent may
    if (/\bhang\b/i.test(text)) { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working… " } }); s.hung = m.id; return; } // silent until session/cancel
    // ---- dials for the rendering and bridge tests (each keyword adds one behaviour) ----
    if (/~diff\b/i.test(text)) { notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "e1", title: "Edit src/app.js", kind: "edit", status: "in_progress" }); notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "e1", status: "completed", content: [{ type: "diff", path: "src/app.js", oldText: "one\ntwo\nthree\nfour", newText: "one\ntwo changed\nthree\nfour\nfive" }] }); }
    if (/~terminal\b/i.test(text)) { notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "x1", title: "npm test", kind: "execute", status: "in_progress" }); notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "x1", status: "completed", content: [{ type: "content", content: { type: "text", text: "> Filament test\n\n  3 passing (0.4s)\n" } }], _meta: { terminal_exit: { exitCode: 0 } } }); }
    if (/~plan\b/i.test(text)) { notify(sessionId, { sessionUpdate: "plan", entries: [{ content: "Read the failing test", priority: "high", status: "pending" }, { content: "Fix the off-by-one", priority: "medium", status: "pending" }] }); await new Promise((r) => setTimeout(r, 30)); notify(sessionId, { sessionUpdate: "plan", entries: [{ content: "Read the failing test", priority: "high", status: "completed" }, { content: "Fix the off-by-one", priority: "medium", status: "in_progress" }] }); }
    // `~planend`: the agent's own todo list ended, one item done and one given up.
    if (/~planend\b/i.test(text)) notify(sessionId, { sessionUpdate: "plan", entries: [{ content: "Read the failing test", priority: "high", status: "completed" }, { content: "Fix the off-by-one", priority: "medium", status: "cancelled" }] });
    if (/~title\b/i.test(text)) notify(sessionId, { sessionUpdate: "session_info_update", title: "Fix the login test" });
    if (/~mode\b/i.test(text)) notify(sessionId, { sessionUpdate: "current_mode_update", currentModeId: "plan" });
    if (/~failtool\b/i.test(text)) { notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "f1", title: "Delete tmp/cache", kind: "delete", status: "in_progress" }); notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "f1", status: "failed" }); }
    if (/~weird\b/i.test(text)) notify(sessionId, { sessionUpdate: "something_new", payload: 1 });
    if (/~subagent\b/i.test(text)) { notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "a1", title: "Agent: explore the repo", kind: "other", status: "in_progress" }); notify(sessionId, { sessionUpdate: "subagent_spawned", subagentSessionId: "sub1", name: "explorer", description: "explore the repo" }); notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "a2", title: "Read src/index.js", kind: "read", status: "completed", _meta: { claudeCode: { parentToolUseId: "a1" } } }); notify(sessionId, { sessionUpdate: "subagent_state_update", subagentSessionId: "sub1", state: "completed" }); }
    if (/~readfile\b/i.test(text)) { if (clientCaps.fs?.readTextFile) { const r = await askClient("fs/read_text_file", { sessionId, path: `${s.cwd}/README.md` }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: r?.__error ? `readerr:${r.__error.message} ` : `read:${String(r?.content || "").trim().slice(0, 40)} ` } }); } else notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "nofs " } }); }
    if (/~readfile2\b/i.test(text)) { if (clientCaps.fs?.readTextFile) { const [a, b] = await Promise.all([askClient("fs/read_text_file", { sessionId, path: `${s.cwd}/a.txt` }), askClient("fs/read_text_file", { sessionId, path: `${s.cwd}/b.txt` })]); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `two:${String(a?.content || "").trim()}+${String(b?.content || "").trim()} ` } }); } else notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "nofs " } }); }
    // `~compactthen`: the agent compacts its own context before what follows — its edits and its call —, as an
    // auto-compact before a model call; `~compactthen2`, twice.
    // `~skillfirst <name>`: a call of Filament's skill tool that loaded the skill completed before what follows, as the
    // agent's own updates say one.
    const skillFirst = /~skillfirst (\S+)/i.exec(text);
    const loadSkill = () => {
      if (!skillFirst) return;
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "sk1", title: "mcp__filament__skill", kind: "other", status: "in_progress", rawInput: { name: skillFirst[1] }, ...named("mcp__filament__skill") });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "sk1", status: "completed" });
    };
    if (!(claude && /~queue3?\b/i.test(text))) loadSkill();
    const compactsThen = /~compactthen(2)?\b/i.exec(text);
    for (const id of compactsThen ? (compactsThen[1] ? ["u_ct", "u_ct2"] : ["u_ct"]) : []) {
      const auto = compacting(sessionId, id, raw, false);
      auto.start();
      auto.end({ pre: 180000, post: 31000, ms: 4000, summary: "Kept: the work so far." });
    }
    // `~twoedits` outside a `~queue` turn: the agent edits two files of its folder, each a call that completed, before
    // what follows — a `~mcpcall`, whose answer carries what Filament says at a step to an agent that takes words only
    // once a step ended (Cursor's CLI).
    if (/~twoedits\b/i.test(text) && !(claude && /~queue3?\b/i.test(text)))
      for (const [id, file] of [["te1", "a.txt"], ["te2", "b.txt"]]) {
        const path = join(s.cwd, file);
        begins(id, "Edit", "edit", "Edit", `Edit ${file}`, { file_path: path, old_string: "a", new_string: "b" }, { path });
        notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", ...named("Edit") });
      }
    // `~threefails` outside a `~queue` turn: the agent runs `npm test` three times, each a call that failed, before what
    // follows; `~onerun`: once, and it passes. Each as an agent that names no tool says a command: its call titled with
    // the command, of kind "execute", its input the command (Claude's as `begins` streams one).
    if (!(claude && /~queue3?\b/i.test(text)))
      for (const [id, ok] of [...(/~threefails\b/i.test(text) ? [["tf1", false], ["tf2", false], ["tf3", false]] : []), ...(/~onerun\b/i.test(text) ? [["or1", true]] : [])]) {
        begins(id, "Bash", "execute", "Terminal", "npm test", { command: "npm test" });
        notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: ok ? "completed" : "failed", content: [{ type: "content", content: { type: "text", text: ok ? "3 passing" : "1 failing" } }], ...named("Bash", ok ? {} : { terminal_exit: { exit_code: 1, signal: null } }) });
      }
    // `~readslashed <file>`: the agent reads a file of its folder, naming it with forward slashes and by way of `./`, as
    // an agent's tool may spell a path its edit spells the folder's own way. `~editnative <file>`: it writes a line at
    // the file's end and its edit completes, the file named as the folder is.
    const slashed = /~readslashed (\S+)/i.exec(text);
    if (slashed) {
      const path = `${s.cwd.replace(/\\/g, "/")}/./${slashed[1]}`;
      begins("rs1", "Read", "read", "Read File", `Read ${slashed[1]}`, { file_path: path }, { path });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "rs1", status: "completed", ...named("Read") });
    }
    const native = /~editnative (\S+)/i.exec(text);
    if (native) {
      const path = join(s.cwd, native[1]);
      begins("en1", "Edit", "edit", "Edit", `Edit ${native[1]}`, { file_path: path, old_string: "a", new_string: "b" }, { path });
      appendFileSync(path, "a line of the agent's own\n");
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "en1", status: "completed", ...named("Edit") });
    }
    // `~mcpcall <tool> <json>`: a call of one of Filament's own tools over the MCP server its session was given
    // (HarnessV3-ACP AC6) — a server given over stdio (Filament's relay) started and asked, never passed by for the
    // address it posts to (`callViaStdio`) — after its own compaction with `~compactthen` —, announced and ended as Claude streams one, its answer said back: `mcp:<text>`,
    // `mcp:error:<text>` for a call it refused, `mcperr:<why>` where none answered. With `~dropcall` in the prompt a
    // session/cancel while the call waits drops the call and ends the turn cancelled, as a real agent does. With
    // `~mcpgate`, the call is announced only once the file FAKE_ACP_MCP_GATE is there: a test moves on meanwhile.
    const mcpCall = /~mcpcall (\S+) (\{.*\})/.exec(text);
    if (mcpCall && /~mcpgate\b/.test(text)) while (!existsSync(process.env.FAKE_ACP_MCP_GATE || "")) await new Promise((r) => setTimeout(r, 10));
    if (mcpCall) {
      const callId = `mcp_${s.prompts.length}`;
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: callId, title: `mcp__filament__${mcpCall[1]}`, kind: "other", status: "pending", rawInput: JSON.parse(mcpCall[2]), ...named(`mcp__filament__${mcpCall[1]}`) });
      // With `~rawmcp`, Claude's own messages of the call and its answer, by the tool's MCP name, as its raw messages carry
      // them (the owner's of 11-08); the rest of this fake's turn says no raw message, so it is asked for.
      const rawCall = /~rawmcp\b/.test(text);
      if (rawCall) asst(`m_${callId}`, [{ type: "tool_use", id: callId, name: `mcp__filament__${mcpCall[1]}`, input: JSON.parse(mcpCall[2]) }]);
      const drop = /~dropcall\b/.test(text) ? new AbortController() : null;
      s.dropCall = drop;
      // `~mcplate`: the call goes out a moment after it was announced, as an agent's does — its announcement and the
      // call reach Filament by two ways, and a test of what rides its answer needs the first one heard first.
      if (/~mcplate\b/.test(text)) await new Promise((r) => setTimeout(r, 50));
      const r = s.mcpStdio
        ? await callViaStdio(s.mcpStdio, mcpCall[1], JSON.parse(mcpCall[2]), drop?.signal)
        : s.mcpUrl
        ? await fetch(s.mcpUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: mcpCall[1], arguments: JSON.parse(mcpCall[2]) } }), ...(drop ? { signal: drop.signal } : {}) }).then((x) => x.json()).catch((e) => ({ error: { message: e.message } }))
        : { error: { message: "no MCP server" } };
      s.dropCall = null;
      if (drop?.signal.aborted) { notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: callId, status: "failed" }); return void write({ jsonrpc: "2.0", id: m.id, result: { stopReason: "cancelled" } }); }
      const answer = r.error ? `mcperr:${r.error.message}` : `mcp:${r.result?.isError ? "error:" : ""}${(r.result?.content || []).map((c) => c.text).join("")}`;
      if (rawCall) res(callId, answer);
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: callId, status: r.error || r.result?.isError ? "failed" : "completed" });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `${answer} ` } });
      if (rawCall) asst(`m_${callId}_said`, [{ type: "text", text: `${answer} ` }]);
    }
    if (/~steerable\b/i.test(text)) {
      let n = 0; const speak = (words) => { const msg = `m_st${++n}`; say(sessionId, "agent_message_chunk", words, msg); asst(msg, [{ type: "text", text: words }]); };
      speak("working… "); s.steerable = m.id;
      tickWhile(sessionId, () => !!s.onSteer);
      // The answer comes a moment after the words were taken, as the model's next call's would: the answer of the
      // prompt the turn is now.
      // Pictures that came with the words are said back by their count (`[1 picture]`).
      s.onSteer = (words, pictures = 0) => { const last = !/~again\b/.test(words); if (last) { s.onSteer = null; s.queueing = null; s.onQueued = null; } setTimeout(() => { speak(`heard:${words}${pictures ? ` [${pictures} picture${pictures === 1 ? "" : "s"}]` : ""} `); if (last) write({ jsonrpc: "2.0", id: s.steerable, result: { stopReason: "end_turn" } }); }, 20); };
      if (claude) {
        s.queueing = [];
        s.onQueued = () => {
          for (const p of s.queueing?.splice(0) || []) {
            const pictures = (p.pictures || []).map((b) => ({ type: "image", source: { type: "base64", media_type: b.mimeType, data: b.data } }));
            raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [...(p.words ? [{ type: "text", text: p.words }] : []), ...pictures] } });
            write({ jsonrpc: "2.0", id: s.steerable, result: { stopReason: "end_turn" } });
            s.steerable = p.id;
            s.onSteer?.(p.words, pictures.length);
          }
        };
      }
      return;
    }
    if (claude && /~queue3?\b/i.test(text)) {
      const gate = process.env.FAKE_ACP_QUEUE_GATE || "";
      const q = (s.queue = { active: m.id, waiting: [], cancelled: false });
      s.queueing = q.waiting;
      let n = 0;
      const speak = (words) => { const msg = `m_q${++n}`; say(sessionId, "agent_message_chunk", words, msg); asst(msg, [{ type: "text", text: words }]); };
      const echo = (words) => raw({ type: "user", parent_tool_use_id: null, isReplay: true, message: { role: "user", content: [{ type: "text", text: words }] } });
      const result = () => raw({ type: "result", subtype: "success", is_error: false, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
      const until = async (file) => {
        while (!q.cancelled && !existsSync(join(gate, file))) {
          if (existsSync(join(gate, "fail"))) {
            write({ jsonrpc: "2.0", id: q.active, error: { code: -32603, message: "Internal error", data: { errorKind: "invalid_request", details: "the request was refused as sent" } } });
            q.active = null;
            return false;
          }
          await new Promise((r) => setTimeout(r, 10));
        }
        return !q.cancelled;
      };
      speak("working… ");
      loadSkill();
      // `~compactfirst`: Claude compacts its own context before its first step, as an auto-compact before a model call.
      if (/~compactfirst\b/i.test(text)) {
        const auto = compacting(sessionId, "u_cq", raw, false);
        auto.start();
        auto.end({ pre: 180000, post: 31000, ms: 4000, summary: "Kept: the work so far." });
      }
      // Each call below is streamed as Claude's adapter streams one (`begins`): its start names no input and no file.
      // `~twoedits`: Claude edits two files of its folder before its first step, each a call that completed.
      if (/~twoedits\b/i.test(text))
        for (const [id, file] of [["qe1", "a.txt"], ["qe2", "b.txt"]]) {
          const path = join(s.cwd, file);
          begins(id, "Edit", "edit", "Edit", `Edit ${file}`, { file_path: path, old_string: "a", new_string: "b" }, { path });
          notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: id, status: "completed", ...named("Edit") });
        }
      // `~threefails`: Claude runs `npm test` three times before its first step, each failing with exit code 1; with
      // `~editbetween`, it edits a.txt between the second run and the third; with `~subeditbetween`, a Task sub-agent of
      // its edits a.txt there instead, each of the sub-agent's updates naming the Task call it runs under; with
      // `~callbetween <tool> <json>`, a call of that tool of Filament's there, as its stream says one — the call itself
      // is not made: the turn reads the stream.
      const callBetween = /~callbetween (\S+) (\{.*\})/.exec(text);
      if (/~threefails\b/i.test(text))
        for (const i of [1, 2, 3]) {
          if (i === 3 && callBetween) {
            const tool = `mcp__filament__${callBetween[1]}`;
            begins("tfc", tool, "other", tool, tool, JSON.parse(callBetween[2]));
            notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tfc", status: "completed", ...named(tool) });
          }
          if (i === 3 && /~editbetween\b/i.test(text)) {
            const path = join(s.cwd, "a.txt");
            begins("tfe", "Edit", "edit", "Edit", "Edit a.txt", { file_path: path, old_string: "a", new_string: "b" }, { path });
            notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tfe", status: "completed", ...named("Edit") });
          }
          if (i === 3 && /~subeditbetween\b/i.test(text)) {
            const path = join(s.cwd, "a.txt");
            begins("tfs", "Task", "think", "Task", "Fix the test", { description: "Fix the test", prompt: "Make npm test pass", subagent_type: "general-purpose" });
            begins("tfse", "Edit", "edit", "Edit", "Edit a.txt", { file_path: path, old_string: "a", new_string: "b" }, { path, under: "tfs" });
            notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tfse", status: "completed", _meta: { claudeCode: { toolName: "Edit", parentToolUseId: "tfs" } } });
            notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "tfs", status: "completed", ...named("Task") });
          }
          begins(`tf${i}`, "Bash", "execute", "Terminal", "npm test", { command: "npm test" });
          notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: `tf${i}`, status: "failed", content: [{ type: "content", content: { type: "text", text: "1 failing" } }], ...named("Bash", { terminal_exit: { exit_code: 1, signal: null } }) });
        }
      // `~planlate`: Claude writes its todo list after those edits, before its next step.
      if (/~planlate\b/i.test(text)) notify(sessionId, { sessionUpdate: "plan", entries: [{ content: "Edit a.txt", priority: "high", status: "completed" }, { content: "Edit b.txt", priority: "medium", status: "in_progress" }] });
      // `~compactat <call>`: Claude compacts before that call; `~compactin <call>`: while it runs, before what waits in its
      // queue is folded in. Each a compaction of its own, by its id.
      const compactAt = (/~compactat (\w+)/i.exec(text) || [])[1];
      const compactIn = (/~compactin (\w+)/i.exec(text) || [])[1];
      const compactNow = (id) => {
        const auto = compacting(sessionId, id, raw, false);
        auto.start();
        auto.end({ pre: 180000, post: 31000, ms: 4000, summary: "Kept: the work so far." });
      };
      for (const step of /~queue3\b/i.test(text) ? ["q1", "q2", "q3"] : ["q1", "q2"]) {
        if (compactAt === step) compactNow(`u_ca_${step}`);
        notify(sessionId, { sessionUpdate: "tool_call", toolCallId: step, title: "Terminal", kind: "execute", status: "pending", rawInput: {}, ...named("Bash") });
        asst(`m_q${++n}`, [{ type: "tool_use", id: step, name: "Bash", input: { command: step } }]);
        notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: step, title: `step ${step}`, rawInput: { command: step }, ...named("Bash") });
        if (!(await until(step))) return;
        if (compactIn === step) compactNow(`u_ci_${step}`);
        notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: step, status: "completed", ...named("Bash") });
        res(step, `${step} done`);
        for (const p of q.waiting.splice(0)) { echo(p.words); write({ jsonrpc: "2.0", id: q.active, result: { stopReason: "end_turn" } }); q.active = p.id; speak(`heard:${p.words} `); }
      }
      speak("done ");
      if (!(await until("end"))) return;
      // What it says from here — the turn's result and answer, and the prompts it runs next — reaches Filament in one
      // read, as Claude's adapter can send it.
      together(() => {
        result();
        write({ jsonrpc: "2.0", id: q.active, result: { stopReason: "end_turn", usage: STEP_USAGE } });
        s.queue = null; s.queueing = null;
        if (existsSync(join(gate, "lose"))) {
          sessions.delete(sessionId);
          for (const p of q.waiting.splice(0)) write({ jsonrpc: "2.0", id: p.id, error: { code: -32603, message: "Internal error: The Claude Agent process exited unexpectedly. Please start a new session." } });
          return;
        }
        for (const p of q.waiting.splice(0)) {
          echo(p.words);
          speak(`next:${p.words} `);
          // Words that say `~failqueued`: their cycle ends in an error, which fails their prompt.
          if (/~failqueued\b/.test(p.words)) {
            raw({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["the model's server failed mid-turn"], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
            write({ jsonrpc: "2.0", id: p.id, error: { code: -32603, message: "Internal error: the model's server failed mid-turn", data: { errorKind: "server_error" } } });
            continue;
          }
          result();
          write({ jsonrpc: "2.0", id: p.id, result: { stopReason: "end_turn", usage: STEP_USAGE } });
        }
      });
      return;
    }
    if (/~writefile\b/i.test(text)) { if (clientCaps.fs?.writeTextFile) { const r = await askClient("fs/write_text_file", { sessionId, path: `${s.cwd}/out.txt`, content: "hello from agent" }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: r?.__error ? `writeerr:${r.__error.message} ` : "wrote " } }); } else notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "nofs " } }); }
    // `~writeat <path>`: one file written through Filament at a path under the session's folder.
    { const at = /~writeat\s+(\S+)/i.exec(text); if (at) { const r = await askClient("fs/write_text_file", { sessionId, path: `${s.cwd}/${at[1]}`, content: "written at a path\n" }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: r?.__error ? `writeerr:${r.__error.message} ` : "wrote " } }); } }
    if (/~runcmd\b/i.test(text)) { if (clientCaps.terminal) { const t = await askClient("terminal/create", { sessionId, command: "echo", args: ["hi"] }); if (t?.__error) notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `cmderr:${t.__error.message} ` } }); else { const ex = await askClient("terminal/wait_for_exit", { sessionId, terminalId: t.terminalId }); const o = await askClient("terminal/output", { sessionId, terminalId: t.terminalId }); await askClient("terminal/release", { sessionId, terminalId: t.terminalId }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `cmd:${String(o?.output || "").trim()}(exit ${ex?.exitCode}) ` } }); } } else notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "noterm " } }); }
    // `~runslow`: a command of about 3 s that the agent waits on through Filament, saying nothing meanwhile.
    if (/~runargs\b/i.test(text)) { const t = await askClient("terminal/create", { sessionId, command: process.execPath, args: [join(s.cwd, "say.js"), "x&echo INJECTED", "a b"] }); if (t?.__error) notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `cmderr:${t.__error.message} ` } }); else { const ex = await askClient("terminal/wait_for_exit", { sessionId, terminalId: t.terminalId }); const o = await askClient("terminal/output", { sessionId, terminalId: t.terminalId }); await askClient("terminal/release", { sessionId, terminalId: t.terminalId }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `argv:${String(o?.output || "").trim()}(exit ${ex?.exitCode}) ` } }); } }
    if (/~runslow\b/i.test(text)) { const slow = process.platform === "win32" ? { command: "ping", args: ["-n", "4", "127.0.0.1"] } : { command: "sleep", args: ["3"] }; const t = await askClient("terminal/create", { sessionId, ...slow }); const ex = await askClient("terminal/wait_for_exit", { sessionId, terminalId: t.terminalId }); await askClient("terminal/release", { sessionId, terminalId: t.terminalId }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `slowcmd(exit ${ex?.exitCode}) ` } }); }
    // `~pollslow`: the same command, its output polled until it ends, saying nothing meanwhile.
    if (/~pollslow\b/i.test(text)) { const slow = process.platform === "win32" ? { command: "ping", args: ["-n", "4", "127.0.0.1"] } : { command: "sleep", args: ["3"] }; const t = await askClient("terminal/create", { sessionId, ...slow }); let o = null; while (!o?.exitStatus) { await new Promise((r) => setTimeout(r, 200)); o = await askClient("terminal/output", { sessionId, terminalId: t.terminalId }); } await askClient("terminal/release", { sessionId, terminalId: t.terminalId }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `polledcmd(exit ${o.exitStatus.exitCode}) ` } }); }
    // `~termcrash`, `~termflood`: a command Filament runs for it (`linger.js` in the session's folder writes its pid to
    // `linger.pid`, says ready and stays), then the agent crashes, or asks for 200 terminals more (of a program that
    // isn't there) and ends its turn.
    const lingering = async () => { const t = await askClient("terminal/create", { sessionId, command: process.execPath, args: [join(s.cwd, "linger.js"), join(s.cwd, "linger.pid")] }); while (!String((await askClient("terminal/output", { sessionId, terminalId: t.terminalId }))?.output || "").includes("ready")) await new Promise((r) => setTimeout(r, 50)); };
    if (/~termcrash\b/i.test(text)) { await lingering(); setTimeout(() => die(3), 20); return; }
    if (/~termflood\b/i.test(text)) { await lingering(); for (let i = 0; i < 200; i++) await askClient("terminal/create", { sessionId, command: "filament-no-such-program", args: ["x"] }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "flooded " } }); }
    if (/~quiet\b/i.test(text)) { s.hung = m.id; return; } // silent after the dials above, until session/cancel
    if (/~lastwords\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "working… " } });
      const gate = process.env.FAKE_ACP_EXIT_GATE;
      while (gate && !existsSync(gate)) await new Promise((r) => setTimeout(r, 10));
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "e9", title: "Edit src/app.js", kind: "edit", status: "in_progress" });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "e9", status: "completed", content: [{ type: "diff", path: "src/app.js", oldText: "one", newText: "one\ntwo" }] });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "last words" } });
      return process.stderr.write("fake agent: gone for good\n", () => process.stdout.write("", () => die(3)));
    }
    if (/~crash\b/i.test(text)) { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "about to crash " } }); setTimeout(() => die(3), 20); return; }
    if (/~refuse\b/i.test(text)) return reply({ stopReason: "refusal" });
    // Failures as Claude's adapter sends them: a JSON-RPC internal error, with the Agent SDK's `errorKind` when it
    // has one.
    // `~openend`: a turn as Claude's adapter ends one whose calls had no result (HarnessV4_Tasks B15): a call, the reply
    // ("all done"; none with `~openend noreply`), the context's count, then the call failed in the adapter's words and
    // the prompt failed, `incomplete_tool_call`.
    if (/~openend\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "bg1", title: "Run the workflow", kind: "other", status: "in_progress" });
      if (!/noreply/i.test(text)) notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "all done" } });
      notify(sessionId, { sessionUpdate: "usage_update", used: 4321, size: 200000 });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "bg1", status: "failed", content: [{ type: "content", content: { type: "text", text: "Claude ended the turn without returning a result for this tool." } }] });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error: Claude ended the turn without returning results for tool calls: bg1", data: { errorKind: "incomplete_tool_call" } } });
    }
    // `~failonce <word>`: the first prompt of this process with the word does a call, says "half done" and fails as an
    // adapter fails a prompt; every later one with it is answered (HarnessV4_Tasks B8: a message sent again after its
    // turn failed).
    const once = /~failonce (\w+)/i.exec(text);
    if (once && !failedOnce.has(once[1])) {
      failedOnce.add(once[1]);
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "f1", title: "Edit src/app.js", kind: "edit", status: "in_progress" });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "f1", status: "completed" });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "half done" } });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "the model's service is overloaded" } } });
    }
    // `~losesession <key>`, once per key: the session's process dies under the prompt, as claude-agent-acp says one did,
    // and the agent lets the session go; a prompt to it after is not found, and a resume opens it again.
    const lose = /~losesession (\w+)/i.exec(text);
    if (lose && !failedOnce.has(`lose:${lose[1]}`)) {
      failedOnce.add(`lose:${lose[1]}`);
      sessions.delete(sessionId);
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error: The Claude Agent process exited unexpectedly. Please start a new session." } });
    }
    if (/~rpcrefuse\b/i.test(text)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "invalid_request", details: "the request was refused as sent" } } });
    if (/~overflow\b/i.test(text)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { details: "Prompt is too long: 212000 tokens > 200000 maximum" } } });
    if (/~overloaded\b/i.test(text)) return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error", data: { errorKind: "overloaded", details: "Overloaded" } } });
    // `~spentfail` (FAKE_ACP_CLAUDE): words in two model calls, each message with its model and its call's usage, then the
    // cycle's result as Claude's SDK gives one that ended in an error — its usage, its price at the API's rates and the
    // models that counted it, which are the session's running total (every call since it opened) — the context's count
    // with that price, and the prompt's failure, as Claude's adapter fails one.
    if (claude && /~spentfail\b/i.test(text)) {
      const counted = (msg, words, usage) => raw({ type: "assistant", parent_tool_use_id: null, message: { id: msg, model: answersOn(s), role: "assistant", content: [{ type: "text", text: words }], usage } });
      counted("msg_sf1", "Looking at it. ", { input_tokens: 200, cache_read_input_tokens: 900, cache_creation_input_tokens: 300, output_tokens: 15 });
      say(sessionId, "agent_message_chunk", "Looking at it. ", "msg_sf1");
      counted("msg_sf2", "Still at it. ", { input_tokens: 400, cache_read_input_tokens: 1100, cache_creation_input_tokens: 0, output_tokens: 25 });
      say(sessionId, "agent_message_chunk", "Still at it. ", "msg_sf2");
      spendInto(s, answersOn(s), { inputTokens: 600, outputTokens: 40, cacheReadInputTokens: 2000, cacheCreationInputTokens: 300 });
      // `~sub`: a sub-agent's call on claude-haiku-4-5 in the cycle too, its message marked by the call that launched it.
      if (/~sub\b/i.test(text)) {
        raw({ type: "assistant", parent_tool_use_id: "toolu_sf_task", message: { id: "msg_sf_sub", model: "claude-haiku-4-5", role: "assistant", content: [{ type: "text", text: "Found it." }], usage: { input_tokens: 300, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
        spendInto(s, "claude-haiku-4-5", { inputTokens: 300, outputTokens: 60, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
      }
      raw({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["the model's server failed mid-turn"], origin: { kind: "human" }, total_cost_usd: 0.0123, usage: { input_tokens: 600, output_tokens: 40, cache_read_input_tokens: 2000, cache_creation_input_tokens: 300 }, modelUsage: structuredClone(s.modelsSpent) });
      notify(sessionId, { sessionUpdate: "usage_update", used: 2940, size: 200000, cost: costSoFar(s, 0.0123) });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error: the model's server failed mid-turn", data: { errorKind: "server_error" } } });
    }
    // `~zeroed` (FAKE_ACP_CLAUDE): a model call, then the cycle's result as Claude's SDK may give a crashed run's — its
    // usage and its price zeroed — which Claude's adapter says as the session's cost, and the prompt's failure. The
    // session's running total is what it was: the next turn's figure goes on from it.
    if (claude && /~zeroed\b/i.test(text)) {
      raw({ type: "assistant", parent_tool_use_id: null, message: { id: "msg_z1", model: answersOn(s), role: "assistant", content: [{ type: "text", text: "Starting. " }], usage: { input_tokens: 300, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
      say(sessionId, "agent_message_chunk", "Starting. ", "msg_z1");
      const none = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
      raw({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["the run ended unexpectedly"], origin: { kind: "human" }, total_cost_usd: 0, usage: none, modelUsage: {} });
      notify(sessionId, { sessionUpdate: "usage_update", used: 310, size: 200000, cost: { amount: 0, currency: "USD" } });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: "Internal error: the run ended unexpectedly", data: { errorKind: "server_error" } } });
    }
    const apiErr = /~apierror(bare|ok)?\b/i.exec(text);
    if (apiErr && claude) {
      const words = "API Error: the model's server failed mid-turn";
      asst("msg_a1", [{ type: "text", text: "Looking at it. " }]);
      say(sessionId, "agent_message_chunk", "Looking at it. ", "msg_a1");
      raw({ type: "assistant", parent_tool_use_id: null, error: "server_error", message: { id: "msg_err", model: "<synthetic>", role: "assistant", content: [{ type: "text", text: words }] } });
      say(sessionId, "agent_message_chunk", words, "msg_err");
      if (apiErr[1] === "ok") return reply({ stopReason: "end_turn" });
      raw({ type: "result", subtype: "success", is_error: true, result: words });
      return write({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: apiErr[1] === "bare" ? "Internal error" : `Internal error: ${words}`, data: { errorKind: "server_error" } } });
    }
    if (/~compaction\b/i.test(text)) notify(sessionId, { sessionUpdate: "compaction_update", compactionId: "c1", status: "started" });
    if (/~badtool\b/i.test(text)) notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "bt1", kind: "read", status: "completed" });
    // Three thought chunks in a row, then text: the run must be flushed as ONE unit, not three fragments.
    if (/~thoughts\b/i.test(text)) {
      for (const part of ["first part of the thought ", "second part ", "third part"]) notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: part } });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "the answer" } });
      return reply({ stopReason: "end_turn" });
    }
    // Thought, tool call, thought: the tool boundary must reset the run, so the second thought is its own unit.
    if (/~thinktool\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking before the tool " } });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "tt1", title: "Read src/a.js", kind: "read", status: "completed" });
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking after the tool " } });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "done thinking" } });
      return reply({ stopReason: "end_turn" });
    }
    // A notice, as claude-agent-acp 0.93 sends one (HarnessV4_Tasks C21): a `notice` update to a client that declares
    // `session.notices`, else the bold-label line it writes into its answer. Its words say which way it went.
    if (/~notice\b/i.test(text)) {
      const declared = typeof clientCaps?.session?.notices === "object" && clientCaps.session.notices !== null;
      const notice = { severity: "warning", title: "Model fallback", description: `claude-opus-5-5 was overloaded, so it went on with claude-sonnet-5-5 (${declared ? "as a notice" : "as words"}).` };
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Before. " } });
      if (declared) notify(sessionId, { sessionUpdate: "notice", ...notice });
      else notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `**${notice.title}:** ${notice.description}` } });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "After." } });
      return reply({ stopReason: "end_turn" });
    }
    // Agent text carrying invisible Unicode tag characters (U+E0000 block), which must never reach the client.
    if (/~tags\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "clean before\u{E0041}\u{E0042}\u{E0043}clean after" } });
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thought\u{E007F}tagged" } });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " and the end" } });
      return reply({ stopReason: "end_turn" });
    }
    // A turn that produced a real reply but was cut short: unlike a refusal, this one has text the user can read, so
    // Filament must not append a paragraph to it (the wire already carries the mapped `length` stop reason).
    if (/~limit\b/i.test(text)) { notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "a real but truncated answer " } }); return reply({ stopReason: "max_tokens" }); }
    // Cut short WITHOUT ever answering. The unconditional thought + tool_call above still put `⚙` lines into the
    // reply, so a reply that looks non-empty is not the same as a reply the agent wrote — this is the case where
    // Filament must still explain itself, because there is no answer to read and no client renders `max_tokens`.
    if (/~silentlimit\b/i.test(text)) return reply({ stopReason: "max_tokens" });
    // Two thought runs separated by a gap longer than the flush timer (400 ms) and by NO tool or text boundary, so
    // only the timer can split them: one thinking block each, not one merged block.
    if (/~idlegap\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "first run " } });
      await new Promise((r) => setTimeout(r, 700));
      notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "second run " } });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "after the gap" } });
      return reply({ stopReason: "end_turn" });
    }
    // Thinking as a model streams it: a chunk every 150 ms for over a second, never a gap of 400 ms, then text. Its
    // pieces must go out while it thinks, not in one lump when the text begins.
    if (/~steadythought\b/i.test(text)) {
      for (let i = 1; i <= 8; i++) {
        notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: `step${i} ` } });
        await new Promise((r) => setTimeout(r, 150));
      }
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "after steady thinking" } });
      return reply({ stopReason: "end_turn" });
    }
    // A turn that mixes ROUTED and BUILT-IN tool calls, for measuring the steering leak rate (P6). One call goes
    // through Filament's own MCP toolset (titled the way Claude Code titles MCP tools, so the listener can recognise
    // it) and two use the agent's built-ins — which is exactly what a model does when it half-obeys steering.
    if (/~leak\b/i.test(text)) {
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "r1", title: "mcp__filament__Read", kind: "other", status: "in_progress", rawInput: { file_path: `${s.cwd}/README.md` } });
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "r1", title: "mcp__filament__Read", status: "completed" });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "b1", title: "Grep src", kind: "search", status: "completed" });
      notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "b2", title: "npm test", kind: "execute", status: "completed" });
      // Two updates for one call must not be counted as two calls: the leak rate is per call, not per event.
      notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "b2", status: "completed" });
      notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "leak check done " } });
      return reply({ stopReason: "end_turn" });
    }
    if (/~drip\b/i.test(text)) { const gate = process.env.FAKE_ACP_HOLD_GATE; const until = Date.now() + (Number(process.env.FAKE_ACP_DRIP_MS) || 60000); let n = 0; while (gate ? !existsSync(join(gate, "drip")) : Date.now() < until) { await new Promise((r) => setTimeout(r, 200)); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: `tick ${++n} ` } }); } } // a steady stream, for looking at the live view
    for (const part of [`echo(${s.prompts.length}): `, text.slice(-60)]) notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: part } });
    if (/~rethink\b/i.test(text)) { notify(sessionId, { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "second thought, two lines\nline two\n" } }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "after rethink" } }); }
    // `~reads <n>`: a file read whose result is n characters, and nothing said of the context or the turn's usage: an
    // agent that reports neither.
    const reads = /~reads (\d+)/i.exec(text);
    if (reads) { const n = Number(reads[1]); notify(sessionId, { sessionUpdate: "tool_call", toolCallId: "rd1", title: "Read big.txt", kind: "read", status: "pending", rawInput: { path: "big.txt" } }); notify(sessionId, { sessionUpdate: "tool_call_update", toolCallId: "rd1", status: "completed", content: [{ type: "content", content: { type: "text", text: "lorem ipsum ".repeat(Math.ceil(n / 12)).slice(0, n) } }] }); notify(sessionId, { sessionUpdate: "agent_message_chunk", content: { type: "text", text: " read it all" } }); return reply({ stopReason: "end_turn" }); }
    // `~summed <n>`: the turn's usage alone, n input tokens summed over its model calls, and no count of the context.
    const summed = /~summed (\d+)/i.exec(text);
    if (summed) return reply({ stopReason: "end_turn", usage: { inputTokens: Number(summed[1]), outputTokens: 60, cachedReadTokens: 0, cachedWriteTokens: 0, totalTokens: Number(summed[1]) + 60 } });
    // `~cachewrite`: the turn's usage, the cache it wrote too, and no count of the context (no `usage_update`).
    if (/~cachewrite\b/i.test(text)) return reply({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 100, cachedWriteTokens: 2000, totalTokens: 2156 } });
    // `~counted <name>`: the turn's result names the models that counted it, as Claude's adapter and Gemini CLI do
    // (`_meta.quota.model_usage`): <name>, which read the conversation, and a helper that read little and wrote more.
    // What they spent joins the session's running total.
    const counted = /~counted (\S+)/i.exec(text);
    if (counted) {
      const model_usage = [
        { model: "helper-model", token_count: { inputTokens: 300, outputTokens: 60 } },
        { model: counted[1], token_count: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 4990 } },
      ];
      for (const { model, token_count: t } of model_usage) spendInto(s, model, { inputTokens: t.inputTokens, outputTokens: t.outputTokens, cacheReadInputTokens: t.cachedInputTokens || 0 });
      // Its cycle's result, as every one of Claude's says it: its main loop's usage, and the session's running totals.
      raw({ type: "result", subtype: "success", is_error: false, origin: { kind: "human" }, usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 4990, cache_creation_input_tokens: 0 }, modelUsage: structuredClone(s.modelsSpent) });
      return reply({ stopReason: "end_turn", usage: { inputTokens: 310, outputTokens: 80, cachedReadTokens: 4990, cachedWriteTokens: 0, totalTokens: 5380 }, _meta: { quota: { model_usage } } });
    }
    // `~subspent` (Claude's adapter): the turn's answer says its main loop's usage (`usage`, as Claude's SDK counts a
    // result's) and every model call's by model (`_meta.quota.model_usage`): the main loop's on claude-sonnet-5, and a
    // sub-agent's on claude-haiku-4-5.
    if (/~subspent\b/i.test(text)) {
      const model_usage = [
        { model: answersOn(s), token_count: { inputTokens: 100, outputTokens: 20, cachedInputTokens: 1000, cachedWriteTokens: 0 } },
        { model: "claude-haiku-4-5", token_count: { inputTokens: 300, outputTokens: 60, cachedInputTokens: 0, cachedWriteTokens: 0 } },
      ];
      return reply({ stopReason: "end_turn", usage: { inputTokens: 100, outputTokens: 20, cachedReadTokens: 1000, cachedWriteTokens: 0, totalTokens: 1120 }, _meta: { quota: { model_usage } } });
    }
    // `~holds <n>`: the context holds n tokens of its 200,000-token window as the turn ends, as Claude's adapter counts
    // it (`usage_update`): an agent's line and the resume question (AC5-3).
    const holds = /~holds (\d+)/i.exec(text);
    if (holds) { notify(sessionId, { sessionUpdate: "usage_update", used: Number(holds[1]), size: 200000 }); return reply({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: Number(holds[1]) - 10, cachedWriteTokens: 0, totalTokens: Number(holds[1]) + 20 } }); }
    // `~window <n>`: the turn ends with the agent naming its window, n tokens (`usage_update`'s size, as Claude's adapter
    // says it): Filament's window for the model from then on, and the agent's other accounts' until they name theirs.
    const window = /~window (\d+)/i.exec(text);
    if (window) { notify(sessionId, { sessionUpdate: "usage_update", used: 1200, size: Number(window[1]) }); return reply({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 20, cachedReadTokens: 1190, cachedWriteTokens: 0, totalTokens: 1220 } }); }
    // `~ran` (FAKE_ACP_CLAUDE): a call of the main loop on claude-sonnet-5, and with `~sub` a sub-agent's on
    // claude-haiku-4-5 too, as Claude's SDK and adapter tell them. The cycle's result names its run — its Claude session
    // and its place among the run's results (`result_index`) — its main loop's usage, and the session's running totals,
    // by model and at the API's prices (`modelUsage`, `total_cost_usd`), which the adapter says as the session's cost.
    // The answer's rows are what the result added to the reading before it, or, for the first result of a query that
    // resumed the session (`loaded`), the main loop's alone (the adapter's `resumedFirstResultModelUsage`). `~fresh`
    // first: the query restarts in a fresh context, as the adapter restarts one when a plan is accepted with one — a
    // Claude session of its own, its totals and its results' count from nothing. `~dear`: the main loop's call costs 0.12.
    // `~planfresh`: a cycle of 0.0309 runs in the query first, its result said, before the query restarts so — a plan
    // accepted with a fresh context mid-turn — and the turn's answer carries both cycles' usage, as the adapter's does.
    if (claude && /~ran\b/i.test(text)) {
      /** @type {any} */
      let carried = null;
      if (/~planfresh\b/i.test(text)) {
        const was = structuredClone(s.modelsSpent || {});
        const first = { inputTokens: 10, outputTokens: 46, cacheReadInputTokens: 100, cacheCreationInputTokens: 2000 };
        spendInto(s, answersOn(s), first);
        const cost = costSoFar(s, 0.0309);
        const loop = { input_tokens: 10, output_tokens: 46, cache_read_input_tokens: 100, cache_creation_input_tokens: 2000 };
        raw({ type: "assistant", parent_tool_use_id: null, message: { id: `msg_plan${s.prompts.length}`, model: answersOn(s), role: "assistant", content: [{ type: "text", text: "planned" }], usage: loop } });
        raw({ type: "result", subtype: "success", is_error: false, origin: { kind: "human" }, session_id: s.claudeId || sessionId, result_index: s.results || 0, total_cost_usd: cost.amount, usage: loop, modelUsage: structuredClone(s.modelsSpent) });
        notify(sessionId, { sessionUpdate: "usage_update", used: 2156, size: 200000, cost });
        carried = s.loaded && !s.results ? { [answersOn(s)]: first } : grewSince(s.modelsSpent, was);
      }
      if (/~fresh\b|~planfresh\b/i.test(text)) Object.assign(s, { claudeId: `fresh_${Math.random().toString(36).slice(2, 10)}`, costSpent: 0, modelsSpent: {}, results: 0, loaded: false });
      const main = { inputTokens: 10, outputTokens: 46, cacheReadInputTokens: 100, cacheCreationInputTokens: 2000 };
      const before = structuredClone(s.modelsSpent || {});
      spendInto(s, answersOn(s), main);
      let usd = /~dear\b/i.test(text) ? 0.12 : 0.0309;
      if (/~sub\b/i.test(text)) {
        spendInto(s, "claude-haiku-4-5", { inputTokens: 300, outputTokens: 60, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 });
        usd += 0.0006;
      }
      const cost = costSoFar(s, usd);
      const loop = { input_tokens: 10, output_tokens: 46, cache_read_input_tokens: 100, cache_creation_input_tokens: 2000 };
      raw({ type: "assistant", parent_tool_use_id: null, message: { id: `msg_ran${s.prompts.length}`, model: answersOn(s), role: "assistant", content: [{ type: "text", text: "ran" }], usage: loop } });
      const index = s.results || 0;
      raw({ type: "result", subtype: "success", is_error: false, origin: { kind: "human" }, session_id: s.claudeId || sessionId, result_index: index, total_cost_usd: cost.amount, usage: loop, modelUsage: structuredClone(s.modelsSpent) });
      notify(sessionId, { sessionUpdate: "usage_update", used: 2156, size: 200000, cost });
      const rows = s.loaded && index === 0 ? { [answersOn(s)]: main } : grewSince(s.modelsSpent, before);
      for (const [model, t] of Object.entries(carried || {})) rows[model] = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v + (rows[model]?.[k] || 0)]));
      s.results = index + 1;
      const model_usage = Object.entries(rows).map(([model, t]) => ({ model, token_count: { inputTokens: t.inputTokens, outputTokens: t.outputTokens, cachedInputTokens: t.cacheReadInputTokens, cachedWriteTokens: t.cacheCreationInputTokens } }));
      const cycles = carried ? 2 : 1;
      return reply({ stopReason: "end_turn", usage: { inputTokens: 10 * cycles, outputTokens: 46 * cycles, cachedReadTokens: 100 * cycles, cachedWriteTokens: 2000 * cycles, totalTokens: 2156 * cycles }, _meta: { quota: { model_usage } } });
    }
    // `~priced`: the turn's usage and its price at the API's rates, as Claude's adapter tells them (`total_cost_usd`).
    if (/~priced\b/i.test(text)) { notify(sessionId, { sessionUpdate: "usage_update", used: 2156, size: 200000, cost: costSoFar(s, 0.0309) }); return reply({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 100, cachedWriteTokens: 2000, totalTokens: 2156 } }); }
    if (process.env.FAKE_ACP_CONFIG) { notify(sessionId, { sessionUpdate: "usage_update", used: 24627, size: 200000, cost: costSoFar(s, 0.0309) }); return reply({ stopReason: "end_turn", usage: { inputTokens: 10, outputTokens: 46, cachedReadTokens: 100, cachedWriteTokens: 24471, totalTokens: 24627 }, _meta: { quota: { model_usage: [{ model: answersOn(s), token_count: { inputTokens: 10, outputTokens: 46, cachedInputTokens: 100, cachedWriteTokens: 24471 } }] } } }); }
    return reply({ stopReason: "end_turn" });
  }
  write({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `unknown method ${m.method}` } });
}

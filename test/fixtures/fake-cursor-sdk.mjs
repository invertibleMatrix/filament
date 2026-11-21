// A stand-in for @cursor/sdk with the documented surface Filament uses: Agent.create / resume / list, agent.send
// returning a Run (onDelta streaming, wait, cancel), Cursor.me and Cursor.models.list. Behaviour is driven by
// keywords in the prompt (~twoedits, ~threefails, ~shell, ~edit, ~plan, ~task, ~subtodo, ~subsays, ~subcompact, ~image, ~compact, ~compactfail, ~custom, ~bash:<command>~, ~graph, ~visual, ~hang, ~fills <n>,
// ~fail, ~fail-spent, ~nextfails (the agent's next run fails), ~waitbreaks (the run's wait throws), ~nousage, ~retry, ~nostart, ~nocancel), each call in the SDK's own shapes (its typings' args and results) — ~task's sub-agent makes a model call of
// its own — and every create/resume/send/close, and each Cursor.me, is appended to FAKE_SDK_LOG as JSON lines for
// assertions.
// FAKE_SDK_SLOW_CREATE_MS: a new agent is handed back after this long, so a stop can come before the message goes
// out. `~slowsend`: a send hands back its run 1.5 s late.
// The key `ck-slow-me` works as the good one, and Cursor.me names its owner — another account's — 0.8 s late.
// Run.steer (the SDK's own, HarnessV4_Tasks B14): a run still working takes the words — a `~hang` run says them and ends
// — unless they hold `~nosteer`, or the run is over: then they are handed back (`revert_to_followup`). Each is logged
// (`event: "steer"`). FAKE_SDK_NO_STEER: its runs have no steer, as an older SDK's. A `~followup` run has no step left
// for words: silent until it is steered, it hands the words back and then ends, as a run past its last step does.
// Local agents are kept by folder, as the SDK keeps them (a workspace's state root): Agent.list names one folder's
// (`cwd`, else the process's), and Agent.resume finds an agent only in the folder it was made in. An agent with a run
// in progress is busy: a send fails (AgentBusyError) unless forced, which expires that run (it ends cancelled).
// Cursor.auth.login (AC3-7) names its page, then makes a key named as asked after FAKE_SDK_LOGIN_MS (150 by default);
// FAKE_SDK_LOGIN=wait waits until its signal aborts. Its options are logged (`event: "login"`).
// FAKE_SDK_OVERFLOW_SEEDED: a message that carries the earlier conversation is refused as too long for the model.
// Filament's summary instruction (HarnessV3-ACP AC5-4) is answered with how many messages the agent heard before it,
// in the shape asked for, its usage mostly read from the cache — its `tasks` tool, where it has one, tried first, the
// answer logged (`event: "summary-tool"`).
// `tools` and `disallowedTools` take the SDK's own tool names and no other, as @cursor/sdk 1.0.31 reads them (its
// tools-option.ts: the names of its proto's tool calls, each also by its proto name and its field's): a name it does
// not know is refused as the agent is created or resumed, in the SDK's words (`TOOL_NAMES`, `protoTools`). An agent
// whose tools leave `mcp` out has no custom tools, as the SDK's capability group takes them with it.
// FAKE_SDK_NO_TOOLS: names (comma-separated) this SDK does not know, as another version's. Each refusal is logged
// (`event: "refused"`).
// `~late`: a run silent until the file FAKE_SDK_LATE names is there (15 s at most): it then writes late.txt through
// Filament's Write, logs what the tool answered (`event: "late"`), and goes on to its end. A key that starts
// `ck-echoed-` is refused in words that hold it whole, from their 151st character on.
import { appendFileSync, existsSync } from "node:fs";
import { personWords } from "./person-words.mjs";

export const VERSION = "fake-1.0";
const log = (o) => { if (process.env.FAKE_SDK_LOG) appendFileSync(process.env.FAKE_SDK_LOG, JSON.stringify(o) + "\n"); };
const GOOD_KEY = "ck-test";
const SLOW_ME_KEY = "ck-slow-me";
/** The keys a sign-in made, with the names they were made with. */
const minted = new Map();
const checkKey = (k) => { if (k !== GOOD_KEY && k !== SLOW_ME_KEY && !minted.has(k)) { const e = new Error(String(k).startsWith("ck-echoed-") ? `${"Invalid API key: the request was refused as it came, ".padEnd(150, ".")}${k}` : "Invalid API key"); e.name = "AuthenticationError"; e.code = "unauthenticated"; throw e; } };
/** The SDK's public tool names (1.0.31): its proto's tool calls, each without its `ToolCall`. */
const TOOL_NAMES = "adopt aiAttribution applyAgentDiff askQuestion await blameByFilePath communicateUpdate computerUse connectScm createAgent createGoal createPlan delete edit editPrLabels fetch fetchCloudAgentData generateImage getAgentStatus getMcpTools getPrCodeTour glob grep listMcpResources ls mcp mcpAuth piBash piEdit piFind piGrep piLs piRead piWrite prManagement read readAgentTranscript readLints readMcpResource readTodos recordCiInvestigationFindings recordScreen reflect replaceEnv reportBug reportBugfixResults searchConversations semSearch sendFinalSummary sendMessage sendToAgent sendToUser setActiveBranch setupVmEnvironment shell startGrindExecution startGrindPlanning stopAgent switchMode task truncated updateGoal updatePrCodeTour updateTodos webFetch webSearch writeShellStdin".split(" ");
/** A name the SDK takes → the public name it stands for: itself, its proto name (`pi_write_tool_call`), its field's (`piWriteToolCall`). */
const TOOL_OF = new Map(TOOL_NAMES.flatMap((n) => [[n, n], [`${n.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}_tool_call`, n], [`${n}ToolCall`, n]]));
/** The public names an option lists, or the SDK's refusal of one it does not know (its `resolve…ProtoToolNames`). @param {string[] | undefined} names @param {string} option */
const protoTools = (names, option) => {
  if (names === undefined) return undefined;
  const gone = new Set(String(process.env.FAKE_SDK_NO_TOOLS || "").split(",").filter(Boolean));
  const unknown = names.filter((n) => !TOOL_OF.has(String(n).trim()) || gone.has(TOOL_OF.get(String(n).trim())));
  if (unknown.length) { log({ event: "refused", option, unknown }); const e = new Error(`Unknown tool name(s) in \`${option}\`: ${unknown.join(", ")}. Valid tool names: ${TOOL_NAMES.filter((n) => !gone.has(n)).join(", ")}.`); e.name = "ConfigurationError"; e.isRetryable = false; throw e; }
  return names.map((n) => TOOL_OF.get(String(n).trim()));
};
/** Whether an agent's options leave it the MCP family, its custom tools with it. */
const offersMcp = (o) => (!o.tools || protoTools(o.tools, "tools").includes("mcp")) && !(protoTools(o.disallowedTools, "disallowedTools") || []).includes("mcp");
const MODELS = [
  { id: "auto-smart", displayName: "Auto" },
  { id: "grok-4.6", displayName: "Grok 4.6", parameters: [{ id: "effort", values: [{ value: "low" }, { value: "medium" }, { value: "high" }, { value: "xhigh" }] }, { id: "fast", values: [{ value: "false" }, { value: "true" }] }] },
  { id: "composer-2.5", displayName: "Composer 2.5", aliases: ["composer"], parameters: [{ id: "fast", values: [{ value: "false" }, { value: "true" }] }] },
];
const agents = new Map(); let counter = 0;

class FakeRun {
  constructor(agent, text, opts) {
    this.agentId = agent.agentId; this._noCancel = /~nocancel/.test(text); this.id = `run-${++counter}`; this.status = "running"; this.result = undefined; this.usage = undefined; this.model = opts?.model || agent.model;
    this._done = new Promise((r, j) => { this._finish = r; this._break = j; }); this._done.catch(() => {}); this._cancelled = false; this._onDelta = opts?.onDelta || null;
    if (process.env.FAKE_SDK_NO_STEER) this.steer = undefined;
    setTimeout(() => this.#play(agent, text, opts).catch(() => {}), 5);
  }
  async #play(agent, text, opts) {
    const d = async (update) => { if (this._cancelled) return; await opts?.onDelta?.({ update }); };
    // An agent a `~nextfails` run marked: this run fails, overloaded, before any model call.
    if (agent._failNext) { agent._failNext = false; this.status = "error"; this.error = { message: "model overloaded", code: "resource_exhausted" }; this._finish({ id: this.id, status: "error", error: this.error }); return; }
    if (/~nextfails/.test(text)) agent._failNext = true;
    await d({ type: "thinking-delta", text: "pondering " });
    await d({ type: "thinking-completed", thinkingDurationMs: 12 });
    let calls = 0; const billed = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }; const turnEnded = async (u) => { calls++; for (const k of Object.keys(billed)) billed[k] += u[k] || 0; await d({ type: "turn-ended", usage: u }); };
    if (/~compact\b/.test(text)) { await d({ type: "summary-started" }); await d({ type: "summary-completed" }); }
    // A summary that failed, as the SDK says one from 1.2.0: the context left as it was.
    if (/~compactfail/.test(text)) { await d({ type: "summary-started" }); await d({ type: "summary-completed", failed: true }); }
    // `~twoedits`: a.txt and b.txt edited, each call as the SDK streams one: partial while its model writes it — its path
    // half written —, started with its input whole, then completed.
    if (/~twoedits/.test(text)) for (const [callId, path] of [["te1", "a.txt"], ["te2", "b.txt"]]) { const args = { path, oldText: "a", newText: "b" }; await d({ type: "partial-tool-call", callId, toolCall: { type: "edit", args: { path: path.slice(0, 1) } } }); await d({ type: "tool-call-started", callId, toolCall: { type: "edit", args } }); await d({ type: "tool-call-completed", callId, toolCall: { type: "edit", args, result: { status: "success", value: { linesAdded: 1, linesRemoved: 1, diffString: `--- ${path}\n+++ ${path}\n@@ -1 +1 @@\n-a\n+b\n` } } } }); }
    // `~threefails`: `npm test` run three times, each exiting 1 — a shell that ran is a success to the SDK, its exit code
    // in its value; each call partial first, its command half written.
    if (/~threefails/.test(text)) for (const n of [1, 2, 3]) { const toolCall = { type: "shell", args: { command: "npm test" } }; await d({ type: "partial-tool-call", callId: `tf${n}`, toolCall: { type: "shell", args: { command: "npm" } } }); await d({ type: "tool-call-started", callId: `tf${n}`, toolCall }); await d({ type: "tool-call-completed", callId: `tf${n}`, toolCall: { ...toolCall, result: { status: "success", value: { exitCode: 1, signal: "", stdout: "", stderr: "1 failing\n", executionTime: 40 } } } }); }
    // Two compactions in one prompt, the second's end with no start said before it.
    if (/~compactbare/.test(text)) { await d({ type: "summary-started" }); await d({ type: "summary-completed" }); await d({ type: "summary-completed" }); }
    if (/~shell/.test(text)) { await d({ type: "tool-call-started", callId: "c1", toolCall: { type: "shell", args: { command: "npm test" } } }); await d({ type: "tool-call-completed", callId: "c1", toolCall: { type: "shell", args: { command: "npm test" }, result: { status: "success", value: { exitCode: 0, signal: "", stdout: "3 passing\n", stderr: "", executionTime: 40 } } } }); await d({ type: "token-delta", tokens: 1000 }); await turnEnded({ inputTokens: 80, outputTokens: 10, cacheReadTokens: 60, cacheWriteTokens: 0, totalTokens: 150 }); }
    if (/~edit/.test(text)) { await d({ type: "tool-call-started", callId: "c2", toolCall: { type: "edit", args: { path: "src/app.js", oldText: "a", newText: "b" } } }); await d({ type: "tool-call-completed", callId: "c2", toolCall: { type: "edit", args: { path: "src/app.js", oldText: "a", newText: "b" }, result: { status: "success", value: { linesAdded: 1, linesRemoved: 1, diffString: "--- src/app.js\n+++ src/app.js\n@@ -1 +1 @@\n-a\n+b\n" } } } }); }
    // The to-do list: whole, then an update naming only what changed; each result is the list as Cursor keeps it.
    if (/~plan/.test(text)) { const first = [{ content: "Read the test", status: "pending" }, { content: "Fix it", status: "pending" }]; const change = [{ content: "Read the test", status: "completed" }, { content: "Rewrite it all", status: "cancelled" }]; const now = [{ content: "Read the test", status: "completed" }, { content: "Fix it", status: "inProgress" }, { content: "Rewrite it all", status: "cancelled" }]; await d({ type: "tool-call-started", callId: "c3", toolCall: { type: "updateTodos", args: { todos: first } } }); await d({ type: "tool-call-completed", callId: "c3", toolCall: { type: "updateTodos", args: { todos: first }, result: { status: "success", value: { todos: first, totalCount: 2 } } } }); await new Promise((r) => setTimeout(r, 20)); await d({ type: "tool-call-started", callId: "c4", toolCall: { type: "updateTodos", args: { todos: change } } }); await d({ type: "tool-call-completed", callId: "c4", toolCall: { type: "updateTodos", args: { todos: change }, result: { status: "success", value: { todos: now, totalCount: 3 } } } }); }
    // A sub-agent: its call's input streamed as its model writes it, then whole when it starts.
    if (/~task/.test(text)) { const args = { description: "explore the repo", prompt: "Find where the app starts", subagentType: { kind: "explore" }, model: "composer-2.5" }; await d({ type: "partial-tool-call", callId: "c5", toolCall: { type: "task", args: { description: "explore the repo", prompt: "Find wh" } } }); await d({ type: "tool-call-started", callId: "c5", toolCall: { type: "task", args } }); await d({ type: "tool-call-delta", callId: "c5", modelCallId: "m", taskUpdate: { type: "tool-call-started", callId: "c6", toolCall: { type: "read", args: { path: "src/index.js" } } } }); await d({ type: "tool-call-delta", callId: "c5", modelCallId: "m", taskUpdate: { type: "token-delta", tokens: 500 } }); await d({ type: "tool-call-delta", callId: "c5", modelCallId: "m", taskUpdate: { type: "turn-ended", usage: { inputTokens: 900, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 920 } } }); await d({ type: "tool-call-completed", callId: "c5", toolCall: { type: "task", args, result: { status: "success", value: { isBackground: false, backgroundReason: "unspecified", durationMs: 900 } } } }); }
    if (/~subsays/.test(text)) { const args = { description: "find the start", prompt: "Find where the app starts", subagentType: { kind: "explore" } }; const up = (taskUpdate) => d({ type: "tool-call-delta", callId: "c13", modelCallId: "m", taskUpdate }); await d({ type: "tool-call-started", callId: "c13", toolCall: { type: "task", args } }); await up({ type: "thinking-delta", text: "Where would it start? " }); await up({ type: "text-delta", text: "Looking at the entry file. " }); await up({ type: "tool-call-started", callId: "c14", toolCall: { type: "read", args: { path: "src/index.js" } } }); await up({ type: "text-delta", text: "It starts in " }); await up({ type: "text-delta", text: "src/index.js." }); await d({ type: "tool-call-completed", callId: "c13", toolCall: { type: "task", args, result: { status: "success", value: { isBackground: false, backgroundReason: "unspecified", durationMs: 900 } } } }); }
    if (/~subtodo/.test(text)) { const args = { description: "plan the fix", prompt: "Plan the fix for the bug", subagentType: { kind: "custom", name: "planner" } }; const todos = [{ content: "Find the bug", status: "inProgress" }]; await d({ type: "tool-call-started", callId: "c7", toolCall: { type: "task", args } }); await d({ type: "tool-call-delta", callId: "c7", modelCallId: "m", taskUpdate: { type: "tool-call-started", callId: "c8", toolCall: { type: "updateTodos", args: { todos } } } }); await d({ type: "tool-call-delta", callId: "c7", modelCallId: "m", taskUpdate: { type: "tool-call-completed", callId: "c8", toolCall: { type: "updateTodos", args: { todos }, result: { status: "success", value: { todos, totalCount: 1 } } } } }); await d({ type: "tool-call-completed", callId: "c7", toolCall: { type: "task", args, result: { status: "success", value: { isBackground: false, backgroundReason: "unspecified" } } } }); }
    // A sub-agent compacting its own context, inside its task.
    if (/~subcompact/.test(text)) { const args = { description: "look", prompt: "Look around", subagentType: { kind: "explore" } }; await d({ type: "tool-call-started", callId: "c11", toolCall: { type: "task", args } }); for (const type of ["summary-started", "summary-completed"]) await d({ type: "tool-call-delta", callId: "c11", modelCallId: "m", taskUpdate: { type } }); await d({ type: "tool-call-completed", callId: "c11", toolCall: { type: "task", args, result: { status: "success", value: { isBackground: false, backgroundReason: "unspecified" } } } }); }
    // An image it generates, saved in the working folder.
    if (/~image/.test(text)) { const args = { description: "a red square", filePath: "assets/red.png" }; await d({ type: "tool-call-started", callId: "c9", toolCall: { type: "generateImage", args } }); await d({ type: "tool-call-completed", callId: "c9", toolCall: { type: "generateImage", args, result: { status: "success", value: { filePath: `${agent._options.local?.cwd || "."}/assets/red.png`, imageData: "iVBORw0KGgo=" } } } }); }
    if (/~custom/.test(text)) { const tools = opts?.local?.customTools || agent._customTools || {}; const read = tools.Read; if (read) { const r = await read.execute({ path: "README.md" }, { toolCallId: "cu1" }); const t = typeof r === "string" ? r : r?.content?.[0]?.text || JSON.stringify(r); await d({ type: "text-delta", text: `custom-read:${String(t).trim().slice(0, 40)} ` }); } else await d({ type: "text-delta", text: "no-custom-tools " }); }
    // Filament's task graph's tool, a custom tool (HarnessV3-ACP AC4-5): one add, as Cursor reports a custom tool's
    // call, its words said back.
    if (/~graph/.test(text)) { const tasks = (opts?.local?.customTools || agent._customTools || {}).tasks; const toolCall = { type: "mcp", args: { providerIdentifier: "custom-user-tools", toolName: "tasks", args: {} } }; await d({ type: "tool-call-started", callId: "tk1", toolCall }); const r = tasks ? await tasks.execute({ action: "add", goal: "ship", tasks: [{ id: "a", name: "A" }] }, { toolCallId: "tk1" }) : null; await d({ type: "tool-call-completed", callId: "tk1", toolCall: { ...toolCall, result: { status: "success", value: {} } } }); await d({ type: "text-delta", text: `graph:${r == null ? "no tasks tool" : typeof r === "string" ? r : r?.content?.[0]?.text} ` }); }
    // Filament's show_visual, a custom tool (HarnessV4_Visuals_Plan E16): its input streamed as the model writes it, then
    // whole as it starts; its words said back.
    if (/~visual/.test(text)) { const show = (opts?.local?.customTools || agent._customTools || {}).show_visual; const input = { title: "flow", code: '<svg viewBox="0 0 10 10"></svg>' }; const call = (args) => ({ type: "mcp", args: { providerIdentifier: "custom-user-tools", toolName: "show_visual", args } }); await d({ type: "partial-tool-call", callId: "sv1", toolCall: call({ title: "flow" }) }); await d({ type: "tool-call-started", callId: "sv1", toolCall: call(input) }); const r = show ? await show.execute(input, { toolCallId: "sv1" }) : null; await d({ type: "tool-call-completed", callId: "sv1", toolCall: { ...call(input), result: { status: "success", value: {} } } }); await d({ type: "text-delta", text: `visual:${r == null ? "no show_visual" : typeof r === "string" ? r : r?.content?.[0]?.text} ` }); }
    if (text.startsWith("[Filament: this conversation has reached its compaction line.")) {
      const tasks = (opts?.local?.customTools || agent._customTools || {}).tasks;
      if (tasks) { const r = await tasks.execute({ action: "add", goal: "ship", tasks: [{ id: "a", name: "A" }] }, { toolCallId: "sum1" }); log({ event: "summary-tool", agentId: agent.agentId, text: typeof r === "string" ? r : r?.content?.[0]?.text }); }
      await d({ type: "text-delta", text: "<analysis>Going through it.</analysis>\n" });
      await d({ type: "text-delta", text: `<summary>The agent heard ${agent._turns - 1} message(s) before this one</summary>` });
      await turnEnded({ inputTokens: 40, outputTokens: 30, cacheReadTokens: 900, cacheWriteTokens: 0, totalTokens: 970 });
      this.usage = { ...billed }; this.result = "summary written"; this.status = "finished";
      this._finish({ id: this.id, status: "finished", result: this.result, usage: this.usage, model: this.model, durationMs: 50 });
      return;
    }
    // A command through Filament's Bash, the run waiting on it as Cursor's does; what the tool answered is logged, whenever it does.
    if (/~bash:/.test(text)) { const command = (/~bash:([\s\S]*?)~/.exec(text) || [])[1] || ""; const bash = (opts?.local?.customTools || agent._customTools || {}).Bash; const r = bash ? await bash.execute({ command }, { toolCallId: "cb1" }) : "no Bash tool"; log({ event: "bash", agentId: this.agentId, result: typeof r === "string" ? r : r?.content?.[0]?.text }); await d({ type: "text-delta", text: "ran it " }); }
    // A call that comes long after: the run waits for the test's word, then writes through Filament's Write.
    if (/~late/.test(text)) { for (let i = 0; i < 750 && !existsSync(process.env.FAKE_SDK_LATE || ""); i++) await new Promise((r) => setTimeout(r, 20)); const write = (opts?.local?.customTools || agent._customTools || {}).Write; const r = write ? await write.execute({ path: "late.txt", content: "late\n" }, { toolCallId: "lw1" }) : "no Write tool"; log({ event: "late", agentId: this.agentId, result: typeof r === "string" ? r : r?.content?.[0]?.text }); }
    if (/~followup/.test(text)) { await d({ type: "text-delta", text: "working… " }); this._handsBack = true; return; } // silent until steer() or cancel()
    if (/~hang/.test(text)) { await d({ type: "text-delta", text: "working… " }); return; } // silent until cancel()
    // `~nousage`: two model calls, each ended with its usage, in a run whose result names none; `~fail-spent`: the same
    // two, then the run fails; `~waitbreaks`: the same two, then the run's wait throws, as the SDK's does when its stream
    // breaks off.
    if (/~nousage|~fail-spent|~waitbreaks/.test(text)) {
      await d({ type: "text-delta", text: "two calls " });
      await turnEnded({ inputTokens: 300, outputTokens: 10, cacheReadTokens: 200, cacheWriteTokens: 0, totalTokens: 510 });
      await turnEnded({ inputTokens: 400, outputTokens: 20, cacheReadTokens: 300, cacheWriteTokens: 0, totalTokens: 720 });
      if (/~fail-spent/.test(text)) { this.status = "error"; this.error = { message: "model overloaded", code: "resource_exhausted" }; this._finish({ id: this.id, status: "error", error: this.error }); return; }
      if (/~waitbreaks/.test(text)) { this.status = "error"; this._break(Object.assign(new Error("the run's stream broke off"), { name: "NetworkError" })); return; }
      this.result = "two calls"; this.status = "finished"; this._finish({ id: this.id, status: "finished", result: this.result, model: this.model, durationMs: 50 }); return;
    }
    if (/~fail/.test(text)) { this.status = "error"; this.error = { message: "model overloaded", code: "resource_exhausted" }; this._finish({ id: this.id, status: "error", error: this.error }); return; }
    // `~fills <n>`: what it reads appends n tokens to its context, as a long file read does.
    const fills = /~fills (\d+)/.exec(text);
    if (fills) await d({ type: "token-delta", tokens: Number(fills[1]) });
    await d({ type: "text-delta", text: `echo(${agent._turns}): ` }); await d({ type: "text-delta", text: text.slice(-60) }); await d({ type: "token-delta", tokens: 30 });
    await turnEnded({ inputTokens: 120, outputTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 0, totalTokens: 250 });
    const usage = { ...billed }; // the run's usage: every model call summed, as the real SDK reports it
    this.usage = usage; this.result = `echo(${agent._turns}): ${text.slice(-60)}`; this.status = "finished";
    this._finish({ id: this.id, status: "finished", result: this.result, usage, model: this.model, durationMs: 50 });
  }
  async *stream() { /* Filament streams through onDelta */ }
  wait() { return this._done; }
  async steer(text) { const takes = this.status === "running" && !this._handsBack && !/~nosteer/.test(text); log({ event: "steer", agentId: this.agentId, id: this.id, text, takes }); if (!takes) { if (this._handsBack && this.status === "running") setTimeout(() => { if (this.status !== "running") return; this.result = "handed back"; this.status = "finished"; this._finish({ id: this.id, status: "finished", result: this.result, model: this.model, durationMs: 50 }); }, 5); return "revert_to_followup"; } await this._onDelta?.({ update: { type: "text-delta", text: `heard:${text} ` } }); this.result = `heard:${text}`; this.status = "finished"; this._finish({ id: this.id, status: "finished", result: this.result, model: this.model, durationMs: 50 }); return "complete_delivered"; }
  async cancel() { log({ event: "cancel", agentId: this.agentId, id: this.id }); this._cancelled = true; this.status = "cancelled"; this._finish({ id: this.id, status: "cancelled" }); }
  onDidChangeStatus() { return () => {}; }
  supports(op) { return !(this._noCancel && op === "cancel"); }
}
/** The MCP servers an agent was given, by name, and the folders it may read besides its own: each only when there are some. */
const given = (o) => ({ ...(o.mcpServers && Object.keys(o.mcpServers).length ? { mcpServers: Object.keys(o.mcpServers) } : {}), ...(o.local?.dirs?.length ? { dirs: o.local.dirs } : {}) });
class FakeAgent {
  constructor(agentId, options) { this.agentId = agentId; this.model = options.model; this._options = options; this._turns = 0; this._customTools = options.local?.customTools || null; }
  async send(message, options = {}) { checkKey(this._options.apiKey); const sent = typeof message === "string" ? message : message.text; const txt = personWords(sent); const wedged = /~busy/.test(txt) && !this._busyThrown; if ((wedged || this._run?.status === "running") && !options.local?.force) { if (wedged) this._busyThrown = true; const e = new Error("agent has an active run"); e.name = "AgentBusyError"; throw e; } if (process.env.FAKE_SDK_OVERFLOW_SEEDED && /Earlier conversation \(from another assistant/.test(sent)) { const e = new Error("Your conversation exceeds the context window of this model"); e.name = "CursorAgentError"; e.isRetryable = false; throw e; } const latest = (/(?:^|\n)Latest user message:\n\n([\s\S]*)$/.exec(txt) || [])[1] || txt; if (/~nostart/.test(latest)) { const e = new Error("cursor unreachable"); e.name = "CursorAgentError"; e.isRetryable = false; throw e; } if (/~retry/.test(latest) && !this._retried) { this._retried = true; const e = new Error("transport stalled"); e.name = "CursorAgentError"; e.isRetryable = true; throw e; } if (this._run?.status === "running") await this._run.cancel(); this._turns++; const text = txt; log({ event: "send", agentId: this.agentId, text, prompt: sent, images: typeof message === "string" ? 0 : (message.images || []).length, model: options.model || null, mode: options.mode || null, customTools: Object.keys(this.#tools(options)) }); if (options.model) this.model = options.model; if (/~slowsend/.test(text)) await new Promise((r) => setTimeout(r, 1500)); return (this._run = new FakeRun(this, text, { ...options, local: { customTools: this.#tools(options) } })); }
  /** The custom tools a message's run has: the message's, else the agent's — none where its options leave `mcp` out. */
  #tools(options) { return offersMcp(this._options) ? options.local?.customTools || this._customTools || {} : {}; }
  close() { log({ event: "close", agentId: this.agentId }); }
  async reload() {}
  async getUsage() { return { usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0 }, runs: [] }; }
}
export class Agent {
  static async create(options) { checkKey(options.apiKey); if (!options.model?.id) { const e = new Error("model is required for local agents"); e.name = "ConfigurationError"; throw e; } protoTools(options.tools, "tools"); protoTools(options.disallowedTools, "disallowedTools"); const id = `agent-${Math.random().toString(36).slice(2, 10)}`; const a = new FakeAgent(id, options); agents.set(id, { agent: a, name: options.name || "", cwd: options.local?.cwd || null, at: Date.now() }); log({ event: "create", agentId: id, model: options.model, mode: options.mode || null, cwd: options.local?.cwd || null, tools: options.tools || null, disallowedTools: options.disallowedTools || null, customTools: Object.keys(options.local?.customTools || {}), name: options.name || null, ...given(options) }); if (process.env.FAKE_SDK_SLOW_CREATE_MS) await new Promise((r) => setTimeout(r, Number(process.env.FAKE_SDK_SLOW_CREATE_MS))); return a; }
  static async resume(agentId, options = {}) { checkKey(options.apiKey); const rec = agents.get(agentId); if (!rec || rec.cwd !== (options.local?.cwd ?? process.cwd())) { const e = new Error(`agent ${agentId} not found`); e.name = "AgentNotFoundError"; throw e; } protoTools(options.tools, "tools"); protoTools(options.disallowedTools, "disallowedTools"); log({ event: "resume", agentId, model: options.model || null, tools: options.tools || null, disallowedTools: options.disallowedTools || null, customTools: Object.keys(options.local?.customTools || {}), ...given(options) }); rec.agent._options = { ...rec.agent._options, ...options, tools: options.tools, disallowedTools: options.disallowedTools }; rec.agent._customTools = options.local?.customTools || rec.agent._customTools; return rec.agent; }
  static async list(options = {}) { checkKey(options.apiKey); const where = options.cwd ?? process.cwd(); return { items: [...agents.entries()].filter(([, r]) => r.cwd === where).map(([agentId, r]) => ({ agentId, name: r.name || "untitled", summary: "", lastModified: r.at })) }; }
  static async prompt() { throw new Error("not used"); }
}
export class Cursor {
  static async me({ apiKey } = {}) { checkKey(apiKey); log({ event: "me" }); if (minted.has(apiKey)) return { apiKeyName: minted.get(apiKey), userId: 3, userEmail: "work@example.com", createdAt: "2026-10-08T00:00:00Z" }; if (apiKey === SLOW_ME_KEY) { await new Promise((r) => setTimeout(r, 800)); return { apiKeyName: "slow key", userId: 2, userEmail: "ops@example.com", createdAt: "2026-09-02T00:00:00Z" }; } return { apiKeyName: "Filament test key", userId: 1, userEmail: "dev@example.com", createdAt: "2026-09-01T00:00:00Z" }; }
  static models = { list: async ({ apiKey } = {}) => { checkKey(apiKey); return MODELS; } };
  static auth = {
    login: async ({ store, openBrowser, apiKeyName, signal, onLoginUrl } = {}) => {
      log({ event: "login", store: store === null ? null : typeof store, openBrowser, apiKeyName: apiKeyName || null });
      onLoginUrl?.("https://cursor.example.test/loginDeepControl?challenge=fake");
      const ms = process.env.FAKE_SDK_LOGIN === "wait" ? 3_600_000 : Number(process.env.FAKE_SDK_LOGIN_MS || 150);
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { clearTimeout(t); const e = new Error("login aborted"); e.name = "AuthenticationError"; reject(e); }, { once: true });
      });
      const apiKey = `ck-minted-${minted.size + 1}`;
      minted.set(apiKey, apiKeyName || "SDK login");
      return { apiKey, email: "work@example.com", apiKeyExpiresAtMs: Date.now() + 90 * 86400_000 };
    },
    logout: async () => {},
    status: async () => ({ status: "logged-out" }),
  };
}

// @ts-check
// HarnessV3-AtHome P2 step 6 (HarnessV3-Views V1): a session switches into a team, and back. Each turn is stamped with
// the engine that opened it. Composed under one engine, the turns the other engine made are rebuilt against the tools
// in force when every call translates, and folded whole when one cannot: a sub-agent's launch either way — the two
// engines' agent tools share a name and nothing else. (A write folded under a lead too, until HarnessV4_Tasks decision 9
// gave a lead every hand.) So the provider's cache breaks once, at the switch, and holds after it; back with your
// agent, the history it had before the switch comes back as it was. The session's transcript carries each turn's
// engine, for its dividers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { removeDirs } from "./helpers/wait.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Archive } from "../src/archive.js";
import { PROMPT } from "../src/app/agent/prompt.js";
import { loopToolArgs } from "../src/app/agent/tools.js";
import { turnEngine } from "../src/app/engine.js";
import { adaptTurn } from "../src/core/turn-adapter.js";
import { anthropicReply, fakeUpstream, startApp } from "./helpers/app.js";

/** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
let up;
/** @type {Awaited<ReturnType<typeof startApp>>} */
let shim;
/** @type {string} */
let folder;
/** The archives the stamp test opened, and their folders. @type {{ a: any, dir: string }[]} */
const opened = [];

const SCOUT = { role: "scout", description: "Map the folder", goal: "know what is here", steps: ["List the files"], acceptance: "every file is named" };
const BUILDERS = { kind: "team", team: "builders", name: "Builders" };
const LOOP = { kind: "loop" };

/** @param {any} b */
const sysOf = (b) => (Array.isArray(b?.system) ? b.system.map((/** @type {any} */ x) => x?.text ?? "").join("\n") : String(b?.system || ""));
/** @param {any} content */
const textOf = (content) => (typeof content === "string" ? content : (content || []).filter((/** @type {any} */ b) => b?.type === "text").map((/** @type {any} */ b) => b.text).join(""));
const isLead = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.leadRole));
const isSolo = (/** @type {any} */ c) => sysOf(c.body).includes(String(PROMPT.role));
/** What the conversation holds from the newest typed message on: the turn the model is answering, so far. @param {any[]} messages */
const turnSoFar = (messages) => {
  let at = 0;
  messages.forEach((m, i) => {
    if (m?.role === "user" && /TURN: /.test(textOf(m.content))) at = i;
  });
  return JSON.stringify(messages.slice(at));
};
/** The request that opened a turn: its last message is the typed one, before any tool ran. @param {any} c @param {string} typed */
const opens = (c, typed) => {
  const last = c.body?.messages?.at(-1);
  return last?.role === "user" && Array.isArray(last.content) && last.content.some((/** @type {any} */ b) => b?.type === "text" && b.text === typed) && !last.content.some((/** @type {any} */ b) => b?.type === "tool_result");
};
/** A request's messages as the provider's cache reads them: the markers saying where to cache are no part of the prefix. @param {any} body */
const bare = (body) => /** @type {any[]} */ (JSON.parse(JSON.stringify(body.messages, (k, v) => (k === "cache_control" ? undefined : v))));
/** Where two requests' messages first differ. @param {any} a @param {any} b */
const firstDiff = (a, b) => {
  const x = bare(a);
  const y = bare(b);
  let i = 0;
  while (i < x.length && i < y.length && JSON.stringify(x[i]) === JSON.stringify(y[i])) i++;
  return i;
};
/** Whether `b` begins with every message of `a`: the cache `a` wrote serves `b`. @param {any} a @param {any} b */
const extendsIt = (a, b) => firstDiff(a, b) === bare(a).length;
/** The tool calls a request's history carries, by id. @param {any} body */
const callIds = (body) => body.messages.flatMap((/** @type {any} */ m) => (Array.isArray(m.content) ? m.content : []).filter((/** @type {any} */ b) => b?.type === "tool_use").map((/** @type {any} */ b) => b.id));
/** The assistant text that follows the typed message `typed` in a request. @param {any} body @param {string} typed */
const replyTo = (body, typed) => {
  const at = body.messages.findIndex((/** @type {any} */ m) => m.role === "user" && textOf(m.content) === typed);
  return textOf(body.messages[at + 1]?.content);
};
/** The thinking a request's history carries. @param {any} body */
const thoughts = (body) =>
  body.messages.flatMap((/** @type {any} */ m) => (m.role === "assistant" && Array.isArray(m.content) ? m.content : []).filter((/** @type {any} */ b) => b?.type === "thinking").map((/** @type {any} */ b) => b.thinking));
/** The request among `calls` that opened a turn. @param {any[]} calls @param {string} typed @param {(c: any) => boolean} by */
const opening = (calls, typed, by) => {
  const c = calls.find((x) => by(x) && opens(x, typed));
  assert.ok(c, `no request opened "${typed}"`);
  return c.body;
};

before(async () => {
  folder = mkdtempSync(join(tmpdir(), "filament-team-switch-"));
  const git = (/** @type {string[]} */ ...args) => execFileSync("git", args, { cwd: folder, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(folder, "a.txt"), "one\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  up = await fakeUpstream(async (call) => {
    const b = call.body || {};
    const system = sysOf(b);
    const now = turnSoFar(b.messages || []);
    const model = String(b.model || "");
    const blocks = (/** @type {any[]} */ list, stop = "end_turn") => anthropicReply("", { model, stop, blocks: list, usage: { input_tokens: 5, output_tokens: 3 } });
    const say = (/** @type {string} */ text) => blocks([{ type: "text", text }]);
    const use = (/** @type {string} */ id, /** @type {string} */ name, /** @type {any} */ input) => blocks([{ type: "tool_use", id, name, input }], "tool_use");
    if (system.includes(String(PROMPT.subagentRole))) return say("HELPER REPORT: a.txt says one.");
    if (system.includes(String(PROMPT.workerRole))) return say("SCOUT REPORT: a.txt is here.");
    if (system.includes(String(PROMPT.leadRole))) {
      if (now.includes("TURN: scout it")) {
        if (/\[Filament: your scout sa_[0-9a-f]{8}/.test(now)) return say("LEAD SAW THE SCOUT");
        if (/Launched scout sa_/.test(now)) return use("toolu_wait", "wait", { seconds: 60 });
        return use("toolu_scout", "agent", SCOUT);
      }
      return say("LEAD ANSWER");
    }
    if (system.includes(String(PROMPT.role))) {
      if (now.includes("TURN: look at a")) return now.includes("toolu_read_a") ? say("SOLO READ: a.txt says one.") : use("toolu_read_a", "read", { path: "a.txt" });
      if (now.includes("TURN: write the note")) return now.includes("toolu_write") ? say("SOLO WROTE") : use("toolu_write", "write", { path: "note.txt", content: "hi\n" });
      if (now.includes("TURN: ask a helper"))
        return now.includes("toolu_helper") ? say("SOLO HEARD THE HELPER") : use("toolu_helper", "agent", { run_in_background: false, description: "Read a", prompt: "Read a.txt and say what it holds.", subagent_type: "scout" });
      return say("SOLO AGAIN");
    }
    // The model alone, the loop off: it thinks before it answers.
    if (now.includes("TURN: think first")) return blocks([{ type: "thinking", thinking: "PLAIN THOUGHT", signature: "sig-plain" }, { type: "text", text: "MODEL ANSWER" }]);
    return say("MODEL ANSWER");
  });
  shim = await startApp({
    memory: true,
    configure: (/** @type {any} */ cfg) => {
      cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true, pricing: { "m-1": { input: 1, output: 1, contextTokens: 200000 } } }];
      cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
      cfg.agentLoop = { enabled: true, permissions: "edit", roots: [folder], readerModel: "" };
      cfg.memory.autopilot = { enabled: false };
    },
  });
});
after(async () => {
  for (const { a } of opened) a.close();
  await shim.stop();
  await up.close();
  // A process just stopped may still hold a folder a moment (EPERM, seen at the full suite's concurrency).
  await removeDirs(...opened.map((o) => o.dir), folder, shim.dataDir);
});

/** One harness turn, answered whole. @param {string} id @param {string} content */
const turn = async (id, content) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/turns`, { method: "POST", body: { content, stream: false } });
  assert.equal(r.status, 200, await r.clone().text());
  return textOf((await r.json()).content);
};
/** A change to the session's document. @param {string} id @param {any} change */
const settle = async (id, change) => {
  const r = await shim.api(`/api/sessions/${encodeURIComponent(id)}/settings`, { method: "PATCH", body: change });
  assert.equal(r.status, 200, await r.clone().text());
};

// (fails before: yes — adaptTurn had no `madeWith`: a call passed by name to any declared tool of that name, so the
// loop's sub-agent launch rode under the lead's agent tool, unfit for its schema, and a lead's under the loop's)
test("the other engine's calls: rebuilt by kind against the tools in force, and passed by name only to the very tool that took them", () => {
  const tools = (/** @type {any[]} */ set) => set.map((t) => ({ name: t.name, schema: t.input_schema }));
  const SOLO = tools(loopToolArgs({ graph: true }));
  const LEAD = tools(loopToolArgs({ lead: true, graph: true }));
  /** A turn of one call and its result. @param {string} name @param {any} input */
  const one = (name, input) => ({
    user: { role: "user", content: [{ type: "text", text: "go" }] },
    work: [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name, input }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ],
    final: { role: "assistant", content: [{ type: "text", text: "back" }] },
  });
  const launch = one("agent", { description: "Read a", prompt: "Read a.txt", subagent_type: "scout" });
  assert.equal(adaptTurn(launch, { tools: LEAD }).mode, "translated", "another window's turn: D6's rule, a name the request declares passes");
  const underLead = adaptTurn(launch, { tools: LEAD, madeWith: SOLO });
  assert.deepEqual([underLead.mode, underLead.reason], ["folded", "tool calls with no equivalent here (agent)"], "the loop's launch under the lead's agent tool");
  const order = one("agent", SCOUT);
  assert.equal(adaptTurn(order, { tools: SOLO, madeWith: LEAD }).mode, "folded", "a lead's order under the loop's agent tool");
  assert.equal(adaptTurn(one("worker", { agent_id: "sa_00000001", stop: true }), { tools: SOLO, madeWith: LEAD }).mode, "folded", "the loop has no worker tool");
  assert.equal(adaptTurn(one("tasks", { action: "add", goal: "g", tasks: [{ id: "t1", by: "sub-agent", writes: ["a.txt"] }] }), { tools: LEAD, madeWith: SOLO }).mode, "folded", "the graph's tool takes other fields from a lead");
  // A lead has every hand since HarnessV4_Tasks decision 9: the loop's writes and commands ride under it as made.
  for (const [name, input] of /** @type {[string, any][]} */ ([
    ["read", { path: "a.txt" }],
    ["write", { path: "n.txt", content: "hi" }],
    ["bash", { command: "node -v" }],
    ["grep", { pattern: "one" }],
    ["glob", { pattern: "*.txt" }],
    ["plan", { items: [{ text: "look", status: "done" }] }],
    ["ask", { question: "Which side?" }],
    ["wait", { seconds: 60 }],
  ])) {
    const out = adaptTurn(one(name, input), { tools: LEAD, madeWith: SOLO });
    assert.equal(out.mode, "translated", `${name}: the same tool on both sides`);
    assert.deepEqual(out.messages[1].content[0], { type: "tool_use", id: "t1", name, input }, `${name}: its call rides as it was made`);
  }
});

/** An archive of its own. */
const open = () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-team-switch-db-"));
  const a = /** @type {any} */ (new Archive({ file: join(dir, "a.db") }));
  opened.push({ a, dir });
  return a;
};
const user = (/** @type {string} */ text) => ({ role: "user", content: [{ type: "text", text }] });
const final = (/** @type {string} */ text) => ({ role: "assistant", content: [{ type: "text", text }] });

// (fails before: yes — a turn said its window and its wire format, and nothing of who answered it)
test("each turn is stamped with the engine that opened it — the loop alone, or a team's lead and its name then — and a leg of the turn keeps it", () => {
  const teams = { find: (/** @type {unknown} */ k) => (k === "builders" ? { key: "builders", name: "Builders" } : null) };
  assert.deepEqual(turnEngine({ model: "m-1" }, teams), LOOP);
  assert.deepEqual(turnEngine({ model: "m-1", team: "builders" }, teams), BUILDERS);
  assert.equal(turnEngine(null, teams), null, "a model answers the turn, or a coding agent runs its own: no loop, no stamp");
  // (fails before: yes — the real team of 11-11 on Claude Code: a turn its lead answered carried no stamp, so a reload
  // drew no "took over" divider and no lead's signature, and the Team view said Leading: next turn after it had led)
  assert.deepEqual(turnEngine(null, teams, { team: "builders" }), BUILDERS, "a coding agent that leads the chat's team: the team's stamp, as the loop lead's");
  assert.deepEqual(turnEngine({ model: "m-1" }, teams, null), LOOP);
  const a = open();
  const c = a.chainForKey("h:switch", { client: "harness", cwd: "C:\\w" });
  const stamps = { client: "harness", window: "harness", format: "anthropic" };
  const first = a.beginTurn(c.id, { ...stamps, engine: LOOP, userMessage: user("first") });
  const leg = a.beginTurn(c.id, { ...stamps, engine: BUILDERS, userMessage: user("first") });
  assert.deepEqual([leg.isNew, leg.turnId], [false, first.turnId], "the same message: another leg of the turn");
  a.finishTurn(first.turnId, { finalMessage: final("one") });
  const second = a.beginTurn(c.id, { ...stamps, engine: BUILDERS, userMessage: user("second") });
  a.finishTurn(second.turnId, { finalMessage: final("two") });
  const third = a.beginTurn(c.id, { ...stamps, userMessage: user("third") });
  a.finishTurn(third.turnId, { finalMessage: final("three") });
  assert.deepEqual(a.getTurns(c.id).map((/** @type {any} */ t) => t.meta?.engine ?? null), [LOOP, BUILDERS, null]);
});

// (fails before: yes — the lead's request carried the loop's writes and its sub-agent's launch as calls to tools the
// lead does not have or has otherwise, and back under the loop the lead's orders rode as calls to its agent tool; the
// turns said nothing of their engine)
test("a session hands its turns to the Builders team and takes them back: each engine reads the other's turns its own way, the cache breaks once at each switch and holds after it, and the transcript says who answered each turn", async () => {
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  const mark = up.received.length;
  assert.equal(await turn(id, "TURN: look at a"), "SOLO READ: a.txt says one.");
  assert.equal(await turn(id, "TURN: write the note"), "SOLO WROTE");
  assert.equal(await turn(id, "TURN: ask a helper"), "SOLO HEARD THE HELPER");
  await settle(id, { patch: { engine: { mode: "team", team: "builders" } } });
  assert.equal(await turn(id, "TURN: scout it"), "LEAD SAW THE SCOUT");
  assert.equal(await turn(id, "TURN: anything else?"), "LEAD ANSWER");
  await settle(id, { unset: ["engine.mode", "engine.team"] });
  assert.equal(await turn(id, "TURN: and now?"), "SOLO AGAIN");
  assert.equal(await turn(id, "TURN: once more"), "SOLO AGAIN");
  const calls = up.received.slice(mark);
  const s3 = opening(calls, "TURN: ask a helper", isSolo);
  const l4 = opening(calls, "TURN: scout it", isLead);
  const l5 = opening(calls, "TURN: anything else?", isLead);
  const s6 = opening(calls, "TURN: and now?", isSolo);
  const s7 = opening(calls, "TURN: once more", isSolo);

  // Under the lead: the turns that read and wrote translate, call for call — a lead has every hand since HarnessV4_Tasks
  // decision 9 — and the sub-agent's launch folds whole, its words kept.
  for (const kept of ["toolu_read_a", "toolu_write"]) assert.ok(callIds(l4).includes(kept), `${kept} rides as a call`);
  assert.ok(!callIds(l4).includes("toolu_helper"), "toolu_helper is folded");
  const helperFold = replyTo(l4, "TURN: ask a helper");
  assert.ok(helperFold.startsWith("[Filament folded this turn: 1 tool call shown one line each — re-run a tool if you need its output]\n⚙ agent ") && helperFold.endsWith("\nSOLO HEARD THE HELPER"), helperFold);

  // The cache: the switch breaks it where the first folded turn begins — the read and the write before it are the
  // same bytes — and the lead's next request carries the first one's whole.
  const asked = bare(s3).findIndex((m) => m.role === "user" && textOf(m.content) === "TURN: ask a helper");
  assert.equal(firstDiff(s3, l4), asked + 1, "the first difference is the helper's turn, folded");
  assert.ok(extendsIt(l4, l5), "the lead's second request begins with its first");
  assert.deepEqual([sysOf(l5), JSON.stringify(l5.tools)], [sysOf(l4), JSON.stringify(l4.tools)]);

  // Back with your agent: the lead's order folds, the reports it received kept as it read them; the loop's own turns
  // ride as they were made, so the request it sent before the switch is where this one begins.
  assert.ok(!callIds(s6).includes("toolu_scout") && !callIds(s6).includes("toolu_wait"), "the lead's calls are folded");
  const led = replyTo(s6, "TURN: scout it");
  // The report reaches the lead in the round after its launch or after its wait, as the scout's timing falls.
  assert.ok(/^\[Filament folded this turn: [12] tool calls? shown one line each — re-run a tool if you need its output\]\n⚙ agent /.test(led) && led.includes("SCOUT REPORT: a.txt is here.") && led.endsWith("\nLEAD SAW THE SCOUT"), led);
  for (const back of ["toolu_read_a", "toolu_write", "toolu_helper"]) assert.ok(callIds(s6).includes(back), `${back} rides as it was made`);
  assert.ok(extendsIt(s3, s6), "the history before the switch comes back byte for byte");
  assert.ok(extendsIt(s6, s7), "and holds after the switch back");
  assert.deepEqual([sysOf(s7), JSON.stringify(s7.tools)], [sysOf(s3), JSON.stringify(s3.tools)]);

  // The transcript: who answered each turn.
  const { turns } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(
    turns.map((/** @type {any} */ t) => [textOf(t.user?.content), t.engine ?? null]),
    [
      ["TURN: look at a", LOOP],
      ["TURN: write the note", LOOP],
      ["TURN: ask a helper", LOOP],
      ["TURN: scout it", BUILDERS],
      ["TURN: anything else?", BUILDERS],
      ["TURN: and now?", LOOP],
      ["TURN: once more", LOOP],
    ],
  );
});

// (fails before: yes — a team's lead read every turn of its window as it was stored, the model's thinking with it; the
// mutation pass asked for the case: nothing told a turn no engine stamped from a lead's own)
test("a turn no loop answered — the model's own, before the loop was on — counts as the loop's: under your agent it rides as it was made, its thinking kept as the session keeps it; a team's lead reads it rebuilt, as it reads every turn it did not make", async () => {
  /**
   * Whether the loop runs the chat's model. The loop is always on (the owner's of 11-09) and runs a route whose own
   * upstream is on: off, the route's upstream is one switched off, and its fallback answers the model's own turn.
   * @param {boolean} on
   */
  const loopOn = async (on) => {
    const st = await (await shim.api("/api/state")).json();
    const m = st.config.upstreams.find((/** @type {any} */ u) => u.id === "m");
    const upstreams = on ? st.config.upstreams.filter((/** @type {any} */ u) => u.id !== "off") : [...st.config.upstreams, { id: "off", name: "off", type: "anthropic", baseUrl: m.baseUrl, enabled: false }];
    const routes = st.config.routes.map((/** @type {any} */ rt) => (rt.match !== "m-*" ? rt : on ? { ...rt, upstream: "m", fallbacks: [] } : { ...rt, upstream: "off", fallbacks: [{ upstream: "m", upstreamModel: "{model}" }] }));
    // The fallback is tried: off until switched on (the owner's of 11-09).
    const rules = { ...st.config.rules, resilience: { ...st.config.rules?.resilience, failover: true } };
    const r = await shim.api("/api/config", { method: "PUT", body: { ...st.config, upstreams, routes, rules } });
    assert.equal(r.status, 200, await r.clone().text());
  };
  await loopOn(false);
  const r = await shim.api("/api/sessions", { method: "POST", body: { cwd: folder, model: "m-1", preset: "plain" } });
  assert.equal(r.status, 200, await r.clone().text());
  const id = String((await r.json()).id);
  await settle(id, { patch: { model: { thinking: { keepInHistory: true } } } });
  const mark = up.received.length;
  assert.equal(await turn(id, "TURN: think first"), "MODEL ANSWER");
  await loopOn(true);
  assert.equal(await turn(id, "TURN: now with the loop"), "SOLO AGAIN");
  await settle(id, { patch: { engine: { mode: "team", team: "builders" } } });
  assert.equal(await turn(id, "TURN: now with the lead"), "LEAD ANSWER");
  const calls = up.received.slice(mark);
  const solo = opening(calls, "TURN: now with the loop", isSolo);
  const lead = opening(calls, "TURN: now with the lead", isLead);
  const thought = bare(solo).find((m) => m.role === "assistant" && thoughts({ messages: [m] }).length);
  assert.deepEqual(thought, { role: "assistant", content: [{ type: "thinking", thinking: "PLAIN THOUGHT", signature: "sig-plain" }, { type: "text", text: "MODEL ANSWER" }] }, "under your agent the model's turn rides as it was made");
  assert.deepEqual(thoughts(lead), [], "no thinking rides a rebuilt turn");
  assert.equal(replyTo(lead, "TURN: think first"), "MODEL ANSWER", "its words translate, unfolded");
  const { turns } = await (await shim.api(`/api/sessions/${encodeURIComponent(id)}/transcript`)).json();
  assert.deepEqual(turns.map((/** @type {any} */ t) => t.engine ?? null), [null, LOOP, BUILDERS], "the model's turn: no loop, no stamp");
});

// @ts-check
// A chat another machine's agents start here works in its folder, under this machine's mode, and reaches nothing else of
// the person's (the security review of the remote-agents plan): Filament's own tools that reach past its folder — the
// person's artifacts and their databases, the project's Space, a come-back, the browser, skills, MCP servers — are not
// offered it, and a call to one is refused; the agent tool takes no `machine` there, whatever this Filament keeps for
// its own agents; its grant `agents` switched off stops its turn and its sub-agents as a revoke does, and Filament
// starts no turn of its own there after; its "/allow" answers a waiting permission as Deny; a chat its message tags is
// not its agent's to write letters to. Its prompt holds its folder's instruction files, never the person's own; its
// grant switched off ends its background commands, with what each started, and its task graph's command runs, and its
// graph starts nothing by itself after; Filament's own command line is no read for it, so Ask mode asks before it runs.
// Two real Filaments (helpers/two-machines.js): `here`'s full device mints the agents' device on `there`, whose own
// computer switches its grant on and starts the person's chats.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";
import { startTwoMachines } from "./helpers/two-machines.js";
import { FAKE_ACP_AGENT, FIXTURES, anthropicReply, fakeUpstream } from "./helpers/app.js";
import { planToolset } from "../src/adapters/agents/acp/toolset.js";
import { readProfile } from "../src/adapters/agents/acp/profile.js";
import { AcpBridge } from "../src/adapters/agents/acp/bridge.js";
import { CodexBridge } from "../src/adapters/agents/codex/bridge.js";
import { CursorSdkBridge } from "../src/adapters/agents/cursor-sdk.js";
import { COMPACTION_HEADER } from "../src/adapters/agents/compactions.js";
import { confirmedOf } from "../src/core/catalogues.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { peekShellExits, runningShellsOf, tellLater, wakeDue } from "../src/adapters/tools/hands.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { TIME_WAKE_LINE } from "../src/app/sessions/wake.js";
import { scaledMs } from "./helpers/wait.js";

const JSON_TYPE = { "content-type": "application/json" };
/** Filament's own loop on the model: a chat's tools and asks are its. */
const MODEL = "agent/m-1";
/** A stretch, for what must not happen meanwhile or the most a thing is given, as long as a busy machine needs (`scaledMs`). @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, scaledMs(ms)));

/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : "")).join(""));
/** @param {any} m */
const resultsOf = (m) =>
  (Array.isArray(m?.content) ? m.content : [])
    .filter((/** @type {any} */ b) => b?.type === "tool_result")
    .map((/** @type {any} */ b) => (typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x?.text ?? "").join("")));

/**
 * Each call the model behind the chats took: its conversation's first words and newest, the tools it was offered, the
 * results it was handed, and its system prompt.
 * @type {{ first: string, last: string, tools: any[], results: string[], system: string }[]}
 */
const calls = [];
/** @param {string} name @param {any} input */
const use = (name, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `c${calls.length}`, name, input }] });
/**
 * The model: `CALLS<<[[name, input], …]>>` makes those calls, one a round, then answers; `MAINSPIN` launches a sub-agent
 * told `KIDSPIN`, then lists files round after round, as does that sub-agent, until a message of the chat says `HALT`;
 * anything else is answered in words.
 * @param {any} call
 */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const msgs = call.body.messages || [];
  const first = textOf(msgs[0]);
  const rounds = msgs.filter((/** @type {any} */ m) => m.role === "assistant").length;
  calls.push({ first, last: textOf(msgs.at(-1)), tools: call.body.tools || [], results: resultsOf(msgs.at(-1)), system: JSON.stringify(call.body.system ?? "") });
  // A spin goes on until a message says HALT.
  const halted = msgs.some((/** @type {any} */ m) => m.role === "user" && textOf(m).includes("HALT"));
  if (!halted && (first.includes("KIDSPIN") || (first.includes("MAINSPIN") && rounds > 0))) {
    await sleep(150);
    return use("glob", { pattern: `*${rounds}*` });
  }
  if (!halted && first.includes("MAINSPIN")) return use("agent", { description: "Spin there", prompt: "KIDSPIN: list the files, again and again.", run_in_background: true });
  const at = first.indexOf("CALLS<<");
  if (at >= 0) {
    const list = JSON.parse(first.slice(at + 7, first.indexOf(">>", at)));
    if (rounds < list.length) return use(list[rounds][0], list[rounds][1]);
  }
  return anthropicReply("Done.", { model: "m-1" });
};

/**
 * Requests to `m` over the network, pinned to its certificate, with `token` as their Bearer: as another machine's
 * Filament sends them. A body goes as JSON.
 * @param {import("./helpers/two-machines.js").Machine} m @param {string} token
 */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body } = {}) =>
    pinned(`${m.far}${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
};

describe("another machine's agents' chat", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-xsec-"));
  const project = join(base, "project");
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  /** @type {import("./helpers/two-machines.js").Machine} */
  let there;
  /** @type {ReturnType<typeof as>} */
  let agents;
  let deviceId = "";
  /** The person's own chat here, in the project. */
  let personChat = "";
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A chat of the agents' own in the project. */
  const theirChat = async () => {
    const r = await agents("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    return String(j.id);
  };
  /** The agents' turn in their chat, its reply read whole. @param {string} id @param {string} content */
  const theirTurn = async (id, content) => {
    const r = await agents(`${S(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** The person's turn in a chat here. @param {string} id @param {string} content */
  const personTurn = async (id, content) => {
    const r = await there.api(`${S(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** The tools the newest call for the message `words` was offered. @param {string} words */
  const offered = (words) => {
    const c = calls.findLast((x) => x.last.includes(words));
    assert.ok(c, `a call for ${words}`);
    return c.tools;
  };
  /** The grant `agents` set by there's own computer. @param {boolean} on */
  const grant = async (on) => grants({ agents: on });
  /** Grants set by there's own computer. @param {Record<string, boolean>} set */
  const grants = async (set) => {
    const r = await there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: set } });
    assert.equal(r.status, 200, await r.clone().text());
  };

  before(async () => {
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "readme.txt"), "the project's own words");
    up = await fakeUpstream(brain);
    two = await startTwoMachines({
      there: {
        configure: (cfg) => {
          cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
          cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
          // Edit: a change runs, a command asks the person.
          cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "edit", roots: [base], readerModel: "" };
        },
      },
    });
    there = two.there;
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    await grant(true);
    agents = as(there, minted.token);
    const r = await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    personChat = String(j.id);
    // The project's Space, which the person made.
    const { projectId } = await (await there.api(`${S(personChat)}/settings`)).json();
    assert.equal((await there.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200);
  });
  after(async () => {
    await two?.stop();
    await up?.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the agents' chat was offered artifact, space and come_back, and its artifact call ran)
  test("Filament's tools that reach past its folder are not offered it, and a call to one is refused: its hands, sub-agents, asks and plan stay", async () => {
    await personTurn(personChat, "TOOLS person");
    const person = offered("TOOLS person").map((t) => t.name);
    for (const name of ["artifact", "space", "come_back"]) assert.ok(person.includes(name), `the person's chat has ${name}: ${person.join(", ")}`);
    const id = await theirChat();
    await theirTurn(id, "TOOLS theirs");
    const theirs = offered("TOOLS theirs").map((t) => t.name);
    for (const name of ["artifact", "space", "team", "flow", "thread", "come_back", "browser", "skill", "craft", "web_fetch", "web_search", "mcp", "mcp_resources"])
      assert.ok(!theirs.includes(name), `the agents' chat goes without ${name}: ${theirs.join(", ")}`);
    assert.ok(!theirs.some((n) => n.startsWith("mcp__") || n.startsWith("filament_memory")), theirs.join(", "));
    for (const name of ["read", "write", "edit", "bash", "grep", "glob", "ask", "plan", "agent", "wait"]) assert.ok(theirs.includes(name), `the agents' chat keeps ${name}: ${theirs.join(", ")}`);
    // A call to them all the same: refused, never run.
    const called = await theirChat();
    await theirTurn(called, `CALLS<<${JSON.stringify([["artifact", { action: "list" }], ["space", { action: "read" }], ["come_back", { seconds: 120, note: "later" }]])}>>`);
    const results = calls.filter((c) => c.first.includes("CALLS<<") && c.first.includes("come_back") && c.results.length).flatMap((c) => c.results);
    assert.equal(results.length, 3, JSON.stringify(results));
    for (const r of results) assert.match(r, /not available here/, r);
  });

  // (fails before: yes — the agents' chat's agent tool took machine, list_machines and cwd where there keeps a machine)
  test("where this machine keeps a machine for its own agents, the agents' chat's agent tool and bash_background take no machine; the person's chat's do", async () => {
    const remote = (/** @type {string} */ name, /** @type {string} */ scope) => ({ name, url: "https://127.0.0.1:1", token: `tok-${name}-${scope}`, machine: { id: `id-${name}`, name }, device: { id: `dev-${name}`, name: "Workstation", scope }, connectedAt: 1 });
    const file = join(there.dataDir, "remotes.json");
    writeFileSync(file, `${JSON.stringify({ remotes: [remote("Studio", "full"), remote("Studio", "agent")] }, null, 2)}\n`);
    try {
      await personTurn(personChat, "MACHINES person");
      const person = offered("MACHINES person");
      assert.ok("machine" in (person.find((t) => t.name === "agent")?.input_schema?.properties || {}), "the person's chat's agent tool takes machine");
      const id = await theirChat();
      await theirTurn(id, "MACHINES theirs");
      const theirs = offered("MACHINES theirs");
      const agent = theirs.find((t) => t.name === "agent");
      assert.ok(agent, "the agents' chat keeps its agent tool");
      for (const field of ["machine", "list_machines", "cwd"]) assert.ok(!(field in agent.input_schema.properties), `its agent tool takes no ${field}`);
      assert.ok(!("machine" in (theirs.find((t) => t.name === "bash_background")?.input_schema?.properties || {})), "its bash_background takes no machine");
    } finally {
      rmSync(file, { force: true });
    }
  });

  // (fails before: yes — the bare /allow ran the waiting command: press was null, and the turn read the words as /allow)
  test("their /allow answers a waiting permission as Deny: the command is not run, and its result says so", async () => {
    const id = await theirChat();
    const command = `node -e "require('fs').writeFileSync('allowed.txt','ran')"`;
    await theirTurn(id, `CALLS<<${JSON.stringify([["bash", { command }]])}>>`);
    const asks = (await (await agents(`${S(id)}/asks`)).json()).asks;
    assert.equal(asks[0]?.kind, "permission", JSON.stringify(asks));
    await theirTurn(id, "/allow");
    assert.equal(existsSync(join(project, "allowed.txt")), false, "the command never ran");
    const answered = calls.findLast((c) => c.first.includes("allowed.txt") && c.results.length);
    assert.match(String(answered?.results[0]), /Not run/, JSON.stringify(answered?.results));
  });

  // (fails before: yes — the tag in their message let their chat's agent write the person's chat)
  test("a chat their message tags is not their agent's to write letters to", async () => {
    const id = await theirChat();
    await theirTurn(id, `See [Mine](chat:${personChat}). CALLS<<${JSON.stringify([["envelope", { to: personChat, subject: "Hello", text: "From the agents." }]])}>>`);
    const wrote = calls.findLast((c) => c.first.includes("From the agents.") && c.results.length);
    assert.match(String(wrote?.results[0]), /^Not sent: you write only to a chat the developer tagged/, JSON.stringify(wrote?.results));
  });

  // (fails before: yes — switching the grant off ended only its streams: the chat's turn and its sub-agent went on, and a
  // come-back's wake started a turn there)
  test("its grant switched off stops its chat's turn and sub-agents, and Filament starts no turn of its own there after", async () => {
    const id = await theirChat();
    const running = agents(`${S(id)}/turns`, { method: "POST", body: { content: "MAINSPIN", stream: false } }).then((r) => r.text()).catch(() => "");
    const spins = () => calls.filter((c) => c.first.includes("SPIN")).length;
    for (let i = 0; i < 100 && !(calls.filter((c) => c.first.includes("KIDSPIN")).length >= 2 && calls.filter((c) => c.first.includes("MAINSPIN")).length >= 3); i++) await sleep(100);
    const subs = async () => (await (await there.api(`${S(id)}/subagents`)).json()).subagents || [];
    assert.ok((await subs()).some((/** @type {any} */ s) => s.status === "running"), "its sub-agent runs");
    await grant(false);
    await Promise.race([running, sleep(5000)]);
    await sleep(500);
    try {
      const settled = spins();
      await sleep(1200);
      assert.equal(spins(), settled, "no model call of the chat or its sub-agent after the grant went off");
      assert.ok(!(await subs()).some((/** @type {any} */ s) => s.status === "running"), "its sub-agent stopped");
      // The person writes in it, and a come-back's time comes: Filament sends no turn of its own while the grant is off.
      await personTurn(id, "HALT: the person's word.");
      tellLater({ session: id, agent: null }, { id: "wake_xsec", command: "", code: null, kind: "wake", text: "[Filament: the time you set has come.]" });
      await sleep(1500);
      assert.ok(!calls.some((c) => c.last.includes(TIME_WAKE_LINE)), "no turn woke the chat");
    } finally {
      await grant(true);
    }
  });

  /** A path as a command's words name it: forward slashes, which every shell and Node take. @param {string} p */
  const slashed = (p) => p.split("\\").join("/");
  /** A command that writes `file` after `ms`, from a Node it starts: a tree a stop must end whole. @param {string} file @param {number} ms */
  const later = (file, ms) => `node -e "setTimeout(function(){require('fs').writeFileSync('${slashed(file)}','ran')}, ${ms})"`;
  /** Whether `file` is written within `ms`. @param {string} file @param {number} ms */
  const written = async (file, ms) => {
    for (let t = 0; t < ms && !existsSync(file); t += 100) await sleep(100);
    return existsSync(file);
  };

  // (fails before: yes — the person's own instruction file was told the agents' chat, in its system prompt)
  test("its prompt holds its folder's instruction files, never the person's own; a chat of the person's holds both", async () => {
    const own = join(base, "my-notes.md");
    writeFileSync(own, "PERSONAL-NOTE: the person's own words for every chat");
    writeFileSync(join(project, "AGENTS.md"), "FOLDER-NOTE: the project's own rules");
    const mine = String((await (await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } })).json()).id);
    const theirs = await theirChat();
    for (const id of [mine, theirs]) {
      const r = await there.api(`${S(id)}/settings`, { method: "PATCH", body: { patch: { instructions: { userFiles: [own] } } } });
      assert.equal(r.status, 200, await r.clone().text());
    }
    await personTurn(mine, "INSTR person");
    await theirTurn(theirs, "INSTR theirs");
    const system = (/** @type {string} */ words) => String(calls.findLast((c) => c.last.includes(words))?.system);
    assert.match(system("INSTR person"), /PERSONAL-NOTE/, "the person's chat is told their file");
    assert.match(system("INSTR person"), /FOLDER-NOTE/);
    assert.doesNotMatch(system("INSTR theirs"), /PERSONAL-NOTE/, "the agents' chat is never told it");
    assert.match(system("INSTR theirs"), /FOLDER-NOTE/, "the agents' chat is told its folder's");
  });

  // (fails before: yes — the background command ran on after the grant went off, and its Node wrote the file)
  test("its grant switched off ends a background command it started, with what that command started", async () => {
    const marker = join(base, "background-ran.txt");
    const id = await theirChat();
    await theirTurn(id, `CALLS<<${JSON.stringify([["bash_background", { command: later(marker, 6000) }]])}>>`);
    // A command asks in Edit: the agents' press, through the asks route, lets it run.
    const [ask] = (await (await agents(`${S(id)}/asks`)).json()).asks;
    if (ask) assert.equal((await agents(`${S(id)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { allow: true } })).status, 200);
    for (let i = 0; i < 50 && !runningShellsOf(id).length; i++) await sleep(100);
    assert.equal(runningShellsOf(id).length, 1, "its command runs");
    await grant(false);
    try {
      for (let i = 0; i < 30 && runningShellsOf(id).length; i++) await sleep(100);
      assert.equal(runningShellsOf(id).length, 0, "its command ended with the grant");
      assert.equal(await written(marker, 6500), false, "what it started ended with it");
    } finally {
      await grant(true);
    }
  });

  // (fails before: yes — the hunt on xf-chat2: a grant-off stop left the shell's watch on, so the line it caught as the
  // shell ended was told the chat, and woke it)
  test("its grant switched off ends a watched background command with nothing told: no line its watch would catch at the end, no exit", async () => {
    const id = await theirChat();
    const command = `node -e "process.stdout.write('READY-unfinished'); setTimeout(function(){}, 8000)"`;
    await theirTurn(id, `CALLS<<${JSON.stringify([["bash_background", { command, watch: "READY" }]])}>>`);
    const [ask] = (await (await agents(`${S(id)}/asks`)).json()).asks;
    if (ask) assert.equal((await agents(`${S(id)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { allow: true } })).status, 200);
    for (let i = 0; i < 50 && !runningShellsOf(id).length; i++) await sleep(100);
    assert.equal(runningShellsOf(id).length, 1, "its command runs");
    await sleep(300);
    await grant(false);
    try {
      for (let i = 0; i < 30 && runningShellsOf(id).length; i++) await sleep(100);
      assert.equal(runningShellsOf(id).length, 0, "its command ended with the grant");
      await sleep(500);
      const told = [...peekShellExits({ session: id, agent: null })];
      assert.deepEqual(told, [], `nothing waits to be told: ${JSON.stringify(told)}`);
      assert.equal(wakeDue(id), false, "nothing wakes it");
    } finally {
      await grant(true);
    }
  });

  // (fails before: yes — the hunt on xf-chat2: with the grant `unasked` off no command task ran at all, so the test passed
  // without the hold; with it on, a graph's command task started, and without `graphs.stop` its run went on)
  test("its task graph starts nothing by itself after the grant goes off, and its command task's runs are cut", async () => {
    const repo = join(base, "repo");
    mkdirSync(repo, { recursive: true });
    const git = (/** @type {string[]} */ ...a) => execFileSync("git", a, { cwd: repo, encoding: "utf8", windowsHide: true });
    git("init", "-q");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "T");
    writeFileSync(join(repo, "readme.txt"), "a repository");
    git("add", "-A");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "init");
    const marker = join(base, "task-ran.txt");
    const began = join(base, "task-began.txt");
    const next = join(base, "next-task-ran.txt");
    // Their device may run without asking here: Filament runs their graph's command tasks.
    await grants({ unasked: true });
    try {
      const made = await agents("/api/sessions", { method: "POST", body: { cwd: repo, model: MODEL, preset: "plain" } });
      const id = String((await made.json()).id);
      const slow = `node -e "require('fs').writeFileSync('${slashed(began)}','began'); setTimeout(function(){require('fs').writeFileSync('${slashed(marker)}','ran')}, 4000)"`;
      const add = { action: "add", goal: "Run it", tasks: [{ id: "c1", name: "Slow run", by: "command", run: [slow] }, { id: "c2", name: "Then another", by: "command", run: [later(next, 100)], needs: ["c1"] }] };
      // The task added, a command that asks in Edit: the turn waits on the person's answer while the task runs.
      await theirTurn(id, `CALLS<<${JSON.stringify([["tasks", add], ["bash", { command: `node -e "1"` }]])}>>`);
      const added = calls.findLast((c) => c.first.includes("Slow run") && c.results.length);
      assert.doesNotMatch(String(added?.results[0]), /Nothing of this call changed/, "its graph was made");
      assert.equal((await (await agents(`${S(id)}/asks`)).json()).asks[0]?.kind, "permission", "its turn waits");
      assert.equal(await written(began, 5000), true, "its command task runs");
      await grant(false);
      try {
        assert.equal(await written(marker, 5500), false, "its command task's run was cut");
        assert.equal(await written(next, 1500), false, "and the task that needed it never started");
      } finally {
        await grant(true);
      }
    } finally {
      await grants({ unasked: false });
    }
  });

  // (fails before: yes — `filament chats --json` was read as only reading, and ran in Ask mode with no one asked)
  test("Filament's own command line, run by its model in Ask mode, is asked, not run; a chat of the person's runs it as a read", { skip: ["git-bash", "bash", "sh"].includes(SHELL.kind) ? false : `${SHELL.name} is not a bash` }, async () => {
    const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
    const before = process.env[PATH_KEY];
    const bin = join(base, "bin");
    const marker = join(base, "cli-ran.txt");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "filament"), `#!/bin/sh\necho ran > '${slashed(marker)}'\n`);
    chmodSync(join(bin, "filament"), 0o755);
    // The bash hand runs a command with this process's PATH (hands.js `safeEnv`).
    process.env[PATH_KEY] = `${bin}${delimiter}${before ?? ""}`;
    try {
      const calling = `CALLS<<${JSON.stringify([["bash", { command: "filament chats --json" }]])}>>`;
      const mine = String((await (await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } })).json()).id);
      const theirs = await theirChat();
      for (const id of [mine, theirs]) assert.equal((await there.api(`${S(id)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: "ask" } } } })).status, 200);
      await personTurn(mine, calling);
      assert.equal(existsSync(marker), true, "the person's chat reads it");
      rmSync(marker, { force: true });
      await theirTurn(theirs, calling);
      assert.equal((await (await agents(`${S(theirs)}/asks`)).json()).asks[0]?.kind, "permission", "the agents' chat is asked");
      assert.equal(existsSync(marker), false, "and nothing ran");
    } finally {
      process.env[PATH_KEY] = before;
    }
  });

  // (fails before: yes — the security re-read of 11-11: the rule that keeps a repository's .git from them held at the
  // file route alone, and there by the path's letters: their chat's read hand read .git/config, its grep and glob
  // searched and listed it, `cat .git/config` ran as a read, and the file route read it through a link)
  test("a repository's own .git is kept from them at each door: their chat's read, grep and glob, a command that reads it, and the file route through a link; a chat of the person's reads it", async () => {
    // A repository below the project, its config holding a remote's token, and a link to its .git beside it.
    const nested = join(project, "nested");
    mkdirSync(join(nested, ".git"), { recursive: true });
    mkdirSync(join(nested, "src"), { recursive: true });
    writeFileSync(join(nested, ".git", "config"), '[remote "origin"]\n\turl = https://me:tok-nested-77@kept-origin.example.test/r.git\n');
    writeFileSync(join(nested, "src", "a.js"), "export const a = 1;\n");
    symlinkSync(join(nested, ".git"), join(nested, "meta"), process.platform === "win32" ? "junction" : "dir");
    const bash = ["git-bash", "bash", "sh"].includes(SHELL.kind);
    const reading = [
      ["read", { path: "nested/.git/config" }],
      ["read", { path: "nested/meta/config" }],
      ["grep", { pattern: "url", path: "nested/.git" }],
      ["glob", { pattern: "*", path: "nested/meta" }],
      ["read", { path: "nested/src/a.js" }],
    ];
    const theirs = await theirChat();
    await theirTurn(theirs, `KEPT theirs CALLS<<${JSON.stringify(reading)}>>`);
    const got = calls.filter((c) => c.first.includes("KEPT theirs") && c.results.length).flatMap((c) => c.results);
    assert.equal(got.length, reading.length, JSON.stringify(got));
    for (const r of got.slice(0, 4)) {
      assert.match(r, /another machine's agents never read a repository's own \.git folder/, r);
      assert.doesNotMatch(r, /kept-origin|tok-nested/, r);
    }
    assert.match(got[4], /export const a = 1;/, "its own file is read");
    // A command that reads it asks the person, where a read of its own file runs.
    if (bash) {
      const asking = await theirChat();
      await theirTurn(asking, `KEPT command CALLS<<${JSON.stringify([["bash", { command: "cat nested/src/a.js" }], ["bash", { command: "cat nested/meta/config" }]])}>>`);
      const ran = calls.filter((c) => c.first.includes("KEPT command") && c.results.length).flatMap((c) => c.results);
      assert.match(String(ran[0]), /export const a = 1;/, JSON.stringify(ran));
      assert.ok(!ran.some((r) => /kept-origin|tok-nested/.test(r)), JSON.stringify(ran));
      const asks = (await (await agents(`${S(asking)}/asks`)).json()).asks;
      assert.equal(asks[0]?.kind, "permission", JSON.stringify(asks));
    }
    // The file route, by a link's name.
    for (const path of ["nested/.git/config", "nested/meta/config"]) {
      const r = await agents(`/api/files/read?cwd=${encodeURIComponent(project)}&path=${encodeURIComponent(path)}`);
      assert.equal(r.status, 403, path);
      assert.match((await r.json()).error, /never read a repository's own \.git folder/, path);
    }
    assert.equal((await agents(`/api/files/read?cwd=${encodeURIComponent(project)}&path=${encodeURIComponent("nested/src/a.js")}`)).status, 200);
    // The person's own chat reads their repository's config.
    const mine = String((await (await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } })).json()).id);
    await personTurn(mine, `KEPT person CALLS<<${JSON.stringify([["read", { path: "nested/.git/config" }]])}>>`);
    assert.match(String(calls.findLast((c) => c.first.includes("KEPT person") && c.results.length)?.results[0]), /kept-origin\.example\.test/);
  });
});

describe("a coding agent in another machine's agents' chat", () => {
  /** The answer claude-agent-acp 0.93.0 gives `initialize`, as far as the profile reads it. */
  const claudeInit = {
    protocolVersion: 1,
    agentCapabilities: { _meta: { claudeCode: { promptQueueing: true } }, mcpCapabilities: { http: true, sse: true }, loadSession: true, sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} } },
    agentInfo: { name: "@agentclientprotocol/claude-agent-acp", title: "Claude Agent", version: "0.93.0" },
  };
  /** A server of the person's on a coding agent's card here, its env carrying a secret. */
  const KEYS = { name: "keys", command: process.execPath, args: ["-e", "0"], env: { API_TOKEN: "s3cret-keys" } };
  /** JSON lines of a file, oldest first. @param {string} file */
  const lines = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  /** A harness turn's request. @param {string} text */
  const asked = (text) => ({ format: "anthropic", body: { model: "m", max_tokens: 100, messages: [{ role: "user", content: text }] }, headers: { [COMPACTION_HEADER]: "0" }, onEvent: () => {} });
  /** What their chat's turn hands a coding agent: acp-turn.js `toolsAt` for a fenced chat. */
  const THEIRS = { chain: "c-theirs", turn: "t1", agentsChat: true, space: false, mcp: [] };
  let dir = "";
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "filament-x-sec-coders-"));
  });
  after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

  // (fails before: yes — the hunt on xf-chat: Claude Code was handed its card's MCP servers, and kept its web, its Skill,
  // its artifacts and its auto memory, which Filament's own agent there has none of)
  test("Claude Code there is given none of its card's MCP servers and opens without its web, skills, artifacts and auto memory; a chat of the person's keeps them", () => {
    const claude = { id: "claude-code", acp: { command: "claude-agent-acp", mcpServers: [KEYS] } };
    /** @param {string} bridge @param {any} toolsAt @param {string[]} [notes] */
    const plan = (bridge, toolsAt, notes = []) =>
      planToolset({ acp: claude.acp, upstream: claude, proc: { initResult: claudeInit }, profile: readProfile(claudeInit, confirmedOf(claude)), turn: { bridge, toolsAt }, fullBridge: bridge === "native", cwd: "/w", mcpBase: "http://127.0.0.1:1", memoryWanted: false, existingToken: null, notes });
    const theirs = plan("prompts", THEIRS);
    assert.deepEqual(theirs.mcpServers.map((/** @type {any} */ s) => s.name), [], "none of the card's");
    assert.ok(theirs.chatWords.some((w) => /own MCP servers \(its upstream's mcpServers\) are not given: the session is another machine's agents' chat$/.test(w)), theirs.chatWords.join("\n"));
    const options = /** @type {any} */ (theirs.sessionMeta)._meta.claudeCode.options;
    for (const tool of ["WebFetch", "WebSearch", "Skill"]) assert.ok(options.disallowedTools?.includes(tool), `${tool}: ${JSON.stringify(options)}`);
    assert.deepEqual([options.env?.CLAUDE_CODE_DISABLE_ARTIFACT, options.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY], ["1", "1"], JSON.stringify(options));
    assert.equal(options.strictMcpConfig, true);
    const native = plan("native", THEIRS);
    assert.equal(native.native, true);
    assert.equal(/** @type {any} */ (native.sessionMeta)._meta.claudeCode.options.tools, undefined, "a native session there keeps no built-in, its Skill neither");
    const mine = plan("prompts", { chain: "c-mine", turn: "t1", mcp: [] });
    assert.deepEqual(mine.mcpServers.map((/** @type {any} */ s) => s.name), ["keys"]);
    const own = /** @type {any} */ (mine.sessionMeta)._meta.claudeCode.options;
    assert.deepEqual([own.disallowedTools, own.env, own.strictMcpConfig], [undefined, undefined, undefined]);
    assert.deepEqual(/** @type {any} */ (plan("native", { chain: "c-mine", turn: "t1" }).sessionMeta)._meta.claudeCode.options.tools, ["Skill"]);
    /** @type {string[]} */
    const said = [];
    const other = { id: "gemini", acp: { command: "gemini" } };
    const init = { protocolVersion: 1, agentCapabilities: { mcpCapabilities: { http: true } }, agentInfo: { name: "gemini-cli", version: "1.0.0" } };
    planToolset({ acp: other.acp, upstream: other, proc: { initResult: init }, profile: readProfile(init, confirmedOf(other)), turn: { bridge: "prompts", toolsAt: THEIRS }, fullBridge: false, cwd: "/w", mcpBase: null, memoryWanted: false, existingToken: null, notes: said });
    assert.ok(said.some((n) => /takes none of Claude Code's session options, so what its own files give it \(MCP servers, skills, the web\) stays in another machine's agents' chat$/.test(n)), said.join("\n"));
  });

  // (fails before: yes — a session of their chat, opened again after a restart, was given its card's servers again)
  test("Claude Code's session there, opened again after a restart, is given none of its card's servers again", async () => {
    const calls = join(dir, "acp-calls.jsonl");
    const up = { id: "keys", name: "keys", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], mcpServers: [KEYS], env: { FAKE_ACP_CALLS: calls, FAKE_ACP_LOG: join(dir, "acp-prompts.jsonl"), FAKE_ACP_CLAUDE: "1", FAKE_ACP_OWN_COMPACT: "1", FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete" }, cwdDefault: dir, permissions: "allow-all" } };
    const file = join(dir, "acp-sessions.json");
    const opens = () => lines(calls).filter((c) => /^session\/(new|load|resume)$/.test(c.method));
    const first = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: file }));
    try {
      await first.run({ upstream: up, modelId: "fake-a", conversationId: "theirs", toolsAt: THEIRS, ...asked("one") });
      assert.deepEqual(opens().at(-1)?.servers ?? [], [], "opened with none");
      first.convs.flush();
    } finally {
      await first.shutdown();
    }
    const second = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: file }));
    try {
      await second.compactOwn({ upstream: up, conversationId: "theirs", base: 0, keep: "", fork: true, record: () => 7 });
      assert.deepEqual([opens().at(-1)?.method, opens().at(-1)?.servers ?? []], ["session/resume", []], "opened again with none");
    } finally {
      await second.shutdown();
    }
  });

  // (fails before: yes — Codex's thread there was given its card's servers, and the person's own Codex config's started)
  test("Codex's thread there is given none of its card's servers and the person's own Codex config's are off, after a restart too; a config it cannot read refuses the thread", async () => {
    const home = join(dir, "codex-home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.toml"), '[mcp_servers.github]\ncommand = "gh-mcp"\nenv = { GITHUB_TOKEN = "s3cret-gh" }\n\n[mcp_servers.filament]\nurl = "http://127.0.0.1:7/mcp"\n');
    const calls = join(dir, "cx.jsonl");
    const up = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], mcpServers: [KEYS], env: { FAKE_CODEX_CALLS: calls, CODEX_HOME: home }, cwdDefault: dir, permissions: "allow-all" } };
    const config = (/** @type {string} */ method) => lines(calls).filter((m) => m.method === method).at(-1)?.params?.config || {};
    const file = join(dir, "codex-sessions.json");
    const first = new CodexBridge({ log: () => {}, stateFile: file });
    try {
      const done = await first.run({ upstream: up, modelId: "gpt-6-astra", conversationId: "theirs", toolsAt: THEIRS, ...asked("one") });
      const opened = config("thread/start");
      assert.equal(opened["mcp_servers.keys"], undefined, "none of the card's");
      assert.deepEqual([opened["mcp_servers.github.enabled"], opened["mcp_servers.filament.enabled"]], [false, false], JSON.stringify(opened));
      assert.ok(done.notes.includes("codex: the MCP servers of the person's own Codex config are off: the thread is another machine's agents' chat"), done.notes.join("\n"));
      const mine = await first.run({ upstream: up, modelId: "gpt-6-astra", conversationId: "mine", toolsAt: { chain: "c-mine", turn: "t1", mcp: [] }, ...asked("mine") });
      assert.ok(mine.sessionId);
      assert.deepEqual(config("thread/start")["mcp_servers.keys"]?.command, process.execPath, "a chat of the person's is given its card's");
      assert.equal(config("thread/start")["mcp_servers.github.enabled"], undefined);
    } finally {
      await first.shutdown();
    }
    const second = new CodexBridge({ log: () => {}, stateFile: file });
    try {
      await second.compactOwn({ upstream: up, conversationId: "theirs", base: 0, keep: "", fork: true, record: () => 5 });
      const again = config("thread/resume");
      assert.equal(again["mcp_servers.keys"], undefined, "none of the card's after a restart");
      assert.equal(again["mcp_servers.github.enabled"], false, JSON.stringify(again));
    } finally {
      await second.shutdown();
    }
    writeFileSync(join(home, "config.toml"), "[mcp_servers.github\ncommand = 1\n");
    const third = new CodexBridge({ log: () => {}, stateFile: join(dir, "codex-bad.json") });
    try {
      await assert.rejects(third.run({ upstream: up, modelId: "gpt-6-astra", conversationId: "bad", toolsAt: THEIRS, ...asked("bad") }), /Codex's config \(.*config\.toml\) could not be read, so the MCP servers it names could not be kept from another machine's agents' chat/);
    } finally {
      await third.shutdown();
    }
  });

  // (fails before: yes — Cursor's agent there was given its card's servers)
  test("Cursor's agent there is given none of its card's servers", async () => {
    const log = join(dir, "sdk.jsonl");
    process.env.FAKE_SDK_LOG = log;
    const bridge = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    const up = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, mcpServers: [KEYS] } };
    try {
      await bridge.run({ upstream: up, modelId: "grok-4.6", conversationId: "theirs", toolsAt: THEIRS, ...asked("one") });
      const made = lines(log).filter((e) => e.event === "create").at(-1);
      assert.equal(made?.mcpServers, undefined, JSON.stringify(made));
      await bridge.run({ upstream: up, modelId: "grok-4.6", conversationId: "mine", toolsAt: { chain: "c-mine", turn: "t1", mcp: [] }, ...asked("mine") });
      assert.deepEqual(lines(log).filter((e) => e.event === "create").at(-1)?.mcpServers, ["keys"]);
    } finally {
      bridge.shutdown?.();
      delete process.env.FAKE_SDK_LOG;
    }
  });

  // (fails before: yes — a Codex thread or a Cursor agent opened fenced stayed as it opened once Full control lifted the
  // fence, and one opened as the person's kept the person's servers once the fence came back)
  test("Full control switched on their chat opens its Codex thread and its Cursor agent again with the person's servers, and switched off with none again", async () => {
    /** acp-turn.js `toolsAt` for their chat while its device holds Full control: no fence. */
    const FULL = { chain: "c-theirs", turn: "t2", space: false, mcp: [] };
    const home = join(dir, "codex-full-home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.toml"), '[mcp_servers.github]\ncommand = "gh-mcp"\n');
    const calls = join(dir, "cx-full.jsonl");
    const cx = { id: "cx", name: "cx", type: "codex", acp: { command: process.execPath, args: [join(FIXTURES, "fake-codex-app-server.mjs")], mcpServers: [KEYS], env: { FAKE_CODEX_CALLS: calls, CODEX_HOME: home }, cwdDefault: dir, permissions: "allow-all" } };
    const opened = () => lines(calls).filter((m) => m.method === "thread/start" || m.method === "thread/resume").map((m) => [m.method, m.params?.config?.["mcp_servers.keys"]?.command ?? null, m.params?.config?.["mcp_servers.github.enabled"] ?? null]);
    const codex = new CodexBridge({ log: () => {}, stateFile: join(dir, "codex-full.json") });
    try {
      await codex.run({ upstream: cx, modelId: "gpt-6-astra", conversationId: "full", toolsAt: THEIRS, ...asked("one") });
      const lifted = await codex.run({ upstream: cx, modelId: "gpt-6-astra", conversationId: "full", toolsAt: FULL, ...asked("two") });
      assert.ok(lifted.notes.some((n) => /opened again: another machine's agents' chat, its Full control switched on/.test(n)), lifted.notes.join("\n"));
      await codex.run({ upstream: cx, modelId: "gpt-6-astra", conversationId: "full", toolsAt: THEIRS, ...asked("three") });
      assert.deepEqual(opened(), [["thread/start", null, false], ["thread/resume", process.execPath, null], ["thread/resume", null, false]]);
    } finally {
      await codex.shutdown();
    }
    const log = join(dir, "sdk-full.jsonl");
    process.env.FAKE_SDK_LOG = log;
    const cursor = new CursorSdkBridge(/** @type {any} */ ({ log: () => {}, loader: () => import(pathToFileURL(join(FIXTURES, "fake-cursor-sdk.mjs")).href) }));
    const cs = { id: "csdk", name: "csdk", type: "cursor-sdk", apiKey: "ck-test", acp: { cwdDefault: dir, mcpServers: [KEYS] } };
    try {
      for (const [toolsAt, text] of /** @type {const} */ ([[THEIRS, "one"], [FULL, "two"], [THEIRS, "three"]])) await cursor.run({ upstream: cs, modelId: "grok-4.6", conversationId: "full", toolsAt, ...asked(text) });
      const made = lines(log).filter((e) => e.event === "create" || e.event === "resume").map((e) => [e.event, e.mcpServers ?? null]);
      assert.deepEqual(made, [["create", null], ["resume", ["keys"]], ["resume", null]]);
    } finally {
      cursor.shutdown?.();
      delete process.env.FAKE_SDK_LOG;
    }
    // An ACP agent with no session options of Claude Code's: the card's servers alone go and come with the fence.
    const acpCalls = join(dir, "acp-full.jsonl");
    const ag = { id: "keys", name: "keys", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], mcpServers: [KEYS], env: { FAKE_ACP_CALLS: acpCalls, FAKE_ACP_LOG: join(dir, "acp-full-prompts.jsonl"), FAKE_ACP_SESSION_CAPS: "resume,close,fork,delete" }, cwdDefault: dir, permissions: "allow-all" } };
    const acp = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(dir, "acp-full.json") }));
    try {
      for (const [toolsAt, text] of /** @type {const} */ ([[THEIRS, "one"], [FULL, "two"], [THEIRS, "three"]])) await acp.run({ upstream: ag, modelId: "fake-a", conversationId: "full", toolsAt, ...asked(text) });
      const opens = lines(acpCalls).filter((c) => /^session\/(new|load|resume)$/.test(c.method)).map((c) => [c.method, c.servers ?? []]);
      assert.deepEqual(opens, [["session/new", []], ["session/resume", ["keys:stdio"]], ["session/resume", []]]);
    } finally {
      await acp.shutdown();
    }
  });

  // (fails before: yes — an agent that cannot open its session again kept the one opened under Full control, the card's
  // servers with it, once the chat ran fenced again)
  test("Full control switched off on an ACP agent that cannot open its session again: that session goes, and a new one opens fenced", async () => {
    const FULL = { chain: "c-theirs", turn: "t2", space: false, mcp: [] };
    const acpCalls = join(dir, "acp-noreopen.jsonl");
    const ag = { id: "keys", name: "keys", acp: { command: process.execPath, args: [FAKE_ACP_AGENT], mcpServers: [KEYS], env: { FAKE_ACP_CALLS: acpCalls, FAKE_ACP_LOG: join(dir, "acp-noreopen-prompts.jsonl"), FAKE_ACP_SESSION_CAPS: "close", FAKE_ACP_NO_LOAD: "1" }, cwdDefault: dir, permissions: "allow-all" } };
    const acp = new AcpBridge(/** @type {any} */ ({ log: () => {}, stateFile: join(dir, "acp-noreopen.json") }));
    try {
      await acp.run({ upstream: ag, modelId: "fake-a", conversationId: "noreopen", toolsAt: FULL, ...asked("one") });
      const fenced = await acp.run({ upstream: ag, modelId: "fake-a", conversationId: "noreopen", toolsAt: THEIRS, ...asked("two") });
      assert.ok(fenced.notes.some((/** @type {string} */ n) => /runs fenced again.*was let go/.test(n)), fenced.notes.join("\n"));
      await acp.run({ upstream: ag, modelId: "fake-a", conversationId: "noreopen", toolsAt: THEIRS, ...asked("three") });
      const opens = lines(acpCalls).filter((c) => /^session\/(new|load|resume)$/.test(c.method)).map((c) => [c.method, c.servers ?? []]);
      assert.deepEqual(opens, [["session/new", ["keys:stdio"]], ["session/new", []]], "a fenced session, once opened, is kept");
    } finally {
      await acp.shutdown();
    }
  });
});

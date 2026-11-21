// @ts-check
// Full control (the owner's "YOLO mode" of 11-09, fc-turn): another machine's agents' chat whose device holds Full
// control here runs as the person's own chat — Filament's tools that reach past its folder, its MCP servers, skills,
// the person's instruction files, where this Filament listens, and Auto as Auto. What it may never do stays: its agent
// tool and bash_background take no machine of this Filament's, so no work goes on to a third machine (an A -> B -> A
// loop). Read once a turn: Full control switched off, the chat's next turn is fenced again. And the machine that sent
// them says "full control" in list_machines. Two real Filaments (helpers/two-machines.js).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startTwoMachines } from "./helpers/two-machines.js";
import { anthropicReply, fakeUpstream } from "./helpers/app.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { createRemoteAgents } from "../src/app/agent/remote-agents.js";

const JSON_TYPE = { "content-type": "application/json" };
const MODEL = "agent/m-1";

/** @param {any} m */
const textOf = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : "")).join(""));

/** Each call the model took: its first words and newest, the tools offered, its system prompt. @type {{ first: string, last: string, tools: any[], system: string }[]} */
const calls = [];
/**
 * The model: `CALLS<<[[name, input], …]>>` makes those calls, one a round, then answers; anything else in words.
 * @param {any} call
 */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const msgs = call.body.messages || [];
  const first = textOf(msgs[0]);
  const rounds = msgs.filter((/** @type {any} */ m) => m.role === "assistant").length;
  calls.push({ first, last: textOf(msgs.at(-1)), tools: call.body.tools || [], system: JSON.stringify(call.body.system ?? "") });
  const at = first.indexOf("CALLS<<");
  if (at >= 0) {
    const list = JSON.parse(first.slice(at + 7, first.indexOf(">>", at)));
    if (rounds < list.length) return anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `c${calls.length}`, name: list[rounds][0], input: list[rounds][1] }] });
  }
  return anthropicReply("Done.", { model: "m-1" });
};

/** @param {import("./helpers/two-machines.js").Machine} m @param {string} token */
const as = (m, token) => {
  const pinned = pinnedFetch(m.lan.fingerprint);
  /** @param {string} path @param {{ method?: string, body?: unknown }} [o] @returns {Promise<Response>} */
  return (path, { method = "GET", body } = {}) =>
    pinned(`${m.far}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : JSON_TYPE) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
};

describe("another machine's agents' chat under Full control", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-xfull-"));
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
  let personChat = "";
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  const theirChat = async () => {
    const r = await agents("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    return String(j.id);
  };
  /** @param {(path: string, o?: any) => Promise<Response>} call @param {string} id @param {string} content */
  const turn = async (call, id, content) => {
    const r = await call(`${S(id)}/turns`, { method: "POST", body: { content, stream: false } });
    assert.equal(r.status, 200, await r.clone().text());
    return r.json();
  };
  /** The newest call for the message `words`. @param {string} words */
  const callOf = (words) => {
    const c = calls.findLast((x) => x.last.includes(words));
    assert.ok(c, `a call for ${words}`);
    return c;
  };
  /** Grants set by there's own computer. @param {Record<string, boolean>} set */
  const grants = async (set) => {
    const r = await there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: set } });
    assert.equal(r.status, 200, await r.clone().text());
  };

  before(async () => {
    mkdirSync(project, { recursive: true });
    up = await fakeUpstream(brain);
    two = await startTwoMachines({
      there: {
        configure: (cfg) => {
          cfg.upstreams = [{ id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true }];
          cfg.routes = [{ match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true }];
          cfg.agentLoop = { ...cfg.agentLoop, permissions: "edit", roots: [base], readerModel: "" };
        },
      },
    });
    there = two.there;
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    await grants({ agents: true });
    agents = as(there, minted.token);
    const r = await there.api("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain" } });
    personChat = String((await r.json()).id);
    const { projectId } = await (await there.api(`${S(personChat)}/settings`)).json();
    assert.equal((await there.api(`/api/space/${encodeURIComponent(projectId)}`, { method: "POST" })).status, 200);
  });
  after(async () => {
    await two?.stop();
    await up?.close();
    // A file a stopped machine's child still holds on Windows leaves the temp folder behind: nothing this test reads.
    try {
      rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch {}
  });

  // (fails before: yes — a chat another machine's agents started went without artifact, space and come_back whatever
  // its device held, and the person's instruction file was never told it)
  test("its tools and prompt are the person's chat's, with no machine of this Filament's; Full control off, its next turn is fenced again", async () => {
    const remote = (/** @type {string} */ name, /** @type {string} */ scope) => ({ name, url: "https://127.0.0.1:1", token: `tok-${name}-${scope}`, machine: { id: `id-${name}`, name }, device: { id: `dev-${name}`, name: "Workstation", scope }, connectedAt: 1 });
    const file = join(there.dataDir, "remotes.json");
    writeFileSync(file, `${JSON.stringify({ remotes: [remote("Studio", "full"), remote("Studio", "agent")] }, null, 2)}\n`);
    const own = join(base, "my-notes.md");
    writeFileSync(own, "PERSONAL-NOTE: the person's own words for every chat");
    try {
      const id = await theirChat();
      assert.equal((await there.api(`${S(id)}/settings`, { method: "PATCH", body: { patch: { instructions: { userFiles: [own] } } } })).status, 200);
      // Fenced first: as before.
      await turn(agents, id, "FENCED first");
      const fencedNames = callOf("FENCED first").tools.map((/** @type {any} */ t) => t.name);
      for (const name of ["artifact", "space", "come_back"]) assert.ok(!fencedNames.includes(name), `fenced, it goes without ${name}`);
      assert.doesNotMatch(callOf("FENCED first").system, /PERSONAL-NOTE/);
      // Full control on: the person's tools and their file, and still no machine.
      await grants({ full: true });
      await turn(agents, id, "FULL now");
      const full = callOf("FULL now");
      const names = full.tools.map((/** @type {any} */ t) => t.name);
      for (const name of ["artifact", "space", "come_back"]) assert.ok(names.includes(name), `under Full control it has ${name}: ${names.join(", ")}`);
      assert.match(full.system, /PERSONAL-NOTE/, "the person's instruction file is told it");
      const agent = full.tools.find((/** @type {any} */ t) => t.name === "agent");
      assert.ok(agent, "it keeps its agent tool");
      for (const field of ["machine", "list_machines", "cwd"]) assert.ok(!(field in agent.input_schema.properties), `its agent tool takes no ${field}`);
      assert.ok(!("machine" in (full.tools.find((/** @type {any} */ t) => t.name === "bash_background")?.input_schema?.properties || {})), "its bash_background takes no machine");
      // The person's chat, the control: a machine there.
      await turn(there.api, personChat, "PERSON machines");
      assert.ok("machine" in (callOf("PERSON machines").tools.find((/** @type {any} */ t) => t.name === "agent")?.input_schema?.properties || {}));
      // Off again: fenced from the next turn.
      await grants({ full: false });
      await turn(agents, id, "FENCED again");
      const again = callOf("FENCED again");
      assert.ok(!again.tools.some((/** @type {any} */ t) => t.name === "artifact"), "fenced again");
      assert.doesNotMatch(again.system, /PERSONAL-NOTE/);
    } finally {
      rmSync(file, { force: true });
      await grants({ full: false });
    }
  });

  // (fails before: yes — Auto ran as Edit for their chat unless the grant unasked was on, whatever else it held)
  test("Auto runs as Auto under Full control, as Without asking lets it; Full control off, a command asks again", async () => {
    const id = await theirChat();
    assert.equal((await there.api(`${S(id)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: "auto" } } } })).status, 200);
    const write = (/** @type {string} */ name) => `CALLS<<${JSON.stringify([["bash", { command: `node -e "require('fs').writeFileSync('${name}','ran')"` }]])}>>`;
    await grants({ full: true });
    await turn(agents, id, write("full-auto.txt"));
    assert.equal(existsSync(join(project, "full-auto.txt")), true, "it ran, unasked");
    await grants({ full: false });
    const other = await theirChat();
    assert.equal((await there.api(`${S(other)}/settings`, { method: "PATCH", body: { patch: { loop: { permissions: "auto" } } } })).status, 200);
    await turn(agents, other, write("fenced-auto.txt"));
    assert.equal(existsSync(join(project, "fenced-auto.txt")), false, "it waits on the person");
    const asks = (await (await agents(`${S(other)}/asks`)).json()).asks;
    assert.equal(asks[0]?.kind, "permission", JSON.stringify(asks));
  });

  // (fails before: yes — a chat started under Full control in a folder the fence refuses went on working there once it
  // was off: its folder was judged as it started, and never again)
  test("a chat started under Full control in a folder the fence refuses works there no more once it is off: refused in words, the model not called", async () => {
    const keys = join(base, "app", ".ssh");
    mkdirSync(keys, { recursive: true });
    let id = "";
    await grants({ full: true });
    try {
      const r = await agents("/api/sessions", { method: "POST", body: { cwd: keys, model: MODEL, preset: "plain" } });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      id = String(j.id);
      await turn(agents, id, "KEYS under full");
      callOf("KEYS under full");
    } finally {
      await grants({ full: false });
    }
    const reply = await turn(agents, id, "KEYS fenced");
    assert.match(JSON.stringify(reply), /a credentials folder.*works there no more without Full control/);
    assert.ok(!calls.some((c) => c.last.includes("KEYS fenced")), "the model was not called");
  });
});

// (fails before: yes — list_machines said the grant by its key, "full")
test("list_machines says a machine's Full control in words", async () => {
  const rows = [{ name: "MacBook", machine: { id: "id-mac", name: "MacBook" }, device: { scope: "agent" } }];
  const store = /** @type {any} */ ({
    list: () => rows,
    find: () => rows[0],
    clientOf: async () => ({
      state: { system: { os: "macOS 26.6.2", arch: "arm64" } },
      get: async (/** @type {string} */ path) => {
        if (path === "/remote/me") return { device: { grants: { agents: true, models: false, unasked: false, codingAgents: false, full: true } } };
        throw Object.assign(new Error(`HTTP 404 for ${path}`), { status: 404 });
      },
    }),
  });
  const text = await createRemoteAgents({ machines: store }).machinesText({});
  assert.match(text, /^- MacBook: answers · macOS 26\.6\.2 arm64 · grants on there: agents, full control$/m);
});

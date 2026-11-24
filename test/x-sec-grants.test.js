// @ts-check
// What another machine's agents' device may do here past starting chats, each off until this machine's person switches
// it on under the device in Settings › Remote access (the owner's xd-grants), and never by the device itself:
// "May run without asking" (`unasked`) — off, this machine's Auto is judged as Edit for their chats, Filament's loop
// and a coding agent's alike, and for their commands through the exec route, so what Edit asks about asks, and the ask
// goes to the person at their machine; a switch moved mid-run reaches the next judgement — and "May use coding agents
// here" (`codingAgents`) — off, their chat refuses a coding agent's model in words naming the switch, before the agent
// starts, for its own model and its sub-agents'; on, Claude Code starts with no user-level MCP servers
// (`--strict-mcp-config`, settings from the project and the local file alone). Two real Filaments
// (helpers/two-machines.js) for the chats; the exec rows over a real device store; Settings over the fake DOM.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { startTwoMachines } from "./helpers/two-machines.js";
import { FAKE_ACP_AGENT, TEST_ENVIRONMENT, anthropicReply, fakeUpstream, parseSse } from "./helpers/app.js";
import { fakeH, textOf } from "./helpers/fake-dom.js";
import { pinnedFetch } from "../src/services/machines/pinned.js";
import { createDevices, GRANTS } from "../src/services/devices.js";
import { execRoutes } from "../src/http/admin/exec.js";
import { createRouter } from "../src/http/router.js";
import { renderRemote, GRANT_ROWS } from "../src/ui/harness/settings/remote.js";

const JSON_TYPE = { "content-type": "application/json" };
/** Filament's own loop on the model: a chat's tools and asks are its. */
const MODEL = "agent/m-1";
/** A coding agent here: the fake ACP agent with Claude's adapter's marks. */
const CODER = "cc/fake-a";
/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Wait until `fn` holds, up to `ms`. @param {() => boolean | Promise<boolean>} fn */
const waitFor = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(50);
  }
  return fn();
};

/** @param {any} m */
const textOfMessage = (m) => (typeof m?.content === "string" ? m.content : (Array.isArray(m?.content) ? m.content : []).map((/** @type {any} */ b) => (b?.type === "text" ? b.text : "")).join(""));
/** @param {any} m */
const resultsOf = (m) =>
  (Array.isArray(m?.content) ? m.content : [])
    .filter((/** @type {any} */ b) => b?.type === "tool_result")
    .map((/** @type {any} */ b) => (typeof b.content === "string" ? b.content : (b.content || []).map((/** @type {any} */ x) => x?.text ?? "").join("")));

/** Each call the model behind the chats took: its conversation's first words, the results it was handed, its system text. @type {{ first: string, results: string[], system: string }[]} */
const calls = [];
/** What the model does between two rounds of a chat whose first words hold `words`. @type {Map<string, (round: number) => Promise<void>>} */
const between = new Map();
/** @param {string} name @param {any} input */
const use = (name, input) => anthropicReply("", { model: "m-1", stop: "tool_use", blocks: [{ type: "tool_use", id: `c${calls.length}`, name, input }] });
/**
 * The model: `CALLS<<[[name, input], …]>>` makes those calls, one a round, then answers; anything else is answered in
 * words. @param {any} call
 */
const brain = async (call) => {
  if (call.kind !== "anthropic") return undefined;
  const msgs = call.body.messages || [];
  const first = textOfMessage(msgs[0]);
  const rounds = msgs.filter((/** @type {any} */ m) => m.role === "assistant").length;
  const sys = call.body.system;
  calls.push({ first, results: resultsOf(msgs.at(-1)), system: typeof sys === "string" ? sys : (Array.isArray(sys) ? sys : []).map((/** @type {any} */ b) => b?.text ?? "").join("\n") });
  for (const [words, fn] of between) if (first.includes(words)) await fn(rounds);
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

/** A path as a command's words name it: forward slashes, which every shell and Node take. @param {string} p */
const slashed = (p) => p.split("\\").join("/");
/** A command that writes `file`: no command that only reads, so Edit asks before it. @param {string} file */
const writes = (file) => `node -e "require('fs').writeFileSync('${slashed(file)}','ran')"`;

describe("another machine's agents' chats, under this machine's switches for their device", () => {
  const base = mkdtempSync(join(tmpdir(), "filament-xgrants-"));
  const project = join(base, "project");
  /** Each session the coding agent was asked to open, with the options Claude's adapter would hand its Claude Code. */
  const opens = join(base, "opens.jsonl");
  /** @type {Awaited<ReturnType<typeof fakeUpstream>>} */
  let up;
  /** @type {Awaited<ReturnType<typeof startTwoMachines>>} */
  let two;
  /** @type {import("./helpers/two-machines.js").Machine} */
  let there;
  /** @type {ReturnType<typeof as>} */
  let agents;
  let deviceId = "";
  const S = (/** @type {string} */ id) => `/api/sessions/${encodeURIComponent(id)}`;
  /** A chat of the agents' own in the project, on `model`. @param {string} [model] */
  const theirChat = async (model = MODEL) => {
    const r = await agents("/api/sessions", { method: "POST", body: { cwd: project, model, preset: "plain" } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    return String(j.id);
  };
  /** A chat of the person's own here, on `model`. @param {string} [model] */
  const personChat = async (model = MODEL) => {
    const r = await there.api("/api/sessions", { method: "POST", body: { cwd: project, model, preset: "plain" } });
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
  /** The asks their chat lists, as their machine reads them to show its person. @param {string} id @returns {Promise<any[]>} */
  const theirAsks = async (id) => (await (await agents(`${S(id)}/asks`)).json()).asks || [];
  /** Their device's grants set by there's own computer. @param {Record<string, boolean>} grants */
  const grant = async (grants) => {
    const r = await there.api(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants } });
    assert.equal(r.status, 200, await r.clone().text());
    return (await r.json()).device;
  };
  /** The sessions the coding agent opened, each `[method, options]`. @returns {[string, any][]} */
  const opened = () => (existsSync(opens) ? readFileSync(opens, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((o) => [o.method, o.options]) : []);
  /** A reply's words, as an SSE stream carries them. @param {Response} res */
  const words = async (res) => {
    let said = "";
    for (const { data } of parseSse(await res.text())) if (data?.type === "content_block_delta") said += data.delta?.text ?? "";
    return said;
  };

  before(async () => {
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "README.md"), "hello agent\n");
    // The fake ACP agent, each session it is asked to open written down with its options as they come in.
    const wrapper = join(base, "coder.mjs");
    writeFileSync(
      wrapper,
      [
        `import ${JSON.stringify(pathToFileURL(FAKE_ACP_AGENT).href)};`,
        `import { appendFileSync } from "node:fs";`,
        `let held = "";`,
        `process.stdin.on("data", (d) => {`,
        `  held += d;`,
        `  let nl;`,
        `  while ((nl = held.indexOf("\\n")) >= 0) {`,
        `    const line = held.slice(0, nl).trim();`,
        `    held = held.slice(nl + 1);`,
        `    let m = null;`,
        `    try { m = JSON.parse(line); } catch {}`,
        `    if (/^session\\/(new|load|resume)$/.test(String(m?.method))) appendFileSync(${JSON.stringify(opens)}, JSON.stringify({ method: m.method, options: m.params?._meta?.claudeCode?.options ?? null }) + "\\n");`,
        `  }`,
        `});`,
        ``,
      ].join("\n"),
    );
    up = await fakeUpstream(brain);
    two = await startTwoMachines({
      there: {
        // Its Environment names where it listens and its command line, as a real capture does.
        environment: async (/** @type {string} */ root) => ({ ...(await TEST_ENVIRONMENT(root)), harness: { command: "node bin/filament.js", listen: "127.0.0.1:20340", cli: "filament" } }),
        configure: (cfg) => {
          cfg.upstreams = [
            { id: "m", name: "m", type: "anthropic", baseUrl: up.url, apiKey: "s", enabled: true },
            { id: "cc", name: "Claude Code", type: "acp", acp: { command: process.execPath, args: [wrapper], env: { FAKE_ACP_CLAUDE: "1" }, cwdDefault: project, permissions: "allow-all", hints: false } },
          ];
          cfg.routes = [
            { match: "m-*", upstream: "m", upstreamModel: "{model}", enabled: true },
            { match: "cc/*", upstream: "cc", upstreamModel: "{1}", enabled: true },
          ];
          // Auto: nothing asks the person here.
          cfg.agentLoop = { ...cfg.agentLoop, enabled: true, permissions: "auto", roots: [base], readerModel: "" };
        },
      },
    });
    there = two.there;
    const minted = await (await two.ask("/api/remote/agent-device", { method: "POST", headers: JSON_TYPE, body: "{}" })).json();
    deviceId = String(minted.device.id);
    await grant({ agents: true });
    agents = as(there, minted.token);
  });
  after(async () => {
    await two?.stop();
    await up?.close();
    rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  // (fails before: yes — the agents' chat ran the command in Auto, with no one asked)
  test("May run without asking off: in Auto, their chat's command asks as in Edit, and the ask is theirs to show; the person's own chat runs it; on, theirs runs; switched off mid-run, the next call asks", async () => {
    const mine = join(project, "person-ran.txt");
    await (async () => {
      const id = await personChat();
      const r = await there.api(`${S(id)}/turns`, { method: "POST", body: { content: `CALLS<<${JSON.stringify([["bash", { command: writes(mine) }]])}>>`, stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
    })();
    assert.equal(existsSync(mine), true, "the person's own chat runs it in Auto");

    const off = join(project, "off-ran.txt");
    const id = await theirChat();
    await theirTurn(id, `CALLS<<${JSON.stringify([["bash", { command: writes(off) }]])}>>`);
    const [ask] = await theirAsks(id);
    assert.equal(ask?.kind, "permission", JSON.stringify(ask));
    assert.equal(existsSync(off), false, "nothing ran");
    // A write in its folder runs, as Edit runs one.
    const wrote = join(project, "written.txt");
    const w = await theirChat();
    await theirTurn(w, `CALLS<<${JSON.stringify([["write", { path: wrote, content: "words" }]])}>>`);
    assert.equal(existsSync(wrote), true, "a write in its folder runs");
    assert.deepEqual(await theirAsks(w), []);

    const on = join(project, "on-ran.txt");
    await grant({ unasked: true });
    try {
      const id2 = await theirChat();
      await theirTurn(id2, `CALLS<<${JSON.stringify([["bash", { command: writes(on) }]])}>>`);
      assert.equal(existsSync(on), true, "with the switch on, Auto runs it");
      assert.deepEqual(await theirAsks(id2), []);

      // Switched off between two calls of one turn: the first ran, the second asks.
      const first = join(project, "mid-1.txt");
      const second = join(project, "mid-2.txt");
      between.set("MIDRUN", async (round) => {
        if (round === 1) await grant({ unasked: false });
      });
      const id3 = await theirChat();
      await theirTurn(id3, `MIDRUN CALLS<<${JSON.stringify([["bash", { command: writes(first) }], ["bash", { command: writes(second) }]])}>>`);
      assert.equal(existsSync(first), true, "the call judged with the switch on ran");
      assert.equal(existsSync(second), false, "the call judged after it went off did not");
      assert.equal((await theirAsks(id3))[0]?.kind, "permission");
    } finally {
      between.delete("MIDRUN");
      await grant({ unasked: false });
    }
  });

  // (fails before: yes — their chat's mode was refused at its start, so it ran in this machine's own; the owner's of 11-10)
  test("their chat starts in the mode they send, the sending chat's: Edit asks though this machine is in Auto, and Full access without Without asking still asks", async () => {
    /** @param {string} mode */
    const chatIn = async (mode) => {
      const r = await agents("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL, preset: "plain", settings: { loop: { permissions: mode } } } });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      return String(j.id);
    };
    /** @param {string} file */
    const runs = (file) => `CALLS<<${JSON.stringify([["bash", { command: writes(file) }]])}>>`;
    await grant({ unasked: true });
    try {
      const asked = join(project, "sent-edit.txt");
      const id = await chatIn("edit");
      await theirTurn(id, runs(asked));
      assert.equal(existsSync(asked), false, "Edit, as sent, asks first though this machine is in Auto");
      assert.equal((await theirAsks(id))[0]?.kind, "permission");
      const ran = join(project, "sent-auto.txt");
      await theirTurn(await chatIn("auto"), runs(ran));
      assert.equal(existsSync(ran), true, "Full access, as sent, runs it with Without asking on");
    } finally {
      await grant({ unasked: false });
    }
    const capped = join(project, "sent-auto-capped.txt");
    const id = await chatIn("auto");
    await theirTurn(id, runs(capped));
    assert.equal(existsSync(capped), false, "Full access, as sent, runs as Edit with Without asking off");
    assert.equal((await theirAsks(id))[0]?.kind, "permission");
  });

  // (fails before: yes — their chat on a coding agent started it, with the person's own MCP servers and settings)
  test("May use coding agents here off: their chat on a coding agent, and their sub-agent on one, are refused in words naming the pill, and the agent never starts; on, Claude Code opens with no user-level MCP servers; the person's chat opens as it does", async () => {
    const id = await theirChat(CODER);
    const r = await agents(`${S(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    const said = await r.text();
    assert.equal(r.status, 403, said);
    assert.match(said, /may not use coding agents here/);
    assert.match(said, /\\?"Coding agents\\?", pressed on their machine's card in Settings › Remote access › Machines on this machine, lets them\./);
    // Their loop's sub-agent on one: refused the same, as its run starts.
    const sub = await theirChat();
    await theirTurn(sub, `CALLS<<${JSON.stringify([["agent", { description: "Code it", prompt: "SUBCODER hello", model: CODER, run_in_background: false }]])}>>`);
    const result = calls.findLast((c) => c.first.includes("SUBCODER") && c.results.length);
    assert.match(String(result?.results[0]), /\\?"Coding agents\\?", pressed on their machine's card in Settings › Remote access › Machines/, JSON.stringify(result?.results));
    assert.deepEqual(opened(), [], "the coding agent never opened a session for them");

    // The person's own chat on it: opened as it is, the person's settings and servers its own.
    const mine = await personChat(CODER);
    const r2 = await there.api(`${S(mine)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(r2.status, 200, await r2.clone().text());
    const [[, personOptions]] = opened();
    assert.equal(personOptions?.strictMcpConfig, undefined, JSON.stringify(personOptions));
    assert.equal(personOptions?.settingSources, undefined, JSON.stringify(personOptions));

    await grant({ codingAgents: true });
    try {
      const theirs = await theirChat(CODER);
      const r3 = await agents(`${S(theirs)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
      assert.equal(r3.status, 200, await r3.clone().text());
      const [, options] = opened().at(-1) || [];
      assert.equal(options?.strictMcpConfig, true, JSON.stringify(options));
      assert.deepEqual(options?.settingSources, ["project", "local"], JSON.stringify(options));
    } finally {
      await grant({ codingAgents: false });
    }
  });

  // (fails before: yes — Full control was no grant: their chat on a coding agent was refused without Coding agents, and
  // opened fenced with it)
  test("Full control: their chat on a coding agent runs with Coding agents off, and Claude Code opens as the person's does; switched off, the same chat's next turn opens it fenced again", async () => {
    await grant({ full: true });
    try {
      const id = await theirChat(CODER);
      const r = await agents(`${S(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
      assert.equal(r.status, 200, await r.clone().text());
      const [, options] = opened().at(-1) || [];
      assert.equal(options?.strictMcpConfig, undefined, JSON.stringify(options));
      assert.equal(options?.settingSources, undefined, JSON.stringify(options));
      const before = opened().length;
      await grant({ full: false, codingAgents: true });
      const again = await agents(`${S(id)}/turns`, { method: "POST", body: { content: "hello again", stream: false } });
      assert.equal(again.status, 200, await again.clone().text());
      assert.ok(opened().length > before, "the session opened again");
      const [, fenced] = opened().at(-1) || [];
      assert.equal(fenced?.strictMcpConfig, true, JSON.stringify(fenced));
      assert.deepEqual(fenced?.settingSources, ["project", "local"], JSON.stringify(fenced));
    } finally {
      await grant({ full: false, codingAgents: false });
    }
  });

  // (fails before: yes — a coding agent's turn in a chat started under Full control in a folder the fence refuses ran
  // there once Full control was off: its folder was judged as it started, and never again)
  test("Full control off: a coding agent's turn in their chat started under it in a folder the fence refuses is refused in words, the agent never opened", async () => {
    const keys = join(base, "app", ".ssh");
    mkdirSync(keys, { recursive: true });
    let id = "";
    await grant({ full: true });
    try {
      const r = await agents("/api/sessions", { method: "POST", body: { cwd: keys, model: CODER, preset: "plain" } });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      id = String(j.id);
    } finally {
      await grant({ full: false, codingAgents: true });
    }
    try {
      const before = opened().length;
      const r = await agents(`${S(id)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
      const said = await r.text();
      assert.equal(r.status, 200, said);
      assert.match(said, /a credentials folder.*works there no more without Full control/);
      assert.equal(opened().length, before, "the coding agent never opened a session");
    } finally {
      await grant({ codingAgents: false });
    }
  });

  // (fails before: yes — acp-turn.js read a meta it could not read as the person's chat's: its coding agent started)
  test("a chat whose meta cannot be read is refused a coding agent, as another machine's agents' chat; read again, the person's runs", async () => {
    const mine = await personChat(CODER);
    const archive = /** @type {any} */ (there.app).memory.archive;
    const metaOf = archive.metaOf;
    archive.metaOf = (/** @type {string} */ id, /** @type {string[]} */ keys) => {
      if (id === mine && Array.isArray(keys) && keys.includes("agentDevice")) throw new SyntaxError("Unexpected token in JSON at position 3");
      return metaOf.call(archive, id, keys);
    };
    const before = opened().length;
    try {
      const r = await there.api(`${S(mine)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
      const said = await r.text();
      assert.equal(r.status, 403, said);
      assert.match(said, /may not use coding agents here/);
      assert.equal(opened().length, before, "the coding agent never opened a session");
    } finally {
      archive.metaOf = metaOf;
    }
    const r2 = await there.api(`${S(mine)}/turns`, { method: "POST", body: { content: "hello", stream: false } });
    assert.equal(r2.status, 200, await r2.clone().text());
  });

  // (fails before: yes — the coding agent's request to run a command was allowed in Auto, with no one asked)
  test("May run without asking off: a coding agent's request in their chat asks in Auto, and their Deny keeps it from running; on, it runs unasked", async () => {
    await grant({ codingAgents: true });
    try {
      const id = await theirChat(CODER);
      const asking = agents(`${S(id)}/turns`, { method: "POST", body: { content: "~permbash", stream: true } });
      assert.ok(await waitFor(async () => (await theirAsks(id)).some((a) => a.kind === "permission")), "their chat asks");
      const [ask] = await theirAsks(id);
      const answered = await agents(`${S(id)}/asks/${encodeURIComponent(ask.id)}/answer`, { method: "POST", body: { allow: false } });
      assert.equal(answered.status, 200, await answered.clone().text());
      assert.match(await words(await asking), /permbash: reject/);

      await grant({ unasked: true });
      const r = await agents(`${S(id)}/turns`, { method: "POST", body: { content: "~permbash", stream: true } });
      assert.match(await words(r), /permbash: allow-once/);
    } finally {
      await grant({ unasked: false, codingAgents: false });
    }
  });

  // (fails before: yes — PATCH named grants there are none of: 400)
  // (fails before: yes — /clones looked in every chat's folder, another machine's agents' own and other devices' among
  // them, and named each to the device: the x-sec hunt's)
  test("/clones answers their device from the folders its chats may start in: a person's chat's clone, never an agents' chat's", async () => {
    const origin = "https://github.com/acme/xsec-clones.git";
    const mine = join(base, "clone-mine");
    const agentsOwn = join(base, "clone-agents");
    for (const d of [mine, agentsOwn]) {
      mkdirSync(d, { recursive: true });
      execFileSync("git", ["init", "-q"], { cwd: d });
      execFileSync("git", ["remote", "add", "origin", origin], { cwd: d });
    }
    const made = await there.api("/api/sessions", { method: "POST", body: { cwd: mine, model: MODEL, preset: "plain" } });
    assert.equal(made.status, 200, await made.clone().text());
    const r = await agents("/api/sessions", { method: "POST", body: { cwd: agentsOwn, model: MODEL, preset: "plain" } });
    assert.equal(r.status, 200, await r.clone().text());
    const key = (/** @type {string} */ p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    const paths = async (/** @type {(path: string) => Promise<Response>} */ ask) => {
      const res = await ask(`/api/clones?remote=${encodeURIComponent(origin)}`);
      assert.equal(res.status, 200, await res.clone().text());
      return ((await res.json()).clones || []).map((/** @type {any} */ c) => key(String(c.path))).sort();
    };
    assert.deepEqual(await paths((p) => there.api(p)), [key(agentsOwn), key(mine)].sort(), "this machine's person: every folder");
    assert.deepEqual(await paths(agents), [key(mine)], "their device: the person's folder alone");
    // (fails before: yes — the review of 11-10: a folder a launch names was never read there, its git state unsaid)
    // A folder named (`cwd`) is read where their chat may start in it — a subfolder of a clone its clone —, never elsewhere.
    const sub = join(mine, "src");
    mkdirSync(sub, { recursive: true });
    const named = async (/** @type {(path: string) => Promise<Response>} */ ask, /** @type {string} */ cwd) => {
      const res = await ask(`/api/clones?remote=${encodeURIComponent(origin)}&cwd=${encodeURIComponent(cwd)}`);
      assert.equal(res.status, 200, await res.clone().text());
      const n = (await res.json()).named;
      return n && { ...n, path: n.path ? key(String(n.path)) : null };
    };
    const branch = execFileSync("git", ["symbolic-ref", "--short", "HEAD"], { cwd: mine, encoding: "utf8" }).trim();
    assert.deepEqual(await named(agents, sub), { gone: false, git: true, same: true, path: key(mine), head: null, branch, dirty: false });
    assert.equal((await named(agents, agentsOwn))?.same, true, "a folder their chat started in, inside the person's");
    const outside = mkdtempSync(join(tmpdir(), "filament-xgrants-out-"));
    try {
      assert.equal(await named(agents, outside), null, "never a folder outside the person's");
      assert.deepEqual(await named((p) => there.api(p), outside), { gone: false, git: false, same: false, path: null, head: null, branch: null, dirty: null }, "the person's: any folder, here none in git");
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  // (fails before: yes — their chat's prompt named where this Filament listens and its command line, the door to its
  // settings and keys: the x-sec hunt's)
  test("their chat is told Filament runs it, never where it listens or its command line; the person's chat is", async () => {
    // The default preset, whose chats carry their Environment.
    const start = async (/** @type {(path: string, o: any) => Promise<Response>} */ ask) => {
      const r = await ask("/api/sessions", { method: "POST", body: { cwd: project, model: MODEL } });
      assert.equal(r.status, 200, await r.clone().text());
      return String((await r.json()).id);
    };
    const mine = await start((p, o) => there.api(p, o));
    const ours = await start(agents);
    await (await there.api(`${S(mine)}/turns`, { method: "POST", body: { content: "ENV MINE", stream: false } })).text();
    await theirTurn(ours, "ENV THEIRS");
    const sys = (/** @type {string} */ w) => calls.find((c) => c.first.includes(w))?.system || "";
    assert.match(sys("ENV MINE"), /Filament, the harness you run in: .+ on \S+\. .*Its command line:/);
    assert.match(sys("ENV THEIRS"), /Filament, the harness you run in: /);
    assert.doesNotMatch(sys("ENV THEIRS"), /harness you run in: [^\n]* on \S+\.|Its command line:/);
  });

  test("their device sets none of its own grants; this machine's computer sets each, and reads them back", async () => {
    const own = await agents(`/api/remote/devices/${encodeURIComponent(deviceId)}`, { method: "PATCH", body: { grants: { unasked: true, codingAgents: true } } });
    assert.equal(own.status, 403, await own.clone().text());
    const listed = await (await there.api("/api/remote/devices")).json();
    const d = listed.devices.find((/** @type {any} */ x) => x.id === deviceId);
    assert.deepEqual([d.grants.unasked, d.grants.codingAgents], [false, false]);
    const set = await grant({ unasked: true, codingAgents: true });
    assert.deepEqual([set.grants.unasked, set.grants.codingAgents, set.grants.agents], [true, true, true]);
    await grant({ unasked: false, codingAgents: false });
  });
});

// (fails before: yes — the store kept agents, models and browser alone)
test("the store: both switches off by default, set alone, carried over a second mint, read off from a devices.json without them", () => {
  const dir = mkdtempSync(join(tmpdir(), "filament-xgrants-store-"));
  try {
    assert.ok(GRANTS.includes("unasked") && GRANTS.includes("codingAgents"), GRANTS.join(", "));
    const devices = createDevices({ dataDir: dir });
    const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Laptop" });
    assert.ok(full.ok);
    const minted = devices.mintAgents(full.device.id);
    assert.ok(minted.ok);
    assert.deepEqual([minted.device.grants.unasked, minted.device.grants.codingAgents], [false, false]);
    assert.deepEqual(devices.grant(minted.device.id, { unasked: true })?.grants, { agents: false, copies: false, models: false, browser: false, unasked: true, codingAgents: false, full: false });
    devices.grant(minted.device.id, { codingAgents: true });
    const again = devices.mintAgents(full.device.id);
    assert.ok(again.ok);
    assert.deepEqual([again.device.grants.unasked, again.device.grants.codingAgents], [true, true], "carried over a second mint");
    // A devices.json written without them: off.
    const kept = JSON.parse(readFileSync(join(dir, "devices.json"), "utf8"));
    for (const d of kept.devices) d.grants = { agents: true };
    writeFileSync(join(dir, "devices.json"), JSON.stringify(kept));
    const back = createDevices({ dataDir: dir });
    assert.deepEqual(back.get(again.device.id)?.grants, { agents: true, copies: false, models: false, browser: false, unasked: false, codingAgents: false, full: false });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A response as the admin rows write to it: what it was sent, its SSE events read back. */
const standIn = () => {
  const res = Object.assign(new EventEmitter(), {
    status: 0,
    /** @type {Record<string, any>} */ headers: {},
    body: "",
    writableEnded: false,
    destroyed: false,
    /** @param {number} status @param {Record<string, any>} [headers] */
    writeHead(status, headers = {}) {
      res.status = status;
      res.headers = headers;
      return res;
    },
    flushHeaders() {},
    /** @param {unknown} chunk */
    write(chunk) {
      if (!res.writableEnded) res.body += String(chunk);
      return true;
    },
    /** @param {unknown} [chunk] */
    end(chunk) {
      if (res.writableEnded) return res;
      if (chunk !== undefined) res.body += String(chunk);
      res.writableEnded = true;
      setImmediate(() => res.emit("close"));
      return res;
    },
    /** The SSE events it was sent. @returns {any[]} */
    events: () => res.body.split("\n\n").filter((f) => f.startsWith("data: ")).map((f) => JSON.parse(f.slice(6))),
  });
  return res;
};

// (fails before: yes — their exec ran in Auto, with no one asked)
/** The exec test's folder, removed once every test is done: a command's shell may still hold it as its own ends. */
const execDir = mkdtempSync(join(tmpdir(), "filament-xgrants-exec-"));
after(() => rmSync(execDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }));

test("May run without asking off: their exec asks in Auto, as in Edit; this machine's person's runs; on, theirs runs; off again, their next one asks", async () => {
  const dir = execDir;
  const devices = createDevices({ dataDir: null });
  const full = devices.claim(devices.startPairing({ scope: "full" }).code, { name: "Laptop" });
  assert.ok(full.ok);
  const minted = devices.mintAgents(full.device.id);
  assert.ok(minted.ok);
  const id = minted.device.id;
  devices.grant(id, { agents: true });
  const config = { agentLoop: { permissions: "auto", roots: [dir] }, server: { host: "127.0.0.1" }, sessions: { defaults: {} } };
  const a = { config: { get: () => config }, memory: null, dataDir: join(dir, "data"), devices, sseClients: new Set(), log: () => {} };
  const route = createRouter(execRoutes(a));
  /** The device as the admin gate hands it on, its grants as they stand. */
  const theirs = () => ({ kind: "device", scope: "agent", device: devices.get(id) });
  /** @param {string} method @param {string} path @param {{ body?: any, who?: any }} o */
  const call = (method, path, { body = {}, who = theirs() }) => {
    const res = standIn();
    const url = new URL(`http://127.0.0.1/api${path}`);
    const m = route(method, url.pathname.slice(4));
    if (!m) throw new Error(`no row answers ${method} ${path}`);
    const done = Promise.resolve(m.handler({ req: {}, res, url, path: url.pathname.slice(4), method, params: m.params, json: async () => body, who }, a));
    return { res, done, id: () => String(res.headers["x-filament-exec"] || "") };
  };
  /** Its first event, once sent. @param {ReturnType<typeof call>} c */
  const first = async (c) => {
    assert.ok(await waitFor(() => c.res.events().some((e) => e.type === "exec")));
    return c.res.events().find((e) => e.type === "exec");
  };
  const command = `node -e "1"`;
  const off = call("POST", "/exec", { body: { cwd: dir, command } });
  assert.deepEqual([(await first(off)).state, (await first(off)).mode], ["asking", "edit"]);
  off.res.emit("close");
  await off.done;
  // This machine's person's runs in Auto.
  const mine = call("POST", "/exec", { body: { cwd: dir, command }, who: { kind: "local" } });
  assert.deepEqual([(await first(mine)).state, (await first(mine)).mode], ["running", "auto"]);
  await mine.done;
  devices.grant(id, { unasked: true });
  const on = call("POST", "/exec", { body: { cwd: dir, command } });
  assert.deepEqual([(await first(on)).state, (await first(on)).mode], ["running", "auto"]);
  await on.done;
  devices.grant(id, { unasked: false });
  const again = call("POST", "/exec", { body: { cwd: dir, command } });
  assert.deepEqual([(await first(again)).state, (await first(again)).mode], ["asking", "edit"]);
  again.res.emit("close");
  await again.done;
});

/** Every node under `el` a test picks. @param {any} el @param {(n: any) => boolean} pick @returns {any[]} */
const every = (el, pick) => {
  /** @type {any[]} */
  const out = [];
  /** @param {any} n */
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (pick(n)) out.push(n);
    for (const k of n.kids || []) walk(k);
  };
  walk(el);
  return out;
};
/** @param {any} n @param {string} cls */
const hasClass = (n, cls) => String(n.attrs?.class || "").split(/\s+/).includes(cls);
/** A listed line by its title. @param {any} el @param {string} name */
const itemOf = (el, name) => {
  const r = every(el, (n) => hasClass(n, "rset-item")).find((n) => textOf(every(n, (k) => hasClass(k, "rset-name"))[0]) === name);
  assert.ok(r, `an item "${name}"`);
  return r;
};
/** The pills under `el`. @param {any} el */
const pills = (el) => every(el, (n) => hasClass(n, "rset-pill"));
/** A pill by what it says to a screen reader. @param {any} el @param {string} aria */
const pillOf = (el, aria) => {
  const b = pills(el).find((n) => n.attrs["aria-label"] === aria);
  assert.ok(b, `a pill "${aria}"`);
  return b;
};

// (fails before: yes — the agents' device had two switches, for its agents and its models)
test("Settings › Remote access: on the line for what a machine's agents may do here, Without asking and Coding agents, a pill each, what each does in its title, each PATCHing its grant alone", async () => {
  const T0 = Date.parse("2026-11-08T12:00:00Z");
  const FULL = { id: "d-laptop", name: "Laptop", scope: "full", kind: "browser", grants: { agents: false, models: false, browser: false, unasked: false, codingAgents: false }, createdAt: T0 - 9, lastSeenAt: T0, lastSeenFrom: "192.168.1.9", revokedAt: null };
  const AGENTS = { id: "d-agents", name: "Filament agents on Laptop", scope: "agent", kind: "agents", of: "d-laptop", grants: { agents: true, models: false, browser: false, unasked: false, codingAgents: false }, createdAt: T0, lastSeenAt: null, lastSeenFrom: null, revokedAt: null };
  /** @type {any[]} */
  let devices = [AGENTS, FULL];
  /** @type {[string, string, any][]} */
  const sent = [];
  const api = async (/** @type {string} */ path, /** @type {any} */ init = {}) => {
    const method = init.method || "GET";
    sent.push([method, path, init.body]);
    if (path === "/schema") return { config: {} };
    if (path === "/state") return { version: "9.9.9", machine: { id: "m-1", name: "Workstation" }, viewer: "local", device: null, config: {} };
    if (path === "/remote/devices") return structuredClone({ devices, pending: [] });
    const one = /^\/remote\/devices\/([^?]+)$/.exec(path);
    if (one && method === "PATCH") {
      const id = decodeURIComponent(one[1]);
      devices = devices.map((d) => (d.id === id ? { ...d, grants: { ...d.grants, ...init.body.grants } } : d));
      return { device: structuredClone(devices.find((d) => d.id === id)) };
    }
    throw Object.assign(new Error(`no route ${method} ${path}`), { status: 404, body: { error: `no route ${path}` } });
  };
  const body = /** @type {any} */ (fakeH("div", {}));
  renderRemote(body, { onToast: () => {} }, { h: fakeH, api, copy: async () => {}, confirm: async () => true, now: () => T0 + 120_000, every: () => () => {}, go: () => {}, app: null });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  };
  await settle();
  assert.deepEqual(GRANT_ROWS.slice(-3, -1).map((g) => g.grant), ["unasked", "codingAgents"]);
  const ASK = "May run without asking (Filament agents on Laptop)";
  const CODERS = "May use coding agents here (Filament agents on Laptop)";
  const ask = pillOf(body, ASK);
  assert.equal(textOf(ask), "Without asking");
  assert.match(ask.attrs.title, /^Laptop's sub-agents, and the single commands Laptop sends, run here without asking when the chat on Laptop that sent them is in Full access\. Off, Full access runs as Edit for them: their commands ask, and their command tasks and checks don't run\.$/);
  const coders = pillOf(body, CODERS);
  assert.equal(textOf(coders), "Coding agents");
  assert.match(coders.attrs.title, /on their sign-ins here, without your own MCP servers; Cursor still loads its own\.$/);
  assert.deepEqual([ask, coders].map((s) => s.attrs["aria-pressed"]), ["false", "false"]);
  assert.deepEqual(pills(itemOf(body, "What Laptop may do on this machine")).map((s) => s.attrs["aria-label"]).filter((a) => a.endsWith("(Filament agents on Laptop)")).length, 6, "every pill its agents' device's");
  ask.attrs.onclick();
  await settle();
  assert.deepEqual(sent.filter(([m]) => m === "PATCH").at(-1), ["PATCH", "/remote/devices/d-agents", { grants: { unasked: true } }]);
  assert.equal(pillOf(body, ASK).attrs["aria-pressed"], "true");
  pillOf(body, CODERS).attrs.onclick();
  await settle();
  assert.deepEqual(sent.filter(([m]) => m === "PATCH").at(-1), ["PATCH", "/remote/devices/d-agents", { grants: { codingAgents: true } }]);
  assert.equal(pillOf(body, CODERS).attrs["aria-pressed"], "true");
});

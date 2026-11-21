// @ts-check
// What another machine's agents reach on this machine through its exec route, its file read and its git (the security
// review of the remote-agents plan): Filament's own command line is no read for them, a command and the ended execs kept
// are bounded, a file they read is redacted as this machine's privacy.redact says, and a folder an agent wrote to look
// like a bare repository runs nothing of its config in Filament's own git.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { EXEC_COMMAND_MAX_CHARS, EXEC_ENDED_PER_CALLER, execRoutes } from "../src/http/admin/exec.js";
import { fileRoutes } from "../src/http/admin/files.js";
import { createRouter } from "../src/http/router.js";
import { SHELL } from "../src/adapters/tools/shell.js";
import { readOnlyCommand } from "../src/adapters/tools/read-only-commands.js";
import { gate } from "../src/app/agent/tools.js";
import { createAgentPermits } from "../src/app/agent-permits.js";
import { placeOf, snapshotTree } from "../src/adapters/git/snapshot.js";

const BASH = ["git-bash", "bash", "sh"].includes(SHELL.kind);

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

const LOCAL = { kind: "local" };
/** Another machine's agents' device, as the admin gate hands it on. @param {string} id */
const agentsOf = (id) => ({ kind: "device", scope: "agent", device: { id, name: `Filament agents on ${id}`, grants: { agents: true } } });

/**
 * The exec and file rows over a stand-in admin context: this machine's config as `cfg` says it (the temp folder a root).
 * `call` runs a row as the admin API would, its `done` the row's end.
 * @param {any} [cfg]
 */
const rows = (cfg = {}) => {
  const config = { agentLoop: { permissions: "auto", roots: [tmpdir()] }, server: { host: "127.0.0.1" }, sessions: { defaults: {} }, ...cfg };
  const a = { config: { get: () => config }, memory: null, dataDir: join(tmpdir(), "filament-x-sec-no-data"), devices: null, sseClients: new Set(), log: () => {} };
  const route = createRouter([...execRoutes(a), ...fileRoutes(a)]);
  /** @param {string} method @param {string} path  under /api @param {{ body?: any, who?: any }} [o] */
  const call = (method, path, { body = {}, who = LOCAL } = {}) => {
    const res = standIn();
    const url = new URL(`http://127.0.0.1/api${path}`);
    const m = route(method, url.pathname.slice(4));
    if (!m) throw new Error(`no row answers ${method} ${path}`);
    const done = Promise.resolve(m.handler({ req: {}, res, url, path: url.pathname.slice(4), method, params: m.params, json: async () => body, who }, a));
    return { res, done, id: () => String(res.headers["x-filament-exec"] || "") };
  };
  /** A row's JSON answer. @param {string} method @param {string} path @param {{ body?: any, who?: any }} [o] */
  const json = async (method, path, o = {}) => {
    const c = call(method, path, o);
    await c.done;
    return { status: c.res.status, body: JSON.parse(c.res.body || "null") };
  };
  return { config, call, json };
};

/** Wait until `fn` holds, up to `ms`. @param {() => boolean} fn */
const waitFor = async (fn, ms = 10_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await new Promise((res) => setTimeout(res, 20));
  }
  return fn();
};

let base = "";
/** The project folder, under the temp folder (a root). */
let root = "";
/** A folder on the PATH holding a stand-in for Filament's command line, outside the project. */
let bin = "";
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
const PATH_BEFORE = process.env[PATH_KEY];

before(() => {
  base = mkdtempSync(join(tmpdir(), "filament-x-sec-"));
  root = join(base, "project");
  mkdirSync(root);
  bin = join(base, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "filament"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "filament"), 0o755);
  // The exec route reads a command with the bash hand's environment (hands.js `safeEnv`), this process's PATH.
  process.env[PATH_KEY] = `${bin}${delimiter}${PATH_BEFORE ?? ""}`;
});

after(() => {
  process.env[PATH_KEY] = PATH_BEFORE;
  if (base) rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

// (fails before: yes — `filament chats --json` read as only reading for every caller: another machine's agents' exec
// ran it in Ask mode with no press, and their chat's gate ran it in every mode)
test("Filament's own command line is no read for another machine's agents: their exec asks, their chat's gate asks; this machine's own reads stay reads", { skip: BASH ? false : `${SHELL.name} is not a bash` }, async () => {
  const command = "filament chats --json";
  const env = { PATH: bin };
  assert.deepEqual(readOnlyCommand(command, { root, shell: SHELL, env }), { ok: true }, "a chat of this machine's reads it");
  for (const c of [command, "filament settings get agentLoop.permissions", "filament agents", "filament keys", "filament memory", "filament status"]) {
    const v = readOnlyCommand(c, { root, shell: SHELL, env, agentsDevice: true });
    assert.equal(v.ok, false, c);
    assert.match(/** @type {{ why: string }} */ (v).why, /Filament's command line/, c);
  }
  // A chat another machine's agents started: its gate, given the reader with their flag, asks in Ask and Edit modes.
  for (const m of /** @type {const} */ (["ask", "edit"])) {
    const theirs = gate(m, "bash", { command }, null, undefined, (c) => readOnlyCommand(c, { root, shell: SHELL, env, agentsDevice: true }), root);
    assert.equal(theirs.verdict, "ask", m);
    const own = gate(m, "bash", { command }, null, undefined, (c) => readOnlyCommand(c, { root, shell: SHELL, env }), root);
    assert.deepEqual(own, { verdict: "run", readOnly: true }, m);
  }
  // A coding agent's chat they started: its switch (agent-permits.js) reads with their flag, and asks; a chat of this
  // machine's runs it.
  for (const agentsDevice of [true, false]) {
    const p = createAgentPermits({ rules: [], modeNow: () => "ask", learned: null, agentsDevice });
    assert.equal(p.judge([{ name: "bash", input: { command } }], root).verdict, agentsDevice ? "ask" : "run", `agentsDevice ${agentsDevice}`);
  }
  // Through the exec route, in Ask mode: the agents' device's waits on an ask; this machine's person's runs.
  const { call } = rows({ agentLoop: { permissions: "ask", roots: [tmpdir()] } });
  const theirs = call("POST", "/exec", { who: agentsOf("phone"), body: { cwd: root, command } });
  assert.ok(await waitFor(() => theirs.res.events().some((e) => e.type === "exec")));
  assert.equal(theirs.res.events().find((e) => e.type === "exec")?.state, "asking");
  theirs.res.emit("close");
  await theirs.done;
  const mine = call("POST", "/exec", { body: { cwd: root, command } });
  assert.ok(await waitFor(() => mine.res.events().some((e) => e.type === "exec")));
  assert.equal(mine.res.events().find((e) => e.type === "exec")?.state, "running");
  await mine.done;
});

// (fails before: yes — a command of any length was taken, and every ended exec kept five minutes: a caller that hung up
// at once could fill this machine's memory with asks that never ran)
test("a command longer than 32K characters is refused 413 in words, and a caller's ended execs kept are its newest 32", async () => {
  const { call, json } = rows({ agentLoop: { permissions: "ask", roots: [tmpdir()] } });
  const over = call("POST", "/exec", { who: agentsOf("phone"), body: { cwd: root, command: `node -e "${"x".repeat(40_000)}"` } });
  assert.ok(await waitFor(() => over.res.status !== 0));
  if (over.res.status !== 413) over.res.emit("close");
  await over.done;
  assert.equal(over.res.status, 413);
  assert.match(JSON.parse(over.res.body).error, new RegExp(`40010 characters: a command here is ${EXEC_COMMAND_MAX_CHARS} characters at most`));
  // A command as long as another machine's Filament sends (remote-commands.js) is taken.
  const long = call("POST", "/exec", { who: agentsOf("phone"), body: { cwd: root, command: `node -e "${"x".repeat(19_990)}"` } });
  assert.ok(await waitFor(() => long.res.status !== 0));
  assert.equal(long.res.status, 200);
  long.res.emit("close");
  await long.done;
  // This machine's person's, ended before them: another caller's count is its own.
  const mine = call("POST", "/exec", { body: { cwd: root, command: `node -e "console.log('mine')"` } });
  assert.ok(await waitFor(() => mine.res.status !== 0));
  mine.res.emit("close");
  await mine.done;
  /** @type {string[]} */
  const ids = [long.id()];
  for (let i = 0; i < 100; i++) {
    const c = call("POST", "/exec", { who: agentsOf("phone"), body: { cwd: root, command: `node -e "console.log(${i})"` } });
    assert.ok(await waitFor(() => c.res.status !== 0));
    assert.equal(c.res.status, 200, c.res.body);
    ids.push(c.id());
    c.res.emit("close");
    await c.done;
  }
  const kept = [];
  for (const id of ids) if ((await json("GET", `/exec/${id}`)).status === 200) kept.push(id);
  assert.equal(kept.length, EXEC_ENDED_PER_CALLER, "its newest");
  assert.deepEqual(kept, ids.slice(-EXEC_ENDED_PER_CALLER));
  const person = await json("GET", `/exec/${mine.id()}`);
  assert.deepEqual([person.status, person.body.state, person.body.ended], [200, "ended", "closed"], "this machine's person's is kept");
});

// (fails before: yes — /files/read answered another machine's agents the file as it stands, privacy.redact unread)
test("a file another machine's agents read is redacted as privacy.redact says; this machine's person reads it whole", async () => {
  const { json } = rows({ sessions: { defaults: { privacy: { redact: ["sk-test-[a-z0-9]+"] } } } });
  writeFileSync(join(root, ".env"), "API_KEY=sk-test-abc123\nNAME=x\n");
  const path = `/files/read?cwd=${encodeURIComponent(root)}&path=.env`;
  const theirs = await json("GET", path, { who: agentsOf("phone") });
  assert.equal(theirs.status, 200, JSON.stringify(theirs.body));
  assert.equal(theirs.body.content, "API_KEY=[redacted]\nNAME=x\n");
  const mine = await json("GET", path);
  assert.equal(mine.body.content, "API_KEY=sk-test-abc123\nNAME=x\n");
});

// (fails before: yes — an SVG, a secret's file named .svg among them, went to them whole as an image, and so did a PNG
// holding a secret)
test("an image another machine's agents read: an SVG redacted as its text is, another that holds what privacy.redact matches refused in words; this machine's person reads both whole", async () => {
  const { json } = rows({ sessions: { defaults: { privacy: { redact: ["sk-test-[a-z0-9]+"] } } } });
  const svgText = '<svg xmlns="http://www.w3.org/2000/svg"><text>sk-test-abc123</text></svg>';
  writeFileSync(join(root, "logo.svg"), svgText);
  const head = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(join(root, "shot.png"), Buffer.concat([head, Buffer.from("tEXtkey sk-test-abc123"), Buffer.alloc(16)]));
  const plain = Buffer.concat([head, Buffer.alloc(32, 7)]);
  writeFileSync(join(root, "plain.png"), plain);
  /** @param {string} name @param {any} [who] */
  const read = (name, who) => json("GET", `/files/read?cwd=${encodeURIComponent(root)}&path=${name}`, who ? { who } : undefined);
  /** @param {unknown} dataUrl */
  const bytesOf = (dataUrl) => Buffer.from(String(dataUrl).split(",")[1] || "", "base64");
  const svg = await read("logo.svg", agentsOf("phone"));
  assert.equal(svg.status, 200, JSON.stringify(svg.body));
  assert.equal(bytesOf(svg.body.dataUrl).toString("utf8"), '<svg xmlns="http://www.w3.org/2000/svg"><text>[redacted]</text></svg>');
  const shot = await read("shot.png", agentsOf("phone"));
  assert.equal(shot.status, 403, JSON.stringify(shot.body).slice(0, 300));
  assert.equal(shot.body.error, "another machine's agents read no image that holds what this folder's chats redact (privacy.redact): shot.png");
  const clean = await read("plain.png", agentsOf("phone"));
  assert.equal(clean.status, 200);
  assert.deepEqual(bytesOf(clean.body.dataUrl), plain, "an image holding nothing it matches, as it is");
  assert.equal(bytesOf((await read("logo.svg")).body.dataUrl).toString("utf8"), svgText, "the person's, whole");
  assert.equal((await read("shot.png")).status, 200);
});

// (fails before: yes — git found the folder an agent wrote as a bare repository, its core.worktree its own, and the
// snapshot's add ran the clean filter its config named)
test("a folder written to look like a bare repository, with a filter in its config: Filament's own git runs nothing of it", async () => {
  const crafted = join(base, "crafted");
  for (const d of ["objects", "refs"]) mkdirSync(join(crafted, d), { recursive: true });
  writeFileSync(join(crafted, "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(crafted, "config"), '[core]\n\trepositoryformatversion = 0\n\tbare = false\n\tworktree = .\n[filter "x"]\n\tclean = "echo ran > ../filter-ran; cat"\n');
  writeFileSync(join(crafted, ".gitattributes"), "* filter=x\n");
  writeFileSync(join(crafted, "a.txt"), "a\n");
  const marker = join(base, "filter-ran");
  const place = await placeOf(join(crafted, "a.txt"));
  await snapshotTree(place.place || crafted, { name: "x-sec" });
  await snapshotTree(crafted, { name: "x-sec" });
  assert.equal(existsSync(marker), false, "the filter never ran");
  assert.equal(place.place, null, "no place: git reads no bare repository it was not named");
});
